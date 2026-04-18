import { LruMap } from './lru-map';

describe('LruMap', () => {
  it('should store and retrieve values', () => {
    const map = new LruMap<string, number>(3);
    map.set('a', 1);
    map.set('b', 2);
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(2);
    expect(map.size).toBe(2);
  });

  it('should evict oldest entry when full', () => {
    const map = new LruMap<string, number>(2);
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3); // evicts 'a'
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBe(2);
    expect(map.get('c')).toBe(3);
  });

  it('should promote accessed entry to most recent', () => {
    const map = new LruMap<string, number>(2);
    map.set('a', 1);
    map.set('b', 2);
    map.get('a'); // promote 'a', now 'b' is oldest
    map.set('c', 3); // evicts 'b'
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBeUndefined();
    expect(map.get('c')).toBe(3);
  });

  it('should update existing key without growing', () => {
    const map = new LruMap<string, number>(2);
    map.set('a', 1);
    map.set('b', 2);
    map.set('a', 10); // update, not insert
    expect(map.size).toBe(2);
    expect(map.get('a')).toBe(10);
  });

  it('should call onEvict callback', () => {
    const evicted: [string, number][] = [];
    const map = new LruMap<string, number>(2, {
      onEvict: (k, v) => evicted.push([k, v]),
    });
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3); // evicts 'a'
    expect(evicted).toEqual([['a', 1]]);
  });

  it('should resize and evict when shrinking', () => {
    const map = new LruMap<string, number>(5);
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    map.set('d', 4);
    map.set('e', 5);
    map.setMaxSize(2); // evicts a, b, c
    expect(map.size).toBe(2);
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBeUndefined();
    expect(map.get('c')).toBeUndefined();
    expect(map.get('d')).toBe(4);
    expect(map.get('e')).toBe(5);
  });

  it('should clear all entries', () => {
    const map = new LruMap<string, number>(5);
    map.set('a', 1);
    map.set('b', 2);
    map.clear();
    expect(map.size).toBe(0);
    expect(map.get('a')).toBeUndefined();
  });

  it('should delete specific entry', () => {
    const map = new LruMap<string, number>(5);
    map.set('a', 1);
    map.set('b', 2);
    map.delete('a');
    expect(map.size).toBe(1);
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBe(2);
  });

  it('should handle has() correctly', () => {
    const map = new LruMap<string, number>(5);
    map.set('a', 1);
    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(false);
  });
});
