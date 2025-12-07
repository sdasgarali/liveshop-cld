import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { MobileAuthController } from './mobile-auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { SocialAuthService } from './services/social-auth.service';
import { DeviceService } from './services/device.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    UsersModule,
    NotificationsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessExpiresIn'),
        },
      }),
    }),
  ],
  controllers: [AuthController, MobileAuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    SocialAuthService,
    DeviceService,
    JwtStrategy,
    LocalStrategy,
  ],
  exports: [AuthService, TokenService, DeviceService],
})
export class AuthModule {}
