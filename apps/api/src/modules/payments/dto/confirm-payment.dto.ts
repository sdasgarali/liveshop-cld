import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class ConfirmPaymentDto {
  @ApiProperty({ description: 'Payment Intent ID' })
  @IsString()
  paymentIntentId: string;

  @ApiPropertyOptional({ description: 'Payment Method ID' })
  @IsOptional()
  @IsString()
  paymentMethodId?: string;
}
