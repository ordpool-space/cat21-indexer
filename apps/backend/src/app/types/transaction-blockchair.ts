/**
 * Bitcoin Transaction in the format of the Blockchair API
 */
export interface TransactionBlockchair {
  block_id: number;
  id: number;
  hash: string;
  date: string;
  time: string;
  size: number;
  weight: number;
  version: number;
  lock_time: number;
  is_coinbase: boolean;
  has_witness: boolean;
  input_count: number;
  output_count: number;
  input_total: number;
  input_total_usd: number;
  output_total: number;
  output_total_usd: number;
  fee: number;
  fee_usd: number;
  fee_per_kb: number;
  fee_per_kb_usd: number;
  fee_per_kwu: number;
  fee_per_kwu_usd: number;
  cdd_total: number;
}

export interface ContextBlockchair {
  code: number;
  source: string;
  limit: number;
  offset: number;
  rows: number;
  total_rows: number;
  state: number;
  market_price_usd: number;
}

export interface ApiResponseBlockchair {
  data: TransactionBlockchair[];
  context: ContextBlockchair;
}
