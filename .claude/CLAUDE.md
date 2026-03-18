# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Two independent projects (native CLIs):

- **`backend/`** — NestJS 11 + Fastify + Drizzle ORM. Syncs cat data from `ord.cat21.space`, computes traits via `ordpool-parser`, stores in PostgreSQL. Exposes REST API with Swagger docs.
- **`frontend/`** — Angular 21 (zoneless, signal-first). The **cat21.space** public website. Shows minted CAT-21 cats with SVG rendering, trait display, paginated gallery.

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
- `GET /api/cat/:catNumber` — Single cat by number
- `GET /api/tx/:txHash` — Single cat by transaction hash
- `GET /api/cats/:itemsPerPage/:currentPage` — Paginated list
- `GET /api/cat/:catNumber/image.svg` — Cat SVG image
- `GET /api/cat/:catNumber/image.webp` — Cat WebP image

## Frontend

### Tech Stack
- **Angular 21** — zoneless (no zone.js), signal-first, standalone components
- **Bootstrap 5.3** + ng-bootstrap for UI
- **ordpool-parser** for cat SVG generation and trait parsing
- **OpenAPI client** auto-generated from backend Swagger

### Commands
```bash
cd frontend
npm start                     # Dev server on port 4200
npm run build                 # Production build
npm run generate:api-client   # Regenerate API client from backend Swagger
```

### Key Components
| Component | Path | Purpose |
|-----------|------|---------|
| StartComponent | `src/app/start/` | Homepage + gallery |
| DetailsComponent | `src/app/details/` | Single cat view with traits |
| Cat21ViewerComponent | `src/app/cat21-viewer/` | Cat SVG rendering + trait table |
| HeaderComponent | `src/app/layout/header/` | Navigation, genesis cat logo |

### Routes (defined in `app.routes.ts`)
- `/` — Homepage
- `/cat/:catNumber` — Cat detail
- `/cats/:itemsPerPage/:currentPage` — Gallery

---

## Angular Best Practices (Angular 21+)

These are the coding standards for the frontend. Follow them strictly.

### Privacy: No External CDN Requests

**ALL resources (fonts, libraries, assets) MUST be self-hosted via npm packages.** External CDN requests transmit user data (IP addresses, user agents) to third parties. We strictly avoid this.

- Use npm packages for all fonts, libraries, and resources
- **NEVER use Google Fonts CDN** — use `@fontsource/*` npm packages instead
- **NEVER use cdnjs, unpkg, jsdelivr** — install via npm
- **NEVER hotlink external resources** — download and bundle them

### Signal-First Architecture

Angular 21 is zoneless by default. All reactivity is driven by signals, not zone.js.

**Mental model:**
- `signal()` → writable value
- `computed()` → derived, read-only value; **no side effects, no writes**
- `effect()` → runs procedural code when dependencies change; **may set signals**
- `linkedSignal()` → writable value linked to another signal; **resets when source changes**
- `rxResourceFixed()` → declarative async with built-in status, reload, cancellation

### File and Class Naming Convention (Angular 21+)

Angular 21 drops the `.component` / `.pipe` / `.directive` suffix from filenames and the `Component` suffix from class names:

- **Files**: `feature-name.ts`, `feature-name.html`, `feature-name.scss` (NOT `feature-name.component.ts`)
- **Classes**: `FeatureName` (NOT `FeatureNameComponent`)

**Note**: Existing files in this project still use the old convention. New files should follow the new convention. Don't rename existing files unless refactoring that component.

### Component Conventions

```typescript
// ✅ CORRECT — Angular 21 component
@Component({
  selector: 'app-my-feature',
  templateUrl: './my-feature.html',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MyFeature {
  readonly data = input<string>();
  readonly derived = computed(() => this.data()?.toUpperCase());
}
```

**Rules:**
- **NEVER set `standalone: true`** — it's the default in Angular 19+, including it is redundant
- **ALWAYS use `ChangeDetectionStrategy.OnPush`** on every component
- **NEVER include empty `imports: []`** — omit entirely if no imports needed
- Use `input()` and `output()` functions, not `@Input()` / `@Output()` decorators
- Use `computed()` for derived state
- Use `inject()` function, not constructor injection
- Use `NgOptimizedImage` for all static images (significant performance boost via lazy loading, srcset, priority hints)
- Do NOT use `ngClass` — use `[class.foo]` bindings instead
- Do NOT use `ngStyle` — use `[style.color]` bindings instead
- Do NOT use `@HostBinding` / `@HostListener` — use `host: {}` in the decorator instead
- Use native control flow (`@if`, `@for`, `@switch`), never `*ngIf` / `*ngFor` / `*ngSwitch`

### Forms (future)

