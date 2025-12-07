import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { WatchlistService } from './services/watchlist.service';
import { ProductSearchService } from './services/product-search.service';
import { PrismaService } from '../../common/prisma.service';
import { UploadModule } from '../upload/upload.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [UploadModule, AiModule],
  controllers: [ProductsController, CategoriesController],
  providers: [
    ProductsService,
    CategoriesService,
    WatchlistService,
    ProductSearchService,
    PrismaService,
  ],
  exports: [ProductsService, CategoriesService],
})
export class ProductsModule {}
