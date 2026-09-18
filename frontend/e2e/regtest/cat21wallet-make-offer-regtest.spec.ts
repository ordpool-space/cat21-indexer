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
 * E2E (regtest) — cat21.space make-offer, driven THROUGH THE PAGE, zero mock.
 *
 * The buy-offer PSBT is the one money-path artifact cat21.space produces that
 * no spec proved the PAGE builds. The existing offer round-trip (in
 * `cat21wallet-mint-regtest.spec.ts`) drives the ACCEPT page but builds the
 * PSBT itself via `buildCat21BuyOfferPsbt` — so it proves the accept page
 * counter-signs a valid PSBT, never that the make-offer page constructs one.
 * This spec closes that: the BUYER (cat21-wallet) fills the make-offer form
 * and the PAGE builds + buyer-signs the PSBT; a neutral bitcoin-cli SELLER
 * signs input 0 and broadcasts.
 *
 * THE LOAD-BEARING ASSERTION is that the seller is paid at P — the payment
 * address the TEST TYPED into `make-offer-seller-payment-input` — and NEVER at
 * O, the cat's on-chain owner (ordinals) address. That distinction is the
 * 2026-07-18 regression: make-offer once took `resolvedSellerAddress` from an
 * ord lookup (which returns the ordinals address O) and piped it in as the
 * payment address, so every URL-driven accept broke silently on Xverse /
 * Leather / OKX. `seedListedCat` mints the cat to an owner O that is DISTINCT
 * from the P the buyer types, so a page that regressed to paying O fails here.
 * P is the independent oracle (a literal the test controls), per
 * E2E_BEST_PRACTICES 0.0 — never a value the app computed.
 *
 * ZERO MOCK: the make-offer cat lookup chains the cat21-indexer backend
 * (/api/cat/:N -> txHash), cat21-ord (:8080, satpoint + owner), and electrs
 * (scriptPubKey cross-check). All three run for real in the workflow — a
 * hand-typed /api/cat/:N stub is the exact shape of the getCatsAtOutput
 * production bug (number[] vs inscription-id strings), so it is banned here.
 *
 * MUTATION CHECK (throwaway branch, not CI): point the make-offer builder's
 * seller-payment at O instead of P (or have the page ignore the typed field).
 * The vout[1] address assertion goes RED while the cat-moved and price
 * assertions stay green. Proof the seller-payment line is load-bearing.
 *
 * CI-only (real cat21-wallet binary + full regtest stack + synced NestJS
 * backend); the regtest playwright config refuses to run locally.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4221';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:9998';
const MINT_PATH = '/dashboard/mint';
const MAKE_OFFER_PATH = '/dashboard/trade/make';

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');
const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let extensionId: string;
let browserErrorGuard: ReturnType<typeof installContextErrorGuard>;

