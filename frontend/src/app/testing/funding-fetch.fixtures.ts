import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import {
  Cat21SdkConfig,
  OutputFixture,
  TxnOutput,
  recommendedFeesFixture,
} from 'ordpool-sdk';

/**
 * The network boundary of the SDK's `Cat21Service` and `UtxoContentScanner`,
 * faked at `fetch`, so a spec runs both classes for real: electrs' UTXO list
 * (`GET <mempool>/api/address/<a>/utxo`, `TxnOutput[]`, rows built from the
 * SDK's captured `electrsConfirmedUtxoFixture` / `electrsUnconfirmedUtxoFixture`,
 * as `fundingCoin` does), the fee tiers (`GET <mempool>/api/v1/fees/recommended`,
 * the SDK's `recommendedFeesFixture`), the per-outpoint `/output` answers of ord
 * and cat21-ord (the SDK's `OutputFixture` builders: `cleanOutputFixture`,
 * `inscribedOutputFixture`, `notIndexedOutputFixture`, ...), cat21-ord's
 * `GET /inscription/<id>` (where the scanner reads a cat's number; the SDK's
 * captured `cat21OrdCatInscriptionFixture`) and the broadcast
 * (`POST <mempool>/api/tx` with the raw tx hex as the body, answered with the
 * txid as plain text, as esplora's `POST /tx` does). A URL nothing here answers
 * is recorded in `unexpected` and fails with 404, so a spec can assert the page
 * asked for nothing else.
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
  /**
   * Set what cat21-ord answers for `GET /inscription/<id>`: a body (200) or
   * `'not-found'` (404, the scanner then shows the cat without a number).
   */
  setInscription(id: string, answer: unknown): void;
  /** Every URL fetched, in order. */
  readonly calls: string[];
  /** URLs nothing here answers. */
  readonly unexpected: string[];
  /** Raw tx hex of every `POST <mempool>/api/tx`, in order. */
  readonly broadcasts: string[];
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
  const inscriptions = new Map<string, unknown>();
  const calls: string[] = [];
  const unexpected: string[] = [];
  const broadcasts: string[] = [];

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
    const inscriptionPrefix = `${config.cat21OrdApiUrl}/inscription/`;
    if (url.startsWith(inscriptionPrefix)) {
      return inscriptions.get(url.slice(inscriptionPrefix.length));
    }
    const cat21OrdPrefix = `${config.cat21OrdApiUrl}/output/`;
    if (url.startsWith(cat21OrdPrefix)) {
      return outputs.get(url.slice(cat21OrdPrefix.length))?.cat21Ord;
    }
    return undefined;
  }

  const g = globalThis as { fetch?: typeof fetch };
  const original = g.fetch;
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (init?.method === 'POST' && url === `${config.mempoolApiUrl}/api/tx`) {
      const txHex = String(init.body);
      broadcasts.push(txHex);
      return reply(200, btc.Transaction.fromRaw(hex.decode(txHex), { allowUnknownOutputs: true }).id);
    }
    const body = answer(url);
    if (body === 'not-found') {
      return reply(404, `not found: ${url}`);
    }
    if (body === undefined) {
      unexpected.push(url);
      return reply(404, `not faked: ${url}`);
    }
    return reply(200, body);
  }) as typeof fetch;

  return {
    setUtxos: (address, list) => utxos.set(address, list),
    setOutput: (outpoint, fixture) => outputs.set(outpoint, fixture),
    setInscription: (id, answer) => inscriptions.set(id, answer),
    calls,
    unexpected,
    broadcasts,
    restore: () => {
      g.fetch = original;
    },
  };
}
