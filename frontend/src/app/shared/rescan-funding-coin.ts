import { filter, firstValueFrom } from 'rxjs';
import { UtxoContentScanner } from 'ordpool-sdk';

/**
 * Scan one funding coin again and make the orchestrator re-read afterwards.
 *
 * A scan by itself only updates the shared scanner (the picker's badge). The
 * orchestrator's recommendation, and with it the coin `mint()` / the transfer
 * / the offer would spend, changes only on a re-read. Without one, a pinned
 * coin whose first scan failed and whose retry finds an inscription stays
 * `failed` in the recommendation and is spent as if nothing were on it. The
 * re-read lets the SDK compare the pin's shown content with the new scan and
 * drop it as `contents-changed`.
 *
 * Waits for the scan to settle (any state but `scanning`) before re-reading,
 * so the re-read sees the new answer. The scanner never caches a failure, so
 * a re-read after a failed retry asks ord again for the covering coins.
 */
export async function rescanFundingCoin(
  scanner: UtxoContentScanner,
  orch: { refreshUtxos(): Promise<void> },
  outpoint: string,
): Promise<void> {
  await firstValueFrom(scanner.scan(outpoint).pipe(filter((s) => s.kind !== 'scanning')));
  await orch.refreshUtxos();
}
