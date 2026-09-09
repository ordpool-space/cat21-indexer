import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KnownOrdinalWalletType, WalletCapability, detectWalletPlatform, walletActionNotice } from 'ordpool-sdk';

import { WalletCapabilityNotice } from './wallet-capability-notice';

// Round-2 §7.4: the SDK composes the whole action sentence; the site prints
// it VERBATIM, never appending or rewording. These specs pin exactly that,
// against the live SDK (no mocking), so a matrix or wording change surfaces
// here and any local rewording of the sentence turns them red.
//
// The component computes its platform via detectWalletPlatform(); the test
// resolves the same value so the expected notice matches what the component
// asks the SDK for.
const PLATFORM = detectWalletPlatform(typeof window !== 'undefined' ? window : undefined);

function expectedMessage(wallet: KnownOrdinalWalletType, capability: WalletCapability): string | null {
  return walletActionNotice(wallet, capability, { platform: PLATFORM })?.message ?? null;
}

describe('WalletCapabilityNotice', () => {
  let fixture: ComponentFixture<WalletCapabilityNotice>;
  let ref: ComponentRef<WalletCapabilityNotice>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [WalletCapabilityNotice] });
    fixture = TestBed.createComponent(WalletCapabilityNotice);
    ref = fixture.componentRef;
  });

  function el(wallet: KnownOrdinalWalletType, capability: WalletCapability): HTMLElement | null {
    ref.setInput('wallet', wallet);
    ref.setInput('capability', capability);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-testid="wallet-capability-notice"]');
  }

  it.each([
    [KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferCreate],
    [KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferAccept],
    [KnownOrdinalWalletType.xverse, WalletCapability.Cat21OfferCreate],
    [KnownOrdinalWalletType.leather, WalletCapability.Cat21OfferAccept],
    [KnownOrdinalWalletType.unisat, WalletCapability.InscriptionParentChild],
  ])('prints the SDK notice VERBATIM (or renders nothing) for %s / %s', (wallet, capability) => {
    const node = el(wallet, capability);
    expect(node ? node.textContent!.trim() : null).toBe(expectedMessage(wallet, capability));
  });

  it('renders a blocked notice with role=alert for Alby creating an offer', () => {
    const notice = walletActionNotice(KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferCreate, { platform: PLATFORM });
    expect(notice?.kind).toBe('blocked'); // matrix sanity: Alby cannot create offers
    const node = el(KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferCreate);
    expect(node).not.toBeNull();
    expect(node!.getAttribute('role')).toBe('alert');
    expect(node!.classList.contains('is-precheck')).toBe(false);
    expect(node!.textContent!.trim()).toBe(notice!.message);
  });

  it('renders nothing for a capable wallet (Xverse creating an offer)', () => {
    // matrix sanity: the SDK reports Xverse can create offers, so no notice
    expect(walletActionNotice(KnownOrdinalWalletType.xverse, WalletCapability.Cat21OfferCreate, { platform: PLATFORM })).toBeNull();
    expect(el(KnownOrdinalWalletType.xverse, WalletCapability.Cat21OfferCreate)).toBeNull();
  });
});
