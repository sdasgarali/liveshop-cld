import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma.service';
import { StripeService } from './services/stripe.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentStatus, OrderStatus } from '@prisma/client';

@Injectable()
export class PaymentsService {
  private readonly frontendUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  }

  async createPaymentIntent(userId: string, dto: CreatePaymentIntentDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: {
        items: {
          include: {
            product: {
              include: { seller: true },
            },
          },
        },
        user: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.userId !== userId) {
      throw new BadRequestException('Order does not belong to you');
    }

    if (order.paymentStatus !== PaymentStatus.PENDING) {
      throw new BadRequestException('Order is not pending payment');
    }

    // Get or create Stripe customer
    let stripeCustomerId = await this.getOrCreateStripeCustomer(userId);

    // Calculate platform fee (10%)
    const platformFee = order.total.toNumber() * 0.10;

    // Get seller's Stripe account for direct transfer
    const seller = order.items[0]?.product?.seller;
    const transferData = seller?.stripeAccountId
      ? { destination: seller.stripeAccountId }
      : undefined;

    // Create payment intent
    const paymentIntent = await this.stripeService.createPaymentIntent({
      amount: order.total.toNumber(),
      customerId: stripeCustomerId,
      paymentMethodId: dto.paymentMethodId,
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId,
      },
      applicationFeeAmount: transferData ? platformFee : undefined,
      transferData,
    });

    // Update order with payment intent
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        stripePaymentId: paymentIntent.id,
        paymentStatus: PaymentStatus.PROCESSING,
      },
    });

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  }

  async confirmPayment(userId: string, paymentIntentId: string, paymentMethodId?: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        stripePaymentId: paymentIntentId,
        userId,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const paymentIntent = await this.stripeService.confirmPaymentIntent(
      paymentIntentId,
      paymentMethodId,
    );

    if (paymentIntent.status === 'succeeded') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.SUCCEEDED,
          status: OrderStatus.CONFIRMED,
          stripeChargeId: paymentIntent.latest_charge as string,
        },
      });
    }

    return {
      status: paymentIntent.status,
      orderId: order.id,
    };
  }

  async getPaymentMethods(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { paymentMethods: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.paymentMethods;
  }

  async addPaymentMethod(userId: string, paymentMethodId: string) {
    const stripeCustomerId = await this.getOrCreateStripeCustomer(userId);

    const paymentMethod = await this.stripeService.attachPaymentMethod(
      paymentMethodId,
      stripeCustomerId,
    );

    // Save to database
    const savedMethod = await this.prisma.paymentMethod.create({
      data: {
        userId,
        stripePaymentId: paymentMethod.id,
        type: paymentMethod.type,
        brand: paymentMethod.card?.brand,
        last4: paymentMethod.card?.last4,
        expiryMonth: paymentMethod.card?.exp_month,
        expiryYear: paymentMethod.card?.exp_year,
        isDefault: false,
      },
    });

    return savedMethod;
  }

  async removePaymentMethod(userId: string, paymentMethodId: string) {
    const paymentMethod = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, userId },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    await this.stripeService.detachPaymentMethod(paymentMethod.stripePaymentId);

    await this.prisma.paymentMethod.delete({
      where: { id: paymentMethodId },
    });

    return { message: 'Payment method removed' };
  }

  async setDefaultPaymentMethod(userId: string, paymentMethodId: string) {
    const paymentMethod = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, userId },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    // Remove default from all other methods
    await this.prisma.paymentMethod.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    // Set this one as default
    await this.prisma.paymentMethod.update({
      where: { id: paymentMethodId },
      data: { isDefault: true },
    });

    return { message: 'Default payment method updated' };
  }

  // Stripe Connect for Sellers
  async createSellerAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { sellerProfile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.sellerProfile) {
      throw new BadRequestException('User does not have a seller profile');
    }

    if (user.sellerProfile.stripeAccountId) {
      throw new BadRequestException('Stripe account already exists');
    }

    // Create connected account
    const account = await this.stripeService.createConnectedAccount({
      email: user.email,
      metadata: {
        userId,
        sellerId: user.sellerProfile.id,
      },
    });

    // Save account ID
    await this.prisma.sellerProfile.update({
      where: { id: user.sellerProfile.id },
      data: { stripeAccountId: account.id },
    });

    // Create onboarding link
    const accountLink = await this.stripeService.createAccountLink(
      account.id,
      `${this.frontendUrl}/seller/stripe/refresh`,
      `${this.frontendUrl}/seller/stripe/complete`,
    );

    return {
      accountId: account.id,
      onboardingUrl: accountLink.url,
    };
  }

  async getSellerOnboardingLink(userId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller?.stripeAccountId) {
      throw new BadRequestException('No Stripe account found');
    }

    const accountLink = await this.stripeService.createAccountLink(
      seller.stripeAccountId,
      `${this.frontendUrl}/seller/stripe/refresh`,
      `${this.frontendUrl}/seller/stripe/complete`,
    );

    return { onboardingUrl: accountLink.url };
  }

  async getSellerDashboardLink(userId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller?.stripeAccountId) {
      throw new BadRequestException('No Stripe account found');
    }

    const loginLink = await this.stripeService.createLoginLink(seller.stripeAccountId);

    return { dashboardUrl: loginLink.url };
  }

  async getSellerAccountStatus(userId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    if (!seller.stripeAccountId) {
      return {
        hasAccount: false,
        isOnboarded: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      };
    }

    const account = await this.stripeService.getAccount(seller.stripeAccountId);

    // Update onboarding status
    const isOnboarded =
      account.charges_enabled &&
      account.payouts_enabled &&
      account.details_submitted;

    if (seller.stripeOnboarded !== isOnboarded) {
      await this.prisma.sellerProfile.update({
        where: { id: seller.id },
        data: { stripeOnboarded: isOnboarded },
      });
    }

    return {
      hasAccount: true,
      isOnboarded,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    };
  }

  async processRefund(userId: string, orderId: string, amount?: number, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!order.stripePaymentId) {
      throw new BadRequestException('Order has no associated payment');
    }

    // Create refund
    const refund = await this.stripeService.createRefund({
      paymentIntentId: order.stripePaymentId,
      amount,
      reason: reason as any,
    });

    // Update order status
    const isFullRefund = !amount || amount >= order.total.toNumber();

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: isFullRefund
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED,
        status: isFullRefund ? OrderStatus.REFUNDED : order.status,
        internalNotes: `Refunded: ${reason || 'No reason provided'}`,
      },
    });

    return {
      refundId: refund.id,
      amount: refund.amount / 100,
      status: refund.status,
    };
  }

  private async getOrCreateStripeCustomer(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if we have a customer ID stored (you might want to add this field to User model)
    // For now, we'll create a new customer each time or use metadata to track
    const customer = await this.stripeService.createCustomer(
      user.email,
      user.displayName || undefined,
      { userId },
    );

    return customer.id;
  }
}
