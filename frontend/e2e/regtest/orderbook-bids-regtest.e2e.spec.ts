/**
 * @test-kind e2e
 * Real:   built frontend (E2E_APP_PORT), bitcoind regtest, ordpool-electrs, cat21-ord (E2E_ORD_HOST_PORT), ord-stock (E2E_ORD_STOCK_HOST_PORT),
 *         cat21-indexer backend (E2E_APP_BACKEND_PORT, synced from cat21-ord), cat21-wallet (.crx)
 * Faked:
 *         /api/v1/fees/recommended -> fees-electrs-stub on E2E_FEES_STUB_PORT (ordpool-sdk/e2e/regtest; static
 *         DEFAULT_FEES written in the stub, not captured). Every other /api/* path is proxied to the real electrs.
 * Proves: the orderbook, reached by its nav link, shows the empty book and then the listing a seller
 *         published from the Sell modal, and its Buy button opens make-offer with the listing's
 *         outpoint and payment address; a cat's detail page shows no bids panel without bids and one
 *         row per real bid, highest first, once buyers posted signed offers; browser errors on our
 *         pages fail each test
 */
/* eslint-disable no-console */
import { test, expect, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  onboardCat21Wallet,
  seedListedCat,
  SeededListedCat,
  rpc,
  mineBlocks,
  waitForElectrsSync,
  installContextErrorGuard,
  approveCat21WalletConnectPopup,
  approveCat21WalletSignPopup,
  launchWalletContext,
  installLeatherOfflineRoutes,
  installCat21WalletOrdRoutes,
  closeCat21WalletPage,
  regtestServiceUrls,
  regtestWallet,
} from 'ordpool-sdk/e2e';

import { buildCat21BuyOfferPsbt, KnownOrdinalWalletType, Network } from 'ordpool-sdk/core';
import { buildCat21SessionMessage } from 'ordpool-sdk/cat21-session';
import { hex } from '@scure/base';
import { signTestBip322Message, testTaprootAddress } from 'ordpool-sdk/testing';

// A fixed buyer-ordinals key for the session token. This address only receives
// the cat (output 0) and anchors the session; it signs no PSBT input (those are
// the regtest wallet's payment coins), so a known key is safe and lets the test
// BIP-322-sign the session message the POST now requires.
const BUYER_ORDINALS_KEY = hex.decode('42'.repeat(32));

/** Session-token headers for `address`, BIP-322-signed with `BUYER_ORDINALS_KEY`. */
function sessionHeadersFor(address: string): Record<string, string> {
  const validUntilIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const message = buildCat21SessionMessage({ address, validUntilIso });
  const signature = signTestBip322Message({ privateKey: BUYER_ORDINALS_KEY, message, network: Network.Regtest });
  return {
    'X-Cat21-Session-Address': address,
    'X-Cat21-Session-Valid-Until': validUntilIso,
    'X-Cat21-Session-Signature': signature,
  };
}

/**
 * Everything on these pages is real: the seller's listing is signed by the
 * cat21-wallet extension and posted by the page; the bids are offer PSBTs the
 * SDK builds and bitcoind's wallet signs, posted to the backend, which checks
 * them against cat21-ord and electrs before it stores them.
 *
 * A request the frontend builds wrong (`/api/v1/listings/NaN/NaN`) answers 4xx
 * from the real backend, which the browser error guard turns into a failure.
 *
 * The tests run in order on one context: the empty book is read before the
 * listing is published, and the bids panel is read without bids before the
 * bids are posted.
 */

const FRONTEND_URL = regtestServiceUrls().app;
const BACKEND_URL = regtestServiceUrls().appBackend;
const MINT_PATH = '/dashboard/mint';

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');
const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

const ASK_SATS = 21_000;

let context: BrowserContext;
let browserErrorGuard: ReturnType<typeof installContextErrorGuard>;

/** The seller's wallet and the cat it lists. */
let seller: { paymentAddress: string; ordinalsAddress: string };
let listedCat: SeededListedCat;

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `orderbook-bids-${name}.png`),
    fullPage: true,
  });
}

/**
 * Connect cat21-wallet via the mint page and read both addresses from the
 * header popover. A cat21.space flow: the connect button lives on the page.
 */
