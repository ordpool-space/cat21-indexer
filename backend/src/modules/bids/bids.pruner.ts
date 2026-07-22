import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { bids } from '../shared/drizzle/schema/bids';
import { OrdClientService } from '../sync/ord-client.service';
import { BidsService } from './bids.service';

/**
 * Prune stale bids hourly.
 *
 * A bid is stale when the seller's cat UTXO no longer carries the
 * cats the buyer signed for — either the outpoint is gone (cat
 * already sold to someone else, or transferred) or the bundle
 * drifted (cats consolidated onto/off the UTXO).
 *
 * Not yet implemented in this pass: the buyer-side funding-UTXO
 * liveness check. That requires electrs `/tx/<txid>/outspend/<vout>`
 * per input and adds complexity — deferred to a follow-up once the
 * marketplace has traffic. Today the pruner only handles seller-side
 * drift, which is the more common eviction cause.
 *
 * Re-entrancy guard (jest teardown safety) mirrors the listings
 * pruner pattern; delete-by-id guarded by `created_at` avoids
 * killing a freshly-upserted row (the buyer re-bids after the
 * pruner's snapshot but before the delete).
 */
@Injectable()
export class BidsPruner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BidsPruner.name);
  private running = false;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ordClient: OrdClientService,
    private readonly bidsService: BidsService,
  ) {}

  onModuleInit(): void {
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
    const allBids = await this.drizzle.db.select().from(bids);
    if (allBids.length === 0) {
      this.logger.debug('Prune: nothing to check');
      return;
    }

    // Bids are per-UTXO; multiple bids on the same UTXO share the
    // same ord lookup. Group by outpoint to skip redundant calls.
    const grouped = new Map<string, typeof allBids>();
    for (const row of allBids) {
      const key = `${row.catTxid}:${row.catVout}`;
      const arr = grouped.get(key) ?? [];
      arr.push(row);
      grouped.set(key, arr);
    }

    let checked = 0;
    let dropped = 0;
    let ordErrors = 0;
    for (const [outpoint, group] of grouped) {
      const [txid, voutStr] = outpoint.split(':');
      const vout = Number(voutStr);
      let live: number[] | null;
      try {
        live = await this.ordClient.getCatsAtOutput(txid, vout);
      } catch (err) {
        ordErrors++;
        this.logger.warn(
          `Prune: ord /output lookup failed for ${outpoint}: ${err instanceof Error ? err.message : err}`,
        );
        continue;
      }
      for (const row of group) {
        checked++;
        // UTXO no longer holds cats OR bundle drifted: every bid on
        // this outpoint is stale.
        const isStale = live === null || live.length === 0 || !bidCatsMatchLive(row.catsOnUtxo, live);
        if (!isStale) continue;
        await this.dropRow(row, live);
        dropped++;
      }
    }
    this.logger.log(
      `Prune: checked=${checked} dropped=${dropped} ordErrors=${ordErrors} in ${Date.now() - started}ms`,
    );
  }

  private async dropRow(
    row: typeof bids.$inferSelect,
    live: number[] | null,
  ): Promise<void> {
    await this.bidsService.deleteByOutpointAndBuyer(
      row.network,
      row.catTxid,
      row.catVout,
      row.buyerOrdinalsAddress,
    );
    this.logger.log(
      `Prune: dropped bid on ${row.catTxid}:${row.catVout} from buyer ${row.buyerOrdinalsAddress} — ` +
        `signed cats=[${row.catsOnUtxo.join(',')}], live=[${(live ?? []).join(',')}]`,
    );
  }
}

/**
 * Set-equality on cats arrays. Both sides are ascending-deduped per
 * insert-time canonicalization, but sort on read too to guard
 * against a JSON-storage round-trip that preserves insertion order
 * from an older schema.
 */
function bidCatsMatchLive(signed: number[], live: number[]): boolean {
  if (signed.length !== live.length) return false;
  const sa = [...signed].sort((a, b) => a - b);
  const sb = [...live].sort((a, b) => a - b);
  return sa.every((v, i) => v === sb[i]);
}
