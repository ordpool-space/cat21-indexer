import { ApiProperty } from '@nestjs/swagger';
import { Cat21 } from './cat21';


export class Cat21SingleResult {

  @ApiProperty({ description: 'The requested cat', type: Cat21 })
  cat: Cat21;

  @ApiProperty({
    description: 'Previous cat\'s transactionId OR NULL',
    example: null
  })
  previousTransactionId: string | null;

  @ApiProperty({
    description: 'Next cat\'s transactionId OR NULL',
    example: '90dcf7825be098d1700014f15c6e4b5f99371d61cc7fc40cd5c3ae9228c64290' })
  nextTransactionId: string | null;
}
