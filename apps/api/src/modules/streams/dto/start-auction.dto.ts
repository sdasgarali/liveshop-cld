import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsBoolean, Min } from 'class-validator';

export class StartAuctionDto {
  @ApiProperty({ description: 'Product ID to auction' })
  @IsString()
  productId: string;

  @ApiPropertyOptional({ description: 'Auction duration in seconds', default: 60 })
  @IsOptional()
  @IsNumber()
  @Min(10)
  duration?: number;

  @ApiPropertyOptional({ description: 'Starting bid amount' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  startingBid?: number;

  @ApiPropertyOptional({ description: 'Minimum bid increment', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  bidIncrement?: number;

  @ApiPropertyOptional({ description: 'Reserve price (minimum price to sell)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  reservePrice?: number;

  @ApiPropertyOptional({ description: 'Buy It Now price (instant purchase)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  buyItNowPrice?: number;

  @ApiPropertyOptional({ description: 'Extend auction on late bids', default: true })
  @IsOptional()
  @IsBoolean()
  extendOnBid?: boolean;
}

export class PlaceBidDto {
  @ApiProperty({ description: 'Bid amount' })
  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class SetAutoBidDto {
  @ApiProperty({ description: 'Maximum bid amount for auto-bidding' })
  @IsNumber()
  @Min(0.01)
  maxAmount: number;
}
