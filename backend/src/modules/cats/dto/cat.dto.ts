import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// Per-field max length on the comma-separated value list. The longest legit
// trait name we accept ("Whitepaper") is 10 chars; even a full list of every
// chip in a row stays well under 200. Caps a class of cheap-to-send,
// expensive-to-process inputs (huge IN(...) clauses, oversized regex etc.).
const FILTER_MAX_LENGTH = 200;

// Allowed values per filter. Case-sensitive because the DB stores these
// exact strings — there's no normalization step on the read path, so
// matching anything other than the canonical case would silently miss.
// All ten lists are closed enums (no free-form fields), so strict
// validation works end-to-end.
const EYES_VALUES       = ['Orange', 'Red', 'Green', 'Blue', 'None'] as const;
const POSE_VALUES       = ['Standing', 'Sleeping', 'Pouncing', 'Stalking'] as const;
const EXPRESSION_VALUES = ['Smile', 'Grumpy', 'Pouting', 'Shy'] as const;
const PATTERN_VALUES    = ['Solid', 'Striped', 'Eyepatch', 'Half/Half'] as const;
const BACKGROUND_VALUES = ['Block9', 'Cyberpunk', 'Whitepaper', 'Orange'] as const;
const CROWN_VALUES      = ['Gold', 'Diamond', 'None'] as const;
const GLASSES_VALUES    = ['Black', 'Cool', '3D', 'Nouns', 'None'] as const;
// Category bands are pinned to the Dune query. Genesis is NOT a category
// — it's its own boolean trait (the ORIGIN row in the search UI). See
// ordpool-parser/CAT21-RARITY-SCORE.md for the full narrative.
const CATEGORY_VALUES   = ['sub1k', 'sub10k', 'sub50k', 'sub100k', 'sub250k', 'sub500k', 'sub1M'] as const;
// Title Case matches the parser's emitted strings ('Female' | 'Male'),
// which is what the DB stores after migration 0003.
const GENDER_VALUES     = ['Male', 'Female'] as const;
// Twelve buckets total: eight hue buckets (red/orange/yellow/green/cyan/
// blue/purple/pink) + the two genesis palettes (black/white) + the two
// fee-rate easter eggs (fire/saturated). See ordpool-parser
// cat-color-category.ts for the assignment logic.
const COLOR_VALUES      = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'black', 'white', 'fire', 'saturated'] as const;
// ORIGIN trait — separate from category. 'genesis' = the 1-of-1 genesis
// cat; 'normal' = everything else. Selecting both ORs them (returns
// everything).
const GENESIS_VALUES    = ['genesis', 'normal'] as const;
// RARITY presets — single-value rank ceilings within the active
// category. 'top10' means rarityRank ≤ 10, 'top100' ≤ 100, 'top1k'
// ≤ 1000. OR-combining picks the broadest ceiling (top10 ∪ top100 =
// top100), so multi-select behaves as union semantics.
const RARITY_VALUES     = ['top10', 'top100', 'top1k'] as const;

