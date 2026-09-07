import { ElectrsClientService } from './electrs-client.service';

/**
 * REAL integration test — NO MOCK. Runs the electrs client against a live
 * regtest electrs (ordpool-electrs fork, Esplora API, default
 * http://127.0.0.1:3010). Runs only in the regtest lane
 * (`npm run test:regtest`), never the pure-unit `npm test`.
 *
 * Why this exists: `getOutpointStatus` decides whether a bid's buyer input
 * is spendable, and both the pruner and POST-time validation act on its
 * answer. A mock can encode whatever `/outspend` shape the author guessed;
 * only a call to real electrs proves the three branches map to the real
 * wire format:
 *   - a fresh, unspent UTXO  → { spent: false } → 'unspent'
 *   - a consumed UTXO        → { spent: true }  → 'spent'
 *   - a txid electrs never saw → HTTP 404       → 'spent' (phantom input)
 *
 * The seeded branches (`unspent` + `spent`) run against a CAT-21 mint the
 * CI workflow seeds into the chain (SEED_MINT_TXID). In CI that env var is
 * always set, so both branches are always exercised; a bare local run
 * without it skips them and still proves the 404 → 'spent' collapse.
 */
const ELECTRS_API_URL = process.env.ELECTRS_API_URL ?? 'http://127.0.0.1:3010';

function realService(): ElectrsClientService {
  // Minimal ConfigService stub: the ONLY thing mocked is config lookup; the
  // electrs HTTP calls are 100% real against the live regtest index.
  return new ElectrsClientService({ getOrThrow: () => ELECTRS_API_URL } as never);
}

/** The one Esplora `/tx/<txid>` field this spec reads: the mint's inputs. */
interface EsploraTxInputRef {
  txid: string;
  vout: number;
}
interface EsploraTx {
  vin: EsploraTxInputRef[];
}

async function fetchTxFromElectrs(txid: string): Promise<EsploraTx> {
  const res = await fetch(`${ELECTRS_API_URL}/tx/${txid}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`electrs /tx/${txid} returned ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<EsploraTx>;
}

describe('ElectrsClientService against a REAL regtest electrs (no mock)', () => {
  const seedMintTxid = process.env.SEED_MINT_TXID;
  const seededIt = seedMintTxid ? it : it.skip;

  seededIt(
    'reports the fresh mint output unspent and the spent-input outpoint spent',
    async () => {
      const txid = seedMintTxid;
      if (!txid) throw new Error('SEED_MINT_TXID must be set for this test');
      const svc = realService();

      // Output 0 is the freshly-minted cat UTXO: confirmed, nobody has
      // spent it → real electrs answers { spent: false }.
      const catOutputStatus = await svc.getOutpointStatus(txid, 0);
      expect(catOutputStatus).toBe('unspent');

      // The funding input the mint consumed is now spent — the exact
      // 'spent' branch the pruner relies on, proven against real electrs.
      const mintTx = await fetchTxFromElectrs(txid);
      const spentInput = mintTx.vin[0];
      if (!spentInput) throw new Error(`mint tx ${txid} has no inputs`);
      const spentInputStatus = await svc.getOutpointStatus(spentInput.txid, spentInput.vout);
      expect(spentInputStatus).toBe('spent');
    },
  );

  it('collapses a txid electrs never saw to spent (404 → spent)', async () => {
    const svc = realService();
    // A phantom txid electrs has no record of: real electrs 404s, and the
    // client treats an unbroadcastable outpoint as 'spent'.
    const phantomTxid = 'ff'.repeat(32);
    const status = await svc.getOutpointStatus(phantomTxid, 0);
    expect(status).toBe('spent');
  });
});
