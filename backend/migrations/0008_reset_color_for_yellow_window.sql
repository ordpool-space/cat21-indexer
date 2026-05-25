-- Yellow window narrowed again to hue [51°, 61°) in ordpool-parser
-- c8206c1. NULL every row so SyncService.backfillDominantColorCategory
-- rederives with the current threshold on the next boot.
UPDATE `cats` SET `dominant_color_category` = NULL;
