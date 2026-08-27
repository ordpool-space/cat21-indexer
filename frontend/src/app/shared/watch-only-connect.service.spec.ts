import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AddressProbe, WalletService } from 'ordpool-sdk';

import { OrdApiService } from './ord-api.service';
import { WatchOnlyConnectService } from './watch-only-connect.service';

interface ConnectXpubArgs {
  extendedPublicKey: string;
  scriptType?: string;
  probe: (address: string) => Promise<AddressProbe>;
}

// Pins the two pieces this service owns: the ambiguous-prefix detector
// (drives the script-type prompt) and the probe wiring (electrs UTXO +
// ord cats -> AddressProbe). connectXpub itself is the SDK's; we assert
// we call it with the right args and a probe that reports correctly.

describe('WatchOnlyConnectService', () => {
  let service: WatchOnlyConnectService;
  let connectXpub: jest.Mock;
  let httpGet: jest.Mock;
  let ordGetAddress: jest.Mock;

  beforeEach(() => {
    connectXpub = jest.fn().mockReturnValue(of({ type: 'xpub' }));
    httpGet = jest.fn();
    ordGetAddress = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        WatchOnlyConnectService,
        { provide: WalletService, useValue: { connectXpub } },
        { provide: HttpClient, useValue: { get: httpGet } },
        { provide: OrdApiService, useValue: { getAddress: ordGetAddress } },
      ],
    });
    service = TestBed.inject(WatchOnlyConnectService);
  });

  describe('isScriptTypeAmbiguous', () => {
    it('true only for the SDK script-type-ambiguous error', () => {
      expect(WatchOnlyConnectService.isScriptTypeAmbiguous(
        new Error('Watch-only: this key prefix (xpub/tpub) is script-type-ambiguous; pass scriptType'),
      )).toBe(true);
      expect(WatchOnlyConnectService.isScriptTypeAmbiguous(new Error('some other error'))).toBe(false);
      expect(WatchOnlyConnectService.isScriptTypeAmbiguous('not an error object')).toBe(false);
    });
  });

  describe('connect', () => {
    it('forwards the trimmed key + scriptType to connectXpub', () => {
      service.connect('  xpub123  ', 'p2tr').subscribe();
      expect(connectXpub).toHaveBeenCalledTimes(1);
      const args = connectXpub.mock.calls[0][0] as ConnectXpubArgs;
      expect(args.extendedPublicKey).toBe('xpub123');
      expect(args.scriptType).toBe('p2tr');
      expect(typeof args.probe).toBe('function');
    });

    it('probe reports funded + fundedSats from electrs and hasCat from ord', async () => {
      httpGet.mockReturnValue(of([{ txid: 'a', vout: 0, value: 700 }, { txid: 'b', vout: 1, value: 300 }]));
      ordGetAddress.mockReturnValue(of({ cats: ['insc0i0'], cat_numbers: [0] }));

      service.connect('xpub123', 'p2tr').subscribe();
      const probe = (connectXpub.mock.calls[0][0] as ConnectXpubArgs).probe;
      const result = await probe('bc1p-some-address');

      expect(result).toEqual({ funded: true, fundedSats: 1000, hasCat: true });
    });

    it('probe reports unfunded + no cat when electrs is empty and ord has none', async () => {
      httpGet.mockReturnValue(of([]));
      ordGetAddress.mockReturnValue(of({ cats: [], cat_numbers: [] }));

      service.connect('xpub123', 'p2tr').subscribe();
      const probe = (connectXpub.mock.calls[0][0] as ConnectXpubArgs).probe;
      expect(await probe('bc1p-empty')).toEqual({ funded: false, fundedSats: 0, hasCat: false });
    });

    it('probe degrades to no-cat when the ord lookup errors (never blocks the scan)', async () => {
      httpGet.mockReturnValue(of([{ txid: 'a', vout: 0, value: 546 }]));
      ordGetAddress.mockReturnValue(throwError(() => new Error('ord 404')));

      service.connect('xpub123', 'p2tr').subscribe();
      const probe = (connectXpub.mock.calls[0][0] as ConnectXpubArgs).probe;
      expect(await probe('bc1p-addr')).toEqual({ funded: true, fundedSats: 546, hasCat: false });
    });

    it('probe degrades to unfunded when electrs errors', async () => {
      httpGet.mockReturnValue(throwError(() => new Error('electrs 500')));
      ordGetAddress.mockReturnValue(of({ cats: [], cat_numbers: [] }));

      service.connect('xpub123', 'p2tr').subscribe();
      const probe = (connectXpub.mock.calls[0][0] as ConnectXpubArgs).probe;
      expect(await probe('bc1p-addr')).toEqual({ funded: false, fundedSats: 0, hasCat: false });
    });
  });
});
