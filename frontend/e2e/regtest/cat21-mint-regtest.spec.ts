/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  getUtxos,
  waitForElectrsSync,
  rpc,
  mineBlocks,
  getTx,
} from 'ordpool-sdk/e2e/regtest/regtest-helpers';
import { waitForApprovalPopup } from 'ordpool-sdk/e2e/playwright/approval-popup';

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
  await page.getByRole('button', { name: /^connect$/i }).first().click();

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
