import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma.service';
import { StripeService } from './stripe.service';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import Stripe from 'stripe';

@Injectable()
export class WebhookService {
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {
    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || '';
  }

  async handleWebhook(payload: Buffer, signature: string) {
    const event = this.stripeService.constructWebhookEvent(
      payload,
      signature,
      this.webhookSecret,
    );

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'charge.refunded':
        await this.handleChargeRefunded(event.data.object as Stripe.Charge);
        break;

      case 'account.updated':
        await this.handleAccountUpdated(event.data.object as Stripe.Account);
        break;

      case 'payout.paid':
        await this.handlePayoutPaid(event.data.object as Stripe.Payout);
        break;

      case 'payout.failed':
        await this.handlePayoutFailed(event.data.object as Stripe.Payout);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }

  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    const orderId = paymentIntent.metadata?.orderId;

    if (!orderId) {
      console.warn('Payment intent succeeded without orderId metadata');
      return;
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: PaymentStatus.SUCCEEDED,
        status: OrderStatus.CONFIRMED,
        stripePaymentId: paymentIntent.id,
        stripeChargeId: paymentIntent.latest_charge as string,
      },
    });

    console.log(`Order ${orderId} payment succeeded`);
  }

  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
    const orderId = paymentIntent.metadata?.orderId;

    if (!orderId) {
      console.warn('Payment intent failed without orderId metadata');
      return;
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: PaymentStatus.FAILED,
      },
    });

    console.log(`Order ${orderId} payment failed`);
  }

  private async handleChargeRefunded(charge: Stripe.Charge) {
    const order = await this.prisma.order.findFirst({
      where: { stripeChargeId: charge.id },
    });

    if (!order) {
      console.warn('Charge refunded for unknown order');
      return;
    }

    const isFullRefund = charge.amount_refunded === charge.amount;

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: isFullRefund
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED,
        status: isFullRefund ? OrderStatus.REFUNDED : order.status,
      },
    });

    console.log(`Order ${order.id} refunded (full: ${isFullRefund})`);
  }

  private async handleAccountUpdated(account: Stripe.Account) {
    const seller = await this.prisma.sellerProfile.findFirst({
      where: { stripeAccountId: account.id },
    });

    if (!seller) {
      console.warn('Account updated for unknown seller');
      return;
    }

    const isOnboarded =
      account.charges_enabled &&
      account.payouts_enabled &&
      account.details_submitted;

    await this.prisma.sellerProfile.update({
      where: { id: seller.id },
      data: {
        stripeOnboarded: isOnboarded,
      },
    });

    console.log(`Seller ${seller.id} Stripe account updated (onboarded: ${isOnboarded})`);
  }

  private async handlePayoutPaid(payout: Stripe.Payout) {
    // Update payout status if we track Stripe payouts
    console.log(`Payout ${payout.id} paid`);
  }

  private async handlePayoutFailed(payout: Stripe.Payout) {
    console.log(`Payout ${payout.id} failed: ${payout.failure_message}`);
  }
}
