import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for GET bid endpoints. Same fields as `CreateBidDto`
 * plus server-assigned `id` and `createdAt`. Every field is a
 * post-validation reflection of the persisted row — the PSBT is
 * authoritative (its Bitcoin sigs are the auth), the other fields
 * are indexed metadata for search and display.
 */
export class BidDto {
  @ApiProperty({ description: 'Server-assigned UUID (v4).', example: 'a1b2c3d4-...' })
  id!: string;

  @ApiProperty({
    description: 'Bitcoin network.',
    example: 'mainnet',
    enum: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'],
  })
  network!: string;

  @ApiProperty({ example: 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df' })
  catTxid!: string;

  @ApiProperty({ example: 0 })
  catVout!: number;

  @ApiProperty({ description: 'Cats on the UTXO at bid time.', example: [42], type: [Number] })
  cats!: number[];

  @ApiProperty({ description: 'Headline cat number for display.', example: 42 })
  headlineCatNumber!: number;

  @ApiProperty({ description: 'Bid price in sats.', example: 21_000 })
  bidSats!: number;

  @ApiProperty({ example: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9' })
  buyerOrdinalsAddress!: string;

  @ApiProperty({ example: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx' })
  buyerPaymentAddress!: string;

  @ApiProperty({ example: 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm' })
  sellerPaymentAddress!: string;

  @ApiProperty({
    description:
      'The half-signed PSBT (base64). Any accepter (current seller of the cat UTXO) can ' +
      'signature-input-0 + broadcast to close the trade.',
    example: 'cHNidP8BAP0Y...',
  })
  psbtBase64!: string;

  @ApiProperty({ description: 'ISO-8601 UTC timestamp when the bid was posted.', example: '2026-07-22T10:15:30.123Z' })
  createdAt!: string;
}

export class PaginatedBidsDto {
  @ApiProperty({ description: 'Total active bids on the orderbook.', example: 137 })
  total!: number;

  @ApiProperty({ description: 'Current page (1-indexed).', example: 1 })
  currentPage!: number;

  @ApiProperty({ description: 'Items per page.', example: 25 })
  itemsPerPage!: number;

  @ApiProperty({ type: [BidDto] })
  items!: BidDto[];
}
