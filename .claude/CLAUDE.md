# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**E2E work:** general Playwright rules (data-testid first, click instead of `goto`, wait on states, ordpool-specific regtest / wallet-load) live at workspace root: [`~/Work/ordpool/E2E_BEST_PRACTICES.md`](../../E2E_BEST_PRACTICES.md). Read it before touching any spec.

## Overview

Two independent projects (native CLIs):

- **`backend/`** — NestJS 11 + Fastify + Drizzle ORM. Syncs cat data from `ord.cat21.space`, computes traits via `ordpool-parser`, stores in MariaDB. Exposes REST API with Swagger docs. Live at `backend2.cat21.space` (Cloudflare Tunnel → happysrv `127.0.0.1:3333`).
- **`frontend/`** — Angular 21 (zoneless, signal-first). The **cat21.space** public website. Shows minted CAT-21 cats with SVG rendering, trait display, paginated gallery.

## HARD RULE: Keep useful comments

**Don't strip JSDoc or "why" inline comments under the banner of
"simplification".** The text inside a comment can be trimmed (no
bombast, no LLM-speak, no before-after history); the block itself
stays. Category-band sourcing, rarity-rule citations to
`CAT21-RARITY-SCORE.md`, and sync-loop fire-and-forget rationale are
exactly the kind of comment a future reader cannot reconstruct from
code alone. Full decision tree in the workspace `CLAUDE.md` HARD RULE
"Keep useful comments (JSDoc AND inline 'why')".

## Quick Start

```bash
# Backend (needs MariaDB running — see deploy-happyserver/HOWTO.md for the cat21 db+user bootstrap; same convention works for dev: cat21/cat21/cat21)
cd backend && npm install && npm run start:dev  # port 3333, Swagger at /docs

# Frontend
cd frontend && npm install && npm start          # port 4200
```

## Backend

### Tech Stack
- **NestJS 11** + Fastify + @fastify/helmet (security headers)
- **Drizzle ORM** — schema-as-code in `src/modules/shared/drizzle/schema/`. JSON columns use the local `jsonColumn<T>()` customType (`schema/json-column.ts`) — Drizzle's built-in `json()` for mysql-core stringifies on write but doesn't parse on read under mysql2's prepared-statement protocol.
- **MariaDB** via `mysql2` driver — connection via `DATABASE_URL` in `.env` (`mysql://user:pw@host:3306/db`).
- **ordpool-parser** — `Cat21ParserService.parse()` for trait computation
- **Swagger** — auto-generated docs at `/docs`

### Config
All config via `.env` (see `.env.example`):
- `DATABASE_URL` — MariaDB / MySQL connection string (e.g. `mysql://cat21:cat21@127.0.0.1:3306/cat21`)
- `ORD_API_URL` — ord REST API base URL (default: `https://ord.cat21.space`; in prod uses loopback `http://127.0.0.1:8080`)

### Commands
```bash
cd backend
npm run start:dev       # Watch mode on port 3333
npm run build           # Compile to dist/
npm run typecheck       # Type check without emit
npm run drizzle:gen     # Generate a new migration from schema diff
npm run test            # Jest tests
```

Migrations are applied **automatically on app boot** by `DrizzleService.onModuleInit()` (reads `migrations/` shipped in the build artifact, fails the process on error). There is no `drizzle:push` flow — schema changes always go through generated migrations so prod and dev stay in lock-step.

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

### OpenAPI Documentation (HARD RULE)

Every backend endpoint and every DTO field MUST have comprehensive Swagger documentation. This API is public — third-party developers and the ecosystem depend on it.

- **Every `@Get`/`@Post` endpoint**: Use `@ApiOperation({ summary, description })`, `@ApiOkResponse`, `@ApiNotFoundResponse`, `@ApiParam` with examples
- **Every DTO field**: Use `@ApiProperty({ description, example })` — include meaningful examples (real genesis cat data preferred)
- **Enum fields**: Use `enum: [...]` to list all possible values
- **Optional fields**: Use `@ApiPropertyOptional` with explanation of when it's null

### Cache-Control Headers (HARD RULE)

Cloudflare edge caching is configured to **respect origin headers**:
- **Edge TTL**: "Use cache-control header if present, bypass cache if not"
- **Browser TTL**: "Respect origin TTL"

This means **every backend route controls its own caching via `Cache-Control` headers**. When adding or modifying any endpoint, you MUST set the appropriate header:

- **Immutable data** (single cat, images): `Cache-Control: public, max-age=86400, s-maxage=31536000, immutable`
  - `max-age=86400` → browser caches 1 day
  - `s-maxage=31536000` → Cloudflare edge caches 1 year (purgeable)
  - `immutable` → no revalidation requests
- **Dynamic data** (status, paginated lists, health): No `Cache-Control` header → Cloudflare bypasses cache
- **Errors** (404, 500): `Cache-Control: no-store` → prevents cache poisoning (e.g., 404 for a cat not yet synced getting cached at the edge)

**NEVER expose a route without considering its caching behavior.** A missing header on a 404 response is a cache poisoning vulnerability.

## Frontend

### Tech Stack
- **Angular 21** — zoneless (no zone.js), signal-first, standalone components
- **Bootstrap 5.3** + ng-bootstrap for UI
- **OpenAPI client** auto-generated from backend Swagger

The frontend has **no direct dependency on `ordpool-parser`**. Cat SVGs are
served by the backend via `GET /api/cat/:catNumber/image.svg` (and
`image.webp`); the backend computes them once via `Cat21ParserService.parse()`
during sync and they're cached at the Cloudflare edge for a year (immutable).
Trait data comes through the OpenAPI client from `GET /api/cat/:catNumber`.

#### Colour brand guide (cat21.space)

The site is a **custom orange theme with dark body text**. This is the source
of truth for colour; the code follows it.

**Palette**

| Token | Value | Role |
|---|---|---|
| Bitcoin orange | `#FF9900` (`$bitcoin` / `$body-bg`) | brand colour + page background of the whole normal site |
| Ink | `#282828` (`$body-color`) | body text AND headings on the orange body; ALSO the dark popup surface |
| White | `#fff` | header nav + logo, pixel-button chrome, and all text (headings included) inside the dark popups |
| Danger red | `#dc3545` / `#f8d7da` | error notices (red border, pink fill, dark-red text) |

