import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { eq, inArray, isNull, max, sum } from 'drizzle-orm';
import { Cat21ParserService, getCatColorCategory, RarityToken, scoreAndRank } from 'ordpool-parser';
import { CacheService } from '../shared/cache/cache.service';
import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { cats } from '../shared/drizzle/schema/cats';
import { OrdCatDetail, OrdClientService } from './ord-client.service';

const BATCH_SIZE = 50;

export function deriveCategory(catNumber: number): string {
  if (catNumber < 1000) return 'sub1k';
  if (catNumber < 10000) return 'sub10k';
  if (catNumber < 50000) return 'sub50k';
  if (catNumber < 100000) return 'sub100k';
  if (catNumber < 250000) return 'sub250k';
  if (catNumber < 500000) return 'sub500k';
  if (catNumber < 1000000) return 'sub1M';
  return '';
}

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);
  private syncing = false;
  private localMax = -1;
  private readonly blockHashCache = new Map<number, string>();

  private lastSuccessAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ordClient: OrdClientService,
    private readonly cache: CacheService,
  ) {}

  getSyncHealth(): { lastSuccessAt: Date | null; lastErrorAt: Date | null; lastError: string | null } {
    return {
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }

  // Genesis cats included: getCatColorCategory now returns 'black' or
  // 'white' for them (matching the parser's two hardcoded genesis
  // palettes). The pre-color-expansion version of this code excluded
  // genesis because the parser returned null.
  async onModuleInit(): Promise<void> {
    this.backfillDominantColorCategory()
      .then(() => this.recomputeRarityForAllCategories())
      .catch((e) => {
        this.logger.warn(
          `Boot-time backfill failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
  }

  private async backfillDominantColorCategory(): Promise<void> {
    const BACKFILL_BATCH = 500;
    let total = 0;
    while (true) {
      const rows = await this.drizzle.db
        .select({
          catNumber: cats.catNumber,
          txHash: cats.txHash,
          blockHash: cats.blockHash,
          feeRate: cats.feeRate,
        })
        .from(cats)
        .where(isNull(cats.dominantColorCategory))
        .limit(BACKFILL_BATCH);

      if (rows.length === 0) break;

      // Group by computed color so each color costs one UPDATE instead of
      // one per row. Per-row updates were ~50ms × N — collapses to 7
      // queries per batch (one per color bucket + maybe one for NULL).
      const byCategory = new Map<string | null, number[]>();
      for (const row of rows) {
        const category = getCatColorCategory(row.txHash, row.blockHash, row.feeRate);
        const bucket = byCategory.get(category) ?? [];
        bucket.push(row.catNumber);
        byCategory.set(category, bucket);
      }
      for (const [category, catNumbers] of byCategory) {
        await this.drizzle.db
          .update(cats)
          .set({ dominantColorCategory: category })
          .where(inArray(cats.catNumber, catNumbers));
      }

      total += rows.length;
      this.logger.log(`Dominant-color backfill: updated ${total} cats so far`);

      if (rows.length < BACKFILL_BATCH) break;
    }
    if (total > 0) {
      this.logger.log(`Dominant-color backfill complete: ${total} cats updated`);
    }
  }

  @Interval(60_000)
  async handleSync() {
    await this.sync();
  }

  private async getBlockHashCached(height: number): Promise<string> {
    const cached = this.blockHashCache.get(height);
    if (cached) return cached;

    const hash = await this.ordClient.getBlockHash(height);
    this.blockHashCache.set(height, hash);
    return hash;
  }

  async sync() {
    if (this.syncing) {
      this.logger.debug('Sync already in progress, skipping');
      return;
    }

    this.syncing = true;

    try {
      // 1. On first run, check DB. After that, use cached localMax (saves a query per tick).
      if (this.localMax < 0) {
        const [result] = await this.drizzle.db
          .select({ maxCatNumber: max(cats.catNumber) })
          .from(cats);
        this.localMax = result.maxCatNumber ?? -1;
      }

      // 2. Check what ord has (HTTP call, no DB query)
      const remoteMax = await this.ordClient.getLatestCatNumber();

      if (remoteMax <= this.localMax) {
        this.logger.debug(`Already up to date (local: #${this.localMax}, remote: #${remoteMax})`);
        this.lastSuccessAt = new Date();
        return;
      }

      const totalToSync = remoteMax - this.localMax;
      this.logger.log(`Syncing cats #${this.localMax + 1} to #${remoteMax} (${totalToSync} cats)`);

      let nextCatNumber = this.localMax + 1;
      let insertedCount = 0;

      while (nextCatNumber <= remoteMax) {
        // Fetch a batch of cats in parallel
        const batchEnd = Math.min(nextCatNumber + BATCH_SIZE, remoteMax + 1);
        const numbers = Array.from({ length: batchEnd - nextCatNumber }, (_, i) => nextCatNumber + i);

        const settled = await Promise.allSettled(
          numbers.map((n) => this.ordClient.getCat(n)),
        );
        const details = settled
          .filter((r): r is PromiseFulfilledResult<OrdCatDetail | null> => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter((d): d is OrdCatDetail => d !== null);

        if (details.length === 0) break;

        // Fetch block hashes for unique heights in parallel
        const uniqueHeights = [...new Set(details.map((d) => d.height))];
        await Promise.all(uniqueHeights.map((h) => this.getBlockHashCached(h)));

        // Process and insert
        const rows = details.map((detail) => {
          const blockHash = this.blockHashCache.get(detail.height)!;
          const txid = detail.id.replace(/i\d+$/, '');

          const parsed = Cat21ParserService.parse({
            txid,
            locktime: 21,
            weight: detail.weight,
            fee: detail.fee,
            status: { block_hash: blockHash },
          });

          const traits = parsed?.getTraits();
          const feeRate = detail.fee / (detail.weight / 4);
          // null for genesis cats; one of red/orange/yellow/green/blue/purple/pink otherwise.
          const dominantColorCategory = getCatColorCategory(txid, blockHash, feeRate);

          return {
            catNumber: detail.number,
            txHash: txid,
            blockHash,
            blockHeight: detail.height,
            mintedAt: new Date(detail.timestamp * 1000),
            mintedBy: detail.minted_by,
            fee: detail.fee,
            weight: detail.weight,
            size: detail.size,
            feeRate,
            sat: detail.sat,
            value: detail.value,
            category: deriveCategory(detail.number),
            genesis: traits?.genesis ?? false,
            catColors: traits?.catColors ?? [],
            gender: traits?.gender ?? '',
            designIndex: traits?.designIndex,
            designPose: traits?.designPose,
            designExpression: traits?.designExpression,
            designPattern: traits?.designPattern,
            designFacing: traits?.designFacing,
            laserEyes: traits?.laserEyes,
            background: traits?.background,
            backgroundColors: traits?.backgroundColors ?? [],
            crown: traits?.crown,
            glasses: traits?.glasses,
            glassesColors: traits?.glassesColors ?? [],
            dominantColorCategory,
          };
        });

        await this.drizzle.db.insert(cats).ignore().values(rows);

        // Notify cache after each batch so paginated requests see progress during
        // long initial syncs (minutes-long on fresh deployments).
        const batchMax = rows[rows.length - 1].catNumber;
        this.cache.onNewCatsSynced(batchMax);

        insertedCount += details.length;
        nextCatNumber += numbers.length;

        if (insertedCount % 100 < BATCH_SIZE) {
          this.logger.log(`Synced ${insertedCount}/${totalToSync} cats (up to #${nextCatNumber - 1})`);
        }
      }

      this.localMax = remoteMax;
      this.cache.onNewCatsSynced(remoteMax);

      // Refresh Proof of Cat Work from DB (authoritative)
      const [sumResult] = await this.drizzle.db
        .select({ proofOfCatWork: sum(cats.fee) })
        .from(cats);
      this.cache.setProofOfCatWork(Number(sumResult.proofOfCatWork ?? 0));

      this.logger.log(`Sync complete: ${insertedCount} new cats (synced up to #${remoteMax})`);
      this.lastSuccessAt = new Date();

      // After new cats arrive, the categories they fell into need re-
      // ranking (their frequency tables shifted). Cheap on closed
      // categories (no-op) because we recompute everything and the cats
      // stay in the same order. Simpler than tracking dirty categories.
      if (insertedCount > 0) {
        await this.recomputeRarityForAllCategories().catch((e) => {
          this.logger.warn(
            `Rarity recompute after sync failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
      }
    } catch (error) {
      this.lastErrorAt = new Date();
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error('Sync failed', error);
    } finally {
      this.blockHashCache.clear();
      this.syncing = false;
    }
  }

  /**
   * Per-category OpenRarity scoring. Iterates every category, runs
   * `scoreAndRank` from ordpool-parser on the category's cats, writes
   * back `rarityBits` and `rarityRank`. Closed categories (where all
   * rows already have rarityRank set) could be skipped, but we re-score
   * every time anyway because the cost is small and it makes the boot
   * path simpler.
   *
   * Each cat is scored against the other cats in its category only —
   * sub1k cats never compete with sub10k cats. That's the user-visible
   * narrative ("each category is a distinct collection").
   *
   * Tokens for the scorer: every searchable trait surfaced as a string
   * attribute. Empty-string values get the parser's "absent" treatment;
   * `dominantColorCategory` null becomes `'none'` so it doesn't sort
   * against synthesized Null (genesis cats now have non-null colors
   * anyway, so this is defense in depth).
   */
  private async recomputeRarityForAllCategories(): Promise<void> {
    const CATEGORIES = ['sub1k', 'sub10k', 'sub50k', 'sub100k', 'sub250k', 'sub500k', 'sub1M'];
    for (const category of CATEGORIES) {
      await this.recomputeRarityForCategory(category);
    }
  }

  private async recomputeRarityForCategory(category: string): Promise<void> {
    const rows = await this.drizzle.db
      .select({
        catNumber: cats.catNumber,
        genesis: cats.genesis,
        gender: cats.gender,
        designPose: cats.designPose,
        designExpression: cats.designExpression,
        designPattern: cats.designPattern,
        designFacing: cats.designFacing,
        laserEyes: cats.laserEyes,
        background: cats.background,
        crown: cats.crown,
        glasses: cats.glasses,
        dominantColorCategory: cats.dominantColorCategory,
      })
      .from(cats)
      .where(eq(cats.category, category));

    if (rows.length === 0) return;

    const tokens: RarityToken<number>[] = rows.map((r) => ({
      id: r.catNumber,
      attrs: {
        // Boolean genesis as string. Rare value ('true', ~0.4%) → ~8 bits
        // contribution; common 'false' → ~0 bits. Mirrors how the trait
        // is exposed in search.
        genesis:    r.genesis ? 'true' : 'false',
        gender:     r.gender,
        pose:       r.designPose,
        expression: r.designExpression,
        pattern:    r.designPattern,
        facing:     r.designFacing,
        eyes:       r.laserEyes,
        background: r.background,
        crown:      r.crown,
        glasses:    r.glasses,
        color:      r.dominantColorCategory ?? 'none',
      },
    }));

    const ranked = scoreAndRank(tokens);

    // === The Genesis Cat Bonus ===
    //
    // Cat #0 is rank 1 in sub1k. Always. The genesis cat holder has
    // spoken — this is law, not math. `rarityBits` stays honest; only
    // the rank label is pinned. See ordpool-parser/CAT21-RARITY-SCORE.md
    // for the full narrative. Limited to sub1k by definition.
    if (category === 'sub1k') {
      const i = ranked.findIndex((r) => r.id === 0);
      if (i > 0) {
        const cat0 = ranked.splice(i, 1)[0];
        ranked.unshift(cat0);
        ranked.forEach((r, n) => { r.rank = n + 1; });
      }
    }

    // Sequential UPDATEs. Acceptable on a single-instance backend with
    // current category sizes; the largest open category is sub250k
    // (potentially 150k rows), which would take ~7 minutes one-time on
    // a cold boot. Subsequent syncs only mint a handful of cats and
    // re-rank fast.
    for (const r of ranked) {
      await this.drizzle.db
        .update(cats)
        .set({ rarityBits: r.bits, rarityRank: r.rank })
        .where(eq(cats.catNumber, r.id));
      // Drop the in-memory cache entry so the next /api/cat/N request
      // re-reads the row (now with updated rarity) from the DB.
      this.cache.invalidateCat(r.id);
    }
    this.logger.log(`Rarity recomputed for category ${category}: ${ranked.length} cats ranked`);
  }
}
