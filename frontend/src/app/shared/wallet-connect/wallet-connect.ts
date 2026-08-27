import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, TemplateRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { NgbModal, NgbModalRef, NgbPopover, NgbPopoverModule } from '@ng-bootstrap/ng-bootstrap';
import {
  CapabilitySupport,
  KnownOrdinalWalletType,
  KnownOrdinalWallets,
  WALLET_MATRIX,
  WalletCapability,
  WalletMatrixEntry,
  WalletPlatform,
  WalletService,
  WatchOnlyScriptType,
  capabilityOf,
  walletInAppBrowserDeepLink,
  walletMatrixEntry,
} from 'ordpool-sdk';

import { PendingCats } from '../pending-cats/pending-cats';
import {
  CAPABILITY_DISPLAY_ORDER,
  capabilityDisplayName,
  signingModeWording,
  supportIcon,
  supportWording,
} from '../wallet-capability-display';
import { detectWalletPlatform } from '../wallet-platform';
import { WatchOnlyConnectService } from '../watch-only-connect.service';

/**
 * One row in the connect picker: a matrix entry the current platform can
 * reach, annotated with whether the wallet is detected in the browser
 * right now (`installed`) and therefore which action the row offers.
 */
interface WalletPickerRow {
  entry: WalletMatrixEntry;
  installed: boolean;
}

/** One capability line in the info popover. */
interface CapabilityLine {
  name: string;
  icon: string;
  wording: string;
}

/**
 * Wallet connection control for the header.
 *
 * The picker is driven by the SDK's `WALLET_MATRIX` (the single source of
 * truth for which wallet can do what, where): the list is the matrix
 * entries reachable on the current platform, cross-referenced with the
 * `WalletService` runtime detection to split installed (Connect) from
 * not-installed (Download). Every row carries an info icon whose popover
 * reads its facts from the matrix. Once connected, the button shows the
 * wallet + addresses via a popover.
 */
@Component({
  selector: 'app-wallet-connect',
  templateUrl: './wallet-connect.html',
  styleUrl: './wallet-connect.scss',
  imports: [RouterLink, NgbPopoverModule, PendingCats, NgTemplateOutlet],
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

  /** Desktop vs Mobile — decides which matrix rows are reachable at all. */
  readonly platform = signal<WalletPlatform>(detectWalletPlatform());

  /**
   * The action this picker connects a wallet FOR, when embedded in an
   * action card (make-offer, accept-offer). Two effects, per shared-UX:
   *   1. action-scopes the rows — wallets the matrix marks `Unsupported`
   *      for this capability are dropped from the picker (no Alby in a
   *      buy/sell dialog);
   *   2. adds the "What this action needs" block to each row's popover.
   * Undefined for the global header picker, which offers every wallet
   * reachable on the platform and omits the action block.
   */
  readonly capability = input<WalletCapability | undefined>(undefined);

  /**
   * The picker rows: every INJECTED (in-browser signing) matrix entry
   * reachable on this platform, each tagged installed/not from runtime
   * detection. Oyl never appears (no matrix row); Phantom/Binance never
   * appear on desktop (matrix marks them Mobile-only). Watch-only (xpub)
   * is a separate row (no runtime detection; a paste flow) — see below.
   *
   * When `capability` is set (an action card), rows the matrix marks
   * `Unsupported` for that action are excluded (shared-UX §1: don't offer
   * incapable wallets in an action connect dialog).
   */
  readonly pickerRows = computed<WalletPickerRow[]>(() => {
    const installedTypes = new Set(this.detectedWallets().installedWallets.map((w) => w.type));
    const plat = this.platform();
    const cap = this.capability();
    return WALLET_MATRIX
      .filter((e) => e.signingMode === 'injected' && e.platforms.includes(plat))
      .filter((e) => cap === undefined || capabilityOf(e.wallet, cap).support !== CapabilitySupport.Unsupported)
      .map((entry) => ({ entry, installed: installedTypes.has(entry.wallet) }));
  });

  readonly installedRows = computed(() => this.pickerRows().filter((r) => r.installed));
  readonly notInstalledRows = computed(() => this.pickerRows().filter((r) => !r.installed));

  /** The watch-only (xpub) matrix entry, for its own picker row + info popover. */
  readonly xpubEntry = walletMatrixEntry(KnownOrdinalWalletType.xpub);

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

  /** First 8 + last 6 chars of the connected ordinals address (taproot — that's where cats live). */
  shortAddress(addr: string | undefined | null): string {
    if (!addr) return '';
    return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
  }

  // --- Info popover: everything sourced from the matrix + the shared-UX wording tables ---

  /** Platform badges for a wallet, e.g. "Desktop · Mobile". */
  platformLabel(entry: WalletMatrixEntry): string {
    return entry.platforms
      .map((p) => (p === WalletPlatform.Desktop ? 'Desktop' : 'Mobile'))
      .join(' · ');
  }

  signingModeLabel(entry: WalletMatrixEntry): string {
    return signingModeWording(entry.signingMode);
  }

  /** All seven capabilities for a wallet, in display order, with icon + wording. */
  capabilityLines(entry: WalletMatrixEntry): CapabilityLine[] {
    return CAPABILITY_DISPLAY_ORDER.map((cap) => {
      const status = capabilityOf(entry.wallet, cap);
      return {
        name: capabilityDisplayName(cap),
        icon: supportIcon(status.support),
        wording: supportWording(status),
      };
    });
  }

  /**
   * The "What this action needs" popover line: the current page action's
   * capability and this wallet's status for it (shared-UX §2 item 2).
   * Null when the picker is not action-scoped (the header picker), so the
   * block is omitted.
   */
  actionCapabilityLine(entry: WalletMatrixEntry): CapabilityLine | null {
    const cap = this.capability();
    if (cap === undefined) return null;
    const status = capabilityOf(entry.wallet, cap);
    return {
      name: capabilityDisplayName(cap),
      icon: supportIcon(status.support),
      wording: supportWording(status),
    };
  }

  /**
   * On a plain mobile browser no wallet provider is injected, so a
   * not-installed wallet can't connect — bounce the user into the
   * wallet's own in-app dApp browser via the SDK's docs-verified deep-link
   * registry (Xverse today; every other wallet returns null). Returns the
   * deep link, or null when there's no verified scheme (keep the Download
   * fallback) or on desktop (extensions install normally).
   */
  deepLinkFor(entry: WalletMatrixEntry): string | null {
    if (this.platform() !== WalletPlatform.Mobile) return null;
    if (typeof window === 'undefined') return null;
    return walletInAppBrowserDeepLink(entry.wallet, window.location.href);
  }

  open(): void {
    this.platform.set(detectWalletPlatform());
    this.connectButtonDisabled.set(false);
    this.connectError.set(null);
    this.modalRef = this.modalService.open(this.connectTemplate(), {
      ariaLabelledBy: 'wallet-connect-title',
      centered: true,
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
          this.xpubError.set('This key type is ambiguous. Pick the account type (Taproot for cats).');
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
