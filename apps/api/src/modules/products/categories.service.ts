import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto) {
    // Check if slug already exists
    const existingSlug = await this.prisma.category.findUnique({
      where: { slug: createCategoryDto.slug },
    });

    if (existingSlug) {
      throw new ConflictException('Category with this slug already exists');
    }

    // If parent is specified, verify it exists
    if (createCategoryDto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: createCategoryDto.parentId },
      });

      if (!parent) {
        throw new BadRequestException('Parent category not found');
      }
    }

    const category = await this.prisma.category.create({
      data: createCategoryDto,
      include: {
        parent: true,
        children: true,
        _count: {
          select: { products: true },
        },
      },
    });

    return category;
  }

  async findAll(includeInactive = false) {
    const where = includeInactive ? {} : { isActive: true };

    const categories = await this.prisma.category.findMany({
      where: {
        ...where,
        parentId: null, // Get only root categories
      },
      include: {
        children: {
          where,
          include: {
            children: {
              where,
              orderBy: { sortOrder: 'asc' },
            },
            _count: {
              select: { products: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: { products: true },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return categories;
  }

  async findAllFlat(includeInactive = false) {
    const where = includeInactive ? {} : { isActive: true };

    const categories = await this.prisma.category.findMany({
      where,
      include: {
        parent: {
          select: { id: true, name: true, slug: true },
        },
        _count: {
          select: { products: true },
        },
      },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }],
    });

    return categories;
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        parent: true,
        children: {
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: {
        parent: true,
        children: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto) {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    // If slug is being changed, check it doesn't conflict
    if (updateCategoryDto.slug && updateCategoryDto.slug !== category.slug) {
      const existingSlug = await this.prisma.category.findFirst({
        where: {
          slug: updateCategoryDto.slug,
          id: { not: id },
        },
      });

      if (existingSlug) {
        throw new ConflictException('Category with this slug already exists');
      }
    }

    // If parent is being changed, verify it exists and prevent circular reference
    if (updateCategoryDto.parentId) {
      if (updateCategoryDto.parentId === id) {
        throw new BadRequestException('Category cannot be its own parent');
      }

      const parent = await this.prisma.category.findUnique({
        where: { id: updateCategoryDto.parentId },
      });

      if (!parent) {
        throw new BadRequestException('Parent category not found');
      }

      // Check for circular reference
      const isDescendant = await this.isDescendant(updateCategoryDto.parentId, id);
      if (isDescendant) {
        throw new BadRequestException('Cannot set a descendant as parent');
      }
    }

    const updatedCategory = await this.prisma.category.update({
      where: { id },
      data: updateCategoryDto,
      include: {
        parent: true,
        children: true,
        _count: {
          select: { products: true },
        },
      },
    });

    return updatedCategory;
  }

  async remove(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        children: true,
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (category.children.length > 0) {
      throw new BadRequestException('Cannot delete category with subcategories');
    }

    if (category._count.products > 0) {
      throw new BadRequestException('Cannot delete category with products');
    }

    await this.prisma.category.delete({ where: { id } });

    return { message: 'Category deleted successfully' };
  }

  async getCategoryPath(id: string): Promise<any[]> {
    const path: any[] = [];
    let currentId: string | null = id;

    while (currentId) {
      const category = await this.prisma.category.findUnique({
        where: { id: currentId },
        select: { id: true, name: true, slug: true, parentId: true },
      });

      if (!category) break;

      path.unshift(category);
      currentId = category.parentId;
    }

    return path;
  }

  async getPopularCategories(limit = 10) {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: {
        products: {
          _count: 'desc',
        },
      },
      take: limit,
    });

    return categories;
  }

  async seedDefaultCategories() {
    const defaultCategories = [
      {
        name: 'Collectibles & Trading Cards',
        slug: 'collectibles-trading-cards',
        description: 'Trading cards, sports cards, and collectible items',
        children: [
          { name: 'Trading Cards', slug: 'trading-cards', description: 'Pokemon, Magic, Yu-Gi-Oh cards' },
          { name: 'Sports Cards', slug: 'sports-cards', description: 'Baseball, basketball, football cards' },
          { name: 'Comics', slug: 'comics', description: 'Comic books and graphic novels' },
          { name: 'Coins & Currency', slug: 'coins-currency', description: 'Collectible coins and paper money' },
        ],
      },
      {
        name: 'Fashion & Apparel',
        slug: 'fashion-apparel',
        description: 'Clothing, shoes, and accessories',
        children: [
          { name: 'Mens Clothing', slug: 'mens-clothing', description: 'Mens fashion and apparel' },
          { name: 'Womens Clothing', slug: 'womens-clothing', description: 'Womens fashion and apparel' },
          { name: 'Sneakers', slug: 'sneakers', description: 'Athletic and casual footwear' },
          { name: 'Accessories', slug: 'accessories', description: 'Bags, watches, jewelry' },
        ],
      },
      {
        name: 'Electronics',
        slug: 'electronics',
        description: 'Tech gadgets and electronics',
        children: [
          { name: 'Gaming', slug: 'gaming', description: 'Consoles, games, and accessories' },
          { name: 'Phones & Tablets', slug: 'phones-tablets', description: 'Mobile devices' },
          { name: 'Computers', slug: 'computers', description: 'Laptops, desktops, and parts' },
          { name: 'Audio', slug: 'audio', description: 'Headphones, speakers, and audio gear' },
        ],
      },
      {
        name: 'Toys & Hobbies',
        slug: 'toys-hobbies',
        description: 'Toys, action figures, and hobby items',
        children: [
          { name: 'Action Figures', slug: 'action-figures', description: 'Collectible action figures' },
          { name: 'LEGO', slug: 'lego', description: 'LEGO sets and minifigures' },
          { name: 'Funko Pop', slug: 'funko-pop', description: 'Funko Pop vinyl figures' },
          { name: 'Model Kits', slug: 'model-kits', description: 'Model kits and dioramas' },
        ],
      },
      {
        name: 'Sports Memorabilia',
        slug: 'sports-memorabilia',
        description: 'Sports collectibles and memorabilia',
        children: [
          { name: 'Autographs', slug: 'autographs', description: 'Signed items and autographs' },
          { name: 'Game-Used Items', slug: 'game-used', description: 'Game-worn and game-used items' },
          { name: 'Jerseys', slug: 'jerseys', description: 'Sports jerseys and uniforms' },
        ],
      },
      {
        name: 'Home & Garden',
        slug: 'home-garden',
        description: 'Home decor and garden items',
        children: [
          { name: 'Home Decor', slug: 'home-decor', description: 'Decorative items for home' },
          { name: 'Furniture', slug: 'furniture', description: 'Home and office furniture' },
          { name: 'Garden', slug: 'garden', description: 'Garden tools and plants' },
        ],
      },
    ];

    for (let i = 0; i < defaultCategories.length; i++) {
      const cat = defaultCategories[i];
      const parent = await this.prisma.category.upsert({
        where: { slug: cat.slug },
        update: {},
        create: {
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          sortOrder: i,
        },
      });

      if (cat.children) {
        for (let j = 0; j < cat.children.length; j++) {
          const child = cat.children[j];
          await this.prisma.category.upsert({
            where: { slug: child.slug },
            update: {},
            create: {
              name: child.name,
              slug: child.slug,
              description: child.description,
              parentId: parent.id,
              sortOrder: j,
            },
          });
        }
      }
    }

    return { message: 'Default categories seeded successfully' };
  }

  private async isDescendant(potentialDescendantId: string, ancestorId: string): Promise<boolean> {
    let currentId: string | null = potentialDescendantId;

    while (currentId) {
      const category = await this.prisma.category.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });

      if (!category) return false;
      if (category.parentId === ancestorId) return true;
      currentId = category.parentId;
    }

    return false;
  }
}
