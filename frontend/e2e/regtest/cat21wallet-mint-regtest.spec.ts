/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  getUtxos,
  waitForElectrsSync,
  waitForUtxoAt,
  rpc,
  mineBlocks,
  getTx,
} from './sdk-lib/regtest-helpers';
import { waitForApprovalPopup } from './sdk-lib/approval-popup';
import { installContextErrorGuard } from './lib/browser-error-guard';

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
 *   - CAT-21 wallet's `getAddresses` returns MAINNET addresses
 *     regardless of the dapp's Network.Regtest request, so the
 *     full mint round-trip needs SDK-level regtest-derivation
 *     plumbing that doesn't exist in the consumer flow yet. We
 *     stop at "connected wallet" here; the full mint round-trip
 *     is a follow-up iteration.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4221';
const MINT_PATH = '/dashboard/mint';

/**
 * Note on `.catch(() => undefined | null)` usage below:
 *
 * E2E_BEST_PRACTICES.md rule 8 bans SILENT ASSERTION FAILURES like
 * `.textContent().catch(() => '')` on a stable test-id — that shape
 * would return the sentinel string and hide a stale-testid regression.
 *
 * The catches in this spec are structurally different:
 *
 *   1. **Optional wallet-approval popups.** Some wallet approvals only
 *      fire on cold starts, or after a page reload, or per-wallet.
 *      `waitForApprovalPopup(...).catch(() => null)` + `if (popup)` is
 *      the intended shape — "if the wallet asked to reapprove, click
 *      through; otherwise proceed". Not an assertion, not silent.
 *
 *   2. **Failure-path diagnostics.** When a test's happy path throws,
 *      the `catch (err)` block collects `getByTestId(...).textContent()
 *      .catch(() => null)` / `.getAttribute(...).catch(() => null)`
 *      to log debug state BEFORE `throw err`. Masking these secondary
 *      accessors with `catch` prevents them from replacing the
 *      original failure with a rendering-race noise-error.
 *
 *   3. **Cleanup in `finally`.** `page.close().catch(() => undefined)`
 *      / `fetch('/admin/fees/reset').catch(() => undefined)` at the
 *      end of a test can't be allowed to blow up and hide the actual
 *      assertion outcome.
 */

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_PASSWORD = 'correct-horse-battery-staple-Tr0ub4dor-9876';

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

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21wallet-mint-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

/**
 * Navigate to /dashboard/mint by clicking through the header nav (rule 4
 * of E2E_BEST_PRACTICES.md). Assumes the wallet is already connected —
 * the header only renders `nav-dashboard` for connected wallets. Every
 * test uses this helper; the connect flow itself lives in `beforeAll`.
 */
async function navigateViaHeaderToMint(page: Page): Promise<void> {
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('wallet-connected-btn').waitFor({ state: 'visible', timeout: 30_000 });
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
 * Hoisted out of test 1 into `beforeAll` per rule 1 — the previous
 * pattern (test 1 sets `sharedPaymentAddress`, tests 2-N `if
 * (!sharedPaymentAddress) throw 'first test must have set X'`) made
 * every downstream test order-coupled on test 1's success. beforeAll
 * runs before ANY test regardless of Playwright shard/retry order, so
 * shared state is now structurally guaranteed.
 */
async function connectCat21WalletViaMintPage(page: Page): Promise<{ paymentAddress: string }> {
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const cta = page.getByTestId('mint-cta');
  await expect(cta).toBeVisible({ timeout: 30_000 });

  // Snapshot existing pages BEFORE the connect click. The Xverse spec
  // hit this race three times before the fix — CAT-21 wallet's approval
  // popup spawns synchronously the same way.
  const knownPagesBeforeConnect = new Set(context.pages());
  await page.getByTestId('wallet-connect-btn').first().click();

  // Picker modal — CAT-21 wallet sits in the "installed" section. The
  // card isn't a `<button>` element (clickable container), so
  // `getByRole('button', …)` doesn't find it. Match by visible text.
  const cat21Picker = page.getByText(/CAT-21\s+wallet/i).first();
  await expect(cat21Picker).toBeVisible({ timeout: 20_000 });
  await cat21Picker.click({ timeout: 20_000 });

  const approvalConnect = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeConnect,
    timeoutMs: 60_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByTestId('get-addresses-approve-button')
        .waitFor({ state: 'visible', timeout: 60_000 });
      return true;
    },
  });
  await approvalConnect.getByTestId('get-addresses-approve-button').click();
  // DO NOT explicitly `.close()` — cat21-wallet's userApprovesGetAddresses
  // runs a ~400 ms animation BEFORE sending addresses back. Manual close
  // cuts the dispatch (run 27502018547 trace.zip showed click→close = 44 ms).
  await approvalConnect.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);

  await expect(cta).toBeHidden({ timeout: 30_000 });

  // Path-1 proof: payment address is REGTEST bcrt1q. Extract from the
  // wallet-connect popover in the header, NOT from mint-no-utxos. On
  // beforeAll re-runs (Playwright restarts the worker after certain
  // test failures), the same mnemonic derives the same address; if a
  // previous test already funded it, mint-found-funds shows instead
  // of mint-no-utxos and the payment-code element isn't there. The
  // header popover is stable regardless of mint-page state.
  //
  // CAT-21 wallet's getAddresses honors the `network` param (SDK
  // connector maps Network.Regtest → 'devnet'), so the returned
  // paymentAddr must start with bcrt1q.
  await page.getByTestId('wallet-connected-btn').click();
  const paymentAddrEl = page.getByTestId('wallet-payment-address-full');
  await expect(paymentAddrEl).toBeAttached({ timeout: 15_000 });
  const paymentAddr = (await paymentAddrEl.textContent())!.trim();
  expect(paymentAddr).toMatch(/^bcrt1q/);
  return { paymentAddress: paymentAddr };
}

