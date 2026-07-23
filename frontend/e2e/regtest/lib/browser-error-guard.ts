import type { BrowserContext, Page } from '@playwright/test';

/**
 * Install a context-level guard that captures uncaught JS exceptions
 * and `console.error` surfaces from every OUR-APP page the context
 * spawns. Any unfiltered browser-side error becomes a test failure
 * per E2E_BEST_PRACTICES.md rule 11.
 *
 * The guard hooks `context.on('page', …)` so tests don't need to
 * know about it at page-creation sites. Wallet-extension pages
 * (chrome-extension://…) are IGNORED — those bundles carry their
 * own JS errors (Bitflow SDK init, extension-side promise handling)
 * that have nothing to do with our app and would otherwise cascade-
 * fail every test that briefly touches the extension.
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
  const isOurApp = (page: Page): boolean => {
    const url = page.url();
    return url !== '' && !url.startsWith('chrome-extension://') && !url.startsWith('about:');
  };
  const record = (source: 'pageerror' | 'console.error', text: string): void => {
    if (ignore.some((re) => re.test(text))) return;
    errors.push(`[${source}] ${text}`);
  };
  context.on('page', (page) => {
    page.on('pageerror', (err) => {
      if (!isOurApp(page)) return;
      record('pageerror', `${err.message}${err.stack ? '\n' + err.stack : ''}`);
    });
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (!isOurApp(page)) return;
      record('console.error', msg.text());
    });
  });
  return {
    resetPerTest(): void {
      errors = [];
    },
    assertClean(): void {
      if (errors.length === 0) return;
      const list = errors.join('\n\n');
      const n = errors.length;
      errors = [];
      throw new Error(`Browser surfaced ${n} unfiltered error(s):\n\n${list}`);
    },
  };
}
