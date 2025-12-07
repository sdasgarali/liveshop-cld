import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/services/prisma.service';
import { OpenAIService, ChatMessage } from './openai.service';

export interface SellerInsights {
  summary: string;
  recommendations: string[];
  topPerformingProducts: string[];
  improvementAreas: string[];
  suggestedActions: {
    action: string;
    priority: 'high' | 'medium' | 'low';
    expectedImpact: string;
  }[];
}

export interface StreamSuggestions {
  optimalTimes: string[];
  suggestedProducts: string[];
  pricingTips: string[];
  engagementTips: string[];
}

export interface ChatResponse {
  message: string;
  suggestions?: string[];
  data?: any;
}

@Injectable()
export class SellerAssistantService {
  private readonly logger = new Logger(SellerAssistantService.name);

  private readonly systemPrompt = `You are an AI assistant for sellers on LiveShop, a live shopping marketplace similar to Whatnot.
Your role is to help sellers optimize their listings, improve their streaming performance, and grow their business.

You have access to the seller's data including:
- Product listings and performance
- Stream history and metrics
- Sales and revenue data
- Customer feedback and reviews

Provide actionable, specific advice based on the data. Be encouraging but honest.
When discussing pricing, consider market conditions and comparable sales.
Format responses in a clear, concise manner suitable for a mobile app.`;

  constructor(
    private prisma: PrismaService,
    private openai: OpenAIService,
  ) {}

  async chat(
    sellerId: string,
    message: string,
    conversationHistory: ChatMessage[] = [],
  ): Promise<ChatResponse> {
    const sellerContext = await this.getSellerContext(sellerId);

    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      {
        role: 'system',
        content: `Current seller context:\n${JSON.stringify(sellerContext, null, 2)}`,
      },
      ...conversationHistory,
      { role: 'user', content: message },
    ];

    const response = await this.openai.chat(messages, {
      temperature: 0.7,
      maxTokens: 1000,
    });

