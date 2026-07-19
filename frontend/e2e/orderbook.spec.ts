import { expect, Page, test } from '@playwright/test';

const TXID_A = 'a'.repeat(64);
const TXID_B = 'b'.repeat(64);
const PAY_A = 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm';
const PAY_B = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ORD_A = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';

type MockListing = {
  id: string;
  catNumber: number;
  network: 'mainnet' | 'testnet3' | 'testnet4' | 'regtest';
  askSats: number;
  payTo: string;
  catTxid: string;
  catVout: number;
  ordinalsAddress: string;
  signedAt: number;
  signature: string;
  createdAt: string;
};

const listing = (over: Partial<MockListing> = {}): MockListing => ({
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
 * Route-mock the backend so the test doesn't need MariaDB / a live
 * cat21-indexer running. `route.fulfill` intercepts every request
 * matching the pattern; anything not matched hits the real network
 * (which is why the mock lives inside a wildcard glob).
 */
async function mockListingsFeed(page: Page, items: MockListing[], total = items.length): Promise<void> {
  await page.route('**/api/v1/listings/*/*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total,
        currentPage: 1,
        itemsPerPage: 25,
        items,
      }),
    });
  });
}

test.describe('CAT-21 orderbook — browse (route-mocked backend)', () => {

  test('empty backend renders the "no active listings" state', async ({ page }) => {
    await mockListingsFeed(page, [], 0);
    await page.goto('/orderbook');

    await expect(page.getByTestId('orderbook-heading')).toBeVisible();
    await expect(page.getByTestId('orderbook-empty')).toBeVisible();
    // No table row rendered when the feed is empty.
    await expect(page.getByTestId('orderbook-row')).toHaveCount(0);
  });

  test('populated backend renders one row per listing with price + cat link + Buy button', async ({ page }) => {
    await mockListingsFeed(page, [
      listing({ id: 'a', catNumber: 42, askSats: 21_000, catTxid: TXID_A, payTo: PAY_A }),
      listing({ id: 'b', catNumber: 7, askSats: 100_000, catTxid: TXID_B, payTo: PAY_B }),
    ]);
    await page.goto('/orderbook');

    // Two rows, one per mocked listing.
    await expect(page.getByTestId('orderbook-row')).toHaveCount(2);

    // First row — cat #42 at 21,000 sats.
    const firstRow = page.getByTestId('orderbook-row').first();
    await expect(firstRow.getByTestId('orderbook-row-cat')).toHaveText(/Cat #42/);
    await expect(firstRow.getByTestId('orderbook-row-price')).toHaveText(/21,000 sats/);

    // Cat link points at the details page.
    const catLink = firstRow.getByTestId('orderbook-row-cat');
    await expect(catLink).toHaveAttribute('href', '/cat/42');
  });

  test('Buy button on a row deep-links to /dashboard/trade/make with the seller\'s intent baked in', async ({ page }) => {
    await mockListingsFeed(page, [
      listing({ catNumber: 42, askSats: 21_000, catTxid: TXID_A, catVout: 0, payTo: PAY_A }),
    ]);
    await page.goto('/orderbook');

    const buyHref = await page.getByTestId('orderbook-row-buy').getAttribute('href');
    expect(buyHref).toContain('/dashboard/trade/make');
    // The four intent-lock params the SDK's `buildBuyOfferQueryParams`
    // emits — cat number, ask price, seller's payment address,
    // outpoint. All four must survive from row → deep-link so the
    // buyer's make-offer flow stale-checks against the same UTXO the
    // seller signed.
    expect(buyHref).toContain('catNumber=42');
    expect(buyHref).toContain('askPrice=21000');
    expect(buyHref).toContain(`payTo=${PAY_A}`);
    expect(buyHref).toContain(`catTxid=${TXID_A}`);
    expect(buyHref).toContain('catVout=0');
  });

  test('backend error surfaces the retry state without crashing the page', async ({ page }) => {
    await page.route('**/api/v1/listings/*/*', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 500, message: 'boom' }),
      });
    });
    await page.goto('/orderbook');

    await expect(page.getByTestId('orderbook-heading')).toBeVisible();
    // Currently the orderbook swallows errors and shows the empty
    // state (catchError(() => of(null)) returns null which the
    // template's else-branch renders as the error alert).
    await expect(page.getByTestId('orderbook-error')).toBeVisible();
  });

  test('paginated total > page size renders the pagination controls', async ({ page }) => {
    // total=60, page size=25 → three pages.
    await mockListingsFeed(page, [listing()], 60);
    await page.goto('/orderbook');

    await expect(page.getByTestId('orderbook-pagination')).toBeVisible();
    await expect(page.getByTestId('orderbook-pagination-next')).toBeEnabled();
    // Page 1: Prev disabled.
    await expect(page.getByTestId('orderbook-pagination-prev')).toBeDisabled();
  });
});
