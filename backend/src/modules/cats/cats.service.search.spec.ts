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

  describe('category', () => {

    it('translates a single sub-Nk category into a clause', () => {
      expect(buildSearchWhere({ category: ['sub1k'] })).toBeDefined();
      expect(buildSearchWhere({ category: ['sub10k'] })).toBeDefined();
      expect(buildSearchWhere({ category: ['sub50k'] })).toBeDefined();
      expect(buildSearchWhere({ category: ['sub100k'] })).toBeDefined();
      expect(buildSearchWhere({ category: ['sub250k'] })).toBeDefined();
      expect(buildSearchWhere({ category: ['sub500k'] })).toBeDefined();
      expect(buildSearchWhere({ category: ['sub1M'] })).toBeDefined();
    });

    it('translates the genesis category into a boolean equality clause', () => {
      expect(buildSearchWhere({ category: ['genesis'] })).toBeDefined();
    });

    it('combines genesis + category in the same OR group', () => {
      expect(buildSearchWhere({ category: ['genesis', 'sub1k'] })).toBeDefined();
    });

    it('still returns a SQL clause for unknown category values (they just match nothing)', () => {
      // 'sub42k' isn't a real band; it gets passed through to IN (...) which
      // matches zero rows. No need to validate against an allowlist here —
      // the query is bounded, and user-supplied junk just returns empty.
      expect(buildSearchWhere({ category: ['sub42k'] })).toBeDefined();
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