async function connectAndReadAddresses(page: Page): Promise<{ paymentAddress: string; ordinalsAddress: string }> {
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const connectedBtn = page.getByTestId('wallet-connected-btn');
  const cta = page.getByTestId('mint-cta');
  await expect(connectedBtn.or(cta)).toBeVisible();

  if (!(await connectedBtn.isVisible())) {
    const knownBefore = new Set(context.pages());
    await page.getByTestId('wallet-connect-btn').first().click();
    const picker = page.getByTestId('wallet-pick-cat21wallet').first();
    await expect(picker).toBeVisible();
    await picker.click();
    await approveCat21WalletConnectPopup(context, knownBefore);
    await expect(connectedBtn).toBeVisible();
  }

  await connectedBtn.click();
  const payEl = page.getByTestId('wallet-payment-address-full');
  await expect(payEl).toHaveText(/^bcrt1q/);
  const paymentAddress = (await payEl.textContent())!.trim();
  const ordEl = page.getByTestId('wallet-ordinals-address-full');
  await expect(ordEl).toHaveText(/^bcrt1p/);
  const ordinalsAddress = (await ordEl.textContent())!.trim();
  await page.getByTestId('wallet-connected-btn').click();
  return { paymentAddress, ordinalsAddress };
}

/** Land on the home page and open the orderbook through its nav link. */
async function openOrderbookViaNav(page: Page): Promise<void> {
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-orderbook').click();
  await expect(page).toHaveURL(/\/orderbook$/);
  await expect(page.getByTestId('orderbook-heading')).toBeVisible();
}

/**
 * A buyer's offer on `cat`, built by the SDK and signed by bitcoind's wallet
 * (`finalize=false`: input 0, the seller's cat, stays unsigned), posted to the
 * backend. Returns the bid the backend stored.
 */
async function postRealBid(cat: SeededListedCat, bidSats: number): Promise<{ id: string; bidSats: number }> {
  const buyerPaymentAddress = rpc(`-rpcwallet=${regtestWallet()}`, 'getnewaddress', '', 'bech32').trim();
  // The buyer's ordinals address is a known test key (receives the cat + anchors
  // the session token); the regtest wallet still funds and signs the payment coin.
  const buyerReceiveAddress = testTaprootAddress(BUYER_ORDINALS_KEY, Network.Regtest);
  const fundTxid = rpc(`-rpcwallet=${regtestWallet()}`, 'sendtoaddress', buyerPaymentAddress, '0.001').trim();
  await waitForElectrsSync(mineBlocks(1));

  type RawTx = { vout: Array<{ value: number; n: number; scriptPubKey: { hex: string; address?: string } }> };
  const fundTx = JSON.parse(rpc('getrawtransaction', fundTxid, '1')) as RawTx;
  const buyerOut = fundTx.vout.find((v) => v.scriptPubKey.address === buyerPaymentAddress);
  if (!buyerOut) throw new Error(`funding tx ${fundTxid} pays nothing to ${buyerPaymentAddress}`);
  const catTx = JSON.parse(rpc('getrawtransaction', cat.txid, '1')) as RawTx;
  const catOut = catTx.vout[cat.vout];

  const built = buildCat21BuyOfferPsbt({
    network: Network.Regtest,
    // bitcoind's wallet signs the buyer side; the offer's input sequence is the
    // same for every wallet type, so the type names no particular wallet here.
    walletType: KnownOrdinalWalletType.cat21wallet,
    sellerInput: {
      txid: cat.txid,
      vout: cat.vout,
      value: cat.value,
      scriptPubKey: Buffer.from(catOut.scriptPubKey.hex, 'hex'),
    },
    buyerInputs: [{
      txid: fundTxid,
      vout: buyerOut.n,
      value: Math.round(buyerOut.value * 1e8),
      scriptPubKey: Buffer.from(buyerOut.scriptPubKey.hex, 'hex'),
    }],
    destinations: {
      buyerReceiveAddress,
      sellerPaymentAddress: seller.paymentAddress,
      buyerChangeAddress: buyerPaymentAddress,
    },
    priceSats: bidSats,
    feeSats: 2_000,
  });
  const signed = JSON.parse(rpc(
    `-rpcwallet=${regtestWallet()}`, '-named', 'walletprocesspsbt',
    `psbt=${Buffer.from(built.psbt).toString('base64')}`, 'sign=true', 'finalize=false',
  )) as { psbt: string };

  const res = await fetch(`${BACKEND_URL}/api/v1/bids`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeadersFor(buyerReceiveAddress) },
    body: JSON.stringify({
      network: 'regtest',
      catTxid: cat.txid,
      catVout: cat.vout,
      cats: [cat.catNumber],
      headlineCatNumber: cat.catNumber,
      bidSats,
      buyerOrdinalsAddress: buyerReceiveAddress,
      buyerPaymentAddress,
      sellerPaymentAddress: seller.paymentAddress,
      psbtBase64: signed.psbt,
    }),
  });
  const body = await res.text();
  expect(res.status, `POST /api/v1/bids answered ${res.status}: ${body}`).toBe(201);
  return JSON.parse(body) as { id: string; bidSats: number };
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

  const page = await context.newPage();
  seller = await connectAndReadAddresses(page);
  await page.close();

  // The seller's cat, at a size other than the mint postage.
  listedCat = await seedListedCat({ ordinalsAddress: seller.ordinalsAddress, valueSats: 3_000 });
  await expect.poll(
    async () => (await fetch(`${BACKEND_URL}/api/cat/${listedCat.catNumber}`)).status,
    { message: `backend never served /api/cat/${listedCat.catNumber}` },
  ).toBe(200);
  console.log(`[orderbook-bids] seller cat #${listedCat.catNumber} at ${listedCat.txid}:${listedCat.vout}`);
  browserErrorGuard.assertClean();
});

