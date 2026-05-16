import { randomUUID } from 'node:crypto';
import {
  mysqlTable,
  varchar,
  int,
  bigint,
  double,
  boolean,
  text,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';
import { jsonColumn } from './json-column';

const jsonStringArray = jsonColumn<string[]>();

export const cats = mysqlTable(
  'cats',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),

    // Core identification
    catNumber: int('cat_number').notNull().unique(),
    txHash: varchar('tx_hash', { length: 64 }).notNull().unique(),
    blockHash: varchar('block_hash', { length: 64 }).notNull(),
    blockHeight: int('block_height').notNull(),
    mintedAt: datetime('minted_at', { mode: 'date', fsp: 3 }).notNull(),
    mintedBy: varchar('minted_by', { length: 256 }), // null for OP_RETURN outputs (cat is free)

    // Transaction data (from ord)
    fee: bigint('fee', { mode: 'number' }).notNull(),
    weight: int('weight').notNull(),
    size: int('size').notNull(),
    feeRate: double('feerate').notNull(),
    sat: bigint('sat', { mode: 'number' }).notNull(),
    value: bigint('value', { mode: 'number' }).notNull(),

    // Category (derived from catNumber)
    category: varchar('category', { length: 50 }).notNull().default(''),

    // Traits (computed from ordpool-parser — always present)
    genesis: boolean('genesis').notNull().default(false),
    catColors: jsonStringArray('cat_colors').notNull().default([]),
    // Single field mirrors what the parser emits ('Male' | 'Female').
    // Empty string for the rare row that has neither (e.g. the genesis
    // cat in some fixtures); never null so the column can stay NOT NULL.
    gender: varchar('gender', { length: 10 }).notNull().default(''),
    designIndex: int('design_index').notNull().default(0),
    designPose: varchar('design_pose', { length: 50 }).notNull().default(''),
    designExpression: varchar('design_expression', { length: 50 }).notNull().default(''),
    designPattern: varchar('design_pattern', { length: 50 }).notNull().default(''),
    designFacing: varchar('design_facing', { length: 10 }).notNull().default(''),
    laserEyes: varchar('laser_eyes', { length: 50 }).notNull().default('None'),
    background: varchar('background', { length: 50 }).notNull().default(''),
    backgroundColors: jsonStringArray('background_colors').notNull().default([]),
    crown: varchar('crown', { length: 50 }).notNull().default('None'),
    glasses: varchar('glasses', { length: 50 }).notNull().default('None'),
    glassesColors: jsonStringArray('glasses_colors').notNull().default([]),

    // Dominant body-color bucket for trait search: one of `red`, `orange`,
    // `yellow`, `green`, `blue`, `purple`, `pink`, or NULL for genesis cats
    // (which have no body hue). Computed from feeRate + cat-hash bytes[1]
    // via ordpool-parser's getCatColorCategory. Nullable so the migration
    // can land before the boot-time backfill completes.
    dominantColorCategory: varchar('dominant_color_category', { length: 20 }),
  },
  (t) => [
    index('idx_cats_block_height').on(t.blockHeight),
    index('idx_cats_minted_by').on(t.mintedBy),
    index('idx_cats_genesis').on(t.genesis),
    index('idx_cats_design_pose').on(t.designPose),
    index('idx_cats_laser_eyes').on(t.laserEyes),
    index('idx_cats_background').on(t.background),
    index('idx_cats_crown').on(t.crown),
    index('idx_cats_glasses').on(t.glasses),
    index('idx_cats_feerate').on(t.feeRate),
    index('idx_cats_dominant_color_category').on(t.dominantColorCategory),
    index('idx_cats_category').on(t.category),
  ],
);
