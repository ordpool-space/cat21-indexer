/**
 * @test-kind e2e
 * Real:   built frontend (:4221), bitcoind regtest, ordpool-electrs, cat21-ord (:8080: the transfer
 *         holdings picker, the cat detail page, the bid check), cat21-indexer backend (:9998, synced
 *         from cat21-ord), cat21-wallet (.crx)
 * Faked:  fees-electrs-stub on :8999 (ordpool-sdk/e2e/regtest), all of it written in the stub, not captured:
 *         /api/v1/fees/recommended (static DEFAULT_FEES; HIGH_FEES_PRESET posted to /admin/fees is
 *         recommendedFeesFixture with an invented spread); ord /output for the frontend's ord URLs;
 *         every other /api/* path is proxied to the real electrs
 *         context route on every /output/<outpoint> -> cleanOutputFixture (ordpool-sdk/core)
 *         page route on /output/<outpoint> for one outpoint -> catOutputFixture (ordpool-sdk/core)
 *         page route on POST /api/tx -> 400 (broadcast-failure test)
 * Proves: mint round-trip with nLockTime=21 and sequence 0xfffffffd; "Use anyway" spends a cat-flagged
 *         coin; manual fee overrides land on-chain; sign cancel and broadcast failure surface as errors;
 *         /cat/N, trade and transfer deep links; offer, transfer, picker-transfer and bid-marketplace
 *         round-trips move the cat on-chain
 */
/* eslint-disable no-console */
import { test, expect, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  waitForElectrsSync,
  waitForUtxoAt,
  rpc,
  mineBlocks,
  waitForTxConfirmed,
  waitForApprovalPopup,
  waitForOrdSync,
  onboardCat21Wallet,
  installContextErrorGuard,
  approveCat21WalletConnectPopup,
  waitForUtxoMatching,
  approveCat21WalletSignPopup,
  approvalGate,
  clickApprovalAndRequireClose,
  seedListedCat,
  getOrdInscription,
  catInscriptionId,
  launchWalletContext,
  installLeatherOfflineRoutes,
  installCat21WalletOrdRoutes,
  closeCat21WalletPage,
} from 'ordpool-sdk/e2e';
import { catOutputFixture, cleanOutputFixture, recommendedFeesFixture } from 'ordpool-sdk/core';

// Canonical clean `/output` body (indexed, carries nothing), merged across the
// two ord surfaces the scanner reads (full ord: inscriptions/runes/sat_ranges;
// cat21-ord: cats). Fixture-derived so it cannot drift from
// `classifyUtxoContent`'s contract: the fail-closed classifier reads an absent
// `sat_ranges` as NOT-INDEXED, so a hand-written body without it would class the
// funding coin unknown and disable the mint button.
const CLEAN_OUTPUT_BODY = { ...cleanOutputFixture().ord, ...cleanOutputFixture().cat21Ord };

// The same merge for a coin carrying a CAT-21 cat (cat21-ord reports the cat,
// the full ord reports nothing), so the scanner classifies it as an asset coin.
const CAT_OUTPUT_BODY = { ...catOutputFixture().ord, ...catOutputFixture().cat21Ord };

/**
 * E2E (regtest mint) — cat21.space /dashboard/mint via CAT-21 wallet.
 *
 * cat21.space sibling of ordpool's cat21wallet-mint-regtest spec.
 * Same RBF + onboarding notes apply (see the ordpool spec's file-
 * level docstring for the full backstory):
 *
 *   - CAT-21 wallet IS allowed to signal RBF (sequence = 0xfffffffd)
 *     because its mempool-acceleration UI guarantees `nLockTime=21`
 *     is preserved on any replacement. The check belongs in the
 *     mint-roundtrip iteration; this iteration pins the picker +
 *     connect path only.
 *
 *   - CAT-21 wallet onboards from a BIP-39 mnemonic; no cloned seed
 *     user-data-dir. The onboarding sequence (sign-in-link → 12
 *     inputs → password → dashboard) mirrors the SDK's
 *     `cat21wallet-onboard.spec.ts` and is embedded inline as
 *     beforeAll's primer.
 *
 *   - CAT-21 wallet's connector honours `Network.Regtest` but the
 *     end-to-end pattern EVERY spec uses (mint, transfer, offer, and
 *     this consumer-UI spec) is: connect the wallet as mainnet,
 *     then derive the bcrt1q / bcrt1p addresses locally from the
 *     same pubkeys via @scure/btc-signer. This spec drives the
 *     cat21-indexer frontend UI which encapsulates that flow — see
 *     `connectCat21WalletViaMintPage` below. Full details in the
 *     workspace's `E2E_WALLET_TRICKS.md`.
 *
 * Test scope: mint round-trip, warned-cat "Use anyway" flow,
 * manual overrides, sign-popup cancel, broadcast-failure surfacing,
 * /cat/N + /dashboard/{trade,transfer} navigation, full offer /
 * transfer / bid-marketplace round-trips.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4221';
/** The cat21-indexer backend: cats, listings, bids. */
const INDEXER_URL = process.env.CAT21_INDEXER_URL ?? 'http://localhost:9998';
const MINT_PATH = '/dashboard/mint';
/** The SDK's fees-electrs-stub, whose fee presets (/admin/fees) the manual-override tests set. */
const FEES_STUB_URL = process.env.FEES_STUB_URL ?? 'http://localhost:8999';
/** The real cat21-ord the transfer holdings picker reads. */
const CAT21_ORD_URL = process.env.REGTEST_ORD_URL ?? 'http://localhost:8080';

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');

const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let extensionId: string;
let browserErrorGuard: ReturnType<typeof installContextErrorGuard>;

// Shared state across `test()` blocks. Also persisted to a tempfile so
// that if Playwright restarts the worker (e.g. after a browser-close
// error mid-test), subsequent tests re-hydrate from disk instead of
// finding these `let` vars reset to `undefined`. Cascade avoidance —
// one flake in test N should not fail every dependent test after it.
const SHARED_STATE_FILE = path.resolve(RESULTS_DIR, '.shared-state.json');

interface SharedState {
  paymentAddress?: string;
  mintTxid?: string;
}

function loadShared(): SharedState {
  try {
    return JSON.parse(fs.readFileSync(SHARED_STATE_FILE, 'utf8')) as SharedState;
  } catch {
    return {};
  }
}

function saveShared(patch: SharedState): void {
  const cur = loadShared();
  fs.mkdirSync(path.dirname(SHARED_STATE_FILE), { recursive: true });
  fs.writeFileSync(SHARED_STATE_FILE, JSON.stringify({ ...cur, ...patch }));
}

let sharedPaymentAddress: string | undefined = loadShared().paymentAddress;
// Set at the end of the first (mint) test — the confirmed on-chain
// txid whose vout[0] carries the fresh cat. The full-offer-round-trip
// test picks this up as its sellerInput.
let sharedMintTxid: string | undefined = loadShared().mintTxid;

// TS narrowing message for sharedPaymentAddress reads throughout the
// suite. beforeAll structurally sets sharedPaymentAddress; every
// `if (!sharedPaymentAddress) throw new Error(SHARED_ADDR_UNSET)`
// below is a type-checker gate, not an ordering guard. If it fires,
// the beforeAll itself would have failed first and Playwright would
// have reported that instead. See `test.describe.configure` block
// below for the serial-mode cascade-avoidance that also removes any
// remaining "test N ran before test 1" concern.
const SHARED_ADDR_UNSET = 'sharedPaymentAddress not initialized (beforeAll should have set it)';

