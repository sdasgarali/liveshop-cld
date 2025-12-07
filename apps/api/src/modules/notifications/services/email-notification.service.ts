import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class EmailNotificationService {
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SENDGRID_API_KEY') || '';
    this.fromEmail = this.configService.get<string>('FROM_EMAIL') || 'noreply@liveshop.com';
    this.fromName = this.configService.get<string>('FROM_NAME') || 'LiveShop';
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.apiKey) {
      console.log('Email (mock):', options);
      return true;
    }

    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { email: this.fromEmail, name: this.fromName },
          subject: options.subject,
          content: [
            { type: 'text/plain', value: options.text || options.html },
            { type: 'text/html', value: options.html },
          ],
        }),
      });

      return response.ok;
    } catch (error) {
      console.error('SendGrid error:', error);
      return false;
    }
  }

  async sendWelcomeEmail(email: string, name: string): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Welcome to LiveShop!',
      html: `
        <h1>Welcome to LiveShop, ${name}!</h1>
        <p>We're excited to have you join our live shopping community.</p>
        <p>Start exploring live streams, discover unique products, and connect with amazing sellers.</p>
        <a href="${this.configService.get('FRONTEND_URL')}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Start Shopping</a>
      `,
    });
  }

  async sendPasswordResetEmail(email: string, resetToken: string): Promise<boolean> {
    const resetUrl = `${this.configService.get('FRONTEND_URL')}/reset-password?token=${resetToken}`;

    return this.sendEmail({
      to: email,
      subject: 'Reset Your LiveShop Password',
      html: `
        <h1>Password Reset Request</h1>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <a href="${resetUrl}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Reset Password</a>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
    });
  }

  async sendOrderConfirmationEmail(
    email: string,
    orderNumber: string,
    total: number,
    items: { title: string; quantity: number; price: number }[],
  ): Promise<boolean> {
    const itemsHtml = items
      .map(
        (item) =>
          `<tr>
            <td>${item.title}</td>
            <td>${item.quantity}</td>
            <td>$${item.price.toFixed(2)}</td>
          </tr>`,
      )
      .join('');

    return this.sendEmail({
      to: email,
      subject: `Order Confirmed - ${orderNumber}`,
      html: `
        <h1>Order Confirmed!</h1>
        <p>Thank you for your order. Your order number is <strong>${orderNumber}</strong>.</p>
        <h2>Order Details</h2>
        <table border="1" cellpadding="8" cellspacing="0">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2"><strong>Total</strong></td>
              <td><strong>$${total.toFixed(2)}</strong></td>
            </tr>
          </tfoot>
        </table>
        <p>We'll send you another email when your order ships.</p>
      `,
    });
  }

  async sendShippingNotificationEmail(
    email: string,
    orderNumber: string,
    trackingNumber: string,
    carrier: string,
    trackingUrl: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: `Your Order Has Shipped - ${orderNumber}`,
      html: `
        <h1>Your Order Has Shipped!</h1>
        <p>Great news! Your order <strong>${orderNumber}</strong> is on its way.</p>
        <h2>Tracking Information</h2>
        <p><strong>Carrier:</strong> ${carrier}</p>
        <p><strong>Tracking Number:</strong> ${trackingNumber}</p>
        <a href="${trackingUrl}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Track Your Package</a>
      `,
    });
  }

  async sendStreamReminderEmail(
    email: string,
    hostName: string,
    streamTitle: string,
    streamUrl: string,
    startTime: Date,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: `${hostName} is going live soon!`,
      html: `
        <h1>${hostName} is going live!</h1>
        <p><strong>${streamTitle}</strong></p>
        <p>Starting at ${startTime.toLocaleString()}</p>
        <a href="${streamUrl}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Join the Stream</a>
      `,
    });
  }
}
