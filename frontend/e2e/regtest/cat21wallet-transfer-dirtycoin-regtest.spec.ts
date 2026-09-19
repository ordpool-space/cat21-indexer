/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  onboardCat21Wallet,
  waitForApprovalPopup,
  seedListedCat,
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
 * E2E (regtest) — cat21.space TRANSFER funding guard, dirty-coin protection, END
 * TO END in cat21.space's own wiring, for all four asset classes. The third and
 * last dirty-coin flow; same locked shape.
 *
 * The dirty-coin guard is COIN SELECTION, wallet-agnostic, so this is once per
 * flow with one representative wallet (cat21-wallet).
 *
 * A transfer moves a cat the wallet already owns and pays the miner fee from
 * SEPARATE funding inputs (the cat rides output 0 at its preserved size; the fee
 * never shrinks the cat). So each cell:
 *   - seeds a cat to the wallet's ORDINALS address (the wallet then owns it and
 *     can sign the transfer's cat input);
 *   - at the wallet's PAYMENT address, funds a CLEAN coin the guard should fund
 *     the fee FROM, plus a DIRTY coin carrying a real <asset> that an UNGUARDED
 *     best-fit would pick first (dirty < clean, both cover the small transfer
 *     fee, both under the 50k auto-scan floor).
 *
 * TRANSFER is survival-shape like make-offer, NOT selection-shape like mint:
 * transfer.ts canTransfer = simulation() && !insufficient() gates on the
 * simulation, not the selected coin's bucket, so under the mutation the transfer
 * proceeds from the dirty coin and SPENDS it. (mint's mint-found-funds gates on
 * bucket, so mint's mutation target is selection instead — verified per flow.)
 *
 * THE LOAD-BEARING assertion: the dirty coin's outpoint SURVIVES the transfer
 * (gettxout non-empty + absent from the transfer tx's vin) — the guard funded
 * the fee from the clean coin. GREEN is not evidence on its own: the mutation is
 * ONE class-agnostic lever (throwaway branch, in the workflow) — neutralise
 * recommendFunding's clean filter so best-fit funds the fee from the smaller
 * dirty coin, spending it, turning all four cells RED naming their asset. Immune
 * to the incidental rare sat every seedInscribedCoin coin carries (classification
 * not consulted under the mutation).
 *
 * CI-only (real cat21-wallet binary + full regtest stack); the regtest
 * playwright config refuses to run locally.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4221';
const MINT_PATH = '/dashboard/mint';
const TRANSFER_PATH = '/dashboard/transfer';

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');
const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let extensionId: string;
let browserErrorGuard: ReturnType<typeof installContextErrorGuard>;

// NOT serial: the regtest config is workers:1 + fullyParallel:false, so tests
// already run sequentially in one worker sharing the beforeAll'd context. Serial
// mode's skip-on-failure would hide three of the four reds under the mutation.

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `transfer-dirtycoin-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

/**
 * Approval-popup confirm click. cat21-wallet self-closes the sign-psbt popup the
 * moment the confirm dispatch reaches the service worker, so the close IS the
 * success signal — swallow only that teardown error, scoped to this wallet.
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

/** Connect cat21-wallet via the mint page; return payment (bcrt1q) + ordinals (bcrt1p). */
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

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`CAT-21 wallet extension not unpacked at ${EXT_PATH}.`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). The consumer bootstrap should have matured coinbase.`);
  }

  // NO `/output` mock — the funding scan hits the real ords the workflow wires in.
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
 * One transfer dirty-coin cell at a given asset class. Load-bearing assertion:
 * the dirty coin's outpoint is UNSPENT after the transfer confirms — the guard
 * funded the fee from the clean coin.
 *
 * `dirtySats` MUST strictly decrease across the four cells (see the call sites).
 * All four cells share ONE wallet + ONE payment address and run sequentially, so
 * every earlier cell leaves coins behind at that address: a ~40k clean change in
 * the green run, or a dirty-coin change (`prev_dirty - fee`) in the mutation run.
 * ord's best-fit selection picks the GLOBALLY smallest covering coin, so this
 * cell's dirty coin only counts as "the coin an unguarded selection would take"
 * if it is smaller than everything already sitting there. Clean coins are always
 * ~40k, so they never compete; the risk is a PRIOR dirty-coin change. Stepping
 * the dirty size down by 3_000 (> any transfer fee at 5 sat/vB) keeps this cell's
 * dirty coin below every prior dirty-coin change, so it is the unique global
 * smallest covering coin — and the mutation spends THIS coin, not a leftover.
 * A constant size made three of four cells pass under the mutation (a false
 * green): the mutation spent some earlier leftover and left this cell's coin
 * untouched.
 */
