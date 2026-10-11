/**
 * @test-kind unit
 * Real:   AcceptOffer component; the SDK Cat21AcceptOfferOrchestrator (validates and signs for real);
 *         buy-offer PSBTs built and buyer-signed by @scure/btc-signer (testing/buy-offer-psbt.fixtures)
 * Faked:  orchestrator broadcast port -> jest.fn answering the txid of the tx it is handed (electrs POST /tx shape)
 *         window.Cat21Provider (the wallet API) -> installFakeCat21Provider, signing with the test wallet's keys
 *         WalletService -> WalletServiceStub (testing/wallet.fixtures)
 *         CatUtxoLookupService -> jest.fn() (hand-written; a sibling module)
 *         ActivatedRoute -> hand-written query params
 * Proves: the orchestrator's validation verdict surfaces as the human rejection, every SDK rejection reason has its
 *         own sentence, the URL prefills offer and cat outpoint, the wallet drives the expected cat and payout
 *         address, and accept signs input 0 and broadcasts
 */
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import {
  BroadcastOutcome,
  Cat21AcceptOfferOrchestrator,
  CatOutpoint,
  Network,
  WalletService,
} from 'ordpool-sdk';

import { cat21Config } from '../../../shared/sdk-tokens';

import { AcceptOffer, rejectionToHuman } from './accept-offer';
import { CatUtxoLookupService, MyCatHolding } from '../../../shared/cat-utxo-lookup.service';
import { WalletServiceStub } from '../../../testing/wallet.fixtures';
import { BUYER_PAYMENT_ADDRESS, buildOfferPsbt } from '../../../testing/buy-offer-psbt.fixtures';
import {
  TEST_ORDINALS_ADDRESS,
  TEST_PAYMENT_ADDRESS,
  installFakeCat21Provider,
  testWallet,
} from '../../../testing/test-wallet.fixtures';

const CAT_TXID = 'b'.repeat(64);
const CAT = { txid: CAT_TXID, vout: 1, value: 546 };
const PRICE = 21_000;

class LookupStub {
  readonly getMyHoldingsImpl = jest.fn((_: string) => of([] as MyCatHolding[]));
  getMyHoldings = (a: string) => this.getMyHoldingsImpl(a);
  getTargetByNumber = jest.fn();
}

const routeStub = (queryParams: Record<string, string> = {}) => ({
  snapshot: { queryParams },
});

let provider: ReturnType<typeof installFakeCat21Provider> | null = null;

afterEach(() => {
  provider?.restore();
  provider = null;
});

