/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  onboardCat21Wallet,
  waitForApprovalPopup,
  seedDirtyCoin,
  DirtyCoinAsset,
  fundCommonSats,
  waitForElectrsSync,
  mineBlocks,
  waitForTxConfirmed,
  rpc,
} from 'ordpool-sdk/e2e';
import { installContextErrorGuard } from './lib/browser-error-guard';

/**
 * E2E (regtest) — cat21.space MINT funding guard, dirty-coin protection, END TO
 * END in cat21.space's own wiring, for all four asset classes. Sibling of the
 * make-offer dirty-coin spec; same locked shape, mint flow instead of offer.
 *
 * The dirty-coin guard is COIN SELECTION, which is wallet-agnostic, so this is
 * once per flow with one representative wallet (cat21-wallet), not per-wallet —
 * the 8-wallet matrix proves connect+sign per wallet, not selection.
 *
 * Each cell seeds a coin carrying a real <asset> at the minter's payment
 * address, sized so an UNGUARDED best-fit would pick it: dirty < clean, both
 * cover the mint requirement (postage + fee, small — recomputed for THIS flow,
 * not carried from the offer flow), both under the 50k auto-scan floor so both
 * get scanned. The guard (the SDK's class-agnostic recommendFunding) must
 * auto-select the CLEAN coin.
 *
 * THE LOAD-BEARING assertion is that the mint page auto-selects a clean coin —
 * `mint-found-funds` is visible and `mint-btn` is mintable. This is where the
 * mint flow DIFFERS from make-offer: the mint UI gates the safe-mint path on the
 * selected coin's bucket (mint-found-funds shows only for a clean/unscanned
 * coin; an `assets` coin shows the asset-warning and offers only "use anyway").
 * So the guard's protection for the mint flow manifests at SELECTION.
 *
 * GREEN is not evidence on its own. The mutation is ONE class-agnostic lever
 * (throwaway branch, in the workflow): neutralise recommendFunding's clean
 * filter in the installed SDK dist so every covering coin is selectable; best-fit
 * then auto-picks the smaller DIRTY coin. Because its bucket is still `assets`,
 * the page shows the asset-warning instead of `mint-found-funds`, so the
 * `mint-found-funds`-visible assertion goes RED in all four cells, each naming
 * its asset. Immune to the incidental rare sat every seedInscribedCoin coin
 * carries, because classification is not consulted under this mutation.
 *
 * The on-chain survival check (dirty outpoint unspent after the mint) is a
 * GREEN-PATH confirmation, NOT the mutation target: the mint UI's bucket-gating
 * is a second protection layer that stops the dirty coin from ever being minted,
 * so this mutation cannot make it get spent. It corroborates that the mint spent
 * the clean coin; the selection assertion above is the mutation-proven one.
 *
 * CI-only (real cat21-wallet binary + full regtest stack); the regtest
 * playwright config refuses to run locally.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4221';
const MINT_PATH = '/dashboard/mint';

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');
const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let extensionId: string;
let browserErrorGuard: ReturnType<typeof installContextErrorGuard>;

// NOT serial: the regtest config is workers:1 + fullyParallel:false, so tests
// already run sequentially in one worker sharing the beforeAll'd context. Serial
// mode's skip-on-failure would hide three of the four reds under the dirty-coin
// mutation — each cell must show its own assertion fail.

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `mint-dirtycoin-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

/**
 * Approval-popup confirm click. cat21-wallet self-closes the sign-psbt popup the
 * moment the confirm dispatch reaches the service worker, so the close IS the
 * success signal — swallow only that teardown error, scoped to this wallet. The
 * downstream mint-success assertion is what proves the approval actually landed.
 */
