import type { BrowserContext } from '@playwright/test';

/**
 * Install a context-level guard that captures uncaught JS exceptions
 * and `console.error` surfaces from every page the context spawns.
 * Call once in `test.beforeAll` right after the context is created;
 * call `resetPerTest()` in `test.beforeEach` and `assertClean()` in
 * `test.afterEach` — any unfiltered browser-side error becomes a test
 * failure per E2E_BEST_PRACTICES.md rule 11.
 *
 * The guard hooks `context.on('page', …)` so tests don't need to know
 * about it at page-creation sites.
 *
 * Filters (kept narrow, all justified inline):
 * - console warnings and info/log/debug levels are ignored; only
 *   `error` and `pageerror` surface here.
 * - specific expected regtest noise can be added via the `ignore`
 *   regex list; keep it tiny and audit every entry when adding.
 */
export function installContextErrorGuard(
  context: BrowserContext,
  options?: { ignore?: readonly RegExp[] },
): { resetPerTest: () => void; assertClean: () => void } {
  const ignore = options?.ignore ?? [];
  let errors: string[] = [];
  const record = (source: 'pageerror' | 'console.error', text: string): void => {
    if (ignore.some((re) => re.test(text))) return;
    errors.push(`[${source}] ${text}`);
  };
  context.on('page', (page) => {
    page.on('pageerror', (err) => {
      record('pageerror', `${err.message}${err.stack ? '\n' + err.stack : ''}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        record('console.error', msg.text());
      }
    });
  });
  return {
    resetPerTest(): void {
      errors = [];
    },
    assertClean(): void {
      if (errors.length > 0) {
        const list = errors.join('\n\n');
        errors = [];
        throw new Error(`Browser surfaced ${errors.length + 1} unfiltered error(s):\n\n${list}`);
      }
    },
  };
}
