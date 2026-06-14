/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

// The SDK ships these helpers as raw .ts under e2e/. Node 24's built-in
// type-stripping refuses to compile .ts under node_modules, so the
// workflow copies them out to ./sdk-lib/ before the spec runs.
import {
  getUtxos,
  waitForElectrsSync,
  rpc,
  mineBlocks,
  getTx,
} from './sdk-lib/regtest-helpers';
import { waitForApprovalPopup } from './sdk-lib/approval-popup';

/**
 * E2E (regtest mint) — cat21.space /dashboard/mint
 *
 * Pixel-themed sibling of ordpool's /cat21-mint regtest spec. Drives
 * the cat21.space Angular page through a complete CAT-21 round-trip
 * on a local Bitcoin Regtest stack with the real Xverse extension.
 *
 * The flow mirrors ordpool's spec step-for-step; the differences are
 * just selectors (cat21.space ships its own data-testid surface) and
 * the connect button (cat21.space uses the `<app-wallet-connect>`
 * picker modal directly instead of mempool framework's connect link).
 *
 * Pre-conditions the workflow guarantees:
 *   - bitcoind regtest is up with ≥101 mined blocks (coinbase maturity)
 *   - electrs is up on :3000
 *   - ordpool-backend is up on :8999 (provides /api/v1/fees/recommended
 *     + electrs /api/* proxy that cat21.space's mint flow reads)
 *   - cat21-indexer/frontend is served at FRONTEND_URL with the regtest
 *     cat21Config (mempoolApiUrl → :8999, cat21ApiUrl → :3333, ord
 *     URLs are unused on regtest and stay as production fallbacks
 *     since the scanner gracefully tolerates failures)
 *   - the Xverse `.crx` is unpacked at XVERSE_EXT_PATH
 *   - a seeded user-data-dir is at XVERSE_SEED_USER_DATA_DIR (the
 *     SDK's globalSetup produced it during the workflow's earlier
 *     "seed Xverse" step)
 *
 * The spec is CI-only — the Xverse binary stays off contributor
 * laptops. The regtest playwright config refuses to run locally.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4221';
const MINT_PATH = '/dashboard/mint';
const TEST_PASSWORD = 'TestPassword123!';

const FUND_AMOUNT_BTC = 0.001;
const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.XVERSE_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/xverse');
const SEED_USER_DATA_DIR =
  process.env.XVERSE_SEED_USER_DATA_DIR
  ?? path.resolve(__dirname, '../../test-results/xverse-seed-user-data-dir');

const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let extensionId: string;
// Hoisted state shared across `test()` blocks. The persistent context
// remembers the connected wallet in localStorage, so test 2 can spin
// up a fresh page and auto-reconnect to the same payment address.
let sharedPaymentAddress: string | undefined;

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21-mint-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(
      `Xverse extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh xverse step first.',
    );
  }
  if (!fs.existsSync(path.join(SEED_USER_DATA_DIR, 'Default'))) {
    throw new Error(
      `Xverse seed user-data-dir missing at ${SEED_USER_DATA_DIR}. The SDK's ` +
      'globalSetup should have produced it before this spec ran.',
    );
  }

  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(
      `regtest tip is ${tip} (<101). regtest-bootstrap.sh should have mined ` +
      'past coinbase maturity before this spec ran.',
    );
  }

  const workingDir = `${SEED_USER_DATA_DIR}.cat21mint-${process.pid}-${Date.now()}`;
  fs.cpSync(SEED_USER_DATA_DIR, workingDir, { recursive: true });
  for (const stale of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    fs.rmSync(path.join(workingDir, stale), { force: true });
  }

  context = await chromium.launchPersistentContext(workingDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    viewport: { width: 1280, height: 900 },
  });

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  extensionId = worker.url().split('/')[2];
});

test.afterAll(async () => {
  await context?.close();
});

test('cat21 mint round-trip on regtest via cat21.space /dashboard/mint + Xverse', async () => {
  test.setTimeout(420_000);

  // ─── 1. Unlock the vault ──────────────────────────────────────
  const primer = await context.newPage();
  await primer.setViewportSize({ width: 400, height: 800 });
  await primer.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await primer.waitForFunction(() => {
    const t = (document.body.innerText || '').toLowerCase();
    return t.includes('unlock') || t.includes('account 1');
  }, undefined, { timeout: 30_000, polling: 250 });
  if (/unlock/i.test(await primer.locator('body').innerText())) {
    await primer.locator('input[type="password"]').first().fill(TEST_PASSWORD);
    await primer.getByRole('button', { name: /^unlock$/i }).first().click();
    await primer.waitForFunction(() => {
      const t = (document.body.innerText || '').toLowerCase();
      return t.includes('account 1') || t.includes('not now') || t.includes('zest') || t.includes('send');
    }, undefined, { timeout: 30_000, polling: 250 });
  }
  const notNow = primer.getByText('Not now', { exact: true }).first();
  if (await notNow.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await notNow.click({ force: true }).catch(() => undefined);
  }
  await shot(primer, '01-unlocked');
  await primer.close();

  // ─── 2. Open /dashboard/mint, click Connect, approve in Xverse ─
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '02-page-loaded');

  // cat21.space renders the connect CTA card with data-testid="mint-cta"
  // when no wallet is connected. The card embeds <app-wallet-connect>
  // which renders a "Connect" button that opens an ngb-modal picker.
  const cta = page.locator('[data-testid="mint-cta"]');
  await expect(cta).toBeVisible({ timeout: 30_000 });
  // The wallet-connect trigger inside the CTA reads "Connect wallet".
  // It's `.wallet-button-connect` so we pin by class to dodge anything
  // else that might match "connect" on the page.
  await page.locator('button.wallet-button-connect').first().click();

  // The modal lists supported wallets — click Xverse.
  await page.getByRole('button', { name: /^xverse$/i }).first()
    .click({ timeout: 20_000 });
  await shot(page, '03-picker-clicked');

  const knownPagesBeforeConnect = new Set(context.pages());
  const approvalConnect = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeConnect,
    timeoutMs: 60_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.waitForFunction(() => {
        const t = (document.body.innerText || '').toLowerCase();
        return ['connect', 'approve', 'confirm', 'allow'].some((s) => t.includes(s));
      }, undefined, { timeout: 60_000, polling: 500 });
      return true;
    },
  });
  await shot(approvalConnect, '04-connect-approval');
  await approvalConnect.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
    .first().click();
  await approvalConnect.close().catch(() => undefined);

  // ─── 3. Read the payment address from the empty-state ─────────
  // Before funding, the wallet has no viable UTXOs. cat21.space
  // renders the empty-state with data-testid="mint-no-utxos" and a
  // `<code>{{ connectedWallet()!.paymentAddress }}</code>` we can
  // pluck the bcrt1q address from verbatim.
  const noUtxos = page.locator('[data-testid="mint-no-utxos"]');
  await expect(noUtxos).toBeVisible({ timeout: 60_000 });
  const paymentCode = noUtxos.locator('code').first();
  await expect(paymentCode).toBeVisible({ timeout: 30_000 });
  const paymentAddress = (await paymentCode.textContent())!.trim();
  console.log(`[cat21-mint-page] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1q/);
  const wallet = { paymentAddress };
  sharedPaymentAddress = paymentAddress;

  // ─── 4. Fund the payment address, mine, wait for electrs ──────
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', wallet.paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[cat21-mint-page] funded ${wallet.paymentAddress} with ${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
  const fundedTip = mineBlocks(1);
  await waitForElectrsSync(fundedTip);

  const utxos = await getUtxos(wallet.paymentAddress);
  expect(utxos.length).toBeGreaterThan(0);
  const fundedUtxo = utxos.find((u) => u.value === FUND_AMOUNT_SATS);
  if (!fundedUtxo) {
    throw new Error(`could not find ${FUND_AMOUNT_SATS}-sat UTXO; got ${JSON.stringify(utxos)}`);
  }

  // ─── 4b. Reload page to refresh UTXO state ─────────────────────
  // The orchestrator fires getUtxos once on connect; funding after
  // doesn't trigger a re-fetch. A page reload forces a fresh
  // utxos$ pipeline. The SDK persists the last-connected wallet in
  // localStorage and auto-reconnects on init; if Xverse pops a
  // permission-renewal popup we approve it, otherwise move on.
  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeReload,
    timeoutMs: 8_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.waitForFunction(() => {
        const t = (document.body.innerText || '').toLowerCase();
        return ['connect', 'approve', 'confirm', 'allow'].some((s) => t.includes(s));
      }, undefined, { timeout: 8_000, polling: 250 });
      return true;
    },
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
      .first().click();
    await reapprove.close().catch(() => undefined);
  }
  await shot(page, '04b-reloaded');

  // ─── 5. Wait for the "found funds" banner + Mint button ────────
  // After the orchestrator picks up the new UTXO from electrs, the
  // empty-state vanishes and the summary panel + happy-path banner
  // (data-testid="mint-found-funds") render. The mint button gates
  // on `canMint()`; once funded + auto-picked, it enables.
  const foundFunds = page.locator('[data-testid="mint-found-funds"]');
  await expect(foundFunds).toBeVisible({ timeout: 90_000 });
  await shot(page, '05-found-funds');

  const mintBtn = page.locator('[data-testid="mint-btn"]');
  await expect(mintBtn).toBeEnabled({ timeout: 30_000 });

  // ─── 6. Click Mint, approve sign popup ─────────────────────────
  const knownPagesBeforeSign = new Set(context.pages());
  await mintBtn.click();

  const approvalSign = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText(/review transaction/i).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(approvalSign, '06-sign-approval');

  await approvalSign.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.some((b) => {
      if (!/^confirm$/i.test(b.textContent?.trim() ?? '')) return false;
      if (b.hasAttribute('disabled')) return false;
      const style = getComputedStyle(b);
      return style.pointerEvents !== 'none' && style.visibility !== 'hidden';
    });
  }, undefined, { timeout: 30_000, polling: 250 });
  await expect(approvalSign.getByRole('button', { name: /^confirm$/i }).first()).toBeEnabled({ timeout: 30_000 });

  for (let attempt = 0; attempt < 3; attempt++) {
    if (approvalSign.isClosed()) break;
    await approvalSign.getByRole('button', { name: /^confirm$/i }).first()
      .click({ force: true })
      .catch(() => undefined);
    const closed = new Promise<void>((res) => approvalSign.once('close', () => res()));
    await Promise.race([
      closed,
      expect(approvalSign.getByRole('button', { name: /^confirm$/i }).first())
        .toBeHidden({ timeout: 30_000 }),
    ]).catch(() => undefined);
    if (approvalSign.isClosed()) break;
  }

  // ─── 7. Wait for success card + extract broadcast txid ────────
  const successCard = page.locator('[data-testid="mint-success"]');
  await expect(successCard).toBeVisible({ timeout: 90_000 });
  await shot(page, '07-success');

  const successLink = successCard.locator('a').first();
  const successHref = await successLink.getAttribute('href');
  expect(successHref).toBeTruthy();
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[cat21-mint-page] success txid = ${broadcastTxid}`);

  // ─── 8. Mine the confirmation block, verify on-chain ──────────
  // The cat21-indexer frontend doesn't bundle ordpool-parser (the
  // production gallery reads SVGs from the indexer backend instead),
  // so we stop at locktime=21 + confirmed block. The deeper parser
  // assertions live in the ordpool sister spec.
  const confirmedTip = mineBlocks(1);
  await waitForElectrsSync(confirmedTip);
  const esploraTx = await getTx(broadcastTxid);
  console.log(`[cat21-mint-page] locktime=${esploraTx.locktime}  block_hash=${esploraTx.status.block_hash}`);
  expect(esploraTx.locktime).toBe(21);
  expect(esploraTx.status.block_hash).toBeTruthy();
});

/**
 * Regression for the UtxoContentScanner -> UI warning pipeline.
 *
 * Mirrors the ordpool spec. The cat21-mint dashboard surfaces an
 * `asset found` badge on the row of any funding-source UTXO whose
 * `/output/<outpoint>` response carries inscriptions, runes, or cats.
 * On regtest there's no real ord upstream that knows about our
 * outpoints, so we intercept `/output/<outpoint>` at the Playwright
 * route layer and return cat metadata for one specific outpoint
 * (a small UTXO we fund just before opening the page).
 *
 * What this proves on the cat21.space side:
 *   1. The orchestrator queries `/output/<outpoint>` on both ord
 *      URLs for funding-source UTXOs ≤ 50_000 sat.
 *   2. When the response carries assets, the row's bucket flips to
 *      `assets` and the row gets the `.mint-utxo-row-assets` class
 *      + `⚠ asset found` bucket badge.
 *   3. The action button on that row reads "Use anyway" with the
 *      `.mint-utxo-pick-override` styling — a deliberate friction
 *      step so the user can't single-click into a cat-burning mint.
 */
