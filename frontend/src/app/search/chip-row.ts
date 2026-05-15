import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * One trait family's chip row. Renders a labeled list of toggleable chips.
 * Selection is owned by the parent (signal-driven); this component just
 * emits toggle events. Multiple chips active inside one row means "OR
 * within this trait" — the parent's filter shape carries the values as
 * an array and the backend translates that into an IN-clause.
 */
@Component({
  selector: 'app-chip-row',
  templateUrl: './chip-row.html',
  styleUrl: './chip-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChipRow {
  /** Short uppercase label at the start of the row, e.g. "EYES". */
  readonly label = input.required<string>();

  /** Available chip options for this row. Each tuple is [value, displayLabel].
   *  value goes into the URL / filter; displayLabel is what the user sees. */
  readonly options = input.required<ReadonlyArray<readonly [string, string]>>();

  /** Currently-selected values (subset of option values). */
  readonly selected = input.required<readonly string[]>();

  /** Fired when a chip is clicked; payload is the chip's value (parent decides
   *  whether to add or remove it from the selection set). */
  readonly toggle = output<string>();

  isSelected(value: string): boolean {
    return this.selected().includes(value);
  }

  onChipClick(value: string): void {
    this.toggle.emit(value);
  }
}
