import { Module } from '@nestjs/common';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { OpenAIService } from './services/openai.service';
import { EmbeddingService } from './services/embedding.service';
import { ProductDescriptionService } from './services/product-description.service';
import { PricingIntelligenceService } from './services/pricing-intelligence.service';
import { ModerationService } from './services/moderation.service';
import { SellerAssistantService } from './services/seller-assistant.service';

@Module({
  controllers: [AIController],
  providers: [
    AIService,
    OpenAIService,
    EmbeddingService,
    ProductDescriptionService,
    PricingIntelligenceService,
    ModerationService,
    SellerAssistantService,
  ],
  exports: [
    AIService,
    EmbeddingService,
    ProductDescriptionService,
    PricingIntelligenceService,
    ModerationService,
    SellerAssistantService,
  ],
})
export class AIModule {}