**The contrast rule (why headings and body text are both dark, not white).**
White on `#FF9900` is **2.14:1** and fails WCAG AA **at any size** — it is
*below* the 3.0 large-text allowance, not above it (2.14 < 3.0). `#282828` on
`#FF9900` is **6.89:1** and passes. So **all text on the orange ground is dark
ink**: body copy AND the pixel headings (`h1`–`h4`), which take their surface's
colour via `color: inherit` — dark on the orange body, white only inside the
dark popups. Headings read as brand type through the pixel font + weight + size,
never through lightness (the one axis this ground doesn't have). Do NOT restore
white headings on the orange body: a heading is not exempt from contrast for
being brand type, and "they clear the large-text bar" was a false premise (the
number two sentences up disproves it).

**What is white vs dark**

- **White** (stays white): pixel **headings** (`h1`–`h4`), the header **nav +
  logo**, the **pixel-button chrome** (`.category-tab`, `.page-link`,
  `.pixel-select`, `.wallet-button`, `.wallet-pick`, `.trait`, the fee-picker
  tiles) — white text + white border on the transparent orange body — and
  **everything inside the dark popups**.
- **Dark** (`#282828`): all **body copy** — paragraphs, labels, values, list
  text, `strong`, and **links** (dark + underline) — on the orange surfaces.
- **Dark popups** (the connect modal, the connected-wallet popover): a solid
  `#282828` surface with white text, set via `--bs-modal-color` /
  `--bs-popover-*`, NOT via `$body-color`.

**The mechanism, and the don't-revert rules**

- `$body-color: #282828` in `_adjust-bootstrap.scss` makes body text dark by
  default; Bootstrap derives `--bs-secondary-color` = `rgba($body-color, .75)`,
  so muted text follows automatically. Do NOT set it back to `white`.
- `h1,h2,h3,h4 { color: inherit }` in `styles.scss` — headings take their
  surface's colour: **dark `#282828` on the orange body (6.89:1)**, white on the
  dark popup title bars. Do NOT set them back to `color: white`; white on the
  orange body is the 2.14:1 strain and fails at any size.
- **Surface-aware `color: inherit`** on anything that renders on BOTH an orange
  surface and a dark popup: `strong`, `a`, `.tool-card`, `pending-cats`. Inherit
  so it's dark on orange and white in the popup. **Never hardcode `color: white`
  on a shared or body element** — it lands white-on-orange (the 2.14:1 strain) or
  dark-on-dark when the same component shows in a popup.
- The dark popups keep white through their own Bootstrap colour vars; they do
  not depend on `$body-color`.

**Active / selected state.** White fill. Text is **orange** for nav / tabs /
buttons (the brand-accent inversion), but **dark `#282828`** anywhere a value
must be read precisely (the selected fee tier), because orange-on-white is
2.14:1.

**Known residual (not a bug):** the fee-picker's INACTIVE tier rates + the
manual input are white-pixel control chrome (white-on-orange); only the SELECTED
tier is dark-on-white for legibility. If a future pass wants every fee number to
clear AA, darken those controls; it was left as control-chrome by choice.

#### Bootstrap semantic vars resolve LIGHT (no `data-bs-theme`)

The app is a **custom orange theme**: `$body-bg: #FF9900`, `$body-color: white`,
white borders (the pixel-panel look). It sets **`data-bs-theme` nowhere** — not
on `<html>`, not on the app root — so every Bootstrap semantic colour var
resolves to its **light-mode default**: `--bs-tertiary-bg` is `#f8f9fa`
(near-white), `--bs-secondary-color` / `--bs-emphasis-color` are dark
greys/near-black, etc. Any surface that reads one of these *bare* (a background
from the var, text from the site's white `$body-color`, or vice versa) renders
white-on-near-white or dark-on-dark and is unreadable.

**Rule: don't use Bootstrap semantic *surface* vars for normal-site panels.**
Use the orange-theme pattern instead — `background: transparent` (the orange
body shows through) + `border: 2px solid #fff` + white text — as the
dashboard / mint / my-cats connect cards and the trade / transfer / accept /
trade-landing panels do. A "cleanup" that swaps those for `var(--bs-tertiary-bg)`
reintroduces the near-white-on-white bug. Paired uses (a `*-bg-subtle`
background with its matching `*-text-emphasis` on the same element) are safe:
both come from Bootstrap and can't drift apart.

**Dark surfaces are for popups only.** The connect modal and the popover set an
explicit `#282828` (via `--bs-modal-bg` / `--bs-popover-bg`), which the
maintainer approved as a deliberately dramatic treatment for a popup. The
normal website stays orange; do not extend the dark surface onto in-page
panels.

The sibling cubes frontend takes the other route — `data-bs-theme="dark"` on its
app root — and is immune to this whole class, but that is *its* design (a dark
site). It is **not** the fix here, because it would flip every Bootstrap surface
dark and fight the orange identity.

#### Connected-state UX pass — built; rendered review still owed

Most of this shipped on the `60d6fbc` pin. What is DONE, and the one thing that
still needs a connected wallet + live electrs to REVIEW (not to build):

- **Custody caveat — DONE.** `walletCustodyCaveat()` is `@deprecated` in the SDK;
  do NOT reach for it (it gates on the matrix record, not the two addresses the
  wallet actually returned, and it is being removed). The live replacement is
  `usesSingleAddress()` (gate) + `singleAddressCaveat()` (sentence), which cat21
  uses through `SingleAddressNote`, placed on the two screens where the connected
  wallet ENDS UP HOLDING a cat:

  | Screen | Cat direction | Note |
  |---|---|---|
  | mint | arrives | shown |
  | make-offer | you're the BUYER; lands with you on accept | shown |
  | accept-offer | you're the SELLER; the cat leaves | not shown |
  | transfer | you're sending; the cat leaves | not shown |

  Read the *direction*, not the verb.

- **Rune row — DONE.** The funding-safety panel renders a rune as its ord-style
  balance (`formatRunePile`) + name, linked to its ETCHING tx via
  `ordpool.space/tx/<etchingTxid>?artifact=<runeName>`. Pieces:
  `shared/rune-row-label.ts` (the balance, with the `BigInt(n)`-not-`String(n)`
  coercion and a throw-safe fallback to the bare name),
  `shared/rune-etching.service.ts` (four-case `lookupRuneEtching`: cache `etched`
  + `not-etched` forever so UNCOMMON•GOODS never re-asks; never cache `unknown` /
  `unavailable`), and `shared/funding-asset-links.ts` (`inscriptionReviewLink` +
  `runeEtchingReviewLink`). Wired in both the mint panel and the picker; lookups
  kick off on scan-arrival, and a name renders plain text until its own lookup
  answers. ordpool.space's reader matches the rune name spacer- and
  case-insensitively.

- **§7.6 connected copy — PSBT scrubbed.** The connected trade/transfer copy no
  longer names "PSBT" or "input 0" where the visitor doesn't handle the byte
  ("Paste the offer", "Copy offer", "sign an offer that pays…"). "UTXO" stays: it
  is the agreed coin-safety vocabulary ("Use this UTXO"). The blocked-notice
  reason sentences come from the SDK's `walletActionNotice` (source-owned there),
  so register fixes to those in `ordpool-sdk`, not here.

- **The `ordpool-sdk` pin is `5eeca5c`, with the frontend declaring
  `@scure/btc-signer` `1.6.0` directly.** `5eeca5c` descends from `25eac26` (via
  `240c940`), adding the `seedDirtyCoin` / `seedListedCat` regtest helpers the
  dirty-coin matrix uses; the ESM/dist reasoning below still holds because
  `25eac26` is its ancestor. `25eac26` crossed
  two boundaries from the earlier `6f4d6a7`-era pins: `8b642a8` collapsed
  `dist-core/` into a single `dist/`, and `4e98205` made that single `dist/`
  ESM again — so the CommonJS interlude's +543 kB / +38 % Angular-bundle
  penalty is **withdrawn**; the production bundle is back to 1.38 MB and the
  `Module 'ordpool-sdk' is not ESM` warning is gone. The SDK's peer range moved
  to `@scure/btc-signer 1.6.x` (cat21-wallet and `@leather.io/bitcoin` need the
  `/psbt` subpath 1.2.1 doesn't expose), so the frontend's OWN direct
  `@scure/btc-signer` dep moves to `1.6.0` in the SAME change as the SHA — a
  sha-swap alone leaves `1.2.2` declared against a `1.6.x` SDK and dies on the
  subpath imports. Frontend own-code impact of that peer move is nil: the only
  `@scure` import site (`transfer.ts`) uses `btc.Address`, barrel-stable in both
  1.2 and 1.6.
- **When bumping the `github:` SDK dep by SHA**, force a clean re-resolution,
  never a sed sha-swap: `npm pkg set` the SHA (and the `@scure` version if it
  moved), `npm install --package-lock-only ordpool-sdk@github:…#<sha>` to move
  the lockfile's git resolution (a `package.json` edit alone does NOT move it),
  then `rm -rf node_modules/ordpool-sdk && npm install --force`, then
  `rm -rf .angular/cache` (Angular caches the COMPILED module; a stale-dist
  compile survives dist correction, and the tell is a build error naming a
  symbol that exists in no file on disk). Verify the bump landed by looking for
  what should and should NOT be there: `node_modules/ordpool-sdk/dist/package.json`
  is `{"type":"module"}`, `node_modules/ordpool-sdk/dist-core/` is GONE, the new
  symbol (`seedListedCat` for `25eac26`) is present, and `@scure/btc-signer`
  resolves the intended version on disk with no nested dupes. Checking only that
  a new symbol EXISTS still passes on a newer-than-intended cached build, so the
  "should NOT be there" half is what confirms you are on exactly the SHA you
  pinned. ordpool.space does NOT take `formatSatsWithFiat` (its fork already has
  upstream's whole fiat system).

- **Owed on the NEXT SDK bump (target `f746f50`+): swap the two happy-path mint
  specs' `/output` stub body to `cleanOutputFixture().ord`.** The family contract
  is that no hand-written `/output` BODY exists anywhere, in any layer, any
  transport (a Playwright `context.route` fulfil IS a mock body, so it is in
  scope) — the failure mode it prevents is a stub encoding a shape the real ord
  contract stopped sending, which is how `getCatsAtOutput` shipped broken + green.
  `cat21-mint-regtest.spec.ts` and `cat21wallet-mint-regtest.spec.ts` still
  fulfil `**/output/*` with a hand-written `{ inscriptions, runes, cats }` /
  `sat_ranges` body; replace it with `cleanOutputFixture().ord` (exported from
  `ordpool-sdk` / `ordpool-sdk/core` at `9f370fa`+). This MUST land in the SAME
  commit as the bump: `f746f50` carries the fail-closed classifier (non-empty
  `sat_ranges` required as proof-of-indexing), so the current `sat_ranges`-less
  clean stub would class UNKNOWN and disable the mint button. Low urgency, no
  lane/workflow edits; bundle it with the next functional bump, not as its own
  errand (agreed with the ordpool-sdk coordinator). The dirty-coin matrix already
  proves the guard on real ord both directions, so this is drift-prevention on the
  happy-path stubs, not a coverage gap. Re-run both mint lanes after the bump.

- **Still owed: the RENDERED review.** The funding-safety panel rows (rune,
  inscription, rare-sat, cat) and the reworded connected trade/transfer copy have
  unit tests plus the family logic, but their final rendered look needs a
  connected wallet + live electrs, which dev can't fake (a scanned-with-assets
  coin needs a real asset-bearing UTXO). Do that review in a connected session,
  or via the regtest e2e, before calling the panel visually signed off.

#### Asset-to-miner safeguard (mint DONE, sign-off LIFTED) + picker convergence (IN PROGRESS)

The maintainer's "never spend an asset to the miners by accident" ruling. MINT is
done + proven: separate-address wallet + dirty-only pool -> `asset-notice` (notice
naming the asset, CTA enabled, proceed); one-address wallet -> `expert-required`
(CTA disabled + picker). The component adopts the recommendation for BOTH `auto`
and `asset-notice` (mint.ts) — adopting only `auto` was a shipped bug that made the
notice never render (regression-guarded by mint.spec.ts E2b, mutation-checked).
Proofs: `cat21wallet-mint-assetnotice-regtest.spec.ts` (4/4, names the seeded
asset per class, CTA enabled) + E2 (one-address block) / E2b (asset-notice adopt).

SIGN-OFF LIFTED (2026-09-18): the maintainer approved the mint screenshots + the
fee column, and switched to parallel / deploy-fast (ready bar unchanged). Build
order + live state:

- MINT CONVERGENCE SHIPPED + VERIFIED LIVE on cat21.space (2026-09-18). The mint
  page's inline `mint-utxo-*` picker is gone; it renders `<app-utxo-picker>` wired
  with `feeByOutpoint` (from the snapshot's `candidateFees`, keyed by `outpointKey`)
  + `recommendedOutpoint`. The shared `UtxoPicker` has the fee column (three states
  via `absorbedSubDustSats`: normal / dust-fold over-pay / can't-fund-at-this-rate),
  confirmed/unconfirmed, and the mark-in-place recommended annotation, as OPTIONAL
  inputs (transfer/offer render unchanged until they wire them). Commits: pin
  `77d4668` (207338a) + convergence `3139f9c` + regtest re-point `30d9f9e` + panel
  re-point `29729f2`. Deployed by `git push main:stage_prod` (frontend-only: the
  delta had ZERO backend files and `build-backend.yml` is path-filtered to
  `backend/**`, so no backend restart / no migration). Verified live: the deployed
  `main-<hash>.js` carries the picker's distinctive strings ("can't fund at this
  rate", "over-pays", "recommended"), and a fresh Playwright context on the nested
  `/dashboard/mint` deep link boots with 0 console errors (no Cloudflare-Pages
  module-MIME trap). New screenshots went to the maintainer via SendUserFile as the
  changed-artifact FYI (the earlier inline-picker sign-off is stale; sent, not gated).
- BENEATH IT, also shipped in the same deploy: the whole asset-to-miner safeguard
  (asset-notice UI, funding-safety gating) that had accumulated undeployed on
  `main` all session. The `main:stage_prod` push drained the entire frontend
  backlog in one deploy, which is the accumulated-release-queue the continuous-
  deploy philosophy wants gone.
- EARLIER, DONE + shipped: SDK pin bumped to `18cb6e7` (standalone `769dee4`) — and
  the two `isVisible({ timeout })` footgun sites fixed (`54592b6`).
- NICE-TO-HAVE BACKLOG (NOT a safety hole — the safety-critical trio is covered at
  each owning layer): a cat21.space regtest lane driving a REAL one-address wallet
  (unisat/wizz/okx) to prove the BLOCK path end-to-end via real ord. Today: the
  topology DECISION is unit-covered (SDK `funding-safety.spec.ts`), the page RENDER
  is unit-covered (`mint.spec.ts` E2), and the REAL-WALLET topology fact (a real
  unisat presents one address, real Xverse two) is covered in the SDK wallet
  matrices via `isOneAddressWallet(info)` (SDK `4b8ecf9`). No regtest drives a real
  one-address wallet, so the BLOCK path has no full-stack lane — a nice-to-have
  end-to-end wiring proof, not an open hole. `funding-guard-inscription-regtest`
  drives Xverse and proves the scanner-reads-ord + names-the-inscription path (its
  panel is `mint-asset-notice`, since Xverse is notice-and-proceed).
- GAP CLOSED (SDK `207338a`): `candidateFees` was on the CORE
  `simulateMint/Transfer/CreateOffer` result but the stateful orchestrators did
  NOT re-expose it. Reporting it (rather than deriving from `UtxoSimulationRow`,
  HQ-forbidden) is what got it fixed for ALL THREE surfaces at once instead of
  just the mint page. `MintSnapshot` / `TransferSnapshot` / `CreateOfferSnapshot`
  now carry `candidateFees: CandidateFeeRow[]` (keyed by `outpointKey`, every
  status) + `fundingRequirementSats` (feasibility floor) + `fundingPreferredSats`
  (change-headroom target — you need both, the requirement alone is half the
  selection rule). Build `feeByOutpoint = new Map(candidateFees.map(f =>
  [outpointKey(f), f]))`. A new SDK test pins the core fee to the mint's per-UTXO
  grid, so swapping the mint page from the grid to `candidateFees` cannot silently
  change an on-screen number. INSCRIBE is deliberately excluded: its orchestrator
  builds `simulations[].preview` with `commitFeeSats`/`revealFeeSats`/`totalFeeSats`
  split — if cat21 ever grows an inscribe surface, bind to `preview`, NOT a fee row.
- PIN-BUMP BATCH — FRONTEND SHIPPED (`89193f0`), BACKEND BLOCKED (2026-09-19).
  Maintainer said "alles bumpen, alles deployen" (relayed via the SDK coordinator).
  FRONTEND: bumped to `a1cde1f`, adopted `classifyCandidateFee`, wired the autoScan
  floor to all three flows; full pin dance on disk; all lanes green (incl. a
  dispatched Xverse mint `e2e-regtest-mint.yml` to close a path-filter gap — that
  workflow watches only `e2e/**` + `frontend/e2e/regtest/**`, NOT `frontend/src/**`,
  so src changes never trigger it: WIDEN THAT FILTER in a follow-up); shipped
  `main:stage_prod`, landed-check passed (new bundle `main-4UYLHL4C.js` served with
  the `overpay-unknown` marker, nested deep link 0 errors).
  BACKEND BLOCKED by an SDK `/core` packaging regression at `a1cde1f` — reverted to
  its working pin `b9d4da10` (still deployed, builds clean). a1cde1f REMOVED
  `dist-core` and moved `exports['./core']` to `dist/core.js` under a `{type:module}`
  dist, so /core is now ESM AND transitively pulls `dist/wallet/signers/
  xverse.signer.js` -> `sats-connect` (not a backend dep). The CommonJS backend
  (module:commonjs, classic resolution, a compile-time paths alias
  `ordpool-sdk/core -> dist-core/core`, runtime `require`) fails BOTH ways: `nest
  build` -> 7x TS2307 (dangling dist-core alias), and `require('ordpool-sdk/core')`
  -> ERR_MODULE_NOT_FOUND sats-connect.
  ATTRIBUTION CORRECTED (I first blamed a1cde1f — the range-vs-endpoint error the HQ
  warns about): `dist-core` was removed in `8b642a8` (15 Sep), 93 commits BEFORE
  a1cde1f and after the backend's pin. So it is "the backend never bumped past a
  packaging migration", not "a1cde1f broke it". Revert to b9d4da10 was still right.
  THE FIX IS VIABLE and mapped (SDK coordinator built a server-facing subpath
  `d7ca026`): the backend's 5 symbols all live on LEAN ESM subpaths —
  validateCat21BuyOfferPsbt / verifyBip322Signature / MAX_ASK_SATS ->
  `ordpool-sdk/cat21-validation`, buildCat21SessionMessage / checkSessionValidity ->
  `ordpool-sdk/cat21-session`, Network -> `ordpool-sdk/network`. None pull
  sats-connect. RUNTIME require of all three PROVEN from CommonJS on the backend's
  Node (local v24.16, PROD happysrv v25.8.1 confirmed via SSH:
  `ExecStart=.../linuxbrew/bin/node main.js`), past the require-ESM threshold.
  BUT THE BLOCKER IS NOW JEST, NOT RUNTIME: the backend's unit tests are ts-jest in
  CommonJS with default `transformIgnorePatterns` (node_modules untransformed), and
  jest's CJS runtime CANNOT load the ESM subpaths — empirically `SyntaxError: Cannot
  use import statement outside a module` on a probe importing `ordpool-sdk/network`.
  b9d4da10 never hit this because dist-core was CJS. THE FORK (coordinator's
  packaging call): (A) backend-side = shim + repoint the 5 imports + tsconfig aliases
  + a jest transformIgnorePatterns change to transform ordpool-sdk ESM (keep the
  existing empty-`sats-connect` moduleNameMapper); (B) SDK-side = ship the lean
  subpaths ALSO as CJS (dual-format / dist-cjs), making the backend a near-trivial
  bump with no jest change. Recommended (B); the maintainer asked and chose (B).
  RESOLVED VIA (B), SHIPPED + VERIFIED LIVE (693b93d on stage_prod; /api/cat/0, /api/v1/bids/25/1, /api/v1/listings/25/1 all 200 post-restart; health status ok, uptime reset; lastSyncedCat -1/total 0 is expected cold-start per cache.service.ts:71). SDK `77a7633` ("a CommonJS build behind the
  server-facing subpaths") adds a `require` exports condition -> `dist-cjs/` for
  `./cat21-validation`, `./cat21-session`, `./network`. No browser bundle moves (no
  bundler resolves `require`; no frontend imports these). Backend bumped to 77a7633
  (`51f3c8a` on main): imports repointed to the three subpaths, tsconfig `paths`
  aliases repointed at the subpath `dist/*.d.ts` (compile-time types; Node/jest
  resolve the runtime `require` condition to dist-cjs), `@scure/btc-signer`
  1.2.2->1.6.0. NO jest change, NO shim. PROBE PASSES: the spec that gave `SyntaxError:
  Cannot use import statement outside a module` against the ESM subpath now loads
  under ts-jest via the `require` condition. Specs retargeted (requireActual +
  override the controlled collaborator; real MAX_ASK_SATS/Network match the old
  stubs, no behaviour change); bids validator mock mutation-checked (misdirect reds 15
  tests). Build clean, full unit suite green (370), code-only deploy (empty migration
  diff), prod happysrv Node 25.8.1. Deploy gated on Test Backend green on 51f3c8a +
  the SDK e2e lanes green on 77a7633.
  `@scure/btc-signer` 1.2.2->1.6.0 verified fine (uses only `btc.Transaction.fromPSBT`).
  Pin dance caught npm serving a stale git resolution TWICE — the explicit `npm
  install github:...#<sha>` forces re-resolution; the on-disk lockfile+dist check is
  the only proof, never the package.json edit. When the SDK ships a whole-package CJS
  build it costs cat21.space/cubes ~500kB each and breaks ordpool's budget — but a
  `require`-condition CJS emit on server-only subpaths no browser imports moves zero
  bytes (coordinator checked, not assumed).
- (superseded) The frontend half of this batch, when it was still pending:
  (a) `0ab9fd4` — one candidate coin the builder refuses is a ROW, not an emptied
      pool with the reason dropped. VERIFIED UNREACHABLE on cat21.space (all funding
      candidates come from ONE payment address = one script type, so the builder
      cannot refuse one-but-not-others; a sub-feasibility coin returns
      `finalFeeSats: null`, it does not throw). Robustness, not a live bug.
  (b) Adopt `classifyCandidateFee` (SDK `a1cde1f`, exported from `'ordpool-sdk'`,
      `src/index.ts:80`): swap utxo-picker's INLINE displayRows derivation for the
      call. Verified byte-identical order (unavailable -> overpay-unknown ->
      overpay/normal) and `CandidateFeeState` === my `FundingFeeState` exactly, so it
      is a swap of derivation for the call, NOT a behaviour change. The field
      (`absorbedSubDustSats`) was the wrong unit — three consumers re-derived it
      three ways (we grew a 4th state `6b636c6`, ordpool collapsed null+0, cubes
      rendered nothing); the READING is the right unit.
  (c) Wire the `autoScan` floor: pass `fundingRequirementSats` as `minValueSat`
      (SDK `99ebbf2`). This is the LIVE user-facing half — the picker currently
      scans the whole dust tail, two HTTP round-trips per coin against OUR OWN ord
      instances, for rows no screen can act on. Plus mint pricing 936ms->513ms on a
      200-coin wallet.
  Do the FULL pin-verify dance (workspace HQ "Pinning a sha pins neither what it
  runs against nor itself"): SDK's own lanes green on the target sha FIRST, on-disk
  scure-version + installed-peer-range + lockfile-sha + known-file-diff, then clear
  `.angular/cache`. #2 (`6b636c6`) already rides main and folds into this batch. The
  BACKEND pin (`b9d4da10`, 231 behind) is a SEPARATE decision/pipeline: it imports
  `validateCat21BuyOfferPsbt` from `/core` and the offer-validation core changed in
  the offer-size-parity era, so its bump ADOPTS real work, non-urgent.
- TRANSFER + MAKE-OFFER NOTICE REPLICATION — SHIPPED. Notice lane green on
  `3663b02`; pushed `main:stage_prod` (`29729f2..3663b02`) 2026-09-19 after the
  full airtight sweep + a local production `ng build` (warnings only: pre-existing
  initial-bundle + wallet-connect.scss budgets, no errors). Blast radius:
  frontend-only, NO schema migrations. Both screenshots (transfer three-fee-states,
  make-offer ★+over-pay) delivered to the maintainer. Deploy = Build Cat21 Frontend
  on stage_prod -> cat21-frontend-build -> Cloudflare Pages; landed-check
  (live-bundle grep for the notice string + fresh-context nested deep link) is the
  last step. The feature commits: pin 9e578ef
  `014f7da` (asset-notice carries its simulation — the precondition), transfer
  `167999a`, make-offer `4f6c9c3`. The verification: dedicated fresh-wallet notice
  lane `04907cd` (spec + workflow, own regtest stack), measured contrast added
  `3663b02`. Each surface got, ATOMICALLY: `'derive'` on the
  orchestrator ports + `assetNotice`/`noticeAssets` computeds (mirror mint.ts) +
  the named-asset notice UI (transfer-asset-notice / make-offer-asset-notice, mirror
  mint.html's `mint-asset-notice`, TRIMMED to what each renders — no picker chip
  helpers) + rune-etching resolution + `feeByOutpoint`/`recommendedOutpoint` on the
  shared picker. `'derive'` ships WITH the notice UI by construction — apart they are
  the disabled-CTA-no-reason dead end (which is one commit into the change, not in
  today's code: without `'derive'` transfer/make-offer over-block but still work via
  the expert-required warning + honored "Use anyway", verified against source in
  resolveFundingPick).
  - THE VERIFICATION LANE (DONE, `04907cd` + contrast `3663b02`, green). First
    attempt appended the
    dirty-only notice cells to the dirty-coin GUARD lanes and it went red — the
    guard cells run first and each funds a clean coin + transfers, leaving clean
    change on cat21wallet's fixed-seed payment address, so the recommendation took
    `auto` and no notice rendered. That is E2E_BEST_PRACTICES §7.8 WIDENED (SDK
    coordinator `d5d45a7`): the dirty-only premise breaks not only across runs but
    INSIDE ONE LANE — a fresh chain does not save you from the cell before yours,
    because any completed tx hands change back to the same address. Removed the
    misplaced cells (`d463c49`); main is green again (dirty-coin lanes test
    clean-covers, unaffected by `'derive'`). The premise-assertion payoff held: the
    failure message named shared-address accumulation as suspect #1 and the
    diagnosis was over — no rendering debug.
  - THE FIX (SHIPPED as `04907cd`): a DEDICATED FRESH-WALLET notice lane —
    new spec + new workflow, mirroring `cat21wallet-mint-assetnotice-regtest.spec.ts`
    + `mint-assetnotice-regtest.yml` (its own regtest stack, wallet starts empty).
    Put BOTH cells there (neither completes a tx, so both premises hold): the
    TRANSFER cell seeds a dirty-coin SPREAD [600,900,1100,1300,1700,3000,12000]
    bracketing the over-pay band (band = [fundingRequirementSats,
    fundingPreferredSats); preferred edge is the PAYMENT address's own
    changeDustFloor, 294 for cat21wallet's P2WPKH — NOT flat 546) and asserts
    data-fee-state shows at least one `overpay` + one `unavailable` (fails LOUD
    listing what was found — a spread that stops bracketing reds, not green-proving-
    nothing; do NOT re-tune the spread to match a predicted state, that is the spread
    working) + notice visible + names an Inscription + transfer-cta ENABLED. The
    MAKE-OFFER cell is the surface gate: notice + make-offer-cta ENABLED (the shared
    picker's three states are the transfer cell's job). Each cell asserts its §7.8
    premise at setup with the remedy in the failure text. The saved cell code is in
    this session's transcript. Then: browser-verify by LOOKING at the screenshot
    myself (contrast of the new labels as a NEW PAIR on the orange body; all three
    states visible together — trim the SCREENSHOT pool, not the assertion, if seven
    rows is too tall; the ★ must land on the SMALLEST covering coin, dirty-branch
    best-fit is against the REQUIREMENT — report to the SDK coordinator if not) ->
    FYI the maintainer (changed artifact) -> stage_prod.
  - THE HOLD LOGIC (why it was held, kept as the durable lesson): main's other
    green lanes exercise only clean-covers, so "main is green" said NOTHING about the
    notice branch until the dedicated lane existed. A changed money-path branch with
    nothing exercising it is the fact that says no — the notice lane IS that
    exercise, and only its green un-held stage_prod.
  TWO THINGS FROM `recommendFunding` (SDK coordinator read the source) THAT SHAPE
  THESE LANES — plan for them, don't discover them:
  1. THE RECOMMENDED COIN IN A NOTICE CAN ITSELF BE THE OVER-PAYER. The headroom
     bias (recommend a coin clearing `fundingPreferredSats` so it emits clean change)
     applies ONLY inside the CLEAN set. On `asset-notice` / `expert-required`, where
     no clean coin covers, the pick is best-fit against the REQUIREMENT, not the
     preferred target — so the recommended coin arrives with `absorbedSubDustSats > 0`
     and the ★ AT THE SAME TIME. On screen that pair (★ recommended + "over-pays N
     sat" on one row) looks like a bug and is not: in a dirty-only pool "smallest
     that covers" spends the least and avoids biasing toward burning a more valuable
     asset. RENDER that combination deliberately in the notice lane + capture a
     screenshot of it (the one state no lane has shown yet). Do NOT "fix" the row to
     hide the over-pay flag on a recommended coin.
  2. THE PICKER GETS EVERYTHING, unfiltered. `fundingRecommendation().candidates` is
     the full input list on EVERY status (incl. `insufficient`), NOT just covering
     coins. Sub-feasibility coins arrive with `finalFeeSats: null` +
     `absorbedSubDustSats: null` -> the UNAVAILABLE state, which in a small-change
     wallet is MOST of the list. Already handled (displayRows renders null fee as
     "can't fund at this rate", pick disabled, row dimmed) — but the transfer/offer
     notice lanes should seed a wallet where several rows are unavailable and assert
     they render unavailable (rate named, never free, not pickable), not assume every
     row is pickable.

CONTRAST: the mint picker's status labels + the "Use anyway"/"Selected" override
control were bare colours on the orange body (asset-found #ff6b6b = 1.30:1). Fixed
to filled badges (light fill + dark text, the shared UtxoPicker's Bootstrap pairs,
~7:1). PINNED by a RENDERED-PAGE WCAG assertion in the assetnotice lane
(`measuredTextContrast` reads computed colour vs the actually-painted background,
walks up if a fill is removed, asserts >= 4.5, ratio in the message), mutation-
checked. A status label is INFORMATION and must read on its ground; a bare colour
on a saturated body fails and a hex-math check on the source can't see it.

PICKER CONVERGENCE — the drift finding, sequenced across sessions:

- cat21.space's MINT page has its OWN inline picker (`mint-utxo-*` in mint.html /
  mint.scss); transfer + make-offer use the shared `UtxoPicker` component. That
  divergence IS why the contrast bug existed in one place and not the other.
- Mint's picker differs by exactly: (1) a per-row miner FEE
  (`row.simulation.finalTransactionFee`) — NOT uniform per coin, because sub-dust
  change is absorbed into the fee (`finalFeeSats = feeSats + absorbedIntoFee`), so
  identical-rate coins cost different money out; (2) a confirmed/unconfirmed label.
- Ruling (with the ordpool-sdk coordinator): KEEP the fee, CONVERGE mint onto the
  shared picker, via a TYPED optional per-row input (`feeByOutpoint` / detail
  record), NOT a projected slot (a slot just relocates the divergence). Confirmed/
  unconfirmed goes in the shared component for all three (electrs can list one
  outpoint twice around confirmation — two rows disagreeing on `confirmed` is the
  known HQ dedup bug, not a mystery).
- ORDER (do NOT reorder): the SDK coordinator FIRST lifts the per-candidate fee
  into the core, THEN this repo grows the shared `UtxoPicker`'s typed input against
  that shape, THEN mint drops its inline picker. Do NOT build against mint's
  orchestrator-local `UtxoSimulationRow`. Do this during the transfer/make-offer
  replication, AFTER the maintainer signs off the mint pattern — never touch a
  surface mid-review.
- THE FEE COLUMN IS MANDATORY, not optional (family ruling, FAMILY_UX `127a8d6`).
  A coin row names its assets AND its per-coin cost, because both are consequences
  of picking that coin, and the fee genuinely DIFFERS between rows: sub-dust change
  folds into the miner fee, a 7-13% over-pay in the dust-cliff band, so a picker
  WITHOUT the fee misleads — the smaller coin reads as the modest choice while it
  is often the over-payer. Same failure as an unnamed asset, in the money column.
  So `feeByOutpoint` is THE column on all three surfaces, and `finalFeeSats: null`
  renders as UNAVAILABLE, never 0/free (a null-as-0 advertises a coin at no cost
  that cannot pay at all). COORDINATE the presentation shape with the ordpool
  session before/while building — ordpool is landing the same ruling; this repo
  builds it into the SHARED component, so our shape wins by default and should win
  on purpose (one family shape, not two reasonable-in-isolation ones).
- CORE SHAPE IS LIVE (ordpool-sdk `b407e62`, bump the pin when you start this):
  `CandidateFeeRow { txid; vout; finalFeeSats: number|null; vsize: number|null;
  absorbedSubDustSats: number|null }` and `outpointKey(u)` -> `${txid}:${vout}`,
  both exported from root + `/core`. `absorbedSubDustSats` IS the three-state
  distinction as an SDK-owned policy field, NOT something to re-derive per surface
  (the derivation `value >= requirement && value < preferred` is a POLICY rule;
  three surfaces re-implementing it is three chances to drift, and a drift shows a
  usable coin as unavailable or an over-payer as clean): `0` = emits normal change
  (state 1, normal); positive = sub-dust folded into the fee (state 2, over-pay,
  FLAG it); `null` = cannot fund at this rate (state 3, unavailable). Do NOT
  recompute it from finalFeeSats. Inscribe reports `absorbedSubDustSats: null`
  even when it CAN fund, because `simulateInscribeFees` does not yet surface the
  commit's own fold — an honest gap, so an inscribe row states the package cost
  and says the fold is unknown rather than implying `0`. If the inscribe breakdown
  panel needs the real fold, ask the SDK to surface it, don't derive it.
  `simulateMint/Transfer/CreateOffer/Inscribe` each return `candidateFees:
  CandidateFeeRow[]`, keyed on the same outpoint the recommendation uses, present
  on EVERY status incl. `expert-required` + `asset-notice` (exactly when a picker
  renders). `finalFeeSats: null` = the coin CANNOT fund at that rate -> render
  UNAVAILABLE, never as free/zero. Inscribe prices the commit+reveal PACKAGE (its
  cost is two txs). The shared `UtxoPicker`'s typed input is a `feeByOutpoint`
  built from that array. `simulateTransfer` + `simulateCreateOffer` also gained
  `fundingRequirementSats` / `fundingPreferredSats` (mint + inscribe already had
  them) — you need both, the requirement alone is half the selection rule.
- CONFIRMED/UNCONFIRMED: add to the shared component for all three (TxnOutput
  carries `status.confirmed`). electrs can list one outpoint twice around
  confirmation (HQ dedup rule) — two rows for one outpoint disagreeing on
  `confirmed` is the KNOWN bug, deduped before it reaches the picker.
- CONTRAST HELPER LESSON (now a FAMILY_UX rule): a measurement is code and can be
  wrong in the same shape as the thing it measures — a contrast check that parses
  `rgba()` but drops the alpha silently passes a translucent overlay (reads
  rgba(0,0,0,0.15) as solid black). ALWAYS mutation-check the ASSERTION, not only
  the styling it guards. `measuredTextContrast` (assetnotice spec) composites
  alpha; reuse its shape when pinning the shared picker's contrast.
- NOTICE-LANE E2E for transfer/make-offer (E2E_BEST_PRACTICES §7.7/§7.8, WIDENED
  on ordpool-sdk `db3ec2d`): the mechanism is RE-RENDER, not gating. A gated CTA
  is just the common instance — a control fails a single click whenever ANYTHING
  can re-render it between the locator resolving and the click landing: a
  `disabled` bound to a signal/resource, a sibling whose selected state changes, a
  list that reorders, a parent that swaps children on load. So the grep before a
  notice lane is NOT "is this control gated" but "what re-renders this control
  between the click line and the assertion line". For the picker specifically the
  SCAN RESOLVING re-renders the rows, so ANYTHING clicked in the picker while the
  scan is still resolving is in scope, not just the CTA. Route those through
  `clickUntilEffect` from `ordpool-sdk/e2e` (`0342982`) — re-clicks only while the
  control is visible+enabled with the effect absent.
- §7.7c — A RETRY COUNTER PROVES A RETRY HAPPENED, NEVER THAT IT WAS NECESSARY.
  `clickUntilEffect`'s `{ clicks }` is a statement about our own code wearing the
  authority of a measurement. A green `clicks === 1` is ONE data point about ONE
  control, not a claim about the repo; and a `clicks > 1` does not prove a product
  defect (cubes retracted its 2/2/2/3 counts — they were its own helper's ignored-
  timeout `isVisible` toggling a popover, no product bug, escalated to the
  maintainer on that false evidence). Before concluding ANYTHING from a count, find
  the INDEPENDENT signal: element identity across clicks (same-node), not the
  self-reported number.
- FOOTGUN IN THIS REPO (found by the db3ec2d grep, fix DEFERRED to the notice-lane
  work, do NOT touch mid-gate): `isVisible({ timeout })` / `isHidden({ timeout })`
  COMPILE AND IGNORE the timeout (Playwright marks it deprecated-and-ignored), so
  the check runs BEFORE the render and an optional-dialog dismissal silently no-
  ops. Two sites: `funding-guard-inscription-regtest.spec.ts:138` and
  `cat21-mint-regtest.spec.ts:188` (both `notNow.isVisible({ timeout: 1_500 })`).
  Fix with `isVisibleWithin(locator, ms)` from the `/e2e` barrel (sdk `013faa7`,
  needs a pin carrying it) — NOT a bare `waitFor` (it THROWS when the optional
  dialog legitimately is not there; only safe if catch-wrapped). The other
  `isVisible()` calls in e2e/ pass no timeout and are honest synchronous guards —
  do NOT let a later sweep churn them; the defect is only the call that reads as a
  wait and is not one. NB: because this fix needs a pin bump, run the workspace
  pin-verify dance when you do it (see the workspace HQ "Pinning a sha pins neither
  what it runs against nor itself" rule): confirm the on-disk `@scure/btc-signer`
  version, the peer range the INSTALLED sdk declares, the lockfile entry, and a
  diff of one known file against the sha you meant (`node_modules/ordpool-sdk/
  package.json` carries a fixed `"version": "0.1.0"` and no `_resolved`, so it
  cannot tell you which sha you have), then clear `.angular/cache` — a build error
  that contradicts the files on disk is cache pollution, not dependency evidence.
- And assert the dirty-only PREMISE at SETUP time with the remedy in the failure
  message (a fixed-seed wallet accumulates across local runs: green in CI's fresh
  stack, wrong-coin locally on run 2).
- §7.7e (SDK `5c73896`) — A FUNDING COIN IS NOT CLEAN BECAUSE YOU JUST CREATED IT:
  on regtest with `--index-sats` a coinbase output's first sat is an UNCOMMON rare
  sat, and prior mints leave cats on the funder's coins, so a plain `sendtoaddress`
  + expect-auto-select is rolling dice; the SDK's own real-ord lanes fund with
  `fundCommonSats` (forces change to vout 0, absorbs the boundary sat) instead.
  AUDITED here 2026-09-19: the ONLY two cat21-indexer lanes that use `sendtoaddress`
  (`cat21-mint-regtest.spec.ts`, `cat21wallet-mint-regtest.spec.ts`, 12 sites) are
  NOT bitten, because BOTH install a CONTEXT-level `context.route('**/output/*')`
  in beforeAll (lines 151 / 299) returning `CLEAN_OUTPUT_BODY`. The funding-safety
  classifier fetches ord `/output/<outpoint>` as a BROWSER request -> hits that mock
  -> the real coin's dirtiness is invisible to the product. The context mock IS
  these lanes' determinism guarantee (same job fundCommonSats does for a real-ord
  lane). The asset-scanner tests (mint 475/509, wallet 556/578) override with a
  PAGE-level `cats:[0]` route for their target outpoint — deterministic, not luck.
  DO NOT "fix" these lanes by swapping in fundCommonSats: it adds ord-sync waits a
  mocked lane does not need and changes nothing the classifier sees. The notice lane
  uses seedDirtyCoin/seedListedCat (deterministic) and has no clean-CTA cell, so the
  cardinal-funding half of §7.7e has no cell to attach to here.
  THE TRADE, NAMED (SDK `7b0ec03` folded it into §7.7e): the context mock buys
  determinism at the cost of NEVER EXERCISING THE REAL SCAN. A repo that mocks
  `/output` in its flow lanes therefore NEEDS at least one lane that hits real ord,
  or the classifier has zero proof. That lane is
  `funding-guard-inscription-regtest.spec.ts` — verified "No mock" (hits stock ord
  :8081 for `inscriptions`, cat21-ord :8080 for cats), and its load-bearing
  assertion is the inscription id in the asset-notice panel, which ONLY stock ord's
  `inscriptions` field can produce. The arrangement is sound (mocked lanes for the
  flows, one real-ord lane for the classifier) but LOAD-BEARING: retire
  funding-guard-inscription for being awkward and the mocks flip from a reasonable
  trade to a blind spot in one step. Do not delete or neuter it.

SETTLED FEE-COLUMN SHAPE (three-way: cat21 + ordpool + cubes, 2026-09-18). The
family agreed one shape, still shape-only, no builds until the maintainer lifts
the mint sign-off gate. Points, some sharper than the original proposal because
the peers already had pickers on screen:

- FEE cell renders the family Money shape, `<n> sat (~<fiat>)`, sats space-
  grouped, and the FIAT HALF IS OMITTED ENTIRELY when no rate is known (never 0,
  never a dash). cat21 + cubes format via the SDK's `formatSatsWithUsd`; ordpool
  via mempool's `<app-fiat>` over its websocket. Same SHAPE, each site's own rate
  source, deliberately NOT byte-identical.
- The commit+reveal qualifier is PER-SURFACE, not per-repo. Inscribe-type
  surfaces price the commit+reveal PACKAGE and take the qualifier; mint-type
  surfaces omit it. Qualifying surfaces across the family: cubes, ordpool-inscribe,
  cat21-inscribe-if-any. cat21's MINT picker omits it (a mint is one tx). Wording
  is TRAILING: `fee 4 750 sat (commit + reveal)`, never a parenthetical between
  the label and its value (that breaks the number-column scan for the two surfaces
  that don't need it). The qualifier is a REMINDER only; the teaching version
  (`commit 1540 + reveal 3210 = 4750 sat`) lives in a breakdown panel the inscribe
  surface owns, NOT in the shared row.
- RECOMMENDED coin: MARK IN PLACE, keep the natural/value sort, do NOT sort the
  recommendation to the top. The cost column exists so the reader sees the
  cheaper-looking row is cheaper for a reason; sorting the recommendation first
  destroys that comparison ("why not the cheaper one?" is only answerable while
  the cheaper row is still visibly above). The badge on the cheap row carries the
  answer (asset found, or over-pays via the dust fold).
- THREE fee states, not two (ordpool's framing), discriminated by the SDK's
  `absorbedSubDustSats` field (see CORE SHAPE), NOT re-derived: (1) NORMAL —
  `absorbedSubDustSats === 0`, pickable, "<n> sat (~<fiat>)"; (2) DUST-FOLD
  OVER-PAY — `absorbedSubDustSats > 0`, pickable but FLAGGED, the band where sub-
  dust change folds into the miner fee (a 7-13% absorbed-change over-pay; on cat21
  the fold itself is a deliberate feature, rarer color + faster tx, see
  `project_dust_absorb_is_feature`, so the flag is informational, not a block);
  (3) TRULY-UNAVAILABLE — `absorbedSubDustSats === null` (finalFeeSats also null),
  greyed + unpickable, with a STATED REASON that names the RATE as the variable:
  "can't fund at this rate" (so lowering the rate predictably flips the row).
  Never a dash, never 0. The over-pay flag (state 2) is LOAD-BEARING for the mark-
  in-place choice: it is what makes the recommended coin legible as the answer to
  "why not the cheaper row?" without re-sorting. It is not decoration.
- ASSETS render on a SECOND LINE under the coin row, named + linked, not crammed
  into the badge: the badge says a coin is DIRTY, the line says WHAT ("Assets on
  this UTXO: <id linked>", "rare sat: uncommon · sat … · block …"). In a one-line
  row that content truncates or shoves the fee column (the one being added) off
  the edge.
- "ONE SHAPE" is a shared visual/textual SPEC, not necessarily one component.
  ordpool is the mempool AGPL fork: it hand-rolls its pickers, imports no
  `UtxoPicker`, and has no transfer/offer surfaces (those are cat21 + wallet). It
  MATCHES the shape locally. So the contract is: the shared SDK `UtxoPicker` for
  cat21's own surfaces, and a matched spec everyone else replicates. Each repo's
  extras (ordpool's Scan/Retry + Use-anyway) stay local around the shared columns.
- CONTRAST is measured PER-GROUND, never inherited from the ground that passed.
  cubes measured its own panel and it FAILED on the dark ground (badge 3.48:1,
  override 2.94:1) with every colour individually valid and only the pairing
  wrong. Any shared measurement helper must carry the translucent-refusal /
  alpha-compositing guard from the overlay finding (the `measuredTextContrast`
  shape in the assetnotice spec), and the pair must be re-measured on orange
  (cat21), dark (cubes), and ordpool's ground separately.

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

Only the **backend** depends on `ordpool-parser` (for `Cat21ParserService.parse()`
during sync). The frontend gets cat SVGs from the backend, no direct parser
dependency.

The pin in `backend/package.json` is a GitHub commit hash, not a semver — we
bump dependents by updating the hash, not by minor-versioning the parser:

```jsonc
"ordpool-parser": "github:ordpool-space/ordpool-parser#<commit-sha>"
```

For local dev with a linked version:

```bash
# In ordpool-parser/
npm run build && cd dist && npm link

# In cat21-indexer/backend
npm link ordpool-parser
```
