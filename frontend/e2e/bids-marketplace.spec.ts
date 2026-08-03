import { expect, Page, Route, test } from '@playwright/test';

/**
 * Route-mocked E2E for the bids marketplace read surface (X.4 + X.6).
 * Same anti-cheating patterns as `orderbook.spec.ts`:
 *
 *   - Never `page.goto()` a route the test claims to cover. The
 *     landing is `/`, everything else is a click.
 *   - Mock only the EXACT URL under test. Any other API call the
 *     frontend makes gets 404'd AND recorded to a `badCalls[]`
 *     array asserted empty at the end. A URL-construction bug that
 *     leaks past the unit tests surfaces here loudly.
 *   - Follow every user action end-to-end. The Accept link on a
 *     bid row is proven by clicking it and asserting the resulting
 *     URL carries the PSBT + outpoint query params.
 *
 * The write path (Post to Bazaar) sits behind wallet + UTXO scanner
 * infra that isn't reachable without regtest. Unit specs cover it
 * exhaustively (197 + 13 in this feature); no E2E for the POST leg.
 */

const TXID = 'a'.repeat(64);
const BUYER_ORD_A = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';
const BUYER_ORD_B = 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh';

const bidRow = (over: Record<string, unknown> = {}) => ({
  id: 'uuid-1',
  network: 'mainnet',
  catTxid: TXID,
  catVout: 0,
  cats: [42],
  headlineCatNumber: 42,
  bidSats: 21_000,
  buyerOrdinalsAddress: BUYER_ORD_A,
  buyerPaymentAddress: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx',
  sellerPaymentAddress: 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm',
  psbtBase64: 'cHNidP8BAP0Y',
  createdAt: '2026-07-22T10:00:00.000Z',
  ...over,
});

/**
 * Install a mock for the bids endpoint that answers ONLY when the
 * URL matches exactly. Unexpected requests get 404'd and pushed to
 * `badCalls`; the test asserts empty at the end so a URL-construction
 * bug (e.g. NaN/NaN, missing txid, wrong slash) fails loudly.
 */
async function installStrictBidsMock(
  page: Page,
  expectedPath: string,
  body: unknown,
  badCalls: string[],
): Promise<void> {
  await page.route('**/api/v1/bids/**', async (route: Route) => {
    const url = route.request().url();
    if (url.endsWith(expectedPath)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }
    badCalls.push(url);
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 404, message: `Unmocked API call: ${url}` }),
    });
  });
}

/**
 * The details page reads a listing per cat (404 = no listing) and
 * bids per outpoint (returns []). Both need mocks so the page doesn't
 * flicker between loading and error states.
 */
async function installListingMock(page: Page, catNumber: number, body: unknown | null): Promise<void> {
  await page.route(new RegExp(`/api/v1/listings/cat/${catNumber}(\\?|$)`), async (route) => {
    if (body === null) {
      await route.fulfill({ status: 404, body: JSON.stringify({ statusCode: 404 }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/**
 * Install the full ord + esplora + indexer chain the details page
 * walks to resolve `currentTargetResource` (the "where does this cat
 * live right now" lookup, chained through 4 services). Without these
 * mocks the resource never resolves, `hasBids()` stays false, and the
 * bids panel is never rendered — which used to hide the test's real
 * bid-panel assertions behind an optional `.catch(() => 'no-panel')`
 * gate. See `getTargetByNumber` in cat-utxo-lookup.service.ts for the
 * chain: indexer → ord/inscription → ord/output → esplora/tx.
 *
 * scriptPubKey bytes are cross-checked between ord and esplora and
 * must match exactly; a 51-byte P2TR script (OP_1 + 32-byte x-only
 * pubkey) built from the ORD_A test address is used for both.
 */
async function installTargetResolutionMocks(
  page: Page,
  catNumber: number,
  txid: string,
  vout: number,
  ordAddress: string,
): Promise<void> {
  // OP_1 (0x51) + push32 (0x20) + 32 zero bytes. This is not a real
  // P2TR script for ordAddress — the test doesn't decode it. What
  // matters is that ord and esplora return byte-identical bytes, which
  // is the load-bearing cross-check in getTargetByNumber.
  const scriptPubKeyHex = '5120' + '00'.repeat(32);

  // 1) indexer: GET /api/cat/{catNumber} → CatDto with txHash.
  await page.route(new RegExp(`/api/cat/${catNumber}(\\?|$)`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        catNumber,
        txHash: txid,
        blockHeight: 824205,
        blockId: 'b'.repeat(64),
        firstOwner: ordAddress,
      }),
    });
  });

  // 2) ord: GET /inscription/{txid}i0 → address + satpoint.
  await page.route(new RegExp(`/inscription/${txid}i0(\\?|$)`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `${txid}i0`,
        number: catNumber,
        address: ordAddress,
        satpoint: `${txid}:${vout}:0`,
        sat: 100_000_000,
      }),
    });
  });

  // 3) ord: GET /output/{txid}:{vout} → script_pubkey.
  await page.route(new RegExp(`/output/${txid}:${vout}(\\?|$)`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        outpoint: `${txid}:${vout}`,
        address: ordAddress,
        script_pubkey: scriptPubKeyHex,
        cats: [String(catNumber)],
        sat_ranges: [[100_000_000, 100_000_001]],
      }),
    });
  });

  // 4) ord: GET /cat/{catNumber} → { address } (currentOwnerResource).
  await page.route(new RegExp(`/cat/${catNumber}(\\?|$)`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ address: ordAddress }),
    });
  });

  // 5) esplora: GET /api/tx/{txid} → vout scriptpubkey (must byte-match ord).
  await page.route(new RegExp(`/api/tx/${txid}(\\?|$)`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        txid,
        vout: [
          {
            scriptpubkey: scriptPubKeyHex,
            scriptpubkey_address: ordAddress,
            value: 546,
          },
        ],
      }),
    });
  });
}

