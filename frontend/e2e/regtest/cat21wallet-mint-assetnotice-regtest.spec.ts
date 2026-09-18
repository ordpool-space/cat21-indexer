/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  onboardCat21Wallet,
  waitForApprovalPopup,
  seedDirtyCoin,
  DirtyCoinAsset,
  rpc,
} from 'ordpool-sdk/e2e';
import { installContextErrorGuard } from './lib/browser-error-guard';

/**
 * E2E (regtest) — cat21.space MINT asset-notice path, END TO END in cat21.space's
 * own wiring, for all four asset classes. The other side of the dirty-coin coin:
 * the dirty-coin matrix proves the guard STEERS AWAY when a clean coin exists;
 * this proves that when NO clean coin covers and the wallet keeps a SEPARATE
 * payment address (cat21-wallet does), the SDK NOTICEs and PROCEEDS rather than
 * blocking (the maintainer's "never spend an asset to the miners by accident"
 * ruling, separate-address branch).
 *
 * Each cell seeds ONLY a dirty coin carrying a real <asset> at the payment
 * address (no clean coin), sized to cover a small mint and below the 50k
 * auto-scan floor so it classifies without a manual scan. The page then must:
 *   - render `mint-asset-notice`, naming the SPECIFIC asset by the id the
 *     fixture seeded (positive-equality on `dirty.assetId`, NEVER an id read back
 *     out of the recommendation and compared to itself), and
 *   - leave the mint CTA ENABLED — proceed is allowed on a separate-address
 *     wallet. The proceed-vs-block decision is the SDK's (resolveFundingPick
 *     returns the coin for asset-notice, null for a one-address wallet's
 *     expert-required), which is why one template cannot drift from another.
 *
 * SCENARIO-B ASSERTION DISCIPLINE: this NEVER asserts the dirty coin survives.
 * On the separate-address path the coin is spent ON PURPOSE — asserting survival
 * would assert the feature does not work. It also does not EXECUTE the mint per
 * cell: a real mint's clean change coin would leave the next cell no longer
 * dirty-only (it would take the 'auto' branch). The target here is the render
 * (notice visible + asset NAMED + CTA ENABLED); the spend-on-proceed is
 * corroborated once, in isolation, by the mint-dirtycoin lane.
 *
 * MUTATION CHECK (throwaway branch, not CI): force the wallet's topology to
 * one-address (neutralise isOneAddressWallet / resolveFundingTopology so it reads
 * every wallet as one-address). The status becomes expert-required, the notice
 * never renders and the CTA is disabled, so the notice-visible + CTA-enabled
 * assertions go RED in all four cells. That red is the proof the notice path is
 * load-bearing on the topology derivation, not decoration.
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

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `mint-assetnotice-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}


/** Connect cat21-wallet via the mint page; return the payment address. */
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
 * One asset-notice cell. Load-bearing: the notice renders and names the SEEDED
 * asset id, and the CTA stays enabled. The dirty coin is sized as the ONLY cover
 * — decreasing across cells so a prior cell's ~clean change never becomes a
 * smaller competing cover (the shared-wallet trap the transfer cells hit).
 */
