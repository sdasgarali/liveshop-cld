import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import * as jwt from 'jsonwebtoken';
import * as jwksClient from 'jwks-rsa';

export interface SocialProfile {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  avatarUrl?: string;
  emailVerified: boolean;
}

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);
  private googleClient: OAuth2Client;
  private appleJwksClient: jwksClient.JwksClient;

  constructor(private readonly configService: ConfigService) {
    this.initializeGoogleClient();
    this.initializeAppleClient();
  }

  private initializeGoogleClient() {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    if (clientId) {
      this.googleClient = new OAuth2Client(clientId);
    }
  }

  private initializeAppleClient() {
    this.appleJwksClient = jwksClient({
      jwksUri: 'https://appleid.apple.com/auth/keys',
      cache: true,
      cacheMaxAge: 86400000, // 24 hours
    });
  }

  async verifyGoogleToken(idToken: string): Promise<SocialProfile> {
    if (!this.googleClient) {
      throw new UnauthorizedException('Google authentication not configured');
    }

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new UnauthorizedException('Invalid Google token');
      }

      return {
        id: payload.sub,
        email: payload.email!,
        firstName: payload.given_name,
        lastName: payload.family_name,
        displayName: payload.name,
        avatarUrl: payload.picture,
        emailVerified: payload.email_verified || false,
      };
    } catch (error) {
      this.logger.error('Google token verification failed', error);
      throw new UnauthorizedException('Invalid Google token');
    }
  }

  async verifyAppleToken(idToken: string): Promise<SocialProfile> {
    try {
      const decoded = jwt.decode(idToken, { complete: true });
      if (!decoded || !decoded.header.kid) {
        throw new UnauthorizedException('Invalid Apple token');
      }

      const key = await this.getAppleSigningKey(decoded.header.kid);
      const verified = jwt.verify(idToken, key, {
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        audience: this.configService.get<string>('APPLE_CLIENT_ID'),
      }) as jwt.JwtPayload;

      return {
        id: verified.sub!,
        email: verified.email,
        emailVerified: verified.email_verified === 'true',
      };
    } catch (error) {
      this.logger.error('Apple token verification failed', error);
      throw new UnauthorizedException('Invalid Apple token');
    }
  }

  private async getAppleSigningKey(kid: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.appleJwksClient.getSigningKey(kid, (err, key) => {
        if (err) {
          reject(err);
        } else {
          const signingKey = key?.getPublicKey();
          if (signingKey) {
            resolve(signingKey);
          } else {
            reject(new Error('No signing key found'));
          }
        }
      });
    });
  }

  async verifyFacebookToken(accessToken: string): Promise<SocialProfile> {
    const appId = this.configService.get<string>('FACEBOOK_APP_ID');
    const appSecret = this.configService.get<string>('FACEBOOK_APP_SECRET');

    if (!appId || !appSecret) {
      throw new UnauthorizedException('Facebook authentication not configured');
    }

    try {
      // Verify token with Facebook
      const debugUrl = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${appId}|${appSecret}`;
      const debugResponse = await fetch(debugUrl);
      const debugData = await debugResponse.json();

      if (!debugData.data?.is_valid) {
        throw new UnauthorizedException('Invalid Facebook token');
      }

      // Get user profile
      const profileUrl = `https://graph.facebook.com/me?fields=id,email,first_name,last_name,name,picture&access_token=${accessToken}`;
      const profileResponse = await fetch(profileUrl);
      const profile = await profileResponse.json();

      return {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        displayName: profile.name,
        avatarUrl: profile.picture?.data?.url,
        emailVerified: true, // Facebook verifies emails
      };
    } catch (error) {
      this.logger.error('Facebook token verification failed', error);
      throw new UnauthorizedException('Invalid Facebook token');
    }
  }
}
