# cat21-indexer

Backend + frontend for **cat21.space** — the CAT-21 cat explorer.

## Architecture

- **`backend/`** — NestJS + Drizzle ORM + PostgreSQL. Syncs cat data from [ord.cat21.space](https://ord.cat21.space), computes traits, serves REST API.
- **`frontend/`** — Angular 16. Cat gallery with SVG rendering, trait display, detail pages.

## Quick Start

```bash
# Backend (needs PostgreSQL)
cd backend && npm install && npm run start:dev   # port 3333, Swagger at /docs

# Frontend
cd frontend && npm install && npm start           # port 4200
```

See `backend/.env.example` for configuration.
