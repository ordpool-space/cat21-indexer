import { inscriptionReviewLink, runeEtchingReviewLink } from './funding-asset-links';

describe('funding-asset-links', () => {
  const txid = 'a'.repeat(64);

  it('inscriptionReviewLink deep-links the tx page to that inscription (one coin can carry several)', () => {
    expect(inscriptionReviewLink(`${txid}i0`)).toBe(`https://ordpool.space/tx/${txid}?artifact=${txid}i0`);
    // A double-digit index stays in the artifact param, never in the txid path.
    expect(inscriptionReviewLink(`${txid}i12`)).toBe(`https://ordpool.space/tx/${txid}?artifact=${txid}i12`);
  });

  it('runeEtchingReviewLink deep-links the etching tx by rune name, URL-encoding the spacer', () => {
    expect(runeEtchingReviewLink(txid, 'UNCOMMON•GOODS')).toBe(
      `https://ordpool.space/tx/${txid}?artifact=UNCOMMON%E2%80%A2GOODS`,
    );
  });
});
