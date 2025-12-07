import { User } from '@prisma/client';

export interface TokenPayload {
  sub: string;
  email: string;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse extends AuthTokens {
  user: Omit<User, 'passwordHash' | 'twoFactorSecret'>;
}

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: string;
}

export interface RequestWithUser extends Request {
  user: User;
}
