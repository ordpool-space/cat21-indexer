import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for GET listings endpoints. Same fields as
 * `CreateListingDto` plus server-assigned `id` and `createdAt`.
 * Every field is what the seller signed — external clients can
 * re-verify the BIP-322 signature offline from any row.
 */
export class ListingDto {
  @ApiProperty({
    description: 'Server-assigned UUID (v4).',
    example: 'b3c2c1d8-4e7f-4b8a-9c5d-6f7a8b9c0d1e',
  })
  id!: string;

  @ApiProperty({ description: 'Cat number the listing covers.', example: 42 })
  catNumber!: number;

  @ApiProperty({ description: 'Asking price in sats.', example: 21_000 })
  askSats!: number;

  @ApiProperty({
    description: "Seller's payment address.",
    example: 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm',
  })
  payTo!: string;

  @ApiProperty({
    description: "Cat UTXO txid the listing was pinned to at signing time.",
    example: 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df',
  })
  catTxid!: string;

  @ApiProperty({ description: 'Cat UTXO vout.', example: 0 })
  catVout!: number;

  @ApiProperty({
    description: "Seller's ordinals address at signing time.",
    example: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9',
  })
  ordinalsAddress!: string;

  @ApiProperty({ description: 'Unix seconds at signing time.', example: 1_700_000_000 })
  signedAt!: number;

  @ApiProperty({
    description: 'Base64 BIP-322 signature — re-verifiable offline via ordpool-sdk `verifyListingSignature`.',
    example: 'AUHd69PrJQEv+oKTfZ8l+WROBHuy9HKrbFCJu7U1iK2iiEy1vMU5EfMtjc+VSHM7aU0SDbak5IUZRVno2P5mjSafAQ==',
  })
  signature!: string;

  @ApiProperty({
    description: 'ISO-8601 UTC timestamp when the row was inserted server-side.',
    example: '2026-07-19T10:15:30.123Z',
  })
  createdAt!: string;
}

export class PaginatedListingsDto {
  @ApiProperty({ description: 'Total active listings on the orderbook.', example: 137 })
  total!: number;

  @ApiProperty({ description: 'Current page (1-indexed).', example: 1 })
  currentPage!: number;

  @ApiProperty({ description: 'Items per page.', example: 25 })
  itemsPerPage!: number;

  @ApiProperty({ type: [ListingDto] })
  items!: ListingDto[];
}
