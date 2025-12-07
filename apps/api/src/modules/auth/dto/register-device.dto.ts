import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, IsBoolean } from 'class-validator';

export enum DevicePlatform {
  IOS = 'IOS',
  ANDROID = 'ANDROID',
  WEB = 'WEB',
}

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM or APNS push token' })
  @IsString()
  pushToken: string;

  @ApiProperty({ description: 'Device platform', enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @ApiPropertyOptional({ description: 'Device model' })
  @IsOptional()
  @IsString()
  deviceModel?: string;

  @ApiPropertyOptional({ description: 'Operating system version' })
  @IsOptional()
  @IsString()
  osVersion?: string;

  @ApiPropertyOptional({ description: 'App version' })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({ description: 'Unique device identifier' })
  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ description: 'Enable push notifications' })
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Notify on new messages' })
  @IsOptional()
  @IsBoolean()
  notifyMessages?: boolean;

  @ApiPropertyOptional({ description: 'Notify when followed sellers go live' })
  @IsOptional()
  @IsBoolean()
  notifyLiveStreams?: boolean;

  @ApiPropertyOptional({ description: 'Notify on order updates' })
  @IsOptional()
  @IsBoolean()
  notifyOrders?: boolean;

  @ApiPropertyOptional({ description: 'Notify on price drops' })
  @IsOptional()
  @IsBoolean()
  notifyPriceDrops?: boolean;

  @ApiPropertyOptional({ description: 'Notify on promotions' })
  @IsOptional()
  @IsBoolean()
  notifyPromotions?: boolean;
}
