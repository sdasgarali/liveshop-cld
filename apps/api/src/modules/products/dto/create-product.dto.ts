import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsEnum,
  IsArray,
  IsObject,
  Min,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductStatus, ProductCondition } from '@prisma/client';

export class CreateProductDto {
  @ApiProperty({ description: 'Product title' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: 'Product description' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Category ID' })
  @IsUUID()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ enum: ProductCondition, description: 'Product condition' })
  @IsEnum(ProductCondition)
  condition: ProductCondition;

  @ApiProperty({ description: 'Product price' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  price: number;

  @ApiPropertyOptional({ description: 'Compare at price (original/retail price)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  compareAtPrice?: number;

  @ApiPropertyOptional({ description: 'Cost price for profit calculation' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  costPrice?: number;

  @ApiPropertyOptional({ description: 'Quantity available', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  quantity?: number;

  @ApiPropertyOptional({ description: 'SKU (Stock Keeping Unit)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({ description: 'Barcode (UPC, EAN, etc.)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @ApiPropertyOptional({ description: 'Product weight' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  weight?: number;

  @ApiPropertyOptional({ description: 'Weight unit', default: 'oz' })
  @IsOptional()
  @IsString()
  weightUnit?: string;

  @ApiPropertyOptional({ description: 'Product tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Custom attributes' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @ApiPropertyOptional({ enum: ProductStatus, description: 'Product status', default: 'DRAFT' })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
