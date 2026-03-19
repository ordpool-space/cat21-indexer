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
    mintedAt: timestamp('minted_at', { withTimezone: true }).notNull(),
    mintedBy: varchar('minted_by', { length: 256 }), // null for OP_RETURN outputs (cat is free)

    // Transaction data (from ord)
    fee: bigint('fee', { mode: 'number' }).notNull(),
    weight: integer('weight').notNull(),
    size: integer('size').notNull(),
    feeRate: doublePrecision('feerate').notNull(),
    sat: bigint('sat', { mode: 'number' }).notNull(),
    value: bigint('value', { mode: 'number' }).notNull(),

    // Category (derived from catNumber)
    category: varchar('category', { length: 50 }).notNull().default(''),

    // Traits (computed from ordpool-parser — always present)
    genesis: boolean('genesis').notNull().default(false),
    catColors: text('cat_colors').array().notNull().default([]),
    male: boolean('male').notNull().default(false),
    female: boolean('female').notNull().default(false),
    designIndex: integer('design_index').notNull().default(0),
    designPose: varchar('design_pose', { length: 50 }).notNull().default(''),
    designExpression: varchar('design_expression', { length: 50 }).notNull().default(''),
    designPattern: varchar('design_pattern', { length: 50 }).notNull().default(''),
    designFacing: varchar('design_facing', { length: 10 }).notNull().default(''),
    laserEyes: varchar('laser_eyes', { length: 50 }).notNull().default('None'),
    background: varchar('background', { length: 50 }).notNull().default(''),
    backgroundColors: text('background_colors').array().notNull().default([]),
    crown: varchar('crown', { length: 50 }).notNull().default('None'),
    glasses: varchar('glasses', { length: 50 }).notNull().default('None'),
    glassesColors: text('glasses_colors').array().notNull().default([]),
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