// Build a regex that matches "v1,v2,v3,..." where each value is one of the
// listed enum members. No nested quantifiers — ReDoS-safe by construction.
function csvOf(values: readonly string[]): RegExp {
  const alts = values.map((v) => v.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')).join('|');
  return new RegExp(`^(?:${alts})(?:,(?:${alts}))*$`);
}
const EYES_CSV       = csvOf(EYES_VALUES);
const POSE_CSV       = csvOf(POSE_VALUES);
const EXPRESSION_CSV = csvOf(EXPRESSION_VALUES);
const PATTERN_CSV    = csvOf(PATTERN_VALUES);
const BACKGROUND_CSV = csvOf(BACKGROUND_VALUES);
const CROWN_CSV      = csvOf(CROWN_VALUES);
const GLASSES_CSV    = csvOf(GLASSES_VALUES);
const CATEGORY_CSV   = csvOf(CATEGORY_VALUES);
const GENDER_CSV     = csvOf(GENDER_VALUES);
const COLOR_CSV      = csvOf(COLOR_VALUES);
const GENESIS_CSV    = csvOf(GENESIS_VALUES);
const RARITY_CSV     = csvOf(RARITY_VALUES);

const msg = (name: string, values: readonly string[]) =>
  `${name} must be a comma-separated list of: ${values.join(', ')}`;

/**
 * Query parameters shared by /cats/search and /cats/search/random. Each
 * field is a comma-separated list of accepted values (OR within the field);
 * across fields they're AND-combined.
 */
export class CatSearchQueryDto {
  @ApiPropertyOptional({ description: 'Laser eyes: Orange, Red, Green, Blue, None', example: 'Red,Blue' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(EYES_CSV, { message: msg('eyes', EYES_VALUES) })
  eyes?: string;

  @ApiPropertyOptional({ description: 'Pose: Standing, Sleeping, Pouncing, Stalking', example: 'Sleeping' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(POSE_CSV, { message: msg('pose', POSE_VALUES) })
  pose?: string;

  @ApiPropertyOptional({ description: 'Expression: Smile, Grumpy, Pouting, Shy', example: 'Smile' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(EXPRESSION_CSV, { message: msg('expression', EXPRESSION_VALUES) })
  expression?: string;

  @ApiPropertyOptional({ description: 'Coat pattern: Solid, Striped, Eyepatch, Half/Half', example: 'Striped' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(PATTERN_CSV, { message: msg('pattern', PATTERN_VALUES) })
  pattern?: string;

  @ApiPropertyOptional({ description: 'Background: Block9, Cyberpunk, Whitepaper, Orange', example: 'Cyberpunk' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(BACKGROUND_CSV, { message: msg('background', BACKGROUND_VALUES) })
  background?: string;

  @ApiPropertyOptional({ description: 'Crown: Gold, Diamond, None', example: 'Diamond' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(CROWN_CSV, { message: msg('crown', CROWN_VALUES) })
  crown?: string;

  @ApiPropertyOptional({ description: 'Glasses: Black, Cool, 3D, Nouns, None', example: 'Cool' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(GLASSES_CSV, { message: msg('glasses', GLASSES_VALUES) })
  glasses?: string;

  // Categories follow the model spelled out in
  // ordpool-parser/CAT21-RARITY-SCORE.md: each cat is in exactly one
  // category — its smallest applicable. Multi-select is allowed but
  // semantically discouraged (categories are collections, not filters);
  // the UI presents them as tabs, not chips.
  @ApiPropertyOptional({ description: 'Rarity category: sub1k, sub10k, sub50k, sub100k, sub250k, sub500k, sub1M. Multiple categories OR-combine.', example: 'sub1k' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(CATEGORY_CSV, { message: msg('category', CATEGORY_VALUES) })
  category?: string;

  @ApiPropertyOptional({ description: 'Gender: Male, Female', example: 'Female' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(GENDER_CSV, { message: msg('gender', GENDER_VALUES) })
  gender?: string;

  @ApiPropertyOptional({ description: 'Dominant color bucket: red, orange, yellow, green, cyan, blue, purple, pink, black (genesis), white (genesis), fire (feeRate 69 sat/vB), saturated (feeRate 420 sat/vB).', example: 'red' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(COLOR_CSV, { message: msg('color', COLOR_VALUES) })
  color?: string;

  // ORIGIN trait — the genesis flag surfaced as a searchable boolean.
  // Filter values: 'genesis' (the 1-of-1) or 'normal' (everything else).
  @ApiPropertyOptional({ description: 'Origin: genesis (the 1-of-1 cat #0) or normal (everything else).', example: 'genesis' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(GENESIS_CSV, { message: msg('genesis', GENESIS_VALUES) })
  genesis?: string;

  // Rarity rank ceiling within the active category. 'top10' / 'top100'
  // / 'top1k' = rarityRank ≤ 10 / 100 / 1000. Per-category scoring —
  // 'top10' inside sub1k returns the 10 rarest sub1k cats only. See
  // ordpool-parser/CAT21-RARITY-SCORE.md.
  @ApiPropertyOptional({ description: 'Rarity rank ceiling within the active category: top10 (rank ≤ 10), top100 (≤ 100), top1k (≤ 1000). Multi-select takes the broadest ceiling.', example: 'top10' })
  @IsOptional() @IsString() @MaxLength(FILTER_MAX_LENGTH)
  @Matches(RARITY_CSV, { message: msg('rarity', RARITY_VALUES) })
  rarity?: string;
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

  @ApiProperty({
    description: 'Gender of the cat. Empty string for cats that have neither (rare edge case, e.g. some fixtures).',
    enum: ['Female', 'Male', ''],
    example: 'Female',
  })
  gender!: string;

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

  // OpenRarity scoring (per-band). Both fields are null while the
  // boot-time backfill is in flight on a fresh deploy.
  @ApiPropertyOptional({
    description: 'OpenRarity information-content score for this cat within its category band (raw Σ -log₂(p_i)). Higher = rarer. Each band is scored independently.',
    example: 23.4,
  })
  rarityBits!: number | null;

  @ApiPropertyOptional({
    description: '1-based rarity rank within this cat\'s category. Tied scores share a rank with classic 1-2-2-4 ordering.',
    example: 17,
  })
  rarityRank!: number | null;

  @ApiPropertyOptional({
    description: 'Total cats currently in this cat\'s category. For closed categories (sub1k, sub10k, etc.) this is the fixed drop size. For open categories it grows with each new mint. Pairs with rarityRank to read as "rank N of M".',
    example: 1000,
  })
  rarityCategoryTotal!: number | null;
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
