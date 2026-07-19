-- Add the `network` column to `listings` — required for v2 message
-- shape (cross-network signature-replay defence). Existing rows (if
-- any survived the v1 window) are defaulted to 'mainnet' and then
-- the default is dropped so all subsequent inserts must pass it
-- explicitly. This matches the v2 canonical message which always
-- includes a network line.
ALTER TABLE `listings` ADD COLUMN `network` varchar(16) NOT NULL DEFAULT 'mainnet';
--> statement-breakpoint
ALTER TABLE `listings` ALTER COLUMN `network` DROP DEFAULT;