// NOT serial: the regtest config is workers:1 + fullyParallel:false, so tests
// already run sequentially in one worker sharing the beforeAll'd context. Serial
// mode would additionally SKIP remaining tests on the first failure, which under
// the dirty-coin mutation (a broken guard) would hide three of the four reds —
// each cell must be able to show its own assertion fail.

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `make-offer-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

/**
 * Approval-popup Sign/Confirm/Approve click. cat21-wallet self-closes the
 * popup the moment the dispatch reaches the service worker, so the close IS
 * the success signal — swallow only the teardown-race error. Mirrors the
 * helper of the same shape in `cat21wallet-mint-regtest.spec.ts`.
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
 * Money-path assertion on the buyer's sign popup: a buy-offer is sniping-proof
 * precisely because the BUYER signs only their own funding inputs and NEVER the
 * seller's cat UTXO. ord's `wallet offer create` (which the SDK mirrors)
 * pre-selects that seller UTXO as input 0 and leaves it UNSIGNED; the buyer's
 * funding inputs follow at index >= 1. cat21-wallet drives which inputs it signs
 * through `signAtIndex=<n>` params on the sign-psbt popup URL.
 *
 * Self-guarding against a vacuous check: assert the URL IS a sign-psbt route
 * carrying at least one `signAtIndex` (so a URL that never encoded indices reds
 * here, not silently), THEN assert none of those indices is 0. The `=0`
 * substring only matches index 0 exactly — integer indices are `=`-delimited, so
 * `signAtIndex=10` does not contain `signAtIndex=0`. If the builder ever asked
 * the buyer to sign the seller's input, the second assertion goes red.
 */
async function assertBuyerNeverSignsSellerInput0(signPopup: Page): Promise<void> {
  const url = signPopup.url();
  expect(url, 'buyer sign popup must be the sign-psbt route').toContain('sign-psbt');
  expect(url, 'buyer sign popup must carry at least one signAtIndex (else the check is vacuous)')
    .toMatch(/signAtIndex=\d+/);
  expect(url, 'buyer must NOT be asked to sign the seller cat input 0 (sniping-proof invariant)')
    .not.toContain('signAtIndex=0');
}

/**
 * Connect cat21-wallet via the mint page and read BOTH addresses from the
 * header popover: the payment address (buyer funding, bcrt1q) and the
 * ordinals address (where the bought cat lands, bcrt1p). Both are the real
 * wallet-returned values, read independently of anything the make-offer page
 * computes.
 */
async function connectAndReadAddresses(
  page: Page,
): Promise<{ paymentAddress: string; ordinalsAddress: string }> {
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const connectedBtn = page.getByTestId('wallet-connected-btn');
  const cta = page.getByTestId('mint-cta');
  // Idempotent: a later cell (new page, same context) may already be connected
  // — wait for EITHER the connected header or the connect CTA, then only run
  // the connect flow when not yet connected.
  await expect(connectedBtn.or(cta)).toBeVisible({ timeout: 30_000 });

  if (!(await connectedBtn.isVisible().catch(() => false))) {
    const knownPagesBeforeConnect = new Set(context.pages());
    await page.getByTestId('wallet-connect-btn').first().click();
    const picker = page.getByTestId('wallet-pick-cat21wallet').first();
    await expect(picker).toBeVisible({ timeout: 20_000 });
    await picker.click({ timeout: 20_000 });

    // The approval popup is OPTIONAL: on the first connect it fires, but once
    // the origin is approved (a prior cell in this context) getAddresses
    // returns without prompting. Don't hard-require it.
    const approvalConnect = await waitForApprovalPopup({
      context,
      knownPages: knownPagesBeforeConnect,
      timeoutMs: 20_000,
      isApproval: async (p) => {
        if (!p.url().startsWith('chrome-extension://')) return false;
        await p.getByTestId('get-addresses-approve-button')
          .waitFor({ state: 'visible', timeout: 20_000 });
        return true;
      },
    }).catch(() => null);
    if (approvalConnect) {
      await approvalConnect.getByTestId('get-addresses-approve-button').click();
      await approvalConnect.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
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
  // Close the popover so it doesn't overlay later interactions.
  await page.getByTestId('wallet-connected-btn').click().catch(() => undefined);
  return { paymentAddress, ordinalsAddress };
}

/**
 * Poll the NestJS backend until it has synced the freshly-seeded cat. The
 * backend polls cat21-ord every 60s, so a fresh seed can take up to a sync
 * interval to appear. Fail with the cat number and elapsed time, never a bare
 * timeout, so a slow-runner miss reads in the log instead of the trace.
 */
async function waitForBackendCat(catNumber: number, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${BACKEND_URL}/api/cat/${catNumber}`).catch(() => null);
    if (res && res.ok) return;
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `backend never synced cat ${catNumber}: /api/cat/${catNumber} not 200 after ${elapsed}s ` +
        `(last status ${res ? res.status : 'no-response'}). Backend sync interval is 60s; a slow ` +
        `runner should still catch it — raise the timeout if this is a false miss.`,
      );
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

  // NO `/output` mock — the whole point is that the make-offer cat lookup +
  // the buyer-funding asset scan hit the REAL ords the workflow wires in.
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
 * One make-offer cell at a given cat size: the full page flow end to end +
 * an on-chain settle by a neutral bitcoin-cli seller. The load-bearing
 * assertion is vout[1].scriptPubKey.address === P (the typed payment address),
 * with the amount checked separately so a right-amount/wrong-destination
 * regression is caught (see the O!=P mutation).
 */
