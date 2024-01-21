import { Controller, Get, Post, Body, Header, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiBody } from '@nestjs/swagger';

import { CatService } from '../model/cat.service';
import { paginateArray } from '../utils/paginate-array';
import { Cat21 } from '../types/cat21';
import { Cat21PaginatedResult } from '../types/cat21-paginated-result';
import { oneMinuteInSeconds } from '../types/constants';



@ApiTags('api')
@Controller()
export class ApiController {

  constructor(
    private catService: CatService) { }

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
   * Get CAT-21 assets by satoshi ranges.
   */
  @Post('api/cats/by-sat-ranges')
  @ApiOperation({ operationId: 'catsBySatRanges' })
  @ApiOkResponse({ type: Cat21, isArray: true })
  @ApiBody({
    description: 'Sat ranges to search for',
    schema: {
      type: 'array',
      items: {
        type: 'array',
        items: {
          type: 'number',
        },
        example: [100000, 200000],
      },
      example: [[100000, 200000], [300000, 400000]],
    },
  })
  async getCatsBySatRanges(@Body() satRanges: [number, number][]): Promise<Cat21[]> {
    return this.catService.findCatsBySatRanges(satRanges);
  }
}


