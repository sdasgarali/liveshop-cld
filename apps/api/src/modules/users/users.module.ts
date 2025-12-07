import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SellerProfileService } from './services/seller-profile.service';
import { FollowService } from './services/follow.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, SellerProfileService, FollowService],
  exports: [UsersService, SellerProfileService],
})
export class UsersModule {}
