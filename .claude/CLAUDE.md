# CLAUDE.md

Guidance for Claude Code in this repo. Two independent projects (no shared root install):

- **`backend/`**: NestJS 11 + Fastify + Drizzle ORM. Syncs cats from `ord.cat21.space`, computes traits via `ordpool-parser`, stores in MariaDB, serves a public REST API. Live at `backend2.cat21.space` (Cloudflare Tunnel to happysrv `127.0.0.1:3333`).
- **`frontend/`**: Angular 21 (zoneless, signal-first). The `cat21.space` public website: gallery, cat detail, SVG rendering, trait display.

E2E rules (data-testid first, click not `goto`, wait on states, regtest / wallet-load) live at [`~/Work/ordpool/E2E_BEST_PRACTICES.md`](../../E2E_BEST_PRACTICES.md). Read it before touching a spec.

## Quick Start

```bash
# Backend (needs MariaDB; deploy-happyserver/HOWTO.md bootstraps the cat21 db+user; dev uses cat21/cat21/cat21)
cd backend && npm install && npm run start:dev  # port 3333, Swagger at /docs
# Frontend
cd frontend && npm install && npm start          # port 4200
```

## Backend reference

Tech: NestJS 11 + Fastify + `@fastify/helmet`; Drizzle ORM (schema-as-code in `src/modules/shared/drizzle/schema/`); MariaDB via `mysql2`; `ordpool-parser` for `Cat21ParserService.parse()`; Swagger at `/docs`. JSON columns use the local `jsonColumn<T>()` customType (`schema/json-column.ts`), NOT Drizzle's `json()`, which stringifies on write but does not parse on read under mysql2's prepared-statement protocol.

Config via `.env` (see `.env.example`): `DATABASE_URL` (`mysql://cat21:cat21@127.0.0.1:3306/cat21`), `ORD_API_URL` (default `https://ord.cat21.space`; prod loopback `http://127.0.0.1:8080`).

```bash
cd backend
npm run start:dev    # watch, port 3333
npm run build        # compile to dist/
npm run typecheck    # type check, no emit
npm run drizzle:gen  # generate a migration from the schema diff
npm run test         # Jest
```

Modules: `modules/shared/drizzle/` (connection + schema: cats, sync_state), `modules/sync/` (polls ord, computes traits, inserts), `modules/cats/` (REST), `modules/bids/` + `modules/listings/` (marketplace).

Endpoints: `GET /api/status`, `/api/cat/:catNumber`, `/api/tx/:txHash`, `/api/cats/:itemsPerPage/:currentPage`, `/api/cat/:catNumber/image.svg`, `/api/cat/:catNumber/image.webp`, `/api/health`. Bids/listings under `/api/v1/`.

## RULE: Schema changes go through generated migrations, applied on boot

- Generate with `npm run drizzle:gen`; never use a `drizzle:push` flow.
- `DrizzleService.onModuleInit()` applies `migrations/` from the build artifact on boot and fails the process on error.
- A backend deploy that adds a migration runs DDL against prod on restart. Diff `backend/migrations` before shipping and state code-only vs schema-change.
Why: prod and dev stay in lock-step; a schema change is a deliberate step.

## RULE: Every endpoint and DTO field carries full Swagger docs

- `@Get`/`@Post`: `@ApiOperation`, `@ApiOkResponse`, `@ApiNotFoundResponse`, `@ApiParam` with examples.
- Every DTO field: `@ApiProperty({ description, example })`, real genesis-cat data preferred. Enums list values via `enum:`. Optionals use `@ApiPropertyOptional` and say when null.
Why: the API is public; third parties depend on it. The frontend's OpenAPI client is generated from it.

## RULE: Every backend route sets its own Cache-Control

