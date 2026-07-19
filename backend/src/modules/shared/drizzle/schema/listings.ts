import { randomUUID } from 'node:crypto';
import {
  mysqlTable,
  varchar,
  int,
  bigint,
  text,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';

/**
 * The "cat orderbook" — public sell listings. Each row is a seller-
 * signed intent-to-sell for a specific cat UTXO at a specific price.
 *
 * Anti-fraud gate: every row's `signature` is a BIP-322 signature by
 * the seller's ordinals wallet over the canonical listing message
 * (see ordpool-sdk `buildListingMessage`). The signature commits to
 * every other column via the message, so if any field is tampered
 * with in transit, the signature no longer verifies and the row is
 * dropped at INSERT time. External clients can re-verify a row's
 * signature offline from the columns alone.
 *
 * Pruning: an hourly job fetches each listing's cat via ord and
 * compares `(cat_txid, cat_vout)` against the current on-chain
 * outpoint. Mismatch → cat has moved → the sell intent is void → row
 * DELETED. See `listings.pruner.ts`.
 *
 * Unique per cat: at most one active listing per `cat_number` — a
 * seller re-listing at a new price overwrites the old row (see the
 * unique index). This keeps the "orderbook" a snapshot of current
 * intent, not a historical log.
 */
export const listings = mysqlTable(
  'listings',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),

    // ---- Signed fields — the BIP-322 signature commits to these ----
    // Order matches ordpool-sdk `buildListingMessage`'s field order.
    catNumber: int('cat_number').notNull().unique(),
    // askSats is bigint because Bitcoin prices routinely exceed 2^32
    // sats (2^32 = ~42 BTC — normal for a rare-cat listing).
    askSats: bigint('ask_sats', { mode: 'number' }).notNull(),
    payTo: varchar('pay_to', { length: 128 }).notNull(),
    catTxid: varchar('cat_txid', { length: 64 }).notNull(),
    catVout: int('cat_vout').notNull(),
    ordinalsAddress: varchar('ordinals_address', { length: 128 }).notNull(),
    // Unix seconds at signing time. Anti-replay hint — the service
    // MAY reject listings whose signedAt is outside a sanity window.
    signedAt: int('signed_at').notNull(),

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
    // Pruner iterates listings and checks (cat_txid, cat_vout) against
    // ord — indexed for the eventual "delete where mismatch" scan.
    index('idx_listings_outpoint').on(table.catTxid, table.catVout),
    // Feed sort: most recent first when browsing the orderbook.
    index('idx_listings_signed_at').on(table.signedAt),
  ],
);
