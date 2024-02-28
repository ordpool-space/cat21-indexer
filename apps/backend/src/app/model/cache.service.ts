import { Injectable } from '@nestjs/common';
import NodeCache = require('node-cache');

// not used atm!
@Injectable()
export class CacheService {

  private cache = new NodeCache();

  /**
   * Check if a key is cached
   * @param key Cache key to check
   * @returns Boolean indicating if the key is cached or not
   */
  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Set a cached key. Returns the cached element
   *
   * @param key Cache key
   * @param value A element to cache.
   * @param ttl The time to live in seconds (optional)
   */
  set<T>(key: string, value: T, ttl?: number): T {
    this.cache.set(key, value, ttl);
    return value;
  }

  /**
   * Get a cached key
   *
   * @param key Cache key
   * @returns The value stored in the key
   */
  get<T>(key: string): T {
    return this.cache.get(key)
  }

  /**
   * Executes the callback, but tries the cache first
   */
  async loadCached<T>(cacheKey: string, loadCallback: () => Promise<T>, ttl: number | undefined = undefined): Promise<T> {

    if (this.has(cacheKey)) {
      return this.get<T>(cacheKey);
    }

    const result = await loadCallback();
    return this.set(cacheKey, result, ttl);
  }

  /**
   * Executes the callback, but tries the cache first
   */
  loadCachedSync<T>(cacheKey: string, loadCallback: () => T, ttl: number | undefined = undefined): T {

    if (this.has(cacheKey)) {
      return this.get<T>(cacheKey);
    }

    const result = loadCallback();
    return this.set(cacheKey, result, ttl);
  }
}
