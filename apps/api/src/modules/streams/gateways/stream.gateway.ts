import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/services/prisma.service';
import { RedisService } from '@/common/services/redis.service';
import { StreamsService } from '../streams.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
}

@WebSocketGateway({
  namespace: '/stream',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class StreamGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(StreamGateway.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private redis: RedisService,
    private streamsService: StreamsService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

      if (token) {
        const payload = await this.jwtService.verifyAsync(token, {
          secret: this.configService.get<string>('jwt.secret'),
        });

        client.userId = payload.sub;
        client.username = payload.username;

        this.logger.log(`User ${payload.username} connected`);
      } else {
        this.logger.log(`Anonymous user connected: ${client.id}`);
      }
    } catch (error) {
      this.logger.warn(`Invalid token for client ${client.id}`);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const rooms = Array.from(client.rooms);

    for (const room of rooms) {
      if (room.startsWith('stream:')) {
        const streamId = room.replace('stream:', '');
        await this.handleLeaveStream(client, streamId);
      }
    }

    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-stream')
  async handleJoinStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string },
  ) {
    const { streamId } = data;
    const roomName = `stream:${streamId}`;

    await client.join(roomName);
    await this.redis.sadd(`stream:${streamId}:viewers`, client.id);

    const viewerCount = await this.redis.scard(`stream:${streamId}:viewers`);
    await this.streamsService.updateViewerCount(streamId, viewerCount);

    if (client.userId) {
      await this.prisma.streamView.create({
        data: {
          streamId,
          userId: client.userId,
          sessionId: client.id,
        },
      });
    }

    this.server.to(roomName).emit('viewer-count', { count: viewerCount });

    client.emit('joined-stream', {
      streamId,
      viewerCount,
      userId: client.userId,
    });

    this.logger.log(`Client ${client.id} joined stream ${streamId}`);
  }

  @SubscribeMessage('leave-stream')
  async handleLeaveStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId?: string,
  ) {
    const roomName = `stream:${streamId}`;

    await client.leave(roomName);
    await this.redis.srem(`stream:${streamId}:viewers`, client.id);

    const viewerCount = await this.redis.scard(`stream:${streamId}:viewers`);
    await this.streamsService.updateViewerCount(streamId, viewerCount);

    if (client.userId) {
      await this.prisma.streamView.updateMany({
        where: {
          streamId,
          userId: client.userId,
          sessionId: client.id,
          leftAt: null,
        },
        data: {
          leftAt: new Date(),
        },
      });
    }

    this.server.to(roomName).emit('viewer-count', { count: viewerCount });
    this.logger.log(`Client ${client.id} left stream ${streamId}`);
  }

  @SubscribeMessage('send-message')
  async handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string; content: string },
  ) {
    if (!client.userId) {
      client.emit('error', { message: 'Authentication required to send messages' });
      return;
    }

    const { streamId, content } = data;

    if (!content || content.trim().length === 0) {
      return;
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        streamId,
        senderId: client.userId,
        content: content.trim().substring(0, 500),
        type: 'text',
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    this.server.to(`stream:${streamId}`).emit('new-message', message);
  }

  @SubscribeMessage('place-bid')
  async handleBid(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string; productId: string; amount: number },
  ) {
    if (!client.userId) {
      client.emit('error', { message: 'Authentication required to place bids' });
      return;
    }

    const { streamId, productId, amount } = data;

    const streamProduct = await this.prisma.streamProduct.findUnique({
      where: {
        streamId_productId: { streamId, productId },
      },
    });

    if (!streamProduct || !streamProduct.isActive) {
      client.emit('error', { message: 'Product is not currently available for bidding' });
      return;
    }

    const currentBid = streamProduct.currentBid?.toNumber() || streamProduct.startingBid?.toNumber() || 0;
    const minBid = currentBid + streamProduct.bidIncrement.toNumber();

    if (amount < minBid) {
      client.emit('error', { message: `Minimum bid is $${minBid.toFixed(2)}` });
      return;
    }

    const bid = await this.prisma.bid.create({
      data: {
        userId: client.userId,
        productId,
        streamId,
        amount,
        status: 'ACTIVE',
      },
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

    await this.prisma.bid.updateMany({
      where: {
        productId,
        streamId,
        id: { not: bid.id },
        status: 'ACTIVE',
      },
      data: { status: 'OUTBID' },
    });

    await this.prisma.streamProduct.update({
      where: { id: streamProduct.id },
      data: { currentBid: amount },
    });

    this.server.to(`stream:${streamId}`).emit('new-bid', {
      bid,
      productId,
      currentBid: amount,
    });

    this.logger.log(`Bid placed: $${amount} on product ${productId} by ${client.username}`);
  }

  @SubscribeMessage('feature-product')
  async handleFeatureProduct(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string; productId: string },
  ) {
    const { streamId, productId } = data;

    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream || stream.hostId !== client.userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    await this.prisma.streamProduct.updateMany({
      where: { streamId },
      data: { isActive: false },
    });

    const featuredProduct = await this.prisma.streamProduct.update({
      where: {
        streamId_productId: { streamId, productId },
      },
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

    this.server.to(`stream:${streamId}`).emit('product-featured', featuredProduct);
  }

  @SubscribeMessage('product-sold')
  async handleProductSold(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string; productId: string; winnerId: string; price: number },
  ) {
    const { streamId, productId, winnerId, price } = data;

    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream || stream.hostId !== client.userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    await this.prisma.streamProduct.update({
      where: {
        streamId_productId: { streamId, productId },
      },
      data: {
        isSold: true,
        soldAt: new Date(),
        soldPrice: price,
        isActive: false,
      },
    });

    await this.prisma.bid.updateMany({
      where: {
        productId,
        streamId,
        userId: winnerId,
        status: 'ACTIVE',
      },
      data: { status: 'WON' },
    });

    await this.streamsService.incrementTotalRevenue(streamId, price);

    this.server.to(`stream:${streamId}`).emit('product-sold', {
      productId,
      winnerId,
      price,
    });
  }

  emitToStream(streamId: string, event: string, data: any) {
    this.server.to(`stream:${streamId}`).emit(event, data);
  }
}