async function runMakeOfferCell(valueSats: number, priceSats: number): Promise<void> {
  const tag = `make-offer:${valueSats}`;

  // ─── 1. Connect the BUYER (cat21-wallet), read its real addresses ─
  const page = await context.newPage();
  const { paymentAddress: buyerPayment, ordinalsAddress: buyerOrdinals } =
    await connectAndReadAddresses(page);
  console.log(`[${tag}] buyer payment=${buyerPayment} ordinals=${buyerOrdinals}`);

  // ─── 2. Fund the buyer with a clean coin under the auto-scan floor ─
  // 0.00045 BTC = 45 000 sat: covers price + fee, below AUTO_SCAN_MAX_VALUE_SAT
  // (50k) so the funding picker auto-scans + auto-picks it clean.
  await fundCommonSats(buyerPayment, 0.00045);

  // ─── 3. Seed a REAL listed cat owned by O, distinct from P ──────
  // O = the cat's ordinals owner (a fresh bitcoin-cli address the SELLER
  // controls, so bitcoin-cli can sign input 0). P = the seller's PAYMENT
  // address, a DIFFERENT bitcoin-cli address — the literal the buyer types.
  const O = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32').trim();
  const P = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32').trim();
  expect(P).not.toBe(O);
  const listed = await seedListedCat({ ordinalsAddress: O, valueSats });
  expect(listed.sellerOrdinalsAddress).toBe(O);
  expect(listed.value).toBe(valueSats);
  console.log(`[${tag}] listed cat #${listed.catNumber} at ${listed.txid}:${listed.vout} value=${listed.value} owner O=${O} payTo P=${P}`);

  // ─── 4. Wait for the NestJS backend to sync the new cat ─────────
  await waitForBackendCat(listed.catNumber);

  // ─── 5. Drive the make-offer PAGE: lookup N, type P, type price ─
  await page.goto(`${FRONTEND_URL}${MAKE_OFFER_PATH}`, { waitUntil: 'domcontentloaded' });
  // Re-approve get-addresses if the wallet re-prompts on this page load.
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: new Set(context.pages()),
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  const catInput = page.getByTestId('make-offer-cat-number-input');
  await expect(catInput).toBeVisible({ timeout: 60_000 });
  await catInput.fill(String(listed.catNumber));
  await page.getByTestId('make-offer-lookup-cta').click();
  // Lookup resolves the target via backend -> ord -> electrs (all real).
  await expect(page.getByTestId('make-offer-resolved')).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('make-offer-seller-payment-input').fill(P);
  await page.getByTestId('make-offer-price-input').fill(String(priceSats));
  await shot(page, `${valueSats}-01-form-filled`);

  // The page distinguishes P (typed payment) from O (owner) in the UI too:
  // because P !== O, the override warning MUST surface. This is not the
  // proof (the on-chain assertion is), but it pins that the page treats the
  // owner as owner and the typed field as the payment target.
  await expect(page.getByTestId('make-offer-address-override-warning')).toBeVisible({ timeout: 30_000 });

  // Summary + CTA enable once the buyer-funding simulation resolves.
  await expect(page.getByTestId('make-offer-summary-section')).toBeVisible({ timeout: 60_000 });
  const buildBtn = page.getByTestId('make-offer-cta');
  await expect(buildBtn).toBeEnabled({ timeout: 60_000 });

  // ─── 6. Build the offer → cat21-wallet buyer-signs in a popup ───
  const knownBeforeSign = new Set(context.pages());
  await buildBtn.click();
  const signPopup = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(signPopup, `${valueSats}-02-sign-popup`);
  await assertBuyerNeverSignsSellerInput0(signPopup);
  await clickApprovalButton(signPopup);
  await signPopup.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

  // ─── 7. Read the PAGE-BUILT, buyer-signed PSBT ──────────────────
  await expect(page.getByTestId('make-offer-success')).toBeVisible({ timeout: 90_000 });
  // The raw base64 lives in a collapsed <details> ("Prefer the raw offer
  // text?") — the primary output is the always-visible accept-link. Expand it
  // (the real user action) before reading the textarea.
  await page.getByText('Prefer the raw offer text?', { exact: false }).click();
  const artifact = page.getByTestId('make-offer-artifact-textarea');
  await expect(artifact).toBeVisible({ timeout: 30_000 });
  const pageBuiltPsbt = (await artifact.inputValue()).trim();
  expect(pageBuiltPsbt.length).toBeGreaterThan(0);
  await shot(page, `${valueSats}-03-offer-built`);
  console.log(`[${tag}] page-built PSBT length=${pageBuiltPsbt.length}`);

  // ─── 8. Seller (bitcoin-cli, owns O) signs input 0 + broadcasts ─
  // finalize=true completes the PSBT: the buyer's funding inputs are already
  // signed by the page/wallet, and bitcoin-cli holds O's key for input 0.
  const processed = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', '-named', 'walletprocesspsbt',
      `psbt=${pageBuiltPsbt}`, 'sign=true', 'finalize=true'),
  ) as { psbt: string; hex?: string; complete: boolean };
  expect(processed.complete).toBe(true);
  const settleHex = processed.hex
    ?? (JSON.parse(rpc('finalizepsbt', processed.psbt)) as { hex: string }).hex;
  const settleTxid = rpc('sendrawtransaction', settleHex).trim();
  console.log(`[${tag}] settlement txid=${settleTxid}`);

  // ─── 9. Confirm + on-chain verification ─────────────────────────
  mineBlocks(1);
  await waitForTxConfirmed(settleTxid, 30_000);
  const settleRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', settleTxid, '2'),
  ) as { vout: Array<{ value: number; scriptPubKey: { address?: string } }> };

  // Output 0 = the cat, size PRESERVED, at the BUYER's ordinals address.
  expect(Math.round(settleRaw.vout[0].value * 1e8)).toBe(valueSats);
  expect(settleRaw.vout[0].scriptPubKey.address).toBe(buyerOrdinals);

  // ─── 10. THE PROOF: seller paid at P (typed), the amount price+value ─
  expect(Math.round(settleRaw.vout[1].value * 1e8)).toBe(priceSats + valueSats);
  expect(settleRaw.vout[1].scriptPubKey.address).toBe(P);
  // And O (the owner address) is paid by NOTHING — the regression guard.
  const paidToO = settleRaw.vout.filter((v) => v.scriptPubKey.address === O);
  expect(paidToO).toHaveLength(0);
  console.log(`[${tag}] cat -> buyer ${buyerOrdinals}; seller paid ${priceSats + valueSats} @ P=${P}; O=${O} paid nothing`);

  browserErrorGuard.assertClean();
  await page.close();
}

