import { jest } from '@jest/globals';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BrowserStorageAdapter } from './browser-storage.adapter';

function make(platform: 'browser' | 'server'): BrowserStorageAdapter {
  TestBed.configureTestingModule({
    providers: [BrowserStorageAdapter, { provide: PLATFORM_ID, useValue: platform }],
  });
  return TestBed.inject(BrowserStorageAdapter);
}

describe('BrowserStorageAdapter', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  describe('in the browser', () => {
    it('round-trips a value and removes it', () => {
      const a = make('browser');
      a.setValue('k', 'v');
      expect(a.getValue('k')).toBe('v');
      a.removeItem('k');
      expect(a.getValue('k')).toBeNull();
    });

    it('returns null for a missing key', () => {
      expect(make('browser').getValue('nope')).toBeNull();
    });

    it('returns null (never throws) when localStorage.getItem throws', () => {
      const a = make('browser');
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('privacy-mode');
      });
      expect(a.getValue('k')).toBeNull();
    });
  });

  describe('on the server (SSR)', () => {
    it('every operation is a no-op that never touches localStorage', () => {
      const setSpy = jest.spyOn(Storage.prototype, 'setItem');
      const removeSpy = jest.spyOn(Storage.prototype, 'removeItem');
      const a = make('server');

      expect(a.getValue('k')).toBeNull();
      a.setValue('k', 'v');
      a.removeItem('k');

      expect(setSpy).not.toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();
    });
  });
});
