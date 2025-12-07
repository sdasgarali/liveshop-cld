import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/services/prisma.service';
import { RedisService } from '@/common/services/redis.service';
import { StreamStatus } from '@prisma/client';

interface StreamHealth {
  isHealthy: boolean;
  bitrate: number;
  fps: number;
  resolution: string;
  codec: string;
  lastChecked: Date;
}

interface MediaServerConfig {
  rtmpUrl: string;
  hlsUrl: string;
  webhookSecret: string;
  maxBitrate: number;
  allowedCodecs: string[];
}

@Injectable()
export class MediaServerService implements OnModuleInit {
  private readonly logger = new Logger(MediaServerService.name);
  private config: MediaServerConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    this.config = {
      rtmpUrl: this.configService.get<string>('RTMP_SERVER_URL') || 'rtmp://localhost:1935/live',
      hlsUrl: this.configService.get<string>('HLS_SERVER_URL') || 'http://localhost:8080/hls',
      webhookSecret: this.configService.get<string>('MEDIA_SERVER_WEBHOOK_SECRET') || 'secret',
      maxBitrate: this.configService.get<number>('MAX_STREAM_BITRATE') || 6000000, // 6 Mbps
      allowedCodecs: ['h264', 'aac'],
    };

    this.logger.log(`Media server configured: RTMP=${this.config.rtmpUrl}, HLS=${this.config.hlsUrl}`);
  }

  // Generate streaming URLs for a stream
  generateStreamUrls(streamKey: string): {
    rtmpUrl: string;
    rtmpStreamKey: string;
    hlsPlaybackUrl: string;
    dashPlaybackUrl: string;
  } {
    return {
      rtmpUrl: this.config.rtmpUrl,
      rtmpStreamKey: streamKey,
      hlsPlaybackUrl: `${this.config.hlsUrl}/${streamKey}/index.m3u8`,
      dashPlaybackUrl: `${this.config.hlsUrl}/${streamKey}/index.mpd`,
    };
  }

  // Webhook handler for stream publish events (called by media server)
  async onStreamPublish(streamKey: string, clientIp: string): Promise<boolean> {
    this.logger.log(`Stream publish request: ${streamKey} from ${clientIp}`);

    const stream = await this.prisma.liveStream.findUnique({
      where: { streamKey },
      select: { id: true, hostId: true, status: true },
    });

    if (!stream) {
      this.logger.warn(`Rejected publish: Invalid stream key ${streamKey}`);
      return false;
    }

    if (stream.status === StreamStatus.ENDED) {
      this.logger.warn(`Rejected publish: Stream ${stream.id} has ended`);
      return false;
    }

    // Update stream status to LIVE
    await this.prisma.liveStream.update({
      where: { id: stream.id },
      data: {
        status: StreamStatus.LIVE,
        startedAt: stream.status !== StreamStatus.LIVE ? new Date() : undefined,
      },
    });

    // Store stream health in Redis
    await this.redis.hset(`stream:${stream.id}:health`, {
      isHealthy: 'true',
      startedAt: Date.now().toString(),
      clientIp,
    });

    await this.redis.sadd('streams:live', stream.id);

    this.logger.log(`Stream ${stream.id} is now live`);
    return true;
  }

  // Webhook handler for stream unpublish events
  async onStreamUnpublish(streamKey: string): Promise<void> {
    this.logger.log(`Stream unpublish: ${streamKey}`);

    const stream = await this.prisma.liveStream.findUnique({
      where: { streamKey },
      select: { id: true, status: true, startedAt: true },
    });

    if (!stream) return;

    // Calculate duration
    const duration = stream.startedAt
      ? Math.floor((Date.now() - stream.startedAt.getTime()) / 1000)
      : 0;

    // Update stream status
    await this.prisma.liveStream.update({
      where: { id: stream.id },
      data: {
        status: StreamStatus.ENDED,
        endedAt: new Date(),
      },
    });

    // Update all viewer sessions
    await this.prisma.streamView.updateMany({
      where: {
        streamId: stream.id,
        leftAt: null,
      },
      data: {
        leftAt: new Date(),
        duration,
      },
    });

    // Clean up Redis
    await this.redis.srem('streams:live', stream.id);
    await this.redis.del(`stream:${stream.id}:health`);
    await this.redis.del(`stream:${stream.id}:viewers`);

    this.logger.log(`Stream ${stream.id} ended after ${duration} seconds`);
  }

  // Health check for a specific stream
  async getStreamHealth(streamId: string): Promise<StreamHealth | null> {
    const health = await this.redis.hgetall(`stream:${streamId}:health`);

    if (!health || Object.keys(health).length === 0) {
      return null;
    }

    return {
      isHealthy: health.isHealthy === 'true',
      bitrate: parseInt(health.bitrate || '0', 10),
      fps: parseInt(health.fps || '0', 10),
      resolution: health.resolution || 'unknown',
      codec: health.codec || 'unknown',
      lastChecked: new Date(parseInt(health.lastChecked || '0', 10)),
    };
  }

  // Update stream health metrics (called periodically by media server)
  async updateStreamHealth(
    streamKey: string,
    metrics: {
      bitrate: number;
      fps: number;
      resolution: string;
      codec: string;
    },
  ): Promise<void> {
    const stream = await this.prisma.liveStream.findUnique({
      where: { streamKey },
      select: { id: true },
    });

    if (!stream) return;

    const isHealthy =
      metrics.bitrate > 0 &&
      metrics.fps >= 15 &&
      metrics.bitrate <= this.config.maxBitrate;

    await this.redis.hset(`stream:${stream.id}:health`, {
      isHealthy: isHealthy.toString(),
      bitrate: metrics.bitrate.toString(),
      fps: metrics.fps.toString(),
      resolution: metrics.resolution,
      codec: metrics.codec,
      lastChecked: Date.now().toString(),
    });
  }

  // Get recommended streaming settings
  getRecommendedSettings(): {
    resolution: string;
    bitrate: string;
    fps: number;
    keyframeInterval: number;
    encoder: string;
    audioCodec: string;
    audioBitrate: string;
  } {
    return {
      resolution: '1920x1080',
      bitrate: '4500 Kbps',
      fps: 30,
      keyframeInterval: 2,
      encoder: 'x264 (Software) or NVENC (Hardware)',
      audioCodec: 'AAC',
      audioBitrate: '160 Kbps',
    };
  }

  // Validate webhook request from media server
  validateWebhookRequest(signature: string, body: string): boolean {
    // In production, implement HMAC validation
    // For now, simple secret comparison
    return signature === this.config.webhookSecret;
  }

  // Get thumbnail URL for a live stream
  getThumbnailUrl(streamKey: string): string {
    return `${this.config.hlsUrl}/${streamKey}/thumb.jpg`;
  }

  // Get all live streams
  async getLiveStreams(): Promise<string[]> {
    const members = await this.redis.smembers('streams:live');
    return members;
  }
}
