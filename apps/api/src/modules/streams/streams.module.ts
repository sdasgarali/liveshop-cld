import { Module } from '@nestjs/common';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { StreamGateway } from './gateways/stream.gateway';
import { StreamProductsService } from './services/stream-products.service';
import { StreamViewerService } from './services/stream-viewer.service';

@Module({
  controllers: [StreamsController],
  providers: [
    StreamsService,
    StreamGateway,
    StreamProductsService,
    StreamViewerService,
  ],
  exports: [StreamsService],
})
export class StreamsModule {}
