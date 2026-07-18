import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, Observable, of, throwError } from 'rxjs';

import { WalletInfo, WalletService } from 'ordpool-sdk';

import { Details } from './details';
import { ApiService } from '../shared/cat21-api';
import { OrdApiService } from '../shared/ord-api.service';
import { makeWallet, WalletServiceStub } from '../testing/wallet.fixtures';

// ---------------------------------------------------------------------------
// Split payment vs ordinals addresses ARE THE POINT of this spec. We're
// pinning the sell modal's ORIGIN of the payTo permalink parameter —
// wallet.paymentAddress, never wallet.ordinalsAddress and never the ord
// owner lookup. This is the source-side guarantee to the
// make-offer/accept-offer fixes.
// ---------------------------------------------------------------------------
const WALLET_PAYMENT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx';
const WALLET_ORDINALS = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';

const wallet = makeWallet;

class ApiServiceStub {
  catsControllerGetCatByNumber = jest.fn((_: number) => of({} as unknown));
  catsControllerGetStatus = jest.fn(() => of({ lastSyncedCatNumber: 100_000 } as unknown));
}

class OrdApiServiceStub {
  private ownerImpl: (n: number) => Observable<string | null> = () => EMPTY;
  setOwner(fn: (n: number) => Observable<string | null>) {
    this.ownerImpl = fn;
  }
  getCurrentOwner = (n: number) => this.ownerImpl(n);
}

async function setup(opts: {
  catNumber?: number;
  payTo?: string;
  ask?: string;
  owner?: (n: number) => Observable<string | null>;
} = {}) {
  const walletService = new WalletServiceStub();
  const api = new ApiServiceStub();
  const ordApi = new OrdApiServiceStub();
  if (opts.owner) ordApi.setOwner(opts.owner);

  await TestBed.configureTestingModule({
    imports: [Details],
    providers: [
      provideHttpClient(),
      provideRouter([]),
      { provide: WalletService, useValue: walletService },
      { provide: ApiService, useValue: api },
      { provide: OrdApiService, useValue: ordApi },
    ],
  })
    .overrideComponent(Details, { set: { template: '', imports: [] } })
    .compileComponents();

  const fixture = TestBed.createComponent(Details);
  fixture.componentRef.setInput('catNumber', opts.catNumber ?? 42);
  if (opts.payTo !== undefined) fixture.componentRef.setInput('payTo', opts.payTo);
  if (opts.ask !== undefined) fixture.componentRef.setInput('ask', opts.ask);
  fixture.detectChanges();

  return { fixture, component: fixture.componentInstance, walletService, ordApi, api };
}

describe('Details — sell permalink (`generatedPermalink`)', () => {

  it('null when askInput is empty', async () => {
    const { component } = await setup();
    expect(component.generatedPermalink()).toBeNull();
  });

  it('null when askInput is not a positive integer', async () => {
    const { component } = await setup();
    component.onAskInputChange('not-a-number');
    expect(component.generatedPermalink()).toBeNull();
    component.onAskInputChange('0');
    expect(component.generatedPermalink()).toBeNull();
    component.onAskInputChange('-1');
    expect(component.generatedPermalink()).toBeNull();
  });

  it('with a wallet connected, includes payTo=wallet.paymentAddress (the fix) AND ask=<n>', async () => {
    const { component, walletService } = await setup();
    walletService.connectedWalletSubject.next(wallet());
    component.onAskInputChange('21000');

    const url = component.generatedPermalink();
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe('/cat/42');
    expect(parsed.searchParams.get('ask')).toBe('21000');
    // CRITICAL: payTo is the wallet's PAYMENT address, not the ordinals one.
    expect(parsed.searchParams.get('payTo')).toBe(WALLET_PAYMENT);
    // Explicit anti-regression: the ordinals address must never appear.
    expect(url).not.toContain(WALLET_ORDINALS);
  });

  it('without a wallet, falls back to ask-only (no payTo) so buyer prompts seller instead of silent misroute', async () => {
    const { component } = await setup();
    component.onAskInputChange('21000');
    const url = component.generatedPermalink();
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get('ask')).toBe('21000');
    expect(parsed.searchParams.get('payTo')).toBeNull();
  });

  it('wallet swap updates payTo in the generated link', async () => {
    const OLD_PAY = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx';
    const NEW_PAY = 'bc1qgc0m7cd9s3z9wmpc9djcygxzr9s5s9rlaqlfr9';
    const { component, walletService } = await setup();
    walletService.connectedWalletSubject.next(wallet({ paymentAddress: OLD_PAY }));
    component.onAskInputChange('21000');
    expect(new URL(component.generatedPermalink()!).searchParams.get('payTo')).toBe(OLD_PAY);
    walletService.connectedWalletSubject.next(wallet({ paymentAddress: NEW_PAY }));
    expect(new URL(component.generatedPermalink()!).searchParams.get('payTo')).toBe(NEW_PAY);
  });
});