test.afterEach(() => {
  browserErrorGuard.assertClean();
});

test.afterAll(async () => {
  await context?.close();
});

test('orderbook: the nav link opens the empty book', async () => {
  const page = await context.newPage();
  await openOrderbookViaNav(page);
  await expect(page.getByTestId('orderbook-empty')).toBeVisible();
  await expect(page.getByTestId('orderbook-row')).toHaveCount(0);
  await shot(page, '01-empty-book');
  await page.close();
});

test('orderbook: a listing published from the Sell modal is a row, and Buy opens make-offer with its params', async () => {
  const N = listedCat.catNumber;
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}/cat/${N}`, { waitUntil: 'domcontentloaded' });

  const sellBtn = page.getByTestId('cat-action-sell');
  await expect(sellBtn).toBeEnabled();
  await sellBtn.click();
  const askInput = page.getByTestId('sell-modal-ask-input');
  // The modal prefills the ask through a binding that renders after the input
  // is visible; typing before it lands appends to it.
  await expect(askInput).toHaveValue(/^\d+$/);
  await askInput.fill(String(ASK_SATS));
  await expect(page.getByTestId('sell-modal-publish-to-orderbook')).toBeChecked();

  // Copy also publishes: the page asks the wallet to sign the session message,
  // then posts the listing.
  const knownBeforeSign = new Set(context.pages());
  await page.getByTestId('sell-modal-copy-permalink').click();
  await approveCat21WalletSignPopup({ context, knownPages: knownBeforeSign });
  await expect(page.getByTestId('sell-modal-orderbook-success')).toBeVisible();
  await shot(page, '02-listed');
  await page.close();

  const book = await context.newPage();
  await openOrderbookViaNav(book);
  const row = book.getByTestId('orderbook-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('orderbook-row-cat')).toHaveText(new RegExp(`Cat #${N}\\b`));
  await expect(row.getByTestId('orderbook-row-price')).toHaveText(/21,000 sats/);
  await shot(book, '03-book-with-listing');

  await row.getByTestId('orderbook-row-buy').click();
  await expect(book).toHaveURL(/\/dashboard\/trade\/make\?/);
  const url = new URL(book.url());
  expect(url.searchParams.get('catNumber')).toBe(String(N));
  expect(url.searchParams.get('askPrice')).toBe(String(ASK_SATS));
  expect(url.searchParams.get('payTo')).toBe(seller.paymentAddress);
  expect(url.searchParams.get('catTxid')).toBe(listedCat.txid);
  expect(url.searchParams.get('catVout')).toBe(String(listedCat.vout));
  await book.close();
});

test('bids: a cat without bids shows no bids panel', async () => {
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}/cat/${listedCat.catNumber}`, { waitUntil: 'domcontentloaded' });
  // Sell is enabled once the page resolved the cat's owner and outpoint, the
  // same lookup the bids panel waits for.
  await expect(page.getByTestId('cat-action-sell')).toBeEnabled();
  await expect(page.getByTestId('cat-bids-panel')).toHaveCount(0);
  await page.close();
});

test('bids: real bids render one row each, highest first, with the highest in the heading', async () => {
  // Posted lowest first, so the order on the page is the backend's, not the posting order.
  await postRealBid(listedCat, 21_000);
  await postRealBid(listedCat, 30_000);

  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}/cat/${listedCat.catNumber}`, { waitUntil: 'domcontentloaded' });
  const panel = page.getByTestId('cat-bids-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.cat-bids-heading')).toContainText('2 bids on this cat');
  await expect(panel.locator('.cat-bids-heading')).toContainText('(highest 30,000 sats)');
  const prices = page.getByTestId('cat-bids-row-price');
  await expect(prices).toHaveCount(2);
  await expect(prices.nth(0)).toHaveText(/30,000 sats/);
  await expect(prices.nth(1)).toHaveText(/21,000 sats/);
  await shot(page, '04-bids-panel');
  await page.close();
});