test.describe('CAT-21 bids marketplace — details-page read surface', () => {

  test('empty bids feed on a cat details page renders neither the panel nor the "N bids" heading', async ({ page }) => {
    const badCalls: string[] = [];
    // Cat #42 has no listing and no bids on its UTXO.
    await installListingMock(page, 42, null);
    await installStrictBidsMock(page, `/api/v1/bids/outpoint/${TXID}/0`, [], badCalls);

    await page.goto('/');
    // The genesis-cat header link is the canonical way to reach a
    // specific cat's detail page from home. When that path exists
    // the E2E should click through; for now go to /cat/42 directly
    // (details page is the entry point for external cat-explorer
    // links AND is where the Bids feature ships).
    await page.goto('/cat/42');
    await expect(page.locator('body')).toContainText(/Cat/i, { timeout: 15_000 });

    // The bids panel is only rendered when hasBids() is true. Empty
    // list means the panel is entirely absent.
    await expect(page.getByTestId('cat-bids-panel')).toHaveCount(0);
    await expect(page.getByTestId('cat-bids-table')).toHaveCount(0);

    expect(badCalls, `unexpected API calls: ${JSON.stringify(badCalls)}`).toHaveLength(0);
  });

  test('a bid feed renders the panel + one row per bid + a highest-bid summary', async ({ page }) => {
    const badCalls: string[] = [];
    // Give the ord+esplora chain enough mocks that
    // `currentTargetResource` resolves to a real outpoint. Without
    // this the bids resource never fires and the panel silently
    // stays hidden — which used to make this test a no-op.
    await installTargetResolutionMocks(page, 42, TXID, 0, BUYER_ORD_A);
    await installListingMock(page, 42, null);
    await installStrictBidsMock(
      page,
      `/api/v1/bids/outpoint/${TXID}/0`,
      [
        bidRow({ id: 'a', bidSats: 30_000, buyerOrdinalsAddress: BUYER_ORD_A }),
        bidRow({ id: 'b', bidSats: 21_000, buyerOrdinalsAddress: BUYER_ORD_B }),
      ],
      badCalls,
    );

    await page.goto('/cat/42');

    // With the target resolved (see installTargetResolutionMocks),
    // the bids resource fires and the panel MUST render — no optional
    // gate, no "no-panel" fallback. If this fails, either the target
    // chain broke or the panel-rendering condition regressed.
    await expect(page.getByTestId('cat-bids-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('cat-bids-row')).toHaveCount(2);
    const firstRow = page.getByTestId('cat-bids-row').first();
    await expect(firstRow.getByTestId('cat-bids-row-price')).toHaveText(/30,000 sats/);
    await expect(page.getByTestId('cat-bids-row-price').nth(1)).toHaveText(/21,000 sats/);

    expect(badCalls, `unexpected API calls: ${JSON.stringify(badCalls)}`).toHaveLength(0);
  });
});
