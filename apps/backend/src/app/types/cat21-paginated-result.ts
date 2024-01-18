import { ApiProperty } from '@nestjs/swagger';
import { Cat21 } from './cat21';


export class Cat21PaginatedResult {

  @ApiProperty({ description: 'An array of CAT-21 assets', type: Cat21, isArray: true })
  cats: Cat21[];

  @ApiProperty({ example: 100, description: 'Total number of all CAT-21 assets' })
  totalResults: number;

  @ApiProperty({ example: 12 })
  itemsPerPage: number;

  @ApiProperty({ example: 1 })
  currentPage: number;
}
