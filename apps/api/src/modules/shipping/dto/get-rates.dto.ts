import { ApiProperty } from '@nestjs/swagger';
import { IsObject, ValidateNested, IsNumber, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

class AddressDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  street1: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  street2?: string;

  @ApiProperty()
  @IsString()
  city: string;

  @ApiProperty()
  @IsString()
  state: string;

  @ApiProperty()
  @IsString()
  zip: string;

  @ApiProperty()
  @IsString()
  country: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  email?: string;
}

class ParcelDto {
  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  length: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  width: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  height: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  weight: number;

  @ApiProperty({ required: false, enum: ['in', 'cm'] })
  @IsOptional()
  @IsString()
  distanceUnit?: 'in' | 'cm';

  @ApiProperty({ required: false, enum: ['oz', 'lb', 'g', 'kg'] })
  @IsOptional()
  @IsString()
  massUnit?: 'oz' | 'lb' | 'g' | 'kg';
}

export class GetRatesDto {
  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  fromAddress: AddressDto;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  toAddress: AddressDto;

  @ApiProperty({ type: ParcelDto })
  @ValidateNested()
  @Type(() => ParcelDto)
  parcel: ParcelDto;
}
