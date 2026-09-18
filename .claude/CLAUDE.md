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

#### Asset-to-miner safeguard (mint DONE) + picker convergence (SEQUENCED, deferred)

The maintainer's "never spend an asset to the miners by accident" ruling. MINT is
done + proven: separate-address wallet + dirty-only pool -> `asset-notice` (notice
naming the asset, CTA enabled, proceed); one-address wallet -> `expert-required`
(CTA disabled + picker). The component adopts the recommendation for BOTH `auto`
and `asset-notice` (mint.ts) — adopting only `auto` was a shipped bug that made the
notice never render (regression-guarded by mint.spec.ts E2b, mutation-checked).
Proofs: `cat21wallet-mint-assetnotice-regtest.spec.ts` (4/4, names the seeded
asset per class, CTA enabled) + E2 (one-address block) / E2b (asset-notice adopt).
`fundingTopology: 'derive'` is passed by mint only; transfer + make-offer still
OMIT it (safe over-block) until their own slices.

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
- CORE SHAPE IS LIVE (ordpool-sdk `89db425`, bump the pin when you start this):
  `CandidateFeeRow { txid; vout; finalFeeSats: number|null; vsize: number|null }`
  and `outpointKey(u)` -> `${txid}:${vout}`, both exported from root + `/core`.
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
- NOTICE-LANE E2E for transfer/make-offer (E2E_BEST_PRACTICES §7.7/§7.8): route
  every gated-CTA click through `clickUntilEffect` from `ordpool-sdk/e2e`
  (`0342982`) — it re-clicks only while the control is visible+enabled with the
  effect absent, returns `{ clicks }` so `expect(clicks).toBe(1)` turns a swallowed
  click into a visible failure. And assert the dirty-only PREMISE at SETUP time
  with the remedy in the failure message (a fixed-seed wallet accumulates across
  local runs: green in CI's fresh stack, wrong-coin locally on run 2).

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
