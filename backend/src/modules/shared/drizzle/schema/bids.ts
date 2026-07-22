import { randomUUID } from 'node:crypto';
import {
  mysqlTable,
  varchar,
  int,
  bigint,
  text,
  datetime,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';

import { jsonColumn } from './json-column';

const jsonNumberArray = jsonColumn<number[]>();

/**
 * The buyer-side orderbook. A row IS a half-signed PSBT the buyer
 * posted publicly — the seller (whoever owns the cat UTXO right
 * now) signs input 0 and broadcasts. The PSBT's own SIGHASH_ALL
 * signatures on inputs 1..N are the buyer's authorisation, so no
 * BIP-322 wrapping layer is needed.
 *
 * Uniqueness: `(network, cat_txid, cat_vout, buyer_ordinals_address)`
 *   — one bid per (UTXO, buyer). A buyer re-bidding at a new price
 *   replaces their previous row via onDuplicateKeyUpdate. Different
 *   buyers coexist on the same UTXO; that's the FOMO channel where
 *   competing bids drive the price up.
 *
 * Buyer identity = the ordinals address the cat will land at
 * (`buyer_ordinals_address`, from PSBT output 0). Two "different"
 * PSBTs that route the cat to the same ordinals address ARE the
 * same buyer for the uniqueness gate.
 *
 * Pruner (X.3): drops rows when the seller's cat UTXO has moved
 * (PSBT input 0 stale) OR the buyer's funding UTXOs have been
 * spent elsewhere (PSBT inputs 1..N stale). Same delete-by-id-
 * guarded-by-signed-time pattern as the listings pruner (avoids
 * killing a freshly-upserted row).
 */
export const bids = mysqlTable(
  'bids',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),

    // Bitcoin network the bid targets. Load-bearing for the same
    // anti-replay reason listings carry it.
    network: varchar('network', { length: 16 }).notNull(),

    // Anchor to the seller's cat UTXO (input 0 of the PSBT).
    catTxid: varchar('cat_txid', { length: 64 }).notNull(),
    catVout: int('cat_vout').notNull(),

    // Snapshot of the cats on the UTXO at bid time. If a cat gets
    // consolidated onto / off the UTXO before the seller accepts,
    // the pruner sees the drift and evicts the bid.
    catsOnUtxo: jsonNumberArray('cats_on_utxo').notNull(),

    // Denormalised headline for the browse-by-cat index.
    headlineCatNumber: int('headline_cat_number').notNull(),

    // Bid price in sats. What the seller receives from the PSBT's
    // output 1 (minus the postage top-up per ord parity).
    bidSats: bigint('bid_sats', { mode: 'number' }).notNull(),

    // Where the cat lands. THIS is the buyer identity for the
    // uniqueness constraint. A different PSBT that sends the cat to
    // the same ordinals address is the same buyer and replaces
    // their previous bid.
    buyerOrdinalsAddress: varchar('buyer_ordinals_address', { length: 128 }).notNull(),

    // Where the buyer's change output goes. Not part of the uniqueness
    // key — a buyer swapping funding wallets while keeping the same
    // ordinals address is still the same buyer.
    buyerPaymentAddress: varchar('buyer_payment_address', { length: 128 }).notNull(),

    // The seller-payment address baked into PSBT output 1. Stored
    // denormalised so the display "you'll receive at X" doesn't
    // require re-parsing the PSBT.
    sellerPaymentAddress: varchar('seller_payment_address', { length: 128 }).notNull(),

    // The half-signed PSBT itself, base64-encoded. `text` (not
    // varchar) — a multi-input buyer PSBT with witness data can
    // exceed 4 KB.
    psbtBase64: text('psbt_base64').notNull(),

    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('bids_utxo_buyer_unique').on(
      table.network,
      table.catTxid,
      table.catVout,
      table.buyerOrdinalsAddress,
    ),
    // Fetch all bids for a UTXO (the seller's "who wants my cat" view).
    index('idx_bids_outpoint').on(table.catTxid, table.catVout),
    // Browse-by-cat: "show me all bids on cat #42, wherever it lives".
    index('idx_bids_headline_cat_number').on(table.headlineCatNumber),
  ],
);