// File-scope serial mode: tests in this spec chain on shared on-chain
// state (mint tx → transfer / offer / bid settle). Serial mode makes
// Playwright run tests in file order AND skip subsequent tests when
// one earlier in the file fails, so a broken mint doesn't cascade
// into misleading "sharedMintTxid was not set" errors from every
// downstream test. Same effect as wrapping the whole file in
// `test.describe.serial(...)`, without the 1900-line reindent.
test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21wallet-mint-regtest-${name}.png`),
    fullPage: true,
  });
}

/**
 * Navigate to /dashboard/mint by clicking through the header nav (rule 4
 * of E2E_BEST_PRACTICES.md). Assumes the wallet is already connected —
 * the header only renders `nav-dashboard` for connected wallets. Every
 * test uses this helper; the connect flow itself lives in `beforeAll`.
 */
async function navigateViaHeaderToMint(page: Page): Promise<void> {
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('wallet-connected-btn').waitFor({ state: 'visible' });
  await page.getByTestId('nav-dashboard').click();
  await page.waitForURL('**/dashboard');
  await page.getByTestId('dashboard-card-mint').click();
  await page.waitForURL('**/dashboard/mint');
}

/**
 * First-time connect flow: goto the mint page while disconnected, click
 * the `mint-cta` connect card, pick CAT-21 wallet in the modal, approve
 * the get-addresses popup, extract the payment address. Returns the
 * bcrt1q… regtest payment address; the persistent context carries the
 * connect state to every subsequent test's page.
 *
 * Called from `beforeAll` (rule 1) so every test starts with a
 * connected wallet and a known `sharedPaymentAddress`, regardless
 * of Playwright shard/retry order.
 */
async function connectCat21WalletViaMintPage(page: Page): Promise<{ paymentAddress: string }> {
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const cta = page.getByTestId('mint-cta');
  await expect(cta).toBeVisible();

  // Snapshot existing pages BEFORE the connect click. The Xverse spec
  // hit this race three times before the fix — CAT-21 wallet's approval
  // popup spawns synchronously the same way.
  const knownPagesBeforeConnect = new Set(context.pages());
  await page.getByTestId('wallet-connect-btn').first().click();

  // Picker modal — CAT-21 wallet sits in the "installed" section. Pick
  // by testid (matrix-driven rows carry `wallet-pick-<type>`), immune to
  // label wording.
  const cat21Picker = page.getByTestId('wallet-pick-cat21wallet').first();
  await expect(cat21Picker).toBeVisible();
  await cat21Picker.click();

  await approveCat21WalletConnectPopup(context, knownPagesBeforeConnect);
  // The popup is never closed from here: cat21-wallet's
  // userApprovesGetAddresses runs a ~400 ms animation BEFORE sending the
  // addresses back, and a manual close cuts that dispatch (run 27502018547
  // trace.zip showed click->close = 44 ms). The hidden connect CTA is the
  // signal that the addresses arrived.
  await expect(cta).toBeHidden();

  // Path-1 proof: payment address is REGTEST bcrt1q. Extract from the
  // wallet-connect popover in the header, NOT from mint-no-utxos. On
  // beforeAll re-runs (Playwright restarts the worker after certain
  // test failures), the same mnemonic derives the same address; if a
  // previous test already funded it, mint-found-funds shows instead
  // of mint-no-utxos and the payment-code element isn't there. The
  // header popover is stable regardless of mint-page state.
  //
  // CAT-21 wallet's getAddresses honors the `network` param (SDK
  // connector maps Network.Regtest → 'regtest' — cat21-wallet also
  // accepts Leather's legacy 'devnet' alias but the SDK sends the
  // standard Bitcoin term; see toLeatherNetworkString in ordpool-sdk
  // src/network.ts), so the returned
  // paymentAddr must start with bcrt1q.
  await page.getByTestId('wallet-connected-btn').click();
  const paymentAddrEl = page.getByTestId('wallet-payment-address-full');
  await expect(paymentAddrEl).toHaveText(/^bcrt1q/);
  const paymentAddr = (await paymentAddrEl.textContent())!.trim();
  return { paymentAddress: paymentAddr };
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`CAT-21 wallet extension not unpacked at ${EXT_PATH}.`);
  }

  context = await launchWalletContext({ wallet: 'cat21wallet', extensionPath: EXT_PATH });
  // The wallet's vendor backends are answered locally or aborted, and its
  // cat21-ord reads go to the regtest cat21-ord.
  await installLeatherOfflineRoutes(context);
  await installCat21WalletOrdRoutes(context);

  // Default every BROWSER-side ord `/output/<outpoint>` scan to a clean body.
  // The SDK's safe-auto funding recommendation force-scans the funding UTXO
  // regardless of size, and the :8999 stub answers /output with a static
  // `cats:[0]` (correct only for the bid flow's real cat outpoint), which would
  // falsely flag a plain funding coin as carrying cat #0 and hide
  // `mint-found-funds`. Asset-tests override this per page with their own
  // page.route for a specific cat outpoint (page routes win over context
  // routes). The node-side cat-verification fetch is not a page request, so it
  // still reaches the stub's `cats:[0]` directly.
  await context.route('**/output/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(CLEAN_OUTPUT_BODY),
    });
  });

  // Fails a test on any uncaught exception, console.error or failed request on
  // a page of ours. A test that provokes one declares it with
  // expectBrowserError.
  browserErrorGuard = installContextErrorGuard(context);

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker');
  }
  extensionId = worker.url().split('/')[2];

  const primer = await context.newPage();
  await onboardCat21Wallet(primer, extensionId);
  await shot(primer, '00-onboarded');
  await closeCat21WalletPage(primer);

  // Connect the wallet ONCE for the whole suite (rule 1). Every test
  // reads sharedPaymentAddress from module scope; no ordering coupling
  // on "the first test connects".
  const connectPage = await context.newPage();
  const { paymentAddress } = await connectCat21WalletViaMintPage(connectPage);
  sharedPaymentAddress = paymentAddress;
  saveShared({ paymentAddress });
  await shot(connectPage, '00b-wallet-connected');
  await connectPage.close();
  browserErrorGuard.assertClean();
});

test.afterEach(() => {
  browserErrorGuard.assertClean();
});

test.afterAll(async () => {
  await context?.close();
});

test('cat21-wallet mint round-trip end-to-end (RBF-signaling sequence pinned)', async () => {
  // Connect flow already ran in beforeAll; sharedPaymentAddress is set.
  if (!sharedPaymentAddress) throw new Error(SHARED_ADDR_UNSET);
  const paymentAddr = sharedPaymentAddress;

  const page = await context.newPage();
  await navigateViaHeaderToMint(page);
  await shot(page, '01-page-loaded');

  // ─── Full mint round-trip ─────────────────────────────────────
  // Same flow as ordpool's, with cat21-indexer's data-testid
  // selectors. CAT-21 wallet RBF policy assertion (sequence ==
  // 0xfffffffd) lives at the bottom.
  const FUND_AMOUNT_BTC = 0.001;
  const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddr, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[cat21wallet] funded ${paymentAddr} +${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
  const fundedTip = mineBlocks(1);
  await waitForElectrsSync(fundedTip);
  // Poll the address for the specific 100 000-sat UTXO instead of a
  // single getUtxos + expect(length > 0). waitForElectrsSync only
  // guarantees electrs has ingested the block header; the per-address
  // UTXO index lags a beat, and the length check flakes on cold
  // runners. See SDK's 77c7cab for the same pattern in the SDK's own
  // regtest specs, plus the feedback_one_green_run_not_green memory.
  await waitForUtxoAt(paymentAddr, FUND_AMOUNT_SATS);

  // Reload so the orchestrator picks up the new UTXO.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await shot(page, '05-after-fund-reload');

  // Wait for found-funds, set fee, click Mint.
  const foundFunds = page.getByTestId('mint-found-funds');
  await expect(foundFunds).toBeVisible();
  const manualInput = page.getByTestId('fees-picker-manual-input');
  await manualInput.fill('1');
  await manualInput.press('Tab');
  const mintBtn = page.getByTestId('mint-btn');
  await expect(mintBtn).toBeEnabled();
  await shot(page, '06-ready-to-mint');

  const knownBeforeSign = new Set(context.pages());
  await mintBtn.click();
  await approveCat21WalletSignPopup({
    context,
    knownPages: knownBeforeSign,
    screenshot: async (p) => { await shot(p, '07-sign-approval'); },
  });

  const successCard = page.getByTestId('mint-success');
  await expect(successCard).toBeVisible();
  await shot(page, '08-success');
  const successHref = await successCard.locator('a').first().getAttribute('href');
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[cat21wallet] mint txid = ${broadcastTxid}`);
  // Hoist for the later full-offer-round-trip test.
  sharedMintTxid = broadcastTxid;
  saveShared({ mintTxid: broadcastTxid });

  mineBlocks(1);
  const esploraTx = await waitForTxConfirmed(broadcastTxid);
  expect(esploraTx.locktime).toBe(21);
  expect(esploraTx.vout.length).toBeGreaterThanOrEqual(1);
  expect(esploraTx.vout[0].value).toBe(546);
  // CAT-21 wallet RBF policy: input sequence == 0xfffffffd.
  // The ONE exception to the Xverse spec's ≥0xfffffffe rule.
  expect(esploraTx.vin.length).toBeGreaterThan(0);
  for (const vin of esploraTx.vin) {
    expect(vin.sequence).toBe(0xfffffffd);
  }
});

// Invented spread: every tier far above the typed rate, so the picker tiles
// visibly disagree with the manual override. Typed against the SDK's
// RecommendedFees contract via its fixture.
const HIGH_FEES_PRESET = recommendedFeesFixture({
  fastestFee: 100,
  halfHourFee: 60,
  hourFee: 30,
  economyFee: 20,
  minimumFee: 10,
});

