import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { WalletService, WatchOnlyDeriveError } from 'ordpool-sdk';

import { cat21Config } from './sdk-tokens';

import { WatchOnlyConnectService } from './watch-only-connect.service';

// The probe is now the SDK's shared, ordinals-safe `makeWatchOnlyProbe`
// (tested in ordpool-sdk against real electrs + both ord instances), so
// this spec pins only what cat21.space still owns: the ambiguous-prefix
// detector (drives the script-type prompt) and that `connect` forwards
// the key + scriptType + a probe to `WalletService.connectXpub`.

describe('WatchOnlyConnectService', () => {
  let service: WatchOnlyConnectService;
  let connectXpub: jest.Mock;

  beforeEach(() => {
    connectXpub = jest.fn().mockReturnValue(of({ type: 'xpub' }));
    TestBed.configureTestingModule({
      providers: [
        WatchOnlyConnectService,
        { provide: WalletService, useValue: { connectXpub } },
        {
          provide: cat21Config,
          useValue: {
            mempoolApiUrl: 'https://api.ordpool.space',
            cat21ApiUrl: 'https://backend2.cat21.space',
            ordApiUrl: 'https://ord.ordpool.space',
            cat21OrdApiUrl: 'https://ord.cat21.space',
          },
        },
      ],
    });
    service = TestBed.inject(WatchOnlyConnectService);
  });

  describe('isScriptTypeAmbiguous', () => {
    it('true only for a WatchOnlyDeriveError carrying code "script-type-ambiguous"', () => {
      expect(WatchOnlyConnectService.isScriptTypeAmbiguous(
        new WatchOnlyDeriveError('script-type-ambiguous', 'plain xpub/tpub; pass scriptType'),
      )).toBe(true);
      // A different WatchOnlyDeriveError code is not the ambiguous case.
      expect(WatchOnlyConnectService.isScriptTypeAmbiguous(
        new WatchOnlyDeriveError('invalid-key', 'bad key'),
      )).toBe(false);
      // A plain Error whose MESSAGE contains the phrase is NOT matched — the
      // whole point of keying on the typed `code` is dropping the substring
      // match, so a reworded SDK message can't break the prompt.
      expect(WatchOnlyConnectService.isScriptTypeAmbiguous(
        new Error('this key prefix is script-type-ambiguous; pass scriptType'),
      )).toBe(false);
      expect(WatchOnlyConnectService.isScriptTypeAmbiguous('not an error object')).toBe(false);
    });
  });

  describe('connect', () => {
    it('forwards the trimmed key + scriptType + the shared probe to connectXpub', () => {
      service.connect('  xpub123  ', 'p2tr').subscribe();
      expect(connectXpub).toHaveBeenCalledTimes(1);
      const args = connectXpub.mock.calls[0][0] as {
        extendedPublicKey: string;
        scriptType?: string;
        probe: (address: string) => Promise<unknown>;
      };
      expect(args.extendedPublicKey).toBe('xpub123');
      expect(args.scriptType).toBe('p2tr');
      expect(typeof args.probe).toBe('function');
    });

    it('omits scriptType when not supplied (SLIP-132 prefix implies it)', () => {
      service.connect('zpub456').subscribe();
      const args = connectXpub.mock.calls[0][0] as { extendedPublicKey: string; scriptType?: string };
      expect(args.extendedPublicKey).toBe('zpub456');
      expect(args.scriptType).toBeUndefined();
    });
  });
});
