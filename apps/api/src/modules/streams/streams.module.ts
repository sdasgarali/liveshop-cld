import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { StreamsController } from './streams.controller';
import { StreamWebhookController } from './controllers/webhook.controller';
import { StreamsService } from './streams.service';
import { StreamGateway } from './gateways/stream.gateway';
import { StreamProductsService } from './services/stream-products.service';
import { StreamViewerService } from './services/stream-viewer.service';
import { AuctionService } from './services/auction.service';
import { MediaServerService } from './services/media-server.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    forwardRef(() => NotificationsModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [StreamsController, StreamWebhookController],
  providers: [
    StreamsService,
    StreamGateway,
    StreamProductsService,
    StreamViewerService,
    AuctionService,
    MediaServerService,
  ],
  exports: [StreamsService, AuctionService, MediaServerService, StreamGateway],
})
export class StreamsModule {}
