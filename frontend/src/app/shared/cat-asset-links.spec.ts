import { catAssetLinks } from './cat-asset-links';
import { inscriptionReviewLink } from './funding-asset-links';

const ID_A = `${'a'.repeat(64)}i0`;
const ID_B = `${'b'.repeat(64)}i0`;

describe('catAssetLinks', () => {
  it('names each numbered cat as "Cat #N", linked to its page on this site', () => {
    expect(catAssetLinks({ catIds: [ID_A, ID_B], cats: [{ id: ID_A, number: 42 }, { id: ID_B, number: 7 }], catSat: 123 }))
      .toEqual([
        { key: ID_A, label: 'Cat #42', href: '/cat/42' },
        { key: ID_B, label: 'Cat #7', href: '/cat/7' },
      ]);
  });

  it('keeps a numbered cat and folds the unnumbered one into the sat-link fallback', () => {
    expect(catAssetLinks({ catIds: [ID_A, ID_B], cats: [{ id: ID_A, number: 0 }, { id: ID_B, number: null }], catSat: 555 }))
      .toEqual([
        { key: ID_A, label: 'Cat #0', href: '/cat/0' },
        { key: ID_B, label: 'CAT-21 cat', href: 'https://cat21.space/sat/555' },
      ]);
  });

  it('treats a scan without `cats` as all unnumbered: one sat-linked entry with the count', () => {
    expect(catAssetLinks({ catIds: [ID_A, ID_B], catSat: 9 }))
      .toEqual([{ key: `${ID_A},${ID_B}`, label: '2 CAT-21 cats', href: 'https://cat21.space/sat/9' }]);
  });

  it('without a sat (notice / warnings), each unnumbered cat is its id, linked to its inscription', () => {
    expect(catAssetLinks({ catIds: [ID_A, ID_B], cats: [{ id: ID_A, number: 3 }, { id: ID_B, number: null }] }))
      .toEqual([
        { key: ID_A, label: 'Cat #3', href: '/cat/3' },
        { key: ID_B, label: ID_B, href: inscriptionReviewLink(ID_B) },
      ]);
    expect(catAssetLinks({ catIds: [ID_A, ID_B] }).map((l) => l.label)).toEqual([ID_A, ID_B]);
  });

  it('returns nothing for a coin without cats', () => {
    expect(catAssetLinks({ catIds: [], cats: [], catSat: null })).toEqual([]);
  });
});
