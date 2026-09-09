import { ChangeDetectionStrategy, ChangeDetectorRef, Component, TemplateRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { NgbModal, NgbModalRef, NgbPopover, NgbPopoverModule } from '@ng-bootstrap/ng-bootstrap';
import {
  KnownOrdinalWalletType,
  KnownOrdinalWallets,
  WalletCapability,
  WalletPickerRow,
  WalletService,
  WatchOnlyScriptType,
  walletPickerRows,
} from 'ordpool-sdk';

import { PendingCats } from '../pending-cats/pending-cats';
import { WatchOnlyConnectService } from '../watch-only-connect.service';

/**
 * Wallet connection control for the header.
 *
 * The picker is driven by the SDK's `walletPickerRows()`, the single source
 * of truth for row shape, button label, logo and reachability, so the three
 * sites cannot drift. Each row is logo + name + one button and nothing else:
 * no capability disclosure lives at login (round-2 §7.2). Once connected, the
 * button shows the wallet + addresses via a popover.
 */
@Component({
  selector: 'app-wallet-connect',
  templateUrl: './wallet-connect.html',
  styleUrl: './wallet-connect.scss',
  imports: [RouterLink, NgbPopoverModule, PendingCats],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletConnect {
  private walletService = inject(WalletService);
  private modalService = inject(NgbModal);
  private cdr = inject(ChangeDetectorRef);
  private watchOnly = inject(WatchOnlyConnectService);

  readonly connectedWallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });
  private readonly detectedWallets = toSignal(this.walletService.wallets$, {
    initialValue: { installedWallets: [], notInstalledWallets: [] },
  });

  /**
   * The action this picker connects a wallet FOR, when embedded in an
   * action card (make-offer, accept-offer). It action-scopes the rows:
   * wallets the matrix marks `Unsupported` for this capability are dropped
   * from the picker, so an incapable wallet is never offered in an action
   * connect dialog (round-2 §7.3) and there is nothing to warn about.
   * Undefined for the global header picker, which offers every wallet
   * reachable on the platform.
   */
  readonly capability = input<WalletCapability | undefined>(undefined);

  /**
   * The picker rows, straight from the SDK's `walletPickerRows()`: the single
   * source of truth for row shape, button label, logo and reachability, so the
   * three sites cannot drift. One row per reachable wallet (logo + name + one
   * button); the watch-only entry arrives as a `connect-xpub` action row.
   * `capability` action-scopes the list (incapable wallets are absent).
   */
  readonly pickerRows = computed<WalletPickerRow[]>(() => {
    this.detectedWallets(); // re-run when runtime wallet detection re-emits
    // Pass `win` and let the SDK derive the platform from the DEVICE
    // (detectWalletPlatform(win): user-agent + iPad touch count), never the
    // viewport. A desktop browser dragged narrow keeps its extensions, so the
    // list must not change with window width (round-2 §7.9).
    return walletPickerRows({
      win: typeof window !== 'undefined' ? window : undefined,
      capability: this.capability(),
      currentUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  });

  /**
   * `true` when no real wallet provider is reachable in this browser: no row
   * carries the `connect` action (installs, the mobile in-app bounce, and the
   * always-present watch-only paste flow are not detected providers). Drives
   * the one diagnostic line "No wallet detected in this browser." (round-2
   * §7.2) so a person whose wallet is installed-but-unreachable (disabled
   * extension, wrong profile, fresh container) reads that we looked and found
   * none, rather than that the site is broken.
   *
   * The line's wording assumes the list still OFFERS wallets (each Install
   * row), i.e. the empty-of-`connect` state is a detection miss, never a
   * genuinely empty picker. That holds because watch-only backstops six of the
   * seven capabilities and is reachable on both platforms, and the injected
   * wallets carry the seventh (SignMessage), so every (capability, platform)
   * pair yields at least one row. If a future matrix ever left a capability
   * with no reachable wallet, `pickerRows()` could come back empty and this
   * line would then mislead (it implies installable wallets exist); that case
   * needs its own copy, not this one.
   */
  readonly noWalletDetected = computed<boolean>(() =>
    this.pickerRows().every((row) => row.action !== 'connect'),
  );

  // --- Watch-only (xpub) paste flow ---
  readonly xpubMode = signal(false);                 // paste form open?
  readonly xpubKey = signal('');                     // pasted extended key
  readonly xpubNeedsScriptType = signal(false);      // ambiguous prefix → ask
  readonly xpubScriptType = signal<WatchOnlyScriptType>('p2tr');
  readonly xpubConnecting = signal(false);
  readonly xpubError = signal<string | null>(null);

  /**
   * `true` when the connected wallet's address prefix doesn't match
   * the configured Bitcoin network (mainnet/regtest/testnet).
   * Drives the red banner inline with the wallet button.
   */
  readonly networkMismatch = toSignal(this.walletService.networkMismatch$, { initialValue: false });
  readonly expectedNetworkGroup = this.walletService.expectedNetworkGroup;

  readonly knownOrdinalWallets = KnownOrdinalWallets;
  readonly connectButtonDisabled = signal(false);
  readonly connectError = signal<string | null>(null);

  private connectTemplate = viewChild.required<TemplateRef<unknown>>('connectModal');
  private modalRef: NgbModalRef | undefined;

  /** First 8 + last 6 chars of the connected ordinals address (the wallet's ordinals-receiving address; usually Taproot). */
  shortAddress(addr: string | undefined | null): string {
    if (!addr) return '';
    return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
  }

  open(): void {
    this.connectButtonDisabled.set(false);
    this.connectError.set(null);
    this.modalRef = this.modalService.open(this.connectTemplate(), {
      ariaLabelledBy: 'wallet-connect-title',
      centered: true,
      // Solid, high-contrast modal surface (styles.scss). The site's body
      // background is orange; without this the modal inherits it and white
      // text lands on orange, below WCAG AA.
      windowClass: 'wallet-connect-modal',
    });
  }

  closeModal(): void {
    this.modalRef?.close();
    this.connectButtonDisabled.set(false);
  }

  connectWallet(type: KnownOrdinalWalletType): void {
    // Unisat docs: disable the connect button while a connection is
    // pending, otherwise the user can fire multiple requests against
    // the wallet's single popup.
    if (type !== KnownOrdinalWalletType.leather) {
      this.connectButtonDisabled.set(true);
    }
    this.connectError.set(null);
    this.walletService.connectWallet(type).subscribe({
      next: () => {
        this.closeModal();
        // Zoneless safety: the wallet's connect resolution often runs
        // outside any tracked context (postMessage from the extension's
        // popup → tap() that calls connectedWallet$.next). Nudge CD so
        // the button repaints with the connected state immediately
        // instead of waiting for the next user interaction.
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.connectError.set(err instanceof Error ? err.message : String(err));
        this.connectButtonDisabled.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  disconnect(popover: NgbPopover): void {
    popover.close();
    this.walletService.disconnectWallet();
  }

  // --- Watch-only (xpub) paste flow ---

  /** Reveal the paste form (or collapse it). */
  toggleXpubMode(): void {
    this.xpubMode.update((on) => !on);
    this.xpubError.set(null);
    this.xpubNeedsScriptType.set(false);
  }

  onXpubKeyInput(value: string): void {
    this.xpubKey.set(value);
    // A fresh key invalidates a prior ambiguity prompt.
    this.xpubNeedsScriptType.set(false);
    this.xpubError.set(null);
  }

  onXpubScriptTypeChange(value: string): void {
    this.xpubScriptType.set(value as WatchOnlyScriptType);
  }

  /**
   * Paste -> connect. On a plain xpub/tpub the SDK rejects for missing
   * script type; we catch that once, reveal the script-type select, and
   * the next submit passes the chosen type. Every other error surfaces
   * verbatim.
   */
  submitXpub(): void {
    const key = this.xpubKey().trim();
    if (!key) {
      this.xpubError.set('Paste an account extended public key (xpub, ypub, zpub, …).');
      return;
    }
    this.xpubConnecting.set(true);
    this.xpubError.set(null);
    const scriptType = this.xpubNeedsScriptType() ? this.xpubScriptType() : undefined;
    this.watchOnly.connect(key, scriptType).subscribe({
      next: () => {
        this.xpubConnecting.set(false);
        this.resetXpubForm();
        this.closeModal();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.xpubConnecting.set(false);
        if (WatchOnlyConnectService.isScriptTypeAmbiguous(err) && !this.xpubNeedsScriptType()) {
          // First encounter: ask for the account type, keep the key.
          this.xpubNeedsScriptType.set(true);
          this.xpubError.set('This key type is ambiguous. Pick the account type (Taproot is the usual choice for cats).');
        } else {
          this.xpubError.set(err instanceof Error ? err.message : String(err));
        }
        this.cdr.markForCheck();
      },
    });
  }

  private resetXpubForm(): void {
    this.xpubMode.set(false);
    this.xpubKey.set('');
    this.xpubNeedsScriptType.set(false);
    this.xpubScriptType.set('p2tr');
    this.xpubError.set(null);
  }

  copyToClipboard(text: string): void {
    if (!text || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).catch(() => {/* ignore */});
  }
}
