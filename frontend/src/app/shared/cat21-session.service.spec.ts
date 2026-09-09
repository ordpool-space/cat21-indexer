import { jest } from '@jest/globals';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { WalletService } from 'ordpool-sdk';

import { Cat21SessionService } from './cat21-session.service';

const ADDR = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';
const KEY = `cat21-session-${ADDR}`;

function makeWallet(overrides: Record<string, unknown> = {}) {
  return {
    connectedWallet$: { getValue: () => ({ ordinalsAddress: ADDR }) },
    signMessage: jest.fn().mockReturnValue(of({ signature: 'fresh-sig' })),
    network: 'mainnet',
    ...overrides,
  };
}

function setup(wallet: unknown): Cat21SessionService {
  TestBed.configureTestingModule({
    providers: [Cat21SessionService, { provide: WalletService, useValue: wallet }],
  });
  return TestBed.inject(Cat21SessionService);
}

describe('Cat21SessionService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('signs a fresh session and returns the three headers when nothing is cached', async () => {
    const wallet = makeWallet();
    const service = setup(wallet);

    const headers = await firstValueFrom(service.headersFor(ADDR));

    expect(headers['X-Cat21-Session-Address']).toBe(ADDR);
    expect(headers['X-Cat21-Session-Signature']).toBe('fresh-sig');
    expect(headers['X-Cat21-Session-Valid-Until']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(wallet.signMessage).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBeTruthy(); // cached for reuse
  });

  it('reuses a still-valid cached session without prompting the wallet', async () => {
    const wallet = makeWallet();
    const validUntilIso = new Date(Date.now() + 3_600_000).toISOString();
    localStorage.setItem(KEY, JSON.stringify({ address: ADDR, validUntilIso, signature: 'cached-sig' }));
    const service = setup(wallet);

    const headers = await firstValueFrom(service.headersFor(ADDR));

    expect(headers['X-Cat21-Session-Signature']).toBe('cached-sig');
    expect(wallet.signMessage).not.toHaveBeenCalled();
  });

  it('re-signs when the cached session is inside the 60s refresh grace window', async () => {
    const wallet = makeWallet();
    const nearlyExpired = new Date(Date.now() + 30_000).toISOString();
    localStorage.setItem(KEY, JSON.stringify({ address: ADDR, validUntilIso: nearlyExpired, signature: 'stale' }));
    const service = setup(wallet);

    const headers = await firstValueFrom(service.headersFor(ADDR));

    expect(headers['X-Cat21-Session-Signature']).toBe('fresh-sig');
    expect(wallet.signMessage).toHaveBeenCalledTimes(1);
  });

  it('errors when no wallet is connected', async () => {
    const service = setup(makeWallet({ connectedWallet$: { getValue: () => null } }));
    await expect(firstValueFrom(service.headersFor(ADDR))).rejects.toThrow('wallet-not-connected');
  });

  it('errors when the connected wallet controls a different address', async () => {
    const service = setup(makeWallet({ connectedWallet$: { getValue: () => ({ ordinalsAddress: 'bc1p-someone-else' }) } }));
    await expect(firstValueFrom(service.headersFor(ADDR))).rejects.toThrow(/controls bc1p-someone-else, not/);
  });

  it('clearFor removes the cached session', () => {
    localStorage.setItem(KEY, JSON.stringify({ address: ADDR, validUntilIso: 'x', signature: 's' }));
    const service = setup(makeWallet());
    service.clearFor(ADDR);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('treats a malformed cache entry as absent and re-signs', async () => {
    const wallet = makeWallet();
    localStorage.setItem(KEY, '{not-valid-json');
    const service = setup(wallet);

    const headers = await firstValueFrom(service.headersFor(ADDR));

    expect(headers['X-Cat21-Session-Signature']).toBe('fresh-sig');
    expect(wallet.signMessage).toHaveBeenCalledTimes(1);
  });
});
