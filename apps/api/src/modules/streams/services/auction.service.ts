import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/common/services/prisma.service';
import { RedisService } from '@/common/services/redis.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { BidStatus, ProductStatus } from '@prisma/client';

interface AuctionState {
  streamId: string;
  productId: string;
  streamProductId: string;
  startTime: number;
  endTime: number;
  duration: number;
  currentBid: number;
  highestBidderId: string | null;
  bidCount: number;
  isActive: boolean;
  extendOnBid: boolean;
  extensionSeconds: number;
}

interface BidResult {
  success: boolean;
  bid?: any;
  currentBid: number;
  timeRemaining: number;
  message?: string;
}

@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);
  private readonly AUCTION_KEY_PREFIX = 'auction:';
  private readonly DEFAULT_DURATION = 60; // 60 seconds default auction
  private readonly EXTENSION_THRESHOLD = 10; // Extend if bid in last 10 seconds
  private readonly EXTENSION_SECONDS = 15; // Add 15 seconds on late bids

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async startAuction(
    streamId: string,
    productId: string,
    options: {
      duration?: number;
      startingBid?: number;
      bidIncrement?: number;
      reservePrice?: number;
      extendOnBid?: boolean;
      buyItNowPrice?: number;
    } = {},
  ): Promise<AuctionState> {
    const streamProduct = await this.prisma.streamProduct.findUnique({
      where: { streamId_productId: { streamId, productId } },
      include: { product: true },
    });

    if (!streamProduct) {
      throw new BadRequestException('Product not found in stream');
    }

    // End any active auction for this stream
    await this.endActiveAuction(streamId);

    const now = Date.now();
    const duration = (options.duration || this.DEFAULT_DURATION) * 1000;
    const startingBid = options.startingBid || streamProduct.startingBid?.toNumber() || 1;

    const auctionState: AuctionState = {
      streamId,
      productId,
      streamProductId: streamProduct.id,
      startTime: now,
      endTime: now + duration,
      duration: duration / 1000,
      currentBid: startingBid,
      highestBidderId: null,
      bidCount: 0,
      isActive: true,
      extendOnBid: options.extendOnBid ?? true,
      extensionSeconds: this.EXTENSION_SECONDS,
    };

    // Store in Redis
    await this.redis.set(
      `${this.AUCTION_KEY_PREFIX}${streamId}`,
      JSON.stringify(auctionState),
      Math.ceil(duration / 1000) + 300, // TTL: duration + 5 minutes buffer
    );

    // Store additional auction metadata
    await this.redis.hset(`${this.AUCTION_KEY_PREFIX}${streamId}:meta`, {
      reservePrice: (options.reservePrice || 0).toString(),
      bidIncrement: (options.bidIncrement || streamProduct.bidIncrement?.toNumber() || 1).toString(),
      buyItNowPrice: (options.buyItNowPrice || 0).toString(),
    });

    // Update stream product
    await this.prisma.streamProduct.update({
      where: { id: streamProduct.id },
      data: {
        isActive: true,
        startingBid: startingBid,
        currentBid: startingBid,
        bidIncrement: options.bidIncrement || streamProduct.bidIncrement,
        featuredAt: new Date(),
      },
    });

    this.logger.log(`Auction started for product ${productId} in stream ${streamId}`);

    return auctionState;
  }

  async getAuctionState(streamId: string): Promise<AuctionState | null> {
    const data = await this.redis.get(`${this.AUCTION_KEY_PREFIX}${streamId}`);
    if (!data) return null;

    const state = JSON.parse(data) as AuctionState;
    const now = Date.now();

    // Check if auction has ended
    if (now >= state.endTime && state.isActive) {
      await this.endAuction(streamId, 'timeout');
      state.isActive = false;
    }

    return {
      ...state,
      timeRemaining: Math.max(0, Math.ceil((state.endTime - now) / 1000)),
    } as AuctionState & { timeRemaining: number };
  }

  async placeBid(
    streamId: string,
    userId: string,
    amount: number,
  ): Promise<BidResult> {
    const state = await this.getAuctionState(streamId);

    if (!state || !state.isActive) {
      return {
        success: false,
        currentBid: state?.currentBid || 0,
        timeRemaining: 0,
        message: 'No active auction',
      };
    }

    const meta = await this.redis.hgetall(`${this.AUCTION_KEY_PREFIX}${streamId}:meta`);
    const bidIncrement = parseFloat(meta.bidIncrement || '1');
    const minBid = state.currentBid + bidIncrement;

    if (amount < minBid) {
      return {
        success: false,
        currentBid: state.currentBid,
        timeRemaining: Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000)),
        message: `Minimum bid is $${minBid.toFixed(2)}`,
      };
    }

    // Check if user is already highest bidder
    if (state.highestBidderId === userId) {
      return {
        success: false,
        currentBid: state.currentBid,
        timeRemaining: Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000)),
        message: 'You are already the highest bidder',
      };
    }

    const previousBidderId = state.highestBidderId;

    // Create bid record
    const bid = await this.prisma.bid.create({
      data: {
        userId,
        productId: state.productId,
        streamId,
        amount,
        status: BidStatus.ACTIVE,
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

    // Update previous bids to OUTBID
    await this.prisma.bid.updateMany({
      where: {
        productId: state.productId,
        streamId,
        id: { not: bid.id },
        status: BidStatus.ACTIVE,
      },
      data: { status: BidStatus.OUTBID },
    });

    // Update auction state
    const now = Date.now();
    const timeRemaining = state.endTime - now;
    let newEndTime = state.endTime;

    // Extend auction if bid placed in last X seconds
    if (state.extendOnBid && timeRemaining < this.EXTENSION_THRESHOLD * 1000) {
      newEndTime = now + state.extensionSeconds * 1000;
      this.logger.log(`Auction extended for stream ${streamId}`);
    }

    const updatedState: AuctionState = {
      ...state,
      currentBid: amount,
      highestBidderId: userId,
      bidCount: state.bidCount + 1,
      endTime: newEndTime,
    };

    await this.redis.set(
      `${this.AUCTION_KEY_PREFIX}${streamId}`,
      JSON.stringify(updatedState),
      Math.ceil((newEndTime - now) / 1000) + 300,
    );

    // Update stream product
    await this.prisma.streamProduct.update({
      where: { id: state.streamProductId },
      data: { currentBid: amount },
    });

    // Notify previous highest bidder they've been outbid
    if (previousBidderId && previousBidderId !== userId) {
      const product = await this.prisma.product.findUnique({
        where: { id: state.productId },
        select: { title: true },
      });

      await this.notificationsService.notifyBidOutbid(
        previousBidderId,
        product?.title || 'Unknown Product',
        amount,
      );
    }

    // Check for auto-bids to trigger
    await this.processAutoBids(streamId, userId, amount);

    return {
      success: true,
      bid,
      currentBid: amount,
      timeRemaining: Math.max(0, Math.ceil((newEndTime - now) / 1000)),
    };
  }

  async endAuction(streamId: string, reason: 'timeout' | 'sold' | 'cancelled' | 'buy_now' = 'timeout'): Promise<{
    winner: any | null;
    finalPrice: number;
    reserveMet: boolean;
  }> {
    const state = await this.getAuctionState(streamId);
    if (!state) {
      return { winner: null, finalPrice: 0, reserveMet: false };
    }

    const meta = await this.redis.hgetall(`${this.AUCTION_KEY_PREFIX}${streamId}:meta`);
    const reservePrice = parseFloat(meta.reservePrice || '0');
    const reserveMet = state.currentBid >= reservePrice;

    let winner = null;

    if (state.highestBidderId && (reserveMet || reason === 'buy_now')) {
      // Update winning bid
      await this.prisma.bid.updateMany({
        where: {
          productId: state.productId,
          streamId,
          userId: state.highestBidderId,
          status: BidStatus.ACTIVE,
        },
        data: { status: BidStatus.WON },
      });

      winner = await this.prisma.user.findUnique({
        where: { id: state.highestBidderId },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      });

      // Mark product as sold
      await this.prisma.streamProduct.update({
        where: { id: state.streamProductId },
        data: {
          isSold: true,
          soldAt: new Date(),
          soldPrice: state.currentBid,
          isActive: false,
        },
      });

      // Update product status
      await this.prisma.product.update({
        where: { id: state.productId },
        data: { status: ProductStatus.SOLD },
      });

      // Notify winner
      const product = await this.prisma.product.findUnique({
        where: { id: state.productId },
        select: { title: true },
      });

      await this.notificationsService.create({
        userId: state.highestBidderId,
        type: 'AUCTION_WON',
        title: 'You won the auction!',
        body: `Congratulations! You won ${product?.title} for $${state.currentBid.toFixed(2)}`,
        data: { streamId, productId: state.productId, price: state.currentBid },
        sendPush: true,
      });
    } else {
      // No winner or reserve not met
      await this.prisma.streamProduct.update({
        where: { id: state.streamProductId },
        data: { isActive: false },
      });

      if (!reserveMet && state.highestBidderId) {
        // Notify bidder that reserve wasn't met
        await this.notificationsService.create({
          userId: state.highestBidderId,
          type: 'RESERVE_NOT_MET',
          title: 'Reserve price not met',
          body: 'The auction ended but the reserve price was not met.',
          data: { streamId, productId: state.productId },
          sendPush: true,
        });
      }
    }

    // Clean up Redis
    await this.redis.del(`${this.AUCTION_KEY_PREFIX}${streamId}`);
    await this.redis.del(`${this.AUCTION_KEY_PREFIX}${streamId}:meta`);
    await this.redis.del(`${this.AUCTION_KEY_PREFIX}${streamId}:autobids`);

    this.logger.log(`Auction ended for stream ${streamId}, reason: ${reason}`);

    return {
      winner,
      finalPrice: state.currentBid,
      reserveMet,
    };
  }

  async endActiveAuction(streamId: string): Promise<void> {
    const state = await this.getAuctionState(streamId);
    if (state?.isActive) {
      await this.endAuction(streamId, 'cancelled');
    }
  }

  async buyItNow(streamId: string, userId: string): Promise<BidResult> {
    const state = await this.getAuctionState(streamId);

    if (!state || !state.isActive) {
      return {
        success: false,
        currentBid: 0,
        timeRemaining: 0,
        message: 'No active auction',
      };
    }

    const meta = await this.redis.hgetall(`${this.AUCTION_KEY_PREFIX}${streamId}:meta`);
    const buyItNowPrice = parseFloat(meta.buyItNowPrice || '0');

    if (buyItNowPrice <= 0) {
      return {
        success: false,
        currentBid: state.currentBid,
        timeRemaining: Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000)),
        message: 'Buy It Now is not available for this auction',
      };
    }

    // Buy It Now is disabled if current bid exceeds a threshold (e.g., 80% of BIN price)
    if (state.currentBid >= buyItNowPrice * 0.8) {
      return {
        success: false,
        currentBid: state.currentBid,
        timeRemaining: Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000)),
        message: 'Buy It Now is no longer available - bidding is too close to the price',
      };
    }

    // Create the winning bid at BIN price
    const bid = await this.prisma.bid.create({
      data: {
        userId,
        productId: state.productId,
        streamId,
        amount: buyItNowPrice,
        status: BidStatus.WON,
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

    // Update state
    const updatedState: AuctionState = {
      ...state,
      currentBid: buyItNowPrice,
      highestBidderId: userId,
      isActive: false,
    };

    await this.redis.set(
      `${this.AUCTION_KEY_PREFIX}${streamId}`,
      JSON.stringify(updatedState),
      60,
    );

    // End the auction
    await this.endAuction(streamId, 'buy_now');

    return {
      success: true,
      bid,
      currentBid: buyItNowPrice,
      timeRemaining: 0,
      message: 'Purchase successful!',
    };
  }

  // Auto-bidding (proxy bidding)
  async setAutoBid(
    streamId: string,
    userId: string,
    maxAmount: number,
  ): Promise<{ success: boolean; message: string }> {
    const state = await this.getAuctionState(streamId);

    if (!state || !state.isActive) {
      return { success: false, message: 'No active auction' };
    }

    const meta = await this.redis.hgetall(`${this.AUCTION_KEY_PREFIX}${streamId}:meta`);
    const bidIncrement = parseFloat(meta.bidIncrement || '1');
    const minBid = state.currentBid + bidIncrement;

    if (maxAmount < minBid) {
      return {
        success: false,
        message: `Maximum bid must be at least $${minBid.toFixed(2)}`,
      };
    }

    // Store auto-bid
    await this.redis.hset(`${this.AUCTION_KEY_PREFIX}${streamId}:autobids`, userId, maxAmount.toString());

    // Update bid record to show it's an auto-bid
    await this.prisma.bid.updateMany({
      where: {
        productId: state.productId,
        streamId,
        userId,
      },
      data: {
        isAutoBid: true,
        maxAutoBid: maxAmount,
      },
    });

    // Immediately place a bid if needed
    if (state.highestBidderId !== userId) {
      const bidAmount = Math.min(maxAmount, state.currentBid + bidIncrement);
      await this.placeBid(streamId, userId, bidAmount);
    }

    return {
      success: true,
      message: `Auto-bid set up to $${maxAmount.toFixed(2)}`,
    };
  }

  async cancelAutoBid(streamId: string, userId: string): Promise<void> {
    await this.redis.hdel(`${this.AUCTION_KEY_PREFIX}${streamId}:autobids`, userId);
  }

  private async processAutoBids(
    streamId: string,
    excludeUserId: string,
    currentBid: number,
  ): Promise<void> {
    const autoBids = await this.redis.hgetall(`${this.AUCTION_KEY_PREFIX}${streamId}:autobids`);
    const meta = await this.redis.hgetall(`${this.AUCTION_KEY_PREFIX}${streamId}:meta`);
    const bidIncrement = parseFloat(meta.bidIncrement || '1');

    // Find auto-bidders who can outbid
    const eligibleAutoBidders = Object.entries(autoBids)
      .filter(([userId, maxBid]) => {
        return userId !== excludeUserId && parseFloat(maxBid) > currentBid + bidIncrement;
      })
      .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1])); // Sort by max bid descending

    if (eligibleAutoBidders.length === 0) return;

    // The highest auto-bidder places a bid
    const [highestBidder, maxBidStr] = eligibleAutoBidders[0];
    const maxBid = parseFloat(maxBidStr);

    // Calculate the minimum winning bid
    let newBidAmount = currentBid + bidIncrement;

    // If there are competing auto-bidders, bid just enough to beat them
    if (eligibleAutoBidders.length > 1) {
      const secondHighest = parseFloat(eligibleAutoBidders[1][1]);
      newBidAmount = Math.min(maxBid, secondHighest + bidIncrement);
    }

    // Place the auto-bid
    await this.placeBid(streamId, highestBidder, newBidAmount);
  }

  // Scheduled job to check and end expired auctions
  @Cron(CronExpression.EVERY_SECOND)
  async checkExpiredAuctions(): Promise<void> {
    // Get all active auction keys
    const keys = await this.redis.keys(`${this.AUCTION_KEY_PREFIX}*`);
    const auctionKeys = keys.filter(k => !k.includes(':meta') && !k.includes(':autobids'));

    for (const key of auctionKeys) {
      try {
        const data = await this.redis.get(key);
        if (!data) continue;

        const state = JSON.parse(data) as AuctionState;
        if (state.isActive && Date.now() >= state.endTime) {
          await this.endAuction(state.streamId, 'timeout');
        }
      } catch (error) {
        this.logger.error(`Error checking auction ${key}:`, error);
      }
    }
  }

  // Get countdown timer for frontend
  async getCountdown(streamId: string): Promise<{
    timeRemaining: number;
    currentBid: number;
    bidCount: number;
    highestBidder: any | null;
    isActive: boolean;
  }> {
    const state = await this.getAuctionState(streamId);

    if (!state) {
      return {
        timeRemaining: 0,
        currentBid: 0,
        bidCount: 0,
        highestBidder: null,
        isActive: false,
      };
    }

    let highestBidder = null;
    if (state.highestBidderId) {
      highestBidder = await this.prisma.user.findUnique({
        where: { id: state.highestBidderId },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      });
    }

    return {
      timeRemaining: Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000)),
      currentBid: state.currentBid,
      bidCount: state.bidCount,
      highestBidder,
      isActive: state.isActive,
    };
  }
}
