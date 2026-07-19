import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import { CreateListingDto } from './dto/create-listing.dto';
import { ListingDto, PaginatedListingsDto } from './dto/listing.dto';
import { ListingsService } from './listings.service';

// Per the backend HARD RULE (Cache-Control):
// - Errors → no-store (prevent 404 cache poisoning on a listing that
//   just got pruned).
// - Paginated feed → no header (dynamic, edge bypasses cache).
// - Single listing → short max-age (60s) so a new listing shows up
//   within a minute; a stale one for a moved cat is culled by the
//   pruner within an hour regardless of cache TTL.
const SINGLE_LISTING_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';
const NO_STORE = 'no-store';

@ApiTags('listings')
@Controller('api/v1/listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Post()
  @HttpCode(201)
  // Rate limit: 5 listing publishes / minute / IP. Guards our ord
  // instance against DoS via valid-but-flooded POSTs (each POST costs
  // ~2 ord API calls). Legitimate sellers won't publish more than a
  // handful of listings per minute across their entire cat inventory;
  // an attacker flooding with signed junk is capped hard.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Create or overwrite a cat listing',
    description:
      "Publishes a seller-signed sell intent to the CAT-21 orderbook. The seller's ordinals " +
      'wallet must sign the canonical listing message (per ordpool-sdk `buildListingMessage`) ' +
      'via BIP-322. The server verifies the signature and cross-checks with ord that the ' +
      'DTO\'s `ordinalsAddress` really owns cat #`catNumber` at outpoint `catTxid:catVout` ' +
      "RIGHT NOW. Any tamper / staleness / attacker-signature is rejected with a specific " +
      'error code. cat_number is unique — re-POSTing for a cat OVERWRITES the previous ' +
      'listing (price change flow). Rate-limited to 5/min/IP.',
  })
  @ApiTooManyRequestsResponse({ description: 'Exceeded 5 listing publishes per minute per IP.' })
  @ApiCreatedResponse({ type: ListingDto })
  @ApiBadRequestResponse({
    description:
      'Rejection with a code:\n' +
      '- `network-mismatch` — DTO network doesn\'t match this backend\'s deployment\n' +
      '- `signature-too-old` — signedAt > 24h in the past\n' +
      '- `signature-in-future` — signedAt > 1h in the future\n' +
      '- `signature-malformed-signature` — base64 or witness structure decode failed\n' +
      '- `signature-unsupported-address-type` — ordinalsAddress is not P2TR\n' +
      '- `signature-invalid-address` — ordinalsAddress does not decode\n' +
      '- `signature-signature-does-not-verify` — schnorr verify returned false\n' +
      '- `ord-lookup-failed` — upstream ord unreachable\n' +
      '- `cat-not-found` — ord does not know this cat (or it sits at an unspendable output)\n' +
      '- `not-current-owner` — signature valid but the address does not own the cat right now\n' +
      '- `outpoint-mismatch` — cat has moved since signing; re-sign against the current UTXO',
  })
  async create(
    @Body() dto: CreateListingDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ListingDto> {
    try {
      const created = await this.listings.create(dto);
      reply.header('Cache-Control', NO_STORE);
      return created;
    } catch (err) {
      reply.header('Cache-Control', NO_STORE);
      throw err;
    }
  }

  @Get('cat/:catNumber')
  @ApiOperation({
    summary: 'Get the active listing for a cat',
    description:
      'Returns the active seller-signed listing for cat #catNumber, or 404 if the cat is ' +
      'not currently listed. External clients can re-verify the returned signature offline ' +
      'via ordpool-sdk `verifyListingSignature` — no trust in cat21-indexer required.',
  })
  @ApiParam({
    name: 'catNumber',
    description: 'Cat number (0 = Genesis Cat).',
    example: 42,
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiOkResponse({ type: ListingDto })
  @ApiNotFoundResponse({ description: 'No active listing for this cat.' })
  async findByCatNumber(
    @Param('catNumber', ParseIntPipe) catNumber: number,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ListingDto> {
    const listing = await this.listings.findByCatNumber(catNumber);
    if (!listing) {
      // Per HARD RULE: 404 gets `no-store` to prevent cache poisoning
      // when a listing appears later.
      reply.header('Cache-Control', NO_STORE);
      throw new NotFoundException(`No active listing for cat #${catNumber}`);
    }
    reply.header('Cache-Control', SINGLE_LISTING_CACHE_CONTROL);
    return listing;
  }

  @Get(':itemsPerPage/:currentPage')
  @ApiOperation({
    summary: 'Browse the CAT-21 orderbook',
    description:
      'Paginated feed of all active listings, most-recently-signed first. Bounded at ' +
      '100 items per page. No Cache-Control set — edge bypasses cache (orderbook changes ' +
      'per listing/prune).',
  })
  @ApiParam({
    name: 'itemsPerPage',
    description: 'Page size, 1..100.',
    example: 25,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
  })
  @ApiParam({
    name: 'currentPage',
    description: 'Page number, 1-indexed.',
    example: 1,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiOkResponse({ type: PaginatedListingsDto })
  async findPaginated(
    @Param('itemsPerPage', ParseIntPipe) itemsPerPage: number,
    @Param('currentPage', ParseIntPipe) currentPage: number,
  ): Promise<PaginatedListingsDto> {
    return this.listings.findPaginated(itemsPerPage, currentPage);
  }

  @Delete('cat/:catNumber')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a listing (server-side; used by the pruner + future cancel flow)',
    description:
      'Removes the listing for cat #catNumber. No auth today — the pruner is the primary ' +
      'caller. A future seller-side cancel flow will require a signature over a "cancel" ' +
      'message.',
  })
  @ApiNoContentResponse({ description: 'Deleted (or already absent).' })
  async delete(
    @Param('catNumber', ParseIntPipe) catNumber: number,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.listings.deleteByCatNumber(catNumber);
    reply.header('Cache-Control', NO_STORE);
  }
}
