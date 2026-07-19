import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
 * Also drops listings where the cat is now "free" (unspendable — sat
 * sent to OP_RETURN, miner fee, etc.). ord returns null for the
 * current location in that case.
 *
 * Runs once at boot (after a small startup delay so migrations
 * apply and ord is reachable) and then hourly. Sequential per
 * listing to keep ord traffic gentle — the orderbook is bounded in
 * size (there are only so many cats in circulation), and each
 * ord query is single-digit ms.
 */
@Injectable()
export class ListingsPruner implements OnModuleInit {
  private readonly logger = new Logger(ListingsPruner.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ordClient: OrdClientService,
    private readonly listingsService: ListingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Fire once at boot so operators see prune activity in the logs
    // before the first cron tick. Small delay lets migrations + the
    // sync loop settle.
    setTimeout(() => {
      this.runPrune().catch((err) => {
        this.logger.error('Initial prune failed', err instanceof Error ? err.stack : err);
      });
    }, 60_000);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async runPrune(): Promise<void> {
    const started = Date.now();
    const allListings = await this.drizzle.db.select().from(listings);
    if (allListings.length === 0) {
      this.logger.debug('Prune: nothing to check');
      return;
    }
    let checked = 0;
    let dropped = 0;
    let ordErrors = 0;
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
        await this.listingsService.deleteByCatNumber(row.catNumber);
        dropped++;
        this.logger.log(`Prune: dropped cat #${row.catNumber} — no current location on ord`);
        continue;
      }
      // Cat outpoint has changed since the listing was signed.
      if (current.txid !== row.catTxid || current.vout !== row.catVout) {
        await this.listingsService.deleteByCatNumber(row.catNumber);
        dropped++;
        this.logger.log(
          `Prune: dropped cat #${row.catNumber} — outpoint drifted ` +
            `${row.catTxid}:${row.catVout} → ${current.txid}:${current.vout}`,
        );
      }
    }
    this.logger.log(
      `Prune: checked=${checked} dropped=${dropped} ordErrors=${ordErrors} in ${Date.now() - started}ms`,
    );
  }
}
