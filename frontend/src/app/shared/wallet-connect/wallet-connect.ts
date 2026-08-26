import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { NgbModal, NgbModalRef, NgbPopover, NgbPopoverModule } from '@ng-bootstrap/ng-bootstrap';
import {
  KnownOrdinalWalletType,
  KnownOrdinalWallets,
  WALLET_MATRIX,
  WalletMatrixEntry,
  WalletPlatform,
  WalletService,
  capabilityOf,
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

  readonly connectedWallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });
  private readonly detectedWallets = toSignal(this.walletService.wallets$, {
    initialValue: { installedWallets: [], notInstalledWallets: [] },
  });

  /** Desktop vs Mobile — decides which matrix rows are reachable at all. */
  readonly platform = signal<WalletPlatform>(detectWalletPlatform());

  /**
   * The picker rows: every INJECTED (in-browser signing) matrix entry
   * reachable on this platform, each tagged installed/not from runtime
   * detection. Oyl never appears (no matrix row); Phantom/Binance never
   * appear on desktop (matrix marks them Mobile-only). Watch-only (xpub)
   * has no in-browser connect flow yet, so it is omitted here.
   */
  readonly pickerRows = computed<WalletPickerRow[]>(() => {
    const installedTypes = new Set(this.detectedWallets().installedWallets.map((w) => w.type));
    const plat = this.platform();
    return WALLET_MATRIX
      .filter((e) => e.signingMode === 'injected' && e.platforms.includes(plat))
      .map((entry) => ({ entry, installed: installedTypes.has(entry.wallet) }));
  });

  readonly installedRows = computed(() => this.pickerRows().filter((r) => r.installed));
  readonly notInstalledRows = computed(() => this.pickerRows().filter((r) => !r.installed));

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

  copyToClipboard(text: string): void {
    if (!text || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).catch(() => {/* ignore */});
  }
}
