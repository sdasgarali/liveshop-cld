import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductStatus, Prisma } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(sellerId: string, createProductDto: CreateProductDto) {
    // Verify seller profile exists
    const sellerProfile = await this.prisma.sellerProfile.findUnique({
      where: { userId: sellerId },
    });

    if (!sellerProfile) {
      throw new ForbiddenException('You must have a seller profile to create products');
    }

    // Verify category exists
    const category = await this.prisma.category.findUnique({
      where: { id: createProductDto.categoryId },
    });

    if (!category) {
      throw new BadRequestException('Invalid category');
    }

    // Generate slug
    const slug = await this.generateUniqueSlug(createProductDto.title);

    const product = await this.prisma.product.create({
      data: {
        sellerId: sellerProfile.id,
        categoryId: createProductDto.categoryId,
        title: createProductDto.title,
        slug,
        description: createProductDto.description,
        condition: createProductDto.condition,
        price: createProductDto.price,
        compareAtPrice: createProductDto.compareAtPrice,
        costPrice: createProductDto.costPrice,
        quantity: createProductDto.quantity || 1,
        sku: createProductDto.sku,
        barcode: createProductDto.barcode,
        weight: createProductDto.weight,
        weightUnit: createProductDto.weightUnit || 'oz',
        tags: createProductDto.tags || [],
        attributes: createProductDto.attributes,
        status: createProductDto.status || ProductStatus.DRAFT,
      },
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
        },
      },
    });

    return product;
  }

  async findAll(query: ProductQueryDto) {
    const {
      page = 1,
      limit = 20,
      categoryId,
      sellerId,
      status,
      condition,
      minPrice,
      maxPrice,
      search,
      tags,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      ...(categoryId && { categoryId }),
      ...(sellerId && { sellerId }),
      ...(status && { status }),
      ...(condition && { condition }),
      ...(minPrice !== undefined && { price: { gte: minPrice } }),
      ...(maxPrice !== undefined && { price: { ...((where as any)?.price || {}), lte: maxPrice } }),
      ...(tags?.length && { tags: { hasSome: tags } }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { tags: { has: search.toLowerCase() } },
        ],
      }),
    };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
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

    return {
      data: products,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: {
          include: {
            parent: true,
          },
        },
        seller: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
                bio: true,
              },
            },
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: {
            bids: true,
            watchlist: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Increment view count
    await this.prisma.product.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    return product;
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug },
      include: {
        category: {
          include: {
            parent: true,
          },
        },
        seller: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
                bio: true,
              },
            },
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: {
            bids: true,
            watchlist: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Increment view count
    await this.prisma.product.update({
      where: { id: product.id },
      data: { viewCount: { increment: 1 } },
    });

    return product;
  }

  async update(id: string, userId: string, updateProductDto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { seller: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.seller.userId !== userId) {
      throw new ForbiddenException('You can only update your own products');
    }

    // If title changed, regenerate slug
    let slug = product.slug;
    if (updateProductDto.title && updateProductDto.title !== product.title) {
      slug = await this.generateUniqueSlug(updateProductDto.title, id);
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: {
        ...updateProductDto,
        slug,
        ...(updateProductDto.status === ProductStatus.ACTIVE && !product.publishedAt
          ? { publishedAt: new Date() }
          : {}),
      },
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
        },
      },
    });

    return updatedProduct;
  }

  async remove(id: string, userId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { seller: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.seller.userId !== userId) {
      throw new ForbiddenException('You can only delete your own products');
    }

    // Check if product has active orders
    const activeOrders = await this.prisma.orderItem.count({
      where: {
        productId: id,
        order: {
          status: {
            in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'],
          },
        },
      },
    });

    if (activeOrders > 0) {
      throw new BadRequestException('Cannot delete product with active orders');
    }

    await this.prisma.product.delete({ where: { id } });

    return { message: 'Product deleted successfully' };
  }

  async addImages(productId: string, userId: string, images: { url: string; alt?: string }[]) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { seller: true, images: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.seller.userId !== userId) {
      throw new ForbiddenException('You can only add images to your own products');
    }

    const startOrder = product.images.length;
    const isPrimary = product.images.length === 0;

    const createdImages = await this.prisma.$transaction(
      images.map((image, index) =>
        this.prisma.productImage.create({
          data: {
            productId,
            url: image.url,
            alt: image.alt || product.title,
            sortOrder: startOrder + index,
            isPrimary: isPrimary && index === 0,
          },
        })
      )
    );

    return createdImages;
  }

  async removeImage(productId: string, imageId: string, userId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { seller: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.seller.userId !== userId) {
      throw new ForbiddenException('You can only remove images from your own products');
    }

    await this.prisma.productImage.delete({
      where: { id: imageId, productId },
    });

    return { message: 'Image removed successfully' };
  }

  async reorderImages(productId: string, userId: string, imageIds: string[]) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { seller: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.seller.userId !== userId) {
      throw new ForbiddenException('You can only reorder images of your own products');
    }

    await this.prisma.$transaction(
      imageIds.map((imageId, index) =>
        this.prisma.productImage.update({
          where: { id: imageId, productId },
          data: {
            sortOrder: index,
            isPrimary: index === 0,
          },
        })
      )
    );

    return { message: 'Images reordered successfully' };
  }

  async getSellerProducts(userId: string, query: ProductQueryDto) {
    const sellerProfile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!sellerProfile) {
      throw new NotFoundException('Seller profile not found');
    }

    return this.findAll({ ...query, sellerId: sellerProfile.id });
  }

  async publishProduct(id: string, userId: string) {
    return this.update(id, userId, { status: ProductStatus.ACTIVE });
  }

  async archiveProduct(id: string, userId: string) {
    return this.update(id, userId, { status: ProductStatus.ARCHIVED });
  }

  private async generateUniqueSlug(title: string, excludeId?: string): Promise<string> {
    const baseSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.prisma.product.findFirst({
        where: {
          slug,
          ...(excludeId && { id: { not: excludeId } }),
        },
      });

      if (!existing) break;

      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }
}
