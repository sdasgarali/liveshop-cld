import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';

@Injectable()
export class OrderItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async getItemsBySeller(sellerId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.orderItem.findMany({
        where: { sellerId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            include: {
              user: {
                select: {
                  id: true,
                  displayName: true,
                  email: true,
                },
              },
              address: true,
            },
          },
          product: {
            include: {
              images: { take: 1 },
            },
          },
        },
      }),
      this.prisma.orderItem.count({ where: { sellerId } }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSellerStats(sellerId: string) {
    const [
      totalItems,
      totalRevenue,
      recentItems,
      topProducts,
    ] = await Promise.all([
      this.prisma.orderItem.count({ where: { sellerId } }),
      this.prisma.orderItem.aggregate({
        where: { sellerId },
        _sum: { subtotal: true },
      }),
      this.prisma.orderItem.findMany({
        where: { sellerId },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            select: { title: true },
          },
          order: {
            select: { orderNumber: true, status: true },
          },
        },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        where: { sellerId },
        _sum: { quantity: true, subtotal: true },
        orderBy: { _sum: { subtotal: 'desc' } },
        take: 5,
      }),
    ]);

    // Get product details for top products
    const productIds = topProducts.map((p) => p.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, title: true },
    });

    const topProductsWithDetails = topProducts.map((p) => ({
      ...p,
      product: products.find((prod) => prod.id === p.productId),
    }));

    return {
      totalItems,
      totalRevenue: totalRevenue._sum.subtotal?.toNumber() || 0,
      recentItems,
      topProducts: topProductsWithDetails,
    };
  }
}
