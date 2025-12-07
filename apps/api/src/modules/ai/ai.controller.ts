import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AIService } from './ai.service';
import { ProductDescriptionService } from './services/product-description.service';
import { PricingIntelligenceService } from './services/pricing-intelligence.service';
import { SellerAssistantService } from './services/seller-assistant.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('ai')
@Controller({ path: 'ai', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AIController {
  constructor(
    private readonly aiService: AIService,
    private readonly descriptionService: ProductDescriptionService,
    private readonly pricingService: PricingIntelligenceService,
    private readonly sellerAssistantService: SellerAssistantService,
  ) {}

  @Post('generate-listing')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Generate product listing from image or description' })
  async generateListing(
    @Body() body: {
      imageUrls?: string[];
      rawDescription?: string;
      category?: string;
      condition?: string;
      sellerNotes?: string;
    },
  ) {
    return this.aiService.generateProductListing(body);
  }

  @Post('improve-listing')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Improve existing product listing' })
  async improveListing(
    @Body() body: {
      title: string;
      description: string;
      feedback?: string;
    },
  ) {
    return this.descriptionService.improveDescription(
      body.title,
      body.description,
      body.feedback,
    );
  }

  @Post('generate-tags')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Generate tags for a product' })
  async generateTags(
    @Body() body: {
      title: string;
      description: string;
      category?: string;
    },
  ) {
    const tags = await this.descriptionService.generateTags(
      body.title,
      body.description,
      body.category,
    );
    return { tags };
  }

  @Post('suggest-price')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get AI-powered price suggestion' })
  async suggestPrice(
    @Body() body: {
      title: string;
      description: string;
      condition: string;
      categoryId?: string;
    },
  ) {
    return this.pricingService.getSuggestedPrice(body);
  }

  @Get('market-analysis/:categoryId')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get market analysis for a category' })
  async getMarketAnalysis(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.pricingService.getMarketAnalysis(categoryId);
  }

  @Get('search')
  @Public()
  @ApiOperation({ summary: 'Semantic product search' })
  async search(
    @Query('q') query: string,
    @Query('limit') limit?: number,
    @Query('categoryId') categoryId?: string,
    @Query('condition') condition?: string,
    @Query('minPrice') minPrice?: number,
    @Query('maxPrice') maxPrice?: number,
  ) {
    return this.aiService.searchProducts(query, {
      limit,
      categoryId,
      condition,
      minPrice,
      maxPrice,
    });
  }

  @Get('similar/:productId')
  @Public()
  @ApiOperation({ summary: 'Find similar products' })
  async findSimilar(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('limit') limit?: number,
  ) {
    return this.aiService.getSimilarProducts(productId, limit);
  }

  @Get('seller-dashboard')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get AI-powered seller dashboard insights' })
  async getSellerDashboard(@CurrentUser('id') sellerId: string) {
    return this.aiService.getSellerDashboard(sellerId);
  }

  @Get('seller-insights')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get detailed seller insights' })
  async getSellerInsights(@CurrentUser('id') sellerId: string) {
    return this.sellerAssistantService.getInsights(sellerId);
  }

  @Get('stream-suggestions')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get AI suggestions for streaming' })
  async getStreamSuggestions(@CurrentUser('id') sellerId: string) {
    return this.sellerAssistantService.getStreamSuggestions(sellerId);
  }

  @Post('assistant/chat')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Chat with seller assistant' })
  async chatWithAssistant(
    @CurrentUser('id') sellerId: string,
    @Body() body: { message: string; conversationId?: string },
  ) {
    return this.aiService.chatWithAssistant(
      sellerId,
      body.message,
      body.conversationId,
    );
  }

  @Get('listing-improvements/:productId')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get improvement suggestions for a listing' })
  async getListingImprovements(
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.sellerAssistantService.suggestListingImprovements(productId);
  }

  @Post('bid-suggestion')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get bidding strategy suggestions' })
  async getBidSuggestion(
    @Body() body: {
      title: string;
      condition: string;
      currentBid?: number;
      bidCount?: number;
    },
  ) {
    return this.pricingService.getBidSuggestion(body);
  }
}
