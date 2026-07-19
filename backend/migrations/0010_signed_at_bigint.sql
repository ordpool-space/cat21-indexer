-- Y2038 fix: `signed_at` was INT (signed 32-bit), max value 2^31-1
-- = 2 147 483 647 = 2038-01-19 03:14:07 UTC. Every listing signed
-- after that instant would overflow the column. BIGINT lifts the
-- ceiling ~1000x beyond the age of the universe.
--
-- Safe hot-schema change: MODIFY COLUMN on an INT → BIGINT is
-- lossless (widening only). No data conversion beyond byte-length.
-- MariaDB does an online rebuild for reasonably small tables; the
-- orderbook is bounded by unique(cat_number).
ALTER TABLE `listings` MODIFY `signed_at` bigint NOT NULL;
