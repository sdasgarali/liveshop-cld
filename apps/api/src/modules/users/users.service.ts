import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/common/services/prisma.service';
import { CacheService } from '@/common/services/cache.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserStatus, Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  async findById(id: string): Promise<User> {
    const cached = await this.cache.get<User>('user', id);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        sellerProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.cache.set('user', id, user, 300);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      include: {
        sellerProfile: true,
        _count: {
          select: {
            followers: true,
            following: true,
          },
        },
      },
    });
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);

    if (dto.username && dto.username !== user.username) {
      const existing = await this.prisma.user.findUnique({
        where: { username: dto.username.toLowerCase() },
      });

      if (existing) {
        throw new ConflictException('Username already taken');
      }
    }

    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });

      if (existing) {
        throw new ConflictException('Email already registered');
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        ...dto,
        email: dto.email?.toLowerCase(),
        username: dto.username?.toLowerCase(),
      },
    });

    await this.cache.invalidate('user', id);
    return updatedUser;
  }

  async updateAvatar(id: string, avatarUrl: string): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { avatarUrl },
    });

    await this.cache.invalidate('user', id);
    return user;
  }

  async updateBanner(id: string, bannerUrl: string): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { bannerUrl },
    });

    await this.cache.invalidate('user', id);
    return user;
  }

  async findMany(options: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    status?: UserStatus;
  }) {
    const { page = 1, limit = 20, search, role, status } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) {
      where.role = role as any;
    }

    if (status) {
      where.status = status;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          role: true,
          status: true,
          createdAt: true,
          _count: {
            select: {
              followers: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPublicProfile(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bannerUrl: true,
        bio: true,
        createdAt: true,
        sellerProfile: {
          select: {
            isVerified: true,
            featuredSeller: true,
            averageRating: true,
            totalReviews: true,
            totalSales: true,
          },
        },
        _count: {
          select: {
            followers: true,
            following: true,
            streams: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getStats(userId: string) {
    const [
      totalOrders,
      totalSpent,
      totalSold,
      totalEarned,
      reviewsGiven,
      reviewsReceived,
    ] = await Promise.all([
      this.prisma.order.count({ where: { userId } }),
      this.prisma.order.aggregate({
        where: { userId, paymentStatus: 'SUCCEEDED' },
        _sum: { total: true },
      }),
      this.prisma.orderItem.count({
        where: {
          sellerId: userId,
          order: { paymentStatus: 'SUCCEEDED' },
        },
      }),
      this.prisma.orderItem.aggregate({
        where: {
          sellerId: userId,
          order: { paymentStatus: 'SUCCEEDED' },
        },
        _sum: { subtotal: true },
      }),
      this.prisma.review.count({ where: { authorId: userId } }),
      this.prisma.review.count({ where: { targetId: userId } }),
    ]);

    return {
      totalOrders,
      totalSpent: totalSpent._sum.total || 0,
      totalSold,
      totalEarned: totalEarned._sum.subtotal || 0,
      reviewsGiven,
      reviewsReceived,
    };
  }
}
