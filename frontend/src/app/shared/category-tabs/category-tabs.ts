import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Shared category tab strip used by /search and /. Desktop renders a
 * row of <button> tabs; below the md breakpoint it falls back to a
 * single <select> dropdown that visually mimics the active tab.
 *
 * Owning a single component for both layouts keeps the look in sync —
 * adding both .pixel-select AND .category-select on the mobile picker
 * inline (as the two pages were doing) drifted because .category-select
 * lived in a component-encapsulated stylesheet, so only one page picked
 * it up. This component bundles the styles with the markup.
 */
@Component({
  selector: 'app-category-tabs',
  templateUrl: './category-tabs.html',
  styleUrl: './category-tabs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryTabs {
  /** Visible band names (already filtered by the parent for "has data"). */
  readonly tabs = input.required<readonly string[]>();
  /** Currently selected band — highlighted as the active tab / mobile select value. */
  readonly active = input.required<string>();
  /** Fired with the new band when the user picks a tab or changes the select. */
  readonly categoryChange = output<string>();

  onTabClick(band: string): void {
    this.categoryChange.emit(band);
  }

  onSelectChange(ev: Event): void {
    this.categoryChange.emit((ev.target as HTMLSelectElement).value);
  }
}
