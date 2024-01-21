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
  sat_ranges: [number, number][] | null;
  inscriptions: string[];
  runes: any;
}
