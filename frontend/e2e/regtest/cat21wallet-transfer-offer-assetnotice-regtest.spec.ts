/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  onboardCat21Wallet,
  waitForApprovalPopup,
  seedListedCat,
  seedDirtyCoin,
  rpc,
} from 'ordpool-sdk/e2e';
import { installContextErrorGuard } from './lib/browser-error-guard';
import { measuredTextContrast } from './lib/measured-text-contrast';

/**
 * E2E (regtest) — cat21.space TRANSFER + MAKE-OFFER asset-notice path, END TO END
 * in cat21.space's own wiring, ZERO mock. The sibling of the mint asset-notice
 * lane, for the other two funding surfaces: when NO clean coin covers and the
 * wallet keeps a SEPARATE payment address (cat21-wallet does), the SDK NOTICEs
 * and PROCEEDS rather than blocking. Each page must render its asset-notice
 * naming the seeded asset and leave its CTA ENABLED — the state the old
 * expert-required path left as a disabled CTA behind a block warning. Requires
 * the asset-notice-carries-simulation SDK fix (transfer + create-offer
 * orchestrators), or `canTransfer`/the offer summary never resolve.
 *
 * WHY ITS OWN LANE (E2E_BEST_PRACTICES §7.8, widened): a dirty-only premise wants
 * its own stack. On a shared wallet, any cell that COMPLETES a transaction hands
 * change back to the same address, so appending a dirty-only cell to a lane whose
 * earlier cells transfer leaves exactly the clean-covering coin the premise says
 * cannot exist — and a fresh chain does not save you from the cell before yours.
 * Neither cell here completes a tx (both only VERIFY the notice), so on this
 * lane's fresh stack the wallet holds only dirty coins and both premises hold.
 *
 * CI-only (real cat21-wallet binary + full regtest stack); the regtest playwright
 * config refuses to run locally.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4221';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:9998';
const MINT_PATH = '/dashboard/mint';
const TRANSFER_PATH = '/dashboard/transfer';
const MAKE_OFFER_PATH = '/dashboard/trade/make';

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');
const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let extensionId: string;

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `transfer-offer-assetnotice-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

/**
 * Connect cat21-wallet via the mint page and read BOTH addresses (payment bcrt1q
 * for funding, ordinals bcrt1p for the cat). Idempotent across cells sharing the
 * beforeAll'd context.
 */
async function connectAndReadAddresses(page: Page): Promise<{ paymentAddress: string; ordinalsAddress: string }> {
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
  const ordEl = page.getByTestId('wallet-ordinals-address-full');
  await expect(ordEl).toHaveText(/^bcrt1p/, { timeout: 15_000 });
  const ordinalsAddress = (await ordEl.textContent())!.trim();
  await page.getByTestId('wallet-connected-btn').click().catch(() => undefined);
  return { paymentAddress, ordinalsAddress };
}

