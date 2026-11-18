import type { Page } from '@playwright/test';
import { catOutputFixture } from 'ordpool-sdk/core';

/** The cat id the mint specs put on their mocked `/output` answer. */
export const MOCKED_CAT_ID = `${'b'.repeat(64)}i0`;

/**
 * The mint specs' mocked cat coin, from one SDK fixture: the ord and cat21-ord
 * `/output` answers plus cat21-ord's `/inscription/<id>` answer for the same
 * cat (`catInscription`, carrying its number), so the three cannot disagree.
 */
export const MOCKED_CAT = catOutputFixture(MOCKED_CAT_ID);

/**
 * Answer cat21-ord's `GET /inscription/<MOCKED_CAT_ID>` with `MOCKED_CAT`'s
 * `catInscription`, beside a spec's mocked `/output` for that cat. The scan
 * reads the cat's number there. On a `--scan stub` lane (`scripts/e2e-lane.sh`)
 * the scanner's cat21-ord URL is the SDK's fees stub, which serves `/output`
 * but not `/inscription`, and the mocked id exists on no chain anyway, so
 * without this the lookup is a 404 for a cat the spec itself invented. Any
 * other id is not intercepted.
 */
export async function routeMockedCatInscription(page: Page): Promise<void> {
  await page.route(`**/inscription/${MOCKED_CAT_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(MOCKED_CAT.catInscription),
    });
  });
}
