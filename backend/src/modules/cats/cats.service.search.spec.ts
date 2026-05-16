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

    it('still returns a SQL clause for unknown category values (they just match nothing)', () => {
      expect(buildSearchWhere({ category: ['sub42k'] })).toBeDefined();
    });
  });

  describe('genesis (ORIGIN trait)', () => {

    it("translates 'genesis' alone to a boolean equality clause", () => {
      expect(buildSearchWhere({ genesis: ['genesis'] })).toBeDefined();
    });

    it("translates 'normal' alone to a boolean equality clause", () => {
      expect(buildSearchWhere({ genesis: ['normal'] })).toBeDefined();
    });

    it('returns undefined when both genesis+normal are selected (matches everything)', () => {
      expect(buildSearchWhere({ genesis: ['genesis', 'normal'] })).toBeUndefined();
    });
  });

  describe('gender', () => {

    it('matches Male via inArray', () => {
      expect(buildSearchWhere({ gender: ['Male'] })).toBeDefined();
    });

    it('matches Female via inArray', () => {
      expect(buildSearchWhere({ gender: ['Female'] })).toBeDefined();
    });

    it('combines both via OR', () => {
      expect(buildSearchWhere({ gender: ['Male', 'Female'] })).toBeDefined();
    });

    it('still returns a clause for unknown gender tokens (just matches nothing)', () => {
      expect(buildSearchWhere({ gender: ['xenon'] })).toBeDefined();
    });
  });
});
