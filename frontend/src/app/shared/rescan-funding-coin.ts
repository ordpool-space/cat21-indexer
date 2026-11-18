import { filter, firstValueFrom } from 'rxjs';
import { UtxoContentScanner } from 'ordpool-sdk';

/**
 * A row's "Scan" / "Retry scan": scan that one coin, then have the orchestrator
 * recompute the funding answer (`rescanFunding()`).
 *
 * The orchestrator's recommendation, and with it the coin the action would
 * spend, changes only on that recompute. Without it, a pinned coin whose first
 * scan failed and whose retry finds an inscription would stay `failed` there;
 * with it, the SDK compares the pin's shown content with the new scan and drops
 * it as `contents-changed`. `rescanFunding()` re-scans the covering coins only,
 * so the clicked coin is scanned here first: its badge updates even when it
 * does not cover, and the recompute reads its settled answer.
 */
export async function rescanFundingCoin(
  scanner: UtxoContentScanner,
  orch: { rescanFunding(): Promise<void> },
  outpoint: string,
): Promise<void> {
  await firstValueFrom(scanner.scan(outpoint).pipe(filter((s) => s.kind !== 'scanning')));
  await orch.rescanFunding();
}
