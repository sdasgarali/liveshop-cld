import {
  Controller,
  Get,
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
import { UsersService } from './users.service';
import { SellerProfileService } from './services/seller-profile.service';
import { FollowService } from './services/follow.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateSellerProfileDto } from './dto/create-seller-profile.dto';
import { UserRole, UserStatus } from '@prisma/client';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly sellerProfileService: SellerProfileService,
    private readonly followService: FollowService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List all users (Admin only)' })
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: UserStatus,
  ) {
    return this.usersService.findMany({ page, limit, search, role, status });
  }

  @Get('profile')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.findById(userId);
  }

  @Put('profile')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(userId, dto);
  }

  @Get('stats')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user stats' })
  async getStats(@CurrentUser('id') userId: string) {
    return this.usersService.getStats(userId);
  }

  @Get(':username')
  @Public()
  @ApiOperation({ summary: 'Get public user profile by username' })
  async getPublicProfile(@Param('username') username: string) {
    return this.usersService.getPublicProfile(username);
  }

  @Get(':id/seller-profile')
  @Public()
  @ApiOperation({ summary: 'Get seller profile' })
  async getSellerProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.sellerProfileService.findByUserId(id);
  }

  @Put('become-seller')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create seller profile' })
  async becomeSeller(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSellerProfileDto,
  ) {
    return this.sellerProfileService.create(userId, dto);
  }

  @Put(':id/follow')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Follow a user' })
  async follow(
    @CurrentUser('id') followerId: string,
    @Param('id', ParseUUIDPipe) followingId: string,
  ) {
    return this.followService.follow(followerId, followingId);
  }

  @Put(':id/unfollow')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Unfollow a user' })
  async unfollow(
    @CurrentUser('id') followerId: string,
    @Param('id', ParseUUIDPipe) followingId: string,
  ) {
    return this.followService.unfollow(followerId, followingId);
  }

  @Get(':id/followers')
  @Public()
  @ApiOperation({ summary: 'Get user followers' })
  async getFollowers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.followService.getFollowers(id, { page, limit });
  }

  @Get(':id/following')
  @Public()
  @ApiOperation({ summary: 'Get users being followed' })
  async getFollowing(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.followService.getFollowing(id, { page, limit });
  }
}
