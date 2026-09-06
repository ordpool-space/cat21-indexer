import { OrdClientService } from './ord-client.service';

/**
 * REAL integration test — NO MOCK. Runs the ord client against a live regtest
 * cat21-ord (from ordpool-sdk/e2e/docker-compose.regtest.yml, default
 * http://127.0.0.1:8080). Runs only in the regtest lane
 * (`npm run test:regtest`), never the pure-unit `npm test`.
 *
 * Why this exists: `getCatsAtOutput` shipped broken and green because its only
 * coverage mocked cat21-ord returning cat NUMBERS (`[42]`), while real
 * cat21-ord returns inscription-id STRINGS (`<txid>i<n>`). The mock encoded the
 * same wrong assumption as the code, so every unit test agreed with the bug.
 * A mock can never catch a wrong-contract bug; only a call to the real
 * dependency can. This is that call.
 */
const ORD_API_URL = process.env.ORD_API_URL ?? 'http://127.0.0.1:8080';

function realService(): OrdClientService {
  // Minimal ConfigService stub: the ONLY thing mocked is config lookup; the
  // ord HTTP calls are 100% real against the live regtest index.
  return new OrdClientService({ getOrThrow: () => ORD_API_URL } as never);
}

describe('OrdClientService against a REAL regtest cat21-ord (no mock)', () => {
  it('getCatsAtOutput maps a real cat UTXO to its real cat number', async () => {
    const svc = realService();

    // Discover a real cat straight from the live index — no fixture, no mock.
    const latest = await svc.getLatestCatNumber();
    expect(latest).toBeGreaterThanOrEqual(0);

    const cat = await svc.getCat(latest);
    if (!cat) throw new Error(`cat21-ord has no cat #${latest}`);

    // Its live on-chain location gives the exact outpoint the cat rides.
    const loc = await svc.getCatCurrentLocation(latest);
    if (!loc) throw new Error(`cat #${latest} has no current location on cat21-ord`);

    // The regression: this returned [] against real ord because /output `cats`
    // are inscription-id strings, not numbers. Proven now against real ord.
    const cats = await svc.getCatsAtOutput(loc.txid, loc.vout);
    expect(cats).toContain(latest);
  });
});
