-- v3 hard break: the on-chain identity of a listing is the cat UTXO
-- plus the FULL set of cats that ride on it (a UTXO can hold multiple
-- cats via consolidation of previously-minted 546-sat cat UTXOs).
-- v2 rows have zero data in prod (verified 2026-07-22); a straight
-- DELETE clears the way for the new shape without a backfill path.
DELETE FROM `listings`;
--> statement-breakpoint
-- Drop the v2 uniqueness on cat_number — v3 pins uniqueness to the
-- cat UTXO, not the cat number, because a PSBT spends the whole UTXO.
ALTER TABLE `listings` DROP INDEX `listings_cat_number_unique`;
--> statement-breakpoint
-- Snapshot of cats currently on the UTXO (json array of cat numbers).
-- Sorted ascending, deduped — same byte order the seller signed.
ALTER TABLE `listings` ADD COLUMN `cats_on_utxo` json NOT NULL;
--> statement-breakpoint
-- Headline cat number for the row's display sort. Always a member of
-- cats_on_utxo (validated by the SDK's serializeCats before signing).
-- Denormalised for indexed sort/search; recomputable from cats_on_utxo.
ALTER TABLE `listings` ADD COLUMN `headline_cat_number` int NOT NULL;
--> statement-breakpoint
-- New uniqueness: one active ask per (network, cat_txid, cat_vout).
-- A seller re-listing at a new price still overwrites the previous
-- row via onDuplicateKeyUpdate — but now the key is the UTXO.
ALTER TABLE `listings` ADD CONSTRAINT `listings_utxo_unique` UNIQUE (`network`, `cat_txid`, `cat_vout`);
--> statement-breakpoint
-- Sort/search index for headline browsing.
CREATE INDEX `idx_listings_headline_cat_number` ON `listings` (`headline_cat_number`);
