import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

@Injectable()
export class OpenAIService implements OnModuleInit {
  private readonly logger = new Logger(OpenAIService.name);
  private client: OpenAI;
  private defaultModel: string;
  private embeddingModel: string;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('openai.apiKey');

    if (!apiKey) {
      this.logger.warn('OpenAI API key not configured');
      return;
    }

    this.client = new OpenAI({ apiKey });
    this.defaultModel = this.configService.get<string>('openai.model') || 'gpt-4-turbo-preview';
    this.embeddingModel = this.configService.get<string>('openai.embeddingModel') || 'text-embedding-3-small';

    this.logger.log('OpenAI client initialized');
  }

  async chat(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<string> {
    const {
      model = this.defaultModel,
      temperature = 0.7,
      maxTokens = 2000,
      jsonMode = false,
    } = options;

    const startTime = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: messages as ChatCompletionMessageParam[],
        temperature,
        max_tokens: maxTokens,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
      });

      const latency = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || '';

      this.logger.debug(`Chat completion: ${latency}ms, ${response.usage?.total_tokens} tokens`);

      return content;
    } catch (error) {
      this.logger.error(`OpenAI chat error: ${error.message}`);
      throw error;
    }
  }

  async chatWithJson<T>(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<T> {
    const content = await this.chat(messages, { ...options, jsonMode: true });

    try {
      return JSON.parse(content) as T;
    } catch {
      this.logger.error(`Failed to parse JSON response: ${content}`);
      throw new Error('Invalid JSON response from AI');
    }
  }

  async createEmbedding(text: string): Promise<number[]> {
    const startTime = Date.now();

    try {
      const response = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: text.substring(0, 8000),
      });

      const latency = Date.now() - startTime;
      this.logger.debug(`Embedding created: ${latency}ms`);

      return response.data[0].embedding;
    } catch (error) {
      this.logger.error(`OpenAI embedding error: ${error.message}`);
      throw error;
    }
  }

  async createEmbeddings(texts: string[]): Promise<number[][]> {
    const startTime = Date.now();

    try {
      const response = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: texts.map((t) => t.substring(0, 8000)),
      });

      const latency = Date.now() - startTime;
      this.logger.debug(`${texts.length} embeddings created: ${latency}ms`);

      return response.data.map((d) => d.embedding);
    } catch (error) {
      this.logger.error(`OpenAI embeddings error: ${error.message}`);
      throw error;
    }
  }

  async moderateContent(text: string): Promise<{
    flagged: boolean;
    categories: Record<string, boolean>;
    scores: Record<string, number>;
  }> {
    try {
      const response = await this.client.moderations.create({
        input: text,
      });

      const result = response.results[0];

      return {
        flagged: result.flagged,
        categories: result.categories as unknown as Record<string, boolean>,
        scores: result.category_scores as unknown as Record<string, number>,
      };
    } catch (error) {
      this.logger.error(`OpenAI moderation error: ${error.message}`);
      throw error;
    }
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 1000,
      });

      return response.choices[0]?.message?.content || '';
    } catch (error) {
      this.logger.error(`OpenAI vision error: ${error.message}`);
      throw error;
    }
  }

  isConfigured(): boolean {
    return !!this.client;
  }
}
