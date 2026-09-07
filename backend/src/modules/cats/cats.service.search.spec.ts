import { MySqlDialect } from 'drizzle-orm/mysql-core';

import { buildSearchWhere, type SearchFilters } from './cats.service';

/**
 * `buildSearchWhere` returns a Drizzle `SQL` expression (or `undefined` for an
 * empty filter set). These specs compile that expression into the exact
 * `{ sql, params }` MariaDB receives, so they pin the REAL predicate emitted,
 * not merely that some object exists.
 *
 * The load-bearing case is `category`. Per the workspace HARD RULE
 * (ordpool-parser/CAT21-RARITY-SCORE.md), categories are DISJOINT collections:
 * `sub1k` means cats 1000-9999 ONLY, matched by `inArray(cats.category, …)` —
 * NEVER a cumulative `cat_number < threshold`. The exact HARD-RULE regression
 * (swap that `inArray` for a cumulative `lte()`) changes the compiled SQL from
 * `` `category` in (?) `` to `` `cat_number` <= ? `` and the param from the band
 * token to a number; the category specs below assert against exactly that, so
 * the regression turns them red.
 */
const dialect = new MySqlDialect();

/** Compile to the real `{ sql, params }`; throws if the builder emitted no clause. */
function compile(where: ReturnType<typeof buildSearchWhere>): { sql: string; params: unknown[] } {
  if (!where) throw new Error('expected a SQL expression, got undefined');
  const { sql, params } = dialect.sqlToQuery(where);
  return { sql, params };
}

