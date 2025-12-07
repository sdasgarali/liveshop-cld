import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StreamsService } from './streams.service';
import { StreamProductsService } from './services/stream-products.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CreateStreamDto } from './dto/create-stream.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';
import { AddStreamProductDto } from './dto/add-stream-product.dto';
import { UserRole, StreamStatus } from '@prisma/client';

@ApiTags('streams')
@Controller({ path: 'streams', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class StreamsController {
  constructor(
    private readonly streamsService: StreamsService,
    private readonly streamProductsService: StreamProductsService,
  ) {}

  @Post()
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new stream' })
  @ApiResponse({ status: 201, description: 'Stream created successfully' })
  async create(
    @CurrentUser('id') hostId: string,
    @Body() dto: CreateStreamDto,
  ) {
    return this.streamsService.create(hostId, dto);
  }

  @Get('live')
  @Public()
  @ApiOperation({ summary: 'Get all live streams' })
  async getLiveStreams(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.streamsService.findLive({ page, limit, categoryId });
  }

  @Get('upcoming')
  @Public()
  @ApiOperation({ summary: 'Get upcoming scheduled streams' })
  async getUpcomingStreams(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.streamsService.findUpcoming({ page, limit });
  }

  @Get('my-streams')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user streams' })
  async getMyStreams(
    @CurrentUser('id') hostId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: StreamStatus,
  ) {
    return this.streamsService.findByHost(hostId, { page, limit, status });
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get stream by ID' })
  async getStream(@Param('id', ParseUUIDPipe) id: string) {
    return this.streamsService.findById(id);
  }

  @Put(':id')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update stream' })
  async updateStream(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') hostId: string,
    @Body() dto: UpdateStreamDto,
  ) {
    return this.streamsService.update(id, hostId, dto);
  }

  @Post(':id/go-live')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Start streaming (go live)' })
  async goLive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') hostId: string,
  ) {
    return this.streamsService.goLive(id, hostId);
  }

  @Post(':id/end')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'End stream' })
  async endStream(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') hostId: string,
  ) {
    return this.streamsService.endStream(id, hostId);
  }

  @Post(':id/pause')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Pause stream' })
  async pauseStream(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') hostId: string,
  ) {
    return this.streamsService.pauseStream(id, hostId);
  }

  @Post(':id/resume')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Resume paused stream' })
  async resumeStream(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') hostId: string,
  ) {
    return this.streamsService.resumeStream(id, hostId);
  }

  @Get(':id/stream-key')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get stream key (host only)' })
  async getStreamKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') hostId: string,
  ) {
    return this.streamsService.getStreamKey(id, hostId);
  }

  @Post(':id/products')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Add product to stream' })
  async addProduct(
    @Param('id', ParseUUIDPipe) streamId: string,
    @CurrentUser('id') hostId: string,
    @Body() dto: AddStreamProductDto,
  ) {
    return this.streamProductsService.addProduct(streamId, hostId, dto);
  }

  @Put(':id/products/:productId/feature')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Feature a product in stream' })
  async featureProduct(
    @Param('id', ParseUUIDPipe) streamId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser('id') hostId: string,
  ) {
    return this.streamProductsService.featureProduct(streamId, productId, hostId);
  }

  @Put(':id/products/:productId/sold')
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark product as sold in stream' })
  async markProductSold(
    @Param('id', ParseUUIDPipe) streamId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser('id') hostId: string,
    @Body('price') price: number,
  ) {
    return this.streamProductsService.markAsSold(streamId, productId, hostId, price);
  }
}
