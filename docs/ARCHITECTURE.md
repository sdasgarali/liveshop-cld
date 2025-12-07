# LiveShop Architecture Documentation

## System Architecture Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[Next.js Web App]
        IOS[iOS App - React Native]
        ANDROID[Android App - React Native]
    end

    subgraph "API Gateway / Load Balancer"
        NGINX[NGINX / AWS ALB]
    end

    subgraph "Application Layer"
        API[NestJS API Server]
        WS[WebSocket Server]
        WORKER[Background Workers]
    end

    subgraph "Streaming Infrastructure"
        RTMP[RTMP Ingest Server]
        HLS[HLS Delivery CDN]
        MEDIA[Media Processing]
    end

    subgraph "Data Layer"
        PG[(PostgreSQL + pgvector)]
        REDIS[(Redis Cache & Pub/Sub)]
        PINECONE[(Pinecone Vector DB)]
        S3[(AWS S3 / MinIO)]
    end

    subgraph "External Services"
        STRIPE[Stripe Payments]
        SENDGRID[SendGrid Email]
        OPENAI[OpenAI GPT-4]
        PUSH[Push Notifications]
    end

    WEB --> NGINX
    IOS --> NGINX
    ANDROID --> NGINX

    NGINX --> API
    NGINX --> WS

    API --> PG
    API --> REDIS
    API --> PINECONE
    API --> S3
    API --> STRIPE
    API --> SENDGRID
    API --> OPENAI

    WS --> REDIS

    WORKER --> PG
    WORKER --> REDIS
    WORKER --> OPENAI

    RTMP --> MEDIA
    MEDIA --> HLS
    HLS --> WEB
    HLS --> IOS
    HLS --> ANDROID
```

## Data Flow Diagram

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web/Mobile
    participant A as API Server
    participant WS as WebSocket
    participant R as Redis
    participant DB as PostgreSQL
    participant AI as OpenAI

    Note over U,AI: Live Stream Flow
    U->>W: Join Live Stream
    W->>WS: Connect WebSocket
    WS->>R: Subscribe to stream channel
    R-->>WS: Stream events
    WS-->>W: Real-time updates

    Note over U,AI: Bidding Flow
    U->>W: Place Bid
    W->>WS: emit('place-bid')
    WS->>DB: Validate & Save Bid
    WS->>R: Publish bid event
    R-->>WS: Broadcast to viewers
    WS-->>W: Update all clients

    Note over U,AI: AI Product Listing
    U->>W: Upload Product Image
    W->>A: POST /ai/generate-listing
    A->>AI: Vision + GPT-4 Analysis
    AI-->>A: Generated Content
    A->>DB: Save with Embeddings
    A-->>W: Return Listing
```

## Technology Stack

### Backend
| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Node.js 20 | Server runtime |
| Framework | NestJS 10 | API framework |
| Database | PostgreSQL 16 | Primary data store |
| Cache | Redis 7 | Caching, Pub/Sub, Sessions |
| ORM | Prisma 5 | Database access |
| Auth | JWT + Argon2 | Authentication |
| Docs | Swagger/OpenAPI | API documentation |

### Frontend (Web)
| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | Next.js 14 | React framework |
| Styling | Tailwind CSS | Utility CSS |
| State | Zustand + React Query | State management |
| Forms | React Hook Form + Zod | Form handling |
| Real-time | Socket.IO Client | WebSocket |

### Mobile (iOS + Android)
| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | React Native / Expo | Cross-platform |
| Navigation | Expo Router | File-based routing |
| Storage | SecureStore | Secure token storage |
| Video | Expo AV | HLS playback |

### AI/ML Layer
| Component | Technology | Purpose |
|-----------|------------|---------|
| LLM | OpenAI GPT-4 | Text generation |
| Vision | GPT-4 Vision | Image analysis |
| Embeddings | text-embedding-3-small | Semantic search |
| Vector DB | Pinecone | Vector storage |
| Moderation | OpenAI Moderation | Content safety |

### Infrastructure
| Component | Technology | Purpose |
|-----------|------------|---------|
| Containers | Docker | Containerization |
| Orchestration | Docker Compose / K8s | Container orchestration |
| CI/CD | GitHub Actions | Automation |
| CDN | CloudFront | Static assets |
| Storage | AWS S3 | File storage |
| Streaming | NGINX-RTMP | Live video |

## Database Schema Overview

```mermaid
erDiagram
    USER ||--o{ ORDER : places
    USER ||--o{ BID : makes
    USER ||--o| SELLER_PROFILE : has
    USER ||--o{ FOLLOW : has
    USER ||--o{ LIVE_STREAM : hosts

    SELLER_PROFILE ||--o{ PRODUCT : sells
    PRODUCT ||--o{ PRODUCT_IMAGE : has
    PRODUCT ||--o{ BID : receives
    PRODUCT }o--|| CATEGORY : belongs_to

    LIVE_STREAM ||--o{ STREAM_PRODUCT : features
    LIVE_STREAM ||--o{ CHAT_MESSAGE : contains
    LIVE_STREAM ||--o{ STREAM_VIEW : has

    ORDER ||--o{ ORDER_ITEM : contains
    ORDER ||--o{ SHIPMENT : has

    SELLER_PROFILE ||--o{ PAYOUT : receives
```

## Security Architecture

### Authentication Flow
1. User submits credentials
2. Server validates with Argon2
3. JWT access token (15min) + refresh token (7d) issued
4. Access token stored in memory/cookie
5. Refresh token stored in httpOnly cookie
6. Token rotation on refresh

### Security Measures
- Rate limiting (Throttler)
- CORS configuration
- Helmet.js headers
- Input validation (class-validator)
- SQL injection prevention (Prisma)
- XSS protection
- CSRF tokens for forms
- Role-based access control

## Scalability Considerations

### Horizontal Scaling
- Stateless API servers
- Redis for session/cache
- S3 for file storage
- CDN for static assets

### Performance Optimizations
- Database connection pooling
- Redis caching layer
- Query optimization with indexes
- Image compression/CDN
- Lazy loading on frontend
- WebSocket connection pooling

## Monitoring & Observability

### Metrics
- Request latency
- Error rates
- Database performance
- Cache hit rates
- WebSocket connections

### Logging
- Structured JSON logs
- Request/response logging
- Error stack traces
- Audit logs for sensitive operations
