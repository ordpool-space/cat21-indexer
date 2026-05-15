import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, inArray, isNull, max, sum } from 'drizzle-orm';
import { Cat21ParserService, getCatColorCategory } from 'ordpool-parser';
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

  // Genesis cats are excluded by the WHERE clause and remain NULL on
  // purpose — getCatColorCategory returns null for them anyway.
  async onModuleInit(): Promise<void> {
    this.backfillDominantColorCategory().catch((e) => {
      this.logger.warn(
        `Dominant-color backfill failed: ${e instanceof Error ? e.message : String(e)}`,
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
        .where(and(isNull(cats.dominantColorCategory), eq(cats.genesis, false)))
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
            male: traits?.gender === 'Male',
            female: traits?.gender === 'Female',
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
    } catch (error) {
      this.lastErrorAt = new Date();
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error('Sync failed', error);
    } finally {
      this.blockHashCache.clear();
      this.syncing = false;
    }
  }
}
