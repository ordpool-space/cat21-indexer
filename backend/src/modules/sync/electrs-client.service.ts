import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Esplora `/tx/<txid>/outspend/<vout>` response. `spent=false` when
 * the outpoint is still spendable; `spent=true` when it's been
 * consumed by a later tx.
 */
export interface OutspendStatus {
  spent: boolean;
}

/**
 * Tri-state result of an outpoint lookup:
 *
 *   'spent'   — electrs knows this txid AND the vout is spent OR the
 *               txid is unknown to electrs (never broadcast / orphaned
 *               by a deep reorg). Both cases mean the buyer's PSBT
 *               input is unbroadcastable; the caller (pruner /
 *               POST-time validation) treats these identically.
 *
 *   'unspent' — electrs knows the txid AND the vout is still spendable.
 *
 *   'unknown' — electrs returned an error that isn't 404: 5xx, network
 *               failure, malformed JSON, unexpected response shape.
 *               Callers use this as a fail-safe: don't mutate on
 *               'unknown' (a transient electrs blip shouldn't destroy
 *               a legitimate bid or refuse a legitimate POST).
 */
export type OutpointStatus = 'spent' | 'unspent' | 'unknown';

/**
 * Thin electrs (Esplora API) client. Two consumers:
 *
 *   - `BidsPruner` — walks each active bid's buyer inputs (1..N) and
 *     drops the bid if any input is 'spent'.
 *
 *   - `BidsService.create` — POST-time validation. Rejects a fresh bid
 *     whose buyer inputs reference outpoints electrs treats as 'spent'
 *     (phantom txid → 404 → 'spent', OR real txid whose vout was
 *     already consumed → outspend true → 'spent'). Prevents the
 *     phantom-input adversarial pattern: an attacker POSTs a PSBT
 *     with a made-up funding txid; without this check, the pruner
 *     would leave the bid alone (electrs 404 = 'unknown' under the
 *     OLD boolean shape) and the bid would pollute the orderbook
 *     forever.
 *
 * Upstream endpoint is Esplora's standard REST surface (Blockstream
 * spec, implemented in ordpool-electrs and mempool.space's electrs
 * fork identically). Prod → `api.ordpool.space/api`; dev/regtest →
 * local instance.
 */
@Injectable()
export class ElectrsClientService {
  private readonly logger = new Logger(ElectrsClientService.name);
  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    this.baseUrl = configService.getOrThrow<string>('ELECTRS_API_URL');
  }

  /**
   * Preferred entry point. See `OutpointStatus` for the tri-state
   * semantics. 404 collapses into `'spent'` — an outpoint referencing
   * a txid electrs never saw is a phantom and unbroadcastable.
   */
  async getOutpointStatus(txid: string, vout: number): Promise<OutpointStatus> {
    const url = `${this.baseUrl}/tx/${txid}/outspend/${vout}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `electrs outspend fetch failed for ${txid}:${vout}: ${err instanceof Error ? err.message : err}`,
      );
      return 'unknown';
    }

    // 404 = txid unknown to electrs (never broadcast / orphaned).
    // Callers treat this identically to 'spent' — the outpoint is
    // unspendable in both cases, so the pruner drops the bid and
    // POST-time validation rejects the fresh submission.
    if (res.status === 404) return 'spent';

    if (!res.ok) {
      this.logger.warn(`electrs outspend returned ${res.status} for ${txid}:${vout}`);
      return 'unknown';
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      this.logger.warn(
        `electrs outspend malformed JSON for ${txid}:${vout}: ${err instanceof Error ? err.message : err}`,
      );
      return 'unknown';
    }

    if (
      typeof body === 'object' &&
      body !== null &&
      'spent' in body &&
      typeof (body as OutspendStatus).spent === 'boolean'
    ) {
      return (body as OutspendStatus).spent ? 'spent' : 'unspent';
    }
    this.logger.warn(`electrs outspend unexpected shape for ${txid}:${vout}: ${JSON.stringify(body)}`);
    return 'unknown';
  }

  /**
   * Legacy boolean form. Kept as a thin wrapper for callers that
   * don't need to distinguish 'spent' from 'unknown'. New callers
   * should use `getOutpointStatus` directly.
   */
  async isOutpointSpent(txid: string, vout: number): Promise<boolean> {
    return (await this.getOutpointStatus(txid, vout)) === 'spent';
  }
}
