/**
 * JSON result of
 * https://ordinals.com/output/txid:i
 */
export interface TransactionOutputOrd {
  value: number;
  script_pubkey: string;
  address: string;
  transaction: string;
  // always null, if ord does not run with --index-sats
  // also null if not yet indexed by ord
  sat_ranges: [number, number][] | null;
  inscriptions: string[];
  runes: any;

  // see https://github.com/ordinals/ord/pull/2971
  // adds a field to the JSON if the output is already in ord or not
  //
  // There can be a short delay since if the output is in bitcoind and
  // not yet the ord index, it will fall back to asking bitcoind for the
  // output information. So it could be that the block/transaction was still
  // being processed by ord when you made the request so it fell back to
  // asking bitcoind, which obviously did not add the sat ranges.
  // see https://github.com/ordinals/ord/issues/2998#issuecomment-1883778992
  // indexed: boolean; // SOON!
}
