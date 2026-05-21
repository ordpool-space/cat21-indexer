import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';

export interface TraitOption {
  /** URL value (what goes into the filter / query string). */
  value: string;
  /** Display text on the chip. */
  label: string;
  /** How many cats would match if the user added this option to their
   *  selection. Rendered inline as "label (N)". */
  count: number;
}

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
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TraitRow {
  /** Short uppercase label at the start of the row, e.g. "EYES". */
  readonly label = input.required<string>();

  /** Available options for this row, each with its facet count. */
  readonly options = input.required<ReadonlyArray<TraitOption>>();

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
