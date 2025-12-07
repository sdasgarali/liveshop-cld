import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationService } from './services/push-notification.service';
import { EmailNotificationService } from './services/email-notification.service';

@Module({
  imports: [ConfigModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PushNotificationService,
    EmailNotificationService,
  ],
  exports: [NotificationsService, PushNotificationService, EmailNotificationService],
})
export class NotificationsModule {}
