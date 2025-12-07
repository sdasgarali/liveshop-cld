import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/services/prisma.service';
import { OpenAIService } from './openai.service';
import { Decimal } from '@prisma/client/runtime/library';

export interface PriceSuggestion {
  suggestedPrice: number;
  priceRange: { min: number; max: number };
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  comparables: {
    title: string;
    soldPrice: number;
    condition: string;
    soldDate: string;
  }[];
  marketTrend: 'rising' | 'stable' | 'falling';
  recommendations: string[];
}

export interface MarketAnalysis {
  averagePrice: number;
  medianPrice: number;
  priceRange: { min: number; max: number };
  salesVelocity: string;
  demandLevel: 'high' | 'medium' | 'low';
  competitorCount: number;
  seasonalityNote?: string;
}

@Injectable()
export class PricingIntelligenceService {
  private readonly logger = new Logger(PricingIntelligenceService.name);

  constructor(
    private prisma: PrismaService,
    private openai: OpenAIService,
  ) {}

  async getSuggestedPrice(product: {
    title: string;
    description: string;
    condition: string;
    categoryId?: string;
  }): Promise<PriceSuggestion> {
    const comparables = await this.findComparables(product);
    const marketData = await this.getMarketData(product.categoryId);

    if (comparables.length === 0) {
      return this.generateAIPriceSuggestion(product, null);
    }

    const prompt = `Analyze pricing for this product:

Product:
- Title: ${product.title}
- Description: ${product.description}
- Condition: ${product.condition}

Comparable Sales:
${JSON.stringify(comparables, null, 2)}

Market Data:
${JSON.stringify(marketData, null, 2)}

Provide JSON response:
{
  "suggestedPrice": number,
  "priceRange": {"min": number, "max": number},
  "confidence": "high/medium/low",
  "reasoning": "explanation of pricing logic",
  "marketTrend": "rising/stable/falling",
  "recommendations": ["pricing tips"]
}`;

    const aiSuggestion = await this.openai.chatWithJson<Omit<PriceSuggestion, 'comparables'>>(
      [
        { role: 'system', content: 'You are a pricing analyst for collectibles and vintage items.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.4 },
    );

    return {
      ...aiSuggestion,
      comparables: comparables.slice(0, 5).map((c) => ({
        title: c.title,
        soldPrice: Number(c.price),
        condition: c.condition,
        soldDate: c.updatedAt.toISOString().split('T')[0],
      })),
    };
  }

  async getMarketAnalysis(categoryId: string): Promise<MarketAnalysis> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const soldProducts = await this.prisma.product.findMany({
      where: {
        categoryId,
        status: 'SOLD',
        updatedAt: { gte: thirtyDaysAgo },
      },
      select: { price: true },
      orderBy: { price: 'asc' },
    });

    const activeProducts = await this.prisma.product.count({
      where: {
        categoryId,
        status: 'ACTIVE',
      },
    });

    if (soldProducts.length === 0) {
      return {
        averagePrice: 0,
        medianPrice: 0,
        priceRange: { min: 0, max: 0 },
        salesVelocity: 'unknown',
        demandLevel: 'low',
        competitorCount: activeProducts,
      };
    }

    const prices = soldProducts.map((p) => Number(p.price));
    const sum = prices.reduce((a, b) => a + b, 0);
    const avg = sum / prices.length;
    const median = prices[Math.floor(prices.length / 2)];

    const salesVelocity = prices.length > 20 ? 'high' : prices.length > 10 ? 'medium' : 'low';
    const demandLevel = prices.length > 15 ? 'high' : prices.length > 5 ? 'medium' : 'low';

    return {
      averagePrice: Math.round(avg * 100) / 100,
      medianPrice: median,
      priceRange: { min: prices[0], max: prices[prices.length - 1] },
      salesVelocity,
      demandLevel,
      competitorCount: activeProducts,
    };
  }

  async getBidSuggestion(product: {
    title: string;
    condition: string;
    currentBid?: number;
    bidCount?: number;
  }): Promise<{
    suggestedStartingBid: number;
    suggestedBidIncrement: number;
    expectedFinalPrice: { min: number; max: number };
    tips: string[];
  }> {
    const comparables = await this.findComparables(product);

    const prompt = `Suggest auction bidding strategy:

Product:
- Title: ${product.title}
- Condition: ${product.condition}
${product.currentBid ? `- Current bid: $${product.currentBid}` : ''}
${product.bidCount ? `- Bid count: ${product.bidCount}` : ''}

Comparable Sales:
${JSON.stringify(comparables.slice(0, 5), null, 2)}

Provide JSON:
{
  "suggestedStartingBid": number,
  "suggestedBidIncrement": number,
  "expectedFinalPrice": {"min": number, "max": number},
  "tips": ["bidding tips"]
}`;

    return this.openai.chatWithJson(
      [
        { role: 'system', content: 'You are an auction pricing strategist.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.5 },
    );
  }

  async trackPriceHistory(productId: string): Promise<{
    currentPrice: number;
    priceChanges: { date: string; price: number }[];
    trend: 'up' | 'down' | 'stable';
    recommendation: string;
  }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new Error('Product not found');
    }

    return {
      currentPrice: Number(product.price),
      priceChanges: [
        { date: product.createdAt.toISOString(), price: Number(product.price) },
      ],
      trend: 'stable',
      recommendation: 'Price has remained stable since listing.',
    };
  }

  private async findComparables(product: {
    title: string;
    condition?: string;
    categoryId?: string;
  }) {
    const keywords = product.title
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);

    return this.prisma.product.findMany({
      where: {
        status: 'SOLD',
        ...(product.categoryId && { categoryId: product.categoryId }),
        OR: keywords.map((keyword) => ({
          title: { contains: keyword, mode: 'insensitive' as const },
        })),
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        title: true,
        price: true,
        condition: true,
        updatedAt: true,
      },
    });
  }

  private async getMarketData(categoryId?: string) {
    if (!categoryId) return null;
    return this.getMarketAnalysis(categoryId);
  }

  private async generateAIPriceSuggestion(
    product: { title: string; description: string; condition: string },
    marketData: any,
  ): Promise<PriceSuggestion> {
    const prompt = `Estimate pricing for this product with limited comparable data:

Product:
- Title: ${product.title}
- Description: ${product.description}
- Condition: ${product.condition}

Provide your best estimate based on general market knowledge:
{
  "suggestedPrice": number,
  "priceRange": {"min": number, "max": number},
  "confidence": "low",
  "reasoning": "explanation",
  "marketTrend": "stable",
  "recommendations": ["pricing tips"]
}`;

    const suggestion = await this.openai.chatWithJson<Omit<PriceSuggestion, 'comparables'>>(
      [
        { role: 'system', content: 'You are a pricing expert for collectibles.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.5 },
    );

    return {
      ...suggestion,
      confidence: 'low',
      comparables: [],
    };
  }
}