async function setup(queryParams: Record<string, string> = {}) {
  const broadcast = jest.fn(async (signedTxHex: string): Promise<BroadcastOutcome> =>
    ({ txid: `txid-of-${signedTxHex.length}`, channel: 'mempool' }));
  const orchestrator = new Cat21AcceptOfferOrchestrator({ broadcast, network: Network.Mainnet });
  // Spies call through: the orchestrator keeps its real behaviour, the spec
  // only reads what the component asked of it.
  const spies = {
    setWallet: jest.spyOn(orchestrator, 'setWallet'),
    disableFloorGate: jest.spyOn(orchestrator, 'disableFloorGate'),
    setPastedOffer: jest.spyOn(orchestrator, 'setPastedOffer'),
    setExpectedCatUtxo: jest.spyOn(orchestrator, 'setExpectedCatUtxo'),
    setExpectedSellerPaymentAddress: jest.spyOn(orchestrator, 'setExpectedSellerPaymentAddress'),
    setFloorPriceSats: jest.spyOn(orchestrator, 'setFloorPriceSats'),
    acceptOffer: jest.spyOn(orchestrator, 'acceptOffer'),
    reset: jest.spyOn(orchestrator, 'reset'),
  };
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

  /** Let the component's effects run and the orchestrator settle. */
  async function settle(ticks = 5): Promise<void> {
    fixture.detectChanges();
    for (let i = 0; i < ticks; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  return { fixture, component: fixture.componentInstance, orchestrator, spies, broadcast, walletService, lookup, settle };
}

/** The seller's page with the wallet connected and the cat outpoint from the URL. */
async function sellerReady() {
  const ctx = await setup({ catTxid: CAT.txid, catVout: String(CAT.vout) });
  ctx.walletService.connectedWalletSubject.next(testWallet());
  await ctx.settle();
  return ctx;
}

describe('AcceptOffer: the orchestrator verdict surfaces to the UI', () => {

  it('humanRejection is null when no validation has run', async () => {
    const { component } = await setup();
    expect(component.humanRejection()).toBeNull();
  });

  it('payment-output-wrong-address (the regression class we care about) → specific human string + canAccept stays false', async () => {
    const { component, settle } = await sellerReady();
    // The buyer's offer pays the seller's price to the buyer's own address.
    component.onPasteChange(buildOfferPsbt({ cat: CAT, priceSats: PRICE, sellerPaymentAddress: BUYER_PAYMENT_ADDRESS }));
    await settle();

    expect(component.humanRejection()).toBe(
      'The seller-payment output is going to a different address than expected. ' +
        `expected ${TEST_PAYMENT_ADDRESS}, got ${BUYER_PAYMENT_ADDRESS}`,
    );
    expect(component.state()).toBe('invalid');
    expect(component.canAccept()).toBe(false);
  });

  it('an offer for another cat surfaces as missing-seller-input', async () => {
    const { component, settle } = await sellerReady();
    component.onPasteChange(buildOfferPsbt({ cat: { ...CAT, txid: 'c'.repeat(64) }, priceSats: PRICE }));
    await settle();

    expect(component.humanRejection()).toBe(`The offer's input 0 doesn't reference your cat. got ${'c'.repeat(64)}:${CAT.vout}`);
    expect(component.canAccept()).toBe(false);
  });

  it('a paste that is not a PSBT surfaces as malformed-offer-psbt', async () => {
    const { component, settle } = await sellerReady();
    component.onPasteChange('definitely not a psbt');
    await settle();

    expect(component.humanRejection()).toMatch(/^The offer isn't a valid PSBT \(bad magic bytes, parse failure, or no inputs\)\. \S/);
    expect(component.canAccept()).toBe(false);
  });

  it('a valid offer for the seller\'s cat → no rejection, canAccept true', async () => {
    const { component, settle } = await sellerReady();
    component.onPasteChange(buildOfferPsbt({ cat: CAT, priceSats: PRICE }));
    await settle();

    expect(component.validationResult()).toEqual({ ok: true, pricePaidSats: PRICE, postageSats: CAT.value });
    expect(component.humanRejection()).toBeNull();
    expect(component.state()).toBe('parsed');
    expect(component.canAccept()).toBe(true);
  });
});

describe('rejectionToHuman: one sentence per SDK rejection reason', () => {

  const REJECTION_CASES: Array<[string, string]> = [
    ['malformed-offer-psbt', "The offer isn't a valid PSBT (bad magic bytes, parse failure, or no inputs)."],
    ['missing-seller-input', "The offer's input 0 doesn't reference your cat."],
    // wrong-postage does not pin 546: ord preserves the cat's real UTXO
    // value on output 0, so the only invariant is the dust floor.
    ['wrong-postage', 'The cat output value is below the dust floor.'],
    ['wrong-price', 'The seller-payment output is below your floor price.'],
    ['wrong-price-exact', "The offer's price doesn't exactly match the expected amount."],
    ['wrong-seller-input-value', "The offer's declared seller-input value doesn't match your cat's on-chain value."],
    ['sighash-not-all', 'The offer commits with a sighash other than SIGHASH_ALL — not accepting that.'],
    ['sighash-flag-byte-not-all', 'A signature in the offer uses a sighash flag byte other than SIGHASH_ALL (0x01).'],
    ['buyer-input-unsigned', "The buyer hasn't signed all their funding inputs yet."],
    ['missing-seller-payment-output', "The offer's payment output is missing."],
    ['payment-output-wrong-address', 'The seller-payment output is going to a different address than expected.'],
    ['cat-output-not-spendable', 'The cat output has no valid address, so it would be unspendable.'],
    ['cat-output-wrong-address', "The cat output is going to a different address than the buyer's receive address."],
    ['change-output-wrong-address', "The buyer's change output is going to an unexpected address."],
  ];

  it.each(REJECTION_CASES)('rejection reason %s maps to the expected human string', (reason, expected) => {
    expect(rejectionToHuman(reason as never, '')).toBe(expected.trim());
  });

  it('appends the SDK detail after the sentence', () => {
    expect(rejectionToHuman('wrong-price', '20000 < 21000')).toBe('The seller-payment output is below your floor price. 20000 < 21000');
  });

  it('unknown rejection reason falls through to a generic "Rejected: …" message', () => {
    // Deliberately not one of the branched reasons; the default branch catches it.
    const msg = rejectionToHuman('some-future-reason' as never, 'why');
    expect(msg).toBe('Rejected: some-future-reason why');
  });
});

describe('AcceptOffer — URL prefill via ?offer=&catTxid=&catVout=', () => {

  it('URL supplies BOTH offer + catOutpoint → orchestrator receives both', async () => {
    const offer = buildOfferPsbt({ cat: CAT, priceSats: PRICE });
    const { component, spies, orchestrator } = await setup({
      offer,
      catTxid: CAT.txid,
      catVout: String(CAT.vout),
    });
    // urlCatOutpoint is populated from the URL for the effect fallback.
    expect(component.urlCatOutpoint()).toEqual({ txid: CAT.txid, vout: CAT.vout });
    expect(spies.setPastedOffer).toHaveBeenCalledWith(offer);
    expect(orchestrator.getSnapshot().pastedOffer).toBe(offer);
    expect(orchestrator.getSnapshot().expectedCatUtxo).toEqual({ txid: CAT.txid, vout: CAT.vout });
  });

  it('URL missing catTxid → urlCatOutpoint stays null; orchestrator gets pasted offer only', async () => {
    const { component, spies, orchestrator } = await setup({ offer: 'cHNidP8BAA==' });
    expect(component.urlCatOutpoint()).toBeNull();
    expect(spies.setPastedOffer).toHaveBeenCalledWith('cHNidP8BAA==');
    expect(orchestrator.getSnapshot().expectedCatUtxo).toBeNull();
  });

  it('no URL params → orchestrator receives nothing at init; state stays idle', async () => {
    const { component, spies } = await setup();
    expect(component.urlCatOutpoint()).toBeNull();
    expect(spies.setPastedOffer).not.toHaveBeenCalled();
    expect(component.state()).toBe('idle');
  });

  it('disableFloorGate is called on init (opts out of the SDK safety-net): the floor is 0', async () => {
    const { spies, component } = await setup();
    expect(spies.disableFloorGate).toHaveBeenCalled();
    expect(component.floorPriceSats()).toBe(0);
  });
});

describe('AcceptOffer — wallet-driven picker/payment wiring', () => {

  it('when a wallet connects with the URL outpoint already set, the orchestrator receives BOTH the outpoint AND the seller-payment address', async () => {
    const { spies, orchestrator, walletService, settle } = await setup({
      catTxid: CAT.txid,
      catVout: String(CAT.vout),
    });
    walletService.connectedWalletSubject.next(testWallet());
    await settle();

    expect(spies.setExpectedCatUtxo).toHaveBeenCalledWith({ txid: CAT.txid, vout: CAT.vout });
    // CRITICAL: the seller-payment address the seller expects comes
    // from wallet.paymentAddress — NOT from any lookup or from the
    // wallet.ordinalsAddress. This is the symmetric guarantee to the
    // buyer-side make-offer fix.
    expect(spies.setExpectedSellerPaymentAddress).toHaveBeenCalledWith(TEST_PAYMENT_ADDRESS);
    expect(spies.setExpectedSellerPaymentAddress).not.toHaveBeenCalledWith(TEST_ORDINALS_ADDRESS);
    expect(orchestrator.getSnapshot().expectedSellerPaymentAddress).toBe(TEST_PAYMENT_ADDRESS);
  });

  it('the connected wallet reaches the orchestrator as the seller identity (ordinals key signs input 0)', async () => {
    const { spies, walletService, settle } = await setup();
    const w = testWallet();
    walletService.connectedWalletSubject.next(w);
    await settle();
    expect(spies.setWallet).toHaveBeenLastCalledWith({
      type: w.type,
      ordinalsAddress: w.ordinalsAddress,
      ordinalsPublicKey: w.ordinalsPublicKey,
    });
  });

  it('picker selection overrides urlCatOutpoint when both are present', async () => {
    const { component, spies, orchestrator, walletService, lookup, settle } = await setup({
      catTxid: CAT.txid,
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
    walletService.connectedWalletSubject.next(testWallet());
    await settle(8);

    component.onCatPick('inscription-999-i0');
    await settle();

    // Picker selection wins over urlCatOutpoint. Look for the picker
    // call anywhere in the history (not just the last one — the effect
    // may have re-run when the wallet connected first).
    const pickerCall = spies.setExpectedCatUtxo.mock.calls.find(
      (c) => (c[0] as CatOutpoint | null)?.txid === 'c'.repeat(64),
    );
    expect(pickerCall?.[0]).toEqual({ txid: 'c'.repeat(64), vout: 2 });
    expect(orchestrator.getSnapshot().expectedCatUtxo).toEqual({ txid: 'c'.repeat(64), vout: 2 });
  });
});

describe('AcceptOffer — form actions', () => {

  it('onPasteChange forwards to orchestrator', async () => {
    const { component, spies } = await setup();
    component.onPasteChange('cHNidP8BAA==');
    expect(spies.setPastedOffer).toHaveBeenCalledWith('cHNidP8BAA==');
  });

  it('onFloorPriceChange with empty string → orchestrator floor=0 (accept any positive offer)', async () => {
    const { component, spies } = await setup();
    component.onFloorPriceChange('   ');
    expect(spies.setFloorPriceSats).toHaveBeenCalledWith(0);
    expect(component.floorPriceSats()).toBe(0);
  });

  it('onFloorPriceChange with a positive integer → orchestrator floor=n', async () => {
    const { component, spies } = await setup();
    component.onFloorPriceChange('21000');
    expect(spies.setFloorPriceSats).toHaveBeenCalledWith(21_000);
    expect(component.floorPriceSats()).toBe(21_000);
  });

  it('a floor above the offer\'s price rejects it as wrong-price', async () => {
    const { component, settle } = await sellerReady();
    component.onPasteChange(buildOfferPsbt({ cat: CAT, priceSats: PRICE }));
    component.onFloorPriceChange(String(PRICE + 1));
    await settle();
    expect(component.humanRejection()).toBe(`The seller-payment output is below your floor price. ${PRICE} < ${PRICE + 1}`);
  });

  it('onFloorPriceChange with garbage → orchestrator not called (input parser rejects)', async () => {
    const { component, spies } = await setup();
    spies.setFloorPriceSats.mockClear();
    component.onFloorPriceChange('not-a-number');
    expect(spies.setFloorPriceSats).not.toHaveBeenCalled();
  });

  it('onFloorPriceChange with negative → orchestrator not called', async () => {
    const { component, spies } = await setup();
    spies.setFloorPriceSats.mockClear();
    component.onFloorPriceChange('-1');
    expect(spies.setFloorPriceSats).not.toHaveBeenCalled();
  });

  it('onAcceptClick has the wallet sign input 0 and broadcasts the finished transaction', async () => {
    provider = installFakeCat21Provider();
    const { component, spies, broadcast, settle } = await sellerReady();
    component.onPasteChange(buildOfferPsbt({ cat: CAT, priceSats: PRICE }));
    await settle();
    expect(component.canAccept()).toBe(true);

    await component.onAcceptClick();
    await settle();

    expect(spies.acceptOffer).toHaveBeenCalledTimes(1);
    // The seller signs the cat input only; the buyer already signed theirs.
    expect(provider.requests.map((r) => r.signAtIndex)).toEqual([[0]]);
    expect(broadcast).toHaveBeenCalledTimes(1);
    const txHex = broadcast.mock.calls[0]![0];
    expect(component.state()).toBe('success');
    expect(component.successTxId()).toBe(`txid-of-${txHex.length}`);
  });

  it('a wallet that refuses to sign leaves the offer unbroadcast and the error on the page', async () => {
    provider = installFakeCat21Provider();
    provider.rejectWith(new Error('User rejected the request'));
    const { component, broadcast, settle } = await sellerReady();
    component.onPasteChange(buildOfferPsbt({ cat: CAT, priceSats: PRICE }));
    await settle();

    await component.onAcceptClick();
    await settle();

    expect(broadcast).not.toHaveBeenCalled();
    expect(component.state()).toBe('error');
    expect(component.errorMessage()).toContain('User rejected the request');
  });

  it('onResetClick calls orchestrator.reset() + clears local state', async () => {
    const { component, spies, settle } = await sellerReady();
    component.onPasteChange(buildOfferPsbt({ cat: CAT, priceSats: PRICE }));
    component.onFloorPriceChange('50000');
    component.onCatPick('inscription-x-i0');
    await settle();

    component.onResetClick();
    expect(spies.reset).toHaveBeenCalled();
    expect(component.pastedOffer()).toBeNull();
    expect(component.selectedInscriptionId()).toBeNull();
    expect(component.floorPriceInput()).toBe('');
  });
});
