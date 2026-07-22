import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { bids } from '../shared/drizzle/schema/bids';
import { ElectrsClientService } from '../sync/electrs-client.service';
import { OrdClientService } from '../sync/ord-client.service';
import { BidsService } from './bids.service';

/**
 * Prune stale bids hourly. Two independent staleness vectors, both
 * of which make the bid unbroadcastable at accept-time:
 *
 *   1. **Seller-side drift.** The cat UTXO the buyer signed against
 *      (PSBT input 0) no longer holds the same cats bundle — cat
 *      already sold, transferred, or consolidated with something new.
 *      Detected via ord `/output/<outpoint>`.
 *
 *   2. **Buyer-side drift.** The buyer's funding UTXOs (PSBT inputs
 *      1..N) have been spent elsewhere — the buyer's wallet moved
 *      the funds via some other tx after posting the bid, so the
 *      PSBT's inputs are void. Detected via electrs `/tx/{txid}/
 *      outspend/{vout}` per input.
 *
 * Either one → the PSBT would be rejected by the mempool if the
 * seller tried to accept it. Keeping such bids in the DB fills the
 * orderbook with dead entries; sellers waste time clicking Accept
 * on bids that always fail. Kill on sight.
 *
 * Batching: bids on the same UTXO share one ord lookup (grouped by
 * outpoint). Per-bid electrs outspend checks are per-input (~1-3
 * calls per bid). Cost: ~O(bids) electrs calls per prune tick,
 * which is fine on our own electrs.
 *
 * Race-safety: `deleteByOutpointAndBuyer` uses the (network,
 * cat_txid, cat_vout, buyer_ordinals_address) unique key. A buyer
 * re-bidding between snapshot and delete overwrites the row via
 * `onDuplicateKeyUpdate`; the delete still fires but hits the same
 * key. The overwrite semantics mean the fresh bid data survives
 * only if the delete lost the ordering race — a rare but tolerable
 * false eviction (buyer re-bids again on the next attempt).
 *
 * Re-entrancy guard + boot-timer teardown mirror the listings
 * pruner pattern.
 */
@Injectable()
export class BidsPruner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BidsPruner.name);
  private running = false;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ordClient: OrdClientService,
    private readonly electrsClient: ElectrsClientService,
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

    // Group by outpoint so all bids on the same UTXO share one ord
    // /output lookup. Buyer-side per-input electrs checks are still
    // per-bid (different buyers have different funding UTXOs).
    const grouped = new Map<string, typeof allBids>();
    for (const row of allBids) {
      const key = `${row.catTxid}:${row.catVout}`;
      const arr = grouped.get(key) ?? [];
      arr.push(row);
      grouped.set(key, arr);
    }

    let checked = 0;
    let droppedSellerSide = 0;
    let droppedBuyerSide = 0;
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
      // Seller-side check first — cheap sanity.
      const sellerSideStale = live === null || live.length === 0;
      for (const row of group) {
        checked++;
        if (sellerSideStale || !bidCatsMatchLive(row.catsOnUtxo, live!)) {
          await this.dropRow(row, `seller-side stale: signed=[${row.catsOnUtxo.join(',')}], live=[${(live ?? []).join(',')}]`);
          droppedSellerSide++;
          continue;
        }
        // Buyer-side liveness check — per-input electrs outspend.
        // Extract the buyer input outpoints from the stored PSBT.
        // If ANY input is spent, the PSBT is unbroadcastable.
        let buyerInputsAllLive: boolean | null;
        try {
          buyerInputsAllLive = await this.checkBuyerInputsLive(row.psbtBase64);
        } catch (err) {
          this.logger.warn(
            `Prune: failed to parse PSBT for bid ${row.id}: ${err instanceof Error ? err.message : err}`,
          );
          // A PSBT that can't parse anymore is corrupt — drop it.
          await this.dropRow(row, 'PSBT parse failed on prune');
          droppedBuyerSide++;
          continue;
        }
        if (buyerInputsAllLive === false) {
          await this.dropRow(row, 'buyer-side stale: at least one funding UTXO spent');
          droppedBuyerSide++;
        }
      }
    }
    this.logger.log(
      `Prune: checked=${checked} droppedSellerSide=${droppedSellerSide} ` +
        `droppedBuyerSide=${droppedBuyerSide} ordErrors=${ordErrors} in ${Date.now() - started}ms`,
    );
  }

  /**
   * Parse the stored PSBT, extract inputs 1..N (input 0 is the seller's
   * cat UTXO — that's the seller-side check's job), and query electrs
   * for each. Returns:
   *   true  → every buyer input is still spendable
   *   false → at least one buyer input has been spent
   *
   * Fail-safe: if the electrs client returns false for a spot-check
   * because of a network flake (see `ElectrsClientService.isOutpointSpent`
   * for the fail-safe posture), we treat it as "unknown → live" and
   * keep the bid. Guaranteed not to destructively drop on electrs
   * flake. The tradeoff is that a real stale bid may hang around one
   * extra tick until electrs recovers.
   */
  private async checkBuyerInputsLive(psbtBase64: string): Promise<boolean | null> {
    const bytes = base64.decode(psbtBase64);
    const tx = btc.Transaction.fromPSBT(bytes, {
      allowUnknowInput: true,
      allowUnknowOutput: true,
    });
    if (tx.inputsLength < 2) return null;
    for (let i = 1; i < tx.inputsLength; i++) {
      const inp = tx.getInput(i);
      if (!inp.txid) continue;
      const txid = hex.encode(inp.txid);
      const vout = inp.index ?? 0;
      const spent = await this.electrsClient.isOutpointSpent(txid, vout);
      if (spent) return false;
    }
    return true;
  }

  private async dropRow(
    row: typeof bids.$inferSelect,
    reason: string,
  ): Promise<void> {
    await this.bidsService.deleteByOutpointAndBuyer(
      row.network,
      row.catTxid,
      row.catVout,
      row.buyerOrdinalsAddress,
    );
    this.logger.log(
      `Prune: dropped bid on ${row.catTxid}:${row.catVout} from buyer ${row.buyerOrdinalsAddress} — ${reason}`,
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
