import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { ShippoService } from './services/shippo.service';
import { TrackingService } from './services/tracking.service';
import { GetRatesDto } from './dto/get-rates.dto';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shippoService: ShippoService,
    private readonly trackingService: TrackingService,
  ) {}

  async getShippingRates(dto: GetRatesDto) {
    return this.shippoService.getRates(
      dto.fromAddress,
      dto.toAddress,
      dto.parcel,
    );
  }

  async createShipment(userId: string, dto: CreateShipmentDto) {
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
        address: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Verify user is the seller
    const sellerProfile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!sellerProfile) {
      throw new ForbiddenException('You must be a seller to create shipments');
    }

    const isOrderSeller = order.items.some(
      (item) => item.product.sellerId === sellerProfile.id,
    );

    if (!isOrderSeller) {
      throw new ForbiddenException('You can only ship your own orders');
    }

    // Check order status
    if (![OrderStatus.CONFIRMED, OrderStatus.PROCESSING].includes(order.status)) {
      throw new BadRequestException('Order is not ready for shipping');
    }

    // Purchase label if rate selected
    let label = null;
    if (dto.rateId) {
      label = await this.shippoService.purchaseLabel(dto.rateId);
    }

    // Create shipment record
    const shipment = await this.prisma.shipment.create({
      data: {
        orderId: dto.orderId,
        carrier: dto.carrier || label?.carrier || 'OTHER',
        trackingNumber: dto.trackingNumber || label?.trackingNumber,
        trackingUrl: label?.trackingNumber
          ? await this.trackingService.getTrackingUrl(
              dto.carrier || label.carrier,
              label.trackingNumber,
            )
          : dto.trackingUrl,
        status: 'LABEL_CREATED',
        labelUrl: label?.labelUrl,
        labelCost: label?.cost,
      },
    });

    // Update order status
    await this.prisma.order.update({
      where: { id: dto.orderId },
      data: {
        status: OrderStatus.PROCESSING,
      },
    });

    return shipment;
  }

  async markAsShipped(userId: string, shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order: {
          include: {
            items: {
              include: {
                product: { include: { seller: true } },
              },
            },
          },
        },
      },
    });

    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    // Verify seller
    const sellerProfile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    const isOrderSeller = shipment.order.items.some(
      (item) => item.product.sellerId === sellerProfile?.id,
    );

    if (!isOrderSeller) {
      throw new ForbiddenException('You can only mark your own shipments as shipped');
    }

    // Update shipment
    const updatedShipment = await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        status: 'SHIPPED',
        shippedAt: new Date(),
      },
    });

    // Update order
    await this.prisma.order.update({
      where: { id: shipment.orderId },
      data: {
        status: OrderStatus.SHIPPED,
        shippedAt: new Date(),
      },
    });

    return updatedShipment;
  }

  async getOrderShipments(orderId: string) {
    return this.prisma.shipment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTrackingInfo(orderId: string) {
    return this.trackingService.getTrackingStatus(orderId);
  }

  async refreshTracking(shipmentId: string) {
    return this.trackingService.updateTrackingStatus(shipmentId);
  }

  async validateAddress(address: any) {
    return this.shippoService.validateAddress(address);
  }

  async getSellerShipments(userId: string, page = 1, limit = 20) {
    const sellerProfile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!sellerProfile) {
      throw new NotFoundException('Seller profile not found');
    }

    const skip = (page - 1) * limit;

    const [shipments, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where: {
          order: {
            items: {
              some: {
                sellerId: sellerProfile.id,
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: {
              orderNumber: true,
              user: {
                select: {
                  displayName: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.shipment.count({
        where: {
          order: {
            items: {
              some: {
                sellerId: sellerProfile.id,
              },
            },
          },
        },
      }),
    ]);

    return {
      data: shipments,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
