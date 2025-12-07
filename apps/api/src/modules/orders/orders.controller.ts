import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.create(userId, createOrderDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all orders for current user' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.findAll(userId, query);
  }

  @Get('seller')
  @ApiOperation({ summary: 'Get all orders for seller' })
  async getSellerOrders(
    @CurrentUser('id') userId: string,
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.getSellerOrders(userId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get order statistics' })
  async getStats(@CurrentUser('id') userId: string) {
    return this.ordersService.getOrderStats(userId);
  }

  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get all orders (Admin only)' })
  async findAllAdmin(@Query() query: OrderQueryDto) {
    return this.ordersService.findAll('', query, true);
  }

  @Get('admin/stats')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get all order statistics (Admin only)' })
  async getAdminStats() {
    return this.ordersService.getOrderStats('', true);
  }

  @Get('number/:orderNumber')
  @ApiOperation({ summary: 'Get order by order number' })
  async findByOrderNumber(
    @Param('orderNumber') orderNumber: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ordersService.findByOrderNumber(orderNumber, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ordersService.findOne(id, userId);
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update order status' })
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() updateDto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, userId, updateDto);
  }

  @Put(':id/status/admin')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update order status (Admin only)' })
  async updateStatusAdmin(
    @Param('id') id: string,
    @Body() updateDto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, '', updateDto, true);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an order' })
  async cancelOrder(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() cancelDto: CancelOrderDto,
  ) {
    return this.ordersService.cancelOrder(id, userId, cancelDto.reason);
  }
}
