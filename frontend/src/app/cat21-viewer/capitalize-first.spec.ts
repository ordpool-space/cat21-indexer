import { CapitalizeFirst } from './capitalize-first';

describe('CapitalizeFirst pipe', () => {
  const pipe = new CapitalizeFirst();

  it('returns empty string for null / undefined / empty', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform('')).toBe('');
  });

  it('uppercases the first character and leaves the rest untouched', () => {
    expect(pipe.transform('hello')).toBe('Hello');
    expect(pipe.transform('hELLO')).toBe('HELLO'); // rest unchanged, not lowercased
    expect(pipe.transform('Already')).toBe('Already');
  });
});
