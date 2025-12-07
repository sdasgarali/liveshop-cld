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
import { Logger, UseGuards, forwardRef, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/services/prisma.service';
import { RedisService } from '@/common/services/redis.service';
import { StreamsService } from '../streams.service';
import { AuctionService } from '../services/auction.service';

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
    @Inject(forwardRef(() => AuctionService))
    private auctionService: AuctionService,
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

  // ============================================
  // AUCTION EVENTS
  // ============================================

  @SubscribeMessage('start-auction')
  async handleStartAuction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      streamId: string;
      productId: string;
      duration?: number;
      startingBid?: number;
      bidIncrement?: number;
      reservePrice?: number;
      buyItNowPrice?: number;
      extendOnBid?: boolean;
    },
  ) {
    if (!client.userId) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    const { streamId, productId, ...options } = data;

    // Verify host
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream || stream.hostId !== client.userId) {
      client.emit('error', { message: 'Only the host can start an auction' });
      return;
    }

    try {
      const auctionState = await this.auctionService.startAuction(streamId, productId, options);

      // Broadcast auction start to all viewers
      this.server.to(`stream:${streamId}`).emit('auction-started', {
        ...auctionState,
        product: await this.prisma.product.findUnique({
          where: { id: productId },
          include: { images: { take: 3 } },
        }),
        buyItNowPrice: options.buyItNowPrice,
      });

      // Start countdown broadcast
      this.startCountdownBroadcast(streamId);

      this.logger.log(`Auction started for product ${productId} in stream ${streamId}`);
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('auction-bid')
  async handleAuctionBid(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string; amount: number },
  ) {
    if (!client.userId) {
      client.emit('error', { message: 'Authentication required to place bids' });
      return;
    }

    const { streamId, amount } = data;

    const result = await this.auctionService.placeBid(streamId, client.userId, amount);

    if (result.success) {
      // Broadcast new bid to all viewers
      this.server.to(`stream:${streamId}`).emit('auction-bid', {
        bid: result.bid,
        currentBid: result.currentBid,
        timeRemaining: result.timeRemaining,
      });

      this.logger.log(`Bid placed: $${amount} in stream ${streamId} by ${client.username}`);
    } else {
      client.emit('bid-error', { message: result.message });
    }
  }

  @SubscribeMessage('set-auto-bid')
  async handleSetAutoBid(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string; maxAmount: number },
  ) {
    if (!client.userId) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    const { streamId, maxAmount } = data;

    const result = await this.auctionService.setAutoBid(streamId, client.userId, maxAmount);

    client.emit('auto-bid-set', result);

    if (result.success) {
      this.logger.log(`Auto-bid set: $${maxAmount} in stream ${streamId} by ${client.username}`);
    }
  }

  @SubscribeMessage('cancel-auto-bid')
  async handleCancelAutoBid(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string },
  ) {
    if (!client.userId) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    await this.auctionService.cancelAutoBid(data.streamId, client.userId);
    client.emit('auto-bid-cancelled', { success: true });
  }

  @SubscribeMessage('buy-it-now')
  async handleBuyItNow(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string },
  ) {
    if (!client.userId) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    const { streamId } = data;

    const result = await this.auctionService.buyItNow(streamId, client.userId);

    if (result.success) {
      // Broadcast buy-it-now purchase to all viewers
      this.server.to(`stream:${streamId}`).emit('auction-ended', {
        winner: result.bid?.user,
        finalPrice: result.currentBid,
        reason: 'buy_now',
      });

      this.logger.log(`Buy It Now: $${result.currentBid} in stream ${streamId} by ${client.username}`);
    } else {
      client.emit('buy-error', { message: result.message });
    }
  }

  @SubscribeMessage('end-auction')
  async handleEndAuction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string },
  ) {
    if (!client.userId) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    const { streamId } = data;

    // Verify host
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream || stream.hostId !== client.userId) {
      client.emit('error', { message: 'Only the host can end an auction' });
      return;
    }

    const result = await this.auctionService.endAuction(streamId, 'sold');

    this.server.to(`stream:${streamId}`).emit('auction-ended', {
      winner: result.winner,
      finalPrice: result.finalPrice,
      reserveMet: result.reserveMet,
      reason: 'host_ended',
    });

    this.logger.log(`Auction ended by host in stream ${streamId}`);
  }

  @SubscribeMessage('get-auction-state')
  async handleGetAuctionState(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string },
  ) {
    const countdown = await this.auctionService.getCountdown(data.streamId);
    client.emit('auction-state', countdown);
  }

  // Broadcast countdown every second
  private async startCountdownBroadcast(streamId: string) {
    const interval = setInterval(async () => {
      const countdown = await this.auctionService.getCountdown(streamId);

      if (!countdown.isActive) {
        clearInterval(interval);

        // Auction ended naturally
        const result = await this.auctionService.endAuction(streamId, 'timeout');
        this.server.to(`stream:${streamId}`).emit('auction-ended', {
          winner: result.winner,
          finalPrice: result.finalPrice,
          reserveMet: result.reserveMet,
          reason: 'timeout',
        });

        return;
      }

      this.server.to(`stream:${streamId}`).emit('auction-countdown', {
        timeRemaining: countdown.timeRemaining,
        currentBid: countdown.currentBid,
        bidCount: countdown.bidCount,
        highestBidder: countdown.highestBidder,
      });
    }, 1000);

    // Store interval reference for cleanup
    await this.redis.set(`stream:${streamId}:countdown`, 'active', 300);
  }

  // ============================================
  // QUICK SALE (Fixed Price during stream)
  // ============================================

  @SubscribeMessage('quick-sale')
  async handleQuickSale(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      streamId: string;
      productId: string;
      price: number;
      quantity?: number;
    },
  ) {
    if (!client.userId) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    const { streamId, productId, price, quantity = 1 } = data;

    // Verify host
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
    });

    if (!stream || stream.hostId !== client.userId) {
      client.emit('error', { message: 'Only the host can create quick sales' });
      return;
    }

    // Update stream product for quick sale
    await this.prisma.streamProduct.update({
      where: { streamId_productId: { streamId, productId } },
      data: {
        isActive: true,
        currentBid: price, // Using currentBid to store fixed price
        featuredAt: new Date(),
      },
    });

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { images: { take: 3 } },
    });

    // Broadcast quick sale to all viewers
    this.server.to(`stream:${streamId}`).emit('quick-sale-started', {
      product,
      price,
      quantity,
    });

    this.logger.log(`Quick sale started: ${productId} at $${price} in stream ${streamId}`);
  }

  @SubscribeMessage('claim-quick-sale')
  async handleClaimQuickSale(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string; productId: string },
  ) {
    if (!client.userId) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    const { streamId, productId } = data;

    // Get stream product
    const streamProduct = await this.prisma.streamProduct.findUnique({
      where: { streamId_productId: { streamId, productId } },
    });

    if (!streamProduct || !streamProduct.isActive || streamProduct.isSold) {
      client.emit('error', { message: 'Product not available' });
      return;
    }

    // Mark as sold
    await this.prisma.streamProduct.update({
      where: { id: streamProduct.id },
      data: {
        isSold: true,
        soldAt: new Date(),
        soldPrice: streamProduct.currentBid,
        isActive: false,
      },
    });

    // Update product status
    await this.prisma.product.update({
      where: { id: productId },
      data: { status: 'SOLD' },
    });

    const buyer = await this.prisma.user.findUnique({
      where: { id: client.userId },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    });

    // Broadcast sale to all viewers
    this.server.to(`stream:${streamId}`).emit('quick-sale-claimed', {
      productId,
      buyer,
      price: streamProduct.currentBid?.toNumber(),
    });

    // Increment stream revenue
    await this.streamsService.incrementTotalRevenue(streamId, streamProduct.currentBid?.toNumber() || 0);

    this.logger.log(`Quick sale claimed: ${productId} by ${client.username} in stream ${streamId}`);
  }
}
