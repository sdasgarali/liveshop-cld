import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsString } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty({ description: 'Order ID' })
  @IsUUID()
  orderId: string;

  @ApiPropertyOptional({ description: 'Payment method ID (if already saved)' })
  @IsOptional()
  @IsString()
  paymentMethodId?: string;
}
