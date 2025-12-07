import {
  Controller,
  Post,
  Delete,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SocialAuthService } from './services/social-auth.service';
import { DeviceService } from './services/device.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { SocialLoginDto, SocialProvider } from './dto/social-login.dto';
import { RegisterDeviceDto, UpdateNotificationPreferencesDto } from './dto/register-device.dto';
import { PrismaService } from '../../common/services/prisma.service';
import { AuthProvider, UserStatus } from '@prisma/client';
import { TokenService } from './services/token.service';

@ApiTags('mobile-auth')
@Controller({ path: 'auth/mobile', version: '1' })
@UseGuards(ThrottlerGuard)
export class MobileAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly socialAuthService: SocialAuthService,
    private readonly deviceService: DeviceService,
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('social')
  @Public()
  @ApiOperation({ summary: 'Login or register with social provider (Google, Apple, Facebook)' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid token' })
  async socialLogin(@Body() dto: SocialLoginDto, @Req() req: Request) {
    const ipAddress = req.ip || req.socket.remoteAddress || '';

    // Verify the social token
    let socialProfile;
    switch (dto.provider) {
      case SocialProvider.GOOGLE:
        socialProfile = await this.socialAuthService.verifyGoogleToken(dto.token);
        break;
      case SocialProvider.APPLE:
        socialProfile = await this.socialAuthService.verifyAppleToken(dto.token);
        break;
      case SocialProvider.FACEBOOK:
        socialProfile = await this.socialAuthService.verifyFacebookToken(dto.token);
        break;
    }

    // Check if user exists with this provider ID
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { authProviderId: socialProfile.id, authProvider: dto.provider as unknown as AuthProvider },
          { email: socialProfile.email.toLowerCase() },
        ],
      },
    });

    if (user) {
      // Update user with provider info if needed
      if (!user.authProviderId || user.authProvider === AuthProvider.EMAIL) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            authProvider: dto.provider as unknown as AuthProvider,
            authProviderId: socialProfile.id,
            emailVerified: socialProfile.emailVerified || user.emailVerified,
            avatarUrl: user.avatarUrl || socialProfile.avatarUrl,
            status: socialProfile.emailVerified ? UserStatus.ACTIVE : user.status,
          },
        });
      }

      // Update last login
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginIp: ipAddress,
        },
      });
    } else {
      // Create new user
      const username = await this.generateUniqueUsername(
        socialProfile.email.split('@')[0],
      );

      user = await this.prisma.user.create({
        data: {
          email: socialProfile.email.toLowerCase(),
          username,
          firstName: dto.firstName || socialProfile.firstName,
          lastName: dto.lastName || socialProfile.lastName,
          displayName: socialProfile.displayName || dto.firstName || username,
          avatarUrl: socialProfile.avatarUrl,
          authProvider: dto.provider as unknown as AuthProvider,
          authProviderId: socialProfile.id,
          emailVerified: socialProfile.emailVerified,
          status: socialProfile.emailVerified ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION,
        },
      });
    }

    // Generate tokens
    const tokens = await this.tokenService.generateTokens(user);

    // Save refresh token
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        ipAddress,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Sanitize user
    const { passwordHash, twoFactorSecret, ...sanitizedUser } = user;

    return {
      user: sanitizedUser,
      ...tokens,
    };
  }

  private async generateUniqueUsername(base: string): Promise<string> {
    const sanitized = base.toLowerCase().replace(/[^a-z0-9]/g, '');
    let username = sanitized;
    let counter = 1;

    while (true) {
      const existing = await this.prisma.user.findUnique({
        where: { username },
      });

      if (!existing) {
        return username;
      }

      username = `${sanitized}${counter}`;
      counter++;
    }
  }

  @Post('device')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Register device for push notifications' })
  @ApiResponse({ status: 200, description: 'Device registered' })
  async registerDevice(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    const device = await this.deviceService.registerDevice(userId, dto);
    return { message: 'Device registered successfully', device };
  }

  @Delete('device')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Unregister device from push notifications' })
  @ApiResponse({ status: 200, description: 'Device unregistered' })
  async unregisterDevice(
    @CurrentUser('id') userId: string,
    @Body('pushToken') pushToken: string,
  ) {
    await this.deviceService.unregisterDevice(userId, pushToken);
    return { message: 'Device unregistered successfully' };
  }

  @Get('devices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get all registered devices' })
  @ApiResponse({ status: 200, description: 'List of devices' })
  async getDevices(@CurrentUser('id') userId: string) {
    const devices = await this.deviceService.getUserDevices(userId);
    return { devices };
  }

  @Delete('devices/:deviceId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Remove a specific device' })
  @ApiResponse({ status: 200, description: 'Device removed' })
  async removeDevice(
    @CurrentUser('id') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    await this.deviceService.removeDevice(userId, deviceId);
    return { message: 'Device removed successfully' };
  }

  @Post('biometric/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Enable biometric authentication' })
  @ApiResponse({ status: 200, description: 'Biometric auth enabled' })
  async enableBiometric(
    @CurrentUser('id') userId: string,
    @Body('deviceId') deviceId: string,
  ) {
    // Generate a long-lived token specifically for biometric auth
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // Create biometric token (longer expiry)
    const biometricToken = await this.tokenService.generateTokens(user, {
      accessExpiresIn: '30d',
      refreshExpiresIn: '90d',
    });

    // Store the biometric key association
    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: biometricToken.refreshToken,
        deviceInfo: `biometric:${deviceId}`,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      },
    });

    return {
      message: 'Biometric authentication enabled',
      biometricToken: biometricToken.refreshToken,
    };
  }

  @Post('biometric/authenticate')
  @Public()
  @ApiOperation({ summary: 'Authenticate using biometric token' })
  @ApiResponse({ status: 200, description: 'Authentication successful' })
  async biometricAuthenticate(
    @Body('biometricToken') biometricToken: string,
    @Body('deviceId') deviceId: string,
    @Req() req: Request,
  ) {
    const ipAddress = req.ip || req.socket.remoteAddress || '';

    // Find the biometric token
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        token: biometricToken,
        deviceInfo: { startsWith: 'biometric:' },
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!storedToken) {
      throw new Error('Invalid or expired biometric token');
    }

    // Verify device ID matches
    const storedDeviceId = storedToken.deviceInfo?.replace('biometric:', '');
    if (storedDeviceId !== deviceId) {
      throw new Error('Device mismatch');
    }

    // Generate new tokens
    const tokens = await this.tokenService.generateTokens(storedToken.user);

    // Update last login
    await this.prisma.user.update({
      where: { id: storedToken.userId },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
      },
    });

    const { passwordHash, twoFactorSecret, ...sanitizedUser } = storedToken.user;

    return {
      user: sanitizedUser,
      ...tokens,
    };
  }

  @Post('biometric/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Disable biometric authentication' })
  @ApiResponse({ status: 200, description: 'Biometric auth disabled' })
  async disableBiometric(
    @CurrentUser('id') userId: string,
    @Body('deviceId') deviceId: string,
  ) {
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        deviceInfo: `biometric:${deviceId}`,
      },
    });

    return { message: 'Biometric authentication disabled' };
  }
}
