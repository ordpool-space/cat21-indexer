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

  it('should skip pinned entries on eviction', () => {
    const map = new LruMap<number, string>(3, {
      isPinned: (k) => k === 1, // key 1 is always pinned
    });
    map.set(1, 'pinned');
    map.set(2, 'a');
    map.set(3, 'b');
    map.set(4, 'c'); // triggers eviction, must skip 1
    expect(map.get(1)).toBe('pinned'); // pinned survives
    expect(map.get(2)).toBeUndefined(); // evicted (first non-pinned)
    expect(map.get(3)).toBe('b');
    expect(map.get(4)).toBe('c');
  });

  it('should pin multiple entries across the range', () => {
    const map = new LruMap<number, string>(3, {
      isPinned: (k) => k < 10, // keys < 10 pinned (oldest range)
    });
    map.set(1, 'a');
    map.set(2, 'b');
    map.set(20, 'c');
    map.set(30, 'd'); // evicts key 20 (only non-pinned at head)
    expect(map.get(1)).toBe('a');
    expect(map.get(2)).toBe('b');
    expect(map.get(20)).toBeUndefined();
    expect(map.get(30)).toBe('d');
  });

  it('should fall back to oldest when all entries pinned (safety)', () => {
    const map = new LruMap<number, string>(2, {
      isPinned: () => true, // everything pinned
    });
    map.set(1, 'a');
    map.set(2, 'b');
    map.set(3, 'c'); // no non-pinned to evict; falls back to evicting oldest
    expect(map.get(1)).toBeUndefined(); // fallback evicted
    expect(map.get(2)).toBe('b');
    expect(map.get(3)).toBe('c');
  });
});
