import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ShippingService } from './shipping.service';
import { GetRatesDto } from './dto/get-rates.dto';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Shipping')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post('rates')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get shipping rates' })
  async getRates(@Body() dto: GetRatesDto) {
    return this.shippingService.getShippingRates(dto);
  }

  @Post('shipments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a shipment' })
  async createShipment(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateShipmentDto,
  ) {
    return this.shippingService.createShipment(userId, dto);
  }

  @Post('shipments/:id/ship')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark shipment as shipped' })
  async markAsShipped(
    @CurrentUser('id') userId: string,
    @Param('id') shipmentId: string,
  ) {
    return this.shippingService.markAsShipped(userId, shipmentId);
  }

  @Get('orders/:orderId/shipments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get order shipments' })
  async getOrderShipments(@Param('orderId') orderId: string) {
    return this.shippingService.getOrderShipments(orderId);
  }

  @Get('orders/:orderId/tracking')
  @Public()
  @ApiOperation({ summary: 'Get tracking information' })
  async getTracking(@Param('orderId') orderId: string) {
    return this.shippingService.getTrackingInfo(orderId);
  }

  @Post('shipments/:id/refresh')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Refresh tracking status' })
  async refreshTracking(@Param('id') shipmentId: string) {
    return this.shippingService.refreshTracking(shipmentId);
  }

  @Post('validate-address')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate shipping address' })
  async validateAddress(@Body() address: any) {
    return this.shippingService.validateAddress(address);
  }

  @Get('seller/shipments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get seller shipments' })
  async getSellerShipments(
    @CurrentUser('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.shippingService.getSellerShipments(userId, page, limit);
  }
}
