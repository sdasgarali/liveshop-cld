import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderItemsService } from './services/order-items.service';
import { InvoiceService } from './services/invoice.service';
import { PrismaService } from '../../common/prisma.service';

@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderItemsService,
    InvoiceService,
    PrismaService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
