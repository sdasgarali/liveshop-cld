import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/services/prisma.service';
import { OpenAIService } from './openai.service';

export interface ModerationResult {
  approved: boolean;
  flagged: boolean;
  reasons: string[];
  categories: {
    spam: boolean;
    offensive: boolean;
    prohibited: boolean;
    misleading: boolean;
    copyright: boolean;
  };
  confidence: number;
  suggestedAction: 'approve' | 'review' | 'reject';
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  private readonly prohibitedKeywords = [
    'counterfeit',
    'replica',
    'fake',
    'bootleg',
    'unauthorized copy',
  ];

  private readonly restrictedCategories = [
    'weapons',
    'drugs',
    'tobacco',
    'alcohol',
    'adult content',
  ];

  constructor(
    private prisma: PrismaService,
    private openai: OpenAIService,
  ) {}

  async moderateProductListing(product: {
    title: string;
    description: string;
    category?: string;
    imageUrls?: string[];
  }): Promise<ModerationResult> {
    const textContent = `${product.title} ${product.description}`;

    const [openAIModeration, customModeration] = await Promise.all([
      this.openai.moderateContent(textContent),
      this.customTextModeration(textContent),
    ]);

    let imageModeration = null;
    if (product.imageUrls?.length) {
      imageModeration = await this.moderateImages(product.imageUrls);
    }

    const categories = {
      spam: customModeration.isSpam,
      offensive: openAIModeration.flagged,
      prohibited: customModeration.hasProhibited,
      misleading: customModeration.isMisleading,
      copyright: customModeration.hasCopyrightConcern,
    };

    const flagged = Object.values(categories).some(Boolean) || (imageModeration?.flagged ?? false);
    const reasons: string[] = [];

    if (categories.spam) reasons.push('Content appears to be spam');
    if (categories.offensive) reasons.push('Contains potentially offensive content');
    if (categories.prohibited) reasons.push('Contains prohibited items or keywords');
    if (categories.misleading) reasons.push('May contain misleading claims');
    if (categories.copyright) reasons.push('Potential copyright concerns');
    if (imageModeration?.flagged) reasons.push('Image content flagged for review');

    let suggestedAction: 'approve' | 'review' | 'reject' = 'approve';
    if (categories.prohibited || categories.offensive) {
      suggestedAction = 'reject';
    } else if (flagged) {
      suggestedAction = 'review';
    }

    const confidence = flagged ? 0.7 : 0.9;

    return {
      approved: !flagged,
      flagged,
      reasons,
      categories,
      confidence,
      suggestedAction,
    };
  }

  async moderateChatMessage(message: string, context?: {
    streamId?: string;
    userId?: string;
  }): Promise<{
    allowed: boolean;
    filtered: string;
    reason?: string;
  }> {
    const moderation = await this.openai.moderateContent(message);

    if (moderation.flagged) {
      return {
        allowed: false,
        filtered: '[Message removed]',
        reason: 'Content violates community guidelines',
      };
    }

    const customCheck = this.quickTextCheck(message);
    if (!customCheck.allowed) {
      return customCheck;
    }

    return {
      allowed: true,
      filtered: message,
    };
  }

  async moderateUsername(username: string): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const moderation = await this.openai.moderateContent(username);

    if (moderation.flagged) {
      return {
        allowed: false,
        reason: 'Username contains inappropriate content',
      };
    }

    const reservedWords = ['admin', 'moderator', 'support', 'official', 'liveshop'];
    const lowerUsername = username.toLowerCase();

    if (reservedWords.some((word) => lowerUsername.includes(word))) {
      return {
        allowed: false,
        reason: 'Username contains reserved words',
      };
    }

    return { allowed: true };
  }

  async moderateImages(imageUrls: string[]): Promise<{
    flagged: boolean;
    results: { url: string; safe: boolean; reason?: string }[];
  }> {
    const results = await Promise.all(
      imageUrls.slice(0, 5).map(async (url) => {
        try {
          const analysis = await this.openai.analyzeImage(
            url,
            `Analyze this image for a marketplace listing. Check for:
1. Prohibited items (weapons, drugs, counterfeit goods)
2. Adult or explicit content
3. Offensive symbols or imagery
4. Copyright infringement indicators

Respond with JSON: {"safe": boolean, "reason": "explanation if not safe"}`,
          );

          const parsed = JSON.parse(analysis);
          return { url, ...parsed };
        } catch {
          return { url, safe: true };
        }
      }),
    );

    return {
      flagged: results.some((r) => !r.safe),
      results,
    };
  }

  async getReportedContent(options: {
    page?: number;
    limit?: number;
    status?: 'pending' | 'reviewed' | 'actioned';
  }) {
    return {
      data: [],
      pagination: {
        page: options.page || 1,
        limit: options.limit || 20,
        total: 0,
        totalPages: 0,
      },
    };
  }

  private async customTextModeration(text: string): Promise<{
    isSpam: boolean;
    hasProhibited: boolean;
    isMisleading: boolean;
    hasCopyrightConcern: boolean;
  }> {
    const lowerText = text.toLowerCase();

    const hasProhibited = this.prohibitedKeywords.some((keyword) =>
      lowerText.includes(keyword),
    );

    const isSpam = this.detectSpam(text);
    const isMisleading = this.detectMisleadingClaims(text);
    const hasCopyrightConcern = this.detectCopyrightConcerns(text);

    return {
      isSpam,
      hasProhibited,
      isMisleading,
      hasCopyrightConcern,
    };
  }

  private quickTextCheck(text: string): {
    allowed: boolean;
    filtered: string;
    reason?: string;
  } {
    const lowerText = text.toLowerCase();

    if (this.prohibitedKeywords.some((k) => lowerText.includes(k))) {
      return {
        allowed: false,
        filtered: '[Message removed]',
        reason: 'Contains prohibited content',
      };
    }

    const urlPattern = /(https?:\/\/[^\s]+)/gi;
    if (urlPattern.test(text)) {
      return {
        allowed: false,
        filtered: text.replace(urlPattern, '[link removed]'),
        reason: 'External links not allowed in chat',
      };
    }

    return { allowed: true, filtered: text };
  }

  private detectSpam(text: string): boolean {
    const patterns = [
      /buy\s+now/i,
      /limited\s+time/i,
      /act\s+fast/i,
      /\$\$\$/,
      /free\s+money/i,
      /click\s+here/i,
    ];

    const repetitionPattern = /(.)\1{4,}/;

    if (repetitionPattern.test(text)) return true;

    const matchCount = patterns.filter((p) => p.test(text)).length;
    return matchCount >= 2;
  }

  private detectMisleadingClaims(text: string): boolean {
    const patterns = [
      /guaranteed\s+(authentic|genuine)/i,
      /100%\s+real/i,
      /definitely\s+worth/i,
      /will\s+sell\s+out/i,
      /extremely\s+rare/i,
    ];

    return patterns.some((p) => p.test(text));
  }

  private detectCopyrightConcerns(text: string): boolean {
    const patterns = [
      /disney/i,
      /marvel/i,
      /nfl/i,
      /nba/i,
      /mlb/i,
      /supreme/i,
      /louis\s+vuitton/i,
      /gucci/i,
      /rolex/i,
    ];

    const hasTrademarks = patterns.some((p) => p.test(text));
    const hasWarningPhrases = /not\s+affiliated|unofficial|fan\s+made/i.test(text);

    return hasTrademarks && !hasWarningPhrases;
  }
}
