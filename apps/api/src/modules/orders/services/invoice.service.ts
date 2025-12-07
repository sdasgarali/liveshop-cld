import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';

export interface InvoiceData {
  invoiceNumber: string;
  orderNumber: string;
  createdAt: Date;
  buyer: {
    name: string;
    email: string;
    address?: any;
  };
  seller?: {
    name: string;
    businessName?: string;
  };
  items: {
    title: string;
    quantity: number;
    price: number;
    subtotal: number;
  }[];
  subtotal: number;
  shippingCost: number;
  taxAmount: number;
  total: number;
  currency: string;
  status: string;
  paymentStatus: string;
}

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async generateInvoiceData(orderId: string): Promise<InvoiceData> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: {
            displayName: true,
            email: true,
          },
        },
        address: true,
        items: {
          include: {
            product: {
              include: {
                seller: {
                  include: {
                    user: {
                      select: {
                        displayName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Generate invoice number
    const invoiceNumber = `INV-${order.orderNumber}`;

    // Get seller info (from first item)
    const seller = order.items[0]?.product?.seller;

    return {
      invoiceNumber,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      buyer: {
        name: order.user.displayName || 'Customer',
        email: order.user.email,
        address: order.address,
      },
      seller: seller
        ? {
            name: seller.user.displayName || 'Seller',
            businessName: seller.businessName || undefined,
          }
        : undefined,
      items: order.items.map((item) => ({
        title: item.title,
        quantity: item.quantity,
        price: item.price.toNumber(),
        subtotal: item.subtotal.toNumber(),
      })),
      subtotal: order.subtotal.toNumber(),
      shippingCost: order.shippingCost.toNumber(),
      taxAmount: order.taxAmount.toNumber(),
      total: order.total.toNumber(),
      currency: order.currency,
      status: order.status,
      paymentStatus: order.paymentStatus,
    };
  }

  formatCurrency(amount: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  }

  async getInvoicesByUser(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          total: true,
          status: true,
          paymentStatus: true,
          createdAt: true,
        },
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);

    const invoices = orders.map((order) => ({
      invoiceNumber: `INV-${order.orderNumber}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.total.toNumber(),
      status: order.status,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
    }));

    return {
      data: invoices,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
