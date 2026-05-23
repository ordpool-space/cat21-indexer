-- Bucket boundary green↔yellow moved from hue 70° to 62° in
-- ordpool-parser eba6a56. Chartreuse cats (G > R) that previously
-- landed in 'yellow' now bucket as 'green'. NULLing the affected rows
-- lets SyncService.backfillDominantColorCategory rederive them on the
-- next boot with the new threshold.
--
-- Only 'yellow' rows can change: the new threshold is narrower, so
-- only old-yellow → new-green is possible; other buckets are stable.
UPDATE `cats` SET `dominant_color_category` = NULL WHERE `dominant_color_category` = 'yellow';
