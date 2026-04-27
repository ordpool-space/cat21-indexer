CREATE TABLE `cats` (
	`id` varchar(36) NOT NULL,
	`cat_number` int NOT NULL,
	`tx_hash` varchar(64) NOT NULL,
	`block_hash` varchar(64) NOT NULL,
	`block_height` int NOT NULL,
	`minted_at` datetime(3) NOT NULL,
	`minted_by` varchar(256),
	`fee` bigint NOT NULL,
	`weight` int NOT NULL,
	`size` int NOT NULL,
	`feerate` double NOT NULL,
	`sat` bigint NOT NULL,
	`value` bigint NOT NULL,
	`category` varchar(50) NOT NULL DEFAULT '',
	`genesis` boolean NOT NULL DEFAULT false,
	`cat_colors` json NOT NULL DEFAULT ('[]'),
	`male` boolean NOT NULL DEFAULT false,
	`female` boolean NOT NULL DEFAULT false,
	`design_index` int NOT NULL DEFAULT 0,
	`design_pose` varchar(50) NOT NULL DEFAULT '',
	`design_expression` varchar(50) NOT NULL DEFAULT '',
	`design_pattern` varchar(50) NOT NULL DEFAULT '',
	`design_facing` varchar(10) NOT NULL DEFAULT '',
	`laser_eyes` varchar(50) NOT NULL DEFAULT 'None',
	`background` varchar(50) NOT NULL DEFAULT '',
	`background_colors` json NOT NULL DEFAULT ('[]'),
	`crown` varchar(50) NOT NULL DEFAULT 'None',
	`glasses` varchar(50) NOT NULL DEFAULT 'None',
	`glasses_colors` json NOT NULL DEFAULT ('[]'),
	CONSTRAINT `cats_id` PRIMARY KEY(`id`),
	CONSTRAINT `cats_cat_number_unique` UNIQUE(`cat_number`),
	CONSTRAINT `cats_tx_hash_unique` UNIQUE(`tx_hash`)
);
--> statement-breakpoint
CREATE INDEX `idx_cats_block_height` ON `cats` (`block_height`);--> statement-breakpoint
CREATE INDEX `idx_cats_minted_by` ON `cats` (`minted_by`);--> statement-breakpoint
CREATE INDEX `idx_cats_genesis` ON `cats` (`genesis`);--> statement-breakpoint
CREATE INDEX `idx_cats_design_pose` ON `cats` (`design_pose`);--> statement-breakpoint
CREATE INDEX `idx_cats_laser_eyes` ON `cats` (`laser_eyes`);--> statement-breakpoint
CREATE INDEX `idx_cats_background` ON `cats` (`background`);--> statement-breakpoint
CREATE INDEX `idx_cats_crown` ON `cats` (`crown`);--> statement-breakpoint
CREATE INDEX `idx_cats_glasses` ON `cats` (`glasses`);--> statement-breakpoint
CREATE INDEX `idx_cats_feerate` ON `cats` (`feerate`);