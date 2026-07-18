import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';

import {
  Cat21AcceptOfferOrchestrator,
  Cat21OfferValidation,
  CatOutpoint,
  ParsedOffer,
  WalletInfo,
  WalletService,
  cat21Config,
} from 'ordpool-sdk';

import { AcceptOffer } from './accept-offer';
import { CatUtxoLookupService, MyCatHolding } from '../../../shared/cat-utxo-lookup.service';
import { makeWallet, WalletServiceStub } from '../../../testing/wallet.fixtures';

const WALLET_ORDINALS = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';
const WALLET_PAYMENT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx';

const wallet = (over: Partial<WalletInfo> = {}): WalletInfo =>
  makeWallet({
    ordinalsAddress: WALLET_ORDINALS,
    paymentAddress: WALLET_PAYMENT,
    ...over,
  });

class OrchestratorStub {
  readonly connectedWallet: WritableSignal<WalletInfo | null> = signal(null);
  readonly state: WritableSignal<'idle' | 'parsed' | 'invalid' | 'accepting' | 'success' | 'error'> = signal('idle');
  readonly errorMessage: WritableSignal<string | null> = signal(null);
  readonly successTxId: WritableSignal<string | null> = signal(null);
  readonly parsedOffer: WritableSignal<ParsedOffer | null> = signal(null);
  readonly validationResult: WritableSignal<Cat21OfferValidation | null> = signal(null);
  readonly pastedOffer: WritableSignal<string | null> = signal(null);
  readonly expectedCatUtxo: WritableSignal<CatOutpoint | null> = signal(null);
  readonly floorPriceSats: WritableSignal<number | null> = signal(null);
  readonly canAccept = signal(false);

  disableFloorGate = jest.fn();
  setPastedOffer = jest.fn((p: string | null) => this.pastedOffer.set(p));
  setExpectedCatUtxo = jest.fn((u: CatOutpoint | null) => this.expectedCatUtxo.set(u));
  setExpectedSellerPaymentAddress = jest.fn();
  setFloorPriceSats = jest.fn((n: number) => this.floorPriceSats.set(n));
  acceptOffer = jest.fn((): Observable<{ txid: string }> => of({ txid: 'broadcast-txid' }));
  reset = jest.fn();
}

class LookupStub {
  readonly getMyHoldingsImpl = jest.fn((_: string) => of([] as MyCatHolding[]));
  getMyHoldings = (a: string) => this.getMyHoldingsImpl(a);
  getTargetByNumber = jest.fn();
}

const routeStub = (queryParams: Record<string, string> = {}) => ({
  snapshot: { queryParams },
});

async function setup(queryParams: Record<string, string> = {}) {
  const orchestrator = new OrchestratorStub();
  const walletService = new WalletServiceStub();
  const lookup = new LookupStub();

  await TestBed.configureTestingModule({
    imports: [AcceptOffer],
    providers: [
      provideHttpClient(),
      { provide: Cat21AcceptOfferOrchestrator, useValue: orchestrator },
      { provide: WalletService, useValue: walletService },
      { provide: CatUtxoLookupService, useValue: lookup },
      { provide: ActivatedRoute, useValue: routeStub(queryParams) },
      {
        provide: cat21Config,
        useValue: {
          ordApiUrl: 'http://test-ord/',
          cat21OrdApiUrl: 'http://test-cat21-ord/',
          slipstreamApiUrl: 'http://test-slipstream/',
        },
      },
    ],
  })
    .overrideComponent(AcceptOffer, { set: { template: '', imports: [] } })
    .compileComponents();

  const fixture = TestBed.createComponent(AcceptOffer);
  fixture.componentRef.instance.ngOnInit();
  fixture.detectChanges();

  return { fixture, component: fixture.componentInstance, orchestrator, walletService, lookup };
}

