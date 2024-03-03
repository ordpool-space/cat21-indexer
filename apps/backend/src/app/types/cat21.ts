import { ApiProperty } from '@nestjs/swagger';

export class Cat21 {

  @ApiProperty({
    description: 'The transactionId (hash in hex format) where the CAT-21 ordinal was created / minted',
    example: '98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892'
  })
  transactionId: string;

  @ApiProperty({
    description: 'The blockId (hash in hex format) where the CAT-21 ordinal was created / minted',
    example: '000000000000000000018e3ea447b11385e3330348010e1b2418d0d8ae4e0ac7'
  })
  blockId: string;

  @ApiProperty({
    description: 'The incremented number of the cat. Cat #0 is the first one.',
    example: 0
  })
  number: number;

  @ApiProperty({
    description: 'The paid fee rate that determines the color of the cat.',
    example: 24.3
  })
  feeRate: number;

  @ApiProperty({
    description: 'Just for information: The block height where the CAT-21 ordinal was created / minted',
    example: 824205
  })
  blockHeight: number;

  @ApiProperty({
    description: 'Just for information: The block time where the CAT-21 ordinal was created / minted (Unit: seconds)',
    example: 1704315886
  })
  blockTime: number;

  @ApiProperty({
    description: 'Just for information: Total fees paid to process the mint transaction (Unit: sats)',
    example: 40834
  })
  fee: number;

  @ApiProperty({
    description: 'Just for information: Total size of the mint transaction (Unit: bytes)',
    example: 258
  })
  size: number;

  @ApiProperty({
    description: 'Just for information: Weight of the mint transaction, which is a measurement to compare the size of different transactions to each other in proportion to the block size limit (Unit: WU)',
    example: 705
  })
  weight: number;

  @ApiProperty({
    description: 'Just for information: Value of the first output of the mint transaction (Unit: sats)',
    example: 546
  })
  value: number;

  @ApiProperty({
    description: 'The satoshi that is associated with the cat',
    example: 596964966600565
  })
  sat: number;

  @ApiProperty({
    description: 'The first cat owner (Address that received the first output of the mint transaction)',
    example: 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh'
  })
  firstOwner: string;

  // @ApiProperty({
  //   description: 'The current cat owner (Address that owns the cat now)',
  //   example: 'bc1...'
  // })
  // currentOwner: string;
}