async function cat21walletMintAtRate(opts: {
  rate: number;
  scenarioLabel: string;
  mockFeesAsHigh?: boolean;
}): Promise<{ broadcastTxid: string; fee: number; vsize: number; rate: number }> {
  if (!sharedPaymentAddress) throw new Error(SHARED_ADDR_UNSET);

  if (opts.mockFeesAsHigh) {
    const res = await fetch(`${FEES_STUB_URL}/admin/fees`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(HIGH_FEES_PRESET),
    });
    if (!res.ok) throw new Error(`stub /admin/fees rejected: ${res.status}`);
  }

  try {
    const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, '0.001').trim();
    console.log(`[${opts.scenarioLabel}] funded tx=${fundTxid}`);
    await waitForElectrsSync(mineBlocks(1));

    const page = await context.newPage();
    await navigateViaHeaderToMint(page);

    if (opts.mockFeesAsHigh) {
      const buttons = page.locator('[data-testid^="fees-picker-tier-"]');
      await expect(buttons).toHaveCount(4);
      await expect(buttons.nth(0)).toContainText('100');
    }

    const manualInput = page.getByTestId('fees-picker-manual-input');
    await manualInput.fill(String(opts.rate));
    await manualInput.press('Tab');
    const foundFunds = page.getByTestId('mint-found-funds');
    await expect(foundFunds).toBeVisible();
    const mintBtn = page.getByTestId('mint-btn');
    await expect(mintBtn).toBeEnabled();

    const knownSign = new Set(context.pages());
    await mintBtn.click();
    await approveCat21WalletSignPopup({ context, knownPages: knownSign });

    const successCard = page.getByTestId('mint-success');
    await expect(successCard).toBeVisible();
    const successHref = await successCard.locator('a').first().getAttribute('href');
    const broadcastTxid = successHref!.match(/\/tx\/([0-9a-f]{64})/)![1];

    mineBlocks(1);
    const tx = await waitForTxConfirmed(broadcastTxid);
    expect(tx.locktime).toBe(21);
    expect(tx.vout[0].value).toBe(546);
    for (const vin of tx.vin) {
      expect(vin.sequence).toBe(0xfffffffd);
    }
    const vsize = Math.ceil(tx.weight / 4);
    const rate = tx.fee / vsize;
    console.log(`[${opts.scenarioLabel}] fee=${tx.fee} vsize=${vsize} rate=${rate.toFixed(3)} (target ${opts.rate})`);

    await page.close();
    return { broadcastTxid, fee: tx.fee, vsize, rate };
  } finally {
    if (opts.mockFeesAsHigh) {
      await fetch(`${FEES_STUB_URL}/admin/fees/reset`, { method: 'POST' });
    }
  }
}

test('asset scanner: warned cat-bearing UTXO can be burned via "Use anyway" on CAT-21 wallet', async () => {
  if (!sharedPaymentAddress) throw new Error(SHARED_ADDR_UNSET);

  const SMALL_FUND_SATS = 15_000;
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, '0.00015').trim();
  await waitForElectrsSync(mineBlocks(1));
  const small = await waitForUtxoMatching(
    sharedPaymentAddress,
    (u) => u.value === SMALL_FUND_SATS && u.txid === fundTxid,
    `the ${SMALL_FUND_SATS}-sat funding coin from ${fundTxid}`,
  );
  const catOutpoint = `${small.txid}:${small.vout}`;

  const page = await context.newPage();
  // Anti-cheating pattern (2026-07-21 orderbook post-mortem): the loose
  // `url.includes(catOutpoint)` fallback would silently return "no cat"
  // if the frontend built a malformed ord `/output/` URL (missing colon,
  // NaN vout, wrong txid length). Regex-parse strictly; push any URL
  // that doesn't match the shape into `badOutputCalls` and assert
  // it's empty at the end of the test.
  const badOutputCalls: string[] = [];
  await page.route('**/output/*', async (route) => {
    const url = route.request().url();
    const m = url.match(/\/output\/([0-9a-f]{64}):(\d+)(?:\?|#|$)/i);
    if (!m) {
      badOutputCalls.push(url);
    }
    const requestedOutpoint = m ? `${m[1].toLowerCase()}:${m[2]}` : '';
    const isCatTarget = requestedOutpoint === catOutpoint.toLowerCase();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(
        isCatTarget
          ? CAT_OUTPUT_BODY
          : CLEAN_OUTPUT_BODY,
      ),
    });
  });
  await navigateViaHeaderToMint(page);

  // Expand picker if not auto-open.
  const pickerSummary = page.getByTestId('mint-expert-summary').first();
  await expect(pickerSummary).toBeVisible();
  if ((await page.locator('details[data-testid="mint-expert"][open]').count()) === 0) {
    await pickerSummary.click();
  }

  // Asset row + override. Find by IDENTITY (outpoint text), then explicitly
  // assert the bucket flipped to `assets` — the old bucket-keyed test-id proved
  // that implicitly (it only resolved on an assets row); the identity id does
  // not, so the bucket proof must be its own assertion or it is silently lost.
  const assetRow = page.locator('[data-testid^="utxo-row-"]').filter({ hasText: catOutpoint }).first();
  await expect(assetRow).toBeVisible();
  await expect(assetRow).toHaveAttribute('data-bucket', 'assets');
  const overrideBtn = assetRow.locator('.utxo-pick-override');
  await expect(overrideBtn).toBeVisible();
  await overrideBtn.click();

  const mintBtn = page.getByTestId('mint-btn');
  await expect(mintBtn).toBeEnabled();
  const knownSign = new Set(context.pages());
  await mintBtn.click();
  await approveCat21WalletSignPopup({ context, knownPages: knownSign });

  const successCard = page.getByTestId('mint-success');
  await expect(successCard).toBeVisible();
  const successHref = await successCard.locator('a').first().getAttribute('href');
  const broadcastTxid = successHref!.match(/\/tx\/([0-9a-f]{64})/)![1];
  mineBlocks(1);
  const tx = await waitForTxConfirmed(broadcastTxid);
  expect(tx.locktime).toBe(21);
  expect(tx.vout[0].value).toBe(546);
  for (const vin of tx.vin) {
    expect(vin.sequence).toBe(0xfffffffd);
  }
  const spentCat = tx.vin.some(
    (v: { txid: string; vout: number }) => `${v.txid}:${v.vout}` === catOutpoint,
  );
  expect(spentCat).toBe(true);

  // No malformed /output/ URLs made it to the mock. See the
  // anti-cheating comment on the route setup.
  expect(
    badOutputCalls,
    `frontend built malformed /output/ URLs: ${JSON.stringify(badOutputCalls)}`,
  ).toHaveLength(0);
});

test('manual override: typing 100 mints a "purple cat" via CAT-21 wallet', async () => {
  const { rate } = await cat21walletMintAtRate({ rate: 100, scenarioLabel: 'purple' });
  expect(Math.abs(rate - 100)).toBeLessThan(1);
});

test('manual override: typing 1 while the picker suggests 100 — low rate wins on CAT-21 wallet', async () => {
  const { rate } = await cat21walletMintAtRate({ rate: 1, scenarioLabel: 'hot-mempool', mockFeesAsHigh: true });
  expect(Math.abs(rate - 1)).toBeLessThan(1);
});

test('sign-popup cancel keeps state coherent on CAT-21 wallet', async () => {
  if (!sharedPaymentAddress) throw new Error(SHARED_ADDR_UNSET);
  rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, '0.0003');
  await waitForElectrsSync(mineBlocks(1));

  const page = await context.newPage();
  await navigateViaHeaderToMint(page);

  const manualInput = page.getByTestId('fees-picker-manual-input');
  await manualInput.fill('1');
  await manualInput.press('Tab');
  const mintBtn = page.getByTestId('mint-btn');
  await expect(mintBtn).toBeEnabled();

  const knownSign = new Set(context.pages());
  await mintBtn.click();
  const sign = await waitForApprovalPopup({
    context,
    knownPages: knownSign,
    isApproval: approvalGate({
      url: /^chrome-extension:\/\//,
      control: (p) => p.getByRole('button', { name: /^(deny|cancel|reject)$/i }).first(),
    }),
  });
  // The wallet closes its popup on Deny, which is the proof the click landed.
  await clickApprovalAndRequireClose(sign.getByRole('button', { name: /^(deny|cancel|reject)$/i }).first(), sign, {
    label: 'Cat21 Wallet sign popup (deny)',
  });

  // The rejected sign settles the mint as an error, which is the state that
  // says no success is coming.
  await expect(page.getByTestId('mint-error')).toBeVisible();
  await expect(page.getByTestId('mint-success')).toHaveCount(0);
});

