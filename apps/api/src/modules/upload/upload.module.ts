import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { S3Service } from './services/s3.service';
import { ImageProcessingService } from './services/image-processing.service';

@Module({
  imports: [ConfigModule],
  controllers: [UploadController],
  providers: [UploadService, S3Service, ImageProcessingService],
  exports: [UploadService, S3Service],
})
export class UploadModule {}
