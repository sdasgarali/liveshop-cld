import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';

@Injectable()
export class WatchlistService {
  constructor(private readonly prisma: PrismaService) {}

  async addToWatchlist(
    userId: string,
    productId: string,
    options?: { notifyOnDrop?: boolean; notifyOnLive?: boolean },
  ) {
    // Check if product exists
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Check if already in watchlist
    const existing = await this.prisma.watchlistItem.findUnique({
      where: {
        userId_productId: { userId, productId },
      },
    });

    if (existing) {
      throw new ConflictException('Product already in watchlist');
    }

    const watchlistItem = await this.prisma.watchlistItem.create({
      data: {
        userId,
        productId,
        notifyOnDrop: options?.notifyOnDrop ?? true,
        notifyOnLive: options?.notifyOnLive ?? true,
      },
      include: {
        product: {
          include: {
            images: { take: 1 },
            seller: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Update product watch count
    await this.prisma.product.update({
      where: { id: productId },
      data: { watchCount: { increment: 1 } },
    });

    return watchlistItem;
  }

  async removeFromWatchlist(userId: string, productId: string) {
    const watchlistItem = await this.prisma.watchlistItem.findUnique({
      where: {
        userId_productId: { userId, productId },
      },
    });

    if (!watchlistItem) {
      throw new NotFoundException('Product not in watchlist');
    }

    await this.prisma.watchlistItem.delete({
      where: { id: watchlistItem.id },
    });

    // Update product watch count
    await this.prisma.product.update({
      where: { id: productId },
      data: { watchCount: { decrement: 1 } },
    });

    return { message: 'Product removed from watchlist' };
  }

  async getWatchlist(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.watchlistItem.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            include: {
              images: { take: 1 },
              category: true,
              seller: {
                include: {
                  user: {
                    select: {
                      id: true,
                      username: true,
                      displayName: true,
                      avatarUrl: true,
                    },
                  },
                },
              },
              _count: {
                select: { bids: true },
              },
            },
          },
        },
      }),
      this.prisma.watchlistItem.count({ where: { userId } }),
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

  async isInWatchlist(userId: string, productId: string): Promise<boolean> {
    const item = await this.prisma.watchlistItem.findUnique({
      where: {
        userId_productId: { userId, productId },
      },
    });

    return !!item;
  }

  async updateNotificationSettings(
    userId: string,
    productId: string,
    settings: { notifyOnDrop?: boolean; notifyOnLive?: boolean },
  ) {
    const watchlistItem = await this.prisma.watchlistItem.findUnique({
      where: {
        userId_productId: { userId, productId },
      },
    });

    if (!watchlistItem) {
      throw new NotFoundException('Product not in watchlist');
    }

    return this.prisma.watchlistItem.update({
      where: { id: watchlistItem.id },
      data: settings,
    });
  }

  async getWatchlistProductIds(userId: string): Promise<string[]> {
    const items = await this.prisma.watchlistItem.findMany({
      where: { userId },
      select: { productId: true },
    });

    return items.map((item) => item.productId);
  }
}
