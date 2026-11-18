import { inscriptionReviewLink } from './funding-asset-links';

/** One cat entry as a funding surface renders it. */
export interface CatAssetLink {
  key: string;
  label: string;
  href: string;
}

/** The cat fields of a scan's asset detail that this needs. */
export interface CatAssetContent {
  catIds: readonly string[];
  /** Cat numbers when the scan resolved them; `number` null when it could not. */
  cats?: readonly { id: string; number: number | null }[];
  /** The sat every cat on this outpoint rides (CAT-21 pins cats to offset 0). */
  catSat?: number | null;
}

/** The cat21.space sat page: lists every cat riding the sat and where it sits now. */
export function catSatLink(catSat: number): string {
  return `https://cat21.space/sat/${catSat}`;
}

/**
 * How the picker, the asset notice and the warnings name the cats on a coin.
 *
 * A cat whose number the scan resolved is `Cat #N`, linked to its own page on
 * this site (`/cat/N`), so the person sees WHICH cat they would give away, not
 * a count. Cats the scan could not number share one entry linked to the sat
 * page, which lists every cat riding that sat (the picker's scan state and the
 * notice's `UtxoAssetDetail` both carry `catSat`). Without a sat each one is its
 * inscription id, linked to the inscription. A scan answer without `cats` (no
 * number lookup) is treated as all unnumbered.
 */
export function catAssetLinks(content: CatAssetContent): CatAssetLink[] {
  const cats = content.cats ?? content.catIds.map((id) => ({ id, number: null }));
  const links: CatAssetLink[] = [];
  const unnumbered: string[] = [];
  for (const cat of cats) {
    if (cat.number === null) {
      unnumbered.push(cat.id);
    } else {
      links.push({ key: cat.id, label: `Cat #${cat.number}`, href: `/cat/${cat.number}` });
    }
  }
  if (unnumbered.length === 0) return links;
  const catSat = content.catSat ?? null;
  if (catSat !== null) {
    const n = unnumbered.length;
    links.push({ key: unnumbered.join(','), label: n === 1 ? 'CAT-21 cat' : `${n} CAT-21 cats`, href: catSatLink(catSat) });
  } else {
    for (const id of unnumbered) links.push({ key: id, label: id, href: inscriptionReviewLink(id) });
  }
  return links;
}
