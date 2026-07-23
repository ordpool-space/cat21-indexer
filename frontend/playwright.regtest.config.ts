import { defineConfig } from '@playwright/test';
import * as path from 'node:path';

/**
 * Playwright config for the cat21.space regtest mint round-trip suite.
 *
 * CI-only. The workflow brings up the consumer-environment stack
 * (bitcoind + electrs + mariadb) plus ordpool-backend on :8999,
 * serves cat21-indexer/frontend, downloads + unpacks the Xverse
 * `.crx` via the SDK's playwright-bootstrap.sh, and runs the SDK's
 * globalSetup to seed an Xverse vault — then invokes this config.
 *
 * Headless mode is off because wallet extensions need a real
 * renderer; the workflow runs the playwright invocation under
 * xvfb to provide a display.
 */
export default defineConfig({
  testDir: path.resolve(__dirname, 'e2e/regtest'),
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // Zero retries: the specs share state via module-scope variables
  // (sharedPaymentAddress, sharedMintTxid) set by the first test.
  // Playwright's retry destroys the worker and re-spawns it, losing
  // that module scope — subsequent tests then all fail with
  // "first test must have set sharedPaymentAddress". One clean pass
  // is the right primitive; transient browser flakes get investigated
  // and fixed rather than papered over with a retry.
  retries: 0,
  // Default budget for a regtest-touching test: chain mine + electrs sync
  // + wallet approval popup + mint/broadcast is ~3-6 min end-to-end. 7 min
  // gives ~1 min of headroom for CI flakiness. Individual quick tests
  // (route assertions, non-broadcast flows) tighten via
  // `test('name', { timeout: N }, ...)` in the spec declaration —
  // scattered `test.setTimeout(...)` calls inside test bodies are the
  // pattern E2E_BEST_PRACTICES.md rule 10 rules out.
  timeout: 420_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    headless: false,
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { outputFolder: 'playwright-report-regtest', open: 'never' }],
  ],
  outputDir: path.resolve(__dirname, 'test-results'),
});
