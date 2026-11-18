import { FundingPreviewStaleError } from 'ordpool-sdk';

import { handleFundingExecuteError } from './funding-execute-errors';

/**
 * The shared execute-path funding-error router. Proves each error routes to its
 * OWN recovery, so the money path reads the same on mint / transfer / offer:
 *  - FundingSelectionChangedError -> reconfirm + RELEASE the pin + refresh.
 *  - FundingPreviewStaleError -> retry hint, pin KEPT (never released).
 *  - a preview error on a surface with no retry handler (mint) -> not handled.
 *  - anything else, including a plain Error with the preview's wording -> not
 *    handled (the snapshot error surfaces it). The router keys on the SDK's
 *    typed error, never on message text.
 */
function makeHandlers() {
  const calls: string[] = [];
  return {
    calls,
    releasePin: () => calls.push('releasePin'),
    refresh: () => calls.push('refresh'),
    onReconfirm: (m: string) => calls.push(`reconfirm:${m}`),
    onPreviewRetry: (m: string) => calls.push(`preview:${m}`),
  };
}

// A FundingSelectionChangedError as it crosses a realm: matched by name + code,
// not instanceof (the SDK's isFundingSelectionChangedError checks both).
const fsce = { name: 'FundingSelectionChangedError', code: 'funding-selection-changed', message: 'The selected funding UTXO abcd:0 is no longer available. Confirm a funding UTXO again.' };
const stale = new FundingPreviewStaleError({ txid: 'ab'.repeat(32), vout: 1 });

describe('handleFundingExecuteError', () => {
  it('routes FSCE to reconfirm, releases the pin, and refreshes', () => {
    const h = makeHandlers();
    expect(handleFundingExecuteError(fsce, h)).toBe(true);
    expect(h.calls).toEqual([`reconfirm:${fsce.message}`, 'releasePin', 'refresh']);
  });

  it('routes FundingPreviewStaleError to the retry hint and KEEPS the pin', () => {
    const h = makeHandlers();
    expect(handleFundingExecuteError(stale, h)).toBe(true);
    expect(h.calls).toEqual(['preview:The funding preview is catching up for the coin you picked. Try again in a moment.']);
  });

  it('recognises a FundingPreviewStaleError from another realm by name + code', () => {
    const h = makeHandlers();
    const crossRealm = { name: 'FundingPreviewStaleError', code: 'funding-preview-stale', message: stale.message };
    expect(handleFundingExecuteError(crossRealm, h)).toBe(true);
    expect(h.calls).not.toContain('releasePin');
  });

  it('does NOT handle a preview error when no retry handler is given (mint)', () => {
    const h = makeHandlers();
    const { onPreviewRetry: _omit, ...mintHandlers } = h;
    expect(handleFundingExecuteError(stale, mintHandlers)).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('does not handle a plain Error that merely carries the preview wording', () => {
    const h = makeHandlers();
    expect(handleFundingExecuteError(new Error(stale.message), h)).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('does not handle an ordinary sign/broadcast error', () => {
    const h = makeHandlers();
    expect(handleFundingExecuteError(new Error('user rejected the signature'), h)).toBe(false);
    expect(h.calls).toEqual([]);
  });
});
