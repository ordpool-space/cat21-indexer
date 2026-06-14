/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { waitForApprovalPopup } from './sdk-lib/approval-popup';

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

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_PASSWORD = 'correct-horse-battery-staple-Tr0ub4dor-9876';

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');

const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let extensionId: string;

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21wallet-mint-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
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

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  extensionId = worker.url().split('/')[2];

  const primer = await context.newPage();
  await onboardCat21Wallet(primer);
  await shot(primer, '00-onboarded');
  await primer.close();
});

test.afterAll(async () => {
  await context?.close();
});

test('cat21-wallet appears in the picker and the connect approval round-trips', async () => {
  test.setTimeout(180_000);

  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '01-page-loaded');

  const cta = page.locator('[data-testid="mint-cta"]');
  await expect(cta).toBeVisible({ timeout: 30_000 });

  // CRITICAL ordering — snapshot existing pages BEFORE the connect
  // click. The Xverse spec hit this race three times before the fix
  // (see `e2e(regtest mint): fix the test-1 connect-popup race`
  // commit on cat21-indexer). CAT-21 wallet's approval popup spawns
  // synchronously the same way.
  const knownPagesBeforeConnect = new Set(context.pages());

  await page.locator('button.wallet-button-connect').first().click();

  // Picker modal — CAT-21 wallet sits in the "installed" section at
  // the top of the modal. The wallet card isn't a `<button>` element
  // — it's a clickable container — so `getByRole('button', …)`
  // doesn't find it. Match the visible label text instead. The
  // label wraps across two lines in the modal layout ("Cat21" and
  // "Wallet" on separate lines), so use a regex with `\s+` which
  // covers the whitespace between them.
  // The picker renders the wallet name inline with its description
  // on a single line ("CAT-21 wallet Our own — hot wallet…"), so a
  // `$`-anchored regex misses. Match by substring.
  const cat21Picker = page.getByText(/CAT-21\s+wallet/i).first();
  await expect(cat21Picker).toBeVisible({ timeout: 20_000 });
  await cat21Picker.click({ timeout: 20_000 });
  await shot(page, '02-picker-clicked');

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
  await shot(approvalConnect, '03-connect-approval');
  await approvalConnect.getByTestId('get-addresses-approve-button').click();
  // DO NOT explicitly `.close()` the popup — cat21-wallet's
  // `userApprovesGetAddresses` runs a ~400 ms animation BEFORE
  // sending the addresses back. Manual close cuts the dispatch
  // (run 27502018547 trace.zip showed click→close = 44 ms gap).
  await approvalConnect.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);

  // The connect CTA card disappears once the wallet is in
  // `connectedWallet`-bound signal scope. The mint section
  // (`mint-fee-section`) renders in its place — pin that.
  const feeSection = page.locator('[data-testid="mint-fee-section"]');
  await expect(feeSection).toBeVisible({ timeout: 30_000 });
  await shot(page, '04-connected');
});
