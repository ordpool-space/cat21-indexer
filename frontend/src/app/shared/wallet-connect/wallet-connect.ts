import { ChangeDetectionStrategy, ChangeDetectorRef, Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { NgbModal, NgbModalRef, NgbPopover, NgbPopoverModule } from '@ng-bootstrap/ng-bootstrap';
import { KnownOrdinalWalletType, KnownOrdinalWallets, WalletService } from 'ordpool-sdk';

/**
 * Wallet connection control for the header. Shows "Connect" when no
 * wallet is connected and opens a modal picker; once connected, shows
 * the wallet's icon and exposes the addresses + a disconnect button via
 * a popover. State comes from `ordpool-sdk`'s `WalletService` — a single
 * RxJS BehaviorSubject bridged to a signal here so the rest of the
 * component stays signal-native.
 */
@Component({
  selector: 'app-wallet-connect',
  templateUrl: './wallet-connect.html',
  styleUrl: './wallet-connect.scss',
  imports: [RouterLink, NgbPopoverModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletConnect {
  private walletService = inject(WalletService);
  private modalService = inject(NgbModal);
  private cdr = inject(ChangeDetectorRef);

  readonly connectedWallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });
  private readonly walletsRaw = toSignal(this.walletService.wallets$, { initialValue: { installedWallets: [], notInstalledWallets: [] } });

  /**
   * cat21.space is ordinals-only — Alby's Lightning+Nostr surface can't
   * hold cat sats, so we drop wallets whose `onChainOrdinals` flag is
   * explicitly false. Wallets where the flag is omitted are kept (the
   * default semantic in the SDK is "yes, on-chain"). Filter both
   * buckets so Alby disappears from the picker AND from the "not
   * installed — download" list.
   */
  readonly wallets = computed(() => {
    const raw = this.walletsRaw();
    return {
      installedWallets: raw.installedWallets.filter((w) => w.onChainOrdinals !== false),
      notInstalledWallets: raw.notInstalledWallets.filter((w) => w.onChainOrdinals !== false),
    };
  });

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

  open(): void {
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
