/**
 * JSON result of
 * https://ordinals.com/output/txid:i
 */
export interface TransactionOutputOrd {
  value: number;
  script_pubkey: string;
  address: string;
  transaction: string;
  sat_ranges: [number, number][];
  inscriptions: string[];
  runes: any;
}
