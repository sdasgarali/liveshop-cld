import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';
import { ProductStatus, Prisma } from '@prisma/client';

export interface SearchFilters {
  query?: string;
  categoryId?: string;
  categorySlug?: string;
  sellerId?: string;
  condition?: string[];
  minPrice?: number;
  maxPrice?: number;
  tags?: string[];
  inStock?: boolean;
  sortBy?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'popular';
}

@Injectable()
export class ProductSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(filters: SearchFilters, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,
    };

    // Category filter
    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    } else if (filters.categorySlug) {
      const category = await this.prisma.category.findUnique({
        where: { slug: filters.categorySlug },
        include: { children: { select: { id: true } } },
      });

      if (category) {
        const categoryIds = [category.id, ...category.children.map((c) => c.id)];
        where.categoryId = { in: categoryIds };
      }
    }

    // Seller filter
    if (filters.sellerId) {
      where.sellerId = filters.sellerId;
    }

    // Condition filter
    if (filters.condition?.length) {
      where.condition = { in: filters.condition as any[] };
    }

    // Price range
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.price = {};
      if (filters.minPrice !== undefined) {
        where.price.gte = filters.minPrice;
      }
      if (filters.maxPrice !== undefined) {
        where.price.lte = filters.maxPrice;
      }
    }

    // Tags filter
    if (filters.tags?.length) {
      where.tags = { hasSome: filters.tags };
    }

    // In stock filter
    if (filters.inStock) {
      where.quantity = { gt: 0 };
    }

    // Text search
    if (filters.query) {
      where.OR = [
        { title: { contains: filters.query, mode: 'insensitive' } },
        { description: { contains: filters.query, mode: 'insensitive' } },
        { tags: { has: filters.query.toLowerCase() } },
      ];
    }

    // Determine sort order
    let orderBy: Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[];
    switch (filters.sortBy) {
      case 'price_asc':
        orderBy = { price: 'asc' };
        break;
      case 'price_desc':
        orderBy = { price: 'desc' };
        break;
      case 'newest':
        orderBy = { createdAt: 'desc' };
        break;
      case 'popular':
        orderBy = [{ viewCount: 'desc' }, { watchCount: 'desc' }];
        break;
      case 'relevance':
      default:
        // For relevance, we use a combination of factors
        orderBy = [{ viewCount: 'desc' }, { createdAt: 'desc' }];
        break;
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
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
          images: {
            orderBy: { sortOrder: 'asc' },
            take: 1,
          },
          _count: {
            select: {
              bids: true,
              watchlist: true,
            },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // Log search query for analytics
    if (filters.query) {
      await this.logSearchQuery(filters.query, total);
    }

    return {
      data: products,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      filters: {
        applied: filters,
        available: await this.getAvailableFilters(where),
      },
    };
  }

  async getAvailableFilters(baseWhere: Prisma.ProductWhereInput) {
    // Get unique conditions with counts
    const conditions = await this.prisma.product.groupBy({
      by: ['condition'],
      where: { ...baseWhere, condition: undefined },
      _count: { _all: true },
    });

    // Get price range
    const priceStats = await this.prisma.product.aggregate({
      where: baseWhere,
      _min: { price: true },
      _max: { price: true },
    });

    // Get categories with counts
    const categories = await this.prisma.product.groupBy({
      by: ['categoryId'],
      where: { ...baseWhere, categoryId: undefined },
      _count: { _all: true },
    });

    const categoryDetails = await this.prisma.category.findMany({
      where: { id: { in: categories.map((c) => c.categoryId) } },
      select: { id: true, name: true, slug: true },
    });

    return {
      conditions: conditions.map((c) => ({
        value: c.condition,
        count: c._count._all,
      })),
      priceRange: {
        min: priceStats._min.price?.toNumber() || 0,
        max: priceStats._max.price?.toNumber() || 0,
      },
      categories: categories.map((c) => {
        const details = categoryDetails.find((cat) => cat.id === c.categoryId);
        return {
          id: c.categoryId,
          name: details?.name,
          slug: details?.slug,
          count: c._count._all,
        };
      }),
    };
  }

  async getSuggestions(query: string, limit = 5) {
    if (!query || query.length < 2) {
      return [];
    }

    // Get product title suggestions
    const products = await this.prisma.product.findMany({
      where: {
        status: ProductStatus.ACTIVE,
        title: { contains: query, mode: 'insensitive' },
      },
      select: { title: true },
      take: limit,
      distinct: ['title'],
    });

    // Get category suggestions
    const categories = await this.prisma.category.findMany({
      where: {
        isActive: true,
        name: { contains: query, mode: 'insensitive' },
      },
      select: { name: true, slug: true },
      take: 3,
    });

    return {
      products: products.map((p) => p.title),
      categories: categories.map((c) => ({ name: c.name, slug: c.slug })),
    };
  }

  async getTrendingSearches(limit = 10) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const trending = await this.prisma.searchQuery.groupBy({
      by: ['query'],
      where: {
        createdAt: { gte: oneWeekAgo },
      },
      _count: { _all: true },
      orderBy: { _count: { query: 'desc' } },
      take: limit,
    });

    return trending.map((t) => ({
      query: t.query,
      count: t._count._all,
    }));
  }

  private async logSearchQuery(query: string, resultCount: number) {
    await this.prisma.searchQuery.create({
      data: {
        query: query.toLowerCase(),
        resultCount,
      },
    });
  }
}
