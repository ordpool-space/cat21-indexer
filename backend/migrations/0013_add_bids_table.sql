-- The BID orderbook — the buyer side of the marketplace. A bid IS a
-- half-signed PSBT the buyer posts publicly. Anyone (the current
-- seller, or a would-be seller who owns the cat) can seller-sign
-- input 0 and broadcast; the PSBT's own SIGHASH_ALL signatures on
-- inputs 1..N are the buyer's auth, so no BIP-322 wrapping layer.
--
-- Uniqueness: (network, cat_txid, cat_vout, buyer_ordinals_address)
--   — one bid per (UTXO, buyer). A buyer re-bidding at a new price
--   replaces their previous bid. Different buyers coexist on the
--   same UTXO — that's the FOMO channel where bidders can outbid.
CREATE TABLE `bids` (
	`id` varchar(36) NOT NULL,
	`network` varchar(16) NOT NULL,
	-- Anchor to the seller's cat UTXO (input 0 of the PSBT).
	`cat_txid` varchar(64) NOT NULL,
	`cat_vout` int NOT NULL,
	-- Snapshot of the cats on the UTXO at bid time. If a cat gets
	-- consolidated onto/off the UTXO before the seller accepts, the
	-- pruner sees the drift and evicts the bid the same way stale
	-- listings get evicted.
	`cats_on_utxo` json NOT NULL,
	`headline_cat_number` int NOT NULL,
	-- What the buyer will pay (from PSBT output 1's amount minus the
	-- postage top-up). BIGINT for the same reason as listings — sub-
	-- 21 M BTC ceiling enforced in app code, not schema.
	`bid_sats` bigint NOT NULL,
	-- Where the cat lands. This IS the buyer identity for the unique
	-- constraint — a "different" PSBT that routes the cat to the same
	-- ordinals address is the same buyer, and replaces their bid.
	`buyer_ordinals_address` varchar(128) NOT NULL,
	-- Where the buyer's change goes. Never used for uniqueness (a
	-- buyer switching payment wallets while keeping the same
	-- ordinals address is still the same buyer).
	`buyer_payment_address` varchar(128) NOT NULL,
	-- The seller-payment address baked into the PSBT (output 1).
	-- Denormalised for the display "you'll pay to X" without parsing.
	`seller_payment_address` varchar(128) NOT NULL,
	-- The half-signed PSBT itself, base64. Text (not varchar) — a
	-- multi-input buyer PSBT can exceed 4 KB with witness data.
	`psbt_base64` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `bids_id` PRIMARY KEY(`id`),
	CONSTRAINT `bids_utxo_buyer_unique` UNIQUE (`network`, `cat_txid`, `cat_vout`, `buyer_ordinals_address`)
);
--> statement-breakpoint
-- Fetch all bids for a UTXO, sort by price DESC — the seller's view.
CREATE INDEX `idx_bids_outpoint` ON `bids` (`cat_txid`, `cat_vout`);
--> statement-breakpoint
-- Sort/browse by cat headline (all bids on cat #42, wherever it
-- currently lives).
CREATE INDEX `idx_bids_headline_cat_number` ON `bids` (`headline_cat_number`);
