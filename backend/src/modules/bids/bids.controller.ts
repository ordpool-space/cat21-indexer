import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import { BidDto, PaginatedBidsDto } from './dto/bid.dto';
import { CreateBidDto } from './dto/create-bid.dto';
import { BidsService } from './bids.service';

const SINGLE_BID_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';
const NO_STORE = 'no-store';

@ApiTags('bids')
@Controller('api/v1/bids')
export class BidsController {
  constructor(private readonly bids: BidsService) {}

  @Post()
  @HttpCode(201)
  // Rate limit: 5 bid posts / minute / IP. Same posture as listings —
  // legitimate bidders won't submit more than a handful per minute;
  // spammers get bounded fast.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Post (or overwrite) a bid on a cat UTXO',
    description:
      "Publishes a buyer's half-signed PSBT to the marketplace. The PSBT itself IS the auth — " +
      "the buyer's SIGHASH_ALL signatures on inputs 1..N commit their funds to exact outputs. " +
      "One bid per (network, cat_txid, cat_vout, buyer_ordinals_address); a buyer re-bidding at a " +
      'new price overwrites their previous row atomically. Different buyers coexist on the same ' +
      'UTXO — that\'s the FOMO channel where competing bids drive the price up.\n\n' +
      'Rate-limited to 5/min/IP.',
  })
  @ApiTooManyRequestsResponse({ description: 'Exceeded 5 bid posts per minute per IP.' })
  @ApiCreatedResponse({ type: BidDto })
  @ApiBadRequestResponse({
    description:
      'Rejection with a code:\n' +
      '- `network-mismatch` — DTO network doesn\'t match this deployment\n' +
      '- `headline-not-in-bundle` — headlineCatNumber isn\'t a member of cats\n' +
      '- `bid-below-marketplace-floor` — bidSats below the spam floor\n' +
      '- `psbt-malformed` — base64 decode or PSBT parse failed\n' +
      '- `psbt-shape-invalid` — wrong input/output count, missing scripts, wrong postage\n' +
      '- `psbt-input0-mismatch` — PSBT input 0 outpoint doesn\'t match DTO cat_txid/cat_vout\n' +
      '- `psbt-output0-mismatch` — PSBT output 0 address doesn\'t match buyerOrdinalsAddress\n' +
      '- `psbt-output1-mismatch` — PSBT output 1 address doesn\'t match sellerPaymentAddress\n' +
      '- `psbt-output2-mismatch` — PSBT change output address doesn\'t match buyerPaymentAddress\n' +
      '- `psbt-price-mismatch` — PSBT output 1 amount ≠ bidSats + postage\n' +
      '- `psbt-*` — other SDK-layer offer-validator rejections\n' +
      '- `ord-lookup-failed` — upstream ord unreachable\n' +
      '- `cat-not-found` — UTXO empty of cats on ord (spent, unknown)\n' +
      '- `cats-bundle-drift` — UTXO carries a different cats set than signed for',
  })
  async create(
    @Body() dto: CreateBidDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BidDto> {
    try {
      const created = await this.bids.create(dto);
      reply.header('Cache-Control', NO_STORE);
      return created;
    } catch (err) {
      reply.header('Cache-Control', NO_STORE);
      throw err;
    }
  }

  @Get('outpoint/:catTxid/:catVout')
  @ApiOperation({
    summary: 'All active bids on a specific cat UTXO',
    description:
      'Returns every bid pinning `catTxid:catVout`, sorted `bidSats` DESC then most-recent ' +
      'first. The seller\'s "who\'s offering what" view. Filtered by the backend\'s network ' +
      'automatically — a mainnet backend never returns testnet bids.',
  })
  @ApiParam({ name: 'catTxid', description: 'Cat UTXO txid, lowercase 64-hex.' })
  @ApiParam({ name: 'catVout', description: 'Cat UTXO vout.', example: 0, schema: { type: 'integer', minimum: 0 } })
  @ApiOkResponse({ type: [BidDto] })
  async findByOutpoint(
    @Param('catTxid') catTxid: string,
    @Param('catVout', ParseIntPipe) catVout: number,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BidDto[]> {
    const rows = await this.bids.findByOutpoint(this.bids.network, catTxid, catVout);
    reply.header('Cache-Control', SINGLE_BID_CACHE_CONTROL);
    return rows;
  }

  @Get(':itemsPerPage/:currentPage')
  @ApiOperation({
    summary: 'Browse the bid orderbook',
    description:
      'Paginated feed of all active bids across the whole marketplace, most-recent first. ' +
      'Bounded at 100 items per page. No Cache-Control set — edge bypasses cache (bid feed ' +
      'changes per bid/prune).',
  })
  @ApiParam({ name: 'itemsPerPage', example: 25, schema: { type: 'integer', minimum: 1, maximum: 100 } })
  @ApiParam({ name: 'currentPage', example: 1, schema: { type: 'integer', minimum: 1 } })
  @ApiOkResponse({ type: PaginatedBidsDto })
  async findPaginated(
    @Param('itemsPerPage', ParseIntPipe) itemsPerPage: number,
    @Param('currentPage', ParseIntPipe) currentPage: number,
  ): Promise<PaginatedBidsDto> {
    return this.bids.findPaginated(itemsPerPage, currentPage);
  }

  @Delete('outpoint/:catTxid/:catVout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a bid (server-side; used by the pruner + future buyer-side cancel flow)',
    description:
      'Removes the bid uniquely identified by (catTxid, catVout, buyer_ordinals_address). ' +
      'No auth today — the pruner is the primary caller. A future buyer-side cancel flow will ' +
      "require a signature over a 'cancel' message.",
  })
  @ApiParam({ name: 'catTxid', description: 'Cat UTXO txid.' })
  @ApiParam({ name: 'catVout', example: 0 })
  @ApiQuery({ name: 'buyer', description: 'Buyer ordinals address (unique-key second half).' })
  @ApiNoContentResponse({ description: 'Deleted (or already absent).' })
  async delete(
    @Param('catTxid') catTxid: string,
    @Param('catVout', ParseIntPipe) catVout: number,
    @Query('buyer') buyerOrdinalsAddress: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.bids.deleteByOutpointAndBuyer(this.bids.network, catTxid, catVout, buyerOrdinalsAddress);
    reply.header('Cache-Control', NO_STORE);
  }
}