test('make-offer @ 546 (fresh-postage cat): page pays typed P, never owner O', { timeout: 300_000 }, async () => {
  await runMakeOfferCell(546, 10_000);
});

// 546 and a hardcoded 546 coincide, so a 546-only test proves nothing about
// size handling. The 9000 cell proves the PAGE preserves the real cat UTXO size
// end to end (offer output 0 = the incoming cat value, byte for byte) — the
// property the 2026-08-29 546-hardcode in the offer builder broke, and the one
// thing the SDK's builder-level byte-parity proof cannot reach.
test('make-offer @ 9000 (non-postage cat): page preserves the size + pays typed P', { timeout: 300_000 }, async () => {
  await runMakeOfferCell(9_000, 12_000);
});

/**
 * Dirty-coin protection on the make-offer BUYER-funding side, END TO END in
 * cat21.space's own wiring. Seeds a coin carrying a real <asset> at the buyer's
 * payment address, sized so an UNGUARDED best-fit selection would pick it:
 * dirty 20k < clean 40k, both cover the ~10k requirement, both under the 50k
 * auto-scan floor (so both get scanned rather than left 'unscanned'). The
 * guard (the SDK's class-AGNOSTIC recommendFunding, which avoids whatever the
 * scan flags as has-assets) must steer funding to the clean coin, leaving the
 * dirty coin's outpoint UNSPENT after settle.
 *
 * The green direction alone is NOT evidence. The mutation is ONE class-agnostic
 * lever (throwaway branch): neutralise recommendFunding's clean filter in the
 * installed SDK so every covering coin is selectable; the picker then takes the
 * smaller dirty coin and it gets spent, turning ALL of these cells RED, each
 * naming its own asset. Immune to the incidental rare sat every seedInscribedCoin
 * coin carries, because classification is not consulted under that mutation.
 */
