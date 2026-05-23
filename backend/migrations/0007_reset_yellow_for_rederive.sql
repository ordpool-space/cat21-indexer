-- Bucket boundary green↔yellow moved from hue 70° to 62° in
-- ordpool-parser eba6a56. NULL the whole column so the boot-time
-- SyncService.backfillDominantColorCategory rederives every cat with
-- the current threshold — same belt-and-braces approach as 0004.
UPDATE `cats` SET `dominant_color_category` = NULL;
