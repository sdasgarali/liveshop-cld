import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSellerProfileDto {
  @ApiPropertyOptional({ example: 'Vintage Collectibles LLC' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessName?: string;

  @ApiPropertyOptional({ example: 'sole_proprietor' })
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiPropertyOptional({ example: '30 day returns accepted' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  returnPolicy?: string;

  @ApiPropertyOptional({ example: 'Ships within 2 business days' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  shippingPolicy?: string;
}