describe('Details — buyQueryParams (forward payTo from URL to make-offer)', () => {

  it('URL carries payTo → buyQueryParams forwards sellerPaymentAddress', async () => {
    const { component } = await setup({ catNumber: 7, ask: '21000', payTo: WALLET_PAYMENT });
    const params = component.buyQueryParams();
    expect(params['catNumber']).toBe('7');
    expect(params['askPrice']).toBe('21000');
    expect(params['payTo']).toBe(WALLET_PAYMENT);
  });

  it('URL lacks payTo → buyQueryParams omits it (legacy links still work; buyer types it)', async () => {
    const { component } = await setup({ catNumber: 7, ask: '21000' });
    const params = component.buyQueryParams();
    expect(params['catNumber']).toBe('7');
    expect(params['askPrice']).toBe('21000');
    expect(params['payTo']).toBeUndefined();
  });

  it('URL lacks ask → buyQueryParams omits askPrice too', async () => {
    const { component } = await setup({ catNumber: 7 });
    const params = component.buyQueryParams();
    expect(params['catNumber']).toBe('7');
    expect(params['askPrice']).toBeUndefined();
    expect(params['payTo']).toBeUndefined();
  });
});

describe('Details — button state computeds', () => {

  it('all three buttons downgrade to "connect" when no wallet + owner resolved', async () => {
    const { fixture, component } = await setup({
      owner: () => of('bc1p-someone-else'),
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(component.sellButtonState()).toBe('connect');
    expect(component.buyButtonState()).toBe('connect');
    expect(component.sendButtonState()).toBe('connect');
  });

  it('owner === wallet.ordinalsAddress → sell/send enabled, buy owns-it', async () => {
    const { fixture, component, walletService } = await setup({
      owner: () => of(WALLET_ORDINALS),
    });
    walletService.connectedWalletSubject.next(wallet());
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(component.sellButtonState()).toBe('enabled');
    expect(component.sendButtonState()).toBe('enabled');
    expect(component.buyButtonState()).toBe('owns-it');
  });

  it('owner !== wallet.ordinalsAddress → sell/send not-owner, buy enabled', async () => {
    const { fixture, component, walletService } = await setup({
      owner: () => of('bc1p-someone-else'),
    });
    walletService.connectedWalletSubject.next(wallet());
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(component.sellButtonState()).toBe('not-owner');
    expect(component.sendButtonState()).toBe('not-owner');
    expect(component.buyButtonState()).toBe('enabled');
  });

  it('owner = null (free / unspendable) → all three buttons are "free"', async () => {
    const { fixture, component, walletService } = await setup({
      owner: () => of(null),
    });
    walletService.connectedWalletSubject.next(wallet());
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(component.sellButtonState()).toBe('free');
    expect(component.buyButtonState()).toBe('free');
    expect(component.sendButtonState()).toBe('free');
    expect(component.isFree()).toBe(true);
  });

  it('ord lookup errors → all three buttons are "unknown" (never guess)', async () => {
    const { fixture, component, walletService } = await setup({
      owner: () => throwError(() => new Error('ord down')),
    });
    walletService.connectedWalletSubject.next(wallet());
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(component.sellButtonState()).toBe('unknown');
    expect(component.buyButtonState()).toBe('unknown');
    expect(component.sendButtonState()).toBe('unknown');
    expect(component.ownerLookupUnknown()).toBe(true);
  });
});

describe('Details — askSats parsing', () => {
  it('unspecified → null', async () => {
    const { component } = await setup();
    expect(component.askSats()).toBeNull();
  });

  it('positive integer → number', async () => {
    const { component } = await setup({ ask: '21000' });
    expect(component.askSats()).toBe(21_000);
  });

  it('zero → null', async () => {
    const { component } = await setup({ ask: '0' });
    expect(component.askSats()).toBeNull();
  });

  it('garbage → null', async () => {
    const { component } = await setup({ ask: 'nope' });
    expect(component.askSats()).toBeNull();
  });
});
