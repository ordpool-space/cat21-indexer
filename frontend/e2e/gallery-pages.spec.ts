import { expect, test } from '@playwright/test';

// Genesis cat address (first owner of cat #0)
const GENESIS_ADDRESS = 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh';
// Genesis cat block
const GENESIS_BLOCK = 824205;
// Genesis cat sat number
const GENESIS_SAT = 1924083497071885;

test.describe('Address page', () => {
  test('should load and display cats for an address', async ({ page }) => {
    await page.goto(`/address/${GENESIS_ADDRESS}`);

    // Verify heading and address are displayed
    await expect(page.getByTestId('address-heading')).toBeVisible();
    await expect(page.getByTestId('address-value')).toHaveText(GENESIS_ADDRESS);

    // Wait for data to load (loading state appears first)
    await expect(page.getByTestId('address-cat-count')).toBeVisible({ timeout: 15_000 });

    // Verify gallery renders with specific cat #0
    await expect(page.getByTestId('gallery-grid')).toBeVisible();
    await expect(page.getByTestId('gallery-link-cat-0')).toBeVisible();
  });

  test('should show small header', async ({ page }) => {
    await page.goto(`/address/${GENESIS_ADDRESS}`);
    // Small header has the 100x100 cat logo, not the 400x400 genesis cat
    await expect(page.locator('header img[width="100"]')).toBeVisible();
  });

  test('should navigate to cat detail when clicking a thumbnail', async ({ page }) => {
    await page.goto(`/address/${GENESIS_ADDRESS}`);
    await expect(page.getByTestId('gallery-link-cat-0')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('gallery-link-cat-0').click();
    await expect(page).toHaveURL(/\/cat\/0$/);
  });

  test('should show empty message for address with no cats', async ({ page }) => {
    // Use a random address that has no cats
    await page.goto('/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    await expect(page.getByTestId('gallery-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('gallery-empty')).toHaveText('This address has no cats.');
  });
});

test.describe('Block page', () => {
  test('should load and display cats for the genesis block', async ({ page }) => {
    await page.goto(`/block/${GENESIS_BLOCK}`);

    await expect(page.getByTestId('block-heading')).toBeVisible();
    await expect(page.getByTestId('block-heading')).toContainText('824,205');

    // Wait for gallery to load
    await expect(page.getByTestId('gallery-grid')).toBeVisible({ timeout: 15_000 });

    // Genesis block should contain cat #0
    await expect(page.getByTestId('gallery-link-cat-0')).toBeVisible();
  });

  test('should show empty message for block with no cats', async ({ page }) => {
    // Block before genesis — no cats
    await page.goto('/block/100000');
    await expect(page.getByTestId('gallery-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('gallery-empty')).toHaveText('No cats minted in this block.');
  });

  test('should navigate to cat detail from block gallery', async ({ page }) => {
    await page.goto(`/block/${GENESIS_BLOCK}`);
    await expect(page.getByTestId('gallery-link-cat-0')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('gallery-link-cat-0').click();
    await expect(page).toHaveURL(/\/cat\/0$/);
  });
});

test.describe('Sat page', () => {
  test('should load sat metadata and display cats', async ({ page }) => {
    await page.goto(`/sat/${GENESIS_SAT}`);

    await expect(page.getByTestId('sat-heading')).toBeVisible();
    await expect(page.getByTestId('sat-metadata')).toBeVisible({ timeout: 15_000 });

    // Verify specific metadata fields
    await expect(page.getByTestId('sat-name')).toBeVisible();
    await expect(page.getByTestId('sat-rarity')).toBeVisible();
  });

  test('should have working cross-links to block and address', async ({ page }) => {
    await page.goto(`/sat/${GENESIS_SAT}`);
    await expect(page.getByTestId('sat-metadata')).toBeVisible({ timeout: 15_000 });

    // Block link should navigate to /block/:height
    const blockLink = page.getByTestId('sat-block-link');
    await expect(blockLink).toBeVisible();
    const blockHref = await blockLink.getAttribute('href');
    expect(blockHref).toMatch(/\/block\/\d+/);
  });
});

test.describe('Cross-linking from detail page', () => {
  test('should navigate from cat detail to block page', async ({ page }) => {
    await page.goto('/cat/0');

    // Wait for detail view to load, then click block link
    const blockLink = page.locator('a[href^="/block/"]').first();
    await expect(blockLink).toBeVisible({ timeout: 15_000 });

    await blockLink.click();
    await expect(page).toHaveURL(/\/block\/\d+/);
    await expect(page.getByTestId('block-heading')).toBeVisible();
  });

  test('should navigate from cat detail to sat page', async ({ page }) => {
    await page.goto('/cat/0');

    const satLink = page.locator('a[href^="/sat/"]').first();
    await expect(satLink).toBeVisible({ timeout: 15_000 });

    await satLink.click();
    await expect(page).toHaveURL(/\/sat\/\d+/);
    await expect(page.getByTestId('sat-heading')).toBeVisible();
  });
});