test('asset scanner: cat-bearing funding UTXO surfaces the "asset found" warning', async () => {
  test.setTimeout(180_000);
  if (!sharedPaymentAddress) {
    throw new Error('first test must have set sharedPaymentAddress');
  }
  const paymentAddress = sharedPaymentAddress;

  const SMALL_FUND_BTC = 0.00015;
  const SMALL_FUND_SATS = Math.round(SMALL_FUND_BTC * 1e8);
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(SMALL_FUND_BTC)).trim();
  console.log(`[asset-scanner] cat-mock target txid=${fundTxid} (small UTXO ${SMALL_FUND_SATS} sat)`);
  const tip = mineBlocks(1);
  await waitForElectrsSync(tip);
  const small = (await getUtxos(paymentAddress)).find((u) => u.value === SMALL_FUND_SATS && u.txid === fundTxid);
  if (!small) {
    throw new Error(`could not find the ${SMALL_FUND_SATS}-sat funding UTXO under ${paymentAddress}`);
  }
  const catOutpoint = `${small.txid}:${small.vout}`;
  console.log(`[asset-scanner] cat-bearing outpoint = ${catOutpoint}`);

  const page = await context.newPage();
  await page.route('**/output/*', async (route) => {
    const url = route.request().url();
    const isCatTarget = url.includes(catOutpoint);
    const body = isCatTarget
      ? {
          inscriptions: [],
          runes: {},
          cats: [0],
          sat_ranges: [[1_000_000, 1_000_001]],
          value: SMALL_FUND_SATS,
          script_pubkey: '',
        }
      : { inscriptions: [], runes: {}, cats: [] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });

  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, 'as-01-page-loaded');

  // Auto-reconnect from localStorage. Approve a permission-renewal
  // popup if Xverse pops one; otherwise move on.
  const known = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: known,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
      .first().click().catch(() => undefined);
    await reapprove.close().catch(() => undefined);
  }

  // Expand the funding-source picker.
  const pickerSummary = page.locator('details.mint-expert > summary').first();
  await expect(pickerSummary).toBeVisible({ timeout: 60_000 });
  // If pickerOpenByDefault() returned true the details is already open;
  // clicking would collapse it. Toggle only if needed.
  const expanded = await page.locator('details.mint-expert[open]').count();
  if (expanded === 0) {
    await pickerSummary.click();
  }
  await shot(page, 'as-02-picker-open');

  // Assert the cat-mocked row carries the assets styling.
  const assetRow = page.locator('li.mint-utxo-row-assets').filter({ hasText: catOutpoint }).first();
  await expect(assetRow).toBeVisible({ timeout: 45_000 });
  await shot(page, 'as-03-asset-row-visible');

  // Bucket badge text + class.
  const bucketBadge = assetRow.locator('.mint-utxo-bucket-assets');
  await expect(bucketBadge).toBeVisible();
  await expect(bucketBadge).toHaveText(/asset found/i);

  // Action button is the override variant.
  const overrideBtn = assetRow.locator('.mint-utxo-pick-override');
  await expect(overrideBtn).toBeVisible();
  await expect(overrideBtn).toHaveText(/use anyway/i);

  // Clicking it should select the row and surface the top-level
  // `data-testid="asset-found-warning"` summary alert.
  await overrideBtn.click();
  const warning = page.locator('[data-testid="asset-found-warning"]');
  await expect(warning).toBeVisible({ timeout: 10_000 });
  await shot(page, 'as-04-warning-after-select');
});