describe('AcceptOffer — validator rejections surface to UI', () => {

  it('humanRejection is null when no validation has run', async () => {
    const { component } = await setup();
    expect(component.humanRejection()).toBeNull();
  });

  it('payment-output-wrong-address (the regression class we care about) → specific human string + canAccept stays false', async () => {
    const { component, orchestrator } = await setup();
    orchestrator.validationResult.set({
      ok: false,
      reason: 'payment-output-wrong-address',
      detail: 'expected bc1qEXPECTED got bc1pWRONG',
    });
    orchestrator.canAccept.set(false);
    expect(component.humanRejection()).toBe(
      'The seller-payment output is going to a different address than expected. expected bc1qEXPECTED got bc1pWRONG',
    );
    expect(component.canAccept()).toBe(false);
  });

  const REJECTION_CASES: Array<[string, string]> = [
    ['missing-seller-input', "The offer's input 0 doesn't reference your cat."],
    ['wrong-postage', 'The cat output postage is wrong (expected 546 sats).'],
    ['wrong-price', 'The seller-payment output is below your floor price.'],
    ['sighash-not-all', 'The offer commits with a sighash other than SIGHASH_ALL — not accepting that.'],
    ['buyer-input-unsigned', "The buyer hasn't signed all their funding inputs yet."],
    ['missing-seller-payment-output', "The offer's payment output is missing."],
  ];

  it.each(REJECTION_CASES)('rejection reason %s maps to the expected human string', async (reason, expected) => {
    const { component, orchestrator } = await setup();
    orchestrator.validationResult.set({ ok: false, reason: reason as never, detail: '' });
    expect(component.humanRejection()).toBe(expected.trim());
  });

  it('unknown rejection reason falls through to a generic "Rejected: …" message', async () => {
    const { component, orchestrator } = await setup();
    orchestrator.validationResult.set({
      ok: false,
      // Deliberately not one of the branched reasons; the rejectionToHuman
      // function's default branch should catch it.
      reason: 'some-future-reason' as never,
      detail: 'why',
    });
    const msg = component.humanRejection();
    expect(msg).toBeTruthy();
    expect(msg).toContain('Rejected');
    expect(msg).toContain('some-future-reason');
  });

  it('validationResult.ok=true → humanRejection is null', async () => {
    const { component, orchestrator } = await setup();
    orchestrator.validationResult.set({
      ok: true,
      pricePaidSats: 21_000,
      postageSats: 546,
    } as unknown as Cat21OfferValidation);
    expect(component.humanRejection()).toBeNull();
  });
});

describe('AcceptOffer — URL prefill via ?offer=&catTxid=&catVout=', () => {

  it('URL supplies BOTH offer + catOutpoint → orchestrator receives both', async () => {
    const { component, orchestrator } = await setup({
      offer: 'cHNidP8BAA==', // valid base64 shape; the orchestrator itself validates further
      catTxid: 'a'.repeat(64),
      catVout: '0',
    });
    // urlCatOutpoint is populated from the URL for the effect fallback.
    expect(component.urlCatOutpoint()).toEqual({ txid: 'a'.repeat(64), vout: 0 });
    expect(orchestrator.setPastedOffer).toHaveBeenCalledWith('cHNidP8BAA==');
  });

  it('URL missing catTxid → urlCatOutpoint stays null; orchestrator gets pasted offer only', async () => {
    const { component, orchestrator } = await setup({ offer: 'cHNidP8BAA==' });
    expect(component.urlCatOutpoint()).toBeNull();
    expect(orchestrator.setPastedOffer).toHaveBeenCalledWith('cHNidP8BAA==');
  });

  it('no URL params → orchestrator receives nothing at init; state stays idle', async () => {
    const { component, orchestrator } = await setup();
    expect(component.urlCatOutpoint()).toBeNull();
    expect(orchestrator.setPastedOffer).not.toHaveBeenCalled();
    expect(orchestrator.state()).toBe('idle');
  });

  it('disableFloorGate is called on init (opts out of the SDK safety-net)', async () => {
    const { orchestrator } = await setup();
    expect(orchestrator.disableFloorGate).toHaveBeenCalled();
  });
});

