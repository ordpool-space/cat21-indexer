/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  seedInscribedCoin,
  waitForApprovalPopup,
  isVisibleWithin,
  rpc,
} from 'ordpool-sdk/e2e';
import { installBrowserErrorGuard } from './console-guard';

/**
 * E2E (regtest) — cat21.space funding-safety guard, proven REAL, no /output mock.
 *
 * The guard that stops someone spending an asset-bearing coin as a mint fee is
 * the one money-path safety net on the mint screen, and until now it was proven
 * NOWHERE: both mint specs stubbed `/output/*` to a constant clean body, so the
 * scan could not fail. This spec removes the stub and puts a coin that REALLY
 * carries an inscription in front of the picker.
 *
 * How it works:
 *   - `seedInscribedCoin` inscribes through stock ord's own wallet and sends the
 *     2 000 000-sat coin to the connected wallet's PAYMENT address, so it is a
 *     genuine funding candidate the scan is forced to rule on (a 546-sat coin
 *     might never be considered, and the guard would never be asked).
 *   - The scan reads the REAL local ords the workflow wires in: stock ord
 *     (:8081) for the `inscriptions` field, cat21-ord (:8080) for cats. No mock.
 *   - With a working guard the coin lands in the unsafe bucket: the row shows
 *     "⚠ asset found" and offers "Use anyway" instead of auto-selecting it, and
 *     the asset-notice panel names the inscription. (Xverse keeps a separate
 *     payment address, so a dirty-only funding pool is NOTICE-and-proceed, not a
 *     block; the panel that names the asset is `mint-asset-notice`. The proof
 *     here is topology-independent: the scanner reading stock ord's inscriptions
 *     field, not the wallet's block/notice behaviour.)
 *
 * THE LOAD-BEARING ASSERTION is the inscription id in the asset-notice panel, NOT
 * the "asset found" badge or the "Use anyway" override. The seeded coin ALSO carries
 * a coinbase rare sat (both ords run --index-sats), so the generic badge + the
 * override fire for the rare sat too and persist even under the mutation below.
 * Only the inscription line depends on the stock ord's `inscriptions` field.
 *
 * THE MUTATION CHECK (run on a throwaway branch, not in CI): point the scanner's
 * `ordApiUrl` at :8080 (cat21-ord) instead of :8081 (stock ord). cat21-ord runs
 * --index-cat21 and has no `inscriptions` field, so `content.inscriptionIds` is
 * empty, the "Inscription" line never renders, and the id assertion goes RED —
 * while the badge and "Use anyway" stay green on the rare sat. Verified: at
 * :8081 GREEN on the id, at :8080 RED on the id. Deleting the stub only makes
 * the scan run; the red under the mutation is what proves the guard reads the
 * inscription field.
 *
 * CI-only (real Xverse binary + regtest stack); the regtest playwright config
 * refuses to run locally.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4221';
const MINT_PATH = '/dashboard/mint';
const TEST_PASSWORD = 'TestPassword123!';

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.XVERSE_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/xverse');
const SEED_USER_DATA_DIR =
  process.env.XVERSE_SEED_USER_DATA_DIR
  ?? path.resolve(__dirname, '../../test-results/xverse-seed-user-data-dir');
const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let extensionId: string;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `funding-guard-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`Xverse extension not unpacked at ${EXT_PATH}. The workflow's playwright-bootstrap.sh xverse step should have run first.`);
  }
  if (!fs.existsSync(path.join(SEED_USER_DATA_DIR, 'Default'))) {
    throw new Error(`Xverse seed user-data-dir missing at ${SEED_USER_DATA_DIR}. The SDK globalSetup should have produced it.`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). The consumer bootstrap should have mined past coinbase maturity.`);
  }

  const workingDir = `${SEED_USER_DATA_DIR}.guard-${process.pid}-${Date.now()}`;
  fs.cpSync(SEED_USER_DATA_DIR, workingDir, { recursive: true });
  for (const stale of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    fs.rmSync(path.join(workingDir, stale), { force: true });
  }

  // NO `/output` mock — the whole point of this spec is that the scan hits the
  // real local ords (stock :8081 for inscriptions, cat21-ord :8080 for cats)
  // that the workflow wired into the frontend config.
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

test('funding-safety guard refuses an inscribed coin as a mint fee (real ord, no mock)', async () => {
  test.setTimeout(300_000);

  // ─── 1. Unlock the Xverse vault ─────────────────────────────────
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
      return t.includes('account 1') || t.includes('not now') || t.includes('send');
    }, undefined, { timeout: 30_000, polling: 250 });
  }
  const notNow = primer.getByText('Not now', { exact: true }).first();
  // isVisibleWithin, not isVisible({ timeout }): Playwright ignores the timeout
  // on isVisible (it is @deprecated-and-ignored), so the check would run before
  // an optional "Not now" dialog had rendered and the dismissal would no-op.
  if (await isVisibleWithin(notNow, 1_500)) {
    await notNow.click({ force: true }).catch(() => undefined);
  }
  await primer.close();

  // ─── 2. Connect Xverse, read the payment address (before funding) ─
  const page = await context.newPage();
  const errorGuard = installBrowserErrorGuard(page);
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const cta = page.getByTestId('mint-cta');
  await expect(cta).toBeVisible({ timeout: 30_000 });

  const knownPagesBeforeConnect = new Set(context.pages());
  await page.getByTestId('wallet-connect-btn').first().click();
  await page.getByTestId('wallet-pick-xverse').first().click({ timeout: 20_000 });

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
  await approvalConnect.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
    .first().click();
  await approvalConnect.close().catch(() => undefined);

  // Payment address from the empty-state (no funds yet → mint-no-utxos).
  const noUtxos = page.getByTestId('mint-no-utxos');
  await expect(noUtxos).toBeVisible({ timeout: 60_000 });
  const paymentCode = noUtxos.locator('code').first();
  await expect(paymentCode).toHaveText(/^bcrt1q/, { timeout: 30_000 });
  const paymentAddress = (await paymentCode.textContent())!.trim();
  console.log(`[guard] payment=${paymentAddress}`);

  // ─── 3. Seed a REAL inscribed coin as the funding candidate ──────
  const inscribed = await seedInscribedCoin({ address: paymentAddress });
  const inscribedOutpoint = `${inscribed.txid}:${inscribed.vout}`;
  console.log(`[guard] inscribed coin ${inscribedOutpoint} value=${inscribed.value} id=${inscribed.inscriptionId}`);

  // ─── 4. Reload mint; the scan now runs against the real ords ─────
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: new Set(context.pages()),
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
      .first().click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.close().catch(() => undefined);
  }

  // Expand the expert picker and find the seeded coin's row.
  const pickerSummary = page.getByTestId('mint-expert-summary').first();
  await expect(pickerSummary).toBeVisible({ timeout: 90_000 });
  if ((await page.locator('details[data-testid="mint-expert"][open]').count()) === 0) {
    await pickerSummary.click();
  }
  // The shared picker keys each row by IDENTITY (data-testid utxo-row-<txid>-<vout>)
  // and renders the outpoint as text; match on the outpoint text to find the row.
  const seededRow = page.locator('[data-testid^="utxo-row-"]').filter({ hasText: inscribedOutpoint }).first();
  await expect(seededRow).toBeVisible({ timeout: 60_000 });
  await shot(page, '01-picker');

  // ─── 5. Scan the coin (it is above AUTO_SCAN_MAX_VALUE_SAT = 50k) ──
  // seedInscribedCoin sizes the coin at 2M sat to be a genuine funding
  // candidate, which is above the auto-scan threshold — so the mint shows it
  // 'unscanned' with a manual Scan (large coins are not auto-scanned). Clicking
  // Scan runs the REAL scan against stock ord; that is the realistic path for a
  // chunky funding coin, and it is what flips the row to 'assets'.
  // The bucket state lives in the [data-bucket] attribute (identity stays in the
  // test-id), so it is directly assertable and stable across the transition.
  await expect(seededRow).toHaveAttribute('data-bucket', 'unscanned', { timeout: 60_000 });
  await seededRow.getByRole('button', { name: 'Scan', exact: true }).click();

  // ─── 6. Supporting checks (fire on the rare sat too — NOT the proof) ─
  // After the scan the row is bucketed 'assets' and offers "Use anyway", not
  // auto-selected. Generous timeout: the scan is a live HTTP round-trip to ord,
  // passing through a transient 'scanning' bucket first.
  await expect(seededRow).toHaveAttribute('data-bucket', 'assets', { timeout: 60_000 });
  const overrideBtn = seededRow.locator('.utxo-pick-override');
  await expect(overrideBtn).toBeVisible({ timeout: 30_000 });

  // ─── 7. Override, then read the asset-notice panel ───────────────
  await overrideBtn.click();
  const notice = page.getByTestId('mint-asset-notice');
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await shot(page, '02-notice');

  // ─── 7. THE PROOF: the inscription-specific line, full id ────────
  // Populated only from content.inscriptionIds, which only the stock ord's
  // `inscriptions` field produces. Under the :8080 mutation this is empty and
  // the assertion goes RED, while the badge + override above stay green on the
  // coin's rare sat. That red is the guard's proof.
  await expect(notice).toContainText('Inscription');
  await expect(notice).toContainText(inscribed.inscriptionId);

  errorGuard.assertNone();
});
