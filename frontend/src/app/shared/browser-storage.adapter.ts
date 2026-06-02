import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { type StorageLike } from 'ordpool-sdk';

/**
 * StorageLike implementation backed by window.localStorage. SSR-safe:
 * on the server platformId is not browser, so every operation is a no-op
 * and the wallet service falls back to "no last-connected wallet".
 */
@Injectable({ providedIn: 'root' })
export class BrowserStorageAdapter implements StorageLike {
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  getValue(key: string): string | null {
    if (!this.isBrowser) return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setValue(key: string, value: string): void {
    if (!this.isBrowser) return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota / privacy mode — silently no-op, same behaviour as a
      // server-side render.
    }
  }

  removeItem(key: string): void {
    if (!this.isBrowser) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // see setValue
    }
  }
}
