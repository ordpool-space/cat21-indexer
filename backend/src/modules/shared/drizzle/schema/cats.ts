import {
  pgTable,
  uuid,
  integer,
  varchar,
  boolean,
  text,
  doublePrecision,
  timestamp,
  bigint,
  index,
} from 'drizzle-orm/pg-core';

export const cats = pgTable(
  'cats',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Core identification
    catNumber: integer('cat_number').notNull().unique(),
    txHash: varchar('tx_hash', { length: 64 }).notNull().unique(),
    blockHash: varchar('block_hash', { length: 64 }).notNull(),
    blockHeight: integer('block_height').notNull(),
    mintedAt: timestamp('minted_at', { withTimezone: true }),
    mintedBy: varchar('minted_by', { length: 256 }),

    // Transaction data (from ord)
    fee: bigint('fee', { mode: 'number' }).notNull(),
    weight: integer('weight').notNull(),
    feeRate: doublePrecision('feerate').notNull(),
    sat: bigint('sat', { mode: 'number' }),
    value: bigint('value', { mode: 'number' }),

    // Category (derived from catNumber)
    category: varchar('category', { length: 50 }),

    // Traits (computed from ordpool-parser)
    genesis: boolean('genesis').notNull().default(false),
    catColors: text('cat_colors').array(),
    male: boolean('male'),
    female: boolean('female'),
    designIndex: integer('design_index'),
    designPose: varchar('design_pose', { length: 50 }),
    designExpression: varchar('design_expression', { length: 50 }),
    designPattern: varchar('design_pattern', { length: 50 }),
    designFacing: varchar('design_facing', { length: 10 }),
    laserEyes: varchar('laser_eyes', { length: 50 }),
    background: varchar('background', { length: 50 }),
    backgroundColors: text('background_colors').array(),
    crown: varchar('crown', { length: 50 }),
    glasses: varchar('glasses', { length: 50 }),
    glassesColors: text('glasses_colors').array(),
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
  ],
);
