import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { ShippoService } from './services/shippo.service';
import { TrackingService } from './services/tracking.service';
import { PrismaService } from '../../common/prisma.service';

@Module({
  imports: [ConfigModule],
  controllers: [ShippingController],
  providers: [
    ShippingService,
    ShippoService,
    TrackingService,
    PrismaService,
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
