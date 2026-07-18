import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';

import {
  BuyOfferTargetCat,
  Cat21CreateOfferOrchestrator,
  CreateOfferSimulationOutcome,
  RecommendedFees,
  TxnOutput,
  UtxoContentScanner,
  UtxoScanState,
  WalletInfo,
  WalletService,
  cat21Config,
} from 'ordpool-sdk';

import { MakeOffer } from './make-offer';
import { CatUtxoLookupService } from '../../../shared/cat-utxo-lookup.service';
import { makeWallet, WalletServiceStub } from '../../../testing/wallet.fixtures';

// ---------------------------------------------------------------------------
// Distinct addresses ARE THE POINT of this spec. Splitting them ensures
// any "auto-fill payment address from the cat's on-chain owner lookup"
// regression re-appearing is caught — the on-chain owner returns the
// ordinals address, and that value must NEVER flow into sellerPaymentAddress.
// See SDK CLAUDE.md HARD RULE "Never derive a payment address from an
// on-chain lookup".
// ---------------------------------------------------------------------------
const WALLET_ORDINALS_ADDRESS = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';
const WALLET_PAYMENT_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx';

// The on-chain owner of any given cat is the seller's ordinals address
// (cats live on the ordinals key per ordinal theory). We hand this
// string to `getTargetByNumber(...).sellerAddress` — the same shape ord
// returns in production.
const CAT_OWNER_ORDINALS_ADDRESS = 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh';

// Local wrapper — same shape as the shared `makeWallet` but with the
// spec's specific WALLET_* addresses baked in as the defaults. Callers
// can still override any field.
const wallet = (over: Partial<WalletInfo> = {}): WalletInfo =>
  makeWallet({
    ordinalsAddress: WALLET_ORDINALS_ADDRESS,
    paymentAddress: WALLET_PAYMENT_ADDRESS,
    ...over,
  });

function target(over: Partial<BuyOfferTargetCat> = {}): BuyOfferTargetCat {
  return {
    catNumber: 42,
    txid: 'a'.repeat(64),
    vout: 0,
    value: 546,
    scriptPubKey: new Uint8Array([0x51, 0x20]),
    ...over,
  };
}

class OrchestratorStub {
  readonly connectedWallet: WritableSignal<WalletInfo | null> = signal(null);
  readonly state: WritableSignal<'idle' | 'loading-utxos' | 'ready' | 'signing' | 'success' | 'error'> = signal('idle');
  readonly errorMessage: WritableSignal<string | null> = signal(null);
  readonly offerArtifact: WritableSignal<{ base64: string; hex: string } | null> = signal(null);
  readonly feeRate: WritableSignal<number | null> = signal(null);
  readonly targetCat: WritableSignal<BuyOfferTargetCat | null> = signal(null);
  readonly sellerPaymentAddress: WritableSignal<string | null> = signal(null);
  readonly priceSats: WritableSignal<number | null> = signal(null);
  readonly buyerReceiveAddress: WritableSignal<string | null> = signal(null);
  readonly selectedFundingUtxo: WritableSignal<TxnOutput | null> = signal(null);

  readonly simulationSubject = new BehaviorSubject<CreateOfferSimulationOutcome | null>(null);
  readonly simulation$ = this.simulationSubject.asObservable();

  readonly recommendedFeesSubject = new Subject<RecommendedFees>();
  readonly recommendedFees$ = this.recommendedFeesSubject.asObservable();

  readonly buyerFundingUtxosSubject = new BehaviorSubject<TxnOutput[]>([]);
  readonly buyerFundingUtxos$ = this.buyerFundingUtxosSubject.asObservable();

  readonly createOfferReturn$ = new Subject<{ base64: string; hex: string }>();

  setTargetCat = jest.fn((c: BuyOfferTargetCat | null) => this.targetCat.set(c));
  setSellerPaymentAddress = jest.fn((addr: string | null) => this.sellerPaymentAddress.set(addr));
  setPriceSats = jest.fn((p: number) => this.priceSats.set(p));
  setBuyerReceiveAddress = jest.fn((a: string | null) => this.buyerReceiveAddress.set(a));
  setFeeRate = jest.fn((r: number) => this.feeRate.set(r));
  setSelectedFundingUtxo = jest.fn((u: TxnOutput | null) => this.selectedFundingUtxo.set(u));
  createOffer = jest.fn((): Observable<{ base64: string; hex: string }> => this.createOfferReturn$.asObservable());
  reset = jest.fn();
}

