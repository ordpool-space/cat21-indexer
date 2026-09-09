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
 * The picker is driven by the SDK's `WALLET_MATRIX` (the single source of
 * truth for which wallet can do what, where): the list is the matrix
 * entries reachable on the current platform, cross-referenced with the
 * `WalletService` runtime detection to split installed (Connect) from
 * not-installed (Install). Before connecting, a row is name + one button
 * and nothing else: no capability disclosure lives at login. Once
 * connected, the button shows the wallet + addresses via a popover.
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
   * The picker rows: every INJECTED (in-browser signing) matrix entry
   * reachable on this platform, each tagged installed/not from runtime
   * detection and carrying its mobile deep link where one applies. Oyl
   * never appears (no matrix row); Phantom/Binance never appear on desktop
   * (matrix marks them Mobile-only). Watch-only (xpub) is a separate row
   * (no runtime detection; a paste flow) — see below.
   *
   * When `capability` is set (an action card), rows the matrix marks
   * `Unsupported` for that action are excluded (shared-UX §1: don't offer
   * incapable wallets in an action connect dialog). The pure builder lives
   * in `wallet-picker-rows.ts` and is unit-tested against the real matrix.
   */
  /**
   * The picker rows, straight from the SDK's `walletPickerRows()`: the single
   * source of truth for row shape, button label, logo and reachability, so the
   * three sites cannot drift. One row per reachable wallet (name + logo + one
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
