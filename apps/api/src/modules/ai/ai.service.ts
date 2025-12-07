import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/services/prisma.service';
import { EmbeddingService } from './services/embedding.service';
import { ProductDescriptionService, GeneratedProductContent } from './services/product-description.service';
import { PricingIntelligenceService, PriceSuggestion } from './services/pricing-intelligence.service';
import { ModerationService, ModerationResult } from './services/moderation.service';
import { SellerAssistantService, SellerInsights, StreamSuggestions } from './services/seller-assistant.service';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private descriptionService: ProductDescriptionService,
    private pricingService: PricingIntelligenceService,
    private moderationService: ModerationService,
    private sellerAssistantService: SellerAssistantService,
  ) {}

  async generateProductListing(input: {
    imageUrls?: string[];
    rawDescription?: string;
    category?: string;
    condition?: string;
    sellerNotes?: string;
  }): Promise<{
    content: GeneratedProductContent;
    priceSuggestion?: PriceSuggestion;
    moderation: ModerationResult;
  }> {
    let content: GeneratedProductContent;

    if (input.imageUrls?.length) {
      content = await this.descriptionService.generateFromImage(
        input.imageUrls[0],
        {
          category: input.category,
          condition: input.condition,
          sellerNotes: input.sellerNotes,
        },
      );
    } else if (input.rawDescription) {
      content = await this.descriptionService.generateFromText({
        rawDescription: input.rawDescription,
        category: input.category,
        condition: input.condition,
      });
    } else {
      throw new Error('Either imageUrls or rawDescription is required');
    }

    const [priceSuggestion, moderation] = await Promise.all([
      this.pricingService.getSuggestedPrice({
        title: content.title,
        description: content.description,
        condition: input.condition || 'GOOD',
      }),
      this.moderationService.moderateProductListing({
        title: content.title,
        description: content.description,
        category: input.category,
        imageUrls: input.imageUrls,
      }),
    ]);

    await this.logGeneration('product_listing', input, { content, priceSuggestion });

    return {
      content,
      priceSuggestion,
      moderation,
    };
  }

  async getSellerDashboard(sellerId: string): Promise<{
    insights: SellerInsights;
    streamSuggestions: StreamSuggestions;
    actionItems: { priority: string; action: string; expectedImpact: string }[];
  }> {
    const [insights, streamSuggestions] = await Promise.all([
      this.sellerAssistantService.getInsights(sellerId),
      this.sellerAssistantService.getStreamSuggestions(sellerId),
    ]);

    return {
      insights,
      streamSuggestions,
      actionItems: insights.suggestedActions,
    };
  }

  async chatWithAssistant(
    sellerId: string,
    message: string,
    conversationId?: string,
  ): Promise<{
    response: string;
    suggestions?: string[];
    conversationId: string;
  }> {
    const chatResponse = await this.sellerAssistantService.chat(
      sellerId,
      message,
      [],
    );

    return {
      response: chatResponse.message,
      suggestions: chatResponse.suggestions,
      conversationId: conversationId || `conv_${Date.now()}`,
    };
  }

  async searchProducts(
    query: string,
    options: {
      limit?: number;
      categoryId?: string;
      condition?: string;
      minPrice?: number;
      maxPrice?: number;
    } = {},
  ) {
    const vectorResults = await this.embeddingService.searchProducts(query, {
      limit: options.limit || 20,
      minScore: 0.6,
    });

    if (vectorResults.length === 0) {
      return this.fallbackTextSearch(query, options);
    }

    const productIds = vectorResults.map((r) => r.id);

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        status: 'ACTIVE',
        ...(options.categoryId && { categoryId: options.categoryId }),
        ...(options.condition && { condition: options.condition as any }),
        ...(options.minPrice && { price: { gte: options.minPrice } }),
        ...(options.maxPrice && { price: { lte: options.maxPrice } }),
      },
      include: {
        images: { take: 1 },
        seller: {
          include: {
            user: {
              select: {
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        category: true,
      },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    return vectorResults
      .filter((r) => productMap.has(r.id))
      .map((r) => ({
        ...productMap.get(r.id),
        relevanceScore: r.score,
      }));
  }

  async indexProduct(productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });

    if (!product) return;

    await this.embeddingService.createProductEmbedding({
      id: product.id,
      title: product.title,
      description: product.description,
      category: product.category?.name,
      tags: product.tags,
      condition: product.condition,
      price: Number(product.price),
    });

    this.logger.log(`Indexed product: ${productId}`);
  }

  async removeProductFromIndex(productId: string): Promise<void> {
    await this.embeddingService.deleteFromVectorDB(productId);
    this.logger.log(`Removed product from index: ${productId}`);
  }

  async getSimilarProducts(productId: string, limit: number = 10) {
    const results = await this.embeddingService.findSimilarProducts(productId, limit);

    const productIds = results.map((r) => r.id);

    return this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        status: 'ACTIVE',
      },
      include: {
        images: { take: 1 },
        seller: {
          include: {
            user: {
              select: {
                username: true,
                displayName: true,
              },
            },
          },
        },
      },
    });
  }

  private async fallbackTextSearch(query: string, options: any) {
    return this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { tags: { hasSome: query.toLowerCase().split(' ') } },
        ],
        ...(options.categoryId && { categoryId: options.categoryId }),
        ...(options.condition && { condition: options.condition }),
        ...(options.minPrice && { price: { gte: options.minPrice } }),
        ...(options.maxPrice && { price: { lte: options.maxPrice } }),
      },
      take: options.limit || 20,
      include: {
        images: { take: 1 },
        seller: {
          include: {
            user: {
              select: {
                username: true,
                displayName: true,
              },
            },
          },
        },
        category: true,
      },
    });
  }

  private async logGeneration(type: string, input: any, output: any): Promise<void> {
    try {
      await this.prisma.aIGenerationLog.create({
        data: {
          type,
          input: input as any,
          output: output as any,
          model: 'gpt-4-turbo-preview',
          tokensUsed: 0,
          latencyMs: 0,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to log AI generation: ${error.message}`);
    }
  }
}
