import { defineConfig } from '@playwright/test';
import * as path from 'node:path';
import { E2E_TIMEOUT_ENV } from 'ordpool-sdk/e2e';

/**
 * The per-wait bound (TESTING.md): every assertion, `expect.poll`, action,
 * navigation and page event, and, through ORDPOOL_E2E_TIMEOUT_MS, every SDK
 * polling helper (electrs, ord, bitcoind, a wallet popup search). A state that
 * needs longer to arrive is a defect in the app or the harness, fixed there,
 * never by raising this bound.
 */
const WAIT_TIMEOUT_MS = 30_000;
process.env[E2E_TIMEOUT_ENV] = String(WAIT_TIMEOUT_MS);

/**
 * The per-test bound. A test is a sequence of waits, not one wait.
 * Twice the longest green test: 181.1 s, "make-offer dirty-coin guard: a RUNE
 * funding coin is not spent" in cat21-indexer run 38055629649 (180.5 s in run
 * 38043788789).
 */
const TEST_TIMEOUT_MS = 365_000;

/**
 * Playwright config for the cat21.space regtest suite.
 *
 * scripts/e2e-lane.sh brings up the consumer-environment stack in a stack
 * slot (bitcoind, electrs, mariadb, and per lane cat21-ord / ord-stock), the
 * cat21-indexer backend, the SDK's fees-electrs-stub, serves the built
 * frontend, then invokes this config; the specs read every port from the slot
 * (`regtestServiceUrls`).
 *
 * Headless mode is off because wallet extensions need a real renderer; on a
 * display-less Linux runner the lane script runs Playwright under xvfb.
 */
export default defineConfig({
  testDir: path.resolve(__dirname, 'e2e/regtest'),
  testMatch: '**/*.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  // Zero retries: the specs share on-chain state and module-scope variables
  // set by earlier tests, and a cell that needs a retry is an open question
  // the lane should report on its first run.
  retries: 0,
  timeout: TEST_TIMEOUT_MS,
  expect: {
    timeout: WAIT_TIMEOUT_MS,
  },
  use: {
    headless: false,
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: WAIT_TIMEOUT_MS,
    navigationTimeout: WAIT_TIMEOUT_MS,
  },
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { outputFolder: 'playwright-report-regtest', open: 'never' }],
  ],
  outputDir: path.resolve(__dirname, 'test-results'),
});
