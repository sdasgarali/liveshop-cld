import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  RawBodyRequest,
  Req,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { PayoutService } from './services/payout.service';
import { WebhookService } from './services/webhook.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { RefundDto } from './dto/refund.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly payoutService: PayoutService,
    private readonly webhookService: WebhookService,
  ) {}

  // Payment Intents
  @Post('intent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a payment intent for an order' })
  async createPaymentIntent(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.paymentsService.createPaymentIntent(userId, dto);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm a payment' })
  async confirmPayment(
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.paymentsService.confirmPayment(
      userId,
      dto.paymentIntentId,
      dto.paymentMethodId,
    );
  }

  // Payment Methods
  @Get('methods')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get saved payment methods' })
  async getPaymentMethods(@CurrentUser('id') userId: string) {
    return this.paymentsService.getPaymentMethods(userId);
  }

  @Post('methods')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a payment method' })
  async addPaymentMethod(
    @CurrentUser('id') userId: string,
    @Body('paymentMethodId') paymentMethodId: string,
  ) {
    return this.paymentsService.addPaymentMethod(userId, paymentMethodId);
  }

  @Delete('methods/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a payment method' })
  async removePaymentMethod(
    @CurrentUser('id') userId: string,
    @Param('id') paymentMethodId: string,
  ) {
    return this.paymentsService.removePaymentMethod(userId, paymentMethodId);
  }

  @Post('methods/:id/default')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set default payment method' })
  async setDefaultPaymentMethod(
    @CurrentUser('id') userId: string,
    @Param('id') paymentMethodId: string,
  ) {
    return this.paymentsService.setDefaultPaymentMethod(userId, paymentMethodId);
  }

  // Seller Stripe Connect
  @Post('seller/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe Connect account for seller' })
  async createSellerAccount(@CurrentUser('id') userId: string) {
    return this.paymentsService.createSellerAccount(userId);
  }

  @Get('seller/onboarding')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Stripe onboarding link' })
  async getOnboardingLink(@CurrentUser('id') userId: string) {
    return this.paymentsService.getSellerOnboardingLink(userId);
  }

  @Get('seller/dashboard')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Stripe dashboard link' })
  async getDashboardLink(@CurrentUser('id') userId: string) {
    return this.paymentsService.getSellerDashboardLink(userId);
  }

  @Get('seller/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Stripe account status' })
  async getAccountStatus(@CurrentUser('id') userId: string) {
    return this.paymentsService.getSellerAccountStatus(userId);
  }

  // Seller Payouts
  @Get('seller/balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get seller payout balance' })
  async getPayoutBalance(@CurrentUser('id') userId: string) {
    const seller = await this.getSellerProfile(userId);
    return this.payoutService.getPayoutBalance(seller.id);
  }

  @Get('seller/earnings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get seller earnings' })
  async getEarnings(
    @CurrentUser('id') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const seller = await this.getSellerProfile(userId);
    return this.payoutService.calculateSellerEarnings(
      seller.id,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('seller/payouts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get payout history' })
  async getPayoutHistory(
    @CurrentUser('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const seller = await this.getSellerProfile(userId);
    return this.payoutService.getPayoutHistory(seller.id, page, limit);
  }

  @Post('seller/payout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate a payout' })
  async initiatePayout(
    @CurrentUser('id') userId: string,
    @Body('amount') amount?: number,
  ) {
    const seller = await this.getSellerProfile(userId);
    return this.payoutService.initiatePayout(seller.id, amount);
  }

  // Refunds
  @Post('refund')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Process a refund' })
  async processRefund(
    @CurrentUser('id') userId: string,
    @Body() dto: RefundDto,
  ) {
    return this.paymentsService.processRefund(
      userId,
      dto.orderId,
      dto.amount,
      dto.reason,
    );
  }

  // Webhooks
  @Post('webhook')
  @Public()
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.webhookService.handleWebhook(req.rawBody!, signature);
  }

  private async getSellerProfile(userId: string) {
    const { PrismaService } = await import('../../common/prisma.service');
    const prisma = new PrismaService();
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new Error('Seller profile not found');
    }

    return seller;
  }
}
