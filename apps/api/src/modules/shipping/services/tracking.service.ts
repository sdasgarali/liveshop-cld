import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';
import { ShippoService } from './shippo.service';

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shippoService: ShippoService,
  ) {}

  async getTrackingStatus(orderId: string) {
    const shipments = await this.prisma.shipment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });

    if (shipments.length === 0) {
      return {
        hasShipment: false,
        status: 'NOT_SHIPPED',
        message: 'Order has not been shipped yet',
      };
    }

    const latestShipment = shipments[0];

    if (!latestShipment.trackingNumber) {
      return {
        hasShipment: true,
        status: 'LABEL_CREATED',
        message: 'Shipping label created, awaiting pickup',
        shipment: latestShipment,
      };
    }

    // Get tracking info from carrier
    const trackingInfo = await this.shippoService.getTrackingInfo(
      latestShipment.carrier,
      latestShipment.trackingNumber,
    );

    return {
      hasShipment: true,
      status: trackingInfo.status,
      message: trackingInfo.statusDetails,
      estimatedDelivery: trackingInfo.estimatedDelivery,
      shipment: latestShipment,
      trackingHistory: trackingInfo.history,
    };
  }

  async updateTrackingStatus(shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });

    if (!shipment || !shipment.trackingNumber) {
      return null;
    }

    const trackingInfo = await this.shippoService.getTrackingInfo(
      shipment.carrier,
      shipment.trackingNumber,
    );

    // Update shipment status
    const updatedShipment = await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        status: trackingInfo.status,
        ...(trackingInfo.status === 'DELIVERED' && { deliveredAt: new Date() }),
      },
    });

    // If delivered, update order status
    if (trackingInfo.status === 'DELIVERED') {
      await this.prisma.order.update({
        where: { id: shipment.orderId },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
        },
      });
    }

    return {
      shipment: updatedShipment,
      trackingInfo,
    };
  }

  async getTrackingUrl(carrier: string, trackingNumber: string): string {
    const trackingUrls: Record<string, string> = {
      'USPS': `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
      'UPS': `https://www.ups.com/track?tracknum=${trackingNumber}`,
      'FedEx': `https://www.fedex.com/fedextrack/?tracknumbers=${trackingNumber}`,
      'DHL': `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`,
    };

    return trackingUrls[carrier.toUpperCase()] ||
      `https://www.google.com/search?q=${carrier}+tracking+${trackingNumber}`;
  }
}
