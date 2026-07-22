import { randomUUID } from 'node:crypto';
import {
  mysqlTable,
  varchar,
  int,
  bigint,
  datetime,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';

import { jsonColumn } from './json-column';

const jsonNumberArray = jsonColumn<number[]>();

/**
 * The "cat orderbook" — public sell listings. Each row is a seller-
 * signed intent-to-sell for a specific cat UTXO at a specific price.
 *
 * v3 identity model (2026-07-22): the load-bearing identifier is
 * (cat_txid, cat_vout) — the UTXO — plus the FULL set of cats
 * riding on it (cats_on_utxo). A PSBT spends the whole UTXO, not
 * an individual sat; a listing that pretended to sell one cat while
 * hiding a bundle-mate would leak the bundle-mate to the buyer for
 * free.
 *
 * Anti-fraud gate: every row's `signature` is a BIP-322 signature by
 * the seller's ordinals wallet over the canonical listing message
 * (ordpool-sdk `buildListingMessage` v3, which includes the sorted
 * `cats=` line). The signature commits to every column via the
 * message, so external clients can re-verify the row offline from
 * columns alone.
 *
 * Unique per UTXO: at most one active listing per
 * `(network, cat_txid, cat_vout)` — a seller re-listing at a new
 * price overwrites their previous row via onDuplicateKeyUpdate.
 * The pruner deletes by primary key `id` guarded by `signed_at` to
 * avoid killing a freshly-upserted row (see the pruner).
 */
export const listings = mysqlTable(
  'listings',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),

    // ---- Signed fields — the BIP-322 signature commits to these ----
    // Order matches ordpool-sdk `buildListingMessage`'s field order (v3).

    // Bitcoin network the seller signed against — 'mainnet' /
    // 'testnet3' / 'testnet4' / 'signet' / 'regtest'. Load-bearing
    // for anti-replay across networks.
    network: varchar('network', { length: 16 }).notNull(),

    // Headline cat number for display. Always a member of
    // cats_on_utxo (SDK's serializeCats enforces this pre-sign).
    catNumber: int('cat_number').notNull(),

    // Snapshot of every cat currently on the UTXO the listing pins.
    // Sorted ascending, deduped — same byte order as the seller's
    // signed `cats=` line. Ord `/output/<outpoint>` is the source
    // of truth at insert time; the pruner re-checks hourly.
    catsOnUtxo: jsonNumberArray('cats_on_utxo').notNull(),

    // Denormalised headline for the (network, headline) sort index.
    // Same value as catNumber today; kept as its own indexed column
    // for the browse-by-headline query path.
    headlineCatNumber: int('headline_cat_number').notNull(),

    // askSats is bigint because Bitcoin prices routinely exceed 2^32
    // sats (2^32 = ~42 BTC — normal for a rare-cat listing). Capped
    // at 21 M BTC in application code (MAX_ASK_SATS in the SDK).
    askSats: bigint('ask_sats', { mode: 'number' }).notNull(),

    payTo: varchar('pay_to', { length: 128 }).notNull(),
    catTxid: varchar('cat_txid', { length: 64 }).notNull(),
    catVout: int('cat_vout').notNull(),
    ordinalsAddress: varchar('ordinals_address', { length: 128 }).notNull(),

    // Unix seconds at signing time. BIGINT (not INT) — INT overflows
    // 2038-01-19 (Y2038). Anti-replay hint — the service rejects
    // listings whose signedAt is outside a 24h back / 1h future
    // window.
    signedAt: bigint('signed_at', { mode: 'number' }).notNull(),

    // ---- Signature over the above (base64, wallet-emitted) ----
    // Length up to ~256 chars: Xverse's wrapped-witness format is
    // roughly 90 chars base64; leave headroom for future wallet variants
    // or upgraded signature schemes.
    signature: varchar('signature', { length: 512 }).notNull(),

    // ---- Server-side ----
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // v3 uniqueness: one active ask per UTXO per network. A seller
    // re-listing under the same wallet at a new price replaces the
    // previous row atomically via onDuplicateKeyUpdate.
    uniqueIndex('listings_utxo_unique').on(table.network, table.catTxid, table.catVout),
    // Pruner scan: iterate listings and check outpoint against ord.
    // Kept even though (network, cat_txid, cat_vout) is already the
    // unique index — the pruner scans by outpoint alone and doesn't
    // filter by network in the query.
    index('idx_listings_outpoint').on(table.catTxid, table.catVout),
    // Feed sort: most recent first when browsing the orderbook.
    index('idx_listings_signed_at').on(table.signedAt),
    // Headline browse: "show me all listings sorted by lowest cat number".
    index('idx_listings_headline_cat_number').on(table.headlineCatNumber),
  ],
);
