import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/services/prisma.service';
import { PushNotificationService } from '../../notifications/services/push-notification.service';
import { RegisterDeviceDto, DevicePlatform } from '../dto/register-device.dto';

interface UserDevice {
  id: string;
  userId: string;
  pushToken: string;
  platform: string;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
  deviceId?: string;
  isActive: boolean;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushNotificationService,
  ) {}

  async registerDevice(userId: string, dto: RegisterDeviceDto): Promise<UserDevice> {
    // Check if device already exists
    const existingDevice = await this.prisma.userDevice.findFirst({
      where: {
        OR: [
          { pushToken: dto.pushToken },
          ...(dto.deviceId ? [{ deviceId: dto.deviceId, userId }] : []),
        ],
      },
    });

    if (existingDevice) {
      // Update existing device
      const updated = await this.prisma.userDevice.update({
        where: { id: existingDevice.id },
        data: {
          userId, // Transfer device to new user if needed
          pushToken: dto.pushToken,
          platform: dto.platform,
          deviceModel: dto.deviceModel,
          osVersion: dto.osVersion,
          appVersion: dto.appVersion,
          isActive: true,
          lastActiveAt: new Date(),
        },
      });

      // Subscribe to user-specific topic
      await this.pushService.subscribeToTopic(dto.pushToken, `user_${userId}`);

      return updated;
    }

    // Create new device
    const device = await this.prisma.userDevice.create({
      data: {
        userId,
        pushToken: dto.pushToken,
        platform: dto.platform,
        deviceModel: dto.deviceModel,
        osVersion: dto.osVersion,
        appVersion: dto.appVersion,
        deviceId: dto.deviceId,
        isActive: true,
        lastActiveAt: new Date(),
      },
    });

    // Subscribe to user-specific topic
    await this.pushService.subscribeToTopic(dto.pushToken, `user_${userId}`);

    this.logger.log(`New device registered for user ${userId}: ${dto.platform}`);

    return device;
  }

  async unregisterDevice(userId: string, pushToken: string): Promise<void> {
    const device = await this.prisma.userDevice.findFirst({
      where: { userId, pushToken },
    });

    if (device) {
      await this.prisma.userDevice.update({
        where: { id: device.id },
        data: { isActive: false },
      });

      // Unsubscribe from user topic
      await this.pushService.unsubscribeFromTopic(pushToken, `user_${userId}`);

      this.logger.log(`Device unregistered for user ${userId}`);
    }
  }

  async getUserDevices(userId: string): Promise<UserDevice[]> {
    return this.prisma.userDevice.findMany({
      where: { userId, isActive: true },
      orderBy: { lastActiveAt: 'desc' },
    });
  }

  async getActiveDeviceTokens(userId: string): Promise<string[]> {
    const devices = await this.prisma.userDevice.findMany({
      where: { userId, isActive: true },
      select: { pushToken: true },
    });

    return devices.map((d) => d.pushToken);
  }

  async updateLastActive(pushToken: string): Promise<void> {
    await this.prisma.userDevice.updateMany({
      where: { pushToken },
      data: { lastActiveAt: new Date() },
    });
  }

  async deactivateStaleDevices(olderThan: Date): Promise<number> {
    const result = await this.prisma.userDevice.updateMany({
      where: {
        lastActiveAt: { lt: olderThan },
        isActive: true,
      },
      data: { isActive: false },
    });

    return result.count;
  }

  async removeDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.prisma.userDevice.findFirst({
      where: { id: deviceId, userId },
    });

    if (device) {
      await this.pushService.unsubscribeFromTopic(device.pushToken, `user_${userId}`);
      await this.prisma.userDevice.delete({ where: { id: deviceId } });
    }
  }
}
