/**
 * @test-kind e2e
 * Real:   built frontend (E2E_APP_PORT), bitcoind regtest, ordpool-electrs, cat21-ord (E2E_ORD_HOST_PORT), ord-stock (E2E_ORD_STOCK_HOST_PORT),
 *         cat21-indexer backend (E2E_APP_BACKEND_PORT, synced from cat21-ord), cat21-wallet (.crx)
 * Faked:
 *         /api/v1/fees/recommended -> fees-electrs-stub on E2E_FEES_STUB_PORT (ordpool-sdk/e2e/regtest; static
 *         DEFAULT_FEES written in the stub, not captured). Every other /api/* path is proxied to the real electrs.
 * Proves: the address, block and sat pages list the cats cat21-ord indexed there, say so when there
 *         are none, and link to each other and to the cat detail page; browser errors on our pages
 *         fail each test
 */
/* eslint-disable no-console */
import { test, expect, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  onboardCat21Wallet,
  seedListedCat,
  rpc,
  installContextErrorGuard,
  launchWalletContext,
  installLeatherOfflineRoutes,
  installCat21WalletOrdRoutes,
  closeCat21WalletPage,
  SeededListedCat,
  regtestServiceUrls,
} from 'ordpool-sdk/e2e';

import { RPC_WALLET_ARG } from './lib/rpc-wallet';

/**
 * The gallery pages read cat21-ord directly (`/address/<a>`,
 * `/inscriptions/block/<h>`, `/sat/<n>`), so the data is a real cat minted on
 * the lane's chain: seedListedCat mints it to a fresh address and waits until
 * cat21-ord indexed it. Every expected value (block height, sat number, sat
 * name) is read from bitcoind or cat21-ord, never written down.
 *
 * The pages are public; the wallet context exists because every browser in an
 * e2e lane launches through launchWalletContext, which keeps it off the network.
 */

const FRONTEND_URL = regtestServiceUrls().app;
const BACKEND_URL = regtestServiceUrls().appBackend;
const CAT21_ORD_URL = regtestServiceUrls().ord;

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');
const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let browserErrorGuard: ReturnType<typeof installContextErrorGuard>;

/** The cat every test reads, with where the chain put it. */
interface GalleryCat {
  cat: SeededListedCat;
  owner: string;
  blockHeight: number;
  sat: number;
}
let galleryCat: GalleryCat;

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `gallery-pages-${name}.png`),
    fullPage: true,
  });
}

/** cat21-ord's JSON answer for a path. */
async function ordJson<T>(pathname: string): Promise<T> {
  const res = await fetch(`${CAT21_ORD_URL}${pathname}`, { headers: { Accept: 'application/json' } });
  expect(res.status, `cat21-ord ${pathname}`).toBe(200);
  return (await res.json()) as T;
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`CAT-21 wallet extension not unpacked at ${EXT_PATH}.`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). The consumer bootstrap should have matured coinbase.`);
  }

  context = await launchWalletContext({ wallet: 'cat21wallet', extensionPath: EXT_PATH });
  // The wallet's vendor backends are answered locally or aborted, and its
  // cat21-ord reads go to the regtest cat21-ord.
  await installLeatherOfflineRoutes(context);
  await installCat21WalletOrdRoutes(context);
  browserErrorGuard = installContextErrorGuard(context);

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker');
  }
  const extensionId = worker.url().split('/')[2];
  const primer = await context.newPage();
  await onboardCat21Wallet(primer, extensionId);
  await closeCat21WalletPage(primer);

  const owner = rpc(RPC_WALLET_ARG, 'getnewaddress', '', 'bech32m').trim();
  const cat = await seedListedCat({ ordinalsAddress: owner });
  const blockHash = (JSON.parse(rpc('getrawtransaction', cat.txid, '1')) as { blockhash: string }).blockhash;
  const blockHeight = (JSON.parse(rpc('getblockheader', blockHash)) as { height: number }).height;
  const inscription = await ordJson<{ sat: number | null }>(`/inscription/${cat.inscriptionId}`);
  if (inscription.sat === null) throw new Error(`cat21-ord reports no sat for ${cat.inscriptionId}; it must run with --index-sats`);
  galleryCat = { cat, owner, blockHeight, sat: inscription.sat };
  console.log(`[gallery] cat #${cat.catNumber} at ${owner}, block ${blockHeight}, sat ${inscription.sat}`);

  // The detail page reads the cat from the backend, which syncs from cat21-ord.
  await expect.poll(
    async () => (await fetch(`${BACKEND_URL}/api/cat/${cat.catNumber}`)).status,
    { message: `backend never served /api/cat/${cat.catNumber}` },
  ).toBe(200);
  browserErrorGuard.assertClean();
});

