import { inject, Injectable } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Observable } from 'rxjs';

import { PsbtExportBridge } from './psbt-export-bridge';

/**
 * Produces the `promptForSignedPsbt` callback every cat21 orchestrator
 * accepts for watch-only signing. When the SDK invokes the callback with
 * the unsigned PSBT, it opens the export/paste modal and resolves with
 * the signed PSBT the user pastes back. A dismissed modal (Cancel)
 * errors the observable, which the orchestrator surfaces as a cancelled
 * action.
 *
 * Injected browser wallets never invoke the callback, so an action
 * component can pass this unconditionally.
 */
@Injectable({ providedIn: 'root' })
export class PsbtExportBridgeService {
  private modalService = inject(NgbModal);

  /**
   * The callback to hand each orchestrator's action method. Bound so it
   * can be passed by reference: `orchestrator.mint(bridge.promptForSignedPsbt)`.
   * Uses the default "Broadcast" primary-button copy — correct for mint,
   * transfer, and accept, which finalize + broadcast the signed PSBT.
   */
  readonly promptForSignedPsbt = (unsigned: { base64: string; hex: string }): Observable<string> =>
    this.openBridge(unsigned);

  /**
   * A prompt callback with operation-specific primary-button copy. The
   * create-offer flow uses "Build the offer" because it produces a
   * partial-signed artifact and does NOT broadcast — a "Broadcast" label
   * there would be a lie. Call per-invocation:
   * `orchestrator.createOffer(bridge.promptForSignedPsbtWithLabel('Build the offer'))`.
   */
  promptForSignedPsbtWithLabel(actionLabel: string): (unsigned: { base64: string; hex: string }) => Observable<string> {
    return (unsigned) => this.openBridge(unsigned, actionLabel);
  }

  private openBridge(unsigned: { base64: string; hex: string }, actionLabel?: string): Observable<string> {
    return new Observable<string>((subscriber) => {
      const ref = this.modalService.open(PsbtExportBridge, {
        ariaLabelledBy: 'psbt-export-bridge-title',
        centered: true,
        backdrop: 'static',
        keyboard: false,
      });
      const instance = ref.componentInstance as PsbtExportBridge;
      instance.unsignedBase64 = unsigned.base64;
      if (actionLabel !== undefined) instance.actionLabel = actionLabel;
      // `ref.result` resolves with the pasted signed PSBT on submit, or
      // rejects on dismiss (Cancel) — the orchestrator surfaces that as a
      // cancelled action.
      (ref.result as Promise<string>).then(
        (signed) => { subscriber.next(signed); subscriber.complete(); },
        (reason) => subscriber.error(reason),
      );
      // Teardown: if the orchestrator pipeline is torn down (unsubscribed)
      // before the user submits or cancels, dismiss the modal. With
      // backdrop:'static' + keyboard:false the user cannot close it
      // themselves, so without this it strands with dead buttons.
      // `dismiss()` is a no-op once the modal has already closed.
      return () => ref.dismiss();
    });
  }
}
