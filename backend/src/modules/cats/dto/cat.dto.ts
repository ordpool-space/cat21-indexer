import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CatDto {
  @ApiProperty({ description: 'Internal database ID (UUID)', example: '9fe2d429-908c-4af9-9b11-4b5882b82ab9' })
  id!: string;

  @ApiProperty({ description: 'The incremented number of the cat. Cat #0 is the genesis cat.', example: 0 })
  catNumber!: number;

  @ApiProperty({ description: 'Transaction hash (hex) where the CAT-21 ordinal was minted', example: '98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892' })
  txHash!: string;

  @ApiProperty({ description: 'Block hash (hex) of the block containing the mint transaction', example: '000000000000000000018e3ea447b11385e3330348010e1b2418d0d8ae4e0ac7' })
  blockHash!: string;

  @ApiProperty({ description: 'Block height where the CAT-21 ordinal was minted', example: 824205 })
  blockHeight!: number;

  @ApiProperty({ description: 'Timestamp when the cat was minted (ISO 8601)', example: '2024-01-03T21:04:46.000Z' })
  mintedAt!: string;

  @ApiPropertyOptional({ description: 'Address that received the first output of the mint transaction. Null for OP_RETURN outputs (cat is free).', example: 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh' })
  mintedBy!: string | null;

  @ApiProperty({ description: 'Total fees paid to process the mint transaction (Unit: sats)', example: 40834 })
  fee!: number;

  @ApiProperty({ description: 'Weight of the mint transaction (Unit: WU — weight units)', example: 705 })
  weight!: number;

  @ApiProperty({ description: 'Total size of the mint transaction (Unit: bytes)', example: 195 })
  size!: number;

  @ApiProperty({ description: 'Fee rate paid to mint this cat (Unit: sat/vB). Determines the color of the cat.', example: 231.68 })
  feeRate!: number;

  @ApiProperty({ description: 'The ordinal satoshi number associated with this cat', example: 596964966600565 })
  sat!: number;

  @ApiProperty({ description: 'Value of the first output of the mint transaction (Unit: sats)', example: 546 })
  value!: number;

  @ApiProperty({ description: 'Category based on cat number: sub1k, sub10k, sub50k, sub100k, sub250k, sub500k, sub1M, or empty', example: 'sub1k' })
  category!: string;

  @ApiProperty({ description: 'Whether this is a genesis cat (white or black, probability 0.4%)', example: true })
  genesis!: boolean;

  @ApiProperty({ description: 'All colors used to paint the cat (excluding laser eyes and other trait colors)', example: ['#555555', '#d3d3d3', '#ffffff'] })
  catColors!: string[];

  @ApiProperty({ description: 'Whether the cat is male (50% chance)', example: false })
  male!: boolean;

  @ApiProperty({ description: 'Whether the cat is female (50% chance)', example: true })
  female!: boolean;

  @ApiProperty({ description: 'Design index (0-127), combination of pose, expression, pattern, and facing', example: 24 })
  designIndex!: number;

  @ApiProperty({ description: 'Pose of the cat', enum: ['Standing', 'Sleeping', 'Pouncing', 'Stalking'], example: 'Standing' })
  designPose!: string;

  @ApiProperty({ description: 'Expression of the cat', enum: ['Smile', 'Grumpy', 'Pouting', 'Shy'], example: 'Grumpy' })
  designExpression!: string;

  @ApiProperty({ description: 'Pattern of the cat', enum: ['Solid', 'Striped', 'Eyepatch', 'Half/Half'], example: 'Eyepatch' })
  designPattern!: string;

  @ApiProperty({ description: 'Facing direction of the cat', enum: ['Left', 'Right'], example: 'Left' })
  designFacing!: string;

  @ApiProperty({ description: 'Laser eyes color (20% chance each), or None', enum: ['Orange', 'Red', 'Green', 'Blue', 'None'], example: 'Red' })
  laserEyes!: string;

  @ApiProperty({ description: 'Background type (25% chance each)', enum: ['Block9', 'Cyberpunk', 'Whitepaper', 'Orange'], example: 'Orange' })
  background!: string;

  @ApiProperty({ description: 'Colors used to generate the background', example: ['#ff9900'] })
  backgroundColors!: string[];

  @ApiProperty({ description: 'Crown type (10% chance to have one)', enum: ['Gold', 'Diamond', 'None'], example: 'None' })
  crown!: string;

  @ApiProperty({ description: 'Glasses type (10% chance each, 3D and Nouns only without laser eyes)', enum: ['Black', 'Cool', '3D', 'Nouns', 'None'], example: 'None' })
  glasses!: string;

  @ApiProperty({ description: 'Colors used to paint the glasses (empty if no glasses)', example: [] })
  glassesColors!: string[];
}

export class CatsPaginatedResultDto {
  @ApiProperty({ type: [CatDto], description: 'Array of cats for the current page' })
  cats!: CatDto[];

  @ApiProperty({ description: 'Total number of cats across all pages', example: 63732 })
  total!: number;

  @ApiProperty({ description: 'Current page number (1-based)', example: 1 })
  currentPage!: number;

  @ApiProperty({ description: 'Number of cats per page', example: 48 })
  itemsPerPage!: number;
}

export class StatusDto {
  @ApiProperty({ description: 'Total number of indexed cats', example: 63732 })
  totalCats!: number;

  @ApiProperty({ description: 'Cat number of the last synced cat (-1 if none)', example: 63731 })
  lastSyncedCatNumber!: number;
}

export class HealthDto {
  @ApiProperty({ description: 'Service status', example: 'ok' })
  status!: string;

  @ApiProperty({ description: 'Current server time (ISO 8601)', example: '2026-03-20T18:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ description: 'Server uptime in seconds', example: 3600 })
  uptimeSec!: number;

  @ApiProperty({ description: 'Backend version', example: '0.1.0' })
  version!: string;
}