describe('buildSearchWhere', () => {

  it('returns undefined for an empty filter set', () => {
    expect(buildSearchWhere({})).toBeUndefined();
    expect(buildSearchWhere({ eyes: [], pose: [] })).toBeUndefined();
  });

  it('emits `laser_eyes in (?)` for a single-field single-value filter', () => {
    expect(compile(buildSearchWhere({ eyes: ['Red'] }))).toEqual({
      sql: '`cats`.`laser_eyes` in (?)',
      params: ['Red'],
    });
  });

  it('emits a multi-placeholder inArray (OR within a field) for a multi-value filter', () => {
    expect(compile(buildSearchWhere({ eyes: ['Red', 'Blue'] }))).toEqual({
      sql: '`cats`.`laser_eyes` in (?, ?)',
      params: ['Red', 'Blue'],
    });
  });

  it('AND-combines multiple fields, each an inArray on its own column', () => {
    expect(compile(buildSearchWhere({ eyes: ['Red'], pose: ['Sleeping'], crown: ['Diamond'] }))).toEqual({
      sql: '(`cats`.`laser_eyes` in (?) and `cats`.`design_pose` in (?) and `cats`.`crown` in (?))',
      params: ['Red', 'Sleeping', 'Diamond'],
    });
  });

  it('maps every documented categorical field to an inArray on its own column, in push order', () => {
    const filters: SearchFilters = {
      eyes: ['Orange'],
      pose: ['Standing'],
      expression: ['Smile'],
      pattern: ['Solid'],
      background: ['Cyberpunk'],
      crown: ['Gold'],
      glasses: ['Cool'],
    };
    const { sql, params } = compile(buildSearchWhere(filters));
    for (const col of ['laser_eyes', 'design_pose', 'design_expression', 'design_pattern', 'background', 'crown', 'glasses']) {
      expect(sql).toContain(`\`cats\`.\`${col}\` in (?)`);
    }
    expect(params).toEqual(['Orange', 'Standing', 'Smile', 'Solid', 'Cyberpunk', 'Gold', 'Cool']);
  });

  describe('category (load-bearing: DISJOINT collections, HARD RULE)', () => {

    it('emits `category in (?)` with the band token — NOT a cumulative cat_number ceiling', () => {
      const { sql, params } = compile(buildSearchWhere({ category: ['sub1k'] }));
      expect(sql).toBe('`cats`.`category` in (?)');
      expect(params).toEqual(['sub1k']);
      // The HARD-RULE regression (inArray -> cumulative lte on cat_number) would
      // emit `cat_number <= ?` with a numeric param; assert its absence so the
      // mutation turns this spec red.
      expect(sql).not.toContain('cat_number');
      expect(sql).not.toContain('<=');
      expect(params).not.toContain(1000);
      expect(params).not.toContain(9999);
    });

    it('matches EACH band by its exact token (disjoint), never a range', () => {
      for (const band of ['sub1', 'sub1k', 'sub10k', 'sub50k', 'sub100k', 'sub250k', 'sub500k', 'sub1M']) {
        expect(compile(buildSearchWhere({ category: [band] }))).toEqual({
          sql: '`cats`.`category` in (?)',
          params: [band],
        });
      }
    });

    it('multi-select category is an inArray over the exact bands, still disjoint (never a widening range)', () => {
      expect(compile(buildSearchWhere({ category: ['sub1k', 'sub10k'] }))).toEqual({
        sql: '`cats`.`category` in (?, ?)',
        params: ['sub1k', 'sub10k'],
      });
    });

    it('an unknown band is still matched literally (inArray), so it matches nothing rather than a range', () => {
      expect(compile(buildSearchWhere({ category: ['sub42k'] }))).toEqual({
        sql: '`cats`.`category` in (?)',
        params: ['sub42k'],
      });
    });
  });

  describe('genesis (ORIGIN trait -> boolean equality)', () => {

    it("'genesis' alone -> `genesis` = true", () => {
      expect(compile(buildSearchWhere({ genesis: ['genesis'] }))).toEqual({
        sql: '`cats`.`genesis` = ?',
        params: [true],
      });
    });

    it("'normal' alone -> `genesis` = false", () => {
      expect(compile(buildSearchWhere({ genesis: ['normal'] }))).toEqual({
        sql: '`cats`.`genesis` = ?',
        params: [false],
      });
    });

    it('both genesis+normal -> undefined (matches everything, no clause)', () => {
      expect(buildSearchWhere({ genesis: ['genesis', 'normal'] })).toBeUndefined();
    });
  });

  describe('gender (inArray)', () => {

    it('Male -> `gender in (?)`', () => {
      expect(compile(buildSearchWhere({ gender: ['Male'] }))).toEqual({
        sql: '`cats`.`gender` in (?)',
        params: ['Male'],
      });
    });

    it('Female -> `gender in (?)`', () => {
      expect(compile(buildSearchWhere({ gender: ['Female'] }))).toEqual({
        sql: '`cats`.`gender` in (?)',
        params: ['Female'],
      });
    });

    it('both -> `gender in (?, ?)` (OR)', () => {
      expect(compile(buildSearchWhere({ gender: ['Male', 'Female'] }))).toEqual({
        sql: '`cats`.`gender` in (?, ?)',
        params: ['Male', 'Female'],
      });
    });

    it('unknown token still an inArray literal (matches nothing)', () => {
      expect(compile(buildSearchWhere({ gender: ['xenon'] }))).toEqual({
        sql: '`cats`.`gender` in (?)',
        params: ['xenon'],
      });
    });
  });

  describe('rarity (rank CEILING -> lte, broadest wins)', () => {

    it('single tier -> `rarity_rank <= ?` at that threshold', () => {
      expect(compile(buildSearchWhere({ rarity: ['top100'] }))).toEqual({
        sql: '`cats`.`rarity_rank` <= ?',
        params: [100],
      });
    });

    it('multi-select -> the BROADEST ceiling wins (max threshold), not the narrowest', () => {
      expect(compile(buildSearchWhere({ rarity: ['top10', 'top100'] }))).toEqual({
        sql: '`cats`.`rarity_rank` <= ?',
        params: [100],
      });
    });

    it('an unknown tier alone contributes no clause -> undefined', () => {
      expect(buildSearchWhere({ rarity: ['top999'] })).toBeUndefined();
    });
  });
});
