import { expect, Page, Route, test } from '@playwright/test';

/**
 * Non-cheating E2E for the CAT-21 orderbook.
 *
 * Rules this file enforces on itself (following the 2026-07-21
 * incident where a bare `/orderbook` load broke in prod despite
 * "passing" E2E and a previous permissive mock hid it):
 *
 *   1. **Never `page.goto` a route under test.** Always land on `/`
 *      and click the nav link a user would click. If the click path
 *      is broken, this test breaks.
 *   2. **Mock only the exact URL you expect.** Every OTHER API call
 *      the frontend makes triggers `route.fulfill({status: 404})`
 *      AND is recorded to a bad-calls list the test asserts is
 *      empty at the end. If the frontend GETs
 *      `/api/v1/listings/NaN/NaN`, the test fails loudly.
 *   3. **Follow every user action end-to-end.** A "Buy" button
 *      isn't proven by `getAttribute('href')` — click it, wait for
 *      the URL change, then assert on the destination.
 */

const TXID_A = 'a'.repeat(64);
const PAY_A = 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm';
const ORD_A = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';

type Listing = {
  id: string;
  catNumber: number;
  network: 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';
  askSats: number;
  payTo: string;
  catTxid: string;
  catVout: number;
  ordinalsAddress: string;
  signedAt: number;
  signature: string;
  createdAt: string;
};

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: 'uuid-1',
  catNumber: 42,
  network: 'mainnet',
  askSats: 21_000,
  payTo: PAY_A,
  catTxid: TXID_A,
  catVout: 0,
  ordinalsAddress: ORD_A,
  signedAt: 1_784_400_000,
  signature: 'AUHd69PrJQEv+oKTfZ8l+WROBHuy9HKrbFCJu7U1iK2iiEy1vMU5EfMtjc+VSHM7aU0SDbak5IUZRVno2P5mjSafAQ==',
  createdAt: '2026-07-19T10:00:00.000Z',
  ...over,
});

/**
 * Install a strict mock: exactly the expected URL gets the given
 * body; any other `/api/v1/listings/*` call gets a 404 AND is
 * recorded to `badCalls` so the test can fail explicitly on it. Two
 * bugs this catches that the old `**\/*\/*` glob mock swallowed:
 * URL-construction bugs (NaN/NaN), and accidental double-fetches.
 */
