import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/services/prisma.service';
import { OpenAIService } from './openai.service';

export interface GeneratedProductContent {
  title: string;
  description: string;
  tags: string[];
  seoKeywords: string[];
  highlights: string[];
}

@Injectable()
export class ProductDescriptionService {
  private readonly logger = new Logger(ProductDescriptionService.name);

  constructor(
    private prisma: PrismaService,
    private openai: OpenAIService,
  ) {}

  async generateFromImage(
    imageUrl: string,
    context?: {
      category?: string;
      condition?: string;
      sellerNotes?: string;
    },
  ): Promise<GeneratedProductContent> {
    const visionPrompt = `Analyze this product image and provide detailed information about the item.
Consider:
- What is this item? Be specific about brand, model, type
- What condition does it appear to be in?
- What are notable features or characteristics?
- What category does it belong to?
- Who would be interested in buying this?

${context?.category ? `Category hint: ${context.category}` : ''}
${context?.condition ? `Condition: ${context.condition}` : ''}
${context?.sellerNotes ? `Seller notes: ${context.sellerNotes}` : ''}

Provide a JSON response:
{
  "title": "compelling product title (max 80 chars)",
  "description": "detailed description (2-4 paragraphs)",
  "tags": ["relevant", "search", "tags"],
  "seoKeywords": ["seo", "keywords"],
  "highlights": ["key feature 1", "key feature 2"]
}`;

    const imageAnalysis = await this.openai.analyzeImage(imageUrl, visionPrompt);

    try {
      return JSON.parse(imageAnalysis);
    } catch {
      return this.generateFromText({
        rawDescription: imageAnalysis,
        category: context?.category,
        condition: context?.condition,
      });
    }
  }

  async generateFromText(input: {
    rawDescription: string;
    category?: string;
    condition?: string;
    brand?: string;
  }): Promise<GeneratedProductContent> {
    const prompt = `Transform this raw product information into a professional listing:

Raw Description: ${input.rawDescription}
${input.category ? `Category: ${input.category}` : ''}
${input.condition ? `Condition: ${input.condition}` : ''}
${input.brand ? `Brand: ${input.brand}` : ''}

Create an engaging, professional product listing. The description should:
- Highlight key features and benefits
- Use bullet points for scanability
- Include condition details
- Be SEO-friendly

Provide JSON response:
{
  "title": "compelling title (max 80 chars)",
  "description": "formatted description with paragraphs",
  "tags": ["relevant", "tags", "for", "search"],
  "seoKeywords": ["seo", "keywords"],
  "highlights": ["key selling point 1", "point 2", "point 3"]
}`;

    return this.openai.chatWithJson<GeneratedProductContent>(
      [
        {
          role: 'system',
          content: 'You are an expert e-commerce copywriter specializing in collectibles and vintage items.',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.7 },
    );
  }

  async improveDescription(
    currentTitle: string,
    currentDescription: string,
    feedback?: string,
  ): Promise<GeneratedProductContent> {
    const prompt = `Improve this product listing${feedback ? ' based on the feedback' : ''}:

Current Title: ${currentTitle}
Current Description: ${currentDescription}
${feedback ? `Feedback: ${feedback}` : ''}

Make it more engaging and likely to sell. Provide JSON response:
{
  "title": "improved title",
  "description": "improved description",
  "tags": ["suggested", "tags"],
  "seoKeywords": ["keywords"],
  "highlights": ["selling points"]
}`;

    return this.openai.chatWithJson<GeneratedProductContent>(
      [
        { role: 'system', content: 'You are an e-commerce optimization expert.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.7 },
    );
  }

  async generateTags(
    title: string,
    description: string,
    category?: string,
  ): Promise<string[]> {
    const prompt = `Generate relevant search tags for this product:

Title: ${title}
Description: ${description}
${category ? `Category: ${category}` : ''}

Provide 10-15 relevant tags that buyers might search for. Include:
- Category terms
- Brand names
- Descriptive terms
- Condition-related terms
- Material/type terms

Return as JSON array of strings.`;

    return this.openai.chatWithJson<string[]>(
      [
        { role: 'system', content: 'You are an SEO and product tagging expert.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.5 },
    );
  }

  async extractProductInfo(text: string): Promise<{
    title: string;
    brand?: string;
    model?: string;
    condition?: string;
    features: string[];
    estimatedCategory: string;
  }> {
    const prompt = `Extract structured product information from this text:

"${text}"

Provide JSON response:
{
  "title": "extracted or inferred product title",
  "brand": "brand if mentioned",
  "model": "model if mentioned",
  "condition": "condition if mentioned (NEW, LIKE_NEW, EXCELLENT, GOOD, FAIR, POOR)",
  "features": ["list of features mentioned"],
  "estimatedCategory": "best guess at product category"
}`;

    return this.openai.chatWithJson(
      [
        { role: 'system', content: 'You are a product information extraction expert.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3 },
    );
  }
}
