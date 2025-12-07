import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/services/prisma.service';
import { RedisService } from '@/common/services/redis.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';
import { StreamStatus, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StreamsService {
  private readonly logger = new Logger(StreamsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private configService: ConfigService,
  ) {}

  async create(hostId: string, dto: CreateStreamDto) {
    const activeStream = await this.prisma.liveStream.findFirst({
      where: {
        hostId,
        status: { in: [StreamStatus.LIVE, StreamStatus.SCHEDULED] },
      },
    });

    if (activeStream) {
      throw new BadRequestException('You already have an active or scheduled stream');
    }

    const streamKey = uuidv4();
    const rtmpBaseUrl = this.configService.get<string>('streaming.rtmpUrl') || 'rtmp://localhost:1935/live';
    const hlsBaseUrl = this.configService.get<string>('streaming.hlsUrl') || 'http://localhost:8080/hls';

    const stream = await this.prisma.liveStream.create({
      data: {
        hostId,
        title: dto.title,
        description: dto.description,
        thumbnailUrl: dto.thumbnailUrl,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: dto.scheduledAt ? StreamStatus.SCHEDULED : StreamStatus.SCHEDULED,
        streamKey,
        rtmpUrl: `${rtmpBaseUrl}/${streamKey}`,
        hlsUrl: `${hlsBaseUrl}/${streamKey}/index.m3u8`,
        chatEnabled: dto.chatEnabled ?? true,
        biddingEnabled: dto.biddingEnabled ?? true,
        replayEnabled: dto.replayEnabled ?? true,
      },
      include: {
        host: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    this.logger.log(`Stream created: ${stream.id} by ${hostId}`);
    return stream;
  }

  async findById(id: string) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id },
      include: {
        host: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            sellerProfile: {
              select: {
                isVerified: true,
                averageRating: true,
                totalReviews: true,
              },
            },
          },
        },
        products: {
          include: {
            product: {
              include: {
                images: { take: 1 },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: {
            viewers: true,
            messages: true,
          },
        },
      },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    return stream;
  }

  async update(id: string, hostId: string, dto: UpdateStreamDto) {
    const stream = await this.findById(id);

    if (stream.hostId !== hostId) {
      throw new ForbiddenException('You can only update your own streams');
    }

    if (stream.status === StreamStatus.ENDED) {
      throw new BadRequestException('Cannot update ended stream');
    }

    return this.prisma.liveStream.update({
      where: { id },
      data: dto,
    });
  }

  async goLive(id: string, hostId: string) {
    const stream = await this.findById(id);

    if (stream.hostId !== hostId) {
      throw new ForbiddenException('You can only start your own streams');
    }

    if (stream.status === StreamStatus.LIVE) {
      throw new BadRequestException('Stream is already live');
    }

    if (stream.status === StreamStatus.ENDED) {
      throw new BadRequestException('Cannot restart ended stream');
    }

    const updatedStream = await this.prisma.liveStream.update({
      where: { id },
      data: {
        status: StreamStatus.LIVE,
        startedAt: new Date(),
      },
    });

    await this.redis.sadd('streams:live', id);
    await this.redis.hset(`stream:${id}`, 'status', 'live');
    await this.redis.hset(`stream:${id}`, 'viewerCount', '0');

    this.logger.log(`Stream went live: ${id}`);
    return updatedStream;
  }

  async endStream(id: string, hostId: string) {
    const stream = await this.findById(id);

    if (stream.hostId !== hostId) {
      throw new ForbiddenException('You can only end your own streams');
    }

    if (stream.status !== StreamStatus.LIVE) {
      throw new BadRequestException('Stream is not live');
    }

    const viewerCount = await this.redis.get(`stream:${id}:viewers`) || '0';

    const updatedStream = await this.prisma.liveStream.update({
      where: { id },
      data: {
        status: StreamStatus.ENDED,
        endedAt: new Date(),
        totalViews: parseInt(viewerCount, 10),
      },
    });

    await this.redis.srem('streams:live', id);
    await this.redis.del(`stream:${id}`);
    await this.redis.del(`stream:${id}:viewers`);
    await this.redis.del(`stream:${id}:chat`);

    this.logger.log(`Stream ended: ${id}`);
    return updatedStream;
  }

  async pauseStream(id: string, hostId: string) {
    const stream = await this.findById(id);

    if (stream.hostId !== hostId) {
      throw new ForbiddenException('You can only pause your own streams');
    }

    if (stream.status !== StreamStatus.LIVE) {
      throw new BadRequestException('Can only pause live streams');
    }

    const updatedStream = await this.prisma.liveStream.update({
      where: { id },
      data: { status: StreamStatus.PAUSED },
    });

    await this.redis.hset(`stream:${id}`, 'status', 'paused');
    return updatedStream;
  }

  async resumeStream(id: string, hostId: string) {
    const stream = await this.findById(id);

    if (stream.hostId !== hostId) {
      throw new ForbiddenException('You can only resume your own streams');
    }

    if (stream.status !== StreamStatus.PAUSED) {
      throw new BadRequestException('Stream is not paused');
    }

    const updatedStream = await this.prisma.liveStream.update({
      where: { id },
      data: { status: StreamStatus.LIVE },
    });

    await this.redis.hset(`stream:${id}`, 'status', 'live');
    return updatedStream;
  }

  async findLive(options: { page?: number; limit?: number; categoryId?: string }) {
    const { page = 1, limit = 20, categoryId } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.LiveStreamWhereInput = {
      status: StreamStatus.LIVE,
    };

    const [streams, total] = await Promise.all([
      this.prisma.liveStream.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ viewerCount: 'desc' }, { startedAt: 'desc' }],
        include: {
          host: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          products: {
            where: { isActive: true },
            take: 1,
            include: {
              product: {
                include: {
                  images: { take: 1 },
                },
              },
            },
          },
        },
      }),
      this.prisma.liveStream.count({ where }),
    ]);

    return {
      data: streams,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findUpcoming(options: { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.LiveStreamWhereInput = {
      status: StreamStatus.SCHEDULED,
      scheduledAt: { gt: new Date() },
    };

    const [streams, total] = await Promise.all([
      this.prisma.liveStream.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledAt: 'asc' },
        include: {
          host: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      }),
      this.prisma.liveStream.count({ where }),
    ]);

    return {
      data: streams,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findByHost(hostId: string, options: { page?: number; limit?: number; status?: StreamStatus }) {
    const { page = 1, limit = 20, status } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.LiveStreamWhereInput = {
      hostId,
      ...(status && { status }),
    };

    const [streams, total] = await Promise.all([
      this.prisma.liveStream.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              viewers: true,
              products: true,
            },
          },
        },
      }),
      this.prisma.liveStream.count({ where }),
    ]);

    return {
      data: streams,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStreamKey(id: string, hostId: string) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id },
      select: { hostId: true, streamKey: true, rtmpUrl: true },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.hostId !== hostId) {
      throw new ForbiddenException('Access denied');
    }

    return {
      streamKey: stream.streamKey,
      rtmpUrl: stream.rtmpUrl,
    };
  }

  async updateViewerCount(id: string, count: number) {
    await this.prisma.liveStream.update({
      where: { id },
      data: {
        viewerCount: count,
        peakViewers: {
          set: count,
        },
      },
    });

    await this.redis.hset(`stream:${id}`, 'viewerCount', count.toString());
  }

  async incrementTotalRevenue(id: string, amount: number) {
    await this.prisma.liveStream.update({
      where: { id },
      data: {
        totalRevenue: { increment: amount },
      },
    });
  }
}