test('broadcast failure surfaces as an error on CAT-21 wallet (not a fake success)', async () => {
  if (!sharedPaymentAddress) throw new Error(SHARED_ADDR_UNSET);
  rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, '0.0003');
  await waitForElectrsSync(mineBlocks(1));

  const page = await context.newPage();
  browserErrorGuard.expectBrowserError(
    /Failed to load resource: the server responded with a status of 400/,
    'the spec fulfils POST /api/tx with 400 to prove the broadcast error path',
  );
  await page.route('**/api/tx', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 400,
        contentType: 'text/plain',
        headers: { 'access-control-allow-origin': '*' },
        body: 'test-induced broadcast rejection',
      });
      return;
    }
    await route.continue();
  });
  await navigateViaHeaderToMint(page);

  const manualInput = page.getByTestId('fees-picker-manual-input');
  await manualInput.fill('1');
  await manualInput.press('Tab');
  const mintBtn = page.getByTestId('mint-btn');
  await expect(mintBtn).toBeEnabled();

  const knownSign = new Set(context.pages());
  await mintBtn.click();
  await approveCat21WalletSignPopup({ context, knownPages: knownSign });

  const errorAlert = page.getByTestId('mint-error');
  await expect(errorAlert).toBeVisible();
  await expect(page.getByTestId('mint-success')).toHaveCount(0);
});


// ============================================================
// Cat-detail flow: Sell / Buy / Send buttons + Sell modal +
// ask banner + make-offer / transfer deep-link prefills.
//
// The tests below reuse the wallet connected in the first test
// above (`context` persists across tests; the SDK's WalletService
// restores connectedWallet from localStorage on every page load).
//
// The cat is real: seedListedCat mints it to the wallet's ordinals
// address, cat21-ord indexes it and the backend syncs it, so the page
// reads it from the same services production does.
// ============================================================

let sellerOrdinalsAddress: string | undefined;

/**
 * Reads the connected wallet's ordinals address by opening the
 * wallet-connect popover and pulling the `title` attribute off the
 * ordinals-row <code> element. Cached so subsequent tests skip the
 * DOM round-trip.
 */
async function ensureSellerOrdinalsAddress(): Promise<string> {
  if (sellerOrdinalsAddress) return sellerOrdinalsAddress;
  const page = await context.newPage();
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  const walletBtn = page.getByTestId('wallet-connected-btn');
  await expect(walletBtn).toBeVisible();
  await walletBtn.click();
  // The popover renders a hidden span with the full address (the visible
  // <code> is truncated for humans; the testid split from
  // E2E_BEST_PRACTICES.md rule 12 lands the untruncated value on a
  // visually-hidden sibling for E2E consumption).
  const ordinalsCode = page.getByTestId('wallet-ordinals-address-full');
  await expect(ordinalsCode).toHaveText(/^(bcrt1|bc1)/);
  const addr = (await ordinalsCode.textContent())?.trim();
  if (!addr) throw new Error('could not extract connected wallet ordinals address from popover');
  sellerOrdinalsAddress = addr;
  console.log(`[cat21wallet] connected wallet ordinals address = ${addr}`);
  await page.close();
  return addr;
}

let ownedCatNumber: number | undefined;

/**
 * A real cat owned by the connected wallet, seeded once for the detail-flow
 * tests: minted to the wallet's ordinals address, indexed by cat21-ord and
 * synced by the backend (the lane runs it with a short SYNC_INTERVAL_MS).
 */
async function ensureOwnedCat(): Promise<number> {
  if (ownedCatNumber !== undefined) return ownedCatNumber;
  const owner = await ensureSellerOrdinalsAddress();
  const seeded = await seedListedCat({ ordinalsAddress: owner });
  await expect.poll(
    async () => (await fetch(`${INDEXER_URL}/api/cat/${seeded.catNumber}`)).status,
    { message: `backend never served /api/cat/${seeded.catNumber}` },
  ).toBe(200);
  console.log(`[detail-flow] owned cat #${seeded.catNumber} at ${seeded.txid}:${seeded.vout}`);
  ownedCatNumber = seeded.catNumber;
  return ownedCatNumber;
}

test('/cat/N: three action buttons + Sell modal generates the shareable permalink', async () => {
  const N = await ensureOwnedCat();
  const page = await context.newPage();

  await page.goto(`${FRONTEND_URL}/cat/${N}`, { waitUntil: 'domcontentloaded' });
  await shot(page, 'detail-01-loaded');

  // The three buttons are always rendered; owner-side states are
  // Sell:enabled, Buy:disabled ('owns-it'), Send:enabled.
  const sellBtn = page.getByTestId('cat-action-sell');
  const buyBtn = page.getByTestId('cat-action-buy');
  const sendBtn = page.getByTestId('cat-action-send');
  await expect(sellBtn).toBeVisible();
  await expect(buyBtn).toBeVisible();
  await expect(sendBtn).toBeVisible();

  await expect(sellBtn).toBeEnabled();
  await expect(buyBtn).toBeDisabled();
  await expect(sendBtn).toBeEnabled();
  await expect(buyBtn).toHaveAttribute('title', /already own this cat/i);

  // Sell modal round-trip.
  await sellBtn.click();
  const askInput = page.getByTestId('sell-modal-ask-input');
  await expect(askInput).toBeVisible();
  // The modal prefills the ask (cat value + mint fee) through a binding that
  // renders after the input is visible; typing before it lands appends to it.
  await expect(askInput).toHaveValue(/^\d+$/);
  await askInput.fill('21000');

  const permalink = page.getByTestId('sell-modal-permalink');
  await expect(permalink).toBeVisible();
  const url = await permalink.inputValue();
  expect(url).toContain(`/cat/${N}?ask=21000`);
  console.log(`[detail-flow] generated permalink = ${url}`);

  // Copy button flips to "Copied!" after clicking.
  const copyBtn = page.getByTestId('sell-modal-copy-permalink');
  await copyBtn.click();
  await expect(copyBtn).toContainText(/copied/i);

  await shot(page, 'detail-02-modal-permalink');
  await page.close();
});

test('/cat/N?ask=X: owner-variant ask banner is visible on the seller\'s own link', async () => {
  const N = await ensureOwnedCat();
  const page = await context.newPage();

  await page.goto(`${FRONTEND_URL}/cat/${N}?ask=21000`, { waitUntil: 'domcontentloaded' });
  const banner = page.getByTestId('ask-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/your ask for this cat is 21000 sats/i);
  await shot(page, 'detail-03-ask-banner-owner');
  await page.close();
});

test('/dashboard/trade/make?catNumber=X&askPrice=Y&fromAsk=1: "responding to ask" banner surfaces prefill intent', async () => {
  const N = await ensureOwnedCat();
  const page = await context.newPage();

  await page.goto(
    `${FRONTEND_URL}/dashboard/trade/make?catNumber=${N}&askPrice=21000&fromAsk=1`,
    { waitUntil: 'domcontentloaded' },
  );

  // The banner is driven purely off the URL query param and is what
  // this test pins; the prefill's cat-number lookup runs against the
  // real backend, cat21-ord and electrs.
  const banner = page.getByTestId('responding-to-ask-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/responding to a seller's ask/i);
  await shot(page, 'detail-04-make-offer-prefill-banner');
  await page.close();
});

test('/dashboard/transfer?catNumber=X: page loads and the connected-wallet heading is visible', async () => {
  const N = await ensureOwnedCat();
  const page = await context.newPage();

  await page.goto(`${FRONTEND_URL}/dashboard/transfer?catNumber=${N}`, {
    waitUntil: 'domcontentloaded',
  });

  // The transfer page's heading is stable across wallet states; the
  // presence assertion proves the page renders with the catNumber
  // input bound.
  const heading = page.getByRole('heading', { name: /transfer/i }).first();
  await expect(heading).toBeVisible();
  await shot(page, 'detail-05-transfer-prefill-loaded');
  await page.close();
});


// ============================================================
// Full CAT-21 offer round-trip: mint → sell → buyer builds+signs
// → seller countersigns → on-chain settlement.
//
// The seller side is the connected cat21-wallet already onboarded
// in beforeAll. The buyer side is bitcoin-cli's `ordpool-e2e`
// descriptor wallet — a canonical stand-in for any wallet that
// doesn't inject a browser provider (Sparrow, Electrum, hardware).
// This mirrors the SDK's own psbt-export-signer round-trip: any
// BIP-174 signer works because SIGHASH_ALL commits the whole tx
// regardless of who's signing.
//
// The test uses Node-side SDK helpers to build the buy-offer PSBT
// (`buildCat21BuyOfferPsbt` from ordpool-sdk/core), signs the
// buyer inputs via `walletprocesspsbt`, then hands the seller the
// finished shareable link. The cat21-wallet approves and signs
// input 0 (the cat's UTXO) at its ordinals address; the SDK's
// broadcast dispatcher submits the finalized tx to electrs via
// the fees-electrs-stub reverse-proxy on :8999.
// ============================================================

// Import SDK helpers from the Angular-free /core entry so the
// spec's TypeScript compile doesn't drag @angular/core in. The
// SDK ships pre-built dist-core/ so this resolves without a build.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sdkCore: {
  buildCat21BuyOfferPsbt: (args: unknown) => { psbt: Uint8Array; hex: string; buyerInputTotalSats: number; changeSats: number };
  Network: { Regtest: 'regtest'; Testnet: 'testnet'; Mainnet: 'mainnet' };
} = require('ordpool-sdk/core');