/** Poll the NestJS backend until it has indexed the cat the make-offer lookup needs. */
async function waitForBackendCat(catNumber: number, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${BACKEND_URL}/api/cat/${catNumber}`).catch(() => null);
    if (res && res.ok) return;
    if (Date.now() - start > timeoutMs) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      throw new Error(`backend never synced cat ${catNumber} after ${elapsed}s (last ${res ? res.status : 'no-response'})`);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
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
  // wired in (stock :8081 for inscriptions, cat21-ord :8080 for cats).
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
  installContextErrorGuard(context);

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
 * TRANSFER asset-notice + all three fee states in one picker. Seeds a SPREAD of
 * dirty inscription coins bracketing the over-pay band rather than one coin at a
 * computed size: the band is [fundingRequirementSats, fundingPreferredSats), the
 * preferred edge being the PAYMENT address's own changeDustFloor (294 for
 * cat21-wallet's P2WPKH bcrt1q — NOT flat 546), so ~[fee 770, 1064) at 5 sat/vB.
 * The spread only has to BRACKET, not hit: below the requirement -> unavailable,
 * in-band -> over-pay, above the preferred -> normal. Assert the STATES are
 * present (fails LOUD listing what was found — a spread that stops bracketing
 * reds rather than green-proving nothing; do NOT re-tune to a predicted state).
 */
async function runTransferNoticeCell(): Promise<void> {
  const tag = 'transfer:notice';
  const CAT_VALUE = 546;
  const SPREAD = [600, 900, 1_100, 1_300, 1_700, 3_000, 12_000];

  const page = await context.newPage();
  const { paymentAddress: payment, ordinalsAddress: ordinals } = await connectAndReadAddresses(page);
  console.log(`[${tag}] payment=${payment} ordinals=${ordinals}`);

  const listed = await seedListedCat({ ordinalsAddress: ordinals, valueSats: CAT_VALUE });
  console.log(`[${tag}] cat: ${listed.txid}:${listed.vout} at ${ordinals}`);

  // DIRTY-ONLY: every funding coin carries an inscription -> asset-notice.
  for (const sats of SPREAD) {
    const d = await seedDirtyCoin({ asset: 'inscription', address: payment, valueSats: sats });
    console.log(`[${tag}] dirty inscription ${sats}sat ${d.outpoint} assetId=${d.assetId}`);
  }

  const recipient = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32m').trim();
  expect(recipient).toMatch(/^bcrt1p/);
  const transferUrl = new URL(`${FRONTEND_URL}${TRANSFER_PATH}`);
  transferUrl.searchParams.set('catTxid', listed.txid);
  transferUrl.searchParams.set('catVout', String(listed.vout));
  await page.goto(transferUrl.toString(), { waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context, knownPages: new Set(context.pages()), timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button').click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  const recipientInput = page.getByTestId('transfer-recipient-input');
  await expect(recipientInput).toBeVisible({ timeout: 60_000 });
  await recipientInput.fill(recipient);
  const manualInput = page.getByTestId('fees-picker-manual-input');
  await manualInput.fill('5');
  await manualInput.press('Tab');

  // §7.8 premise: log the payment-address UTXO set so an accumulation (never on
  // this fresh-stack lane, but the guard is cheap) is visible, not mis-diagnosed.
  const preSeed = rpc('scantxoutset', 'start', `[{"desc":"addr(${payment})"}]`);
  console.log(`[${tag}] payment-address pre-notice UTXO scan: ${preSeed.replace(/\s+/g, ' ').slice(0, 200)}`);

  const notice = page.getByTestId('transfer-asset-notice');
  await expect(
    notice,
    `no transfer-asset-notice. Suspect: (1) a clean covering coin on the payment address (§7.8 accumulation — should be impossible on this dedicated fresh-stack lane; if seen, a cell before this one completed a tx); (2) topology mis-derived — resolveFundingTopology('derive', wallet) needs both paymentAddress + ordinalsAddress; (3) the seeded coins did not classify dirty`,
  ).toBeVisible({ timeout: 90_000 });
  await expect(notice).toContainText('Inscription');
  const transferBtn = page.getByTestId('transfer-cta');
  await expect(
    transferBtn,
    'transfer-cta must be ENABLED on asset-notice (notice-and-proceed); a disabled CTA here is the old dead-end',
  ).toBeEnabled({ timeout: 30_000 });

  // The three fee states from the spread, asserted by STATE not by number.
  const states = await page.locator('[data-testid^="utxo-row-"]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-fee-state')));
  const found = `fee-states present: [${states.join(', ')}]`;
  console.log(`[${tag}] ${found}`);
  expect(states, `${found} — no OVER-PAY row: the dirty-coin spread missed [fundingRequirementSats, fundingPreferredSats); widen/densify it`).toContain('overpay');
  expect(states, `${found} — no UNAVAILABLE row: add a dirty coin strictly below fundingRequirementSats`).toContain('unavailable');

  // Contrast of the ACTIONABLE cost-column labels, MEASURED on the rendered page
  // against the orange body (not "we used filled badges"). This panel's contrast
  // regressed twice; a filled badge whose text colour is later dropped goes
  // near-white and a source check misses it. Both labels sit on pickable
  // (undimmed) rows and are present (asserted above), so each is in the DOM.
  const overpayRatio = await measuredTextContrast(page, '.utxo-overpay');
  expect(overpayRatio, `over-pays badge contrast ${overpayRatio.toFixed(2)}:1 on the orange body (WCAG AA needs 4.5)`).toBeGreaterThanOrEqual(4.5);
  const recRatio = await measuredTextContrast(page, '.utxo-recommended');
  expect(recRatio, `recommended badge contrast ${recRatio.toFixed(2)}:1 (WCAG AA needs 4.5)`).toBeGreaterThanOrEqual(4.5);
  console.log(`[${tag}] contrast: overpay=${overpayRatio.toFixed(2)}:1 recommended=${recRatio.toFixed(2)}:1`);

  // The UNAVAILABLE row is DELIBERATELY dimmed (opacity 0.55, a disabled/de-
  // emphasised state WCAG AA exempts), so its badge is NOT held to 4.5:1 and
  // measuredTextContrast REFUSES a dimmed element. Assert the intended state
  // instead: the row is dimmed AND names the rate as the reason.
  const unavailRow = page.locator('.utxo-row-unavailable').first();
  const rowOpacity = await unavailRow.evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(rowOpacity, `unavailable row opacity ${rowOpacity} (deliberate de-emphasis, expected < 1)`).toBeLessThan(1);
  await expect(unavailRow.locator('.utxo-fee-unavailable')).toHaveText(/can.t fund at this rate/i);

  await shot(page, 'transfer-notice-three-states');

  await page.close();
}

/**
 * MAKE-OFFER asset-notice gate (the shared picker's three fee states are the
 * transfer cell's job — same component). A dirty-ONLY buyer funding pool must
 * render make-offer-asset-notice naming the asset and leave make-offer-cta ENABLED.
 */
async function runMakeOfferNoticeCell(): Promise<void> {
  const tag = 'make-offer:notice';
  const PRICE_SATS = 1_000;
  const CAT_VALUE = 546;
  const DIRTY_SATS = 6_000; // covers price + fee at 5 sat/vB; dirty-ONLY

  const page = await context.newPage();
  const { paymentAddress: buyerPayment } = await connectAndReadAddresses(page);
  console.log(`[${tag}] buyerPayment=${buyerPayment}`);

  const dirty = await seedDirtyCoin({ asset: 'inscription', address: buyerPayment, valueSats: DIRTY_SATS });
  console.log(`[${tag}] dirty inscription coin ${dirty.outpoint} value=${dirty.value} assetId=${dirty.assetId}`);

  const O = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32').trim();
  const P = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32').trim();
  const listed = await seedListedCat({ ordinalsAddress: O, valueSats: CAT_VALUE });
  await waitForBackendCat(listed.catNumber);

  await page.goto(`${FRONTEND_URL}${MAKE_OFFER_PATH}`, { waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context, knownPages: new Set(context.pages()), timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button').click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  const catInput = page.getByTestId('make-offer-cat-number-input');
  await expect(catInput).toBeVisible({ timeout: 60_000 });
  await catInput.fill(String(listed.catNumber));
  await page.getByTestId('make-offer-lookup-cta').click();
  await expect(page.getByTestId('make-offer-resolved')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('make-offer-seller-payment-input').fill(P);
  await page.getByTestId('make-offer-price-input').fill(String(PRICE_SATS));

  const preSeed = rpc('scantxoutset', 'start', `[{"desc":"addr(${buyerPayment})"}]`);
  console.log(`[${tag}] buyer-payment pre-notice UTXO scan: ${preSeed.replace(/\s+/g, ' ').slice(0, 200)}`);

  const notice = page.getByTestId('make-offer-asset-notice');
  await expect(
    notice,
    `no make-offer-asset-notice. Suspect: (1) a clean covering coin on the buyer payment address (§7.8 accumulation — impossible on this fresh-stack lane unless a prior cell completed a tx); (2) topology mis-derived; (3) the coin did not classify dirty`,
  ).toBeVisible({ timeout: 90_000 });
  await expect(notice).toContainText('Inscription');
  const buildBtn = page.getByTestId('make-offer-cta');
  await expect(
    buildBtn,
    'make-offer-cta must be ENABLED on asset-notice (notice-and-proceed); a disabled CTA here is the old dead-end',
  ).toBeEnabled({ timeout: 30_000 });
  await shot(page, 'make-offer-notice');

  await page.close();
}

test('transfer asset-notice: a dirty-only pool notices + proceeds, three fee states in one picker', { timeout: 300_000 }, async () => {
  await runTransferNoticeCell();
});

test('make-offer asset-notice: a dirty-only pool notices + proceeds (CTA enabled)', { timeout: 300_000 }, async () => {
  await runMakeOfferNoticeCell();
});
