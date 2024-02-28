import { ApiProperty } from '@nestjs/swagger';
import { Cat21 } from './cat21';


export class Cat21PaginatedResult {

  @ApiProperty({ description: 'An array of CAT-21 ordinals', type: Cat21, isArray: true })
  cats: Cat21[];

  @ApiProperty({ example: 100, description: 'Total number of all CAT-21 ordinals' })
  totalResults: number;

  @ApiProperty({ example: 12 })
  itemsPerPage: number;

  @ApiProperty({ example: 1 })
  currentPage: number;
}