/**
 * Approval-popup Sign/Confirm/Approve click.
 *
 * `{ noWaitAfter: true }` — cat21-wallet self-closes its sign-psbt
 * popup the moment the confirm dispatch reaches the service worker.
 * Playwright's default click awaits post-click stability; that race
 * surfaces as "Target page, context or browser has been closed"
 * when the popup tears down mid-click. The close IS the success
 * signal, so we don't wait for stability. Same pattern as the SDK's
 * `approveCat21WalletSignPopup` helper (`ordpool-sdk/e2e/playwright/
 * cat21wallet-sign-popup.ts`) — the two are semantically identical.
 */
async function clickApprovalButton(popup: Page): Promise<void> {
  const btn = popup.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click({ noWaitAfter: true, timeout: 30_000 });
}

async function onboardCat21Wallet(page: Page): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/index.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sign-in-link')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('sign-in-link').click();

  const inputs = page.locator('input[type="text"], input[type="password"]');
  await expect(inputs.first()).toBeVisible({ timeout: 15_000 });
  const words = TEST_MNEMONIC.split(' ');
  for (let i = 0; i < 12; i++) {
    await inputs.nth(i).fill(words[i]);
  }
  await page.getByRole('button', { name: /continue|sign in|restore|confirm/i }).first().click();

  const pwInput = page.getByTestId('set-or-enter-password-input');
  await expect(pwInput).toBeVisible({ timeout: 15_000 });
  await pwInput.click();
  await pwInput.pressSequentially(TEST_PASSWORD, { delay: 15 });
  await page.getByTestId('set-password-btn').click();

  await page.waitForFunction(() => {
    const t = (document.body.innerText || '').toLowerCase();
    return t.includes('send') || t.includes('receive') || t.includes('balance') || t.includes('bitcoin');
  }, undefined, { timeout: 30_000, polling: 250 });
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`CAT-21 wallet extension not unpacked at ${EXT_PATH}.`);
  }

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

  // Auto-fail any test whose page emits an uncaught JS exception or
  // console.error. Hooks every page the context spawns via context.on
  // ('page'), so tests don't repeat the wiring at each newPage() site.
  // Ignores narrow, must-be-audited noise: browser-side network errors
  // to the mocked electrs endpoints during pre-serve wait windows.
  browserErrorGuard = installContextErrorGuard(context, {
    ignore: [
      // The frontend loads before the electrs stub is fully ready in
      // some race windows; the transient fetch errors are recovered
      // by the SDK's retry helpers and don't reflect a real bug.
      /ERR_CONNECTION_REFUSED/,
      /Failed to load resource/,
    ],
  });

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  extensionId = worker.url().split('/')[2];

  const primer = await context.newPage();
  await onboardCat21Wallet(primer);
  await shot(primer, '00-onboarded');
  await primer.close();

  // Connect the wallet ONCE for the whole suite (rule 1). Every test
  // reads sharedPaymentAddress from module scope; no ordering coupling
  // on "the first test connects".
  const connectPage = await context.newPage();
  const { paymentAddress } = await connectCat21WalletViaMintPage(connectPage);
  sharedPaymentAddress = paymentAddress;
  saveShared({ paymentAddress });
  await shot(connectPage, '00b-wallet-connected');
  await connectPage.close();
});

test.beforeEach(() => {
  browserErrorGuard?.resetPerTest();
});

test.afterEach(() => {
  browserErrorGuard?.assertClean();
});

test.afterAll(async () => {
  await context?.close();
});

