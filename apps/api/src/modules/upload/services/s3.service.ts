import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

export interface UploadResult {
  key: string;
  url: string;
  bucket: string;
  size: number;
  contentType: string;
}

export interface PresignedUrlOptions {
  expiresIn?: number;
  contentType?: string;
}

@Injectable()
export class S3Service {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly cdnUrl: string;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    this.bucket = this.configService.get<string>('AWS_S3_BUCKET') || 'liveshop-uploads';
    this.cdnUrl = this.configService.get<string>('CDN_URL') || '';

    // Support MinIO for local development
    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');
    const forcePathStyle = this.configService.get<boolean>('AWS_S3_FORCE_PATH_STYLE') || !!endpoint;

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
      },
      ...(endpoint && { endpoint }),
      forcePathStyle,
    });
  }

  async upload(
    file: Buffer,
    originalName: string,
    contentType: string,
    folder = 'uploads',
  ): Promise<UploadResult> {
    const ext = path.extname(originalName);
    const key = `${folder}/${uuidv4()}${ext}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file,
          ContentType: contentType,
          ACL: 'public-read',
        }),
      );

      const url = this.getPublicUrl(key);

      return {
        key,
        url,
        bucket: this.bucket,
        size: file.length,
        contentType,
      };
    } catch (error) {
      console.error('S3 upload error:', error);
      throw new InternalServerErrorException('Failed to upload file');
    }
  }

  async uploadFromUrl(
    sourceUrl: string,
    folder = 'uploads',
  ): Promise<UploadResult> {
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const urlPath = new URL(sourceUrl).pathname;
      const ext = path.extname(urlPath) || '.jpg';

      return this.upload(buffer, `file${ext}`, contentType, folder);
    } catch (error) {
      console.error('Upload from URL error:', error);
      throw new InternalServerErrorException('Failed to upload file from URL');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      console.error('S3 delete error:', error);
      throw new InternalServerErrorException('Failed to delete file');
    }
  }

  async getPresignedUploadUrl(
    filename: string,
    folder = 'uploads',
    options: PresignedUrlOptions = {},
  ): Promise<{ uploadUrl: string; key: string; publicUrl: string }> {
    const ext = path.extname(filename);
    const key = `${folder}/${uuidv4()}${ext}`;
    const { expiresIn = 3600, contentType } = options;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(contentType && { ContentType: contentType }),
        ACL: 'public-read',
      });

      const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

      return {
        uploadUrl,
        key,
        publicUrl: this.getPublicUrl(key),
      };
    } catch (error) {
      console.error('Presigned URL error:', error);
      throw new InternalServerErrorException('Failed to generate upload URL');
    }
  }

  async getPresignedDownloadUrl(
    key: string,
    expiresIn = 3600,
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      return getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      console.error('Presigned download URL error:', error);
      throw new InternalServerErrorException('Failed to generate download URL');
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  getPublicUrl(key: string): string {
    if (this.cdnUrl) {
      return `${this.cdnUrl}/${key}`;
    }

    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');
    if (endpoint) {
      // MinIO URL format
      return `${endpoint}/${this.bucket}/${key}`;
    }

    // Standard S3 URL format
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  getKeyFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // Handle different URL formats
      if (pathname.startsWith(`/${this.bucket}/`)) {
        // MinIO format: /bucket/key
        return pathname.substring(this.bucket.length + 2);
      } else if (pathname.startsWith('/')) {
        // Standard S3 format: /key
        return pathname.substring(1);
      }

      return pathname;
    } catch {
      return null;
    }
  }
}
