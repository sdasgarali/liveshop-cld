import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/common/services/prisma.service';
import { AddStreamProductDto } from '../dto/add-stream-product.dto';

@Injectable()
export class StreamProductsService {
  constructor(private prisma: PrismaService) {}

  async addProduct(streamId: string, hostId: string, dto: AddStreamProductDto) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.hostId !== hostId) {
      throw new ForbiddenException('You can only add products to your own streams');
    }

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { seller: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.seller.userId !== hostId) {
      throw new ForbiddenException('You can only add your own products');
    }

    if (product.status !== 'ACTIVE') {
      throw new BadRequestException('Product is not available');
    }

    const existingStreamProduct = await this.prisma.streamProduct.findUnique({
      where: {
        streamId_productId: { streamId, productId: dto.productId },
      },
    });

    if (existingStreamProduct) {
      throw new BadRequestException('Product already added to stream');
    }

    return this.prisma.streamProduct.create({
      data: {
        streamId,
        productId: dto.productId,
        startingBid: dto.startingBid,
        bidIncrement: dto.bidIncrement || 1,
        sortOrder: dto.sortOrder || 0,
      },
      include: {
        product: {
          include: {
            images: { take: 1 },
          },
        },
      },
    });
  }

  async removeProduct(streamId: string, productId: string, hostId: string) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.hostId !== hostId) {
      throw new ForbiddenException('You can only remove products from your own streams');
    }

    const streamProduct = await this.prisma.streamProduct.findUnique({
      where: {
        streamId_productId: { streamId, productId },
      },
    });

    if (!streamProduct) {
      throw new NotFoundException('Product not in stream');
    }

    if (streamProduct.isSold) {
      throw new BadRequestException('Cannot remove sold product');
    }

    await this.prisma.streamProduct.delete({
      where: { id: streamProduct.id },
    });

    return { message: 'Product removed from stream' };
  }

  async featureProduct(streamId: string, productId: string, hostId: string) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.hostId !== hostId) {
      throw new ForbiddenException('Unauthorized');
    }

    const streamProduct = await this.prisma.streamProduct.findUnique({
      where: {
        streamId_productId: { streamId, productId },
      },
    });

    if (!streamProduct) {
      throw new NotFoundException('Product not in stream');
    }

    if (streamProduct.isSold) {
      throw new BadRequestException('Product already sold');
    }

    await this.prisma.streamProduct.updateMany({
      where: { streamId },
      data: { isActive: false },
    });

    return this.prisma.streamProduct.update({
      where: { id: streamProduct.id },
      data: {
        isActive: true,
        featuredAt: new Date(),
      },
      include: {
        product: {
          include: {
            images: true,
          },
        },
      },
    });
  }

  async markAsSold(streamId: string, productId: string, hostId: string, price: number) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.hostId !== hostId) {
      throw new ForbiddenException('Unauthorized');
    }

    const streamProduct = await this.prisma.streamProduct.findUnique({
      where: {
        streamId_productId: { streamId, productId },
      },
    });

    if (!streamProduct) {
      throw new NotFoundException('Product not in stream');
    }

    if (streamProduct.isSold) {
      throw new BadRequestException('Product already sold');
    }

    const [updatedStreamProduct] = await this.prisma.$transaction([
      this.prisma.streamProduct.update({
        where: { id: streamProduct.id },
        data: {
          isSold: true,
          soldAt: new Date(),
          soldPrice: price,
          isActive: false,
        },
      }),
      this.prisma.product.update({
        where: { id: productId },
        data: { status: 'SOLD' },
      }),
    ]);

    return updatedStreamProduct;
  }

  async getStreamProducts(streamId: string) {
    return this.prisma.streamProduct.findMany({
      where: { streamId },
      orderBy: { sortOrder: 'asc' },
      include: {
        product: {
          include: {
            images: true,
          },
        },
      },
    });
  }

  async reorderProducts(streamId: string, hostId: string, productIds: string[]) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream || stream.hostId !== hostId) {
      throw new ForbiddenException('Unauthorized');
    }

    const updates = productIds.map((productId, index) =>
      this.prisma.streamProduct.update({
        where: {
          streamId_productId: { streamId, productId },
        },
        data: { sortOrder: index },
      }),
    );

    await this.prisma.$transaction(updates);

    return { message: 'Products reordered' };
  }
}
