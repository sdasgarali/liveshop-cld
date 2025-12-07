import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional, ValidateNested, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';

class ProductImageDto {
  @ApiProperty({ description: 'Image URL' })
  @IsUrl()
  url: string;

  @ApiProperty({ description: 'Image alt text', required: false })
  @IsOptional()
  @IsString()
  alt?: string;
}

export class AddProductImagesDto {
  @ApiProperty({ description: 'Array of images to add', type: [ProductImageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images: ProductImageDto[];
}
