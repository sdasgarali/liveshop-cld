import { Injectable, BadRequestException } from '@nestjs/common';
import { S3Service, UploadResult } from './services/s3.service';
import { ImageProcessingService } from './services/image-processing.service';

export interface UploadOptions {
  folder?: string;
  generateThumbnail?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

export interface ImageUploadResult {
  original: UploadResult;
  thumbnail?: UploadResult;
}

@Injectable()
export class UploadService {
  constructor(
    private readonly s3Service: S3Service,
    private readonly imageProcessingService: ImageProcessingService,
  ) {}

  async uploadImage(
    file: Express.Multer.File,
    options: UploadOptions = {},
  ): Promise<ImageUploadResult> {
    const {
      folder = 'images',
      generateThumbnail = true,
      maxWidth,
      maxHeight,
      quality,
    } = options;

    // Validate image
    this.imageProcessingService.validateImage(file.buffer, file.mimetype);

    if (generateThumbnail) {
      // Create original and thumbnail
      const { original, thumbnail } = await this.imageProcessingService.createThumbnail(
        file.buffer,
        300,
      );

      const [originalResult, thumbnailResult] = await Promise.all([
        this.s3Service.upload(
          original.buffer,
          file.originalname,
          original.contentType,
          folder,
        ),
        this.s3Service.upload(
          thumbnail.buffer,
          `thumb_${file.originalname}`,
          thumbnail.contentType,
          `${folder}/thumbnails`,
        ),
      ]);

      return {
        original: originalResult,
        thumbnail: thumbnailResult,
      };
    } else {
      // Process without thumbnail
      const processed = await this.imageProcessingService.processImage(file.buffer, {
        maxWidth,
        maxHeight,
        quality,
      });

      const result = await this.s3Service.upload(
        processed.buffer,
        file.originalname,
        processed.contentType,
        folder,
      );

      return { original: result };
    }
  }

  async uploadProductImage(file: Express.Multer.File, productId: string): Promise<ImageUploadResult> {
    return this.uploadImage(file, {
      folder: `products/${productId}`,
      generateThumbnail: true,
    });
  }

  async uploadAvatar(file: Express.Multer.File, userId: string): Promise<UploadResult> {
    this.imageProcessingService.validateImage(file.buffer, file.mimetype);

    const processed = await this.imageProcessingService.processImage(file.buffer, {
      maxWidth: 500,
      maxHeight: 500,
      quality: 85,
    });

    return this.s3Service.upload(
      processed.buffer,
      file.originalname,
      processed.contentType,
      `avatars/${userId}`,
    );
  }

  async uploadBanner(file: Express.Multer.File, userId: string): Promise<UploadResult> {
    this.imageProcessingService.validateImage(file.buffer, file.mimetype);

    const processed = await this.imageProcessingService.processImage(file.buffer, {
      maxWidth: 1500,
      maxHeight: 500,
      quality: 85,
    });

    return this.s3Service.upload(
      processed.buffer,
      file.originalname,
      processed.contentType,
      `banners/${userId}`,
    );
  }

  async uploadStreamThumbnail(file: Express.Multer.File, streamId: string): Promise<UploadResult> {
    this.imageProcessingService.validateImage(file.buffer, file.mimetype);

    const processed = await this.imageProcessingService.processImage(file.buffer, {
      maxWidth: 1280,
      maxHeight: 720,
      quality: 85,
    });

    return this.s3Service.upload(
      processed.buffer,
      file.originalname,
      processed.contentType,
      `streams/${streamId}`,
    );
  }

  async uploadFromUrl(url: string, folder = 'uploads'): Promise<UploadResult> {
    return this.s3Service.uploadFromUrl(url, folder);
  }

  async deleteFile(url: string): Promise<void> {
    const key = this.s3Service.getKeyFromUrl(url);
    if (key) {
      await this.s3Service.delete(key);
    }
  }

  async getPresignedUploadUrl(
    filename: string,
    folder: string,
    contentType?: string,
  ) {
    return this.s3Service.getPresignedUploadUrl(filename, folder, { contentType });
  }

  validateFileSize(size: number, maxSizeMB = 10): void {
    const maxSize = maxSizeMB * 1024 * 1024;
    if (size > maxSize) {
      throw new BadRequestException(`File too large. Maximum size: ${maxSizeMB}MB`);
    }
  }
}