/** Base64-encode a Uint8Array. */
function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Hex-decode into a Uint8Array. */
function hexDecode(hexStr: string): Uint8Array {
  const clean = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

test('full offer round-trip: buyer builds+signs, seller countersigns, cat moves on-chain', async () => {
  // Real dependency: this test consumes the cat produced by the mint
  // test as its seller input. Under serial mode (see file-scope
  // `test.describe.configure({ mode: 'serial' })` above), Playwright
  // already skips this test if the mint failed — the throw is a
  // TS narrowing gate for the reads below, not an ordering guard.
  if (!sharedMintTxid) throw new Error('sharedMintTxid not initialized (the mint test should have set it — serial mode should have skipped this test)');
  if (!sharedPaymentAddress) throw new Error(SHARED_ADDR_UNSET);

  // ─── Read the mint tx to get the exact seller cat outpoint ───
  const mintTxJson = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', sharedMintTxid, '2')
  ) as {
    vout: Array<{ value: number; n: number; scriptPubKey: { hex: string; address?: string } }>;
  };
  const catOut = mintTxJson.vout[0];
  const sellerCatScriptHex = catOut.scriptPubKey.hex;
  const sellerCatAddress = catOut.scriptPubKey.address!;
  const sellerCatValue = Math.round(catOut.value * 1e8); // BTC → sats
  console.log(`[offer-flow] seller cat UTXO ${sharedMintTxid}:0 → ${sellerCatValue} sats at ${sellerCatAddress}`);
  expect(sellerCatValue).toBe(546);

  // ─── Fund the "buyer" (bitcoin-cli's ordpool-e2e wallet) ───
  //
  // We use ordpool-e2e as both the mining source and the buyer;
  // they're separate roles from Bitcoin's perspective. Send a
  // generous UTXO to a fresh P2WPKH so we don't accidentally
  // spend a coinbase.
  const BUY_PRICE_SATS = 21000;
  const OFFER_FEE_SATS = 2000;
  const buyerPaymentAddress = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32').trim();
  const buyerReceiveAddress = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32m').trim();
  const buyerChangeAddress = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32').trim();
  expect(buyerReceiveAddress).toMatch(/^bcrt1p/);
  console.log(`[offer-flow] buyer receive (taproot) = ${buyerReceiveAddress}`);

  // Fund the buyer's payment address with 0.001 BTC (100 000 sats)
  // — plenty for the price + fee + change dust.
  const buyerFundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', buyerPaymentAddress, '0.001').trim();
  await waitForElectrsSync(mineBlocks(1));

  // Look up the buyer's UTXO via bitcoin-cli (raw JSON to get the
  // scriptPubKey hex, which we need for the offer PSBT builder).
  const buyerFundRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', buyerFundTxid, '2')
  ) as {
    vout: Array<{ value: number; n: number; scriptPubKey: { hex: string; address?: string } }>;
  };
  const buyerVoutIdx = buyerFundRaw.vout.findIndex((v) => v.scriptPubKey.address === buyerPaymentAddress);
  expect(buyerVoutIdx).toBeGreaterThanOrEqual(0);
  const buyerVout = buyerFundRaw.vout[buyerVoutIdx];
  const buyerInputValueSats = Math.round(buyerVout.value * 1e8);
  console.log(`[offer-flow] buyer funding UTXO ${buyerFundTxid}:${buyerVoutIdx} → ${buyerInputValueSats} sats`);

  // ─── Build the buy-offer PSBT via the SDK ───
  const built = sdkCore.buildCat21BuyOfferPsbt({
    network: sdkCore.Network.Regtest,
    sellerInput: {
      txid: sharedMintTxid,
      vout: 0,
      value: sellerCatValue,
      scriptPubKey: hexDecode(sellerCatScriptHex),
    },
    buyerInputs: [
      {
        txid: buyerFundTxid,
        vout: buyerVoutIdx,
        value: buyerInputValueSats,
        scriptPubKey: hexDecode(buyerVout.scriptPubKey.hex),
      },
    ],
    destinations: {
      buyerReceiveAddress,
      sellerPaymentAddress: sharedPaymentAddress,
      buyerChangeAddress,
    },
    priceSats: BUY_PRICE_SATS,
    feeSats: OFFER_FEE_SATS,
  });
  console.log(`[offer-flow] built offer PSBT: ${built.psbt.length} bytes, change=${built.changeSats}`);

  const unsignedOfferBase64 = b64(built.psbt);

  // ─── Buyer signs their inputs via bitcoin-cli ───
  //
  // finalize=false so input 0 (the seller's cat UTXO, not owned by
  // ordpool-e2e wallet) stays untouched and the buyer's inputs get
  // partial-sig entries. The SDK's accept-side signer then adds the
  // seller signature and finalizes the whole PSBT.
  const walletprocessed = JSON.parse(
    rpc(
      '-rpcwallet=ordpool-e2e',
      '-named',
      'walletprocesspsbt',
      `psbt=${unsignedOfferBase64}`,
      'sign=true',
      'finalize=false',
    )
  ) as { psbt: string; complete: boolean };
  const buyerSignedBase64 = walletprocessed.psbt;
  console.log(`[offer-flow] buyer-signed PSBT length = ${buyerSignedBase64.length}, complete=${walletprocessed.complete}`);

  // ─── Seller opens the shareable-accept URL ───
  const acceptUrl = new URL(`${FRONTEND_URL}/dashboard/trade/accept`);
  acceptUrl.searchParams.set('offer', buyerSignedBase64);
  acceptUrl.searchParams.set('catTxid', sharedMintTxid);
  acceptUrl.searchParams.set('catVout', '0');

  const page = await context.newPage();
  await page.goto(acceptUrl.toString(), { waitUntil: 'domcontentloaded' });
  await shot(page, 'offer-01-accept-loaded');

  // The URL committed the cat outpoint; the accept-offer page shows
  // the "pre-selected from the buyer's link" hint.
  const catFromUrlHint = page.getByTestId('accept-offer-cat-from-url');
  await expect(catFromUrlHint).toBeVisible();
  await expect(catFromUrlHint).toContainText(sharedMintTxid);

  // Accept button becomes enabled once the orchestrator's validator
  // resolves against the parsed offer + wallet.paymentAddress +
  // urlCatOutpoint. Wait for that ready state.
  const acceptBtn = page.getByTestId('accept-offer-sign-cta');
  await expect(acceptBtn).toBeVisible();
  await expect(acceptBtn).toBeEnabled();
  await shot(page, 'offer-02-accept-ready');

  // ─── Click Accept → cat21-wallet approval popup → sign ───
  const knownBeforeSign = new Set(context.pages());
  await acceptBtn.click();
  await approveCat21WalletSignPopup({
    context,
    knownPages: knownBeforeSign,
    screenshot: async (p) => { await shot(p, 'offer-03-sign-approval'); },
  });

  // ─── Success surfaces + broadcast txid available ───
  const successCard = page.getByTestId('accept-offer-success');
  await expect(successCard).toBeVisible();
  await shot(page, 'offer-04-success');
  const successLink = successCard.locator('a').first();
  const successHref = await successLink.getAttribute('href');
  const successTxidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(successTxidMatch).not.toBeNull();
  const settleTxid = successTxidMatch![1];
  console.log(`[offer-flow] settlement txid = ${settleTxid}`);

  // ─── On-chain verification ───
  mineBlocks(1);
  const settleTx = await waitForTxConfirmed(settleTxid);
  // Regression guard for the SDK's builder invariant, NOT a protocol
  // requirement. `cat21-offer.helper.ts` throws if `lockTime !== 21`
  // at build time — this asserts the same holds after broadcast so
  // a change to the helper that dropped the invariant is caught here
  // and not silently. A third-party-wallet settle with `locktime=0`
  // would still deliver the cat (sat-tracking follows the sat, not
  // the locktime); losing =21 only loses the SDK's bonus mint. See
  // workspace HQ HARD RULE "nLockTime=21 is PROTOCOL for MINT,
  // CONVENTION for everything else".
  expect(settleTx.locktime).toBe(21);
  // Output 0 = cat at 546 sats to buyer's receive address.
  // Output 1 = seller payment = priceSats + postage to seller.
  // Output 2 (may or may not exist depending on change) = buyer change.
  expect(settleTx.vout.length).toBeGreaterThanOrEqual(2);

  // Query via bitcoin-cli to inspect address strings (electrs's
  // vout shape is untyped in EsploraTx so a raw-tx dive is cleaner).
  const settleRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', settleTxid, '2')
  ) as {
    vout: Array<{ value: number; scriptPubKey: { address?: string } }>;
  };
  expect(Math.round(settleRaw.vout[0].value * 1e8)).toBe(546);
  expect(settleRaw.vout[0].scriptPubKey.address).toBe(buyerReceiveAddress);
  expect(Math.round(settleRaw.vout[1].value * 1e8)).toBe(BUY_PRICE_SATS + 546);
  expect(settleRaw.vout[1].scriptPubKey.address).toBe(sharedPaymentAddress);
  console.log(`[offer-flow] cat moved to buyer @ ${buyerReceiveAddress}, seller paid ${BUY_PRICE_SATS + 546} sats @ ${sharedPaymentAddress}`);

  await page.close();
});


