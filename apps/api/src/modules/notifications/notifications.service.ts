import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { PushNotificationService } from './services/push-notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushNotificationService,
  ) {}

  async create(dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        data: dto.data,
      },
    });

    // Send push notification if user has push enabled
    if (dto.sendPush) {
      await this.pushService.sendToUser(dto.userId, {
        title: dto.title,
        body: dto.body || '',
        data: dto.data,
      });
    }

    return notification;
  }

  async createBulk(userIds: string[], notification: Omit<CreateNotificationDto, 'userId'>) {
    const notifications = await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
      })),
    });

    // Send push notifications
    if (notification.sendPush) {
      await Promise.all(
        userIds.map((userId) =>
          this.pushService.sendToUser(userId, {
            title: notification.title,
            body: notification.body || '',
            data: notification.data,
          }),
        ),
      );
    }

    return notifications;
  }

  async getUserNotifications(userId: string, page = 1, limit = 20, unreadOnly = false) {
    const skip = (page - 1) * limit;

    const where = {
      userId,
      ...(unreadOnly && { isRead: false }),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      data: notifications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        unreadCount,
      },
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { message: 'All notifications marked as read' };
  }

  async deleteNotification(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.delete({ where: { id: notificationId } });

    return { message: 'Notification deleted' };
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    return { unreadCount: count };
  }

  // Notification triggers
  async notifyNewFollower(followerId: string, followingId: string) {
    const follower = await this.prisma.user.findUnique({
      where: { id: followerId },
      select: { displayName: true, username: true },
    });

    return this.create({
      userId: followingId,
      type: 'NEW_FOLLOWER',
      title: 'New Follower',
      body: `${follower?.displayName || follower?.username} started following you`,
      data: { followerId },
      sendPush: true,
    });
  }

  async notifyStreamStart(hostId: string, streamId: string, streamTitle: string) {
    // Get all followers with notifications enabled
    const followers = await this.prisma.follow.findMany({
      where: {
        followingId: hostId,
        notifyLive: true,
      },
      select: { followerId: true },
    });

    const host = await this.prisma.user.findUnique({
      where: { id: hostId },
      select: { displayName: true, username: true },
    });

    const userIds = followers.map((f) => f.followerId);

    return this.createBulk(userIds, {
      type: 'STREAM_START',
      title: `${host?.displayName || host?.username} is live!`,
      body: streamTitle,
      data: { streamId, hostId },
      sendPush: true,
    });
  }

  async notifyNewBid(sellerId: string, productTitle: string, bidAmount: number, streamId?: string) {
    return this.create({
      userId: sellerId,
      type: 'NEW_BID',
      title: 'New Bid',
      body: `New bid of $${bidAmount.toFixed(2)} on ${productTitle}`,
      data: { streamId },
      sendPush: true,
    });
  }

  async notifyBidOutbid(userId: string, productTitle: string, newBidAmount: number) {
    return this.create({
      userId,
      type: 'OUTBID',
      title: 'Outbid',
      body: `You've been outbid on ${productTitle}. New price: $${newBidAmount.toFixed(2)}`,
      sendPush: true,
    });
  }

  async notifyOrderStatus(userId: string, orderNumber: string, status: string) {
    const statusMessages: Record<string, string> = {
      CONFIRMED: 'Your order has been confirmed',
      PROCESSING: 'Your order is being processed',
      SHIPPED: 'Your order has been shipped',
      DELIVERED: 'Your order has been delivered',
      CANCELLED: 'Your order has been cancelled',
    };

    return this.create({
      userId,
      type: 'ORDER_UPDATE',
      title: `Order ${orderNumber}`,
      body: statusMessages[status] || `Order status updated to ${status}`,
      data: { orderNumber, status },
      sendPush: true,
    });
  }

  async notifyNewProduct(sellerId: string) {
    // Get followers with product notifications enabled
    const followers = await this.prisma.follow.findMany({
      where: {
        followingId: sellerId,
        notifyProduct: true,
      },
      select: { followerId: true },
    });

    const seller = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { displayName: true, username: true },
    });

    const userIds = followers.map((f) => f.followerId);

    return this.createBulk(userIds, {
      type: 'NEW_PRODUCT',
      title: 'New Listing',
      body: `${seller?.displayName || seller?.username} listed a new product`,
      data: { sellerId },
      sendPush: true,
    });
  }
}
