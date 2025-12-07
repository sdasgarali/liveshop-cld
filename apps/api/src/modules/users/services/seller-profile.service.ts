import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@/common/services/prisma.service';
import { CreateSellerProfileDto } from '../dto/create-seller-profile.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class SellerProfileService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateSellerProfileDto) {
    const existingProfile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (existingProfile) {
      throw new ConflictException('Seller profile already exists');
    }

    const [sellerProfile] = await this.prisma.$transaction([
      this.prisma.sellerProfile.create({
        data: {
          userId,
          ...dto,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { role: UserRole.SELLER },
      }),
    ]);

    return sellerProfile;
  }

  async findByUserId(userId: string) {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            bannerUrl: true,
            bio: true,
          },
        },
        categories: {
          include: {
            category: true,
          },
        },
        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Seller profile not found');
    }

    return profile;
  }

  async update(userId: string, dto: Partial<CreateSellerProfileDto>) {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Seller profile not found');
    }

    return this.prisma.sellerProfile.update({
      where: { userId },
      data: dto,
    });
  }

  async getSellerStats(userId: string) {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Seller profile not found');
    }

    const [
      totalProducts,
      activeProducts,
      soldProducts,
      totalOrders,
      pendingOrders,
      totalStreams,
      liveStreams,
    ] = await Promise.all([
      this.prisma.product.count({ where: { sellerId: profile.id } }),
      this.prisma.product.count({
        where: { sellerId: profile.id, status: 'ACTIVE' },
      }),
      this.prisma.product.count({
        where: { sellerId: profile.id, status: 'SOLD' },
      }),
      this.prisma.orderItem.count({
        where: { sellerId: profile.id },
      }),
      this.prisma.orderItem.count({
        where: {
          sellerId: profile.id,
          order: { status: 'PENDING' },
        },
      }),
      this.prisma.liveStream.count({ where: { hostId: userId } }),
      this.prisma.liveStream.count({
        where: { hostId: userId, status: 'LIVE' },
      }),
    ]);

    return {
      totalProducts,
      activeProducts,
      soldProducts,
      totalOrders,
      pendingOrders,
      totalStreams,
      liveStreams,
      totalSales: profile.totalSales,
      totalRevenue: profile.totalRevenue,
      averageRating: profile.averageRating,
      totalReviews: profile.totalReviews,
    };
  }

  async getTopSellers(limit: number = 10) {
    return this.prisma.sellerProfile.findMany({
      where: {
        isVerified: true,
      },
      orderBy: [
        { featuredSeller: 'desc' },
        { totalSales: 'desc' },
        { averageRating: 'desc' },
      ],
      take: limit,
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
    });
  }
}