// ============================================================
// Full CAT-21 transfer round-trip: mint a fresh cat → transfer
// to a new address via /dashboard/transfer → verify on-chain.
//
// The transfer test mints its OWN cat (via the existing
// cat21walletMintAtRate helper) so it doesn't depend on
// sharedMintTxid — which the offer round-trip already spent.
//
// Uses the ?catTxid + catVout URL override on the transfer page
// to bypass the ord-driven holdings picker (ord isn't reachable
// in this e2e stack). The picker fallback lives in transfer.ts's
// `urlCatUtxo` computed; production users still get the picker
// working through ord.
// ============================================================

/**
 * The transfer page's debug marker and error text, for a failure log. Reads
 * without waiting (evaluateAll, allTextContents), so an absent element yields
 * an empty list instead of a second error that would replace the first.
 */
async function transferDebugState(page: Page): Promise<string> {
  const debugState = await page.getByTestId('transfer-debug-state').evaluateAll((els) =>
    els.map((el) => Object.fromEntries(
      Array.from(el.attributes).filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value]),
    )));
  const transferError = await page.getByTestId('transfer-error').allTextContents();
  return JSON.stringify({ debugState, transferError });
}

test('full transfer round-trip: fresh mint → transfer via URL → cat moves on-chain', async () => {
  if (!sharedPaymentAddress) throw new Error(SHARED_ADDR_UNSET);

  // ─── Mint a fresh cat via the existing helper ───
  const fresh = await cat21walletMintAtRate({
    rate: 5,
    scenarioLabel: 'transfer-mint',
  });
  const freshTxid = fresh.broadcastTxid;
  console.log(`[transfer-flow] minted fresh cat, txid = ${freshTxid}`);

  // Confirm the mint's vout[0] shape is what we expect.
  const freshRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', freshTxid, '2')
  ) as {
    vout: Array<{ value: number; scriptPubKey: { hex: string; address?: string } }>;
  };
  expect(Math.round(freshRaw.vout[0].value * 1e8)).toBe(546);
  const catAddressBefore = freshRaw.vout[0].scriptPubKey.address!;
  console.log(`[transfer-flow] cat currently at ${catAddressBefore}`);

  // ─── Fresh recipient (regtest taproot) for the transfer ───
  const recipientAddress = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32m').trim();
  expect(recipientAddress).toMatch(/^bcrt1p/);
  console.log(`[transfer-flow] transfer target = ${recipientAddress}`);

  // ─── Navigate to /dashboard/transfer with the outpoint override ───
  const transferUrl = new URL(`${FRONTEND_URL}/dashboard/transfer`);
  transferUrl.searchParams.set('catTxid', freshTxid);
  transferUrl.searchParams.set('catVout', '0');

  const page = await context.newPage();
  // Capture the browser console so the SDK's cat21-transfer-sim-error
  // log surfaces here — the orchestrator's catch clause console.errors
  // the underlying throw before returning insufficient=true.
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('cat21-transfer-sim') || msg.type() === 'error') {
      // eslint-disable-next-line no-console
      console.log(`[browser-${msg.type()}] ${text}`);
    }
  });
  await page.goto(transferUrl.toString(), { waitUntil: 'domcontentloaded' });

  // The Cat21TransferOrchestrator is providedIn: 'root' and its
  // fundingUtxos$ pipeline uses shareReplay({ refCount: true }). It
  // ref-count-resubscribes on component creation, which fires a fresh
  // getUtxos, BUT electrs's per-address UTXO index lags the block-tip
  // ingest — the just-minted change output may not be indexed at the
  // exact moment the orchestrator fetches. Reload so the fetch runs
  // once more, this time with a real chance electrs has caught up.
  // Same pattern as the mint round-trip test.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await shot(page, 'transfer-01-loaded');

  // ─── Type the recipient + set a fee rate ───
  const recipientInput = page.getByTestId('transfer-recipient-input');
  await expect(recipientInput).toBeVisible();
  await recipientInput.fill(recipientAddress);
  // The recipient invalid-hint must NOT be visible for regtest bech32m —
  // proves the injected bitcoinNetwork wired through to the address
  // validator (transfer.ts previously hard-coded Network.Mainnet).
  await expect(page.getByTestId('transfer-recipient-invalid')).toHaveCount(0);

  const manualInput = page.getByTestId('fees-picker-manual-input');
  await manualInput.fill('1');
  await manualInput.press('Tab');

  // ─── Wait for the Transfer button to enable + click ───
  const transferBtn = page.getByTestId('transfer-cta');
  await expect(transferBtn).toBeVisible();

  // A disabled button names WHICH signal holds it (state / catUtxo /
  // recipient / fee / simulation) through transfer.html's
  // data-testid="transfer-debug-state" marker, logged before the rethrow.
  try {
    await expect(transferBtn).toBeEnabled();
  } catch (err) {
    console.log('[transfer-flow] button-disabled state =', await transferDebugState(page));
    throw err;
  }
  await shot(page, 'transfer-02-ready');

  // cat21-wallet signs the transfer's cat + funding inputs inside ONE
  // approval popup (signAtIndex-array RPC shape, ordpool-sdk 65b1b00).
  const knownBeforeSign = new Set(context.pages());
  await transferBtn.click();
  await approveCat21WalletSignPopup({ context, knownPages: knownBeforeSign });

  // ─── Success card + broadcast txid ───
  const successCard = page.getByTestId('transfer-success');
  try {
    await expect(successCard).toBeVisible();
  } catch (err) {
    await shot(page, 'transfer-04-post-sign-failure');
    console.log('[transfer-flow] post-sign state =', await transferDebugState(page));
    throw err;
  }
  await shot(page, 'transfer-04-success');
  const successHref = await successCard.locator('a').first().getAttribute('href');
  const transferTxidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(transferTxidMatch).not.toBeNull();
  const transferTxid = transferTxidMatch![1];
  console.log(`[transfer-flow] transfer tx = ${transferTxid}`);

  // ─── On-chain verification ───
  mineBlocks(1);
  const transferTx = await waitForTxConfirmed(transferTxid);
  // Regression guard for cat21-wallet's HARD RULE #1 + the SDK's
  // `cat21-transfer.helper.ts` builder invariant (throws if
  // `lockTime !== 21`). Not a protocol requirement — a third-party
  // wallet transferring the same cat with `locktime=0` still moves
  // the cat via sat-tracking; only the SDK/wallet's bonus mint is
  // lost. See workspace HQ HARD RULE "nLockTime=21 is PROTOCOL for
  // MINT, CONVENTION for everything else".
  expect(transferTx.locktime).toBe(21);
  expect(transferTx.vout.length).toBeGreaterThanOrEqual(1);

  // vout[0] must be the cat at the new recipient (ord-theory FIFO: cat
  // rides input 0's first sat into output 0's first sat).
  const transferRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', transferTxid, '2')
  ) as {
    vout: Array<{ value: number; scriptPubKey: { address?: string } }>;
  };
  expect(Math.round(transferRaw.vout[0].value * 1e8)).toBe(546);
  expect(transferRaw.vout[0].scriptPubKey.address).toBe(recipientAddress);
  console.log(`[transfer-flow] cat moved from ${catAddressBefore} → ${recipientAddress}, 546 sats intact`);

  await page.close();
});


// ============================================================
// PICKER-driven transfer round-trip: the ord-driven holdings
// picker, proven against the REAL cat21-ord index.
//
// The URL-override test above exercises the ?catTxid deep-link (a
// shipping feature). This test exercises the OTHER path — the one
// every ordinary user takes: no URL params, the picker fetches the
// connected wallet's cats from cat21-ord (/address → per-cat
// /inscription satpoint expansion via CatUtxoLookupService.
// getMyHoldings) and the user selects their cat from the dropdown.
// Requires cat21-ord in the e2e stack (bootstrap --with-cat21-ord)
// and environment.ordExplorer patched to the local instance.
// ============================================================

