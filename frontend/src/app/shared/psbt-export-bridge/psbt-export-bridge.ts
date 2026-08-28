import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

/**
 * The export/paste signing bridge modal for a watch-only (xpub) wallet.
 *
 * A watch-only wallet holds no key in the browser, so the SDK hands us
 * the unsigned PSBT and expects the user to sign it in their own wallet
 * (Sparrow, Electrum, Coldcard, Ledger) and paste the signed PSBT back.
 * This modal renders that round-trip: copy / download the unsigned PSBT,
 * then paste the signed one. `PsbtExportBridgeService` opens it and turns
 * its result into the `promptForSignedPsbt` callback every cat21
 * orchestrator accepts.
 */
@Component({
  selector: 'app-psbt-export-bridge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-header">
      <h4 class="modal-title">Sign in your wallet</h4>
      <button type="button" class="btn-close" aria-label="Close" (click)="activeModal.dismiss('cancel')"></button>
    </div>
    <div class="modal-body psbt-bridge" data-testid="psbt-export-bridge">
      <p class="step">1. Copy or download this unsigned PSBT, then open it in your wallet (Sparrow, Electrum, Coldcard, Ledger).</p>
      <textarea class="psbt-box" rows="4" readonly data-testid="psbt-unsigned">{{ unsignedBase64 }}</textarea>
      <div class="row-actions">
        <button type="button" class="ghost-btn" (click)="copy()">{{ copied() ? 'Copied' : 'Copy' }}</button>
        <button type="button" class="ghost-btn" (click)="download()">Download .psbt</button>
      </div>

      <p class="step">2. Sign it in your wallet, then paste the signed PSBT (base64 or hex) back here.</p>
      <textarea
        class="psbt-box"
        rows="4"
        spellcheck="false"
        autocomplete="off"
        placeholder="Paste the signed PSBT…"
        data-testid="psbt-signed-input"
        [value]="signed()"
        (input)="onSignedInput($any($event.target).value)"></textarea>

      @if (error(); as e) {
        <p class="bridge-error" role="alert">{{ e }}</p>
      }
    </div>
    <div class="modal-footer">
      <button type="button" class="ghost-btn" (click)="activeModal.dismiss('cancel')">Cancel</button>
      <button type="button" class="primary-btn" data-testid="psbt-submit" [disabled]="!signed().trim()" (click)="submit()">
        {{ actionLabel }}
      </button>
    </div>
  `,
  styles: [`
    .psbt-bridge { display: flex; flex-direction: column; gap: 0.5rem; }
    .step { margin: 0; font-size: 0.85rem; line-height: 1.35; }
    .psbt-box {
      font-family: monospace; font-size: 0.75rem; padding: 0.4rem;
      width: 100%; box-sizing: border-box; resize: vertical;
      background: rgba(0,0,0,0.15); border: 1px solid rgba(0,0,0,0.3);
    }
    .row-actions { display: flex; gap: 0.5rem; }
    .ghost-btn {
      font-family: "Public Pixel", sans-serif; font-size: 0.75rem;
      padding: 0.35rem 0.7rem; background: transparent; border: 2px solid currentColor;
      color: inherit; cursor: pointer;
    }
    .primary-btn {
      font-family: "Public Pixel", sans-serif; font-size: 0.8rem; font-weight: bold;
      padding: 0.4rem 0.8rem; background: #FF9900; border: 2px solid #FF9900; color: white; cursor: pointer;
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    .bridge-error {
      border: 2px solid #dc3545; background: #f8d7da; color: #842029;
      padding: 0.4rem 0.6rem; margin: 0; font-size: 0.8rem;
    }
  `],
})
export class PsbtExportBridge {
  readonly activeModal = inject(NgbActiveModal);

  /** Set by the service before open. The unsigned PSBT to sign externally. */
  unsignedBase64 = '';

  /**
   * Primary-button copy, set by the service per operation. Mint /
   * transfer / accept finalize + broadcast, so the default reads
   * "Broadcast"; create-offer produces a partial-signed artifact and does
   * NOT broadcast, so it passes "Build the offer".
   */
  actionLabel = 'Broadcast signed transaction';

  readonly signed = signal('');
  readonly copied = signal(false);
  readonly error = signal<string | null>(null);

  onSignedInput(value: string): void {
    this.signed.set(value);
    this.error.set(null);
  }

  copy(): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(this.unsignedBase64)
      .then(() => this.copied.set(true))
      .catch(() => {/* ignore */});
  }

  download(): void {
    // A .psbt file is BINARY (BIP-174 magic 'psbt\xff'), so decode the
    // base64 to bytes before writing it — a file holding the base64 text
    // would be rejected by wallets that import .psbt as binary (Coldcard
    // SD-card, Sparrow file-open). The Copy button keeps the base64 text
    // for the paste path.
    const bin = atob(this.unsignedBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cat21-unsigned.psbt';
    a.click();
    URL.revokeObjectURL(url);
  }

  submit(): void {
    const value = this.signed().trim();
    if (!value) {
      this.error.set('Paste the signed PSBT first.');
      return;
    }
    this.activeModal.close(value);
  }
}
