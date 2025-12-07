# LiveShop - Live Shopping Marketplace

A real-time live shopping marketplace similar to Whatnot, with enhanced AI-powered features.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development environment
pnpm docker:dev

# Run database migrations
pnpm db:migrate:dev

# Start all services
pnpm dev
```

## Architecture

```
liveshop/
├── apps/
│   ├── api/          # NestJS Backend API
│   ├── web/          # Next.js Web Application
│   └── mobile/       # React Native (Expo) Mobile App
├── packages/
│   └── shared/       # Shared types and utilities
├── services/
│   └── worker/       # Background job workers
├── docker/           # Docker configurations
└── docs/             # Documentation
```

## Tech Stack

### Backend
- **Runtime**: Node.js 20
- **Framework**: NestJS 10
- **Database**: PostgreSQL 16 with pgvector
- **Cache**: Redis 7
- **ORM**: Prisma 5
- **Auth**: JWT + Argon2

### Frontend
- **Web**: Next.js 14, Tailwind CSS
- **Mobile**: React Native (Expo), NativeWind
- **State**: Zustand + React Query
- **Real-time**: Socket.IO

### AI/ML
- **LLM**: OpenAI GPT-4
- **Embeddings**: text-embedding-3-small
- **Vector Search**: Pinecone
- **Vision**: GPT-4 Vision

### Infrastructure
- **Containers**: Docker
- **CI/CD**: GitHub Actions
- **Storage**: AWS S3
- **Streaming**: NGINX-RTMP

## Features

### Core Features
- [x] User authentication (email, social)
- [x] Seller profiles and verification
- [x] Product catalog with categories
- [x] Live streaming with RTMP/HLS
- [x] Real-time bidding
- [x] Chat during streams
- [x] Order management
- [ ] Payment processing (Stripe Connect)
- [ ] Shipping integration

### AI Features
- [x] Auto-generate product descriptions
- [x] Image-based product listing
- [x] Smart pricing suggestions
- [x] Semantic product search
- [x] AI seller assistant
- [x] Content moderation
- [ ] Personalized recommendations

## Development

### Prerequisites
- Node.js 20+
- pnpm 8+
- Docker & Docker Compose
- PostgreSQL 16 (via Docker)
- Redis 7 (via Docker)

### Environment Setup

1. Copy environment files:
```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

2. Configure environment variables

3. Start services:
```bash
pnpm docker:dev
pnpm dev
```

### API Documentation

Swagger UI available at: `http://localhost:3001/api/docs`

### Database

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate:dev

# Open Prisma Studio
pnpm db:studio
```

## Deployment

### Docker Production

```bash
docker-compose -f docker/docker-compose.prod.yml up -d
```

### Environment Variables

See `apps/api/.env.example` for required variables.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [90-Day Roadmap](docs/ROADMAP.md)
- [API Reference](http://localhost:3001/api/docs)

## License

Private - All Rights Reserved

---

Built with modern technologies for real-time commerce.
