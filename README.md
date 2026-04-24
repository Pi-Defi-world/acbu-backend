# ACBU Backend API

Backend API server for the ACBU (African Currency Basket Unit) platform.

## Technology Stack

- **Runtime:** Node.js 20+ with TypeScript
- **Framework:** Express.js
- **Database:** Prisma Accelerate (managed PostgreSQL; no local PostgreSQL)
- **Cache:** MongoDB Atlas (managed; no local MongoDB)
- **Message Queue:** RabbitMQ
- **Testing:** Jest
- **Logging:** Winston
- **Development:** Nodemon

## Prerequisites

- Node.js 20 or higher
- Docker and Docker Compose
- pnpm 10+ (Required package manager)

## Setup Instructions

### 1. Clone and Install

```bash
cd backend
pnpm install
```

### 2. Environment Configuration

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` and configure:
- **Prisma Accelerate** URL (`PRISMA_ACCELERATE_URL`) as the runtime database connection; `DATABASE_URL` for migrations if your setup uses it
- **MongoDB Atlas** connection string (`MONGODB_URI`), e.g. `mongodb+srv://...`
- RabbitMQ URL (or use a managed queue)
- API keys for fintech partners (Flutterwave, etc.)
- JWT secrets
- Other service configurations

### 3. Message queue and optional local services

The app uses **Prisma Accelerate** and **MongoDB Atlas**; it does not require local PostgreSQL or MongoDB. You need a RabbitMQ instance (e.g. from Docker or a managed provider).

To run only RabbitMQ via Docker:

```bash
docker-compose up -d rabbitmq
```

RabbitMQ will be on port 5672 (Management UI: `http://localhost:15672`).

The same `docker-compose.yml` can start local PostgreSQL and MongoDB for migrations or local dev; use those services only if you need them.

### 4. Database Setup

Initialize Prisma and run migrations:

```bash
# Generate Prisma Client
pnpm prisma:generate

# Run database migrations
pnpm prisma:migrate

# (Optional) Seed database
pnpm prisma:seed
```

### 5. Start Development Server

```bash
pnpm dev
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

Nodemon will automatically restart the server when you make changes to the code.

## Available Scripts

- `pnpm dev` - Start development server with hot reloading
- `pnpm build` - Build TypeScript to JavaScript
- `pnpm start` - Start production server
- `pnpm test` - Run tests
- `pnpm lint` - Run ESLint
- `pnpm lint:fix` - Fix ESLint errors
- `pnpm format` - Format code with Prettier
- `pnpm format:check` - Check code formatting
- `pnpm prisma:generate` - Generate Prisma Client
- `pnpm prisma:migrate` - Run database migrations
- `pnpm prisma:studio` - Open Prisma Studio
- `pnpm prisma:seed` - Seed database with initial data

## Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # Route controllers
│   ├── services/        # Business logic services
│   ├── models/          # Data models
│   ├── routes/          # API routes
│   ├── middleware/      # Express middleware
│   ├── utils/           # Utility functions
│   └── types/           # TypeScript type definitions
├── tests/               # Test files
├── prisma/              # Prisma schema and migrations
├── scripts/             # Utility scripts
├── docker-compose.yml   # Docker services configuration
└── package.json
```

## API Documentation

Once the server is running, API documentation is available at:
- Swagger UI: `http://localhost:3000/api-docs`

**Segment routes** (require API key with segment scope): `/v1/p2p`, `/v1/sme`, `/v1/international`, `/v1/salary`, `/v1/enterprise`, `/v1/savings`, `/v1/lending`, `/v1/gateway`, `/v1/bills`. For a full list of routes and smart contracts, see the repo docs: [API and Contracts Reference](../DOCS/API_AND_CONTRACTS_REFERENCE.MD).

## Database Management

### Prisma Studio

View and edit database data using Prisma Studio:

```bash
pnpm prisma:studio
```

### Migrations

Create a new migration:

```bash
pnpm prisma:migrate
```

## Testing

Run all tests:

```bash
pnpm test
```

Run tests with coverage:

```bash
pnpm test:coverage
```

## Environment Variables

**Full list:** See [ENV_VARS.md](ENV_VARS.md). No mock data; all values must be real or explicitly empty.

**Required:** `DATABASE_URL` (migrations / fallback), `MONGODB_URI` (MongoDB Atlas), `RABBITMQ_URL`, `JWT_SECRET`. Runtime DB: **Prisma Accelerate** via `PRISMA_ACCELERATE_URL` (see [ENV_VARS.md](ENV_VARS.md)).

**Fintech:** Flutterwave (`FLUTTERWAVE_SECRET_KEY`, etc.), Paystack (`PAYSTACK_SECRET_KEY`), MTN MoMo (`MTN_MOMO_SUBSCRIPTION_KEY`, `MTN_MOMO_API_USER_ID`, `MTN_MOMO_API_KEY`). Optional: `FINTECH_CURRENCY_PROVIDERS`.

**Stellar:** `STELLAR_NETWORK`, `STELLAR_SECRET_KEY`, and after deploy: `CONTRACT_ORACLE`, `CONTRACT_RESERVE_TRACKER`, `CONTRACT_MINTING`, `CONTRACT_BURNING`. Optional for segment features: `CONTRACT_SAVINGS_VAULT`, `CONTRACT_LENDING_POOL`, `CONTRACT_ESCROW`.

## Docker Services

With **Prisma Accelerate** and **MongoDB Atlas**, the app does not use local PostgreSQL or MongoDB. Only RabbitMQ is required from Docker (or use a managed RabbitMQ). The compose file also defines optional `postgres` and `mongodb` services for migrations or local development.

### Accessing Services

- **RabbitMQ Management UI:** `http://localhost:15672` (username: acbu, password: acbu_password)
- **Optional local Postgres:** `localhost:5432` (if running `docker-compose up -d postgres`)
- **Optional local MongoDB:** `localhost:27017` (if running `docker-compose up -d mongodb`)

### Stopping Services

```bash
docker-compose down
```

### Viewing Logs

```bash
docker-compose logs -f
```

## CI/CD

GitHub Actions CI pipeline runs on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`

The CI pipeline:
- Runs linter and formatter checks
- Runs all tests
- Builds the project
- Validates database migrations

## Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and linter: `pnpm test && pnpm lint`
4. Commit and push
5. Create a pull request

## License

Apache License 2.0
