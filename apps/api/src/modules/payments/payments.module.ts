import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeService } from './services/stripe.service';
import { PayoutService } from './services/payout.service';
import { WebhookService } from './services/webhook.service';
import { PrismaService } from '../../common/prisma.service';

@Module({
  imports: [ConfigModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    StripeService,
    PayoutService,
    WebhookService,
    PrismaService,
  ],
  exports: [PaymentsService, StripeService],
})
export class PaymentsModule {}