    return {
      message: response,
      suggestions: this.extractSuggestions(response),
    };
  }

  async getInsights(sellerId: string): Promise<SellerInsights> {
    const [profile, products, streams, recentOrders] = await Promise.all([
      this.prisma.sellerProfile.findUnique({
        where: { userId: sellerId },
      }),
      this.prisma.product.findMany({
        where: {
          seller: { userId: sellerId },
        },
        orderBy: { viewCount: 'desc' },
        take: 20,
      }),
      this.prisma.liveStream.findMany({
        where: { hostId: sellerId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.orderItem.findMany({
        where: { sellerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { product: true },
      }),
    ]);

    const analysisPrompt = `Analyze this seller's performance and provide insights:

Seller Profile:
${JSON.stringify(profile, null, 2)}

Top Products (by views):
${JSON.stringify(products.map((p) => ({ title: p.title, views: p.viewCount, status: p.status })), null, 2)}

Recent Streams:
${JSON.stringify(streams.map((s) => ({ title: s.title, viewers: s.peakViewers, revenue: s.totalRevenue, status: s.status })), null, 2)}

Recent Sales:
${JSON.stringify(recentOrders.length)} orders in the recent period

Provide a JSON response with:
{
  "summary": "brief overall performance summary",
  "recommendations": ["actionable recommendation 1", "recommendation 2"],
  "topPerformingProducts": ["product names that are doing well"],
  "improvementAreas": ["areas that need work"],
  "suggestedActions": [
    {"action": "specific action", "priority": "high/medium/low", "expectedImpact": "what this will achieve"}
  ]
}`;

    const insights = await this.openai.chatWithJson<SellerInsights>(
      [
        { role: 'system', content: 'You are a business analytics assistant.' },
        { role: 'user', content: analysisPrompt },
      ],
      { temperature: 0.5 },
    );

    return insights;
  }

  async getStreamSuggestions(sellerId: string): Promise<StreamSuggestions> {
    const [products, pastStreams, followers] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          seller: { userId: sellerId },
          status: 'ACTIVE',
        },
        orderBy: [{ watchCount: 'desc' }, { viewCount: 'desc' }],
        take: 20,
      }),
      this.prisma.liveStream.findMany({
        where: {
          hostId: sellerId,
          status: 'ENDED',
        },
        orderBy: { peakViewers: 'desc' },
        take: 10,
      }),
      this.prisma.follow.count({
        where: { followingId: sellerId },
      }),
    ]);

    const prompt = `Based on this seller's data, suggest optimal streaming strategy:

Available Products:
${JSON.stringify(products.map((p) => ({ title: p.title, price: p.price, watchCount: p.watchCount })), null, 2)}

Past Stream Performance:
${JSON.stringify(pastStreams.map((s) => ({ peakViewers: s.peakViewers, revenue: s.totalRevenue, startedAt: s.startedAt })), null, 2)}

Follower Count: ${followers}

Provide JSON response:
{
  "optimalTimes": ["suggested streaming times based on past performance"],
  "suggestedProducts": ["products to feature based on interest"],
  "pricingTips": ["pricing suggestions for the stream"],
  "engagementTips": ["tips to increase viewer engagement"]
}`;

    return this.openai.chatWithJson<StreamSuggestions>(
      [
        { role: 'system', content: 'You are a live streaming strategy expert.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.6 },
    );
  }

  async suggestListingImprovements(productId: string): Promise<{
    titleSuggestions: string[];
    descriptionSuggestions: string[];
    pricingSuggestion: { suggested: number; reasoning: string };
    tagSuggestions: string[];
  }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        category: true,
        images: true,
      },
    });

    if (!product) {
      throw new Error('Product not found');
    }

    const similarProducts = await this.prisma.product.findMany({
      where: {
        categoryId: product.categoryId,
        status: 'SOLD',
        id: { not: productId },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { title: true, price: true, description: true },
    });

    const prompt = `Analyze this product listing and suggest improvements:

Current Listing:
- Title: ${product.title}
- Description: ${product.description}
- Price: $${product.price}
- Condition: ${product.condition}
- Category: ${product.category?.name}
- Tags: ${product.tags?.join(', ') || 'none'}
- Has ${product.images.length} images

Similar Recently Sold Items:
${JSON.stringify(similarProducts, null, 2)}

Provide JSON response:
{
  "titleSuggestions": ["improved title option 1", "option 2"],
  "descriptionSuggestions": ["key points to add or improve"],
  "pricingSuggestion": {"suggested": number, "reasoning": "explanation"},
  "tagSuggestions": ["relevant tags to add"]
}`;

    return this.openai.chatWithJson(
      [
        { role: 'system', content: 'You are an e-commerce listing optimization expert.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.6 },
    );
  }

  async generateQuickReplies(
    context: string,
    customerMessage: string,
  ): Promise<string[]> {
    const prompt = `Generate 3 professional quick reply options for a seller responding to a customer.

Context: ${context}
Customer message: "${customerMessage}"

Provide JSON array of 3 short, professional responses.`;

    const replies = await this.openai.chatWithJson<string[]>(
      [
        { role: 'system', content: 'You are a customer service assistant.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.7 },
    );

    return replies;
  }

  private async getSellerContext(sellerId: string) {
    const [profile, productCount, activeStreams, recentSales] = await Promise.all([
      this.prisma.sellerProfile.findUnique({
        where: { userId: sellerId },
      }),
      this.prisma.product.count({
        where: { seller: { userId: sellerId } },
      }),
      this.prisma.liveStream.count({
        where: { hostId: sellerId, status: 'LIVE' },
      }),
      this.prisma.orderItem.aggregate({
        where: {
          sellerId,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        _sum: { subtotal: true },
        _count: true,
      }),
    ]);

    return {
      totalProducts: productCount,
      activeStreams,
      last30DaysSales: recentSales._count,
      last30DaysRevenue: recentSales._sum.subtotal || 0,
      rating: profile?.averageRating || 0,
      totalReviews: profile?.totalReviews || 0,
      isVerified: profile?.isVerified || false,
    };
  }

  private extractSuggestions(response: string): string[] {
    const suggestions: string[] = [];
    const lines = response.split('\n');

    for (const line of lines) {
      if (line.match(/^[\-\*\d]\.?\s/)) {
        suggestions.push(line.replace(/^[\-\*\d]\.?\s+/, '').trim());
      }
    }

    return suggestions.slice(0, 5);
  }
}
