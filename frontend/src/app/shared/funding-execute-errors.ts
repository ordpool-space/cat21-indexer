import { WritableSignal } from '@angular/core';
import { TxnOutput, isFundingPreviewStaleError, isFundingSelectionChangedError } from 'ordpool-sdk';

/**
 * The two execute-path funding errors the SDK's orchestrator guard raises, each
 * with its own recovery, shared by mint / transfer / create-offer so the money
 * path reads the same on every surface:
 *
 *  - `FundingSelectionChangedError`: the pinned coin is gone, stopped
 *    covering, or now carries assets that were not shown when it was picked
 *    (`contents-changed`). The SDK refuses the click rather than spend a coin the person
 *    never confirmed. RELEASE the pin (the SDK re-resolves it on every attempt
 *    and would refuse each one), re-read, and keep a sticky "confirm again"
 *    message naming the dropped coin while the panel moves to the coin that
 *    would be spent now.
 *  - `FundingPreviewStaleError` (transfer / offer only; mint passes the
 *    resolved pick, which equals the pin): the execute ran before the preview
 *    caught up to a still-valid pin, so KEEP it and show a transient retry hint.
 *
 * Returns `true` when it handled the error (the caller returns), `false`
 * otherwise (a sign/broadcast failure already lives in the snapshot).
 */
export function handleFundingExecuteError(
  err: unknown,
  handlers: {
    releasePin: () => void;
    refresh: () => void;
    onReconfirm: (message: string) => void;
    onPreviewRetry?: (message: string) => void;
  },
): boolean {
  if (isFundingSelectionChangedError(err)) {
    handlers.onReconfirm(err.message);
    handlers.releasePin();
    handlers.refresh();
    return true;
  }
  if (handlers.onPreviewRetry && isFundingPreviewStaleError(err)) {
    handlers.onPreviewRetry('The funding preview is catching up for the coin you picked. Try again in a moment.');
    return true;
  }
  return false;
}

/**
 * The transfer and create-offer wiring of `handleFundingExecuteError`: both pin
 * via `setSelectedFundingUtxo` and expose the same two sticky signals, so the
 * 20-line catch body is identical on both pages and lives here once. Mint wires
 * `handleFundingExecuteError` directly (it pins via `setSelectedUtxo` and cannot
 * reach the preview-updating error, so it passes no retry handler).
 */
export function handlePinnedFundingExecuteError(
  err: unknown,
  orch: { setSelectedFundingUtxo(utxo: TxnOutput | null): void; refreshUtxos(): Promise<void> },
  reconfirm: WritableSignal<string | null>,
  previewRetry: WritableSignal<string | null>,
): boolean {
  return handleFundingExecuteError(err, {
    releasePin: () => orch.setSelectedFundingUtxo(null),
    refresh: () => void orch.refreshUtxos(),
    onReconfirm: (m) => reconfirm.set(m),
    onPreviewRetry: (m) => previewRetry.set(m),
  });
}
