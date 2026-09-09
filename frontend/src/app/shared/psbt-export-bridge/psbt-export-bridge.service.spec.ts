import { jest } from '@jest/globals';
import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { PsbtExportBridgeService } from './psbt-export-bridge.service';

function makeModal(result: Promise<string>, componentInstance: Record<string, unknown> = {}) {
  const dismiss = jest.fn();
  const ref = { componentInstance, result, dismiss };
  const modalService = { open: jest.fn().mockReturnValue(ref) };
  return { modalService, dismiss };
}

function setup(modalService: unknown): PsbtExportBridgeService {
  TestBed.configureTestingModule({
    providers: [PsbtExportBridgeService, { provide: NgbModal, useValue: modalService }],
  });
  return TestBed.inject(PsbtExportBridgeService);
}

describe('PsbtExportBridgeService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('opens the bridge modal, seeds the unsigned PSBT, and resolves with the pasted signed PSBT', async () => {
    const instance: Record<string, unknown> = {};
    const { modalService } = makeModal(Promise.resolve('signed-psbt-b64'), instance);
    const service = setup(modalService);

    const signed = await firstValueFrom(service.promptForSignedPsbt({ base64: 'unsigned-b64', hex: 'deadbeef' }));

    expect(signed).toBe('signed-psbt-b64');
    expect((modalService.open as jest.Mock)).toHaveBeenCalled();
    expect(instance['unsignedBase64']).toBe('unsigned-b64');
  });

  it('errors the observable when the modal is dismissed (Cancel)', async () => {
    const { modalService } = makeModal(Promise.reject('cross-click'));
    const service = setup(modalService);
    await expect(firstValueFrom(service.promptForSignedPsbt({ base64: 'x', hex: 'y' }))).rejects.toBe('cross-click');
  });

  it('promptForSignedPsbtWithLabel seeds an operation-specific action label on the modal', async () => {
    const instance: Record<string, unknown> = {};
    const { modalService } = makeModal(Promise.resolve('s'), instance);
    const service = setup(modalService);

    await firstValueFrom(service.promptForSignedPsbtWithLabel('Build the offer')({ base64: 'x', hex: 'y' }));

    expect(instance['actionLabel']).toBe('Build the offer');
  });

  it('dismisses the modal on teardown (pipeline torn down before the user acts)', () => {
    const { modalService, dismiss } = makeModal(new Promise<string>(() => {})); // never settles
    const service = setup(modalService);
    const sub = service.promptForSignedPsbt({ base64: 'x', hex: 'y' }).subscribe();
    sub.unsubscribe();
    expect(dismiss).toHaveBeenCalled();
  });
});