Cloudflare respects origin headers (edge: use header if present else bypass; browser: respect origin TTL). Per response:
- Immutable (single cat, images): `public, max-age=86400, s-maxage=31536000, immutable` (browser 1 day, edge 1 year purgeable, no revalidation).
- Dynamic (status, lists, health): no header, so Cloudflare bypasses.
- Errors (404, 500): `no-store`.
Why: a missing header on a 404 is a cache-poisoning hole (a not-yet-synced cat's 404 cached at the edge). Never expose a route without setting this.

## RULE: The backend imports the SDK's lean server-facing subpaths, never `/core`

- `validateCat21BuyOfferPsbt`, `verifyBip322Signature`, `MAX_ASK_SATS` from `ordpool-sdk/cat21-validation`; `buildCat21SessionMessage`, `checkSessionValidity` from `ordpool-sdk/cat21-session`; `Network` from `ordpool-sdk/network`.
- tsconfig `paths` aliases point at the subpath `dist/*.d.ts` (compile-time types); Node and jest resolve the runtime `require` condition to `dist-cjs`.
- Do NOT import `ordpool-sdk/core`: its graph reaches the wallet signers and pulls `sats-connect`, which the backend does not install, and it is ESM (`nest build` TS2307, `require` ERR_MODULE_NOT_FOUND).
Why: the SDK ships a CJS emit only behind those three subpaths (`require` exports condition). Ref: pins `77a7633`+ (SDK), `51f3c8a` (backend).

## RULE: Bumping the `github:` SDK/parser sha needs a forced clean re-resolution

- `npm pkg set` the sha (and the `@scure/btc-signer` version if the peer range moved) in the SAME change; a `package.json` edit alone does not move the lockfile.
- `npm install github:ordpool-space/ordpool-sdk#<sha>` to force it, then `rm -rf node_modules/ordpool-sdk .angular/cache`.
- Verify ON DISK, never from package.json: lockfile resolved sha, installed `@scure/btc-signer` version, the INSTALLED sdk's peer range, and diff one known file against the sha. `node_modules/ordpool-sdk/package.json` carries a fixed `"version": "0.1.0"` and no `_resolved`, so it cannot tell you the sha.
- Frontend and backend pin the sha separately and can dedupe `@scure/btc-signer` down a shared range; pin it exactly (`1.6.0`) to stop that.
Why: npm serves stale git resolutions from cache; the on-disk check is the only proof. Full rule: workspace HQ "Pinning a sha pins neither what it runs against nor itself".

## Frontend reference

Tech: Angular 21 (zoneless, signal-first, standalone); Bootstrap 5.3 + ng-bootstrap; OpenAPI client generated from the backend Swagger. No direct `ordpool-parser` dep: cat SVGs come from `GET /api/cat/:catNumber/image.svg` (backend computes once at sync, edge-cached a year).

```bash
cd frontend
npm start                     # dev, port 4200
npm run build                 # production build
npm run generate:api-client   # regenerate the API client from the backend Swagger
```

Components: `start/` (homepage + gallery), `details/` (single cat), `cat21-viewer/` (SVG + trait table), `layout/header/`. Routes (`app.routes.ts`): `/`, `/cat/:catNumber`, `/cats/:itemsPerPage/:currentPage`, plus `/dashboard/*` (mint, transfer, trade).

## RULE: Keep useful comments (JSDoc and "why" inline)

- Trim bombast/LLM-speak/before-after history INSIDE a comment; the block stays.
- Category-band sourcing, rarity citations to `CAT21-RARITY-SCORE.md`, and sync-loop fire-and-forget rationale are not reconstructable from code.
Ref: workspace HQ "Keep useful comments (JSDoc AND inline 'why')".

## RULE: cat21.space is a custom orange theme with dark body text

Palette: Bitcoin orange `#FF9900` (`$bitcoin`/`$body-bg`, page background), ink `#282828` (`$body-color`, body text AND headings on orange; also the dark popup surface), white `#fff` (header nav+logo, pixel-button chrome, all text inside dark popups), danger `#dc3545`/`#f8d7da`.

- ALL text on the orange ground is dark ink, headings included (`h1`-`h4` take `color: inherit`), because white on `#FF9900` is 2.14:1 (fails WCAG AA at any size, below the 3.0 large-text bar) and `#282828` on it is 6.89:1. Do NOT restore white headings on orange.
- Mechanism: `$body-color: #282828` (`_adjust-bootstrap.scss`); `h1,h2,h3,h4 { color: inherit }` (`styles.scss`); surface-aware `color: inherit` on anything rendered on BOTH orange and a dark popup (`strong`, `a`, `.tool-card`, `pending-cats`). Never hardcode `color: white` on a shared/body element.
- White stays white: pixel headings, header nav+logo, pixel-button chrome (`.category-tab`, `.page-link`, `.pixel-select`, `.wallet-button`, `.trait`, fee tiles), everything inside dark popups. Dark popups (connect modal, connected-wallet popover) set `#282828` via `--bs-modal-*`/`--bs-popover-*`, not `$body-color`.
- Active/selected: white fill, orange text for nav/tabs/buttons, but dark `#282828` where a value must be read precisely (selected fee tier), since orange-on-white is also 2.14:1.
Known residual (by choice, not a bug): inactive fee-tier rates + manual input are white control-chrome; only the selected tier is dark-on-white.
<!-- long-rule: load-bearing colour decision table + don't-revert list -->

## RULE: Don't use Bootstrap semantic surface vars for normal-site panels

- The app sets `data-bs-theme` nowhere, so semantic vars resolve to light-mode defaults (`--bs-tertiary-bg` = `#f8f9fa`). A bare surface var under the site's colours renders white-on-near-white or dark-on-dark.
- Use the orange pattern for in-page panels: `background: transparent` + `border: 2px solid #fff` + white text (as the dashboard/mint/trade cards do). Paired `*-bg-subtle` + `*-text-emphasis` on one element is safe.
- Dark surfaces are for popups only (`#282828` via `--bs-modal-bg`/`--bs-popover-bg`), a deliberate popup treatment. Do not extend dark onto in-page panels.
Why: a "cleanup" swapping panels for `var(--bs-tertiary-bg)` reintroduces the near-white-on-white bug. Sibling cubes uses `data-bs-theme="dark"`; that is its design, not the fix here.

## RULE: SingleAddressNote goes on screens where the connected wallet RECEIVES a cat

- `usesSingleAddress()` (gate) + `singleAddressCaveat()` (sentence) via `SingleAddressNote`. Shown on mint (cat arrives) and make-offer (buyer, lands on accept). Not shown on accept-offer (seller, cat leaves) or transfer (sending).
- Read the direction, not the verb. `walletCustodyCaveat()` is `@deprecated` in the SDK; do not use it.

## RULE: Never spend an asset to the miners by accident (funding safety)

- Separate-address wallet + no clean coin covers: `asset-notice` (notice names the asset, CTA enabled, proceed). One-address wallet: `expert-required` (CTA disabled + coin picker). Clean coin covers: silent auto-pick.
- The component adopts the recommendation for BOTH `auto` and `asset-notice` (adopting only `auto` makes the notice never render). Topology is `'derive'`d from the wallet, never a hardcoded wallet list.
Ref: workspace HQ HARD RULE "Never let a user spend an asset to the miners by accident"; SDK `funding-safety.ts`. Lanes: `cat21wallet-mint-assetnotice-regtest.spec.ts`, `cat21wallet-transfer-offer-assetnotice-regtest.spec.ts`, `funding-guard-inscription-regtest.spec.ts`.

## RULE: The funding-coin fee column is mandatory on every picker surface

- The shared `<app-utxo-picker>` (mint, transfer, make-offer) renders a per-coin fee column, keyed by `outpointKey`, from the snapshot's `candidateFees: CandidateFeeRow[]` (SDK `207338a`+): `feeByOutpoint = new Map(candidateFees.map(f => [outpointKey(f), f]))`.
- Three states from the SDK's `absorbedSubDustSats`, NEVER re-derived: `0` = normal (emits change); `> 0` = dust-fold over-pay (pickable, FLAG it, 7-13% band); `null` (finalFeeSats also null) = unavailable, greyed, reason names the rate ("can't fund at this rate"). Read via `classifyCandidateFee`. Never render null as 0/free/dash.
- Snapshots also carry `fundingRequirementSats` (feasibility floor) + `fundingPreferredSats` (change-headroom target); you need both. Wire `fundingRequirementSats` as `autoScan`'s `minValueSat` so the scanner skips un-fundable dust.
Why: the fee genuinely differs per coin (sub-dust change folds into the fee), so the smaller coin often over-pays; a picker without it misleads. On a dirty-only pool the RECOMMENDED coin can itself over-pay (best-fit is against the requirement), so ★ and over-pay show on one row: that is correct, do not hide it.
<!-- long-rule: three-state field contract + snapshot fields -->

## RULE: Rune rows render via `formatRunePile` and cache only settled answers

- Render a rune as its ord-style balance (`formatRunePile`) + name, linked to the ETCHING tx: `ordpool.space/tx/<etchingTxid>?artifact=<runeName>`.
- `lookupRuneEtching` caches `etched` and `not-etched` FOREVER (so UNCOMMON•GOODS never re-asks); NEVER cache `unknown` / `unavailable`. Balance uses `BigInt(n)`, not `String(n)`, with a throw-safe fallback to the bare name.
Files: `shared/rune-row-label.ts`, `shared/rune-etching.service.ts`, `shared/funding-asset-links.ts` (`inscriptionReviewLink` + `runeEtchingReviewLink`). Ref: workspace HQ / FAMILY_UX `formatRunePile` rule.

## RULE: Fee-column presentation is one family shape (cat21 + ordpool + cubes)

- Money shape `<n> sat (~<fiat>)`, sats space-grouped, fiat half OMITTED when no rate is known (never 0, never a dash). cat21/cubes via `formatSatsWithUsd`; ordpool via mempool `<app-fiat>`. Same shape, each its own rate source.
- Assets render on a SECOND LINE under the coin row (named + linked), not in the badge: badge says DIRTY, line says WHAT.
- RECOMMENDED coin: mark in place, keep the value sort, do NOT sort it to the top (the reader must see the cheaper row is cheaper for a reason).
- Commit+reveal qualifier is per-surface (inscribe-type only), trailing: `fee 4 750 sat (commit + reveal)`. Mint omits it (one tx).
- Contrast is measured PER-GROUND with an alpha-compositing helper (`measuredTextContrast`), re-measured on orange/dark/ordpool separately; a colour valid alone can fail a pairing.
Ref: FAMILY_UX `127a8d6`. "One shape" is a spec, not one component (ordpool hand-rolls its pickers).

## RULE: setWallet re-emission must not re-fetch on an unchanged wallet

- `WalletService.connectedWallet$` is a bare `BehaviorSubject`; `onAccountChange` (Xverse + cat21-wallet fire it repeatedly) re-emits the same wallet as a new object. The four wallet-driven pages (mint, transfer, make-offer, accept-offer) bind it via `toSignal` + an `effect` calling `orch.setWallet`.
- The SDK guards this (`setWallet` is a no-op when `sameWallet` matches, full-tuple identity), so keep the pin at `d42f028`+. Do not add a page-side `distinctUntilChanged`; redundant with the central guard.
- Guarded by `mint-wallet-reemit.spec.ts` (real orchestrator): asserts `setWalletSpy` called 2x AND `getUtxos` 1x on a re-emission. Do NOT delete it: ours is the only repo whose lanes exercise the guard (ordpool keeps its own page dedupe).
Why: unguarded, a re-emission flips `state:'loading-utxos'` and tears the picker/CTA/summary out of the DOM for a frame, losing a click. Intermittent, money-path.

## RULE: Coordinate the SDK-owned SHARED shape here; report gaps, don't re-derive

- `CandidateFeeRow { txid; vout; finalFeeSats: number|null; vsize: number|null; absorbedSubDustSats: number|null }` + `outpointKey(u)` are SDK-owned (root + `/core`). Re-deriving the three-state policy per surface is three chances to drift (a usable coin shown unavailable, an over-payer shown clean).
- The blocked-notice reason sentences come from the SDK's `walletActionNotice`; fix register there, not here.
- When a consumer needs something the shared layer lacks, report it to the ordpool-sdk coordinator so all three surfaces get it at once. `candidateFees` reached all three surfaces this way instead of the mint page only.

## RULE: The seam / mock-vs-real-ord test rules are family-wide

- Assert the dirty-only PREMISE at setup with the remedy in the failure text (a fixed-seed wallet accumulates across local runs; §7.8).
- A mocked `/output` lane never exercises the real scan, so keep at least one real-ord lane (`funding-guard-inscription-regtest.spec.ts`, "No mock") as the classifier's only proof. Do not retire it (§7.7e).
- `cat21-mint-regtest.spec.ts` + `cat21wallet-mint-regtest.spec.ts` fund via `sendtoaddress` but install a context-level `**/output/*` -> `CLEAN_OUTPUT_BODY` mock, so §7.7e does not bite them. Do NOT "fix" them with `fundCommonSats`.
- Route clicks on re-rendering controls through `clickUntilEffect` (`ordpool-sdk/e2e`); a `{ clicks }` count proves a retry happened, never that it was needed (§7.7c).
Ref: `E2E_BEST_PRACTICES.md` §7.7/§7.7c/§7.7e/§7.8. Local footgun: `isVisible({ timeout })` / `isHidden({ timeout })` compile and IGNORE the timeout; use `isVisibleWithin(locator, ms)` from `ordpool-sdk/e2e`.

---

## Angular 21 coding standards (frontend)

Follow strictly.

### Privacy: no external CDN

All fonts/libraries/assets self-hosted via npm. Never Google Fonts CDN (use `@fontsource/*`), never cdnjs/unpkg/jsdelivr, never hotlink. External requests leak user IP/UA to third parties.

### Signal-first (zoneless)

- `signal()` writable; `computed()` derived read-only (no side effects, no writes); `effect()` procedural on change (may set signals); `linkedSignal()` writable, resets when source changes; `rxResourceFixed()` async with status/reload/cancellation.
- Use `input()`/`output()` not decorators, `inject()` not constructor injection, `computed()` for derived state, native control flow (`@if`/`@for`/`@switch`) not `*ngIf`/`*ngFor`/`*ngSwitch`.
- `NgOptimizedImage` for static images. `[class.foo]` not `ngClass`, `[style.color]` not `ngStyle`, `host: {}` not `@HostBinding`/`@HostListener`.
- `ChangeDetectionStrategy.OnPush` on every component. Never `standalone: true` (default) or empty `imports: []`.

### Naming (Angular 21+)

Files `feature-name.ts`/`.html`/`.scss` (no `.component`), classes `FeatureName` (no `Component` suffix). Existing old-convention files stay unless refactoring that component.

### Route params via `withComponentInputBinding()`

Route params flow into `input()` signals, no `ActivatedRoute`. Input name matches the route param exactly; `numberAttribute` transform for numeric params.

```typescript
export class Details {
  readonly catNumber = input(0, { transform: numberAttribute });
  catResource = rxResourceFixed({
    params: () => ({ catNumber: this.catNumber() }),
    stream: ({ params }) => this.api.getCat(params.catNumber),
  });
}
```

### Async: `rxResourceFixed()` only

Use `rxResourceFixed` from `src/app/shared/utils/rx-resource-fixed.ts`, never Angular's `rxResource`/`resource`. It fixes: value resets to `undefined` on param change, `HttpErrorResponse` wrapped in `ResourceWrappedError`, `reload()` not clearing error state. Reactivity comes from `params`, not from reading signals inside `stream`. Signals: `.value()` (stable during loading), `.isLoading()`, `.error()`, `.reload()`.

### `linkedSignal()`

Use only when local state should reset on source change but stay editable (an editable copy of server data). Do not overuse.

### Services + RxJS

- `providedIn: 'root'` singletons, `inject()`, framework-agnostic methods returning Observables; drive view state in components via signals/resources.
- Never `firstValueFrom()` in services; keep observables and `toSignal()` in components. Prefer `rxResourceFixed()` over manual `switchMap`+`retry`+`catchError`.

### TypeScript

Never `any` (use `unknown` + type guards); strict mode; prefer inference; bracket notation for dynamic props (`data['property']`).

### Common pitfalls

`computed()` reading non-signals (convert with `toSignal()` first); reading signals in `resource.stream` expecting reruns (put them in `params`); setting signals in `computed()` (use `effect()`); `async` pipe under zoneless (read signals in templates).

### Accessibility

- Landmarks: `<header>`, one `<main>` per page, `<nav aria-label>`, `<article>`; never a `<div>` where a semantic element exists.
- Headings: one `<h1>`, no skipped levels, never for styling.
- Images: `alt` on informative, `alt=""` on decorative.
- Links/buttons: `<a>` for nav, `<button>` for actions; `rel="noopener"` on `target="_blank"`; `aria-label` when text alone is not descriptive.
- Loading: `aria-live="polite"` on async containers, `role="status"` on spinners, `role="alert"` on errors.
- Focus: never remove outlines; "Skip to content" first. Every route sets `title`.
- Scroll: use `SmartScrollService` (`shared/smart-scroll.service.ts`); Angular's `withInMemoryScrolling` is `disabled`.

### Forms (future)

No forms yet. When added, use Signal Forms, not Reactive or Template-driven.

---

## Dependency: ordpool-parser

Only the backend depends on it (`Cat21ParserService.parse()` at sync). Pin is a GitHub sha, bumped by updating the hash:

```jsonc
"ordpool-parser": "github:ordpool-space/ordpool-parser#<commit-sha>"
```

Local dev: `npm run build && cd dist && npm link` in `ordpool-parser/`, then `npm link ordpool-parser` in `backend/`.
