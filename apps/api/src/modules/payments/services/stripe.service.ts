import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private stripe: Stripe;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      console.warn('STRIPE_SECRET_KEY not configured');
    }

    this.stripe = new Stripe(secretKey || 'sk_test_placeholder', {
      apiVersion: '2023-10-16',
    });
  }

  // Customer Management
  async createCustomer(email: string, name?: string, metadata?: Record<string, string>) {
    try {
      return await this.stripe.customers.create({
        email,
        name,
        metadata,
      });
    } catch (error) {
      console.error('Stripe createCustomer error:', error);
      throw new InternalServerErrorException('Failed to create customer');
    }
  }

  async getCustomer(customerId: string) {
    try {
      return await this.stripe.customers.retrieve(customerId);
    } catch (error) {
      console.error('Stripe getCustomer error:', error);
      throw new InternalServerErrorException('Failed to retrieve customer');
    }
  }

  // Payment Methods
  async attachPaymentMethod(paymentMethodId: string, customerId: string) {
    try {
      return await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
    } catch (error) {
      console.error('Stripe attachPaymentMethod error:', error);
      throw new BadRequestException('Failed to attach payment method');
    }
  }

  async listPaymentMethods(customerId: string, type: Stripe.PaymentMethodListParams.Type = 'card') {
    try {
      return await this.stripe.paymentMethods.list({
        customer: customerId,
        type,
      });
    } catch (error) {
      console.error('Stripe listPaymentMethods error:', error);
      throw new InternalServerErrorException('Failed to list payment methods');
    }
  }

  async detachPaymentMethod(paymentMethodId: string) {
    try {
      return await this.stripe.paymentMethods.detach(paymentMethodId);
    } catch (error) {
      console.error('Stripe detachPaymentMethod error:', error);
      throw new InternalServerErrorException('Failed to remove payment method');
    }
  }

  // Payment Intents
  async createPaymentIntent(params: {
    amount: number;
    currency?: string;
    customerId?: string;
    paymentMethodId?: string;
    metadata?: Record<string, string>;
    applicationFeeAmount?: number;
    transferData?: { destination: string };
  }) {
    try {
      const { amount, currency = 'usd', customerId, paymentMethodId, metadata, applicationFeeAmount, transferData } = params;

      return await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        customer: customerId,
        payment_method: paymentMethodId,
        metadata,
        application_fee_amount: applicationFeeAmount ? Math.round(applicationFeeAmount * 100) : undefined,
        transfer_data: transferData,
        automatic_payment_methods: {
          enabled: true,
        },
      });
    } catch (error) {
      console.error('Stripe createPaymentIntent error:', error);
      throw new InternalServerErrorException('Failed to create payment');
    }
  }

  async confirmPaymentIntent(paymentIntentId: string, paymentMethodId?: string) {
    try {
      return await this.stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
      });
    } catch (error) {
      console.error('Stripe confirmPaymentIntent error:', error);
      throw new BadRequestException('Payment confirmation failed');
    }
  }

  async getPaymentIntent(paymentIntentId: string) {
    try {
      return await this.stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      console.error('Stripe getPaymentIntent error:', error);
      throw new InternalServerErrorException('Failed to retrieve payment');
    }
  }

  async cancelPaymentIntent(paymentIntentId: string) {
    try {
      return await this.stripe.paymentIntents.cancel(paymentIntentId);
    } catch (error) {
      console.error('Stripe cancelPaymentIntent error:', error);
      throw new InternalServerErrorException('Failed to cancel payment');
    }
  }

  // Stripe Connect - Connected Accounts
  async createConnectedAccount(params: {
    email: string;
    country?: string;
    businessType?: Stripe.AccountCreateParams.BusinessType;
    metadata?: Record<string, string>;
  }) {
    try {
      const { email, country = 'US', businessType = 'individual', metadata } = params;

      return await this.stripe.accounts.create({
        type: 'express',
        country,
        email,
        business_type: businessType,
        metadata,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
    } catch (error) {
      console.error('Stripe createConnectedAccount error:', error);
      throw new InternalServerErrorException('Failed to create connected account');
    }
  }

  async createAccountLink(accountId: string, refreshUrl: string, returnUrl: string) {
    try {
      return await this.stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });
    } catch (error) {
      console.error('Stripe createAccountLink error:', error);
      throw new InternalServerErrorException('Failed to create account link');
    }
  }

  async getAccount(accountId: string) {
    try {
      return await this.stripe.accounts.retrieve(accountId);
    } catch (error) {
      console.error('Stripe getAccount error:', error);
      throw new InternalServerErrorException('Failed to retrieve account');
    }
  }

  async createLoginLink(accountId: string) {
    try {
      return await this.stripe.accounts.createLoginLink(accountId);
    } catch (error) {
      console.error('Stripe createLoginLink error:', error);
      throw new InternalServerErrorException('Failed to create login link');
    }
  }

  // Transfers & Payouts
  async createTransfer(params: {
    amount: number;
    currency?: string;
    destinationAccount: string;
    metadata?: Record<string, string>;
  }) {
    try {
      const { amount, currency = 'usd', destinationAccount, metadata } = params;

      return await this.stripe.transfers.create({
        amount: Math.round(amount * 100),
        currency,
        destination: destinationAccount,
        metadata,
      });
    } catch (error) {
      console.error('Stripe createTransfer error:', error);
      throw new InternalServerErrorException('Failed to create transfer');
    }
  }

  async getBalance(accountId?: string) {
    try {
      if (accountId) {
        return await this.stripe.balance.retrieve({
          stripeAccount: accountId,
        });
      }
      return await this.stripe.balance.retrieve();
    } catch (error) {
      console.error('Stripe getBalance error:', error);
      throw new InternalServerErrorException('Failed to retrieve balance');
    }
  }

  // Refunds
  async createRefund(params: {
    paymentIntentId?: string;
    chargeId?: string;
    amount?: number;
    reason?: Stripe.RefundCreateParams.Reason;
  }) {
    try {
      return await this.stripe.refunds.create({
        payment_intent: params.paymentIntentId,
        charge: params.chargeId,
        amount: params.amount ? Math.round(params.amount * 100) : undefined,
        reason: params.reason,
      });
    } catch (error) {
      console.error('Stripe createRefund error:', error);
      throw new InternalServerErrorException('Failed to create refund');
    }
  }

  // Webhooks
  constructWebhookEvent(payload: Buffer, signature: string, webhookSecret: string) {
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error) {
      console.error('Stripe webhook error:', error);
      throw new BadRequestException('Invalid webhook signature');
    }
  }
}
