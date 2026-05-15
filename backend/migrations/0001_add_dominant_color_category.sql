ALTER TABLE `cats` ADD `dominant_color_category` varchar(20);--> statement-breakpoint
CREATE INDEX `idx_cats_dominant_color_category` ON `cats` (`dominant_color_category`);
