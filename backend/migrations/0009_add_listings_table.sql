CREATE TABLE `listings` (
	`id` varchar(36) NOT NULL,
	`cat_number` int NOT NULL,
	`ask_sats` bigint NOT NULL,
	`pay_to` varchar(128) NOT NULL,
	`cat_txid` varchar(64) NOT NULL,
	`cat_vout` int NOT NULL,
	`ordinals_address` varchar(128) NOT NULL,
	`signed_at` int NOT NULL,
	`signature` varchar(512) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `listings_id` PRIMARY KEY(`id`),
	CONSTRAINT `listings_cat_number_unique` UNIQUE(`cat_number`)
);
--> statement-breakpoint
CREATE INDEX `idx_listings_outpoint` ON `listings` (`cat_txid`,`cat_vout`);
--> statement-breakpoint
CREATE INDEX `idx_listings_signed_at` ON `listings` (`signed_at`);
