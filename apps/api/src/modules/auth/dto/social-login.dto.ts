import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional } from 'class-validator';

export enum SocialProvider {
  GOOGLE = 'GOOGLE',
  APPLE = 'APPLE',
  FACEBOOK = 'FACEBOOK',
}

export class SocialLoginDto {
  @ApiProperty({ description: 'OAuth provider', enum: SocialProvider })
  @IsEnum(SocialProvider)
  provider: SocialProvider;

  @ApiProperty({ description: 'OAuth ID token or access token' })
  @IsString()
  token: string;

  @ApiPropertyOptional({ description: 'Authorization code (for Apple Sign-In)' })
  @IsOptional()
  @IsString()
  authorizationCode?: string;

  @ApiPropertyOptional({ description: 'First name (optional, from provider)' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name (optional, from provider)' })
  @IsOptional()
  @IsString()
  lastName?: string;
}
