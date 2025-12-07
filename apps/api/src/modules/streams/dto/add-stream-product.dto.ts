import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsNumber, Min } from 'class-validator';

export class AddStreamProductDto {
  @ApiProperty({ example: 'uuid-of-product' })
  @IsUUID()
  productId: string;

  @ApiPropertyOptional({ example: 10.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  startingBid?: number;

  @ApiPropertyOptional({ example: 1.0, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  bidIncrement?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;
}
