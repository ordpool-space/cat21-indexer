import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KnownOrdinalWalletType, WalletCapability } from 'ordpool-sdk';

import { WalletCapabilityNotice } from './wallet-capability-notice';

// Pins finding #207's core: a connected wallet the matrix marks
// Unsupported for the trade action gets a notice naming the reason +
// alternatives; a capable wallet gets nothing. Reads its facts from the
// live SDK matrix (no mocking) so a matrix change that (un)blocks a
// wallet surfaces here.

describe('WalletCapabilityNotice', () => {
  let fixture: ComponentFixture<WalletCapabilityNotice>;
  let ref: ComponentRef<WalletCapabilityNotice>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [WalletCapabilityNotice] });
    fixture = TestBed.createComponent(WalletCapabilityNotice);
    ref = fixture.componentRef;
  });

  function render(wallet: KnownOrdinalWalletType, capability: WalletCapability): string | null {
    ref.setInput('wallet', wallet);
    ref.setInput('capability', capability);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('[data-testid="wallet-capability-notice"]');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  }

  it('renders a notice for Alby creating an offer (Unsupported in the matrix)', () => {
    const text = render(KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferCreate);
    expect(text).not.toBeNull();
    expect(text).toContain('Alby');
    // The reason comes from the matrix caveat (mentions signPsbt).
    expect(text!.toLowerCase()).toContain('signpsbt');
    // Alternatives name a capable injected wallet.
    expect(text).toContain('Connect');
    expect(text).toContain('Xverse');
  });

  it('renders a notice for Alby accepting an offer', () => {
    const text = render(KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferAccept);
    expect(text).not.toBeNull();
    expect(text).toContain('Alby');
  });

  it('renders NOTHING for Xverse creating an offer (capable)', () => {
    expect(render(KnownOrdinalWalletType.xverse, WalletCapability.Cat21OfferCreate)).toBeNull();
  });

  it('renders NOTHING for Leather accepting an offer (capable)', () => {
    expect(render(KnownOrdinalWalletType.leather, WalletCapability.Cat21OfferAccept)).toBeNull();
  });

  it('stays silent for a Proven-with-caveat status (not a hard block)', () => {
    // UniSat collections carry a Taproot-address caveat but are Proven,
    // so the notice must not fire — the pre-check is the host's job.
    expect(render(KnownOrdinalWalletType.unisat, WalletCapability.InscriptionParentChild)).toBeNull();
  });
});
