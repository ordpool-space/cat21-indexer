import { handleFundingExecuteError, isFundingPreviewUpdatingError } from './funding-execute-errors';

/**
 * The shared execute-path funding-error router. Proves each error routes to its
 * OWN recovery, so the money path reads the same on mint / transfer / offer:
 *  - FundingSelectionChangedError -> reconfirm + RELEASE the pin + refresh.
 *  - preview-updating Error -> retry hint, pin KEPT (never released).
 *  - preview error on a surface with no retry handler (mint) -> not handled.
 *  - anything else -> not handled (the snapshot error surfaces it).
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
const previewErr = new Error('The funding preview is still being updated for the selected UTXO. Try again in a moment.');

describe('handleFundingExecuteError', () => {
  it('routes FSCE to reconfirm, releases the pin, and refreshes', () => {
    const h = makeHandlers();
    expect(handleFundingExecuteError(fsce, h)).toBe(true);
    expect(h.calls).toEqual([`reconfirm:${fsce.message}`, 'releasePin', 'refresh']);
  });

  it('routes the preview-updating error to the retry hint and KEEPS the pin', () => {
    const h = makeHandlers();
    expect(handleFundingExecuteError(previewErr, h)).toBe(true);
    expect(h.calls.some((c) => c.startsWith('preview:'))).toBe(true);
    expect(h.calls).not.toContain('releasePin');
    expect(h.calls).not.toContain('refresh');
  });

  it('does NOT handle a preview error when no retry handler is given (mint)', () => {
    const h = makeHandlers();
    const { onPreviewRetry: _omit, ...mintHandlers } = h;
    expect(handleFundingExecuteError(previewErr, mintHandlers)).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('does not handle an ordinary sign/broadcast error', () => {
    const h = makeHandlers();
    expect(handleFundingExecuteError(new Error('user rejected the signature'), h)).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('isFundingPreviewUpdatingError matches only the preview message', () => {
    expect(isFundingPreviewUpdatingError(previewErr)).toBe(true);
    expect(isFundingPreviewUpdatingError(new Error('something else'))).toBe(false);
    expect(isFundingPreviewUpdatingError(fsce)).toBe(false);
  });
});
