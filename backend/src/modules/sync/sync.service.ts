import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { max } from 'drizzle-orm';
import { Cat21ParserService } from 'ordpool-parser';
import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { cats } from '../shared/drizzle/schema/cats';
import { OrdCatDetail, OrdClientService } from './ord-client.service';

const BATCH_SIZE = 10;

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
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private syncing = false;
  private readonly blockHashCache = new Map<number, string>();

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ordClient: OrdClientService,
  ) {}

  @Interval(10_000)
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
      // 1. Check what we have locally
      const [result] = await this.drizzle.db
        .select({ maxCatNumber: max(cats.catNumber) })
        .from(cats);

      const localMax = result.maxCatNumber ?? -1;

      // 2. Check what ord has (one request to /cats, one to get the newest cat's number)
      const remoteMax = await this.ordClient.getLatestCatNumber();

      if (remoteMax <= localMax) {
        this.logger.debug(`Already up to date (local: #${localMax}, remote: #${remoteMax})`);
        return;
      }

      const totalToSync = remoteMax - localMax;
      this.logger.log(`Syncing cats #${localMax + 1} to #${remoteMax} (${totalToSync} cats)`);

      let nextCatNumber = localMax + 1;
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

          return {
            catNumber: detail.number,
            txHash: txid,
            blockHash,
            blockHeight: detail.height,
            mintedAt: new Date(detail.timestamp * 1000),
            mintedBy: detail.address,
            fee: detail.fee,
            weight: detail.weight,
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
          };
        });

        await this.drizzle.db.insert(cats).values(rows).onConflictDoNothing();

        insertedCount += details.length;
        nextCatNumber += numbers.length;

        if (insertedCount % 100 < BATCH_SIZE) {
          this.logger.log(`Synced ${insertedCount}/${totalToSync} cats (up to #${nextCatNumber - 1})`);
        }
      }

      this.logger.log(`Sync complete: ${insertedCount} new cats (synced up to #${remoteMax})`);
      this.blockHashCache.clear();
    } catch (error) {
      this.logger.error('Sync failed', error);
    } finally {
      this.syncing = false;
    }
  }
}