test('cat21-wallet mint round-trip end-to-end (RBF-signaling sequence pinned)', { timeout: 180_000 }, async () => {
  // Connect flow already ran in beforeAll; sharedPaymentAddress is set.
  if (!sharedPaymentAddress) throw new Error('beforeAll must have set sharedPaymentAddress');
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
  const knownBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeReload,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }
  await shot(page, '05-after-fund-reload');

  // Wait for found-funds, set fee, click Mint.
  const foundFunds = page.getByTestId('mint-found-funds');
  await expect(foundFunds).toBeVisible({ timeout: 90_000 });
  const manualInput = page.getByTestId('fees-picker-manual-input');
  await manualInput.fill('1');
  await manualInput.press('Tab');
  const mintBtn = page.getByTestId('mint-btn');
  await expect(mintBtn).toBeEnabled({ timeout: 30_000 });
  await shot(page, '06-ready-to-mint');

  const knownBeforeSign = new Set(context.pages());
  await mintBtn.click();
  const approvalSign = await waitForApprovalPopup({
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
  await shot(approvalSign, '07-sign-approval');
  await clickApprovalButton(approvalSign);
  await approvalSign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

  const successCard = page.getByTestId('mint-success');
  await expect(successCard).toBeVisible({ timeout: 90_000 });
  await shot(page, '08-success');
  const successHref = await successCard.locator('a').first().getAttribute('href');
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[cat21wallet] mint txid = ${broadcastTxid}`);
  // Hoist for the later full-offer-round-trip test.
  sharedMintTxid = broadcastTxid;
  saveShared({ mintTxid: broadcastTxid });

  const confirmedTip = mineBlocks(1);
  await waitForElectrsSync(confirmedTip);
  // Electrs indexes the block header before the per-tx status
  // sometimes; poll /tx/<txid> until status.block_hash is populated.
  let esploraTx = await getTx(broadcastTxid);
  const blockHashDeadline = Date.now() + 30_000;
  while (!esploraTx.status.block_hash && Date.now() < blockHashDeadline) {
    await new Promise((r) => setTimeout(r, 500));
    esploraTx = await getTx(broadcastTxid);
  }
  expect(esploraTx.locktime).toBe(21);
  expect(esploraTx.status.block_hash).toBeTruthy();
  expect(esploraTx.vout.length).toBeGreaterThanOrEqual(1);
  expect(esploraTx.vout[0].value).toBe(546);
  // CAT-21 wallet RBF policy: input sequence == 0xfffffffd.
  // The ONE exception to the Xverse spec's ≥0xfffffffe rule.
  expect(esploraTx.vin.length).toBeGreaterThan(0);
  for (const vin of esploraTx.vin) {
    expect(vin.sequence).toBe(0xfffffffd);
  }
});

const HIGH_FEES_PRESET = {
  fastestFee: 100,
  halfHourFee: 60,
  hourFee: 30,
  economyFee: 20,
  minimumFee: 10,
};

async function cat21walletMintAtRate(opts: {
  rate: number;
  scenarioLabel: string;
  mockFeesAsHigh?: boolean;
}): Promise<{ broadcastTxid: string; fee: number; vsize: number; rate: number }> {
  if (!sharedPaymentAddress) throw new Error('beforeAll must have set sharedPaymentAddress');

  if (opts.mockFeesAsHigh) {
    const res = await fetch('http://localhost:8999/admin/fees', {
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
    const known = new Set(context.pages());
    const reapprove = await waitForApprovalPopup({
      context,
      knownPages: known,
      timeoutMs: 6_000,
      isApproval: async (p) => p.url().startsWith('chrome-extension://'),
    }).catch(() => null);
    if (reapprove) {
      await reapprove.getByTestId('get-addresses-approve-button')
        .click({ timeout: 10_000 }).catch(() => undefined);
      await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
    }

    if (opts.mockFeesAsHigh) {
      const buttons = page.locator('[data-testid^="fees-picker-tier-"]');
      await expect(buttons).toHaveCount(4, { timeout: 30_000 });
      await expect(buttons.nth(0)).toContainText('100', { timeout: 10_000 });
    }

    const manualInput = page.getByTestId('fees-picker-manual-input');
    await manualInput.fill(String(opts.rate));
    await manualInput.press('Tab');
    const foundFunds = page.getByTestId('mint-found-funds');
    await expect(foundFunds).toBeVisible({ timeout: 90_000 });
    const mintBtn = page.getByTestId('mint-btn');
    await expect(mintBtn).toBeEnabled({ timeout: 30_000 });

    const knownSign = new Set(context.pages());
    await mintBtn.click();
    const sign = await waitForApprovalPopup({
      context,
      knownPages: knownSign,
      timeoutMs: 120_000,
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
    const broadcastTxid = successHref!.match(/\/tx\/([0-9a-f]{64})/)![1];

    await waitForElectrsSync(mineBlocks(1));
    const tx = await getTx(broadcastTxid);
    expect(tx.locktime).toBe(21);
    expect(tx.vout[0].value).toBe(546);
    for (const vin of tx.vin) {
      expect(vin.sequence).toBe(0xfffffffd);
    }
    const vsize = Math.ceil(tx.weight / 4);
    const rate = tx.fee / vsize;
    console.log(`[${opts.scenarioLabel}] fee=${tx.fee} vsize=${vsize} rate=${rate.toFixed(3)} (target ${opts.rate})`);

    await page.close().catch(() => undefined);
    return { broadcastTxid, fee: tx.fee, vsize, rate };
  } finally {
    if (opts.mockFeesAsHigh) {
      await fetch('http://localhost:8999/admin/fees/reset', { method: 'POST' })
        .catch(() => undefined);
    }
  }
}

test('asset scanner: warned cat-bearing UTXO can be burned via "Use anyway" on CAT-21 wallet', async () => {
  if (!sharedPaymentAddress) throw new Error('beforeAll must have set sharedPaymentAddress');

  const SMALL_FUND_SATS = 15_000;
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, '0.00015').trim();
  await waitForElectrsSync(mineBlocks(1));
  let small: { txid: string; vout: number; value: number } | undefined;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    small = (await getUtxos(sharedPaymentAddress)).find(
      (u) => u.value === SMALL_FUND_SATS && u.txid === fundTxid,
    );
    if (small) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!small) throw new Error('could not find small UTXO');
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
          ? { inscriptions: [], runes: {}, cats: [0] }
          : { inscriptions: [], runes: {}, cats: [] },
      ),
    });
  });
  await navigateViaHeaderToMint(page);
  const known = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: known,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  // Expand picker if not auto-open.
  const pickerSummary = page.getByTestId('mint-expert-summary').first();
  await expect(pickerSummary).toBeVisible({ timeout: 60_000 });
  if ((await page.locator('details[data-testid="mint-expert"][open]').count()) === 0) {
    await pickerSummary.click();
  }

  // Asset row + override.
  const assetRow = page.getByTestId('mint-utxo-row-assets').filter({ hasText: catOutpoint }).first();
  await expect(assetRow).toBeVisible({ timeout: 45_000 });
  const overrideBtn = assetRow.locator('.mint-utxo-pick-override');
  await expect(overrideBtn).toBeVisible();
  await overrideBtn.click();

  const mintBtn = page.getByTestId('mint-btn');
  await expect(mintBtn).toBeEnabled({ timeout: 30_000 });
  const knownSign = new Set(context.pages());
  await mintBtn.click();
  const sign = await waitForApprovalPopup({
    context,
    knownPages: knownSign,
    timeoutMs: 120_000,
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
  const broadcastTxid = successHref!.match(/\/tx\/([0-9a-f]{64})/)![1];
  await waitForElectrsSync(mineBlocks(1));
  const tx = await getTx(broadcastTxid);
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

test('sign-popup cancel keeps state coherent on CAT-21 wallet', { timeout: 180_000 }, async () => {
  if (!sharedPaymentAddress) throw new Error('beforeAll must have set sharedPaymentAddress');
  rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, '0.0003');
  await waitForElectrsSync(mineBlocks(1));

  const page = await context.newPage();
  await navigateViaHeaderToMint(page);
  const known = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: known,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  const manualInput = page.getByTestId('fees-picker-manual-input');
  await manualInput.fill('1');
  await manualInput.press('Tab');
  const mintBtn = page.getByTestId('mint-btn');
  await expect(mintBtn).toBeEnabled({ timeout: 60_000 });

  const knownSign = new Set(context.pages());
  await mintBtn.click();
  const sign = await waitForApprovalPopup({
    context,
    knownPages: knownSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  // Catch any "page closed" race during the Deny click — the
  // popup may self-close from the click before Playwright's
  // click action completes. Ordpool run 27509961259 hit this.
  await sign.getByRole('button', { name: /^(deny|cancel|reject)$/i }).first()
    .click({ timeout: 10_000 }).catch(() => undefined);
  await sign.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);

  // Absence-of-event assertion: there is no positive signal for "no
  // success will EVER appear" — the orchestrator's late success would
  // fire async. Bounded 2s pause is a documented last-resort per
  // ~/Work/ordpool/E2E_BEST_PRACTICES.md §8.
  await page.waitForTimeout(2_000);
  await expect(page.getByTestId('mint-success')).toHaveCount(0);
});

test('broadcast failure surfaces as an error on CAT-21 wallet (not a fake success)', { timeout: 240_000 }, async () => {
  if (!sharedPaymentAddress) throw new Error('beforeAll must have set sharedPaymentAddress');
  rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, '0.0003');
  await waitForElectrsSync(mineBlocks(1));

  const page = await context.newPage();
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
  const known = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: known,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  const manualInput = page.getByTestId('fees-picker-manual-input');
  await manualInput.fill('1');
  await manualInput.press('Tab');
  const mintBtn = page.getByTestId('mint-btn');
  await expect(mintBtn).toBeEnabled({ timeout: 60_000 });

  const knownSign = new Set(context.pages());
  await mintBtn.click();
  const sign = await waitForApprovalPopup({
    context,
    knownPages: knownSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await clickApprovalButton(sign);
  await sign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

  const errorAlert = page.getByTestId('mint-error');
  await expect(errorAlert).toBeVisible({ timeout: 60_000 });
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
// The cat-detail flow depends on the cat21-indexer backend AND
// cat21-ord — neither runs in the regtest e2e stack. We `page.route`
// their responses with a synthesised cat #42 that the connected
// wallet "owns". This tests the UI plumbing (button states, modal,
// permalink, banners, prefills) without needing full infrastructure;
// the underlying orchestrator + PSBT logic is covered by the SDK's
// own regtest suite.
// ============================================================

const CAT_NUMBER_FOR_UI_TEST = 42;

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
  await expect(walletBtn).toBeVisible({ timeout: 30_000 });
  await walletBtn.click();
  // The popover renders a hidden span with the full address (the visible
  // <code> is truncated for humans; the testid split from
  // E2E_BEST_PRACTICES.md rule 12 lands the untruncated value on a
  // visually-hidden sibling for E2E consumption).
  const ordinalsCode = page.getByTestId('wallet-ordinals-address-full');
  await expect(ordinalsCode).toBeAttached({ timeout: 10_000 });
  const addr = (await ordinalsCode.textContent())?.trim();
  if (!addr) throw new Error('could not extract connected wallet ordinals address from popover');
  sellerOrdinalsAddress = addr;
  console.log(`[cat21wallet] connected wallet ordinals address = ${addr}`);
  await page.close();
  return addr;
}

/** Fake CatDto that satisfies the frontend's rendering requirements. */
function mockCatDto(catNumber: number): unknown {
  return {
    id: '00000000-0000-0000-0000-000000000042',
    catNumber,
    txHash: '0'.repeat(64),
    blockHash: '0'.repeat(64),
    blockHeight: 800000,
    mintedAt: '2024-01-01T00:00:00.000Z',
    mintedBy: null,
    fee: 1000,
    weight: 400,
    size: 200,
    feeRate: 10,
    sat: 1000000000,
    value: 546,
    category: 'sub1k',
    genesis: false,
    catColors: ['#FF9900'],
    gender: 'female',
    designIndex: 0,
    designPose: 'standing',
    designExpression: 'grumpy',
    designPattern: 'plain',
    designFacing: 'left',
    laserEyes: 'none',
    background: 'plain',
    backgroundColors: ['#000000'],
    crown: 'none',
    glasses: 'none',
    glassesColors: [],
    rarityBits: 5.0,
    rarityRank: 1,
    rarityCategoryTotal: 100,
  };
}

/**
 * Route interceptors for the cat detail flow. Mocks:
 *   - GET backend2.cat21.space/api/cat/:N   → synthesised cat #N owned by `owner`
 *   - GET backend2.cat21.space/api/status   → totalCats large enough that /cat/N is "synced"
 *   - GET ord.cat21.space/cat/:N            → { address: owner }
 * Everything else is left to hit its normal target (which in e2e is
 * either the fees-stub on :8999 or an unbound localhost port that
 * naturally fails — the tests don't depend on those calls).
 */
async function installCatDetailMocks(page: Page, catNumber: number, ownerAddress: string): Promise<void> {
  await page.route(new RegExp(`^https://backend2\\.cat21\\.space/api/cat/${catNumber}(\\?|$)`), (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(mockCatDto(catNumber)),
    });
  });
  await page.route(/^https:\/\/backend2\.cat21\.space\/api\/status(\?|$)/, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        totalCats: 1000,
        lastSyncedCatNumber: 1000,
        lastSyncTime: '2024-01-01T00:00:00.000Z',
      }),
    });
  });
  await page.route(new RegExp(`^https://ord\\.cat21\\.space/cat/${catNumber}(\\?|$)`), (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ address: ownerAddress }),
    });
  });
}

