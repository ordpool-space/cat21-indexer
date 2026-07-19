import { ApiProperty } from '@nestjs/swagger';
import {
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
 * POST body for `/api/v1/listings`. Every field maps 1:1 to the
 * canonical listing message the seller signed (ordpool-sdk
 * `buildListingMessage`) so the server can rebuild the same message
 * bytes and verify the BIP-322 signature against them.
 *
 * Field-level shape validation happens here (class-validator);
 * cryptographic verification happens in `ListingsService.create`.
 */
export class CreateListingDto {
  @ApiProperty({
    description: 'Cat number the listing covers. 0 = Genesis Cat.',
    example: 42,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  catNumber!: number;

  @ApiProperty({
    description:
      'Bitcoin network the seller signed against. Binds the signature to a specific network — a testnet-signed listing bytes replayed against mainnet is rejected as `signature-does-not-verify`. Full enum matches ordpool-sdk `Network`; per-deployment the backend only accepts one of these via `network-mismatch`.',
    example: 'mainnet',
    enum: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'],
  })
  @IsString()
  @IsIn(['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'])
  network!: 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';

  @ApiProperty({
    description: `Asking price in sats. Positive integer, capped at MAX_ASK_SATS (${MAX_ASK_SATS} = 21 M BTC — total supply). Any value above is rejected as nonsense.`,
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
      "Seller's PAYMENT address (where sale proceeds land). Must be a valid Bitcoin address; " +
      "the signature commits to this exact string. Never populated from an on-chain owner " +
      'lookup — that returns the ordinals address, wrong context.',
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
    description: "vout of the cat UTXO. Almost always 0 (cat sits on output 0 per FIFO), but non-zero permitted.",
    example: 0,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  catVout!: number;

  @ApiProperty({
    description:
      "Seller's ORDINALS address (where the cat sits, per ordinal theory FIFO). MUST match the " +
      "on-chain owner at insert time — the server cross-checks this against ord's live inscription " +
      'lookup before persisting. BIP-322 signature must verify against this address.',
    example: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9',
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  ordinalsAddress!: string;

  @ApiProperty({
    description:
      'Unix seconds at signing time. Server rejects listings whose `signedAt` is more than ' +
      '24h in the past or 1h in the future (loose sanity window to catch obviously-stale ' +
      'submissions and clock-skewed spoofing attempts).',
    example: 1_700_000_000,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  signedAt!: number;

  @ApiProperty({
    description:
      'Base64-encoded BIP-322 "simple" signature witness. For P2TR ordinals addresses (the only ' +
      'kind cats live on today) this is either a raw 64-byte schnorr signature OR the wrapped ' +
      "witness format Xverse/Leather/cat21-wallet emit (`numItems || sigLen || sigBytes`). Both " +
      'accepted.',
    example: 'AUHd69PrJQEv+oKTfZ8l+WROBHuy9HKrbFCJu7U1iK2iiEy1vMU5EfMtjc+VSHM7aU0SDbak5IUZRVno2P5mjSafAQ==',
    maxLength: 512,
  })
  @IsString()
  @MaxLength(512)
  signature!: string;
}
