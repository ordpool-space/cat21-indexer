import {
  Cat21SdkConfig,
  OutputFixture,
  TxnOutput,
  recommendedFeesFixture,
} from 'ordpool-sdk';

/**
 * The network boundary of the SDK's `Cat21Service` and `UtxoContentScanner`,
 * faked at `fetch`, so a spec runs both classes for real: electrs' UTXO list
 * (`GET <mempool>/api/address/<a>/utxo`, `TxnOutput[]`), the fee tiers
 * (`GET <mempool>/api/v1/fees/recommended`, the SDK's `recommendedFeesFixture`)
 * and the per-outpoint `/output` answers of ord and cat21-ord (the SDK's
 * `OutputFixture` builders: `cleanOutputFixture`, `inscribedOutputFixture`,
 * `notIndexedOutputFixture`, ...). A URL nothing here answers is recorded in
 * `unexpected` and fails with 404, so a spec can assert the page asked for
 * nothing else.
 */
export const FUNDING_TEST_CONFIG: Cat21SdkConfig = {
  mempoolApiUrl: 'http://electrs.test',
  cat21ApiUrl: 'http://cat21-api.test',
  ordApiUrl: 'http://ord.test',
  cat21OrdApiUrl: 'http://cat21-ord.test',
};

export interface FundingFetch {
  /** Set what electrs lists at `address`. */
  setUtxos(address: string, utxos: TxnOutput[]): void;
  /** Set what ord and cat21-ord answer for `outpoint` (`txid:vout`). */
  setOutput(outpoint: string, fixture: OutputFixture): void;
  /** Every URL fetched, in order. */
  readonly calls: string[];
  /** URLs nothing here answers. */
  readonly unexpected: string[];
  restore(): void;
}

/** The parts of a fetch `Response` that the SDK's `fetchJson` reads. */
function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

export function installFundingFetch(config: Cat21SdkConfig = FUNDING_TEST_CONFIG): FundingFetch {
  const utxos = new Map<string, TxnOutput[]>();
  const outputs = new Map<string, OutputFixture>();
  const calls: string[] = [];
  const unexpected: string[] = [];

  function answer(url: string): unknown {
    if (url === `${config.mempoolApiUrl}/api/v1/fees/recommended`) {
      return recommendedFeesFixture();
    }
    const utxoMatch = url.match(/\/api\/address\/([^/]+)\/utxo$/);
    if (utxoMatch && url.startsWith(config.mempoolApiUrl)) {
      return utxos.get(utxoMatch[1]) ?? [];
    }
    const ordPrefix = `${config.ordApiUrl}/output/`;
    if (url.startsWith(ordPrefix)) {
      return outputs.get(url.slice(ordPrefix.length))?.ord;
    }
    const cat21OrdPrefix = `${config.cat21OrdApiUrl}/output/`;
    if (url.startsWith(cat21OrdPrefix)) {
      return outputs.get(url.slice(cat21OrdPrefix.length))?.cat21Ord;
    }
    return undefined;
  }

  const g = globalThis as { fetch?: typeof fetch };
  const original = g.fetch;
  g.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const body = answer(url);
    if (body === undefined) {
      unexpected.push(url);
      return reply(404, `not faked: ${url}`);
    }
    return reply(200, body);
  }) as typeof fetch;

  return {
    setUtxos: (address, list) => utxos.set(address, list),
    setOutput: (outpoint, fixture) => outputs.set(outpoint, fixture),
    calls,
    unexpected,
    restore: () => {
      g.fetch = original;
    },
  };
}