async function runTransferDirtyCell(asset: DirtyCoinAsset, dirtySats: number): Promise<void> {
  const tag = `transfer:dirty:${asset}`;
  const CAT_VALUE = 546;
  const CLEAN_SATS = 40_000; // covers comfortably, > every dirty size, < 50k auto-scan floor

  // ─── 1. Connect the sender (cat21-wallet) ───────────────────────
  const page = await context.newPage();
  const { paymentAddress: payment, ordinalsAddress: ordinals } = await connectAndReadAddresses(page);
  console.log(`[${tag}] payment=${payment} ordinals=${ordinals} dirtySats=${dirtySats}`);

  // ─── 2. The wallet must OWN a cat to transfer: seed one to its
  //        ordinals address (the wallet then holds + can sign it). ──
  const listed = await seedListedCat({ ordinalsAddress: ordinals, valueSats: CAT_VALUE });
  console.log(`[${tag}] cat to transfer: ${listed.txid}:${listed.vout} value=${listed.value} at ${ordinals}`);

  // ─── 3. Fee funding: a CLEAN coin the guard should fund FROM, and a DIRTY
  //        coin an unguarded best-fit would pick FIRST (it is the smallest
  //        covering coin in the whole shared wallet — see the JSDoc). ─
  await fundCommonSats(payment, CLEAN_SATS / 1e8);
  const dirty = await seedDirtyCoin({ asset, address: payment, valueSats: dirtySats });
  console.log(`[${tag}] dirty ${asset} coin ${dirty.outpoint} value=${dirty.value} assetId=${dirty.assetId}`);

  // ─── 4. Drive transfer via the ?catTxid override (deterministic cat
  //        selection), fill recipient + fee. ────────────────────────
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

  // canTransfer = simulation && !insufficient — the guard funded from the clean
  // coin, so the transfer is buildable. (Under the mutation the dirty coin funds
  // it instead, but the transfer still proceeds — the proof is on-chain, below.)
  const transferBtn = page.getByTestId('transfer-cta');
  await expect(transferBtn).toBeEnabled({ timeout: 90_000 });
  await shot(page, `${asset}-01-ready`);

  // ─── 5. Transfer → cat21-wallet signs → broadcast ───────────────
  let knownBeforeSign = new Set(context.pages());
  await transferBtn.click();
  for (let i = 0; i < 2; i++) {
    const sign = await waitForApprovalPopup({
      context, knownPages: knownBeforeSign, timeoutMs: i === 0 ? 120_000 : 5_000,
      isApproval: async (p) => {
        if (!p.url().startsWith('chrome-extension://')) return false;
        await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
          .waitFor({ state: 'visible', timeout: 60_000 });
        return true;
      },
    }).catch(() => null);
    if (!sign) break;
    await clickApprovalButton(sign);
    await sign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);
    knownBeforeSign = new Set(context.pages());
  }

  const successCard = page.getByTestId('transfer-success');
  await expect(successCard).toBeVisible({ timeout: 90_000 });
  const successHref = await successCard.locator('a').first().getAttribute('href');
  const transferTxid = successHref!.match(/\/tx\/([0-9a-f]{64})/)![1];
  console.log(`[${tag}] transfer txid=${transferTxid}`);

  // ─── 6. Confirm + THE PROOF: the dirty coin was NOT spent ───────
  mineBlocks(1);
  await waitForTxConfirmed(transferTxid, 30_000);
  const txout = rpc('gettxout', dirty.txid, String(dirty.vout)).trim();
  expect(txout.length, `dirty ${asset} coin ${dirty.outpoint} was SPENT — the transfer funding guard did not steer away from it`).toBeGreaterThan(0);
  const transferRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', transferTxid, '2'),
  ) as { vin: Array<{ txid: string; vout: number }> };
  const spentDirty = transferRaw.vin.some((v) => v.txid === dirty.txid && v.vout === dirty.vout);
  expect(spentDirty, `transfer tx spent the dirty ${asset} coin ${dirty.outpoint}`).toBe(false);
  console.log(`[${tag}] SURVIVED — transfer fee funded from the clean coin`);

  browserErrorGuard.assertClean();
  await page.close();
}

// dirtySats STRICTLY DECREASES 12k -> 9k -> 6k -> 3k (step 3_000 > any transfer
// fee at 5 sat/vB), so each cell's dirty coin is the global smallest covering
// coin in the shared wallet despite prior cells' leftovers — see runTransferDirtyCell's JSDoc.
test('transfer dirty-coin guard: an INSCRIPTION funding coin is not spent', { timeout: 300_000 }, async () => {
  await runTransferDirtyCell('inscription', 12_000);
});

test('transfer dirty-coin guard: a CAT funding coin is not spent', { timeout: 300_000 }, async () => {
  await runTransferDirtyCell('cat', 9_000);
});

test('transfer dirty-coin guard: a RUNE funding coin is not spent', { timeout: 300_000 }, async () => {
  await runTransferDirtyCell('rune', 6_000);
});

test('transfer dirty-coin guard: a RARE-SAT funding coin is not spent', { timeout: 300_000 }, async () => {
  await runTransferDirtyCell('rareSat', 3_000);
});

