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
 * POST body for `/api/v1/bids`. The buyer sends the FULL half-signed
 * PSBT plus the extracted metadata the backend uses for
 * (1) uniqueness (buyer identity + UTXO), (2) display, and (3) a
 * belt-and-braces re-derivation check (backend parses the PSBT and
 * confirms the client-supplied fields match what's actually in the
 * bytes — a client that lies about the price gets its bid stored
 * with the REAL price, not the lie).
 *
 * The half-signed PSBT is the auth: SIGHASH_ALL sigs on inputs 1..N
 * commit the buyer's funds to exact outputs. No BIP-322 wrapping
 * layer is needed on top.
 */
export class CreateBidDto {
  @ApiProperty({
    description:
      'Bitcoin network the bid targets. Must match the backend deployment; a testnet-signed ' +
      'PSBT sent to the mainnet backend is rejected as `network-mismatch`.',
    example: 'mainnet',
    enum: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'],
  })
  @IsString()
  @IsIn(['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'])
  network!: 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';

  @ApiProperty({
    description: "Cat UTXO's txid the buyer's PSBT input 0 targets. Lowercase 64-hex.",
    example: 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df',
    pattern: '^[0-9a-f]{64}$',
  })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'catTxid must be 64-char lowercase hex' })
  catTxid!: string;

  @ApiProperty({ description: 'vout of the cat UTXO.', example: 0, minimum: 0 })
  @IsInt()
  @Min(0)
  catVout!: number;

  @ApiProperty({
    description:
      'Cats on the UTXO at bid time (buyer-observed snapshot). Sorted ascending, deduped. ' +
      "Backend cross-checks against ord's live `/output/<outpoint>` and rejects on drift " +
      'with `cats-bundle-drift` — the buyer must re-observe and re-bid if the bundle has ' +
      'changed since they built the PSBT.',
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
      'Headline cat number for display (member of `cats`). Same presentational choice as ' +
      'listings — usually min(cats) but bid UIs may choose any bundle member.',
    example: 42,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  headlineCatNumber!: number;

  @ApiProperty({
    description:
      "Bid price in sats. What the seller receives (PSBT output 1's amount minus the postage " +
      'top-up). Positive integer, capped at MAX_ASK_SATS. Backend re-derives from the PSBT ' +
      'and rejects on mismatch.',
    example: 21_000,
    minimum: 1,
    maximum: MAX_ASK_SATS,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_ASK_SATS)
  bidSats!: number;

  @ApiProperty({
    description:
      "Buyer's ORDINALS address — the cat lands here (PSBT output 0). THIS is the buyer " +
      "identity for the uniqueness gate. A different PSBT that routes the cat to the same " +
      'ordinals address is the same buyer and replaces the previous bid.',
    example: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9',
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  buyerOrdinalsAddress!: string;

  @ApiProperty({
    description:
      "Buyer's PAYMENT address — where the buyer's change output goes (PSBT output 2, when " +
      'above dust). Displayed to the accepter for context; not part of the uniqueness key.',
    example: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx',
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  buyerPaymentAddress!: string;

  @ApiProperty({
    description:
      'Where the sale proceeds go (PSBT output 1). Baked into the buyer-signed PSBT bytes; ' +
      'if the seller has moved to a new payment wallet since the buyer built the bid, THEY ' +
      "have to accept it or refuse — the bid's output is immutable.",
    example: 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm',
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  sellerPaymentAddress!: string;

  @ApiProperty({
    description:
      "Buyer's half-signed PSBT, base64-encoded. Input 0 is the seller's cat UTXO (unsigned; " +
      'the seller signs it at accept time). Inputs 1..N are buyer-owned, SIGHASH_ALL-signed. ' +
      "Outputs are (0) cat → buyer ordinals, (1) sats → seller payment, (2) change → buyer " +
      "payment. This is the artifact the seller broadcasts; the buyer's Bitcoin signatures on " +
      'inputs 1..N are the marketplace auth.',
    example: 'cHNidP8BAP0Y...',
    maxLength: 32_768,
  })
  @IsString()
  @MaxLength(32_768)
  psbtBase64!: string;
}
