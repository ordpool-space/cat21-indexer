import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KnownOrdinalWalletType, WalletService } from 'ordpool-sdk';

import { makeWallet, WalletServiceStub } from '../../testing/wallet.fixtures';
import { SingleAddressNote } from './single-address-note';

/**
 * The single-address info note renders iff the CONNECTED wallet hands out one
 * address for both roles (`usesSingleAddress`). Two real wallet shapes drive it
 * at the IO boundary (`connectedWalletSubject`); the SUT's own computed is never
 * mocked.
 *
 * Mutation-checked: forcing the `isSingleAddress` guard to a constant flips
 * exactly one of the shape specs red (a wallet is one shape or the other), which
 * is what makes this a real guard and not a presence assertion.
 */
describe('SingleAddressNote', () => {
  let fixture: ComponentFixture<SingleAddressNote>;
  let walletStub: WalletServiceStub;

  const noteEl = () =>
    fixture.nativeElement.querySelector('[data-testid="single-address-note"]') as HTMLElement | null;

  beforeEach(() => {
    walletStub = new WalletServiceStub();
    TestBed.configureTestingModule({
      imports: [SingleAddressNote],
      providers: [{ provide: WalletService, useValue: walletStub }],
    });
    fixture = TestBed.createComponent(SingleAddressNote);
  });

  it('shows the info note for a single-address wallet (ordinals === payment)', () => {
    const oneAddress = 'bc1qsingleaddrwalletxxxxxxxxxxxxxxxxxxxxx0';
    walletStub.connectedWalletSubject.next(
      makeWallet({
        type: KnownOrdinalWalletType.unisat,
        ordinalsAddress: oneAddress,
        paymentAddress: oneAddress,
      }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.isSingleAddress()).toBe(true);

    const el = noteEl();
    expect(el).not.toBeNull();
    // full-sentence info copy, cats-worded — not a truncated label
    expect(el?.textContent?.toLowerCase()).toContain('keeps your coins and your cats');
    expect(el?.textContent?.toLowerCase()).toContain('fresh address');
    // named for the connected wallet ("Your UniSat wallet…"), not the generic
    // "This wallet…" fallback — proves the label is threaded through
    expect(el?.textContent?.toLowerCase()).toContain('your unisat wallet');
    expect(el?.textContent?.toLowerCase()).not.toContain('this wallet');
    // info register, not a warning: no alert role, no dismiss control, no icon glyph
    expect(el?.getAttribute('role')).toBeNull();
    expect(el?.querySelector('button')).toBeNull();
    expect(el?.textContent).not.toContain('⚠');
  });

  it('renders nothing for a split-address wallet (ordinals !== payment)', () => {
    walletStub.connectedWalletSubject.next(makeWallet()); // default: Xverse, split addresses
    fixture.detectChanges();

    expect(fixture.componentInstance.isSingleAddress()).toBe(false);
    expect(noteEl()).toBeNull();
  });

  it('renders nothing when no wallet is connected', () => {
    fixture.detectChanges(); // connectedWallet stays null

    expect(fixture.componentInstance.isSingleAddress()).toBe(false);
    expect(noteEl()).toBeNull();
  });
});
