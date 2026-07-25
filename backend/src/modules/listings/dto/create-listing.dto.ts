import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_ASK_SATS } from 'ordpool-sdk/core';

/**
 * POST body for `/api/v1/listings`.
 *
 * Auth is HEADER-BASED via the Cat21SessionGuard — the request must
 * carry X-Cat21-Session-Address / -Valid-Until / -Signature headers
 * proving control of `ordinalsAddress`. The per-listing BIP-322
 * signature that older versions required was removed on 2026-07-25
 * per the workspace philosophy: the marketplace layer is convenience,
 * the tamper-proof record is the PSBT + Bitcoin as the ledger. A
 * leaked session token can grief the marketplace but cannot cost
 * anyone Bitcoin — accepting a listing still requires the buyer to
 * sign a real PSBT the seller countersigns.
 *
 * Field-level shape validation runs here (class-validator);
 * cross-checks against ord (ownership, cats-bundle drift) run in
 * `ListingsService.create`.
 */
export class CreateListingDto {
  @ApiProperty({
    description:
      'Headline cat number for display. Must be a member of `cats`. 0 = Genesis Cat.',
    example: 42,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  catNumber!: number;

  @ApiProperty({
    description:
      'Every cat currently riding on the UTXO (`catTxid:catVout`). Sorted ascending, ' +
      'deduped. Backend cross-checks against ord\'s `/output/<outpoint>` at insert time ' +
      'and rejects on drift with code `cats-bundle-drift`.',
    example: [42],
    type: [Number],
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  cats!: number[];

  @ApiProperty({
    description:
      'Bitcoin network. Backend rejects mismatched network via `network-mismatch`.',
    example: 'mainnet',
    enum: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'],
  })
  @IsString()
  @IsIn(['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'])
  network!: 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';

  @ApiProperty({
    description: `Asking price in sats. Positive integer, capped at MAX_ASK_SATS (${MAX_ASK_SATS} = 21M BTC).`,
    example: 21_000,
    minimum: 1,
    maximum: MAX_ASK_SATS,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_ASK_SATS)
  askSats!: number;

  @ApiProperty({
    description:
      "Seller's PAYMENT address (where sale proceeds land). Never populated from " +
      'an on-chain owner lookup — that returns the ordinals address, wrong context.',
    example: 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm',
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  payTo!: string;

  @ApiProperty({
    description: "The cat UTXO's txid, lowercase 64-hex.",
    example: 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df',
    pattern: '^[0-9a-f]{64}$',
  })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'catTxid must be 64-char lowercase hex' })
  catTxid!: string;

  @ApiProperty({
    description: "vout of the cat UTXO. Almost always 0 (FIFO), non-zero permitted.",
    example: 0,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  catVout!: number;

  @ApiProperty({
    description:
      "Seller's ORDINALS address (where the cat sits, per ordinal theory FIFO). MUST " +
      "match the on-chain owner AND the session-token X-Cat21-Session-Address header.",
    example: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9',
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  ordinalsAddress!: string;
}
