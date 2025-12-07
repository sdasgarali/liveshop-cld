import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, any>;
  imageUrl?: string;
}

@Injectable()
export class PushNotificationService {
  private firebaseApp: admin.app.App | null = null;

  constructor(private readonly configService: ConfigService) {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');

    if (!projectId || !privateKey || !clientEmail) {
      console.warn('Firebase not configured - push notifications disabled');
      return;
    }

    try {
      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey: privateKey.replace(/\\n/g, '\n'),
          clientEmail,
        }),
      });
    } catch (error) {
      console.error('Firebase initialization error:', error);
    }
  }

  async sendToDevice(deviceToken: string, message: PushMessage): Promise<boolean> {
    if (!this.firebaseApp) {
      console.log('Push notification (mock):', message);
      return true;
    }

    try {
      const payload: admin.messaging.Message = {
        token: deviceToken,
        notification: {
          title: message.title,
          body: message.body,
          imageUrl: message.imageUrl,
        },
        data: message.data
          ? Object.fromEntries(
              Object.entries(message.data).map(([k, v]) => [k, String(v)]),
            )
          : undefined,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      await admin.messaging().send(payload);
      return true;
    } catch (error) {
      console.error('Push notification error:', error);
      return false;
    }
  }

  async sendToMultipleDevices(
    deviceTokens: string[],
    message: PushMessage,
  ): Promise<{ success: number; failure: number }> {
    if (!this.firebaseApp || deviceTokens.length === 0) {
      console.log('Push notification (mock) to multiple devices:', message);
      return { success: deviceTokens.length, failure: 0 };
    }

    try {
      const payload: admin.messaging.MulticastMessage = {
        tokens: deviceTokens,
        notification: {
          title: message.title,
          body: message.body,
          imageUrl: message.imageUrl,
        },
        data: message.data
          ? Object.fromEntries(
              Object.entries(message.data).map(([k, v]) => [k, String(v)]),
            )
          : undefined,
        android: {
          priority: 'high',
        },
      };

      const response = await admin.messaging().sendEachForMulticast(payload);
      return {
        success: response.successCount,
        failure: response.failureCount,
      };
    } catch (error) {
      console.error('Push notification error:', error);
      return { success: 0, failure: deviceTokens.length };
    }
  }

  async sendToTopic(topic: string, message: PushMessage): Promise<boolean> {
    if (!this.firebaseApp) {
      console.log('Push notification to topic (mock):', topic, message);
      return true;
    }

    try {
      const payload: admin.messaging.Message = {
        topic,
        notification: {
          title: message.title,
          body: message.body,
          imageUrl: message.imageUrl,
        },
        data: message.data
          ? Object.fromEntries(
              Object.entries(message.data).map(([k, v]) => [k, String(v)]),
            )
          : undefined,
      };

      await admin.messaging().send(payload);
      return true;
    } catch (error) {
      console.error('Topic notification error:', error);
      return false;
    }
  }

  async sendToUser(userId: string, message: PushMessage): Promise<boolean> {
    // In a real implementation, you'd store device tokens per user
    // and retrieve them here. For now, we'll use topic-based notifications.
    return this.sendToTopic(`user_${userId}`, message);
  }

  async subscribeToTopic(deviceToken: string, topic: string): Promise<boolean> {
    if (!this.firebaseApp) {
      return true;
    }

    try {
      await admin.messaging().subscribeToTopic([deviceToken], topic);
      return true;
    } catch (error) {
      console.error('Subscribe to topic error:', error);
      return false;
    }
  }

  async unsubscribeFromTopic(deviceToken: string, topic: string): Promise<boolean> {
    if (!this.firebaseApp) {
      return true;
    }

    try {
      await admin.messaging().unsubscribeFromTopic([deviceToken], topic);
      return true;
    } catch (error) {
      console.error('Unsubscribe from topic error:', error);
      return false;
    }
  }
}
