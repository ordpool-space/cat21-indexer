import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { secp256k1, schnorr } from '@noble/curves/secp256k1';

/**
 * Real buy-offer PSBTs for the bids specs, built and signed with
 * `@scure/btc-signer` the way a buyer's wallet hands one to the marketplace:
 * input 0 is the seller's cat UTXO (unsigned), inputs 1..N are the buyer's
 * funding coins (signed), output 0 carries the cat to the buyer, output 1 pays
 * the seller `price + cat value`, output 2 is the buyer's change.
 *
 * About this app only: the spec-side shape of a cat21.space bid. The keys are
 * fixed test scalars, so every address below is a real, decodable mainnet
 * address whose key the spec holds.
 */

const BUYER_PAYMENT_KEY = hex.decode('01'.repeat(32));
const BUYER_ORDINALS_KEY = hex.decode('02'.repeat(32));
const SELLER_PAYMENT_KEY = hex.decode('03'.repeat(32));
const SELLER_ORDINALS_KEY = hex.decode('04'.repeat(32));

const buyerPayment = btc.p2wpkh(secp256k1.getPublicKey(BUYER_PAYMENT_KEY, true), btc.NETWORK);
const buyerOrdinals = btc.p2tr(schnorr.getPublicKey(BUYER_ORDINALS_KEY), undefined, btc.NETWORK);
const sellerPayment = btc.p2wpkh(secp256k1.getPublicKey(SELLER_PAYMENT_KEY, true), btc.NETWORK);
const sellerOrdinals = btc.p2tr(schnorr.getPublicKey(SELLER_ORDINALS_KEY), undefined, btc.NETWORK);

export const BUYER_PAYMENT_ADDRESS = buyerPayment.address!;
export const BUYER_ORDINALS_ADDRESS = buyerOrdinals.address!;
export const SELLER_PAYMENT_ADDRESS = sellerPayment.address!;
/** A valid address that is none of the above, for "pays somewhere else". */
export const STRANGER_ADDRESS = btc.p2wpkh(secp256k1.getPublicKey(hex.decode('05'.repeat(32)), true), btc.NETWORK).address!;

export interface BuyOfferPsbtOptions {
  sellerUtxo: { txid: string; vout: number; value: number };
  /** The buyer's funding coins, all signed by the buyer's payment key. */
  buyerFunding?: { txid: string; vout: number; value: number }[];
  /** Outputs in order. Default: cat to the buyer, price + cat value to the seller, change to the buyer. */
  outputs?: { address: string; amount: number }[];
  /** Price the default outputs pay the seller. */
  priceSats?: number;
  /** Sighash the buyer signs with. Default SIGHASH_ALL. */
  buyerSighash?: number;
}

/** A fresh, never-spent-looking funding txid per index. */
export function fundingTxid(n: number): string {
  return n.toString(16).padStart(2, '0').repeat(32);
}

export function buildBuyOfferPsbt(opts: BuyOfferPsbtOptions): { base64: string; bytes: Uint8Array } {
  const priceSats = opts.priceSats ?? 21_000;
  const buyerFunding = opts.buyerFunding ?? [{ txid: fundingTxid(0xaa), vout: 1, value: 100_000 }];
  const sighash = opts.buyerSighash ?? btc.SigHash.ALL;
  const outputs = opts.outputs ?? [
    { address: BUYER_ORDINALS_ADDRESS, amount: opts.sellerUtxo.value },
    { address: SELLER_PAYMENT_ADDRESS, amount: priceSats + opts.sellerUtxo.value },
    { address: BUYER_PAYMENT_ADDRESS, amount: 10_000 },
  ];

  const tx = new btc.Transaction({ lockTime: 21, allowUnknownOutputs: true });
  tx.addInput({
    txid: opts.sellerUtxo.txid,
    index: opts.sellerUtxo.vout,
    witnessUtxo: { script: sellerOrdinals.script, amount: BigInt(opts.sellerUtxo.value) },
    tapInternalKey: schnorr.getPublicKey(SELLER_ORDINALS_KEY),
    sighashType: btc.SigHash.ALL,
  });
  for (const coin of buyerFunding) {
    tx.addInput({
      txid: coin.txid,
      index: coin.vout,
      witnessUtxo: { script: buyerPayment.script, amount: BigInt(coin.value) },
      sighashType: sighash,
    });
  }
  for (const out of outputs) {
    tx.addOutput({ script: btc.OutScript.encode(btc.Address(btc.NETWORK).decode(out.address)), amount: BigInt(out.amount) });
  }
  for (let i = 1; i <= buyerFunding.length; i++) {
    tx.signIdx(BUYER_PAYMENT_KEY, i, [sighash]);
  }
  const bytes = tx.toPSBT();
  return { base64: base64.encode(bytes), bytes };
}