async function clickApprovalButton(popup: Page): Promise<void> {
  const btn = popup.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  try {
    await btn.click({ noWaitAfter: true, timeout: 30_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Target page, context or browser has been closed/.test(msg)) throw err;
  }
}

/**
 * Connect cat21-wallet via the mint page; return the payment address (the
 * funding source the guard selects from). Idempotent across cells.
 */
async function connectAndReadPayment(page: Page): Promise<string> {
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const connectedBtn = page.getByTestId('wallet-connected-btn');
  const cta = page.getByTestId('mint-cta');
  await expect(connectedBtn.or(cta)).toBeVisible({ timeout: 30_000 });

  if (!(await connectedBtn.isVisible().catch(() => false))) {
    const knownBefore = new Set(context.pages());
    await page.getByTestId('wallet-connect-btn').first().click();
    const picker = page.getByTestId('wallet-pick-cat21wallet').first();
    await expect(picker).toBeVisible({ timeout: 20_000 });
    await picker.click({ timeout: 20_000 });
    const approval = await waitForApprovalPopup({
      context, knownPages: knownBefore, timeoutMs: 20_000,
      isApproval: async (p) => {
        if (!p.url().startsWith('chrome-extension://')) return false;
        await p.getByTestId('get-addresses-approve-button').waitFor({ state: 'visible', timeout: 20_000 });
        return true;
      },
    }).catch(() => null);
    if (approval) {
      await approval.getByTestId('get-addresses-approve-button').click();
      await approval.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
    }
    await expect(connectedBtn).toBeVisible({ timeout: 30_000 });
  }

  await connectedBtn.click();
  const payEl = page.getByTestId('wallet-payment-address-full');
  await expect(payEl).toHaveText(/^bcrt1q/, { timeout: 15_000 });
  const paymentAddress = (await payEl.textContent())!.trim();
  await page.getByTestId('wallet-connected-btn').click().catch(() => undefined);
  return paymentAddress;
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`CAT-21 wallet extension not unpacked at ${EXT_PATH}.`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). The consumer bootstrap should have matured coinbase.`);
  }

  // NO `/output` mock — the funding scan must hit the real ords the workflow
  // wired in (stock :8081 for inscriptions/runes/rare sats, cat21-ord :8080 for cats).
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    viewport: { width: 1280, height: 900 },
  });
  browserErrorGuard = installContextErrorGuard(context);

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  extensionId = worker.url().split('/')[2];

  const primer = await context.newPage();
  await onboardCat21Wallet(primer, extensionId);
  await primer.close();
});

test.afterAll(async () => {
  await context?.close();
});

/**
 * One mint dirty-coin cell at a given asset class. See the file docstring for
 * the shape. The load-bearing assertion is that the dirty coin's outpoint is
 * UNSPENT after the mint confirms — the guard funded from the clean coin.
 */
async function runMintDirtyCell(asset: DirtyCoinAsset): Promise<void> {
  const tag = `mint:dirty:${asset}`;
  const RATE = 5; // sat/vB; a small mint, so the funding requirement is tiny
  const DIRTY_SATS = 10_000; // covers a low-rate mint, < clean, < 50k auto-scan floor
  const CLEAN_SATS = 40_000; // covers comfortably, > dirty, < 50k

  // ─── 1. Connect the minter (cat21-wallet) ───────────────────────
  const page = await context.newPage();
  const payment = await connectAndReadPayment(page);
  console.log(`[${tag}] payment=${payment}`);

  // ─── 2. Funding: a CLEAN coin the guard should fund FROM, and a DIRTY
  //        coin an unguarded best-fit would pick FIRST (it is smaller). ─
  await fundCommonSats(payment, CLEAN_SATS / 1e8);
  const dirty = await seedDirtyCoin({ asset, address: payment, valueSats: DIRTY_SATS });
  console.log(`[${tag}] dirty ${asset} coin ${dirty.outpoint} value=${dirty.value} assetId=${dirty.assetId}`);

  // ─── 3. Drive the mint: set the fee, let the picker auto-select ──
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context, knownPages: new Set(context.pages()), timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button').click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  const manualInput = page.getByTestId('fees-picker-manual-input');
  await expect(manualInput).toBeVisible({ timeout: 60_000 });
  await manualInput.fill(String(RATE));
  await manualInput.press('Tab');

  // THE LOAD-BEARING assertion: the guard auto-selected a CLEAN coin, so the
  // mint page shows mint-found-funds and a mintable mint-btn. Under the
  // recommendFunding mutation the dirty coin is auto-selected instead; its bucket
  // is 'assets', so the page shows the asset-warning and this assertion goes RED
  // (mint-found-funds absent, mint-btn not rendered). That red is the proof the
  // guard's clean-coin auto-selection is load-bearing.
  await expect(
    page.getByTestId('mint-found-funds'),
    `mint funding guard failed: no clean coin auto-selected for the ${asset} case — the dirty coin was picked and the page is in the asset-warning state`,
  ).toBeVisible({ timeout: 90_000 });
  const mintBtn = page.getByTestId('mint-btn');
  await expect(mintBtn).toBeEnabled({ timeout: 30_000 });
  await shot(page, `${asset}-01-ready`);

  // ─── 4. Mint → cat21-wallet signs → broadcast ───────────────────
  const knownBeforeSign = new Set(context.pages());
  await mintBtn.click();
  const sign = await waitForApprovalPopup({
    context, knownPages: knownBeforeSign, timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await clickApprovalButton(sign);
  await sign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

  const successCard = page.getByTestId('mint-success');
  await expect(successCard).toBeVisible({ timeout: 90_000 });
  const successHref = await successCard.locator('a').first().getAttribute('href');
  const mintTxid = successHref!.match(/\/tx\/([0-9a-f]{64})/)![1];
  console.log(`[${tag}] mint txid=${mintTxid}`);

  // ─── 5. Confirm + GREEN-PATH on-chain confirmation ──────────────
  // The mint spent the clean coin, so the dirty coin's outpoint survives. This
  // is a corroborating check, NOT the mutation target: the mint UI's
  // bucket-gating (asserted above) stops a dirty coin from being minted at all,
  // so the recommendFunding mutation reds at mint-found-funds, not here.
  mineBlocks(1);
  await waitForTxConfirmed(mintTxid, 30_000);
  // gettxout returns the txout for an unspent outpoint, empty for a spent one.
  const txout = rpc('gettxout', dirty.txid, String(dirty.vout)).trim();
  expect(txout.length, `dirty ${asset} coin ${dirty.outpoint} was SPENT by the mint`).toBeGreaterThan(0);
  const mintRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', mintTxid, '2'),
  ) as { vin: Array<{ txid: string; vout: number }> };
  const spentDirty = mintRaw.vin.some((v) => v.txid === dirty.txid && v.vout === dirty.vout);
  expect(spentDirty, `mint tx spent the dirty ${asset} coin ${dirty.outpoint}`).toBe(false);
  console.log(`[${tag}] SURVIVED — mint funded from the clean coin`);

  browserErrorGuard.assertClean();
  await page.close();
}

test('mint dirty-coin guard: an INSCRIPTION funding coin is not spent', async () => {
  await runMintDirtyCell('inscription');
});

test('mint dirty-coin guard: a CAT funding coin is not spent', async () => {
  await runMintDirtyCell('cat');
});

test('mint dirty-coin guard: a RUNE funding coin is not spent', async () => {
  await runMintDirtyCell('rune');
});

test('mint dirty-coin guard: a RARE-SAT funding coin is not spent', async () => {
  await runMintDirtyCell('rareSat');
});
