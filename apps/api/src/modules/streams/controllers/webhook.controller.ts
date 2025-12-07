import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { MediaServerService } from '../services/media-server.service';
import { StreamGateway } from '../gateways/stream.gateway';

interface PublishPayload {
  name: string; // stream key
  addr: string; // client IP
  app: string;  // application name (e.g., "live")
  flashver: string;
  tcurl: string;
}

@ApiTags('stream-webhooks')
@Controller('streams/webhook')
export class StreamWebhookController {
  private readonly logger = new Logger(StreamWebhookController.name);

  constructor(
    private readonly mediaServerService: MediaServerService,
    private readonly streamGateway: StreamGateway,
  ) {}

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async onPublish(
    @Body() body: PublishPayload,
    @Headers('x-webhook-secret') secret: string,
  ): Promise<string> {
    this.logger.log(`Publish webhook received for stream: ${body.name}`);

    // Validate the webhook request
    // In production, verify the secret
    // if (!this.mediaServerService.validateWebhookRequest(secret, JSON.stringify(body))) {
    //   throw new UnauthorizedException('Invalid webhook signature');
    // }

    const allowed = await this.mediaServerService.onStreamPublish(body.name, body.addr);

    if (!allowed) {
      // Return non-2xx to reject the stream
      throw new UnauthorizedException('Stream rejected');
    }

    return 'OK';
  }

  @Post('unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async onUnpublish(
    @Body() body: PublishPayload,
    @Headers('x-webhook-secret') secret: string,
  ): Promise<string> {
    this.logger.log(`Unpublish webhook received for stream: ${body.name}`);

    await this.mediaServerService.onStreamUnpublish(body.name);

    return 'OK';
  }

  @Post('health')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async onHealthUpdate(
    @Body() body: {
      name: string;
      bitrate: number;
      fps: number;
      resolution: string;
      codec: string;
    },
  ): Promise<string> {
    await this.mediaServerService.updateStreamHealth(body.name, {
      bitrate: body.bitrate,
      fps: body.fps,
      resolution: body.resolution,
      codec: body.codec,
    });

    return 'OK';
  }
}
