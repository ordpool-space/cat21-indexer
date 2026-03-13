# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Two independent projects (native CLIs):

- **`backend/`** — NestJS 11 + Fastify + Drizzle ORM. Syncs cat data from `ord.cat21.space`, computes traits via `ordpool-parser`, stores in PostgreSQL. Exposes REST API with Swagger docs.
- **`frontend/`** — Angular 16 with standalone components. The **cat21.space** public website. Shows minted CAT-21 cats with SVG rendering, trait display, paginated gallery, testnet/mainnet support.

## Quick Start

```bash
# Backend (needs PostgreSQL running)
cd backend && npm install && npm run start:dev  # port 3333, Swagger at /docs

# Frontend
cd frontend && npm install && npm start          # port 4200
```

## Backend

### Tech Stack
- **NestJS 11** + Fastify + @fastify/helmet (security headers)
- **Drizzle ORM** — schema-as-code in `src/modules/shared/drizzle/schema/`
- **PostgreSQL** — connection via `DATABASE_URL` in `.env`
- **ordpool-parser** — `Cat21ParserService.parse()` for trait computation
- **Swagger** — auto-generated docs at `/docs`

### Config
All config via `.env` (see `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string
- `ORD_API_URL` — ord REST API base URL (default: `https://ord.cat21.space`)
- `SYNC_INTERVAL_MS` — poll interval in ms
- `CORS_ORIGINS` — comma-separated allowed origins

### Commands
```bash
cd backend
npm run start:dev      # Watch mode on port 3333
npm run build          # Compile to dist/
npm run typecheck      # Type check without emit
npm run drizzle:gen    # Generate migration from schema diff
npm run drizzle:push   # Push schema to database
npm run test           # Jest tests
```

### Key Modules
| Module | Purpose |
|--------|---------|
| `modules/shared/drizzle/` | Database connection + schema (cats, sync_state) |
| `modules/sync/` | Polls ord API, computes traits, inserts cats |
| `modules/cats/` | REST API: `/api/status`, `/api/cat/:txHash`, `/api/cats/:ipp/:page` |

### API Endpoints
- `GET /api/status` — Total cats, last sync time
- `GET /api/cat/:txHash` — Single cat by transaction hash
- `GET /api/cats/:itemsPerPage/:currentPage` — Paginated list

## Frontend

### Tech Stack
- **Angular 16** with standalone components (no NgModules)
- **Bootstrap 5.3** + ng-bootstrap for UI
- **ordpool-parser** for cat SVG generation and trait parsing
- **OpenAPI client** auto-generated from backend Swagger

### Commands
```bash
cd frontend
npm start                     # Dev server on port 4200
npm run build:production      # Production build
npm run generate:api-client   # Regenerate API client from backend Swagger
```

### Key Components
| Component | Path | Purpose |
|-----------|------|---------|
| StartComponent | `src/app/start/` | Homepage + gallery |
| DetailsComponent | `src/app/details/` | Single cat view with traits |
| Cat21ViewerComponent | `src/app/cat21-viewer/` | Cat SVG rendering + trait table |
| HeaderComponent | `src/app/layout/header/` | Navigation, genesis cat logo |

### Routes
- `/` — Homepage
- `/cat/:transactionId` — Cat detail
- `/cats/:itemsPerPage/:currentPage` — Gallery
- `/testnet/*` — Testnet mirrors

## Dependency: ordpool-parser

Both frontend and backend use `ordpool-parser`. For local dev with linked version:

```bash
# In ordpool-parser/
npm run build && cd dist && npm link

# In cat21-indexer/backend or frontend
npm link ordpool-parser
```
