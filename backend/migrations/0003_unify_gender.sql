ALTER TABLE `cats` ADD `gender` varchar(10) NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `cats` SET `gender` = CASE WHEN `male` = 1 THEN 'Male' WHEN `female` = 1 THEN 'Female' ELSE '' END;--> statement-breakpoint
ALTER TABLE `cats` DROP COLUMN `male`;--> statement-breakpoint
ALTER TABLE `cats` DROP COLUMN `female`;
