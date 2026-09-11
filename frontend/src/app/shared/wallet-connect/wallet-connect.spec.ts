import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WalletService } from 'ordpool-sdk';

import { WalletServiceStub } from '../../testing/wallet.fixtures';
import { cat21Config } from '../sdk-tokens';
import { WalletConnect } from './wallet-connect';

/**
 * Round-2 §7.2: the login screen shows exactly one diagnostic line, "No wallet
 * detected in this browser.", when no real provider is reachable here — and
 * NOT when one is. The component derives that state from the SDK rows via
 * `noWalletDetected = pickerRows().every(r => r.action !== 'connect')`: the
 * always-present watch-only row (`connect-xpub`) and the Install rows must not
 * count as a detected wallet, or the line would never show.
 *
 * We drive the SDK's real detection at its IO boundary — `isUnisatInstalled`
 * reads `!!win.unisat` — by toggling the stub provider on the global `window`
 * the component reads. That is the collaborator's input, not the SUT.
 */
describe('WalletConnect — empty-state (§7.2)', () => {
  let fixture: ComponentFixture<WalletConnect>;
  let component: WalletConnect;

  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>)['unisat'];
    TestBed.configureTestingModule({
      imports: [WalletConnect],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: WalletService, useValue: new WalletServiceStub() },
        {
          provide: cat21Config,
          useValue: {
            mempoolApiUrl: 'https://api.ordpool.space',
            cat21ApiUrl: 'https://backend2.cat21.space',
            ordApiUrl: 'https://ord.ordpool.space',
            cat21OrdApiUrl: 'https://ord.cat21.space',
          },
        },
      ],
    });
    fixture = TestBed.createComponent(WalletConnect);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['unisat'];
  });

  it('reports the empty state when no provider is reachable (rows are all install / watch-only)', () => {
    // No provider stubbed → every row is `install` or the `connect-xpub`
    // watch-only row; none is `connect`.
    expect(component.pickerRows().some((r) => r.action === 'connect')).toBe(false);
    expect(component.pickerRows().some((r) => r.action === 'connect-xpub')).toBe(true); // watch-only IS present
    expect(component.noWalletDetected()).toBe(true);
  });

  it('is NOT the empty state once a real provider (UniSat) is reachable', () => {
    (window as unknown as Record<string, unknown>)['unisat'] = {}; // the SDK reads !!win.unisat
    fixture = TestBed.createComponent(WalletConnect); // re-create so the computed reads the stubbed window
    component = fixture.componentInstance;

    expect(component.pickerRows().some((r) => r.action === 'connect')).toBe(true); // UniSat -> Connect row
    expect(component.noWalletDetected()).toBe(false);
  });
});

/**
 * Round-5 connect button. The icon carries the noun visually and the label is
 * just the verb, so a screen reader (which never sees the icon) must get the
 * noun back via a LONGER accessible name. The invariant the SDK flagged: the
 * accessible name must NOT collapse into the visible label. Asserted on the
 * rendered DOM so a regression that set `aria-label` equal to the text turns
 * this red.
 */
describe('WalletConnect — connect button (round-5)', () => {
  let fixture: ComponentFixture<WalletConnect>;

  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>)['unisat'];
    TestBed.configureTestingModule({
      imports: [WalletConnect],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: WalletService, useValue: new WalletServiceStub() },
        {
          provide: cat21Config,
          useValue: {
            mempoolApiUrl: 'https://api.ordpool.space',
            cat21ApiUrl: 'https://backend2.cat21.space',
            ordApiUrl: 'https://ord.ordpool.space',
            cat21OrdApiUrl: 'https://ord.cat21.space',
          },
        },
      ],
    });
    fixture = TestBed.createComponent(WalletConnect);
    fixture.detectChanges();
  });

  it('renders the disconnected button with a hidden icon + visible verb, and a longer accessible name', () => {
    const btn = fixture.nativeElement.querySelector('[data-testid="wallet-connect-btn"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();

    const icon = btn.querySelector('svg.wallet-icon');
    expect(icon).toBeTruthy(); // the wallet glyph is present
    expect(icon!.getAttribute('aria-hidden')).toBe('true'); // and hidden from AT

    const visibleLabel = btn.querySelector('.wallet-connect-label')!.textContent!.trim();
    const accessibleName = btn.getAttribute('aria-label')!;

    expect(visibleLabel).toBe('Connect'); // the verb only
    expect(accessibleName).toBe('Connect a wallet'); // the noun restored for AT
    // The load-bearing assertion: the two are DIFFERENT. Setting aria-label to
    // the visible label (the mistake the SDK warned against) fails here.
    expect(accessibleName).not.toBe(visibleLabel);
    expect(accessibleName.length).toBeGreaterThan(visibleLabel.length);
  });
});
