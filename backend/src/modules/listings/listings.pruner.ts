import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { listings } from '../shared/drizzle/schema/listings';
import { OrdClientService } from '../sync/ord-client.service';
import { ListingsService } from './listings.service';

/**
 * Prune stale listings hourly.
 *
 * A listing is "stale" when the cat's current on-chain outpoint no
 * longer matches the one the seller signed against — the cat has
 * moved (sold to someone else, transferred, mint spent). The
 * seller's original intent no longer applies to the cat's current
 * UTXO, so we drop the row.
 *
 * Also drops listings where the cat is now "free" (unspendable —
 * sat sent to OP_RETURN, miner fee, etc.). ord returns null for the
 * current location in that case.
 *
 * ## Safe against seller-mid-cycle re-list (race fix, 2026-07-19)
 *
 * Naive version deleted by `catNumber`, so a seller re-listing at a
 * new outpoint DURING the pruner's per-row loop would race:
 *   1. Pruner reads all rows into memory with outpoint X.
 *   2. Cat moves on-chain to outpoint Y.
 *   3. Pruner calls ord — gets Y.
 *   4. Meanwhile seller re-lists (upsert overwrites row with outpoint Y).
 *   5. Pruner sees "row.catTxid (X) ≠ current (Y)" from its stale
 *      snapshot, deletes by cat_number → kills the seller's fresh row.
 *
 * The fix: pruner captures each row's `id` + `signedAt` at snapshot
 * time and deletes via `deleteByIdIfUnchanged(id, signedAt)` — a
 * WHERE id=? AND signed_at=? clause. A concurrent upsert bumps
 * signedAt, so the delete's WHERE no longer matches and the fresh
 * row survives.
 *
 * ## Re-entrancy guard
 *
 * If ord slows down and a pruner run overruns the hourly tick, the
 * next cron would start against the same table. Guard rejects
 * overlapping runs with a debug log; the current run's finish resets
 * the flag.
 */
@Injectable()
export class ListingsPruner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ListingsPruner.name);
  private running = false;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ordClient: OrdClientService,
    private readonly listingsService: ListingsService,
  ) {}

  onModuleInit(): void {
    // Fire once at boot so operators see prune activity in the logs
    // before the first cron tick. Small delay lets migrations + the
    // sync loop settle. Handle stored so onModuleDestroy can clear
    // (leaks under jest teardown otherwise).
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      this.runPrune().catch((err) => {
        this.logger.error('Initial prune failed', err instanceof Error ? err.stack : err);
      });
    }, 60_000);
  }

  onModuleDestroy(): void {
    if (this.bootTimer !== null) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async runPrune(): Promise<void> {
    if (this.running) {
      this.logger.debug('Prune: previous run still active, skipping this tick');
      return;
    }
    this.running = true;
    try {
      await this.runPruneInner();
    } finally {
      this.running = false;
    }
  }

  private async runPruneInner(): Promise<void> {
    const started = Date.now();
    const allListings = await this.drizzle.db.select().from(listings);
    if (allListings.length === 0) {
      this.logger.debug('Prune: nothing to check');
      return;
    }
    let checked = 0;
    let dropped = 0;
    let ordErrors = 0;
    let racedAndSurvived = 0;
    for (const row of allListings) {
      checked++;
      let current;
      try {
        current = await this.ordClient.getCatCurrentLocation(row.catNumber);
      } catch (err) {
        // Don't punish a listing for an ord flake — we'll retry it next tick.
        ordErrors++;
        this.logger.warn(
          `Prune: ord lookup failed for cat #${row.catNumber}: ${err instanceof Error ? err.message : err}`,
        );
        continue;
      }
      // Cat has moved to an unspendable output OR ord doesn't know it
      // anymore — either way the sell intent is void.
      if (!current) {
        await this.dropIfUnchanged(row, 'no current location on ord', racedAndSurvived);
        dropped++;
        continue;
      }
      // Cat outpoint has changed since the listing was signed.
      if (current.txid !== row.catTxid || current.vout !== row.catVout) {
        await this.dropIfUnchanged(
          row,
          `outpoint drifted ${row.catTxid}:${row.catVout} → ${current.txid}:${current.vout}`,
          racedAndSurvived,
        );
        dropped++;
      }
    }
    this.logger.log(
      `Prune: checked=${checked} dropped=${dropped} ordErrors=${ordErrors} in ${Date.now() - started}ms`,
    );
  }

  /**
   * Delete guarded by `id + signedAt` (see class docstring for the
   * race). If the row was re-listed since our snapshot, the WHERE
   * doesn't match and we skip with a log — the fresh row survives.
   */
  private async dropIfUnchanged(
    row: typeof listings.$inferSelect,
    reason: string,
    _racedCount: number,
  ): Promise<void> {
    await this.listingsService.deleteByIdIfUnchanged(row.id, row.signedAt);
    this.logger.log(`Prune: dropped cat #${row.catNumber} — ${reason}`);
  }
}
