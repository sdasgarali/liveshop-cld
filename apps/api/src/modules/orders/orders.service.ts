import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { OrderStatus, PaymentStatus, ProductStatus, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, createOrderDto: CreateOrderDto) {
    const { items, addressId, notes } = createOrderDto;

    // Validate address
    if (addressId) {
      const address = await this.prisma.address.findFirst({
        where: { id: addressId, userId },
      });

      if (!address) {
        throw new BadRequestException('Invalid shipping address');
      }
    }

    // Fetch products and validate
    const productIds = items.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        status: ProductStatus.ACTIVE,
      },
      include: {
        seller: true,
      },
    });

    if (products.length !== items.length) {
      throw new BadRequestException('One or more products are not available');
    }

    // Validate quantities
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) {
        throw new BadRequestException(`Product ${item.productId} not found`);
      }
      if (product.quantity < item.quantity) {
        throw new BadRequestException(
          `Insufficient quantity for ${product.title}. Available: ${product.quantity}`,
        );
      }
    }

    // Calculate totals
    let subtotal = 0;
    const orderItems: Prisma.OrderItemCreateManyOrderInput[] = [];

    for (const item of items) {
      const product = products.find((p) => p.id === item.productId)!;
      const itemSubtotal = product.price.toNumber() * item.quantity;
      subtotal += itemSubtotal;

      orderItems.push({
        productId: product.id,
        sellerId: product.sellerId,
        title: product.title,
        price: product.price,
        quantity: item.quantity,
        subtotal: itemSubtotal,
        productSnapshot: {
          id: product.id,
          title: product.title,
          price: product.price.toNumber(),
          condition: product.condition,
          sku: product.sku,
        },
      });
    }

    // Calculate shipping and tax (simplified)
    const shippingCost = this.calculateShipping(subtotal);
    const taxAmount = this.calculateTax(subtotal);
    const total = subtotal + shippingCost + taxAmount;

    // Generate order number
    const orderNumber = this.generateOrderNumber();

    // Create order in transaction
    const order = await this.prisma.$transaction(async (tx) => {
      // Create the order
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          userId,
          addressId,
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          subtotal,
          shippingCost,
          taxAmount,
          total,
          currency: 'USD',
          notes,
          items: {
            createMany: {
              data: orderItems,
            },
          },
        },
        include: {
          items: {
            include: {
              product: {
                include: {
                  images: { take: 1 },
                },
              },
            },
          },
          address: true,
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        },
      });

      // Update product quantities
      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            quantity: { decrement: item.quantity },
            status:
              (await tx.product.findUnique({ where: { id: item.productId } }))!
                .quantity - item.quantity <=
              0
                ? ProductStatus.SOLD
                : undefined,
          },
        });
      }

      return newOrder;
    });

    return order;
  }

  async findAll(userId: string, query: OrderQueryDto, isAdmin = false) {
    const {
      page = 1,
      limit = 20,
      status,
      paymentStatus,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      ...(isAdmin ? {} : { userId }),
      ...(status && { status }),
      ...(paymentStatus && { paymentStatus }),
      ...(startDate && { createdAt: { gte: new Date(startDate) } }),
      ...(endDate && {
        createdAt: { ...((where as any)?.createdAt || {}), lte: new Date(endDate) },
      }),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          items: {
            include: {
              product: {
                include: {
                  images: { take: 1 },
                },
              },
            },
          },
          address: true,
          shipments: true,
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, userId: string, isAdmin = false) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: true,
                seller: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        username: true,
                        displayName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        address: true,
        shipments: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            phone: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!isAdmin && order.userId !== userId) {
      throw new ForbiddenException('You can only view your own orders');
    }

    return order;
  }

  async findByOrderNumber(orderNumber: string, userId: string, isAdmin = false) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: true,
              },
            },
          },
        },
        address: true,
        shipments: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!isAdmin && order.userId !== userId) {
      throw new ForbiddenException('You can only view your own orders');
    }

    return order;
  }

  async updateStatus(
    id: string,
    userId: string,
    updateDto: UpdateOrderStatusDto,
    isAdmin = false,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Only admin or seller can update order status
    if (!isAdmin) {
      const sellerIds = order.items.map((item) => item.sellerId);
      const sellerProfile = await this.prisma.sellerProfile.findUnique({
        where: { userId },
      });

      if (!sellerProfile || !sellerIds.includes(sellerProfile.id)) {
        throw new ForbiddenException('You cannot update this order');
      }
    }

    // Validate status transition
    this.validateStatusTransition(order.status, updateDto.status);

    const updatedOrder = await this.prisma.order.update({
      where: { id },
      data: {
        status: updateDto.status,
        internalNotes: updateDto.internalNotes,
        ...(updateDto.status === OrderStatus.SHIPPED && { shippedAt: new Date() }),
        ...(updateDto.status === OrderStatus.DELIVERED && { deliveredAt: new Date() }),
        ...(updateDto.status === OrderStatus.CANCELLED && { cancelledAt: new Date() }),
      },
      include: {
        items: true,
        address: true,
        shipments: true,
      },
    });

    return updatedOrder;
  }

  async cancelOrder(id: string, userId: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.userId !== userId) {
      throw new ForbiddenException('You can only cancel your own orders');
    }

    // Can only cancel pending or confirmed orders
    if (![OrderStatus.PENDING, OrderStatus.CONFIRMED].includes(order.status)) {
      throw new BadRequestException('Order cannot be cancelled at this stage');
    }

    // Cancel order and restore product quantities
    const cancelledOrder = await this.prisma.$transaction(async (tx) => {
      // Restore product quantities
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            quantity: { increment: item.quantity },
            status: ProductStatus.ACTIVE,
          },
        });
      }

      // Update order status
      return tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          internalNotes: reason ? `Cancelled by buyer: ${reason}` : 'Cancelled by buyer',
        },
        include: {
          items: true,
        },
      });
    });

    return cancelledOrder;
  }

  async getSellerOrders(userId: string, query: OrderQueryDto) {
    const sellerProfile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!sellerProfile) {
      throw new NotFoundException('Seller profile not found');
    }

    const { page = 1, limit = 20, status, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      items: {
        some: {
          sellerId: sellerProfile.id,
        },
      },
      ...(status && { status }),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          items: {
            where: { sellerId: sellerProfile.id },
            include: {
              product: {
                include: {
                  images: { take: 1 },
                },
              },
            },
          },
          address: true,
          shipments: true,
          user: {
            select: {
              id: true,
              displayName: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getOrderStats(userId: string, isAdmin = false) {
    const where: Prisma.OrderWhereInput = isAdmin ? {} : { userId };

    const [
      totalOrders,
      pendingOrders,
      completedOrders,
      totalRevenue,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.count({
        where: { ...where, status: OrderStatus.PENDING },
      }),
      this.prisma.order.count({
        where: { ...where, status: OrderStatus.DELIVERED },
      }),
      this.prisma.order.aggregate({
        where: { ...where, paymentStatus: PaymentStatus.SUCCEEDED },
        _sum: { total: true },
      }),
      this.prisma.order.findMany({
        where,
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          total: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      totalOrders,
      pendingOrders,
      completedOrders,
      totalRevenue: totalRevenue._sum.total?.toNumber() || 0,
      recentOrders,
    };
  }

  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = uuidv4().substring(0, 4).toUpperCase();
    return `LS-${timestamp}-${random}`;
  }

  private calculateShipping(subtotal: number): number {
    // Simplified shipping calculation
    if (subtotal >= 100) return 0; // Free shipping over $100
    if (subtotal >= 50) return 5.99;
    return 8.99;
  }

  private calculateTax(subtotal: number): number {
    // Simplified tax calculation (8.25%)
    return Math.round(subtotal * 0.0825 * 100) / 100;
  }

  private validateStatusTransition(
    currentStatus: OrderStatus,
    newStatus: OrderStatus,
  ): void {
    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
      [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
      [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
      [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
      [OrderStatus.DELIVERED]: [OrderStatus.REFUNDED, OrderStatus.DISPUTED],
      [OrderStatus.CANCELLED]: [],
      [OrderStatus.REFUNDED]: [],
      [OrderStatus.DISPUTED]: [OrderStatus.REFUNDED],
    };

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${currentStatus} to ${newStatus}`,
      );
    }
  }
}
