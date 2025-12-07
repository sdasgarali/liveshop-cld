import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/services/prisma.service';
import { OpenAIService } from './openai.service';

interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: any;
}

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private pinecone: any;
  private indexName: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private openai: OpenAIService,
  ) {}

  async onModuleInit() {
    const apiKey = this.configService.get<string>('pinecone.apiKey');
    this.indexName = this.configService.get<string>('pinecone.indexName') || 'liveshop-products';

    if (!apiKey) {
      this.logger.warn('Pinecone API key not configured');
      return;
    }

    try {
      const { Pinecone } = await import('@pinecone-database/pinecone');
      this.pinecone = new Pinecone({ apiKey });
      this.logger.log('Pinecone client initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize Pinecone: ${error.message}`);
    }
  }

  async createProductEmbedding(product: {
    id: string;
    title: string;
    description: string;
    category?: string;
    tags?: string[];
    condition?: string;
    price?: number;
  }): Promise<number[]> {
    const text = this.buildProductText(product);
    const embedding = await this.openai.createEmbedding(text);

    if (this.pinecone) {
      await this.upsertToVectorDB(product.id, embedding, {
        title: product.title,
        category: product.category,
        condition: product.condition,
        price: product.price,
      });
    }

    return embedding;
  }

  async searchProducts(
    query: string,
    options: {
      limit?: number;
      filter?: Record<string, any>;
      minScore?: number;
    } = {},
  ): Promise<VectorSearchResult[]> {
    const { limit = 20, filter, minScore = 0.7 } = options;

    if (!this.openai.isConfigured()) {
      return this.fallbackSearch(query, limit);
    }

    const queryEmbedding = await this.openai.createEmbedding(query);

    if (this.pinecone) {
      return this.searchPinecone(queryEmbedding, limit, filter, minScore);
    }

    return this.searchPostgresVector(queryEmbedding, limit, minScore);
  }

  private async searchPinecone(
    embedding: number[],
    limit: number,
    filter?: Record<string, any>,
    minScore: number = 0.7,
  ): Promise<VectorSearchResult[]> {
    try {
      const index = this.pinecone.index(this.indexName);

      const results = await index.query({
        vector: embedding,
        topK: limit,
        includeMetadata: true,
        filter,
      });

      return results.matches
        .filter((m: any) => m.score >= minScore)
        .map((match: any) => ({
          id: match.id,
          score: match.score,
          metadata: match.metadata,
        }));
    } catch (error) {
      this.logger.error(`Pinecone search error: ${error.message}`);
      return [];
    }
  }

  private async searchPostgresVector(
    embedding: number[],
    limit: number,
    minScore: number,
  ): Promise<VectorSearchResult[]> {
    const embeddingStr = `[${embedding.join(',')}]`;

    const results = await this.prisma.$queryRaw<
      { id: string; score: number }[]
    >`
      SELECT
        id,
        1 - (embedding <=> ${embeddingStr}::vector) as score
      FROM products
      WHERE embedding IS NOT NULL
        AND status = 'ACTIVE'
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `;

    return results.filter((r) => r.score >= minScore);
  }

  private async fallbackSearch(
    query: string,
    limit: number,
  ): Promise<VectorSearchResult[]> {
    const products = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { tags: { hasSome: query.toLowerCase().split(' ') } },
        ],
      },
      take: limit,
      select: { id: true },
    });

    return products.map((p, i) => ({
      id: p.id,
      score: 1 - i * 0.05,
    }));
  }

  private async upsertToVectorDB(
    id: string,
    embedding: number[],
    metadata: Record<string, any>,
  ): Promise<void> {
    try {
      const index = this.pinecone.index(this.indexName);

      await index.upsert([
        {
          id,
          values: embedding,
          metadata,
        },
      ]);
    } catch (error) {
      this.logger.error(`Failed to upsert to Pinecone: ${error.message}`);
    }
  }

  async deleteFromVectorDB(id: string): Promise<void> {
    if (!this.pinecone) return;

    try {
      const index = this.pinecone.index(this.indexName);
      await index.deleteOne(id);
    } catch (error) {
      this.logger.error(`Failed to delete from Pinecone: ${error.message}`);
    }
  }

  async findSimilarProducts(
    productId: string,
    limit: number = 10,
  ): Promise<VectorSearchResult[]> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { title: true, description: true },
    });

    if (!product) return [];

    const text = `${product.title} ${product.description}`;
    const embedding = await this.openai.createEmbedding(text);

    const results = await this.searchPinecone(embedding, limit + 1, undefined, 0.6);
    return results.filter((r) => r.id !== productId);
  }

  private buildProductText(product: {
    title: string;
    description: string;
    category?: string;
    tags?: string[];
    condition?: string;
  }): string {
    const parts = [
      product.title,
      product.description,
      product.category && `Category: ${product.category}`,
      product.condition && `Condition: ${product.condition}`,
      product.tags?.length && `Tags: ${product.tags.join(', ')}`,
    ].filter(Boolean);

    return parts.join('. ');
  }

  isConfigured(): boolean {
    return this.openai.isConfigured();
  }
}
