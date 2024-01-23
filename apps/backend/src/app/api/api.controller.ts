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
import { oneMinuteInSeconds } from '../types/constants';
import { ErrorResponse } from '../types/error-response';
import { SatRangesValidationPipe } from '../types/sat-ranges-validation-pipe';
import { UtxosValidationPipe } from '../types/utxos-validation-pipe';
import { paginateArray } from '../utils/paginate-array';


@ApiTags('api')
@Controller()
export class ApiController {

  constructor(
    private catService: CatService,
    private ordApiService: OrdApiService) { }

  /**
   * Get all indexed CAT-21 assets (paged and cached)
   */
  @Get(['api/cats/:itemsPerPage/:currentPage'])
  @ApiOperation({ operationId: 'cats' })
  @ApiParam({ name: 'itemsPerPage', type: 'number', example: 12 })
  @ApiParam({ name: 'currentPage', type: 'number', example: 1 })
  @ApiOkResponse({ type: Cat21PaginatedResult })
  @Header('Cache-Control', 'public, max-age=' + oneMinuteInSeconds + ', immutable')
  async getCats(
    @Param('itemsPerPage', ParseIntPipe) itemsPerPage: number,
    @Param('currentPage', ParseIntPipe) currentPage: number,
  ): Promise<Cat21PaginatedResult> {

    const allCats: Cat21[] = await this.catService.getAllCats();

    // allCats = allCats.reverse();
    const cats = paginateArray(allCats, itemsPerPage, currentPage);

    return {
      cats,
      totalResults: allCats.length,
      itemsPerPage,
      currentPage
    }
  }

  /**
   * Get single CAT-21 asset by transactionId (cached)
   */
  @Get(['api/cat/:transactionId'])
  @ApiOperation({ operationId: 'cat' })
  @ApiParam({ name: 'transactionId', type: 'string', example: '98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892' })
  @ApiOkResponse({ type: Cat21 })
  @ApiNotFoundResponse({ description: 'No CAT-21 asset indexed with this transactionId' })
  @Header('Cache-Control', 'public, max-age=' + oneMinuteInSeconds + ', immutable')
  async getCat(@Param('transactionId') transactionId: string): Promise<Cat21> {

    const allCats: Cat21[] = await this.catService.getAllCats();
    const cat = allCats.find(c => c.transactionId === transactionId);

    if (!cat) {
      throw new NotFoundException('No CAT-21 asset indexed with this transactionId');
    }

    return cat;
  }

  /**
   * Get CAT-21 assets by sat ranges.<br>
   * The sat ranges are the same ranges that you get from Ord.<br>
   * <strong>This API gives you super fast results, because the response is fully cached.</strong>
   *
   * <strong>Warning!</strong>
   * In a CAT-21 mint transaction, only a single cat is created for the first satoshi of the first output.<br>
   * So calling this API with [596964966600565, 596964966601111], [596964966601111, 596964966601657] will give you three cats!<br>
   * If you want an exact match, call the API like this: [596964966600565, 596964966600565], [596964966601111, 596964966601111]
   * <br>
   * <br>
   * Test data: <a href="https://ordinals.com/output/98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892:0" target="_blank">First Output of the genesis cat</a><br>
   * Test data: <a href="https://ordinals.com/output/90dcf7825be098d1700014f15c6e4b5f99371d61cc7fc40cd5c3ae9228c64290:0" target="_blank">First Output of the second cat</a>
   *
   * Please make sure to sent a valid sat ranges input. Possible issues:
   * - Sat ranges must be an array.
   * - The number of sat ranges cannot exceed 1000.
   * - Each sat range must be an array of exactly two numbers.
   * - Each element in a sat range must be a number
   *
   * Please call the API multiple times for a higher amount of ranges.
   */
  @Post('api/cats/by-sat-ranges')
  @HttpCode(200)
  @ApiOperation({ operationId: 'catsBySatRanges' })
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
        example: [596964966600565, 596964966601111],
      },
      example: [[596964966600565, 596964966601111], [596964966601111, 596964966601657]],
    }
  })
  @UsePipes(new SatRangesValidationPipe())
  async getCatsBySatRanges(@Body() satRanges: [number, number][]): Promise<Cat21[]> {
    return this.catService.findCatsBySatRanges(satRanges);
  }

  /**
   * Get CAT-21 assets for a list of UTXOs.<br>
   * <strong>This APIs gives you significantly slower results, because the UTXOs are fetched from the Ord API on demand.</strong>
   *
   * <strong>Warning!</strong>
   * In a CAT-21 mint transaction, only a single cat is created for the first satoshi of the first output.<br>
   * We completely ignore a potential consolidation of UTXOs here.
   * If someone accidentally joins two UTXOs with two CAT-21 together – then the sotoshis must be extracted so that both cats are visible again.
   * <br>
   * <br>
   * Test data: <a href="https://ordinals.com/output/98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892:0" target="_blank">First Output of the genesis cat</a><br>
   * Test data: <a href="https://ordinals.com/output/90dcf7825be098d1700014f15c6e4b5f99371d61cc7fc40cd5c3ae9228c64290:0" target="_blank">First Output of the second cat</a>
   *
   * Please make sure to sent a valid UTXOs input. Possible issues:
   * - UTXOs must be an array.
   * - The number of UTXOs cannot exceed 100.
   * - Each UTXO must be a string.
   * - Each UTXO must be in the format transactionId:number.
   *
   * Please call the API multiple times for a higher amount of UTXOs.
   */
  @Post('api/cats/by-utxos')
  @HttpCode(200)
  @ApiOperation({ operationId: 'catsByUtxos' })
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
        example: '98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892:0',
      },
      example: ['98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892:0', '90dcf7825be098d1700014f15c6e4b5f99371d61cc7fc40cd5c3ae9228c64290:0'],
    }
  })
  @UsePipes(new UtxosValidationPipe())
  async getCatsByUtxos(@Body() utxos: string[]): Promise<Cat21[]> {
    const longSatRanges = await this.ordApiService.fetchSatRangesForUtxos(utxos);
    const shortSatRanges = longSatRanges.map(x => [x[0], x[0]] as [number, number]);
    return this.catService.findCatsBySatRanges(shortSatRanges);
  }
}


