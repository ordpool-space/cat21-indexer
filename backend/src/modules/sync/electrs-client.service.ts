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
 * Thin electrs (Esplora API) client — currently only exposes the
 * outspend check used by `BidsPruner` to detect stale buyer funding
 * UTXOs. The pruner walks every bid's PSBT inputs 1..N and asks
 * electrs whether each outpoint is still spendable; any spent input
 * makes the bid unbroadcastable, and the pruner drops the row.
 *
 * The upstream endpoint is Esplora's standard REST surface (Blockstream
 * spec, implemented in ordpool-electrs and mempool.space's electrs
 * fork identically). Prod points at `api.ordpool.space/api` (our
 * cloudflared tunnel → electrs on happysrv `:3000`); dev/regtest
 * point at a local instance.
 */
@Injectable()
export class ElectrsClientService {
  private readonly logger = new Logger(ElectrsClientService.name);
  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    this.baseUrl = configService.getOrThrow<string>('ELECTRS_API_URL');
  }

  /**
   * Return true iff the outpoint (`txid:vout`) has been spent by
   * some later confirmed OR mempool tx.
   *
   * Fail-safe posture: on ANY unexpected electrs response — 404, 5xx,
   * network error, malformed JSON — return `false` and let the caller
   * proceed as if the outpoint is still live. The pruner interprets a
   * `true` as "drop this bid"; falsely dropping a bid because electrs
   * hiccupped would be worse than briefly keeping a stale bid until
   * the next tick.
   *
   * The alternate posture (fail-closed: on error, treat as spent) is
   * WRONG here because it makes electrs flakes into destructive
   * pruning events. We accept a slightly-stale-orderbook risk in
   * exchange for that safety.
   */
  async isOutpointSpent(txid: string, vout: number): Promise<boolean> {
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
      return false;
    }

    // 404 = the txid itself is unknown to electrs. That means the tx
    // was never confirmed AND is not in electrs's mempool cache — an
    // outpoint referencing an unknown tx is a phantom, we treat it as
    // "live" (the caller's subsequent broadcast will fail with a
    // meaningful mempool error, not our fault).
    if (res.status === 404) return false;

    if (!res.ok) {
      this.logger.warn(`electrs outspend returned ${res.status} for ${txid}:${vout}`);
      return false;
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      this.logger.warn(
        `electrs outspend malformed JSON for ${txid}:${vout}: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }

    if (
      typeof body === 'object' &&
      body !== null &&
      'spent' in body &&
      typeof (body as OutspendStatus).spent === 'boolean'
    ) {
      return (body as OutspendStatus).spent;
    }
    this.logger.warn(`electrs outspend unexpected shape for ${txid}:${vout}: ${JSON.stringify(body)}`);
    return false;
  }
}