This project has no forms yet. When forms are added, use **Signal Forms** (Angular's new signal-based form API). Do NOT use Reactive Forms or Template-driven Forms.

### Route Params via `withComponentInputBinding()`

Route parameters flow directly into component `input()` signals — no `ActivatedRoute` needed. Enabled via `withComponentInputBinding()` in `app.config.ts`.

```typescript
// Route: /cat/:catNumber
@Component({ ... })
export class Details {
  readonly catNumber = input(0, { transform: numberAttribute });

  catResource = rxResourceFixed({
    params: () => ({ catNumber: this.catNumber() }),
    stream: ({ params }) => this.api.getCat(params.catNumber),
  });
}
```

The input name must match the route param name exactly. Use `numberAttribute` transform for numeric params. This eliminates `ActivatedRoute`, `paramMap`, `toSignal`, and `map` boilerplate entirely.

### Async Data: Use `rxResourceFixed()` ONLY

**CRITICAL**: Use `rxResourceFixed` from `src/app/shared/utils/rx-resource-fixed.ts` for all async data loading. It fixes three bugs in Angular's built-in `rxResource`:
1. **Value resets to `undefined`** when parameters change (causes flickering)
2. **`HttpErrorResponse` gets wrapped** in unhelpful `ResourceWrappedError`
3. **`reload()` doesn't clear error state** immediately

```typescript
import { rxResourceFixed } from '../shared/utils/rx-resource-fixed';

// Basic usage
readonly catsResource = rxResourceFixed({
  params: () => ({ page: this.currentPage() }),
  stream: ({ params }) => this.api.getCats(params.page),
});

// In template: use resource signals directly
// catsResource.value()     — the data (stable during loading!)
// catsResource.isLoading() — loading state
// catsResource.error()     — error state
// catsResource.reload()    — trigger refresh
```

**Key rules:**
- **NEVER use Angular's `rxResource` or `resource` directly** — always use `rxResourceFixed`
- **Reactivity comes from `params`**, not from reading signals inside `stream`
- Use `.reload()` directly — no refresh keys or Subjects needed
- HttpErrorResponse handling is automatic — no manual error pipes

### `linkedSignal()` — Editable State That Resets

Use when local state should reset when its source changes but remain manually editable:

```typescript
const options = signal([{ id: 1 }, { id: 2 }]);
const selected = linkedSignal(() => options()[0]); // resets when options change
selected.set({ id: 2 }); // writable override
```

Great for "editable copy of server data": wrap async value in `linkedSignal()` so users can edit locally while a reload resets to fresh server state.

### Templates

```html
<!-- Status-aware template for rxResourceFixed -->
@if (dataResource.value(); as data) {
  <!-- render data -->
} @else if (dataResource.isLoading()) {
  <!-- loading skeleton -->
} @else if (dataResource.error()) {
  <p>Failed to load. <a (click)="dataResource.reload()" role="button">Retry</a></p>
}
```

### Services

- Use `providedIn: 'root'` for singleton services
- Use `inject()` function, not constructor injection
- Keep services framework-agnostic (plain methods returning Observables)
- Drive view state in components via signals/resources

### RxJS Rules

- **NEVER convert observables to promises** with `firstValueFrom()` in services
- Keep observables if the underlying API uses observables (e.g., HttpClient)
- Use `toSignal()` in components to convert observables to signals
- Prefer `rxResourceFixed()` over manual `switchMap` + `retry` + `catchError` chains

### Keyboard Navigation via Host Bindings

```typescript
// ✅ CORRECT — host bindings in decorator
@Component({
  host: {
    '(window:keydown.ArrowLeft)': 'navigatePrev()',
    '(window:keydown.ArrowRight)': 'navigateNext()',
  }
})

// ❌ WRONG — manual fromEvent + takeUntilDestroyed
constructor() {
  fromEvent(window, 'keydown').pipe(takeUntilDestroyed()).subscribe(...);
}
```

### Common Pitfalls

- ❌ `computed()` reading non-signals (e.g., `router.url`) — convert to signal with `toSignal()` first
- ❌ Reading signals inside `resource.stream` expecting reruns — put them in `params` instead
- ❌ Setting signals inside `computed()` — use `effect()` for writes
- ❌ Using `async` pipe with zoneless — use signals/resources and read them in templates
- ❌ Overusing `linkedSignal()` — only use when reset-on-source-change is needed

### TypeScript Rules

- **NEVER use `any`** — use `unknown` with type guards if type is uncertain
- Use strict type checking (strict mode is enabled)
- Prefer type inference when the type is obvious
- Use bracket notation for dynamic properties: `data['property']`

### Accessibility (a11y)

Follow semantic HTML and ARIA best practices. This improves accessibility AND SEO.

**Landmarks — use HTML5 structural elements:**
- `<header>` for the site header
- `<main>` for the primary content area (one per page)
- `<nav aria-label="...">` for navigation sections
- `<article>` for self-contained content (e.g., a single cat detail)
- Never use `<div>` where a semantic element exists

**Headings — maintain correct hierarchy:**
- One `<h1>` per page
- Never skip levels (h1 → h3 without h2 is invalid)
- Never use headings just for visual styling

**Images:**
- Always set `alt` on informative images
- Use `alt=""` on decorative images (tells screen readers to skip)

**Links and buttons:**
- Use `<a>` for navigation, `<button>` for actions — never interchange
- Add `rel="noopener"` to all `target="_blank"` links
- Add `aria-label` when link text alone is not descriptive (e.g., gallery thumbnails)

**Loading states:**
- Use `aria-live="polite"` on containers that update asynchronously
- Use `role="status"` on spinners with `<span class="visually-hidden">Loading...</span>`
- Use `role="alert"` on error messages

**Focus management:**
- Never remove focus outlines on interactive elements (buttons, links, inputs)
- Provide a "Skip to content" link as the first focusable element

**Page titles:**
- Every route must have a `title` property for the browser tab and screen readers

**Scroll behavior:**
- Use `SmartScrollService` (in `shared/smart-scroll.service.ts`) instead of Angular's built-in `scrollPositionRestoration`
- It scrolls to top on forward navigation, restores position on back/forward, and handles anchor links
- Angular's `withInMemoryScrolling` is set to `disabled` so it only emits `Scroll` events without doing its own scrolling

---

## Dependency: ordpool-parser

Both frontend and backend use `ordpool-parser`. For local dev with linked version:

```bash
# In ordpool-parser/
npm run build && cd dist && npm link

# In cat21-indexer/backend or frontend
npm link ordpool-parser
```