describe('AcceptOffer — wallet-driven picker/payment wiring', () => {

  it('when a wallet connects with the URL outpoint already set, the orchestrator receives BOTH the outpoint AND the seller-payment address', async () => {
    const { fixture, orchestrator, walletService } = await setup({
      catTxid: 'b'.repeat(64),
      catVout: '1',
    });
    walletService.connectedWalletSubject.next(wallet());
    fixture.detectChanges();
    // Effect scheduler is async — give it several ticks.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();

    expect(orchestrator.setExpectedCatUtxo).toHaveBeenCalledWith({
      txid: 'b'.repeat(64),
      vout: 1,
    });
    // CRITICAL: the seller-payment address the seller expects comes
    // from wallet.paymentAddress — NOT from any lookup or from the
    // wallet.ordinalsAddress. This is the symmetric guarantee to the
    // buyer-side make-offer fix.
    expect(orchestrator.setExpectedSellerPaymentAddress).toHaveBeenCalledWith(WALLET_PAYMENT);
    expect(orchestrator.setExpectedSellerPaymentAddress).not.toHaveBeenCalledWith(WALLET_ORDINALS);
  });

  it('picker selection overrides urlCatOutpoint when both are present', async () => {
    const { fixture, component, orchestrator, walletService, lookup } = await setup({
      catTxid: 'b'.repeat(64),
      catVout: '0',
    });
    const holding: MyCatHolding = {
      catNumber: 999,
      inscriptionId: 'inscription-999-i0',
      txid: 'c'.repeat(64),
      vout: 2,
      value: 546,
    } as MyCatHolding;
    lookup.getMyHoldingsImpl.mockReturnValue(of([holding]));
    walletService.connectedWalletSubject.next(wallet());
    fixture.detectChanges();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    fixture.detectChanges();

    component.onCatPick('inscription-999-i0');
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();

    // Picker selection wins over urlCatOutpoint. Look for the picker
    // call anywhere in the history (not just the last one — the effect
    // may have re-run when the wallet connected first).
    const calls = orchestrator.setExpectedCatUtxo.mock.calls;
    const pickerCall = calls.find(
      (c) => (c[0] as CatOutpoint | null)?.txid === 'c'.repeat(64),
    );
    expect(pickerCall).toBeDefined();
    expect(pickerCall![0]).toEqual({ txid: 'c'.repeat(64), vout: 2 });
  });
});

describe('AcceptOffer — form actions', () => {

  it('onPasteChange forwards to orchestrator', async () => {
    const { component, orchestrator } = await setup();
    component.onPasteChange('cHNidP8BAA==');
    expect(orchestrator.setPastedOffer).toHaveBeenCalledWith('cHNidP8BAA==');
  });

  it('onFloorPriceChange with empty string → orchestrator floor=0 (accept any positive offer)', async () => {
    const { component, orchestrator } = await setup();
    component.onFloorPriceChange('   ');
    expect(orchestrator.setFloorPriceSats).toHaveBeenCalledWith(0);
  });

  it('onFloorPriceChange with a positive integer → orchestrator floor=n', async () => {
    const { component, orchestrator } = await setup();
    component.onFloorPriceChange('21000');
    expect(orchestrator.setFloorPriceSats).toHaveBeenCalledWith(21_000);
  });

  it('onFloorPriceChange with garbage → orchestrator not called (input parser rejects)', async () => {
    const { component, orchestrator } = await setup();
    orchestrator.setFloorPriceSats.mockClear();
    component.onFloorPriceChange('not-a-number');
    expect(orchestrator.setFloorPriceSats).not.toHaveBeenCalled();
  });

  it('onFloorPriceChange with negative → orchestrator not called', async () => {
    const { component, orchestrator } = await setup();
    orchestrator.setFloorPriceSats.mockClear();
    component.onFloorPriceChange('-1');
    expect(orchestrator.setFloorPriceSats).not.toHaveBeenCalled();
  });

  it('onAcceptClick triggers orchestrator.acceptOffer()', async () => {
    const { component, orchestrator } = await setup();
    component.onAcceptClick();
    expect(orchestrator.acceptOffer).toHaveBeenCalledTimes(1);
  });

  it('onResetClick calls orchestrator.reset() + clears local state', async () => {
    const { component, orchestrator } = await setup();
    component.onFloorPriceChange('50000');
    component.onCatPick('inscription-x-i0');
    component.onResetClick();
    expect(orchestrator.reset).toHaveBeenCalled();
    expect(component.selectedInscriptionId()).toBeNull();
    expect(component.floorPriceInput()).toBe('');
  });
});
