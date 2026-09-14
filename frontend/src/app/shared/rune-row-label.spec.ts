import { runeRowLabel } from './rune-row-label';

describe('runeRowLabel', () => {
  // The separator ord puts between the amount and the symbol is a NON-BREAKING
  // space (U+00A0); it is written as an escape here, never pasted, so the test
  // stays as reviewable as the byte it guards.
  it('renders ord-style balance + name for the JSON-number amount /output/ sends', () => {
    expect(runeRowLabel('ANARCHY', { amount: 12600000, divisibility: 0, symbol: '⬛' })).toBe(
      '12600000 ⬛ ANARCHY',
    );
  });

  it('strips a trailing-zero fraction the way ord does (1100 at divisibility 3 → 1.1)', () => {
    expect(runeRowLabel('BITBLOCK', { amount: 1100, divisibility: 3, symbol: '🟧' })).toBe(
      '1.1 🟧 BITBLOCK',
    );
  });

  it('accepts a string amount unchanged (the /address/ shape)', () => {
    expect(runeRowLabel('ANARCHY', { amount: '12600000', divisibility: 0, symbol: '⬛' })).toBe(
      '12600000 ⬛ ANARCHY',
    );
  });

  it('falls back to the bare name rather than throwing when the value is unreadable', () => {
    expect(runeRowLabel('MEMENTO•MORI', null)).toBe('MEMENTO•MORI');
    expect(runeRowLabel('MEMENTO•MORI', 'not-an-object')).toBe('MEMENTO•MORI');
    expect(runeRowLabel('MEMENTO•MORI', { divisibility: 0, symbol: '💀' })).toBe('MEMENTO•MORI');
    // A float amount would throw inside BigInt; the guard must catch it first.
    expect(runeRowLabel('MEMENTO•MORI', { amount: 1.5, divisibility: 0, symbol: '💀' })).toBe('MEMENTO•MORI');
  });
});