test('picker transfer round-trip: fresh mint → cat21-ord indexes it → holdings picker lists it → transfer via picker selection', async () => {
  if (!sharedPaymentAddress) throw new Error(SHARED_ADDR_UNSET);

  // ─── Mint a fresh cat + let cat21-ord index it ───
  const fresh = await cat21walletMintAtRate({
    rate: 5,
    scenarioLabel: 'picker-transfer-mint',
  });
  const freshTxid = fresh.broadcastTxid;
  const freshInscriptionId = `${freshTxid}i0`;
  console.log(`[picker-transfer] minted fresh cat, txid = ${freshTxid}`);
  const tip = mineBlocks(1);
  await waitForElectrsSync(tip);
  await waitForOrdSync(tip);

  const recipientAddress = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32m').trim();
  expect(recipientAddress).toMatch(/^bcrt1p/);

  // ─── Navigate WITHOUT any URL override — the picker must do the work ───
  const page = await context.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('cat21-transfer-sim') || msg.type() === 'error') {
      console.log(`[browser-${msg.type()}] ${text}`);
    }
  });
  await page.goto(`${FRONTEND_URL}/dashboard/transfer`, { waitUntil: 'domcontentloaded' });
  await shot(page, 'picker-transfer-01-loaded');

  // ─── The REAL picker: cat21-ord listed the wallet's cats ───
  const picker = page.getByTestId('transfer-cat-picker');
  await expect(picker).toBeVisible();
  // The freshly minted cat appears as an option keyed by its
  // inscription id — value fetched from cat21-ord, not from any URL.
  await expect(picker.locator(`option[value="${freshInscriptionId}"]`)).toHaveCount(1);
  await picker.selectOption(freshInscriptionId);

  // Satpoint expansion proof: the detail line shows the cat's CURRENT
  // outpoint as resolved via cat21-ord's /inscription satpoint.
  const detail = page.getByTestId('transfer-cat-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(`${freshTxid}:0`);
  await shot(page, 'picker-transfer-02-picked');

  // ─── Recipient + fee ───
  const recipientInput = page.getByTestId('transfer-recipient-input');
  await expect(recipientInput).toBeVisible();
  await recipientInput.fill(recipientAddress);
  await expect(page.getByTestId('transfer-recipient-invalid')).toHaveCount(0);
  const manualInput = page.getByTestId('fees-picker-manual-input');
  await manualInput.fill('1');
  await manualInput.press('Tab');

  const transferBtn = page.getByTestId('transfer-cta');
  await expect(transferBtn).toBeVisible();
  await expect(transferBtn).toBeEnabled();
  await shot(page, 'picker-transfer-03-ready');

  // ─── Sign in the wallet popup(s) ───
  const knownBeforeSign = new Set(context.pages());
  await transferBtn.click();
  await approveCat21WalletSignPopup({ context, knownPages: knownBeforeSign });

  // ─── Success + on-chain verification ───
  const successCard = page.getByTestId('transfer-success');
  await expect(successCard).toBeVisible();
  const successHref = await successCard.locator('a').first().getAttribute('href');
  const transferTxid = successHref!.match(/\/tx\/([0-9a-f]{64})/)![1];
  console.log(`[picker-transfer] transfer tx = ${transferTxid}`);

  mineBlocks(1);
  const transferTx = await waitForTxConfirmed(transferTxid);
  // Regression guard: SDK builder invariant (cat21-transfer.helper.ts
  // throws if lockTime !== 21). Not a protocol requirement on a
  // transfer — the cat moves by sat-tracking regardless.
  expect(transferTx.locktime).toBe(21);
  const transferRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', transferTxid, '2')
  ) as {
    vout: Array<{ value: number; scriptPubKey: { address?: string } }>;
  };
  expect(Math.round(transferRaw.vout[0].value * 1e8)).toBe(546);
  expect(transferRaw.vout[0].scriptPubKey.address).toBe(recipientAddress);

  // The index agrees: cat21-ord now reports the cat at the recipient.
  const newTip = mineBlocks(1);
  await waitForOrdSync(newTip);
  const ordView = await fetch(`${CAT21_ORD_URL}/inscription/${freshInscriptionId}`, {
    headers: { Accept: 'application/json' },
  }).then(r => r.json()) as { address?: string; satpoint?: string };
  expect(ordView.address).toBe(recipientAddress);
  expect(ordView.satpoint).toBe(`${transferTxid}:0:0`);
  console.log(`[picker-transfer] cat21-ord confirms the cat at ${recipientAddress} (${transferTxid}:0:0)`);

  await page.close();
});