test('/cat/N: three action buttons + Sell modal generates the shareable permalink', { timeout: 120_000 }, async () => {
  const owner = await ensureSellerOrdinalsAddress();
  const N = CAT_NUMBER_FOR_UI_TEST;
  const page = await context.newPage();
  await installCatDetailMocks(page, N, owner);

  await page.goto(`${FRONTEND_URL}/cat/${N}`, { waitUntil: 'domcontentloaded' });
  await shot(page, 'detail-01-loaded');

  // The three buttons are always rendered; owner-side states are
  // Sell:enabled, Buy:disabled ('owns-it'), Send:enabled.
  const sellBtn = page.getByTestId('cat-action-sell');
  const buyBtn = page.getByTestId('cat-action-buy');
  const sendBtn = page.getByTestId('cat-action-send');
  await expect(sellBtn).toBeVisible({ timeout: 30_000 });
  await expect(buyBtn).toBeVisible();
  await expect(sendBtn).toBeVisible();

  await expect(sellBtn).toBeEnabled({ timeout: 15_000 });
  await expect(buyBtn).toBeDisabled();
  await expect(sendBtn).toBeEnabled();
  await expect(buyBtn).toHaveAttribute('title', /already own this cat/i);

  // Sell modal round-trip.
  await sellBtn.click();
  const askInput = page.getByTestId('sell-modal-ask-input');
  await expect(askInput).toBeVisible({ timeout: 10_000 });
  await askInput.fill('21000');

  const permalink = page.getByTestId('sell-modal-permalink');
  await expect(permalink).toBeVisible({ timeout: 5_000 });
  const url = await permalink.inputValue();
  expect(url).toContain(`/cat/${N}?ask=21000`);
  console.log(`[detail-flow] generated permalink = ${url}`);

  // Copy button flips to "Copied!" after clicking.
  const copyBtn = page.getByTestId('sell-modal-copy-permalink');
  await copyBtn.click();
  await expect(copyBtn).toContainText(/copied/i, { timeout: 3_000 });

  await shot(page, 'detail-02-modal-permalink');
  await page.close();
});

