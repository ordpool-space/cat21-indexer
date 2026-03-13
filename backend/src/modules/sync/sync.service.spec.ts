import { deriveCategory } from './sync.service';

describe('deriveCategory', () => {
  it('should return sub1k for cats 0-999', () => {
    expect(deriveCategory(0)).toBe('sub1k');
    expect(deriveCategory(999)).toBe('sub1k');
  });

  it('should return sub10k for cats 1000-9999', () => {
    expect(deriveCategory(1000)).toBe('sub10k');
    expect(deriveCategory(9999)).toBe('sub10k');
  });

  it('should return sub50k for cats 10000-49999', () => {
    expect(deriveCategory(10000)).toBe('sub50k');
    expect(deriveCategory(49999)).toBe('sub50k');
  });

  it('should return sub100k for cats 50000-99999', () => {
    expect(deriveCategory(50000)).toBe('sub100k');
    expect(deriveCategory(99999)).toBe('sub100k');
  });

  it('should return sub250k for cats 100000-249999', () => {
    expect(deriveCategory(100000)).toBe('sub250k');
    expect(deriveCategory(249999)).toBe('sub250k');
  });

  it('should return sub500k for cats 250000-499999', () => {
    expect(deriveCategory(250000)).toBe('sub500k');
    expect(deriveCategory(499999)).toBe('sub500k');
  });

  it('should return sub1M for cats 500000-999999', () => {
    expect(deriveCategory(500000)).toBe('sub1M');
    expect(deriveCategory(999999)).toBe('sub1M');
  });

  it('should return empty string for cats 1000000+', () => {
    expect(deriveCategory(1000000)).toBe('');
    expect(deriveCategory(9999999)).toBe('');
  });
});
