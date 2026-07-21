// Cloudflare Pages Function: per-cat social-preview tags for /cat/:number.
//
// cat21.space is a client-rendered SPA, so every /cat/N deep link is served
// the same static index.html — one generic set of Open Graph tags. Crawlers
// read that static HTML (no JavaScript), so before this Function every shared
// cat looked identical in a preview.
//
// Scoped by _routes.json to /cat/* only, this Function fetches the cat's data
// from the backend and rewrites the <head> tags to the specific cat before the
// response leaves the edge. It works for ANY consumer that fetches the URL —
// every social platform, known or unknown, plus search crawlers — because the
// tags are in the returned HTML, not chosen by sniffing a User-Agent. Humans
// get the same shell (with correct tags as a bonus) and the SPA boots normally.
//
// Fail-safe: any miss (unsynced cat, backend hiccup, non-numeric segment)
// returns the untouched shell, so the page never breaks — the preview just
// falls back to the generic site card. Cloudflare's project-level "fail open"
// gives the same guarantee if the daily Functions budget is ever exhausted.

const BACKEND = 'https://backend2.cat21.space';
const SITE = 'https://cat21.space';

/** HTMLRewriter handler: overwrite one attribute on the matched element. */
class SetAttr {
  constructor(name, value) {
    this.name = name;
    this.value = value;
  }
  element(el) {
    el.setAttribute(this.name, this.value);
  }
}

/** HTMLRewriter handler: replace the text content of the matched element. */
class SetText {
  constructor(value) {
    this.value = value;
  }
  element(el) {
    el.setInnerContent(this.value);
  }
}

export async function onRequest(context) {
  const { request, params, env } = context;

  // The static SPA shell we would otherwise serve for this deep link.
  const shell = await env.ASSETS.fetch(new URL('/index.html', request.url));

  // Only act on a bare, non-negative integer cat number. `String(n) === seg`
  // rejects "1.0", "01", "1e3", " 1", etc. — anything not a clean number
  // serves the shell unchanged rather than guessing.
  const seg = params.number;
  const n = Number(seg);
  if (!Number.isInteger(n) || n < 0 || String(n) !== seg) {
    return shell;
  }

  let cat;
  try {
    const resp = await fetch(`${BACKEND}/api/cat/${n}`, {
      // Let the edge cache the API read so repeat renders skip the origin.
      cf: { cacheEverything: true, cacheTtl: 3600 },
    });
    if (!resp.ok) return shell; // cat not synced yet, or a backend hiccup
    cat = await resp.json();
  } catch {
    return shell;
  }

  const title = catTitle(n, cat);
  const description = catDescription(cat);
  const image = `${BACKEND}/api/cat/${n}/social.png`;
  const url = `${SITE}/cat/${n}`;

  const rewriter = new HTMLRewriter()
    .on('title', new SetText(title))
    .on('meta[name="description"]', new SetAttr('content', description))
    .on('meta[property="og:title"]', new SetAttr('content', title))
    .on('meta[name="twitter:title"]', new SetAttr('content', title))
    .on('meta[property="og:description"]', new SetAttr('content', description))
    .on('meta[name="twitter:description"]', new SetAttr('content', description))
    .on('meta[property="og:url"]', new SetAttr('content', url))
    .on('meta[property="og:image"]', new SetAttr('content', image))
    .on('meta[property="og:image:width"]', new SetAttr('content', '1200'))
    .on('meta[property="og:image:height"]', new SetAttr('content', '630'))
    .on('meta[name="twitter:image"]', new SetAttr('content', image));

  const transformed = rewriter.transform(shell);
  const out = new Response(transformed.body, transformed);
  // Rewriting changes the body length, so drop any Content-Length inherited
  // from the original shell — a stale value would truncate the response.
  out.headers.delete('content-length');
  out.headers.set('content-type', 'text/html; charset=utf-8');
  // Short browser TTL, day-long edge TTL. Traits are immutable, but a modest
  // edge window lets a template/tag change propagate within a day.
  out.headers.set('cache-control', 'public, max-age=300, s-maxage=86400');
  return out;
}

/** Title line. Genesis (cat #0) gets its own billing; every other cat is "Cat #N". */
function catTitle(n, cat) {
  if (cat.genesis && n === 0) {
    return 'The Genesis Cat #0 — CAT-21';
  }
  return `Cat #${n} — CAT-21`;
}

/** One-sentence description built from the cat's own traits. */
function catDescription(cat) {
  const traits = [cat.gender, cat.designExpression, cat.designPose]
    .filter(Boolean)
    .join(', ');
  const lead = traits
    ? `A ${traits} CAT-21 cat, hidden in a Bitcoin transaction.`
    : 'A CAT-21 cat, hidden in a Bitcoin transaction.';
  const rarity =
    cat.rarityRank && cat.rarityCategoryTotal
      ? ` Ranked ${cat.rarityRank} of ${cat.rarityCategoryTotal} in ${cat.category}.`
      : '';
  const where = cat.blockHeight ? ` Minted in block ${cat.blockHeight}.` : '';
  return `${lead}${rarity}${where}`;
}
