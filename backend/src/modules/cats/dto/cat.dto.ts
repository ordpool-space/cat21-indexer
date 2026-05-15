import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Query parameters shared by /cats/search and /cats/search/random. Each
 * field is a comma-separated list of accepted values (OR within the field);
 * across fields they're AND-combined.
 */
export class CatSearchQueryDto {
  @ApiPropertyOptional({ description: 'Laser eyes: Orange, Red, Green, Blue, None', example: 'Red,Blue' })
  @IsOptional() @IsString()
  eyes?: string;

  @ApiPropertyOptional({ description: 'Pose: Standing, Sleeping, Pouncing, Stalking', example: 'Sleeping' })
  @IsOptional() @IsString()
  pose?: string;

  @ApiPropertyOptional({ description: 'Expression: Smile, Grumpy, Pouting, Shy', example: 'Smile' })
  @IsOptional() @IsString()
  expression?: string;

  @ApiPropertyOptional({ description: 'Coat pattern: Solid, Striped, Eyepatch, Half/Half', example: 'Striped' })
  @IsOptional() @IsString()
  pattern?: string;

  @ApiPropertyOptional({ description: 'Background: Block9, Cyberpunk, Whitepaper, Orange', example: 'Cyberpunk' })
  @IsOptional() @IsString()
  background?: string;

  @ApiPropertyOptional({ description: 'Crown: Gold, Diamond, None', example: 'Diamond' })
  @IsOptional() @IsString()
  crown?: string;

  @ApiPropertyOptional({ description: 'Glasses: Black, Cool, 3D, Nouns, None', example: 'Cool' })
  @IsOptional() @IsString()
  glasses?: string;

  // Category bands track the official Dune dashboard query
  // (ordpool/official_dune_dasboard_query.sql): each cat is in exactly one
  // band — its smallest applicable. `genesis` is a separate boolean trait,
  // accepted here as a sentinel so the chip UI can keep one row.
  @ApiPropertyOptional({ description: 'Rarity category: genesis, sub1k, sub10k, sub50k, sub100k, sub250k, sub500k, sub1M. Multiple bands OR-combine.', example: 'sub1k' })
  @IsOptional() @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Gender: male, female', example: 'female' })
  @IsOptional() @IsString()
  gender?: string;

  @ApiPropertyOptional({ description: 'Dominant body color bucket: red, orange, yellow, green, blue, purple, pink. Genesis cats have no body hue and never match.', example: 'red' })
  @IsOptional() @IsString()
  color?: string;
}

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

export class CatNumbersPaginatedResultDto {
  @ApiProperty({ type: [Number], description: 'Array of cat numbers for the current page', example: [63731, 63730, 63729] })
  catNumbers!: number[];

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

  @ApiProperty({
    description: 'Proof of Cat Work: the total Bitcoin fees (in sats) paid to miners across all CAT-21 mint transactions. This number only grows, never decreases. See the CAT-21 whitepaper for the philosophical foundation.',
    example: 5234876543,
  })
  proofOfCatWork!: number;
}

export class CacheStatsDto {
  @ApiProperty({ description: 'Number of cats currently in the LRU cache. Oldest 2400 and newest 2400 are pinned (never evicted).', example: 5000 })
  cats!: number;

  @ApiProperty({ description: 'Max capacity of the cat LRU (dynamically adjusted between 5300 and 20000)', example: 10000 })
  catsMax!: number;

  @ApiProperty({ description: 'Number of txHash index entries (secondary lookup map)', example: 5000 })
  txHashIndex!: number;

  @ApiProperty({ description: 'Cached total cat count (maintained via auto-bump + sync notifications)', example: 63732 })
  totalCatCount!: number;

  @ApiProperty({ description: 'Cached last synced cat number. Defines the newest-pinned range: [n-2399 .. n].', example: 63731 })
  lastSyncedCatNumber!: number;

  @ApiProperty({ description: 'Cached Proof of Cat Work (sum of all mint fees in sats). Refreshed from DB after each sync cycle.', example: 5234876543 })
  proofOfCatWork!: number;

  @ApiProperty({ description: 'Detected container memory limit in MB (cgroup v2/v1, Node 20+ constrainedMemory, or fallback)', example: 512 })
  memoryLimitMB!: number;

  @ApiProperty({ description: 'Target memory ceiling (75% of limit) in MB', example: 384 })
  memoryTargetMB!: number;

  @ApiProperty({ description: 'Available memory before hitting target, in MB', example: 263 })
  memoryHeadroomMB!: number;

  @ApiProperty({ description: 'Current resident memory (RSS) in MB', example: 121 })
  memoryRssMB!: number;

  @ApiProperty({ description: 'Current V8 heap used in MB', example: 45 })
  memoryHeapUsedMB!: number;
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

  @ApiProperty({ description: 'Resident memory in MB', example: 85 })
  memoryMB!: number;

  @ApiProperty({ description: 'In-memory cache statistics', type: CacheStatsDto })
  cache!: CacheStatsDto;
}

export class DatabaseHealthDto {
  @ApiProperty({ description: 'Whether the database responded to a SELECT 1 ping', example: true })
  reachable!: boolean;

  @ApiProperty({ description: 'DB round-trip time in ms for the SELECT 1 ping. Null when the ping failed.', example: 12, nullable: true })
  latencyMs!: number | null;

  @ApiProperty({ description: 'Short error message from the database driver when unreachable (truncated to 200 chars). Null when reachable.', example: null, nullable: true })
  error!: string | null;
}

export class SyncHealthDto {
  @ApiProperty({ description: 'ISO timestamp of the last successful sync cycle. Null until the first cycle completes after startup.', example: '2026-04-20T09:12:33.000Z', nullable: true })
  lastSuccessAt!: string | null;

  @ApiProperty({ description: 'ISO timestamp of the last sync cycle that threw. Null when no sync has errored since startup.', example: null, nullable: true })
  lastErrorAt!: string | null;

  @ApiProperty({ description: 'Short message of the last sync error. Null when no sync has errored since startup.', example: null, nullable: true })
  lastError!: string | null;

  @ApiProperty({ description: 'Seconds since the last successful sync cycle. Null until the first successful cycle.', example: 42, nullable: true })
  secondsSinceLastSuccess!: number | null;

  @ApiProperty({ description: 'True when the sync has not succeeded within the stall threshold (default 300 s).', example: false })
  stalled!: boolean;
}

export class ExtendedHealthDto {
  @ApiProperty({
    description: 'Rollup status: "ok" when DB is reachable and sync is fresh; "degraded" when DB is reachable but sync is stalled; "down" when the DB ping failed.',
    example: 'ok',
    enum: ['ok', 'degraded', 'down'],
  })
  status!: 'ok' | 'degraded' | 'down';

  @ApiProperty({ description: 'Current server time (ISO 8601)', example: '2026-04-20T09:13:15.000Z' })
  timestamp!: string;

  @ApiProperty({ description: 'Server uptime in seconds', example: 3600 })
  uptimeSec!: number;

  @ApiProperty({ description: 'Backend version', example: '0.1.0' })
  version!: string;

  @ApiProperty({ description: 'Resident memory in MB', example: 85 })
  memoryMB!: number;

  @ApiProperty({ description: 'Result of a live SELECT 1 against the database', type: DatabaseHealthDto })
  database!: DatabaseHealthDto;

  @ApiProperty({ description: 'Last sync cycle outcome and freshness signal', type: SyncHealthDto })
  sync!: SyncHealthDto;

  @ApiProperty({ description: 'In-memory cache statistics', type: CacheStatsDto })
  cache!: CacheStatsDto;
}
