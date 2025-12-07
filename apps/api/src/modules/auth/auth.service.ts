import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/services/prisma.service';
import { RedisService } from '@/common/services/redis.service';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthResponse, TokenPayload } from './interfaces/auth.interface';
import { User, UserStatus, AuthProvider } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private configService: ConfigService,
    private tokenService: TokenService,
    private passwordService: PasswordService,
    private usersService: UsersService,
  ) {}

  async register(dto: RegisterDto, ipAddress: string): Promise<AuthResponse> {
    const existingEmail = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    const existingUsername = await this.prisma.user.findUnique({
      where: { username: dto.username.toLowerCase() },
    });

    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        username: dto.username.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: dto.displayName || dto.username,
        authProvider: AuthProvider.EMAIL,
        status: UserStatus.PENDING_VERIFICATION,
      },
    });

    await this.sendVerificationEmail(user);

    const tokens = await this.tokenService.generateTokens(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken, ipAddress);

    this.logger.log(`New user registered: ${user.email}`);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async login(dto: LoginDto, ipAddress: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email.toLowerCase() },
          { username: dto.email.toLowerCase() },
        ],
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.passwordService.verify(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      await this.recordFailedLogin(user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.BANNED) {
      throw new UnauthorizedException('Account has been banned');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account is suspended');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
      },
    });

    const tokens = await this.tokenService.generateTokens(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken, ipAddress);

    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async refreshTokens(dto: RefreshTokenDto, ipAddress: string): Promise<AuthResponse> {
    const payload = await this.tokenService.verifyRefreshToken(dto.refreshToken);

    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        token: dto.refreshToken,
        userId: payload.sub,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });

    const tokens = await this.tokenService.generateTokens(storedToken.user);
    await this.saveRefreshToken(storedToken.userId, tokens.refreshToken, ipAddress);

    return {
      user: this.sanitizeUser(storedToken.user),
      ...tokens,
    };
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId, token: refreshToken },
      });
    } else {
      await this.prisma.refreshToken.deleteMany({
        where: { userId },
      });
    }

    await this.redis.del(`user:session:${userId}`);
  }

  async logoutAllDevices(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    await this.redis.del(`user:session:${userId}`);
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      return;
    }

    const resetToken = uuidv4();
    const hashedToken = await this.passwordService.hash(resetToken);

    await this.redis.set(
      `password-reset:${user.id}`,
      hashedToken,
      3600, // 1 hour
    );

    await this.sendPasswordResetEmail(user, resetToken);

    this.logger.log(`Password reset requested for: ${user.email}`);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new BadRequestException('Invalid reset request');
    }

    const storedToken = await this.redis.get(`password-reset:${user.id}`);

    if (!storedToken) {
      throw new BadRequestException('Reset token expired or invalid');
    }

    const isValid = await this.passwordService.verify(dto.token, storedToken);

    if (!isValid) {
      throw new BadRequestException('Invalid reset token');
    }

    const passwordHash = await this.passwordService.hash(dto.newPassword);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await this.redis.del(`password-reset:${user.id}`);
    await this.logoutAllDevices(user.id);

    this.logger.log(`Password reset completed for: ${user.email}`);
  }

  async verifyEmail(userId: string, token: string): Promise<void> {
    const storedToken = await this.redis.get(`email-verify:${userId}`);

    if (!storedToken || storedToken !== token) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        status: UserStatus.ACTIVE,
      },
    });

    await this.redis.del(`email-verify:${userId}`);
  }

  async resendVerificationEmail(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    await this.sendVerificationEmail(user);
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user || !user.passwordHash) {
      return null;
    }

    const isValid = await this.passwordService.verify(password, user.passwordHash);

    if (!isValid) {
      return null;
    }

    return user;
  }

  async getUserFromToken(payload: TokenPayload): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
  }

  private async saveRefreshToken(
    userId: string,
    token: string,
    ipAddress: string,
  ): Promise<void> {
    const expiresIn = this.configService.get<string>('jwt.refreshExpiresIn') || '7d';
    const expiresAt = this.calculateExpiry(expiresIn);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token,
        ipAddress,
        expiresAt,
      },
    });

    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        expiresAt: { lt: new Date() },
      },
    });
  }

  private calculateExpiry(duration: string): Date {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + value * multipliers[unit]);
  }

  private async sendVerificationEmail(user: User): Promise<void> {
    const token = uuidv4();
    await this.redis.set(`email-verify:${user.id}`, token, 86400); // 24 hours

    // TODO: Implement email sending with SendGrid
    this.logger.log(`Verification email would be sent to: ${user.email}`);
  }

  private async sendPasswordResetEmail(user: User, token: string): Promise<void> {
    // TODO: Implement email sending with SendGrid
    this.logger.log(`Password reset email would be sent to: ${user.email}`);
  }

  private async recordFailedLogin(userId: string): Promise<void> {
    const key = `failed-login:${userId}`;
    const attempts = await this.redis.incr(key);

    if (attempts === 1) {
      await this.redis.expire(key, 3600); // Reset after 1 hour
    }

    if (attempts >= 5) {
      this.logger.warn(`Multiple failed login attempts for user: ${userId}`);
    }
  }

  private sanitizeUser(user: User) {
    const { passwordHash, twoFactorSecret, ...sanitized } = user;
    return sanitized;
  }
}