// ============================================================
// Full BID MARKETPLACE round-trip (X.7):
//
//   mint fresh cat →
//   buyer synthesizes keys, funds, builds+signs offer PSBT →
//   POST /api/v1/bids → backend validates real bytes against real ord →
//   GET /api/v1/bids/outpoint/:txid/:vout → retrieved bytes byte-equal what
//     the buyer posted →
//   seller navigates to /dashboard/trade/accept with the retrieved PSBT +
//     the cat outpoint pre-filled →
//   cat21-wallet signs input 0 → cat21.space broadcasts →
//   on-chain assertions: cat moved to buyer's ordinals address, seller
//     paid the exact bid amount.
//
// This proves the marketplace ISN'T a mock — the backend accepts a real
// buyer-signed PSBT, indexes it against real ord + electrs, hands it back
// bytewise, and the seller-side signing+broadcast path settles on-chain.
// If any component (validator, PSBT round-trip, ord check, accept-page
// pre-fill) drops or mutates a byte, the seller's signed tx would be
// malformed and the broadcast would reject.
// ============================================================
test('bid marketplace round-trip: buyer POSTs → GET returns byte-equal PSBT → seller accepts via UI → cat moves on-chain', async () => {
  if (!sharedPaymentAddress) throw new Error(SHARED_ADDR_UNSET);

  // ─── Step 1: Fresh mint so we don't fight the earlier offer test
  //             for the shared cat UTXO. cat21walletMintAtRate drives
  //             the mint UI end-to-end and returns the broadcast txid. ───
  const { broadcastTxid: freshMintTxid } = await cat21walletMintAtRate({
    rate: 20,
    scenarioLabel: 'bid-marketplace',
  });
  console.log(`[bid-mkt] fresh mint txid = ${freshMintTxid}`);

  // ─── Step 2: Read the mint tx → get seller cat outpoint bytes. ───
  const mintTxJson = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', freshMintTxid, '2')
  ) as {
    vout: Array<{ value: number; n: number; scriptPubKey: { hex: string; address?: string } }>;
  };
  const catOut = mintTxJson.vout[0];
  const sellerCatScriptHex = catOut.scriptPubKey.hex;
  const sellerCatValue = Math.round(catOut.value * 1e8);
  expect(sellerCatValue).toBe(546);

  // ─── Step 2b: cat21-ord indexes the fresh cat. The backend's bid
  //             validator reads the same index at POST, so the cat number
  //             here is the one it checks the bid's bundle against. ───
  await waitForOrdSync(Number(rpc('getblockcount').trim()));
  const freshCatNumber = (await getOrdInscription(catInscriptionId(freshMintTxid))).number;
  console.log(`[bid-mkt] cat21-ord indexed cat #${freshCatNumber} at ${freshMintTxid}:0`);

  // ─── Step 3: Synthesize buyer via bitcoin-cli's ordpool-e2e wallet
  //             (separate P2WPKH/P2TR addresses = separate roles). ───
  const BID_PRICE_SATS = 25000;
  const BID_FEE_SATS = 2000;
  const buyerPaymentAddress = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32').trim();
  const buyerReceiveAddress = rpc('-rpcwallet=ordpool-e2e', 'getnewaddress', '', 'bech32m').trim();
  // Change re-uses the payment address so the DTO's `buyerPaymentAddress`
  // matches PSBT output 2. A real wallet would use a fresh internal
  // address and add a separate DTO field; for this round-trip the shape
  // the marketplace ships today is one buyer address for both funding
  // and change.
  const buyerChangeAddress = buyerPaymentAddress;
  expect(buyerReceiveAddress).toMatch(/^bcrt1p/);

  // Fund the buyer with enough for price + fee + change dust.
  const buyerFundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', buyerPaymentAddress, '0.001').trim();
  await waitForElectrsSync(mineBlocks(1));

  const buyerFundRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', buyerFundTxid, '2')
  ) as {
    vout: Array<{ value: number; n: number; scriptPubKey: { hex: string; address?: string } }>;
  };
  const buyerVoutIdx = buyerFundRaw.vout.findIndex((v) => v.scriptPubKey.address === buyerPaymentAddress);
  expect(buyerVoutIdx).toBeGreaterThanOrEqual(0);
  const buyerVout = buyerFundRaw.vout[buyerVoutIdx];
  const buyerInputValueSats = Math.round(buyerVout.value * 1e8);
  console.log(`[bid-mkt] buyer funded UTXO ${buyerFundTxid}:${buyerVoutIdx} → ${buyerInputValueSats} sats`);

  // ─── Step 4: Buyer builds the offer PSBT via SDK. ───
  const built = sdkCore.buildCat21BuyOfferPsbt({
    network: sdkCore.Network.Regtest,
    sellerInput: {
      txid: freshMintTxid,
      vout: 0,
      value: sellerCatValue,
      scriptPubKey: hexDecode(sellerCatScriptHex),
    },
    buyerInputs: [
      {
        txid: buyerFundTxid,
        vout: buyerVoutIdx,
        value: buyerInputValueSats,
        scriptPubKey: hexDecode(buyerVout.scriptPubKey.hex),
      },
    ],
    destinations: {
      buyerReceiveAddress,
      sellerPaymentAddress: sharedPaymentAddress,
      buyerChangeAddress,
    },
    priceSats: BID_PRICE_SATS,
    feeSats: BID_FEE_SATS,
  });

  const unsignedOfferBase64 = b64(built.psbt);

  // ─── Step 5: Buyer signs their inputs via bitcoin-cli
  //             (finalize=false → input 0 stays unsigned for seller). ───
  const walletprocessed = JSON.parse(
    rpc(
      '-rpcwallet=ordpool-e2e',
      '-named',
      'walletprocesspsbt',
      `psbt=${unsignedOfferBase64}`,
      'sign=true',
      'finalize=false',
    )
  ) as { psbt: string; complete: boolean };
  const buyerSignedBase64 = walletprocessed.psbt;
  console.log(`[bid-mkt] buyer-signed PSBT length = ${buyerSignedBase64.length}`);

  // ─── Step 6: The bid DTO wants (a) the cats bundle at the outpoint,
  //             (b) the headline cat number. cat21-ord's /output lists the
  //             cats on the outpoint as inscription ids; the bundle carries
  //             their numbers. /output and /inscription are two reads of the
  //             index, so a getCatsAtOutput regression to a wrong outpoint or
  //             a bad parse makes them disagree here and at the backend. ───
  const ordOutputRes = await fetch(`${CAT21_ORD_URL}/output/${freshMintTxid}:0`, {
    headers: { Accept: 'application/json' },
  });
  expect(ordOutputRes.ok, `cat21-ord /output must respond OK, got ${ordOutputRes.status}`).toBe(true);
  const ordOutput = await ordOutputRes.json() as { cats: string[] };
  expect(ordOutput.cats).toEqual([catInscriptionId(freshMintTxid)]);
  const cats = [freshCatNumber];
  const headlineCatNumber = freshCatNumber;
  console.log(`[bid-mkt] cats on UTXO = [${cats.join(',')}], headline = #${headlineCatNumber}`);

  // ─── Step 7: POST /api/v1/bids ───
  //
  // The same backend cat21.space's Angular env points at.
  const bidsUrl = INDEXER_URL;
  const bidBody = {
    network: 'regtest',
    catTxid: freshMintTxid,
    catVout: 0,
    cats,
    headlineCatNumber,
    bidSats: BID_PRICE_SATS,
    buyerOrdinalsAddress: buyerReceiveAddress,
    buyerPaymentAddress: buyerPaymentAddress,
    sellerPaymentAddress: sharedPaymentAddress,
    psbtBase64: buyerSignedBase64,
  };
  const postRes = await fetch(`${bidsUrl}/api/v1/bids`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bidBody),
  });
  const postText = await postRes.text();
  expect(postRes.status, `POST /api/v1/bids should be 201, got ${postRes.status}: ${postText}`).toBe(201);
  const persistedBid = JSON.parse(postText) as { id: string; bidSats: number; psbtBase64: string };
  expect(persistedBid.bidSats).toBe(BID_PRICE_SATS);
  console.log(`[bid-mkt] backend accepted bid id=${persistedBid.id}`);

  // ─── Step 8: GET the bid back, verify the PSBT is byte-for-byte
  //             what we posted (no re-encoding, no truncation, no
  //             signature drop). ───
  const getRes = await fetch(`${bidsUrl}/api/v1/bids/outpoint/${freshMintTxid}/0`);
  expect(getRes.status).toBe(200);
  const bidsList = await getRes.json() as Array<{ psbtBase64: string; bidSats: number; buyerOrdinalsAddress: string }>;
  expect(bidsList.length).toBeGreaterThanOrEqual(1);
  const ourBid = bidsList.find((b) => b.buyerOrdinalsAddress === buyerReceiveAddress);
  expect(ourBid, 'the bid we posted must appear in the outpoint feed').toBeTruthy();
  expect(ourBid!.psbtBase64, 'GET must return byte-identical PSBT to what was POSTed').toBe(buyerSignedBase64);
  expect(ourBid!.bidSats).toBe(BID_PRICE_SATS);
  console.log('[bid-mkt] GET returned byte-identical PSBT');

  // ─── Step 9: Seller opens the accept-offer page with the retrieved
  //             PSBT + cat outpoint pre-filled — SAME shape the Details
  //             page's "Accept" button uses via buildAcceptOfferQueryParams. ───
  const acceptUrl = new URL(`${FRONTEND_URL}/dashboard/trade/accept`);
  acceptUrl.searchParams.set('offer', ourBid!.psbtBase64);
  acceptUrl.searchParams.set('catTxid', freshMintTxid);
  acceptUrl.searchParams.set('catVout', '0');

  const page = await context.newPage();
  await page.goto(acceptUrl.toString(), { waitUntil: 'domcontentloaded' });
  await shot(page, 'bid-mkt-01-accept-loaded');

  // The URL committed the cat outpoint; accept-offer page shows the
  // "pre-selected from the buyer's link" hint.
  const catFromUrlHint = page.getByTestId('accept-offer-cat-from-url');
  await expect(catFromUrlHint).toBeVisible();
  await expect(catFromUrlHint).toContainText(freshMintTxid);

  const acceptBtn = page.getByTestId('accept-offer-sign-cta');
  await expect(acceptBtn).toBeVisible();
  await expect(acceptBtn).toBeEnabled();
  await shot(page, 'bid-mkt-02-accept-ready');

  // ─── Step 10: Click Accept → cat21-wallet sign popup → sign. ───
  const knownBeforeSign = new Set(context.pages());
  await acceptBtn.click();
  await approveCat21WalletSignPopup({
    context,
    knownPages: knownBeforeSign,
    screenshot: async (p) => { await shot(p, 'bid-mkt-03-sign-approval'); },
  });

  // ─── Step 11: Success surfaces. Extract the broadcast txid. ───
  const successCard = page.getByTestId('accept-offer-success');
  await expect(successCard).toBeVisible();
  await shot(page, 'bid-mkt-04-success');
  const successLink = successCard.locator('a').first();
  const successHref = await successLink.getAttribute('href');
  const successTxidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(successTxidMatch).not.toBeNull();
  const settleTxid = successTxidMatch![1];
  console.log(`[bid-mkt] settlement txid = ${settleTxid}`);

  // ─── Step 12: On-chain verification. Mine + read + assert. ───
  mineBlocks(1);
  const settleTx = await waitForTxConfirmed(settleTxid);
  // Regression guard for the SDK's builder invariant (same as the
  // offer round-trip above): `cat21-offer.helper.ts` throws if
  // `lockTime !== 21` at build time. Not a protocol requirement — a
  // regression that produced `locktime=0` still delivers the cat via
  // sat-tracking; only the SDK's bonus mint is lost. See workspace HQ
  // HARD RULE "nLockTime=21 is PROTOCOL for MINT, CONVENTION for
  // everything else".
  expect(settleTx.locktime).toBe(21);
  expect(settleTx.vout.length).toBeGreaterThanOrEqual(2);

  const settleRaw = JSON.parse(
    rpc('-rpcwallet=ordpool-e2e', 'getrawtransaction', settleTxid, '2')
  ) as {
    vout: Array<{ value: number; scriptPubKey: { address?: string } }>;
  };
  // Output 0: cat @ buyer's ordinals address, 546 sats postage.
  expect(Math.round(settleRaw.vout[0].value * 1e8)).toBe(546);
  expect(settleRaw.vout[0].scriptPubKey.address).toBe(buyerReceiveAddress);
  // Output 1: seller payment = bidSats + postage (ord-parity, seller
  // made whole on postage). Address is the seller's paymentAddress
  // that the buyer baked into the PSBT.
  expect(Math.round(settleRaw.vout[1].value * 1e8)).toBe(BID_PRICE_SATS + 546);
  expect(settleRaw.vout[1].scriptPubKey.address).toBe(sharedPaymentAddress);
  console.log(`[bid-mkt] on-chain: cat @ ${buyerReceiveAddress}, seller paid ${BID_PRICE_SATS + 546} sats @ ${sharedPaymentAddress}`);

  await page.close();
});
