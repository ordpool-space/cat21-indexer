/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  onboardCat21Wallet,
  waitForApprovalPopup,
  seedDirtyCoin,
  fundCommonSats,
  rpc,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest) — capture the cat21.space MINT funding-state screenshots the
 * maintainer reviews as the family layout pattern (cat21-wallet + cubes mirror
 * it). Real cat21-wallet, real regtest, real asset-bearing coins. Three of the
 * four cases are producible here with a separate-address wallet:
 *
 *   case1-safe    — a clean coin covers: found-funds, CTA enabled, quiet.
 *   case2-notice  — dirty-only pool, separate-address wallet: the NOTICE naming
 *                   the asset, CTA still ENABLED, both in one viewport.
 *   case4-expert  — the funding picker open, the recommended coin labelled and
 *                   the assets NAMED.
 *
 * The fourth, case3-warning (one-address wallet, CTA disabled + picker), needs a
 * wallet where paymentAddress === ordinalsAddress, which cat21-wallet is not, so
 * it is captured separately as a forced-context browser render (the on-chain
 * proof of that case lives in ordpool's one-address regtest cells).
 *
 * This is a SCREENSHOT producer, not an assertion suite: it waits for each state
 * to render and shoots it. The behaviour is proven by the assertion specs
 * (mint-dirtycoin, mint-assetnotice).
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4221';
const MINT_URL = `${FRONTEND_URL}/dashboard/mint`;
const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');
const RESULTS_DIR = path.resolve(__dirname, '../../test-results');
const SHOT_DIR = path.resolve(RESULTS_DIR, 'mint-screenshots');

let context: BrowserContext;
let extensionId: string;

async function shot(p: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await p.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true }).catch(() => undefined);
}

/** Connect cat21-wallet (idempotent) and return the payment address. */
async function connectAndReadPayment(page: Page): Promise<string> {
  await page.goto(MINT_URL, { waitUntil: 'domcontentloaded' });
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
  const payment = (await payEl.textContent())!.trim();
  await page.getByTestId('wallet-connected-btn').click().catch(() => undefined);
  return payment;
}

/** Reload mint so the orchestrator RE-FETCHES UTXOs (it fetches on wallet-connect,
 *  not on fee change), then re-connect if the reload dropped the session. */
async function reloadMint(page: Page): Promise<void> {
  await page.goto(MINT_URL, { waitUntil: 'domcontentloaded' });
  const reappr = await waitForApprovalPopup({
    context, knownPages: new Set(context.pages()), timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reappr) {
    await reappr.getByTestId('get-addresses-approve-button').click({ timeout: 10_000 }).catch(() => undefined);
    await reappr.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }
}

async function setFee(page: Page, rate: number): Promise<void> {
  const manualInput = page.getByTestId('fees-picker-manual-input');
  await expect(manualInput).toBeVisible({ timeout: 60_000 });
  await manualInput.fill(String(rate));
  await manualInput.press('Tab');
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`CAT-21 wallet extension not unpacked at ${EXT_PATH}.`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) throw new Error(`regtest tip is ${tip} (<101).`);
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-sandbox', '--disable-dev-shm-usage'],
    viewport: { width: 1280, height: 900 },
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  extensionId = worker.url().split('/')[2];
  const primer = await context.newPage();
  await onboardCat21Wallet(primer, extensionId);
  await primer.close();
});

test.afterAll(async () => {
  await context?.close();
});

test('capture cat21.space mint funding-state screenshots', { timeout: 300_000 }, async () => {
  const page = await context.newPage();
  const payment = await connectAndReadPayment(page);
  console.log(`[screenshots] payment=${payment}`);

  // ── CASE 2: NOTICE — dirty-only pool on a separate-address wallet ──
  const dirty = await seedDirtyCoin({ asset: 'inscription', address: payment, valueSats: 12_000 });
  console.log(`[screenshots] notice: dirty inscription ${dirty.outpoint} assetId=${dirty.assetId}`);
  await reloadMint(page); // orchestrator re-fetches so the seeded coin is a candidate
  await setFee(page, 5);
  const notice = page.getByTestId('mint-asset-notice');
  await expect(notice).toBeVisible({ timeout: 120_000 });
  // Scroll the CTA into view so the notice AND the enabled button are one frame.
  await page.getByTestId('mint-btn').scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(page, 'case2-notice');
  console.log('[screenshots] case2-notice captured');

  // ── CASE 4: EXPERT — the funding picker, recommended coin labelled + assets named ──
  // The picker opens by default when the selected coin carries assets; expand it
  // only if its rows are not already visible, so the toggle never closes it.
  const anyRow = page.locator('[data-testid^="mint-utxo-row-"]').first();
  if (!(await anyRow.isVisible().catch(() => false))) {
    await page.getByText('Choose a different funding source', { exact: false }).click().catch(() => undefined);
  }
  await anyRow.scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(page, 'case4-expert-picker');
  console.log('[screenshots] case4-expert-picker captured');

  // ── CASE 1: SAFE — add a clean coin (below the 50k auto-scan floor) ──
  await fundCommonSats(payment, 40_000 / 1e8);
  await reloadMint(page);
  await setFee(page, 5);
  const found = page.getByTestId('mint-found-funds');
  await expect(found).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('mint-btn').scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(page, 'case1-safe');
  console.log('[screenshots] case1-safe captured');

  await page.close();
});
