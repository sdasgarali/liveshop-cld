import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/services/prisma.service';
import { RedisService } from '@/common/services/redis.service';

@Injectable()
export class StreamViewerService {
  private readonly logger = new Logger(StreamViewerService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async recordView(streamId: string, userId: string | null, sessionId: string) {
    await this.prisma.streamView.create({
      data: {
        streamId,
        userId,
        sessionId,
        joinedAt: new Date(),
      },
    });

    await this.redis.sadd(`stream:${streamId}:viewers`, sessionId);

    if (userId) {
      await this.redis.sadd(`stream:${streamId}:users`, userId);
    }
  }

  async endView(streamId: string, sessionId: string) {
    const view = await this.prisma.streamView.findFirst({
      where: {
        streamId,
        sessionId,
        leftAt: null,
      },
    });

    if (view) {
      const duration = Math.floor((Date.now() - view.joinedAt.getTime()) / 1000);

      await this.prisma.streamView.update({
        where: { id: view.id },
        data: {
          leftAt: new Date(),
          duration,
        },
      });
    }

    await this.redis.srem(`stream:${streamId}:viewers`, sessionId);
  }

  async getViewerCount(streamId: string): Promise<number> {
    return this.redis.scard(`stream:${streamId}:viewers`);
  }

  async getUniqueViewerCount(streamId: string): Promise<number> {
    return this.redis.scard(`stream:${streamId}:users`);
  }

  async getViewerStats(streamId: string) {
    const [totalViews, uniqueUsers, avgDuration] = await Promise.all([
      this.prisma.streamView.count({ where: { streamId } }),
      this.prisma.streamView.groupBy({
        by: ['userId'],
        where: { streamId, userId: { not: null } },
      }),
      this.prisma.streamView.aggregate({
        where: { streamId, duration: { not: null } },
        _avg: { duration: true },
      }),
    ]);

    const currentViewers = await this.getViewerCount(streamId);

    return {
      currentViewers,
      totalViews,
      uniqueUsers: uniqueUsers.length,
      averageWatchTime: Math.round(avgDuration._avg.duration || 0),
    };
  }

  async getTopViewers(streamId: string, limit: number = 10) {
    const views = await this.prisma.streamView.groupBy({
      by: ['userId'],
      where: { streamId, userId: { not: null } },
      _sum: { duration: true },
      orderBy: { _sum: { duration: 'desc' } },
      take: limit,
    });

    const userIds = views.map((v) => v.userId).filter(Boolean) as string[];

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
    });

    return views.map((v) => ({
      user: users.find((u) => u.id === v.userId),
      watchTime: v._sum.duration || 0,
    }));
  }

  async cleanupExpiredViewers() {
    const liveStreams = await this.redis.smembers('streams:live');

    for (const streamId of liveStreams) {
      const viewers = await this.redis.smembers(`stream:${streamId}:viewers`);
      const viewerCount = viewers.length;

      await this.prisma.liveStream.update({
        where: { id: streamId },
        data: { viewerCount },
      });
    }

    this.logger.log(`Cleaned up viewer counts for ${liveStreams.length} streams`);
  }
}
