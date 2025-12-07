import { Injectable, BadRequestException } from '@nestjs/common';
import * as sharp from 'sharp';

export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

export interface ProcessedImage {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
}

export interface ThumbnailResult {
  original: ProcessedImage;
  thumbnail: ProcessedImage;
}

@Injectable()
export class ImageProcessingService {
  private readonly allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ];

  private readonly maxFileSize = 10 * 1024 * 1024; // 10MB

  validateImage(buffer: Buffer, mimeType: string): void {
    if (!this.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        `Invalid image type. Allowed types: ${this.allowedMimeTypes.join(', ')}`,
      );
    }

    if (buffer.length > this.maxFileSize) {
      throw new BadRequestException(
        `Image too large. Maximum size: ${this.maxFileSize / 1024 / 1024}MB`,
      );
    }
  }

  async processImage(
    buffer: Buffer,
    options: ImageProcessingOptions = {},
  ): Promise<ProcessedImage> {
    const {
      maxWidth = 2000,
      maxHeight = 2000,
      quality = 85,
      format = 'jpeg',
    } = options;

    const image = sharp(buffer);
    const metadata = await image.metadata();

    // Calculate resize dimensions while maintaining aspect ratio
    let width = metadata.width || maxWidth;
    let height = metadata.height || maxHeight;

    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    // Process the image
    let processedImage = image.resize(width, height, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    // Apply format and quality
    switch (format) {
      case 'jpeg':
        processedImage = processedImage.jpeg({ quality });
        break;
      case 'png':
        processedImage = processedImage.png({ quality });
        break;
      case 'webp':
        processedImage = processedImage.webp({ quality });
        break;
    }

    const processedBuffer = await processedImage.toBuffer();
    const processedMetadata = await sharp(processedBuffer).metadata();

    return {
      buffer: processedBuffer,
      contentType: `image/${format}`,
      width: processedMetadata.width || width,
      height: processedMetadata.height || height,
    };
  }

  async createThumbnail(
    buffer: Buffer,
    thumbnailSize = 300,
  ): Promise<ThumbnailResult> {
    // Process original
    const original = await this.processImage(buffer, {
      maxWidth: 2000,
      maxHeight: 2000,
      quality: 85,
    });

    // Create thumbnail
    const thumbnail = await this.processImage(buffer, {
      maxWidth: thumbnailSize,
      maxHeight: thumbnailSize,
      quality: 75,
    });

    return {
      original,
      thumbnail,
    };
  }

  async getImageMetadata(buffer: Buffer) {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: buffer.length,
      hasAlpha: metadata.hasAlpha,
    };
  }

  async convertToWebP(buffer: Buffer, quality = 85): Promise<Buffer> {
    return sharp(buffer).webp({ quality }).toBuffer();
  }

  async resizeForSocialMedia(
    buffer: Buffer,
    platform: 'instagram' | 'twitter' | 'facebook' | 'og',
  ): Promise<Buffer> {
    const dimensions = {
      instagram: { width: 1080, height: 1080 },
      twitter: { width: 1200, height: 675 },
      facebook: { width: 1200, height: 630 },
      og: { width: 1200, height: 630 },
    };

    const { width, height } = dimensions[platform];

    return sharp(buffer)
      .resize(width, height, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toBuffer();
  }
}