async function runAssetNoticeCell(asset: DirtyCoinAsset, dirtySats: number): Promise<void> {
  const tag = `mint:asset-notice:${asset}`;
  const RATE = 5; // sat/vB; a small mint so the dirty coin comfortably covers it

  const page = await context.newPage();
  const payment = await connectAndReadPayment(page);
  console.log(`[${tag}] payment=${payment} dirtySats=${dirtySats}`);

  // Seed ONLY a dirty coin — no clean coin. It is the sole cover, so the SDK
  // must select it; on a separate-address wallet that yields asset-notice.
  const dirty = await seedDirtyCoin({ asset, address: payment, valueSats: dirtySats });
  console.log(`[${tag}] dirty ${asset} coin ${dirty.outpoint} value=${dirty.value} assetId=${dirty.assetId}`);

  // Reload mint so the orchestrator RE-FETCHES the wallet's UTXOs. It fetches on
  // wallet-connect (before this cell seeded its coin), not on fee change, so
  // without a reload the freshly-seeded coin is never a candidate and the
  // recommendation stays on a prior cell's coin. This is what makes the naming
  // assertion deterministic.
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

  // Wait until the recommendation actually reflects THIS cell's freshly-seeded
  // coin, not a prior cell's already-scanned one. The four cells share one
  // wallet, so a larger earlier coin can be the recommendation until the new
  // (smaller) coin finishes scanning in the orchestrator. Nudge the fee each
  // iteration to force a fresh recommendation; the decreasing per-cell sizes make
  // this cell's coin the best-fit once it is a scanned candidate. Waiting on the
  // recommended OUTPOINT (not a timeout) is what makes the naming assertion below
  // deterministic — the seed's assetId is only on the seed's own coin.
  const debug = page.getByTestId('mint-debug-funding');
  await debug.waitFor({ state: 'attached', timeout: 30_000 });
  let recOutpoint = '';
  for (let i = 0; i < 60; i++) {
    recOutpoint = (await debug.getAttribute('data-recommended-outpoint').catch(() => '')) ?? '';
    if (recOutpoint === dirty.outpoint) break;
    await manualInput.fill(String(RATE + (i % 2))); // nudge to recompute
    await manualInput.press('Tab');
    await debug.evaluate(() => new Promise((r) => setTimeout(r, 1000)));
  }
  const dbg = await debug.evaluate((el) => ({
    status: el.getAttribute('data-status'),
    hasSelected: el.getAttribute('data-has-selected'),
    recommendedOutpoint: el.getAttribute('data-recommended-outpoint'),
    payEqOrd: el.getAttribute('data-pay-eq-ord'),
  })).catch(() => null);
  console.log(`[${tag}] debug-funding: ${JSON.stringify(dbg)} (want recommended=${dirty.outpoint})`);
  expect(
    recOutpoint,
    `the recommendation never settled on THIS cell's seeded ${asset} coin ${dirty.outpoint}`,
  ).toBe(dirty.outpoint);
  await manualInput.fill(String(RATE)); // settle back to the clean rate
  await manualInput.press('Tab');

  // ─── THE LOAD-BEARING ASSERTIONS ─────────────────────────────────
  // The notice renders (separate-address wallet, dirty-only pool -> asset-notice).
  const notice = page.getByTestId('mint-asset-notice');
  await expect(
    notice,
    `asset-notice failed: no mint-asset-notice for the ${asset} case (topology mis-derived, or the pool did not classify dirty)`,
  ).toBeVisible({ timeout: 90_000 });

  // It NAMES the specific asset the FIXTURE seeded. The recommended coin IS the
  // seed (asserted above), so its assets are the seed's. dirty.assetId is the
  // seed's OWN value (inscription id / cat id / rune name / sat number), held here
  // and asserted against the rendered text — never an id read back from the page.
  await expect(
    notice,
    `asset-notice for ${asset} did not name the seeded asset ${dirty.assetId}`,
  ).toContainText(dirty.assetId, { timeout: 15_000 });

  // Proceed is allowed: the CTA is ENABLED (this is the separate-address branch).
  const mintBtn = page.getByTestId('mint-btn');
  await expect(
    mintBtn,
    `asset-notice for ${asset}: CTA must stay enabled on a separate-address wallet`,
  ).toBeEnabled({ timeout: 30_000 });

  // Screenshot with the notice and the enabled CTA both in frame — the maintainer
  // review point: enabled is not permission to bury the notice below the fold.
  await shot(page, `${asset}-notice`);
  console.log(`[${tag}] notice shown naming ${dirty.assetId}, CTA enabled`);

  // We do NOT execute the mint here. This is a MULTI-CELL suite sharing one
  // wallet, and a real mint's CLEAN change coin (the asset moves to the cat
  // output, not the change) would leave the NEXT cell no longer dirty-only, so it
  // would take the 'auto' branch and never reach asset-notice. The coordinator's
  // target for this path is exactly the three assertions above (notice visible +
  // asset NAMED + CTA ENABLED); the CTA being enabled proves proceed is allowed.
  // The actual spend-on-proceed is corroborated once, in isolation, by the
  // mint-dirtycoin lane's mint round-trip — not re-run per cell here.
  browserErrorGuard.assertClean();
  await page.close();
}

// dirtySats decreases 12k -> 9k -> 6k -> 3k so each cell's coin is the sole cover
// and no prior ~clean change undercuts it (the shared-wallet sizing trap).
test('mint asset-notice: an INSCRIPTION-only funding pool notices', { timeout: 300_000 }, async () => {
  await runAssetNoticeCell('inscription', 12_000);
});

test('mint asset-notice: a CAT-only funding pool notices', { timeout: 300_000 }, async () => {
  await runAssetNoticeCell('cat', 9_000);
});

test('mint asset-notice: a RUNE-only funding pool notices', { timeout: 300_000 }, async () => {
  await runAssetNoticeCell('rune', 6_000);
});

test('mint asset-notice: a RARE-SAT-only funding pool notices', { timeout: 300_000 }, async () => {
  await runAssetNoticeCell('rareSat', 3_000);
});
