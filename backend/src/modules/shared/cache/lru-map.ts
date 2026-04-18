/**
 * Generic LRU cache backed by V8's ordered Map.
 * O(1) get/set/evict. Dynamic resizing via setMaxSize().
 */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>();
  private readonly onEvict?: (key: K, value: V) => void;

  constructor(
    private maxSize: number,
    options?: { onEvict?: (key: K, value: V) => void },
  ) {
    this.onEvict = options?.onEvict;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else {
      this.evictIfFull();
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  setMaxSize(newMax: number): void {
    this.maxSize = newMax;
    while (this.map.size > this.maxSize) {
      this.evictOldest();
    }
  }

  getMaxSize(): number {
    return this.maxSize;
  }

  private evictIfFull(): void {
    if (this.map.size >= this.maxSize) {
      this.evictOldest();
    }
  }

  private evictOldest(): void {
    const oldest = this.map.keys().next().value;
    if (oldest !== undefined) {
      if (this.onEvict) {
        this.onEvict(oldest, this.map.get(oldest)!);
      }
      this.map.delete(oldest);
    }
  }
}
