import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UsePipes,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CatService } from '../model/cat.service';
import { OrdApiService } from '../model/ord-api.service';
import { Cat21 } from '../types/cat21';
import { Cat21PaginatedResult } from '../types/cat21-paginated-result';
import { Cat21SingleResult } from '../types/cat21-single-result';
import { oneMinuteInSeconds } from '../types/constants';
import { ErrorResponse } from '../types/error-response';
import { SatRangesValidationPipe } from '../types/sat-ranges-validation-pipe';
import { StatusResult } from '../types/status-result';
import { UtxosValidationPipe } from '../types/utxos-validation-pipe';
import { paginateArray } from '../utils/paginate-array';
import { findItemByTransactionId } from './find-item-by-transaction-id';



@ApiTags('testnet-api')
@Controller()
export class TestnetApiController {

  private catService: CatService;
  private network: '' | 'testnet' = 'testnet';


  constructor(
    private ordApiService: OrdApiService,
    private moduleRef: ModuleRef) {
    this.catService = this.moduleRef.get<CatService>('testnet');
  }

  /**
   * Returns some stats about the testnet indexer
   */
  @Get(['testnet/api/status'])
  @ApiOperation({ operationId: 'testnet-status' })
  @Header('Cache-Control', 'public, max-age=' + oneMinuteInSeconds + ', immutable')
  async getStatus(): Promise<StatusResult> {

    const indexedCats = (await this.catService.getAllCats()).length;
    const lastSuccessfulExecution = this.catService.lastSuccessfulExecution;

    return {
      network: !this.network ? 'mainnet' : 'testnet',
      indexedCats,
      lastSuccessfulExecution,
      uptime: Math.floor(process.uptime())
    }
  }

  /**
   * Get single CAT-21 ordinal by transactionId (cached) for testnet.
   */
  @Get(['testnet/api/cat/:transactionId'])
  @ApiOperation({ operationId: 'testnet-cat' })
  @ApiParam({ name: 'transactionId', type: 'string', example: '691698aad93884f74fc919fcc6f98e099aaca7e5edb7eb8009f93f6c9d7c16e0' })
  @ApiOkResponse({ type: Cat21SingleResult })
  @ApiNotFoundResponse({ description: 'No CAT-21 ordinal indexed with this transactionId' })
  @Header('Cache-Control', 'public, max-age=' + oneMinuteInSeconds + ', immutable')
  async getCat(@Param('transactionId') transactionId: string): Promise<Cat21SingleResult> {

    const allCats: Cat21[] = await this.catService.getAllCats();
    const cats = findItemByTransactionId(allCats, transactionId)

    if (!cats.current) {
      throw new NotFoundException('No CAT-21 ordinal indexed with this transactionId');
    }

    return {
      cat: cats.current,
      previousTransactionId: cats.previous ? cats.previous.transactionId : null,
      nextTransactionId: cats.next ? cats.next.transactionId : null
    }
  }

  /**
   * Get CAT-21 ordinals by blockId (hash of the block in hex format) for testnet (cached).
   */
  @Get(['testnet/api/cats/by-block-id/:blockId'])
  @ApiOperation({ operationId: 'testnet-catsByBlockId' })
  @ApiParam({ name: 'blockId', type: 'string', example: '000000000000006b21ebe7df90e156b334dcb5e18485719f40bb8091ffd6272b' })
  @ApiOkResponse({ type: Cat21, isArray: true })
  @Header('Cache-Control', 'public, max-age=' + oneMinuteInSeconds + ', immutable')
  async getCatsByBlockId(@Param('blockId') blockId: string): Promise<Cat21[]> {
    return this.catService.findCatsByBlockId(blockId);
  }

  /**
   * Get all indexed CAT-21 ordinals (paged and cached) for testnet.
   */
  @Get(['testnet/api/cats/:itemsPerPage/:currentPage'])
  @ApiOperation({ operationId: 'testnet-cats' })
  @ApiParam({ name: 'itemsPerPage', type: 'number', example: 12 })
  @ApiParam({ name: 'currentPage', type: 'number', example: 1 })
  @ApiOkResponse({ type: Cat21PaginatedResult })
  @Header('Cache-Control', 'public, max-age=' + oneMinuteInSeconds + ', immutable')
  async getCats(
    @Param('itemsPerPage', ParseIntPipe) itemsPerPage: number,
    @Param('currentPage', ParseIntPipe) currentPage: number,
  ): Promise<Cat21PaginatedResult> {

    const allCats: Cat21[] = await this.catService.getAllCats();
    const cats = paginateArray(allCats, itemsPerPage, currentPage);

    return {
      cats,
      totalResults: allCats.length,
      itemsPerPage,
      currentPage
    }
  }

  /**
   * Get CAT-21 ordinals by sat ranges for testnet.
   */
  @Post('testnet/api/cats/by-sat-ranges')
  @HttpCode(200)
  @ApiOperation({ operationId: 'testnet-catsBySatRanges' })
  @ApiOkResponse({ type: Cat21, isArray: true })
  @ApiBadRequestResponse({
    description: 'Invalid sat ranges input. Possible issues: \n' +
      '- Sat ranges must be an array.\n' +
      '- The number of sat ranges cannot exceed 1000.\n' +
      '- Each sat range must be an array of exactly two numbers.\n' +
      '- Each element in a sat range must be a number.',
    type: ErrorResponse
  }) @ApiBody({
    description: 'Sat ranges to search for',
    schema: {
      type: 'array',
      items: {
        type: 'array',
        items: {
          type: 'number',
        },
        example: [1721703178595431, 1721703178596431],
      },
      example: [[1721703178595431, 1721703178596431], [1721703178606431, 1721703178607431]],
    }
  })
  @UsePipes(new SatRangesValidationPipe())
  async getCatsBySatRanges(@Body() satRanges: [number, number][]): Promise<Cat21[]> {
    return this.catService.findCatsBySatRanges(satRanges);
  }

  /**
   * Get CAT-21 ordinals for a list of UTXOs for testnet.
   */
  @Post('testnet/api/cats/by-utxos')
  @HttpCode(200)
  @ApiOperation({ operationId: 'testnet-catsByUtxos' })
  @ApiOkResponse({ type: Cat21, isArray: true })
  @ApiBadRequestResponse({
    description: 'Invalid UTXOs input. Possible issues: \n' +
      '- UTXOs must be an array.\n' +
      '- The number of UTXOs cannot exceed 100.\n' +
      '- Each UTXO must be a string.\n' +
      '- Each UTXO must be in the format transactionId:number.',
    type: ErrorResponse
  })
  @ApiBody({
    description: 'List of UTXOs',
    schema: {
      type: 'array',
      items: {
        type: 'string',
        example: '691698aad93884f74fc919fcc6f98e099aaca7e5edb7eb8009f93f6c9d7c16e0:0',
      },
      example: ['691698aad93884f74fc919fcc6f98e099aaca7e5edb7eb8009f93f6c9d7c16e0:0', 'd5f01585b89b0d87537451f3fbec0e406bf3f5d7082273eff79b8be361402930:0'],
    }
  })
  @UsePipes(new UtxosValidationPipe())
  async getCatsByUtxos(@Body() utxos: string[]): Promise<Cat21[]> {
    const longSatRanges = await this.ordApiService.fetchSatRangesForUtxos(utxos, this.network);
    const shortSatRanges = longSatRanges.map(x => [x[0], x[0]] as [number, number]);
    return this.catService.findCatsBySatRanges(shortSatRanges);
  }
}