/**
 * Regression for the fee-rate picker.
 *
 * cat21.space's `<app-fees-picker>` renders four `.tier-btn` buttons
 * (Fastest / Half hour / Hour / Economy) bound to a polled
 * recommendedFees$ stream that hits `/api/v1/fees/recommended` on the
 * stub (`{fastestFee:5, halfHourFee:3, hourFee:1, economyFee:1,
 * minimumFee:1}`). Clicking a tier calls `pickTier()` which writes
 * the tier's rate into the mint orchestrator's fee-rate signal and
 * mirrors it back into the `.manual-input`.
 *
 * The test pins:
 *   1. Buttons populate (lose their disabled state) once the REST poll
 *      returns. Each button shows its tier label + the integer rate.
 *   2. Clicking the Fastest tier writes "5" into `.manual-input` and
 *      gives that button `.tier-btn-active`.
 *   3. Clicking the Hour tier writes "1" and migrates the active class.
 *   4. The manual-input itself round-trips: typing "7" updates which
 *      tier is "active" (none, since 7 isn't a tier rate) — this is
 *      the user-overrides-tier path.
 */
test('fee picker: tier clicks update the manual input + active state', async () => {
  test.setTimeout(120_000);

  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, 'fp-01-loaded');

  const known = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: known,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
      .first().click().catch(() => undefined);
    await reapprove.close().catch(() => undefined);
  }

  // Wait for the picker to come out of its disabled-while-loading state.
  const buttons = page.locator('.fees-picker .tier-btn');
  await expect(buttons).toHaveCount(4, { timeout: 30_000 });
  await expect(buttons.first()).toBeEnabled({ timeout: 30_000 });
  await shot(page, 'fp-02-picker-ready');

  // Tier order on screen: 0=Fastest(5), 1=Half hour(3), 2=Hour(1), 3=Economy(1)
  await expect(buttons.nth(0)).toContainText('Fastest');
  await expect(buttons.nth(0)).toContainText('5');
  await expect(buttons.nth(1)).toContainText('Half hour');
  await expect(buttons.nth(1)).toContainText('3');
  await expect(buttons.nth(2)).toContainText('Hour');
  await expect(buttons.nth(3)).toContainText('Economy');

  const manualInput = page.locator('.fees-picker .manual-input');

  // Click Fastest → input "5" + active class on the Fastest button.
  await buttons.nth(0).click();
  await expect(manualInput).toHaveValue('5', { timeout: 5_000 });
  await expect(buttons.nth(0)).toHaveClass(/tier-btn-active/);
  await shot(page, 'fp-03-fastest-clicked');

  // Click Half hour → input "3" + active class moves.
  await buttons.nth(1).click();
  await expect(manualInput).toHaveValue('3', { timeout: 5_000 });
  await expect(buttons.nth(1)).toHaveClass(/tier-btn-active/);
  await expect(buttons.nth(0)).not.toHaveClass(/tier-btn-active/);

  // Click Hour → input "1" + active class moves.
  await buttons.nth(2).click();
  await expect(manualInput).toHaveValue('1', { timeout: 5_000 });
  await expect(buttons.nth(2)).toHaveClass(/tier-btn-active/);

  // ─── Manual-input propagates to the orchestrator simulation ───
  // Maintainer-reported regression: "typing in the fee box" had no
  // visible effect on cat21.space. The picker's tier-active state
  // moving is necessary but not sufficient — the rate signal also
  // has to feed the downstream simulation that the summary section
  // displays. We pin that by reading the `Miner fee` value at
  // rate=1, then typing 7 and asserting it goes up.
  const minerFeeVal = page.locator(
    '[data-testid="mint-summary-section"] .mint-summary-row',
  ).filter({ hasText: /Miner fee/ }).locator('.val');
  await expect(minerFeeVal).toBeVisible({ timeout: 10_000 });
  const feeAt1Text = (await minerFeeVal.textContent())!.trim();
  const feeAt1 = Number(feeAt1Text.replace(/[^\d]/g, ''));
  expect(Number.isFinite(feeAt1)).toBe(true);
  expect(feeAt1).toBeGreaterThan(0);

  // Type a custom rate. 7 deliberately doesn't match any tier so it
  // also pins the tier-active fall-back behaviour.
  await manualInput.fill('7');
  await manualInput.press('Tab');
  for (let i = 0; i < 4; i++) {
    await expect(buttons.nth(i)).not.toHaveClass(/tier-btn-active/);
  }

  // Wait for `simulations$` to re-emit at the new rate. Higher rate
  // means proportionally larger miner fee. We don't pin the exact
  // ratio (the simulation also reserves dust + considers the
  // change-fold rule) — just that it moves in the right direction
  // and by a non-trivial margin (≥ 3× covers regression noise).
  await expect.poll(async () => {
    const t = (await minerFeeVal.textContent())!.trim();
    return Number(t.replace(/[^\d]/g, ''));
  }, { timeout: 5_000, message: 'miner fee never updated after typing rate=7' })
    .toBeGreaterThan(feeAt1 * 3);

  const feeAt7Text = (await minerFeeVal.textContent())!.trim();
  const feeAt7 = Number(feeAt7Text.replace(/[^\d]/g, ''));
  console.log(`[manual-input] miner fee at 1 sat/vB = ${feeAt1}; at 7 sat/vB = ${feeAt7} (×${(feeAt7 / feeAt1).toFixed(2)})`);
  await shot(page, 'fp-04-manual-override');

  // Round-trip back to 1 to prove the propagation isn't one-way.
  await manualInput.fill('1');
  await manualInput.press('Tab');
  await expect.poll(async () => {
    const t = (await minerFeeVal.textContent())!.trim();
    return Number(t.replace(/[^\d]/g, ''));
  }, { timeout: 5_000 }).toBeLessThan(feeAt7);
});

