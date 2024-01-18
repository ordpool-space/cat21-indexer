import { ApiProperty } from '@nestjs/swagger';

export class Cat21 {

  @ApiProperty({
    description: 'The transactionId where the CAT-21 asset was created / minted',
    example: '98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892'
  })
  transactionId: string;

  @ApiProperty({
    description: 'The block height where the CAT-21 asset was created / minted',
    example: 824205
  })
  blockHeight: number;

  @ApiProperty({
    description: 'Total fees paid to process the mint transaction in (Unit: sats)',
    example: 40834
  })
  fee: number;

  @ApiProperty({
    description: 'Total size of the mint transaction (Unit: Bytes)',
    example: 258
  })
  size: number;

  @ApiProperty({
    description: 'Weight of the mint transaction, which is a measurement to compare the size of different transactions to each other in proportion to the block size limit (Unit: WU)',
    example: 705
  })
  weight: number;
}