test.afterEach(() => {
  browserErrorGuard.assertClean();
});

test.afterAll(async () => {
  await context?.close();
});

test.describe('Address page', () => {
  test('lists the cats at an address', async () => {
    const { owner, cat } = galleryCat;
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/address/${owner}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('address-heading')).toBeVisible();
    await expect(page.getByTestId('address-value')).toHaveText(owner);
    await expect(page.getByTestId('address-cat-count')).toHaveText('Cats (1)');
    await expect(page.getByTestId('gallery-grid')).toBeVisible();
    await expect(page.getByTestId(`gallery-link-cat-${cat.catNumber}`)).toBeVisible();
    await shot(page, 'address');
    await page.close();
  });

  test('opens the cat detail page from a thumbnail', async () => {
    const { owner, cat } = galleryCat;
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/address/${owner}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId(`gallery-link-cat-${cat.catNumber}`).click();
    await expect(page).toHaveURL(new RegExp(`/cat/${cat.catNumber}$`));
    await page.close();
  });

  test('says so when an address holds no cats', async () => {
    const empty = rpc(RPC_WALLET_ARG, 'getnewaddress', '', 'bech32m').trim();
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/address/${empty}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('gallery-empty')).toHaveText('This address has no cats.');
    await page.close();
  });
});

test.describe('Block page', () => {
  test('lists the cats minted in a block', async () => {
    const { blockHeight, cat } = galleryCat;
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/block/${blockHeight}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('block-heading')).toHaveText(`Block ${blockHeight.toLocaleString('en-US')}`);
    await expect(page.getByTestId('gallery-grid')).toBeVisible();
    await expect(page.getByTestId(`gallery-link-cat-${cat.catNumber}`)).toBeVisible();
    await shot(page, 'block');
    await page.close();
  });

  test('says so when a block has no cats', async () => {
    // Block 1 is a bootstrap coinbase block: nothing in it carries nLockTime=21.
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/block/1`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('gallery-empty')).toHaveText('No cats minted in this block.');
    await page.close();
  });

  test('opens the cat detail page from the block gallery', async () => {
    const { blockHeight, cat } = galleryCat;
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/block/${blockHeight}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId(`gallery-link-cat-${cat.catNumber}`).click();
    await expect(page).toHaveURL(new RegExp(`/cat/${cat.catNumber}$`));
    await page.close();
  });
});

test.describe('Sat page', () => {
  test('shows the sat cat21-ord reports', async () => {
    const { sat } = galleryCat;
    const ordSat = await ordJson<{ name: string; block: number }>(`/sat/${sat}`);
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/sat/${sat}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('sat-heading')).toHaveText(`Sat ${sat.toLocaleString('en-US')}`);
    await expect(page.getByTestId('sat-metadata')).toBeVisible();
    await expect(page.getByTestId('sat-name')).toHaveText(ordSat.name);
    await expect(page.getByTestId('sat-block-link')).toHaveText(ordSat.block.toLocaleString('en-US'));
    await shot(page, 'sat');
    await page.close();
  });

  test('links to the block the sat was mined in', async () => {
    const { sat } = galleryCat;
    const ordSat = await ordJson<{ block: number }>(`/sat/${sat}`);
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/sat/${sat}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('sat-block-link').click();
    await expect(page).toHaveURL(new RegExp(`/block/${ordSat.block}$`));
    await expect(page.getByTestId('block-heading')).toHaveText(`Block ${ordSat.block.toLocaleString('en-US')}`);
    await page.close();
  });
});

test.describe('Cross-links from the cat detail page', () => {
  test('opens the block the cat was minted in', async () => {
    const { cat, blockHeight } = galleryCat;
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/cat/${cat.catNumber}`, { waitUntil: 'domcontentloaded' });
    await page.locator('a[href^="/block/"]').first().click();
    await expect(page).toHaveURL(new RegExp(`/block/${blockHeight}$`));
    await expect(page.getByTestId('block-heading')).toHaveText(`Block ${blockHeight.toLocaleString('en-US')}`);
    await page.close();
  });

  test('opens the sat the cat sits on', async () => {
    const { cat, sat } = galleryCat;
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/cat/${cat.catNumber}`, { waitUntil: 'domcontentloaded' });
    await page.locator('a[href^="/sat/"]').first().click();
    await expect(page).toHaveURL(new RegExp(`/sat/${sat}$`));
    await expect(page.getByTestId('sat-heading')).toHaveText(`Sat ${sat.toLocaleString('en-US')}`);
    await page.close();
  });
});
