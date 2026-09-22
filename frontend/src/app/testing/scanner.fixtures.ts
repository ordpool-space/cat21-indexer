import { jest } from '@jest/globals';
import { BehaviorSubject, of } from 'rxjs';

import { UtxoScanState } from 'ordpool-sdk';

/**
 * Shared test double for the SDK's `UtxoContentScanner`, provided wherever a
 * spec puts a component or orchestrator under test. It is a collaborator of the
 * SUT, never the SUT itself, so a jest double here is the textbook boundary
 * mock, not a cheat.
 *
 * Defaults to a scanner that reports every coin `scanned-clean` and holds an
 * empty state map. A spec drives other outcomes by pushing a map with
 * `setStates`, or by re-mocking `scan` / `getState` on the instance. Kept in
 * one place so a change to the scanner port is one edit, not four.
 */
export class ScannerStub {
  readonly statesSubject = new BehaviorSubject<ReadonlyMap<string, UtxoScanState>>(new Map());
  readonly states$ = this.statesSubject.asObservable();

  scan = jest.fn((_outpoint: string) => of<UtxoScanState>({ kind: 'scanned-clean' }));
  autoScan = jest.fn((_utxos: unknown[]) => undefined);
  reset = jest.fn(() => {
    this.statesSubject.next(new Map());
  });
  getState = jest.fn(
    (outpoint: string): UtxoScanState =>
      this.statesSubject.value.get(outpoint) ?? { kind: 'not-scanned' },
  );

  /** Test helper: replace the state map the `states$` stream carries. */
  setStates(states: Iterable<[string, UtxoScanState]>): void {
    this.statesSubject.next(new Map(states));
  }
}
