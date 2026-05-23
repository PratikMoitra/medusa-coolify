# Medusa Onezipp

Production-ready Medusa v2 ecommerce backend with Docker deployment.

## Quick Start (Local Development)

```bash
# Copy env template
cp .env.template .env
# Edit .env with your secrets

# Start with Docker
docker compose up --build -d

# Create admin user
docker compose exec medusa npx medusa user -e admin@onezipp.com -p YourPassword123

# Access admin
open http://localhost:9000/app
```

## Environment Variables

See `.env.template` for all available configuration options.

### Required
- `JWT_SECRET` - Generate with `openssl rand -hex 32`
- `COOKIE_SECRET` - Generate with `openssl rand -hex 32`
- `STORE_CORS` - Your storefront URL(s)
- `BACKEND_URL` - Public URL of this backend

### Optional Integrations
- **Razorpay** - Payment gateway
- **Google/Facebook** - OAuth login
- **Shiprocket** - Shipping fulfillment
- **S3/MinIO** - File storage

## Deployment on Coolify

1. Create a new project in Coolify
2. Add a Docker Compose resource
3. Point to this repository
4. Configure environment variables in Coolify UI
5. Deploy

## Project Structure

```
├── backend/           # Medusa v2 backend
│   ├── src/           # Custom modules, API routes, workflows
│   ├── medusa-config.ts
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml # Production Docker stack
├── .env.template      # Environment template
└── README.md
```

## Adding Integrations

### Razorpay
```bash
cd backend
pnpm add medusa-payment-razorpay  # or official plugin when available
```

### Shiprocket
```bash
cd backend
pnpm add medusa-fulfillment-shiprocket  # community plugin
```

### OAuth (Google/Facebook)
Configure in `medusa-config.ts` auth providers section.

## API Endpoints

- Admin API: `http://localhost:9000/admin`
- Store API: `http://localhost:9000/store`
- Health: `http://localhost:9000/health`
- Admin UI: `http://localhost:9000/app`
