import { ShortenString } from './shorten-string';

describe('ShortenString pipe', () => {
  const pipe = new ShortenString();

  it('returns empty string for null / undefined / empty input', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform('')).toBe('');
  });

  it('returns the string unchanged when it is at most `length` chars', () => {
    expect(pipe.transform('short', 12)).toBe('short');
    expect(pipe.transform('exactly12chr', 12)).toBe('exactly12chr'); // length 12, == limit
  });

  it('middle-ellipsizes a long string: first half + … + last half', () => {
    // length 12 -> half 6; keep first 6 + last 6 around a middle ellipsis
    expect(pipe.transform('abcdefghijklmnop', 12)).toBe('abcdef…klmnop');
  });

  it('defaults the length to 12 when omitted', () => {
    expect(pipe.transform('abcdefghijklmnop')).toBe('abcdef…klmnop');
  });
});
