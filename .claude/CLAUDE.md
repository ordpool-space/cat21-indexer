# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Nx monorepo with two apps:

- **`apps/cat21-frontend/`** — The **cat21.space** public website (Angular 16, standalone components). Shows minted CAT-21 cats with SVG rendering, trait display, paginated gallery, testnet/mainnet support. **This is the valuable part.**
- **`apps/backend/`** — **DEPRECATED** NestJS indexer. Tracked CAT-21 mints but couldn't track transfers per ordinal theory and didn't scale. Superseded by `cat21-ord/` (Rust ord fork with LTO indexing).

## Quick Start

```bash
npm install
npm run start:cat21-frontend    # Angular dev server on localhost:4200
```

The frontend talks to a backend API:
- Dev: `http://localhost:3333` (see `apps/cat21-frontend/src/environments/environment.ts`)
- Prod: `https://backend.cat21.space` (see `environment.prod.ts`)

## Commands

```bash
npm run start:cat21-frontend           # Frontend dev server (port 4200)
npm run build:cat21-frontend           # Build frontend
npm run build:cat21-frontend:production # Production build
npm run test:cat21-frontend            # Frontend tests

npm run start:backend                  # Backend dev server (port 3333, needs PostgreSQL)
npm run build:backend                  # Build backend
npm run test:backend                   # Backend tests

npm start                              # Start both
npm run build                          # Build both
```

## Frontend Architecture

- **Angular 16** with standalone components (no NgModules)
- **Bootstrap 5.3** + ng-bootstrap for UI
- **ordpool-parser** for cat SVG generation and trait parsing
- Routes: `/` (homepage), `/cat/:transactionId` (details), `/cats/:itemsPerPage/:currentPage` (gallery)
- Testnet routes mirror mainnet under `/testnet/`

### Key Components

| Component | Path | Purpose |
|-----------|------|---------|
| StartComponent | `apps/cat21-frontend/src/app/start/` | Homepage + gallery (gallery hidden behind `*ngIf="false"`) |
| DetailsComponent | `apps/cat21-frontend/src/app/details/` | Single cat view with traits |
| Cat21ViewerComponent | `apps/cat21-frontend/src/app/cat21-viewer/` | Cat SVG rendering + trait table |
| HeaderComponent | `apps/cat21-frontend/src/app/layout/header/` | Navigation, genesis cat logo |

### Current State

- Gallery is disabled (`*ngIf="false"` in start.component.html) — needs a working backend
- Launch schedule gating in `apps/shared/schedule.ts` (all gates are past, app shows normally)
- FAQ route is commented out in `app.config.ts`

## Backend (deprecated)

NestJS on port 3333. Swagger docs at `/open-api`. Needs PostgreSQL (see `mempool-config.sample.json` or env vars `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`).

API endpoints:
- `GET /api/cat/:transactionId` — Single cat
- `GET /api/cats/:itemsPerPage/:currentPage` — Paginated list
- `GET /api/cats/by-block-id/:blockId` — Cats by block
- `GET /api/status` — Indexer stats

## Dependency: ordpool-parser

Both frontend and backend use `ordpool-parser`. For local dev:

```bash
# In ordpool-parser/
npm run build && cd dist && npm link

# In cat21-indexer/
npm link ordpool-parser
```
