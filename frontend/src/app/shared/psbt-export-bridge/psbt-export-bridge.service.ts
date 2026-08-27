import { inject, Injectable } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Observable, from } from 'rxjs';

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
   */
  readonly promptForSignedPsbt = (unsigned: { base64: string; hex: string }): Observable<string> => {
    const ref = this.modalService.open(PsbtExportBridge, {
      ariaLabelledBy: 'psbt-export-bridge-title',
      centered: true,
      backdrop: 'static',
      keyboard: false,
    });
    (ref.componentInstance as PsbtExportBridge).unsignedBase64 = unsigned.base64;
    // `ref.result` resolves with the pasted signed PSBT on submit, or
    // rejects on dismiss. `from` turns that promise into a one-shot
    // observable the SDK subscribes to.
    return from(ref.result as Promise<string>);
  };
}