class ScannerStub {
  readonly statesSubject = new BehaviorSubject<ReadonlyMap<string, UtxoScanState>>(new Map());
  readonly states$ = this.statesSubject.asObservable();
  scan = jest.fn((_: string) => of<UtxoScanState>({ kind: 'scanned-clean' }));
  autoScan = jest.fn((_: unknown[]) => undefined);
  reset = jest.fn();
  getState = jest.fn((_: string): UtxoScanState => ({ kind: 'not-scanned' }));
}

class LookupStub {
  readonly getTargetByNumberImpl = jest.fn((_: number) =>
    of({ target: target(), sellerAddress: CAT_OWNER_ORDINALS_ADDRESS }),
  );
  getTargetByNumber = (n: number) => this.getTargetByNumberImpl(n);
  getMyHoldings = jest.fn();
}

describe('MakeOffer regression — sellerPaymentAddress never derived from on-chain owner', () => {
  let orchestrator: OrchestratorStub;
  let scanner: ScannerStub;
  let walletService: WalletServiceStub;
  let lookup: LookupStub;
  let fixture: ComponentFixture<MakeOffer>;
  let component: MakeOffer;

  beforeEach(async () => {
    orchestrator = new OrchestratorStub();
    scanner = new ScannerStub();
    walletService = new WalletServiceStub();
    lookup = new LookupStub();

    await TestBed.configureTestingModule({
      imports: [MakeOffer],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Cat21CreateOfferOrchestrator, useValue: orchestrator },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: walletService },
        { provide: CatUtxoLookupService, useValue: lookup },
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
      // Skip the template — we're testing component logic, not the UI.
      // The template pulls in WalletConnect + PendingCats which each
      // subscribe to unrelated observables; not our concern here.
      .overrideComponent(MakeOffer, { set: { template: '', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(MakeOffer);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does NOT call setSellerPaymentAddress with the cat owner address after a lookup', () => {
    // Arrange: buyer types a cat number; lookup returns the ordinals
    // address ord provided (= current owner).
    component.draft.update((d) => ({ ...d, catNumberInput: '42' }));

    // Act: this is the code path the buyer hits clicking "Look up cat".
    component.onLookupCatClick();

    // Assert 1 — the ONE regression that must hold. Every call to
    // setSellerPaymentAddress (past + future) must NOT carry the on-
    // chain owner address. If a future refactor re-adds
    // `orchestrator.setSellerPaymentAddress(result.sellerAddress)`
    // inside the lookup subscriber, this assertion fails.
    for (const call of orchestrator.setSellerPaymentAddress.mock.calls) {
      expect(call[0]).not.toBe(CAT_OWNER_ORDINALS_ADDRESS);
    }

    // Assert 2 — the ord lookup itself DID run (this test is not a
    // vacuous no-op because the subscriber never fired).
    expect(lookup.getTargetByNumberImpl).toHaveBeenCalledWith(42);

    // Assert 3 — setTargetCat's FINAL call receives the parsed target
    // (that part of the lookup is legitimate: the target's txid + vout
    // + scriptPubKey are cat-outpoint context, not address-type
    // context). The lookup first clears with `null` then sets the
    // resolved target.
    expect(orchestrator.setTargetCat).toHaveBeenCalledTimes(2);
    const calls = orchestrator.setTargetCat.mock.calls;
    expect(calls[0]![0]).toBeNull();
    const finalTarget = calls[1]![0] as BuyOfferTargetCat;
    expect(finalTarget.catNumber).toBe(42);
  });

  it('does propagate a URL-supplied payTo into the orchestrator (the correct source)', async () => {
    // The `payTo` URL param comes from the seller's own wallet at
    // sell-modal-open time — that's the sanctioned source for the
    // payment address. Prove this input signal path DOES reach the
    // orchestrator so the bug fix doesn't cut off the intended flow.
    fixture.componentRef.setInput('catNumber', '42');
    fixture.componentRef.setInput('payTo', WALLET_PAYMENT_ADDRESS);
    // The prefill effect reads `this.connectedWallet()`, which points at
    // `orchestrator.connectedWallet` (NOT WalletService). Set on the
    // orchestrator's signal so the effect's dependency actually fires.
    orchestrator.connectedWallet.set(wallet());
    fixture.detectChanges();
    // Effects run async — await a microtask so the prefill effect fires.
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const paymentCalls = orchestrator.setSellerPaymentAddress.mock.calls
      .map((c) => c[0]);
    expect(paymentCalls).toContain(WALLET_PAYMENT_ADDRESS);
    // And critically: NOT the ordinals address.
    expect(paymentCalls).not.toContain(WALLET_ORDINALS_ADDRESS);
    expect(paymentCalls).not.toContain(CAT_OWNER_ORDINALS_ADDRESS);
  });
});
