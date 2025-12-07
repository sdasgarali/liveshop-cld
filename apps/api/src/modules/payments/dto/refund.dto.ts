import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsNumber, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RefundDto {
  @ApiProperty({ description: 'Order ID' })
  @IsUUID()
  orderId: string;

  @ApiPropertyOptional({ description: 'Refund amount (partial refund)' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount?: number;

  @ApiPropertyOptional({ description: 'Refund reason' })
  @IsOptional()
  @IsString()
  reason?: string;
}
