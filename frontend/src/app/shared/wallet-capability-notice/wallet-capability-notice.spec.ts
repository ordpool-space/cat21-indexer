import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KnownOrdinalWalletType, WalletCapability, detectWalletPlatform, walletActionNotice } from 'ordpool-sdk';

import { WalletCapabilityNotice } from './wallet-capability-notice';

// Round-2 §7.4/§7: the SDK provides the notice PARTS (reason, alternatives,
// actionPhrase); the site lays them out as a scannable list, printing each
// verbatim and NEVER truncating the alternatives (the reader's question is
// "is the wallet I already have in the list", which a cap can't answer). These
// specs assert exactly that against the live SDK, so a matrix/wording change
// surfaces here and any dropped alternative or reworded reason turns them red.
//
// The component derives its platform via the SDK's detectWalletPlatform(win);
// the test resolves the same value so expected == what the component asks for.
const PLATFORM = detectWalletPlatform(typeof window !== 'undefined' ? window : undefined);

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

  function normText(node: HTMLElement): string {
    return node.textContent!.replace(/\s+/g, ' ').trim();
  }

  it('renders the reason + EVERY alternative (never truncated) for Alby creating an offer', () => {
    const notice = walletActionNotice(KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferCreate, { platform: PLATFORM });
    expect(notice?.kind).toBe('blocked');
    expect(notice!.alternatives.length).toBeGreaterThan(1); // sanity: there IS a list to scan

    const node = el(KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferCreate);
    expect(node).not.toBeNull();
    expect(node!.getAttribute('role')).toBe('alert');

    const text = normText(node!);
    expect(text).toContain(notice!.reason);        // reason, verbatim
    expect(text).toContain(notice!.actionPhrase);  // "…can sell a cat" heading
    for (const alt of notice!.alternatives) {
      expect(text).toContain(alt);                 // every wallet named; a truncated list drops one
    }
  });

  it('renders the reason + every alternative for Alby accepting an offer', () => {
    const notice = walletActionNotice(KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferAccept, { platform: PLATFORM });
    const text = normText(el(KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferAccept)!);
    expect(text).toContain(notice!.reason);
    for (const alt of notice!.alternatives) {
      expect(text).toContain(alt);
    }
  });

  it('renders nothing for a capable wallet (Xverse creating an offer)', () => {
    expect(walletActionNotice(KnownOrdinalWalletType.xverse, WalletCapability.Cat21OfferCreate, { platform: PLATFORM })).toBeNull();
    expect(el(KnownOrdinalWalletType.xverse, WalletCapability.Cat21OfferCreate)).toBeNull();
  });
});