/**
 * Manual-override end-to-end: the user's typed rate must be EXACTLY
 * the rate that lands on-chain, regardless of what the picker is
 * suggesting at the moment.
 *
 * Two real scenarios:
 *
 *   A. "Mempool is hot, picker suggests high, user still wants low."
 *      Page.route mocks `/api/v1/fees/recommended` with fastest=100
 *      so the picker tiles fill with high numbers. User types `1`.
 *      Resulting on-chain tx must have fee_rate ≈ 1 sat/vB.
 *
 *   B. "Mempool is quiet, picker suggests low, user wants a purple
 *      cat." (CAT-21 colour buckets are fee-rate driven — high fees
 *      = rare colours: fire at 69 sat/vB, saturated at 420.) Default
 *      stub fees stand. User types `100`. Resulting on-chain tx
 *      must have fee_rate ≈ 100 sat/vB.
 *
 * Both scenarios verify the rate downstream of every reactivity step:
 * `(ngModelChange)` → orchestrator rate signal → simulations() →
 * PSBT construction → Xverse signing → broadcast → confirmed block.
 * Tolerance is ±1 sat/vB to absorb the orchestrator's
 * `ceil(rate × vsize)` rounding plus dust-fold accounting on the
 * change output.
 */

async function mintAtRateAndVerify(opts: {
  rate: number;
  scenarioLabel: string;
  /** When set, intercept the fees REST poll and return fastest=100,
   *  halfHour=60, hour=30, economy=20, min=10 so the picker tiles
   *  visibly disagree with the user's typed rate. */
  mockFeesAsHigh?: boolean;
}): Promise<{ broadcastTxid: string; fee: number; vsize: number; rate: number }> {
  if (!sharedPaymentAddress) throw new Error('first test must have set sharedPaymentAddress');

  const page = await context.newPage();
  if (opts.mockFeesAsHigh) {
    await page.route('**/api/v1/fees/recommended', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
        body: JSON.stringify({
          fastestFee: 100,
          halfHourFee: 60,
          hourFee: 30,
          economyFee: 20,
          minimumFee: 10,
        }),
      });
    });
  }

  // ─── Fund a fresh UTXO ───────────────────────────────────────
  const FUND_BTC = 0.001;
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, String(FUND_BTC)).trim();
  console.log(`[${opts.scenarioLabel}] funded ${sharedPaymentAddress} +${FUND_BTC} BTC tx=${fundTxid}`);
  const tip = mineBlocks(1);
  await waitForElectrsSync(tip);

  // ─── Open page, auto-reconnect ───────────────────────────────
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const known = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: known,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
      .first().click().catch(() => undefined);
    await reapprove.close().catch(() => undefined);
  }
  await shot(page, `mr-${opts.scenarioLabel}-01-loaded`);

  // ─── Wait for picker, sanity-pin that the tiles reflect the
  // expected scenario context (verifies the mock landed, where
  // applicable). ──────────────────────────────────────────────
  const tiles = page.locator('.fees-picker .tier-btn');
  await expect(tiles).toHaveCount(4, { timeout: 30_000 });
  await expect(tiles.first()).toBeEnabled({ timeout: 30_000 });
  if (opts.mockFeesAsHigh) {
    await expect(tiles.nth(0)).toContainText('100', { timeout: 10_000 });
  }

  // ─── Override with the user's typed rate ─────────────────────
  const manualInput = page.locator('.fees-picker .manual-input');
  await manualInput.fill(String(opts.rate));
  await manualInput.press('Tab');
  await shot(page, `mr-${opts.scenarioLabel}-02-rate-typed`);

  // ─── Wait for found-funds + Mint button ──────────────────────
  const foundFunds = page.locator('[data-testid="mint-found-funds"]');
  await expect(foundFunds).toBeVisible({ timeout: 90_000 });
  const mintBtn = page.locator('[data-testid="mint-btn"]');
  await expect(mintBtn).toBeEnabled({ timeout: 30_000 });
  await shot(page, `mr-${opts.scenarioLabel}-03-ready`);

  // ─── Click Mint, approve sign popup ──────────────────────────
  const knownBeforeSign = new Set(context.pages());
  await mintBtn.click();
  const approvalSign = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText(/review transaction/i).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(approvalSign, `mr-${opts.scenarioLabel}-04-sign-popup`);

  await approvalSign.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.some((b) => {
      if (!/^confirm$/i.test(b.textContent?.trim() ?? '')) return false;
      if (b.hasAttribute('disabled')) return false;
      const style = getComputedStyle(b);
      return style.pointerEvents !== 'none' && style.visibility !== 'hidden';
    });
  }, undefined, { timeout: 30_000, polling: 250 });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (approvalSign.isClosed()) break;
    await approvalSign.getByRole('button', { name: /^confirm$/i }).first()
      .click({ force: true })
      .catch(() => undefined);
    const closed = new Promise<void>((res) => approvalSign.once('close', () => res()));
    await Promise.race([
      closed,
      expect(approvalSign.getByRole('button', { name: /^confirm$/i }).first())
        .toBeHidden({ timeout: 30_000 }),
    ]).catch(() => undefined);
    if (approvalSign.isClosed()) break;
  }

  // ─── Wait for success card + broadcast txid ──────────────────
  const successCard = page.locator('[data-testid="mint-success"]');
  await expect(successCard).toBeVisible({ timeout: 90_000 });
  await shot(page, `mr-${opts.scenarioLabel}-05-success`);
  const successHref = await successCard.locator('a').first().getAttribute('href');
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];

  // ─── Mine confirmation block, read on-chain tx ───────────────
  const confTip = mineBlocks(1);
  await waitForElectrsSync(confTip);
  const tx = await getTx(broadcastTxid);
  expect(tx.locktime).toBe(21);
  expect(tx.status.block_hash).toBeTruthy();
  // electrs's GET /tx/<txid> returns {fee, size, weight, ...}.
  // Vsize is ceil(weight/4) per BIP141; rate = fee / vsize sat/vB.
  const vsize = Math.ceil(tx.weight / 4);
  const rate = tx.fee / vsize;
  console.log(`[${opts.scenarioLabel}] fee=${tx.fee} sat, vsize=${vsize} vB, rate=${rate.toFixed(3)} sat/vB (target ${opts.rate})`);

  await page.close().catch(() => undefined);
  return { broadcastTxid, fee: tx.fee, vsize, rate };
}

test('manual override: typing 100 mints a "purple cat" — high rate ends up on-chain', async () => {
  test.setTimeout(420_000);
  const { rate } = await mintAtRateAndVerify({ rate: 100, scenarioLabel: 'purple' });
  // ±1 sat/vB tolerance — the orchestrator pads the change-fold
  // boundary by up to 1 vB worth of fee. Anything more would be a
  // real divergence between the user's typed value and the mined
  // tx.
  expect(Math.abs(rate - 100)).toBeLessThan(1);
});

test('manual override: typing 1 while the picker suggests 100 (mempool hot) — low rate ends up on-chain', async () => {
  test.setTimeout(420_000);
  const { rate } = await mintAtRateAndVerify({ rate: 1, scenarioLabel: 'hot-mempool', mockFeesAsHigh: true });
  expect(Math.abs(rate - 1)).toBeLessThan(1);
});
