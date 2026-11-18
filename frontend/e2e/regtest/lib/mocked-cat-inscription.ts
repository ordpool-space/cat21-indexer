import type { Page } from '@playwright/test';
import { cat21OrdCatInscriptionFixture } from 'ordpool-sdk/testing';

/** The cat id the mint specs put on their mocked `/output` answer (`catOutputFixture(MOCKED_CAT_ID)`). */
export const MOCKED_CAT_ID = `${'b'.repeat(64)}i0`;

/** The number the mocked cat carries; the captured regtest answer is cat #2. */
export const MOCKED_CAT_NUMBER = cat21OrdCatInscriptionFixture.number;

/**
 * Answer cat21-ord's `GET /inscription/<MOCKED_CAT_ID>` for a spec that mocks
 * an `/output` carrying `catOutputFixture(MOCKED_CAT_ID)`. The scanner reads a cat's
 * number from that route. On a `--scan stub` lane (`scripts/e2e-lane.sh`) the
 * scanner's cat21-ord URL is the SDK's fees stub, which serves `/output` but
 * not `/inscription`, and the mocked id exists on no chain anyway, so without
 * this the lookup is a 404 for a cat the spec itself invented. The body is the
 * SDK's captured regtest answer (`cat21OrdCatInscriptionFixture`) with the
 * mocked id; any other id is not intercepted.
 */
export async function routeMockedCatInscription(page: Page): Promise<void> {
  await page.route(`**/inscription/${MOCKED_CAT_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ...cat21OrdCatInscriptionFixture, id: MOCKED_CAT_ID }),
    });
  });
}
