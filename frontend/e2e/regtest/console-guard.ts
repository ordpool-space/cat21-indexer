import type { Page } from '@playwright/test';

/**
 * Errors that are known noise on regtest and should not fail a spec:
 *   - 4xx/5xx from missing endpoints the regtest stack doesn't serve
 *     (mempool /api/v1/prices, ordpool-backend metrics, etc.)
 *   - `net::ERR_*` network failures from the same class of misses.
 * Anything not matched here surfaces as a test failure — rule §11 of
 * ~/Work/ordpool/E2E_BEST_PRACTICES.md ("browser errors fail the
 * test").
 */
const IGNORED_CONSOLE: RegExp[] = [
  /Failed to load resource:.*(404|net::ERR_)/,
];

export interface BrowserErrorGuard {
  /** Every unfiltered console.error + pageerror the page has surfaced so far. */
  errors: string[];
  /** Throws if `errors` is non-empty; call once at end of test after positive assertions. */
  assertNone(): void;
}

/**
 * Install a browser-error collector on `page`. Wire up once right
 * after `context.newPage()`; call `.assertNone()` at the end of the
 * test after positive assertions. Every JS regression the flow
 * uncovers becomes a hard failure instead of scrolling past in stdout.
 */
export function installBrowserErrorGuard(page: Page): BrowserErrorGuard {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return {
    errors,
    assertNone(): void {
      if (errors.length === 0) return;
      throw new Error(
        `Test passed positive assertions but ${errors.length} unfiltered browser error(s) surfaced:\n  - ${errors.join('\n  - ')}`,
      );
    },
  };
}
