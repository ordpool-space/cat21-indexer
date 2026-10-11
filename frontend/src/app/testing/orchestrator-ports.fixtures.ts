import { jest } from '@jest/globals';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import { Network, TxnOutput, UtxoAssetDetail, UtxoClassification } from 'ordpool-sdk';

/**
 * The IO ports the SDK orchestrators are constructed with (`getUtxos`, `scan`,
 * `broadcast`), faked at their boundary so a spec runs the REAL orchestrator:
 * electrs' UTXO list, ord's content verdict per outpoint, and the broadcast
 * answer. Shapes are the SDK's port types (`TxnOutput`, `UtxoClassification`,
 * a txid string). `fundingTopology: 'derive'` is what cat21.space wires.
 */
export interface FakePorts {
  getUtxos: jest.Mock<(paymentAddress: string) => Promise<TxnOutput[]>>;
  scan: { classify: jest.Mock<(outpoint: string) => Promise<UtxoClassification>> };
  broadcast: jest.Mock<(signedTxHex: string) => Promise<string>>;
  network: Network;
  fundingTopology: 'derive';
  /** Replace the coins the next `getUtxos` answers with. */
  setCoins(coins: TxnOutput[]): void;
  /** Content verdict for one outpoint; an Error makes `classify` reject (a failed scan). */
  setVerdict(outpoint: string, verdict: UtxoClassification | Error): void;
  /** Hold every `getUtxos` call until `release` (a slow electrs), or make it fail. */
  holdUtxos(): { release(): void; fail(err: Error): void };
}

/** An asset-bearing verdict naming one inscription, as ord + cat21-ord report it. */
export function assetsVerdict(detail: Partial<UtxoAssetDetail> = {}): UtxoClassification {
  return {
    verdict: 'has-assets',
    assets: { inscriptionIds: [], runeNames: [], catIds: [], rareSat: null, ...detail },
  };
}

export function fakePorts(coins: TxnOutput[] = []): FakePorts {
  let current = coins;
  const verdicts = new Map<string, UtxoClassification | Error>();
  let gate: Promise<void> | null = null;

  const ports: FakePorts = {
    getUtxos: jest.fn(async (_paymentAddress: string) => {
      if (gate) await gate;
      return current;
    }),
    scan: {
      classify: jest.fn(async (outpoint: string) => {
        const v = verdicts.get(outpoint) ?? 'clean';
        if (v instanceof Error) throw v;
        return v;
      }),
    },
    // Answers the txid of the transaction it was handed, as electrs' POST /tx does.
    broadcast: jest.fn(async (signedTxHex: string) => btc.Transaction.fromRaw(hex.decode(signedTxHex), { allowUnknownOutputs: true }).id),
    network: Network.Mainnet,
    fundingTopology: 'derive',
    setCoins(next) {
      current = next;
    },
    setVerdict(outpoint, verdict) {
      verdicts.set(outpoint, verdict);
    },
    holdUtxos() {
      let release!: () => void;
      let fail!: (err: Error) => void;
      gate = new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
      const held = gate;
      return {
        release: () => { release(); if (gate === held) gate = null; },
        fail: (err) => { held.catch(() => undefined); fail(err); if (gate === held) gate = null; },
      };
    },
  };
  return ports;
}
