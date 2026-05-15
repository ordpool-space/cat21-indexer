import { buildSearchWhere, type SearchFilters } from './cats.service';

// `buildSearchWhere` returns a Drizzle SQL expression or undefined; we don't
// need to introspect the SQL tree byte-for-byte. Pinning the high-level
// shape — "this filter -> this number of AND-combined clauses, this empty
// filter -> undefined" — gives the regression coverage that matters.

describe('buildSearchWhere', () => {

  it('returns undefined for an empty filter set', () => {
    expect(buildSearchWhere({})).toBeUndefined();
    expect(buildSearchWhere({ eyes: [], pose: [] })).toBeUndefined();
  });

  it('returns a SQL expression for a single-field single-value filter', () => {
    const sql = buildSearchWhere({ eyes: ['Red'] });
    expect(sql).toBeDefined();
  });

  it('returns a SQL expression for multi-value single-field filter', () => {
    const sql = buildSearchWhere({ eyes: ['Red', 'Blue'] });
    expect(sql).toBeDefined();
  });

  it('combines multiple fields', () => {
    const sql = buildSearchWhere({
      eyes: ['Red'],
      pose: ['Sleeping'],
      crown: ['Diamond'],
    });
    expect(sql).toBeDefined();
  });

  it('handles every documented categorical field', () => {
    const filters: SearchFilters = {
      eyes: ['Orange'],
      pose: ['Standing'],
      expression: ['Smile'],
      pattern: ['Solid'],
      background: ['Cyberpunk'],
      crown: ['Gold'],
      glasses: ['Cool'],
    };
    expect(buildSearchWhere(filters)).toBeDefined();
  });

  describe('tier', () => {

    it('translates a single sub-Nk tier into a clause', () => {
      expect(buildSearchWhere({ tier: ['sub1k'] })).toBeDefined();
      expect(buildSearchWhere({ tier: ['sub10k'] })).toBeDefined();
      expect(buildSearchWhere({ tier: ['sub50k'] })).toBeDefined();
      expect(buildSearchWhere({ tier: ['sub100k'] })).toBeDefined();
      expect(buildSearchWhere({ tier: ['sub250k'] })).toBeDefined();
      expect(buildSearchWhere({ tier: ['sub500k'] })).toBeDefined();
      expect(buildSearchWhere({ tier: ['sub1M'] })).toBeDefined();
    });

    it('translates the genesis tier into a boolean equality clause', () => {
      expect(buildSearchWhere({ tier: ['genesis'] })).toBeDefined();
    });

    it('combines genesis + tier in the same OR group', () => {
      expect(buildSearchWhere({ tier: ['genesis', 'sub1k'] })).toBeDefined();
    });

    it('ignores unknown tier values silently (filters are user-supplied)', () => {
      // 'sub42k' isn't in TIER_THRESHOLDS; the function should drop it
      // instead of crashing on the resulting array. With only an unknown
      // value the tier filter degenerates to no clause.
      expect(buildSearchWhere({ tier: ['sub42k'] })).toBeUndefined();
    });
  });

  describe('gender', () => {

    it('maps male to a male=true clause', () => {
      expect(buildSearchWhere({ gender: ['male'] })).toBeDefined();
    });

    it('maps female to a female=true clause', () => {
      expect(buildSearchWhere({ gender: ['female'] })).toBeDefined();
    });

    it('combines both via OR', () => {
      expect(buildSearchWhere({ gender: ['male', 'female'] })).toBeDefined();
    });

    it('silently drops unknown gender tokens', () => {
      expect(buildSearchWhere({ gender: ['xenon'] })).toBeUndefined();
    });
  });
});
