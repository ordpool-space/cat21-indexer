import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import { TEST_ORDINALS_SCRIPT, TEST_PAYMENT_ADDRESS } from './test-wallet.fixtures';

/**
 * A real buy-offer PSBT as a buyer's wallet hands it to the seller: input 0 is
 * the seller's cat UTXO on the test wallet's ordinals address (unsigned),
 * input 1 the buyer's funding coin (signed SIGHASH_ALL by a buyer key the spec
 * holds), output 0 carries the cat to the buyer, output 1 pays the seller
 * `price + cat value`, output 2 is the buyer's change. Built and signed with
 * @scure/btc-signer.
 */

const BUYER_PAYMENT_KEY = hex.decode('21'.repeat(32));
const BUYER_ORDINALS_KEY = hex.decode('22'.repeat(32));
const buyerPayment = btc.p2wpkh(secp256k1.getPublicKey(BUYER_PAYMENT_KEY, true), btc.NETWORK);

export const BUYER_PAYMENT_ADDRESS = buyerPayment.address!;
export const BUYER_ORDINALS_ADDRESS = btc.p2tr(schnorr.getPublicKey(BUYER_ORDINALS_KEY), undefined, btc.NETWORK).address!;

export interface OfferPsbtOptions {
  /** The seller's cat UTXO. */
  cat: { txid: string; vout: number; value: number };
  priceSats: number;
  /** Where output 1 pays. Default: the test wallet's payment address. */
  sellerPaymentAddress?: string;
}

export function buildOfferPsbt(opts: OfferPsbtOptions): string {
  const tx = new btc.Transaction({ lockTime: 21 });
  tx.addInput({
    txid: opts.cat.txid,
    index: opts.cat.vout,
    witnessUtxo: { script: TEST_ORDINALS_SCRIPT, amount: BigInt(opts.cat.value) },
    sighashType: btc.SigHash.ALL,
  });
  tx.addInput({
    txid: 'cd'.repeat(32),
    index: 0,
    witnessUtxo: { script: buyerPayment.script, amount: BigInt(opts.priceSats + 50_000) },
    sighashType: btc.SigHash.ALL,
  });
  const out = (address: string, amount: number) =>
    tx.addOutput({ script: btc.OutScript.encode(btc.Address(btc.NETWORK).decode(address)), amount: BigInt(amount) });
  out(BUYER_ORDINALS_ADDRESS, opts.cat.value);
  out(opts.sellerPaymentAddress ?? TEST_PAYMENT_ADDRESS, opts.priceSats + opts.cat.value);
  out(BUYER_PAYMENT_ADDRESS, 40_000);
  tx.signIdx(BUYER_PAYMENT_KEY, 1, [btc.SigHash.ALL]);
  return base64.encode(tx.toPSBT());
}
