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
   * semantics. A txid electrs never saw is a phantom and unspendable, so
   * it collapses into `'spent'`. Some electrs builds signal that with a
   * `/outspend` 404; ours instead answers `{ spent: false }` for an
   * unknown txid, so a `{ spent: false }` result is confirmed against a
   * `/tx` existence probe before the outpoint is called spendable.
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
      if ((body as OutspendStatus).spent) return 'spent';
      // `/outspend` answers `{ spent: false }` even for a txid electrs has
      // never seen (verified against live electrs: /tx/<phantom>/outspend
      // -> 200 {spent:false}, but /tx/<phantom> -> 404). So `{ spent: false }`
      // alone can't tell a real unspent UTXO from a phantom outpoint an
      // attacker fabricated. Confirm the txid exists before calling the
      // outpoint spendable; a missing txid is unspendable, i.e. 'spent'.
      const exists = await this.txExists(txid);
      if (exists === 'missing') return 'spent';
      if (exists === 'unknown') return 'unknown';
      return 'unspent';
    }
    this.logger.warn(`electrs outspend unexpected shape for ${txid}:${vout}: ${JSON.stringify(body)}`);
    return 'unknown';
  }

  /**
   * Whether electrs has a record of `txid`: 'exists' (200), 'missing'
   * (404 -> a phantom the caller treats as unspendable), or 'unknown'
   * (5xx / network blip -> fail-safe). Needed because `/outspend` returns
   * `{ spent: false }` for a txid it never saw, so it cannot detect a
   * phantom outpoint on its own.
   */
  private async txExists(txid: string): Promise<'exists' | 'missing' | 'unknown'> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/tx/${txid}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `electrs /tx fetch failed for ${txid}: ${err instanceof Error ? err.message : err}`,
      );
      return 'unknown';
    }
    if (res.status === 404) return 'missing';
    if (!res.ok) {
      this.logger.warn(`electrs /tx returned ${res.status} for ${txid}`);
      return 'unknown';
    }
    return 'exists';
  }

  /**
   * Legacy boolean form. Kept as a thin wrapper for callers that
   * don't need to distinguish 'spent' from 'unknown'. New callers
   * should use `getOutpointStatus` directly.
   */
  async isOutpointSpent(txid: string, vout: number): Promise<boolean> {
    return (await this.getOutpointStatus(txid, vout)) === 'spent';
  }

  /**
   * Read a prevout's scriptPubKey and value from `/tx/<txid>`.
   *
   * The buy-offer signature verification needs the TRUE prevout of every
   * input (script + amount) to recompute the sighash and check the buyer's
   * signatures cryptographically — the PSBT's own `witnessUtxo` is
   * attacker-controlled and must never be trusted for that. Returns:
   *
   *   - `{ script, amountSats }` — the on-chain prevout.
   *   - `'not-found'` — txid unknown to electrs (phantom) or vout out of
   *     range. The outpoint is unspendable; the caller rejects the bid.
   *   - `'unknown'` — a 5xx / network / parse blip. The caller fails CLOSED
   *     for the signature gate (a bid that cannot be verified is not
   *     accepted), unlike the spend-status check which tolerates a blip.
   */
  async getPrevout(
    txid: string,
    vout: number,
  ): Promise<{ script: Uint8Array; amountSats: number } | 'not-found' | 'unknown'> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/tx/${txid}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`electrs /tx fetch failed for ${txid}: ${err instanceof Error ? err.message : err}`);
      return 'unknown';
    }
    if (res.status === 404) return 'not-found';
    if (!res.ok) {
      this.logger.warn(`electrs /tx returned ${res.status} for ${txid}`);
      return 'unknown';
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      this.logger.warn(`electrs /tx malformed JSON for ${txid}: ${err instanceof Error ? err.message : err}`);
      return 'unknown';
    }
    const vouts = (body as { vout?: unknown }).vout;
    if (!Array.isArray(vouts) || vout < 0 || vout >= vouts.length) return 'not-found';
    const out = vouts[vout] as { scriptpubkey?: unknown; value?: unknown };
    if (typeof out?.scriptpubkey !== 'string' || typeof out?.value !== 'number') {
      this.logger.warn(`electrs /tx vout ${vout} unexpected shape for ${txid}`);
      return 'unknown';
    }
    let script: Uint8Array;
    try {
      script = hexToBytes(out.scriptpubkey);
    } catch {
      return 'unknown';
    }
    return { script, amountSats: out.value };
  }
}

/** Decode a hex string to bytes without pulling a dependency. */
function hexToBytes(h: string): Uint8Array {
  if (h.length % 2 !== 0) throw new Error('odd-length hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('invalid hex');
    out[i] = byte;
  }
  return out;
}