async function runMakeOfferDirtyCell(asset: DirtyCoinAsset): Promise<void> {
  const tag = `make-offer:dirty:${asset}`;
  const PRICE_SATS = 10_000;
  const CAT_VALUE = 546;
  const DIRTY_SATS = 20_000; // covers price+fee, < clean, < 50k auto-scan floor
  const CLEAN_SATS = 40_000; // covers comfortably, > dirty, < 50k

  // ─── 1. Connect the buyer (cat21-wallet), read its addresses ────
  const page = await context.newPage();
  const { paymentAddress: buyerPayment } = await connectAndReadAddresses(page);

  // ─── 2. Buyer funding: a CLEAN coin the guard should steer TO, and a
  //        DIRTY coin an unguarded best-fit would pick FIRST (it is smaller). ─
  await fundCommonSats(buyerPayment, CLEAN_SATS / 1e8);
  const dirty = await seedDirtyCoin({ asset, address: buyerPayment, valueSats: DIRTY_SATS });
  console.log(`[${tag}] dirty ${asset} coin ${dirty.outpoint} value=${dirty.value} assetId=${dirty.assetId}`);

  // ─── 3. A target cat to offer on (owner O, distinct payment P) ──
  const O = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32').trim();
  const P = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32').trim();
  const listed = await seedListedCat({ ordinalsAddress: O, valueSats: CAT_VALUE });
  await waitForBackendCat(listed.catNumber);

  // ─── 4. Drive make-offer to a built, buyer-signed offer ─────────
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

  // The guard steered funding to the clean coin, so the simulation resolves and
  // the CTA enables. (Under the mutation the dirty coin is picked instead, but
  // the build still succeeds — the proof is on-chain, below.)
  await expect(page.getByTestId('make-offer-summary-section')).toBeVisible({ timeout: 60_000 });
  const buildBtn = page.getByTestId('make-offer-cta');
  await expect(buildBtn).toBeEnabled({ timeout: 60_000 });

  const knownBeforeSign = new Set(context.pages());
  await buildBtn.click();
  const signPopup = await waitForApprovalPopup({
    context, knownPages: knownBeforeSign, timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await assertBuyerNeverSignsSellerInput0(signPopup);
  await clickApprovalButton(signPopup);
  await signPopup.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

  // ─── 5. Read the page-built PSBT, seller settles on-chain ───────
  await expect(page.getByTestId('make-offer-success')).toBeVisible({ timeout: 90_000 });
  await page.getByText('Prefer the raw offer text?', { exact: false }).click();
  const pageBuiltPsbt = (await page.getByTestId('make-offer-artifact-textarea').inputValue()).trim();
  const processed = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', '-named', 'walletprocesspsbt',
      `psbt=${pageBuiltPsbt}`, 'sign=true', 'finalize=true'),
  ) as { psbt: string; hex?: string; complete: boolean };
  const settleHex = processed.hex
    ?? (JSON.parse(rpc('finalizepsbt', processed.psbt)) as { hex: string }).hex;
  const settleTxid = rpc('sendrawtransaction', settleHex).trim();
  mineBlocks(1);
  await waitForTxConfirmed(settleTxid, 30_000);

  // ─── 6. THE PROOF: the dirty coin was NOT spent ─────────────────
  // gettxout returns the txout for an unspent outpoint, empty for a spent one.
  // Under a working guard the offer funded from the clean coin, so the dirty
  // coin survives; under the recommendFunding mutation it is spent and this
  // goes RED naming this asset.
  const txout = rpc('gettxout', dirty.txid, String(dirty.vout)).trim();
  expect(txout.length, `dirty ${asset} coin ${dirty.outpoint} was SPENT — the funding guard did not steer away from it`).toBeGreaterThan(0);
  const settleRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', settleTxid, '2'),
  ) as { vin: Array<{ txid: string; vout: number }> };
  const spentDirty = settleRaw.vin.some((v) => v.txid === dirty.txid && v.vout === dirty.vout);
  expect(spentDirty, `settle tx spent the dirty ${asset} coin ${dirty.outpoint}`).toBe(false);
  console.log(`[${tag}] SURVIVED — guard steered funding to the clean coin`);

  browserErrorGuard.assertClean();
  await page.close();
}

test('make-offer dirty-coin guard: an INSCRIPTION funding coin is not spent', { timeout: 300_000 }, async () => {
  await runMakeOfferDirtyCell('inscription');
});

test('make-offer dirty-coin guard: a CAT funding coin is not spent', { timeout: 300_000 }, async () => {
  await runMakeOfferDirtyCell('cat');
});

test('make-offer dirty-coin guard: a RUNE funding coin is not spent', { timeout: 300_000 }, async () => {
  await runMakeOfferDirtyCell('rune');
});

test('make-offer dirty-coin guard: a RARE-SAT funding coin is not spent', { timeout: 300_000 }, async () => {
  await runMakeOfferDirtyCell('rareSat');
});
