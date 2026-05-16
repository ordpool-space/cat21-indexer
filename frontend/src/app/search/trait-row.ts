import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * One trait family's row of toggleable buttons. Selection is owned by the
 * parent (signal-driven); this component just emits toggle events.
 * Multiple traits active inside one row means "OR within this row" — the
 * parent's filter shape carries the values as an array and the backend
 * translates that into an IN-clause.
 */
@Component({
  selector: 'app-trait-row',
  templateUrl: './trait-row.html',
  styleUrl: './trait-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TraitRow {
  /** Short uppercase label at the start of the row, e.g. "EYES". */
  readonly label = input.required<string>();

  /** Available options for this row. Each tuple is [value, displayLabel].
   *  value goes into the URL / filter; displayLabel is what the user sees. */
  readonly options = input.required<ReadonlyArray<readonly [string, string]>>();

  /** Currently-selected values (subset of option values). */
  readonly selected = input.required<readonly string[]>();

  /** Fired when a trait button is clicked; payload is its value (parent
   *  decides whether to add or remove it from the selection set). */
  readonly toggle = output<string>();

  isSelected(value: string): boolean {
    return this.selected().includes(value);
  }

  onTraitClick(value: string): void {
    this.toggle.emit(value);
  }
}
