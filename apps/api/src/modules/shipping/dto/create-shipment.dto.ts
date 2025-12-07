import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsString, IsOptional, IsUrl } from 'class-validator';

export class CreateShipmentDto {
  @ApiProperty({ description: 'Order ID' })
  @IsUUID()
  orderId: string;

  @ApiPropertyOptional({ description: 'Shipping rate ID (from getRates)' })
  @IsOptional()
  @IsString()
  rateId?: string;

  @ApiPropertyOptional({ description: 'Carrier name (if manual entry)' })
  @IsOptional()
  @IsString()
  carrier?: string;

  @ApiPropertyOptional({ description: 'Tracking number (if manual entry)' })
  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @ApiPropertyOptional({ description: 'Tracking URL (if manual entry)' })
  @IsOptional()
  @IsUrl()
  trackingUrl?: string;
}
