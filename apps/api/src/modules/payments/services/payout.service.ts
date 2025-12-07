import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';
import { StripeService } from './stripe.service';
import { OrderStatus, PaymentStatus } from '@prisma/client';

@Injectable()
export class PayoutService {
  private readonly platformFeePercentage = 0.10; // 10% platform fee

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  async calculateSellerEarnings(sellerId: string, startDate?: Date, endDate?: Date) {
    const where: any = {
      sellerId,
      order: {
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.SUCCEEDED,
      },
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const orderItems = await this.prisma.orderItem.findMany({
      where,
      select: {
        subtotal: true,
      },
    });

    const grossEarnings = orderItems.reduce(
      (sum, item) => sum + item.subtotal.toNumber(),
      0,
    );

    const platformFee = grossEarnings * this.platformFeePercentage;
    const netEarnings = grossEarnings - platformFee;

    return {
      grossEarnings,
      platformFee,
      netEarnings,
      platformFeePercentage: this.platformFeePercentage * 100,
    };
  }

  async getPayoutHistory(sellerId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [payouts, total] = await Promise.all([
      this.prisma.payout.findMany({
        where: { sellerId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payout.count({ where: { sellerId } }),
    ]);

    return {
      data: payouts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPayoutBalance(sellerId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { id: sellerId },
    });

    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    // Calculate pending payout (delivered orders not yet paid out)
    const pendingItems = await this.prisma.orderItem.findMany({
      where: {
        sellerId,
        order: {
          status: OrderStatus.DELIVERED,
          paymentStatus: PaymentStatus.SUCCEEDED,
        },
      },
      select: {
        subtotal: true,
        createdAt: true,
      },
    });

    // Get already paid out amount
    const paidOut = await this.prisma.payout.aggregate({
      where: {
        sellerId,
        status: 'completed',
      },
      _sum: {
        netAmount: true,
      },
    });

    const totalEarned = pendingItems.reduce(
      (sum, item) => sum + item.subtotal.toNumber(),
      0,
    );

    const totalPaidOut = paidOut._sum.netAmount?.toNumber() || 0;
    const platformFees = totalEarned * this.platformFeePercentage;
    const availableBalance = totalEarned - platformFees - totalPaidOut;

    // Get Stripe balance if connected
    let stripeBalance = null;
    if (seller.stripeAccountId) {
      try {
        stripeBalance = await this.stripeService.getBalance(seller.stripeAccountId);
      } catch (error) {
        console.error('Failed to get Stripe balance:', error);
      }
    }

    return {
      totalEarned,
      platformFees,
      totalPaidOut,
      availableBalance,
      stripeBalance: stripeBalance
        ? {
            available: stripeBalance.available.reduce(
              (sum, b) => sum + b.amount / 100,
              0,
            ),
            pending: stripeBalance.pending.reduce(
              (sum, b) => sum + b.amount / 100,
              0,
            ),
          }
        : null,
    };
  }

  async initiatePayout(sellerId: string, amount?: number) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { id: sellerId },
    });

    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    if (!seller.stripeAccountId || !seller.stripeOnboarded) {
      throw new BadRequestException('Stripe account not set up');
    }

    // Get available balance
    const balance = await this.getPayoutBalance(sellerId);

    const payoutAmount = amount || balance.availableBalance;

    if (payoutAmount <= 0) {
      throw new BadRequestException('No available balance for payout');
    }

    if (payoutAmount > balance.availableBalance) {
      throw new BadRequestException('Payout amount exceeds available balance');
    }

    // Calculate fees
    const fee = payoutAmount * this.platformFeePercentage;
    const netAmount = payoutAmount - fee;

    // Create transfer to connected account
    const transfer = await this.stripeService.createTransfer({
      amount: netAmount,
      destinationAccount: seller.stripeAccountId,
      metadata: {
        sellerId,
        type: 'seller_payout',
      },
    });

    // Record payout
    const payout = await this.prisma.payout.create({
      data: {
        sellerId,
        amount: payoutAmount,
        fee,
        netAmount,
        stripePayoutId: transfer.id,
        status: 'completed',
        periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        periodEnd: new Date(),
        processedAt: new Date(),
      },
    });

    // Update seller total revenue
    await this.prisma.sellerProfile.update({
      where: { id: sellerId },
      data: {
        totalRevenue: { increment: netAmount },
      },
    });

    return payout;
  }

  async getPendingPayouts() {
    // Get all sellers with pending balances
    const sellers = await this.prisma.sellerProfile.findMany({
      where: {
        stripeOnboarded: true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });

    const pendingPayouts = await Promise.all(
      sellers.map(async (seller) => {
        const balance = await this.getPayoutBalance(seller.id);
        return {
          sellerId: seller.id,
          sellerName: seller.user.displayName || seller.businessName,
          email: seller.user.email,
          availableBalance: balance.availableBalance,
        };
      }),
    );

    return pendingPayouts.filter((p) => p.availableBalance > 0);
  }
}
