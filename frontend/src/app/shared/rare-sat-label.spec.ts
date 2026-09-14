import { rareSatLabel } from './rare-sat-label';

describe('rareSatLabel', () => {
  it('renders <rarity> · sat <sat> · block <block>, carrying the sat number as the identity', () => {
    expect(rareSatLabel({ sat: '1968712300000005', block: 210000, rarity: 'uncommon' })).toBe(
      'uncommon · sat 1968712300000005 · block 210000',
    );
  });

  it('keeps the full sat number verbatim (never a grouped or truncated form)', () => {
    // A rare sat's number can exceed Number.MAX_SAFE_INTEGER; it arrives as a
    // string and must survive as one, digit for digit.
    expect(rareSatLabel({ sat: '2099999997689999', block: 6929999, rarity: 'mythic' })).toBe(
      'mythic · sat 2099999997689999 · block 6929999',
    );
  });
});