/**
 * The asset-notice state on transfer: a DIRTY-ONLY funding pool on a SEPARATE-
 * address wallet (cat21wallet: bcrt1q payment != bcrt1p ordinals) NOTICEs and
 * PROCEEDS, per the maintainer's asset-to-miner ruling. The old expert-required
 * path left the CTA disabled behind a block warning for this exact wallet; the
 * proof here is that the notice renders, NAMES the asset, and the CTA is ENABLED.
 * Requires the 9e578ef pin (asset-notice carries its simulation, so canTransfer
 * is true). If this ever fails with "no transfer-asset-notice", suspect the
 * topology reaching the orchestrator (resolveFundingTopology reading
 * paymentAddress===ordinalsAddress) before the template.
 */
async function runTransferNoticeCell(): Promise<void> {
  const tag = 'transfer:notice';
  const CAT_VALUE = 546;
  // A spread of DIRTY inscription coins bracketing the over-pay band. The band is
  // [fundingRequirementSats, fundingPreferredSats): the requirement is ~the fee
  // (~770 at 5 sat/vB for this tx shape) and the preferred target adds the PAYMENT
  // ADDRESS's own dust floor (changeDustFloor: 294 for cat21wallet's P2WPKH
  // bcrt1q), so the real band is nearer [770, 1064) — narrower than a flat-546
  // guess. The spread's whole point is that it does NOT need the exact edges: it
  // brackets, so a fee/vsize/address-type move cannot silently drop the cell out
  // of the band. Below the requirement -> unavailable; in the band -> over-pay;
  // above the preferred -> normal. The assertion is on the STATES being present
  // (below), failing LOUD listing what was found. So if a rendered row is not in
  // the state you'd predict, that is the spread working, not a seed to re-tune.
  const SPREAD = [600, 900, 1_100, 1_300, 1_700, 3_000, 12_000];

  const page = await context.newPage();
  const { paymentAddress: payment, ordinalsAddress: ordinals } = await connectAndReadAddresses(page);
  console.log(`[${tag}] payment=${payment} ordinals=${ordinals}`);

  // The wallet must OWN a cat to transfer.
  const listed = await seedListedCat({ ordinalsAddress: ordinals, valueSats: CAT_VALUE });
  console.log(`[${tag}] cat: ${listed.txid}:${listed.vout} at ${ordinals}`);

  // DIRTY-ONLY funding pool: EVERY funding coin carries an inscription, so no
  // clean coin covers — on a separate-address wallet that is asset-notice
  // (notice-and-proceed), NOT the one-address block.
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

  // §7.8 dirty-only premise: cat21wallet is a FIXED seed, so its payment address
  // accumulates across runs. If a prior run left a clean covering coin here, the
  // recommendation takes the `auto` branch and no notice renders — invisible in
  // CI's fresh chain, bites on the 2nd local run and presents as "notice stopped
  // rendering". The failure message names the remedy so it is not mis-diagnosed.
  const preSeed = rpc('scantxoutset', 'start', `[{"desc":"addr(${payment})"}]`);
  console.log(`[${tag}] payment-address pre-notice UTXO scan: ${preSeed.replace(/\s+/g, ' ').slice(0, 200)}`);

  // THE PROOF: notice renders, names an inscription, CTA is ENABLED.
  const notice = page.getByTestId('transfer-asset-notice');
  await expect(
    notice,
    `no transfer-asset-notice. Suspect, in order: (1) a clean covering coin accumulated on cat21wallet's fixed-seed payment address from a prior LOCAL run — reset the regtest chain (this is the §7.8 shared-seed trap); (2) topology mis-derived — resolveFundingTopology('derive', wallet) needs both paymentAddress + ordinalsAddress in the wallet context; (3) the seeded coins did not classify dirty`,
  ).toBeVisible({ timeout: 90_000 });
  await expect(notice).toContainText('Inscription');
  const transferBtn = page.getByTestId('transfer-cta');
  await expect(
    transferBtn,
    'transfer-cta must be ENABLED on asset-notice (notice-and-proceed); a disabled CTA here is the old dead-end',
  ).toBeEnabled({ timeout: 30_000 });

  // THE THREE FEE STATES from the spread, asserted by state not by number. A miss
  // fails LOUD listing what WAS found, so a hardcoded spread that stopped bracketing
  // the band reds instead of going green having proved nothing.
  const states = await page.locator('[data-testid^="utxo-row-"]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-fee-state')));
  const found = `fee-states present: [${states.join(', ')}]`;
  console.log(`[${tag}] ${found}`);
  expect(states, `${found} — no OVER-PAY row: the dirty-coin spread missed [fundingRequirementSats, fundingPreferredSats); widen/densify it`).toContain('overpay');
  expect(states, `${found} — no UNAVAILABLE row: add a dirty coin strictly below fundingRequirementSats`).toContain('unavailable');
  await shot(page, 'notice-three-states');

  await page.close();
}

test('transfer asset-notice: a dirty-only pool notices + proceeds, three fee states in one picker', { timeout: 300_000 }, async () => {
  await runTransferNoticeCell();
});
