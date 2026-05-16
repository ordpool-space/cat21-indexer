ALTER TABLE `cats` ADD `rarity_bits` double;--> statement-breakpoint
ALTER TABLE `cats` ADD `rarity_rank` int;--> statement-breakpoint
CREATE INDEX `idx_cats_category_rarity_rank` ON `cats` (`category`, `rarity_rank`);