async function installStrictListingsMock(
  page: Page,
  expectedPath: string,
  body: unknown,
  badCalls: string[],
  status = 200,
): Promise<void> {
  await page.route('**/api/v1/listings/**', async (route: Route) => {
    const url = route.request().url();
    if (url.endsWith(expectedPath)) {
      await route.fulfill({
        status,
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

test.describe('CAT-21 orderbook — user clicks through, no cheating', () => {

  test('lands on /, clicks the Orderbook nav link, sees the empty state (URL construction verified)', async ({ page }) => {
    const badCalls: string[] = [];
    // Expect EXACTLY this URL. If the frontend builds anything else
    // (e.g. /api/v1/listings/NaN/NaN — the 2026-07-21 regression),
    // it lands in badCalls and the test fails at the end.
    await installStrictListingsMock(
      page,
      '/api/v1/listings/25/1',
      { total: 0, currentPage: 1, itemsPerPage: 25, items: [] },
      badCalls,
    );

    // Step 1 — user visits the homepage (the ONLY page.goto in this test).
    await page.goto('/');

    // Step 2 — user clicks "Orderbook" in the nav.
    await page.getByRole('link', { name: 'Orderbook' }).click();

    // Step 3 — URL should be exactly /orderbook (bare, no params).
    await expect(page).toHaveURL(/\/orderbook$/);
    await expect(page.getByTestId('orderbook-heading')).toBeVisible();

    // Step 4 — empty state rendered from the mocked response.
    await expect(page.getByTestId('orderbook-empty')).toBeVisible();
    await expect(page.getByTestId('orderbook-error')).toHaveCount(0);
    await expect(page.getByTestId('orderbook-row')).toHaveCount(0);

    // Step 5 — no unexpected URLs were built. This is the anti-
    // cheating assertion: if the frontend built /NaN/NaN or any
    // other garbage, the mock recorded it here and we fail.
    expect(badCalls, `unexpected API calls: ${JSON.stringify(badCalls)}`).toHaveLength(0);
  });

  test('lands on /, clicks Orderbook, sees a row, clicks Buy → actual navigation to make-offer with the right params', async ({ page }) => {
    const badCalls: string[] = [];
    await installStrictListingsMock(
      page,
      '/api/v1/listings/25/1',
      {
        total: 1,
        currentPage: 1,
        itemsPerPage: 25,
        items: [listing({ catNumber: 42, askSats: 21_000, catTxid: TXID_A, catVout: 0, payTo: PAY_A })],
      },
      badCalls,
    );

    await page.goto('/');
    await page.getByRole('link', { name: 'Orderbook' }).click();
    await expect(page).toHaveURL(/\/orderbook$/);

    // The row renders with the mocked data.
    const row = page.getByTestId('orderbook-row').first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId('orderbook-row-cat')).toHaveText(/Cat #42/);
    await expect(row.getByTestId('orderbook-row-price')).toHaveText(/21,000 sats/);

    // User clicks Buy. Assert the ACTUAL navigation, not the href.
    await row.getByTestId('orderbook-row-buy').click();
    await expect(page).toHaveURL(/\/dashboard\/trade\/make\?/);

    // Every intent-lock param the seller signed survives the click.
    const url = new URL(page.url());
    expect(url.searchParams.get('catNumber')).toBe('42');
    expect(url.searchParams.get('askPrice')).toBe('21000');
    expect(url.searchParams.get('payTo')).toBe(PAY_A);
    expect(url.searchParams.get('catTxid')).toBe(TXID_A);
    expect(url.searchParams.get('catVout')).toBe('0');

    expect(badCalls, `unexpected API calls: ${JSON.stringify(badCalls)}`).toHaveLength(0);
  });

  test('backend 500 → error alert renders; Retry re-fires the same request', async ({ page }) => {
    const badCalls: string[] = [];
    let hits = 0;
    // Custom mock — count hits + always 500, but still strict on URL.
    await page.route('**/api/v1/listings/**', async (route: Route) => {
      const url = route.request().url();
      if (url.endsWith('/api/v1/listings/25/1')) {
        hits++;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 500, message: 'boom' }),
        });
        return;
      }
      badCalls.push(url);
      await route.fulfill({ status: 404, body: '{}' });
    });

    await page.goto('/');
    await page.getByRole('link', { name: 'Orderbook' }).click();
    await expect(page.getByTestId('orderbook-error')).toBeVisible();
    expect(hits).toBe(1);

    // Retry link fires a second identical request.
    await page.getByTestId('orderbook-error').getByRole('button', { name: /Retry/i }).click();
    await expect.poll(() => hits, { timeout: 5_000 }).toBe(2);

    expect(badCalls, `unexpected API calls: ${JSON.stringify(badCalls)}`).toHaveLength(0);
  });

  test('paginated feed renders Next control and clicking Next builds page-2 URL (not NaN)', async ({ page }) => {
    const badCalls: string[] = [];
    // First page has total=60, so Next should navigate to /orderbook/25/2
    // and the frontend should GET /api/v1/listings/25/2 (NOT /25/NaN).
    await page.route('**/api/v1/listings/**', async (route: Route) => {
      const url = route.request().url();
      if (url.endsWith('/api/v1/listings/25/1')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ total: 60, currentPage: 1, itemsPerPage: 25, items: [listing()] }),
        });
        return;
      }
      if (url.endsWith('/api/v1/listings/25/2')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ total: 60, currentPage: 2, itemsPerPage: 25, items: [listing({ id: 'uuid-2', catNumber: 7 })] }),
        });
        return;
      }
      badCalls.push(url);
      await route.fulfill({ status: 404, body: '{}' });
    });

    await page.goto('/');
    await page.getByRole('link', { name: 'Orderbook' }).click();

    // First page loaded — Prev disabled, Next enabled.
    await expect(page.getByTestId('orderbook-pagination-prev')).toBeDisabled();
    await expect(page.getByTestId('orderbook-pagination-next')).toBeEnabled();

    // Click Next; the frontend should navigate to /orderbook/25/2 and
    // fetch /api/v1/listings/25/2. If it fetches /NaN/NaN or /25/NaN,
    // that URL lands in badCalls.
    await page.getByTestId('orderbook-pagination-next').click();
    await expect(page).toHaveURL(/\/orderbook\/25\/2$/);
    await expect(page.getByTestId('orderbook-row').first().getByTestId('orderbook-row-cat')).toHaveText(/Cat #7/);

    expect(badCalls, `unexpected API calls: ${JSON.stringify(badCalls)}`).toHaveLength(0);
  });
});