test('/cat/N?ask=X: owner-variant ask banner is visible on the seller\'s own link', async () => {
  const owner = await ensureSellerOrdinalsAddress();
  const N = CAT_NUMBER_FOR_UI_TEST;
  const page = await context.newPage();
  await installCatDetailMocks(page, N, owner);

  await page.goto(`${FRONTEND_URL}/cat/${N}?ask=21000`, { waitUntil: 'domcontentloaded' });
  const banner = page.getByTestId('ask-banner');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText(/your ask for this cat is 21000 sats/i);
  await shot(page, 'detail-03-ask-banner-owner');
  await page.close();
});

test('/dashboard/trade/make?catNumber=X&askPrice=Y&fromAsk=1: "responding to ask" banner surfaces prefill intent', { timeout: 60_000 }, async () => {
  const N = CAT_NUMBER_FOR_UI_TEST;
  const page = await context.newPage();

  await page.goto(
    `${FRONTEND_URL}/dashboard/trade/make?catNumber=${N}&askPrice=21000&fromAsk=1`,
    { waitUntil: 'domcontentloaded' },
  );

  // The prefill effect kicks off a cat-number lookup that will fail
  // against the unbound ord+esplora stubs in this e2e — that's fine.
  // The banner itself is driven purely off the URL query param and
  // is what we're pinning here.
  const banner = page.getByTestId('responding-to-ask-banner');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText(/responding to a seller's ask/i);
  await shot(page, 'detail-04-make-offer-prefill-banner');
  await page.close();
});

test('/dashboard/transfer?catNumber=X: page loads and the connected-wallet heading is visible', { timeout: 60_000 }, async () => {
  const N = CAT_NUMBER_FOR_UI_TEST;
  const page = await context.newPage();

  await page.goto(`${FRONTEND_URL}/dashboard/transfer?catNumber=${N}`, {
    waitUntil: 'domcontentloaded',
  });

  // The transfer page's heading is stable across wallet states.
  // The prefill's actual cat-selection effect needs `myHoldings` to
  // resolve from ord (unreachable here); the presence assertion
  // proves the page didn't crash on the new `input()` binding.
  const heading = page.getByRole('heading', { name: /transfer/i }).first();
  await expect(heading).toBeVisible({ timeout: 30_000 });
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

test('full offer round-trip: buyer builds+signs, seller countersigns, cat moves on-chain', { timeout: 240_000 }, async () => {
  if (!sharedMintTxid) throw new Error('mint test must have set sharedMintTxid');
  if (!sharedPaymentAddress) throw new Error('beforeAll must have set sharedPaymentAddress');

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
  const knownBeforeNavigate = new Set(context.pages());
  await page.goto(acceptUrl.toString(), { waitUntil: 'domcontentloaded' });

  // Handle any get-addresses reapproval popup the wallet may pop up
  // when the page loads (mirrors the pattern from the mint test).
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeNavigate,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }
  await shot(page, 'offer-01-accept-loaded');

  // The URL committed the cat outpoint; the accept-offer page shows
  // the "pre-selected from the buyer's link" hint.
  const catFromUrlHint = page.getByTestId('accept-offer-cat-from-url');
  await expect(catFromUrlHint).toBeVisible({ timeout: 30_000 });
  await expect(catFromUrlHint).toContainText(sharedMintTxid);

  // Accept button becomes enabled once the orchestrator's validator
  // resolves against the parsed offer + wallet.paymentAddress +
  // urlCatOutpoint. Wait for that ready state.
  const acceptBtn = page.getByTestId('accept-offer-sign-cta');
  await expect(acceptBtn).toBeVisible({ timeout: 30_000 });
  await expect(acceptBtn).toBeEnabled({ timeout: 30_000 });
  await shot(page, 'offer-02-accept-ready');

  // ─── Click Accept → cat21-wallet approval popup → sign ───
  const knownBeforeSign = new Set(context.pages());
  await acceptBtn.click();
  const approvalSign = await waitForApprovalPopup({
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
  await shot(approvalSign, 'offer-03-sign-approval');
  await clickApprovalButton(approvalSign);
  await approvalSign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

  // ─── Success surfaces + broadcast txid available ───
  const successCard = page.getByTestId('accept-offer-success');
  await expect(successCard).toBeVisible({ timeout: 90_000 });
  await shot(page, 'offer-04-success');
  const successLink = successCard.locator('a').first();
  const successHref = await successLink.getAttribute('href');
  const successTxidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(successTxidMatch).not.toBeNull();
  const settleTxid = successTxidMatch![1];
  console.log(`[offer-flow] settlement txid = ${settleTxid}`);

  // ─── On-chain verification ───
  await waitForElectrsSync(mineBlocks(1));
  const settleTx = await getTx(settleTxid);
  expect(settleTx.status.block_hash).toBeTruthy();
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

test('full transfer round-trip: fresh mint → transfer via URL → cat moves on-chain', { timeout: 240_000 }, async () => {
  if (!sharedPaymentAddress) throw new Error('beforeAll must have set sharedPaymentAddress');

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
  const knownBeforeNavigate = new Set(context.pages());
  await page.goto(transferUrl.toString(), { waitUntil: 'domcontentloaded' });

  // The wallet may pop up a get-addresses reapproval on a fresh page.
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeNavigate,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  // The Cat21TransferOrchestrator is providedIn: 'root' and its
  // fundingUtxos$ pipeline uses shareReplay({ refCount: true }). It
  // ref-count-resubscribes on component creation, which fires a fresh
  // getUtxos, BUT electrs's per-address UTXO index lags the block-tip
  // ingest — the just-minted change output may not be indexed at the
  // exact moment the orchestrator fetches. Reload so the fetch runs
  // once more, this time with a real chance electrs has caught up.
  // Same pattern as the mint round-trip test uses at line 213.
  const knownBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reapproveAfterReload = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeReload,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapproveAfterReload) {
    await reapproveAfterReload.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapproveAfterReload.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }
  await shot(page, 'transfer-01-loaded');

  // ─── Type the recipient + set a fee rate ───
  const recipientInput = page.getByTestId('transfer-recipient-input');
  await expect(recipientInput).toBeVisible({ timeout: 30_000 });
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
  await expect(transferBtn).toBeVisible({ timeout: 30_000 });

  // If the button doesn't enable in 60s, dump the debug-state marker
  // so we can attribute WHICH signal is failing (state / catUtxo /
  // recipient / fee / simulation). See transfer.html data-testid=
  // "transfer-debug-state".
  try {
    await expect(transferBtn).toBeEnabled({ timeout: 60_000 });
  } catch (err) {
    const debugState = page.getByTestId('transfer-debug-state');
    const attrs: Record<string, string | null> = {};
    for (const name of [
      'data-state', 'data-has-cat', 'data-has-recipient', 'data-fee',
      'data-sim-ready', 'data-sim-insufficient',
      'data-wallet-ord-address', 'data-wallet-pay-address', 'data-wallet-type',
    ]) {
      attrs[name] = await debugState.getAttribute(name).catch(() => null);
    }
    // eslint-disable-next-line no-console
    console.log('[transfer-flow] button-disabled debug state =', JSON.stringify(attrs));
    throw err;
  }
  await shot(page, 'transfer-02-ready');

  // cat21-wallet signs the transfer's cat + funding inputs inside a
  // SINGLE approval popup (signAtIndex-array RPC shape, ordpool-sdk
  // commit 65b1b00). The loop remains defensive so a future wallet
  // change to per-index popups still works — the second iteration
  // times out cleanly if no additional popup arrives.
  let knownBeforeSign = new Set(context.pages());
  await transferBtn.click();
  for (let i = 0; i < 2; i++) {
    const approvalSign = await waitForApprovalPopup({
      context,
      knownPages: knownBeforeSign,
      // First popup: 120s cushion for wallet unlock + PSBT parse. Any
      // second popup would fire immediately after the first closes;
      // a short 5s window catches it without adding dead time when
      // (as with today's cat21-wallet) the flow is single-popup.
      timeoutMs: i === 0 ? 120_000 : 5_000,
      isApproval: async (p) => {
        if (!p.url().startsWith('chrome-extension://')) return false;
        await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
          .waitFor({ state: 'visible', timeout: 60_000 });
        return true;
      },
    }).catch(() => null);
    if (!approvalSign) break; // no more popups — the sign flow chained into broadcast
    await shot(approvalSign, `transfer-03-sign-approval-${i + 1}`);
    await clickApprovalButton(approvalSign);
    await approvalSign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);
    knownBeforeSign = new Set(context.pages()); // arm the next iteration to see any NEW popup
  }

  // ─── Success card + broadcast txid ───
  const successCard = page.getByTestId('transfer-success');
  try {
    await expect(successCard).toBeVisible({ timeout: 90_000 });
  } catch (err) {
    // Surface any transfer-error text + debug-state attrs before rethrowing,
    // so the CI log attributes the failure without needing to open the
    // trace zip.
    await shot(page, 'transfer-04-post-sign-failure');
    const errText = await page.getByTestId('transfer-error').textContent().catch(() => null);
    // eslint-disable-next-line no-console
    console.log('[transfer-flow] post-sign transfer-error =', errText);
    const debugState = page.getByTestId('transfer-debug-state');
    const attrs: Record<string, string | null> = {};
    for (const name of ['data-state', 'data-sim-ready', 'data-sim-insufficient']) {
      attrs[name] = await debugState.getAttribute(name).catch(() => null);
    }
    // eslint-disable-next-line no-console
    console.log('[transfer-flow] post-sign debug-state =', JSON.stringify(attrs));
    throw err;
  }
  await shot(page, 'transfer-04-success');
  const successHref = await successCard.locator('a').first().getAttribute('href');
  const transferTxidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(transferTxidMatch).not.toBeNull();
  const transferTxid = transferTxidMatch![1];
  console.log(`[transfer-flow] transfer tx = ${transferTxid}`);

  // ─── On-chain verification ───
  await waitForElectrsSync(mineBlocks(1));
  const transferTx = await getTx(transferTxid);
  expect(transferTx.status.block_hash).toBeTruthy();
  // Every cat-touching tx we build carries nLockTime=21 (workspace HQ HARD RULE #1).
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
test('bid marketplace round-trip: buyer POSTs → GET returns byte-equal PSBT → seller accepts via UI → cat moves on-chain', { timeout: 360_000 }, async () => {
  if (!sharedPaymentAddress) throw new Error('beforeAll must have set sharedPaymentAddress');

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
  //             (b) the headline cat number. Fetch both from local ord. ───
  //
  // On regtest CI, the SDK's consumer-environment doesn't ship a real
  // ord instance — the workflow serves a `/output/*` stub via
  // `fees-electrs-stub.mjs` that returns a fixed `{cats: [0]}` body
  // for any outpoint. The backend's ord client is pointed at the same
  // stub via ORD_API_URL, so both this test and the backend's own
  // validator agree on the bundle. For local dev / a future full-ord
  // CI variant, ORD_API_URL just needs to point at a real ord — the
  // test flow is identical.
  const ordApiUrl = process.env.ORD_API_URL ?? 'http://localhost:8999';
  const ordOutputRes = await fetch(`${ordApiUrl}/output/${freshMintTxid}:0`, {
    headers: { Accept: 'application/json' },
  });
  expect(ordOutputRes.ok, `ord /output must respond OK, got ${ordOutputRes.status}`).toBe(true);
  const ordOutput = await ordOutputRes.json() as { cats: number[] };
  expect(Array.isArray(ordOutput.cats)).toBe(true);
  expect(ordOutput.cats.length).toBeGreaterThanOrEqual(1);
  const cats = [...new Set(ordOutput.cats)].sort((a, b) => a - b);
  const headlineCatNumber = cats[0];
  console.log(`[bid-mkt] cats on UTXO = [${cats.join(',')}], headline = #${headlineCatNumber}`);

  // ─── Step 7: POST /api/v1/bids ───
  //
  // Backend is at http://localhost:3333/api/v1/bids in dev / regtest.
  // Same URL that cat21.space's Angular env points at.
  const bidsUrl = process.env.CAT21_INDEXER_URL ?? 'http://localhost:3333';
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
  const knownBeforeNavigate = new Set(context.pages());
  await page.goto(acceptUrl.toString(), { waitUntil: 'domcontentloaded' });

  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeNavigate,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }
  await shot(page, 'bid-mkt-01-accept-loaded');

  // The URL committed the cat outpoint; accept-offer page shows the
  // "pre-selected from the buyer's link" hint.
  const catFromUrlHint = page.getByTestId('accept-offer-cat-from-url');
  await expect(catFromUrlHint).toBeVisible({ timeout: 30_000 });
  await expect(catFromUrlHint).toContainText(freshMintTxid);

  const acceptBtn = page.getByTestId('accept-offer-sign-cta');
  await expect(acceptBtn).toBeVisible({ timeout: 30_000 });
  await expect(acceptBtn).toBeEnabled({ timeout: 30_000 });
  await shot(page, 'bid-mkt-02-accept-ready');

  // ─── Step 10: Click Accept → cat21-wallet sign popup → sign. ───
  const knownBeforeSign = new Set(context.pages());
  await acceptBtn.click();
  const approvalSign = await waitForApprovalPopup({
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
  await shot(approvalSign, 'bid-mkt-03-sign-approval');
  await clickApprovalButton(approvalSign);
  await approvalSign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

  // ─── Step 11: Success surfaces. Extract the broadcast txid. ───
  const successCard = page.getByTestId('accept-offer-success');
  await expect(successCard).toBeVisible({ timeout: 90_000 });
  await shot(page, 'bid-mkt-04-success');
  const successLink = successCard.locator('a').first();
  const successHref = await successLink.getAttribute('href');
  const successTxidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(successTxidMatch).not.toBeNull();
  const settleTxid = successTxidMatch![1];
  console.log(`[bid-mkt] settlement txid = ${settleTxid}`);

  // ─── Step 12: On-chain verification. Mine + read + assert. ───
  await waitForElectrsSync(mineBlocks(1));
  const settleTx = await getTx(settleTxid);
  expect(settleTx.status.block_hash).toBeTruthy();
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
