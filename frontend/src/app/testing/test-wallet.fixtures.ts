import { jest } from '@jest/globals';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { KnownOrdinalWalletType, TxnOutput, WalletInfo } from 'ordpool-sdk';

/**
 * A connected wallet whose keys the spec holds, so the SDK orchestrators run
 * for real against it: they derive input scripts from its public keys, and the
 * fake wallet provider below signs with its private keys. Every address is a
 * real mainnet address of those keys.
 */

const PAYMENT_KEY = hex.decode('11'.repeat(32));
const ORDINALS_KEY = hex.decode('12'.repeat(32));

const payment = btc.p2wpkh(secp256k1.getPublicKey(PAYMENT_KEY, true), btc.NETWORK);
const ordinals = btc.p2tr(schnorr.getPublicKey(ORDINALS_KEY), undefined, btc.NETWORK);

export const TEST_PAYMENT_ADDRESS = payment.address!;
export const TEST_ORDINALS_ADDRESS = ordinals.address!;
export const TEST_PAYMENT_PUBLIC_KEY = hex.encode(secp256k1.getPublicKey(PAYMENT_KEY, true));
export const TEST_ORDINALS_PUBLIC_KEY = hex.encode(schnorr.getPublicKey(ORDINALS_KEY));
/** The test wallet's ordinals output script: a cat it holds sits on this. */
export const TEST_ORDINALS_SCRIPT = ordinals.script;

/**
 * Cat21 Wallet, separate payment and ordinals addresses. `over` may replace
 * any field; a replaced address keeps the test keys behind it.
 */
export function testWallet(over: Partial<WalletInfo> = {}): WalletInfo {
  return {
    type: KnownOrdinalWalletType.cat21wallet,
    ordinalsAddress: TEST_ORDINALS_ADDRESS,
    paymentAddress: TEST_PAYMENT_ADDRESS,
    paymentPublicKey: TEST_PAYMENT_PUBLIC_KEY,
    ordinalsPublicKey: TEST_ORDINALS_PUBLIC_KEY,
    signingSupported: true,
    ...over,
  } as WalletInfo;
}

/** Unisat, one address for payments and ordinals (the test payment address). */
export function oneAddressTestWallet(over: Partial<WalletInfo> = {}): WalletInfo {
  return testWallet({
    type: KnownOrdinalWalletType.unisat,
    ordinalsAddress: TEST_PAYMENT_ADDRESS,
    paymentAddress: TEST_PAYMENT_ADDRESS,
    ...over,
  });
}

/**
 * A confirmed coin at the test payment address, the shape electrs returns
 * through `Cat21Service.getUtxos`. `tag` (1..255) makes the txid distinct.
 */
export function fundingCoin(value: number, tag: number, vout = 0): TxnOutput {
  return {
    txid: tag.toString(16).padStart(2, '0').repeat(32),
    vout,
    value,
    status: { confirmed: true, block_height: 800_000, block_hash: 'b'.repeat(64), block_time: 1_700_000_000 },
  };
}

/** What the fake wallet was asked to sign, per request. */
export interface FakeSignRequest {
  method: string;
  signAtIndex: number[];
  network: unknown;
}

/**
 * The Cat21 Wallet's injected provider (`window.Cat21Provider`), the wallet
 * API the SDK's cat21wallet signer talks to. Signs every `signAtIndex` input
 * with the test key that owns its script and answers `{ result: { hex } }`, as
 * the extension does. `rejectWith` makes the next request fail the way a
 * user's "Cancel" does.
 */
export function installFakeCat21Provider() {
  const requests: FakeSignRequest[] = [];
  let rejection: Error | null = null;
  const win = window as unknown as { Cat21Provider?: unknown };
  const previous = win.Cat21Provider;

  win.Cat21Provider = {
    isCat21: true,
    request: jest.fn(async (method: string, params?: unknown) => {
      const p = params as { hex: string; signAtIndex: number | number[]; network: unknown };
      const indexes = Array.isArray(p.signAtIndex) ? p.signAtIndex : [p.signAtIndex];
      requests.push({ method, signAtIndex: indexes, network: p.network });
      if (rejection) {
        const err = rejection;
        rejection = null;
        throw err;
      }
      if (method !== 'signPsbt') throw new Error(`fake Cat21Provider: unsupported method ${method}`);
      const tx = btc.Transaction.fromPSBT(hex.decode(p.hex), { allowUnknownInputs: true, allowUnknownOutputs: true });
      for (const i of indexes) {
        const script = tx.getInput(i).witnessUtxo?.script;
        if (script && hex.encode(script) === hex.encode(ordinals.script)) {
          if (!tx.getInput(i).tapInternalKey) tx.updateInput(i, { tapInternalKey: schnorr.getPublicKey(ORDINALS_KEY) });
          tx.signIdx(ORDINALS_KEY, i, [btc.SigHash.DEFAULT, btc.SigHash.ALL]);
        } else {
          tx.signIdx(PAYMENT_KEY, i, [btc.SigHash.ALL]);
        }
      }
      return { result: { hex: hex.encode(tx.toPSBT()) } };
    }),
  };

  return {
    requests,
    rejectWith(err: Error): void {
      rejection = err;
    },
    restore(): void {
      win.Cat21Provider = previous;
    },
  };
}
