import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { PsbtExportBridge } from './psbt-export-bridge';
import { PsbtExportBridgeService } from './psbt-export-bridge.service';

// The bridge turns the modal round-trip into the promptForSignedPsbt
// callback the orchestrators call. Pins: it opens the modal, hands the
// unsigned PSBT to the component, and resolves with the pasted signed
// PSBT (or errors on cancel).

describe('PsbtExportBridgeService', () => {
  let service: PsbtExportBridgeService;
  let open: jest.Mock;
  let componentInstance: PsbtExportBridge;

  function setup(result: Promise<string>) {
    componentInstance = {} as PsbtExportBridge;
    open = jest.fn().mockReturnValue({ componentInstance, result });
    TestBed.configureTestingModule({
      providers: [
        PsbtExportBridgeService,
        { provide: NgbModal, useValue: { open } },
      ],
    });
    service = TestBed.inject(PsbtExportBridgeService);
  }

  beforeEach(() => { TestBed.resetTestingModule(); });

  it('opens the modal, sets the unsigned PSBT, and emits the pasted signed PSBT', async () => {
    setup(Promise.resolve('signed-psbt-base64'));
    const emitted = await firstValueFrom(
      service.promptForSignedPsbt({ base64: 'UNSIGNED_B64', hex: 'deadbeef' }),
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(componentInstance.unsignedBase64).toBe('UNSIGNED_B64');
    expect(emitted).toBe('signed-psbt-base64');
  });

  it('errors when the modal is dismissed (user cancelled)', async () => {
    setup(Promise.reject(new Error('cancel')));
    await expect(
      firstValueFrom(service.promptForSignedPsbt({ base64: 'X', hex: 'Y' })),
    ).rejects.toThrow('cancel');
  });
});
