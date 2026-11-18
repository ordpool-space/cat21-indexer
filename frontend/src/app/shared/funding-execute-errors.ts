import { WritableSignal } from '@angular/core';
import { TxnOutput, isFundingSelectionChangedError } from 'ordpool-sdk';

/**
 * The SDK throws a PLAIN `Error` (no typed class in this build) for the
 * transient case where an execute ran before the funding preview caught up to a
 * still-VALID pin. Only transfer and create-offer reach it (they pass the
 * simulation's funding UTXO as the resolved coin, which lags the pin); mint
 * cannot. Matched by the stable message. The pin stays valid, so the page shows
 * a "try again in a moment" hint, never a re-confirm.
 *
 * A typed error here would be sturdier than a string match; reported to the SDK.
 */
export function isFundingPreviewUpdatingError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('funding preview is still being updated');
}

/**
 * The two execute-path funding errors the SDK's orchestrator guard raises, each
 * with its own recovery, shared by mint / transfer / create-offer so the money
 * path reads the same on every surface:
 *
 *  - `FundingSelectionChangedError`: the pinned coin is gone or stopped
 *    covering. The SDK refuses the click rather than spend a coin the person
 *    never confirmed. RELEASE the pin (the SDK re-resolves it on every attempt
 *    and would refuse each one), re-read, and keep a sticky "confirm again"
 *    message naming the dropped coin while the panel moves to the coin that
 *    would be spent now.
 *  - the preview-updating `Error` (transfer / offer only): the pin is still
 *    valid, so KEEP it and show a transient retry hint.
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
  if (handlers.onPreviewRetry && isFundingPreviewUpdatingError(err)) {
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
