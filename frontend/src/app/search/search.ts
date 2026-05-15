import { DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { environment } from '../../environments/environment';
import { CatGallery } from '../cat-gallery/cat-gallery';
import { CatNumbersPaginatedResultDto } from '../shared/cat21-api';
import { rxResourceFixed } from '../shared/rx-resource-fixed';
import { ChipRow } from './chip-row';

/**
 * Trait families and their available chip values. Tuple is [value, label]:
 * `value` is what goes in the URL / backend query; `label` is what the user
 * reads. The two diverge for `tier` (URL keeps the parser's vocabulary,
 * label is the human-friendly rendering) and `gender` (lower-case URL token,
 * lower-case label).
 */
// Section labels mirror the details page (`cat21-viewer.html`) and the
// parser type vocabulary verbatim. URL/backend values are exactly the
// strings the parser emits (Title Case for the design traits, lowercase
// for gender / category since those are stored that way).
const TRAIT_DEFINITIONS = {
  color:      { label: 'COLOR',      options: [['red', 'red'], ['orange', 'orange'], ['yellow', 'yellow'], ['green', 'green'], ['blue', 'blue'], ['purple', 'purple'], ['pink', 'pink']] },
  eyes:       { label: 'LASER EYES', options: [['Orange', 'orange'], ['Red', 'red'], ['Green', 'green'], ['Blue', 'blue'], ['None', 'none']] },
  pose:       { label: 'POSE',       options: [['Standing', 'standing'], ['Sleeping', 'sleeping'], ['Pouncing', 'pouncing'], ['Stalking', 'stalking']] },
  expression: { label: 'EXPRESSION', options: [['Smile', 'smile'], ['Grumpy', 'grumpy'], ['Pouting', 'pouting'], ['Shy', 'shy']] },
  pattern:    { label: 'PATTERN',    options: [['Solid', 'solid'], ['Striped', 'striped'], ['Eyepatch', 'eyepatch'], ['Half/Half', 'half/half']] },
  crown:      { label: 'CROWN',      options: [['Gold', 'gold'], ['Diamond', 'diamond'], ['None', 'none']] },
  glasses:    { label: 'GLASSES',    options: [['Black', 'black'], ['Cool', 'cool'], ['3D', '3D'], ['Nouns', 'nouns'], ['None', 'none']] },
  background: { label: 'BACKGROUND', options: [['Block9', 'block9'], ['Cyberpunk', 'cyberpunk'], ['Whitepaper', 'whitepaper'], ['Orange', 'orange']] },
  category:   { label: 'CATEGORY',   options: [['genesis', 'genesis'], ['sub1k', 'sub1k'], ['sub10k', 'sub10k'], ['sub50k', 'sub50k'], ['sub100k', 'sub100k'], ['sub250k', 'sub250k'], ['sub500k', 'sub500k'], ['sub1M', 'sub1M']] },
  gender:     { label: 'GENDER',     options: [['male', 'male'], ['female', 'female']] },
} as const satisfies Record<string, { label: string; options: readonly (readonly [string, string])[] }>;

type FilterKey = keyof typeof TRAIT_DEFINITIONS;

const FILTER_KEYS: readonly FilterKey[] = [
  'color', 'eyes', 'pose', 'expression', 'pattern', 'crown', 'glasses', 'background', 'category', 'gender',
];

const ITEMS_PER_PAGE = 48;

@Component({
  selector: 'app-search',
  templateUrl: './search.html',
  styleUrl: './search.scss',
  imports: [RouterLink, CatGallery, ChipRow, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Search {
  private http = inject(HttpClient);
  private router = inject(Router);

  // Page comes from the route; filter chips come from query params. All are
  // read via withComponentInputBinding() from `app.config.ts`.
  readonly currentPage = input(1, { transform: numberAttribute });

  // One input() per trait family. Routes pass comma-separated strings (URL
  // shape: `?eyes=red,blue`) and we split them locally into arrays. Keep the
  // input signal as the raw string so URL state is the source of truth;
  // computed() unpacks to a Set for chip rendering.
  readonly color      = input<string>('');
  readonly eyes       = input<string>('');
  readonly pose       = input<string>('');
  readonly expression = input<string>('');
  readonly pattern    = input<string>('');
  readonly crown      = input<string>('');
  readonly glasses    = input<string>('');
  readonly background = input<string>('');
  readonly category   = input<string>('');
  readonly gender     = input<string>('');

  /** Per-trait selected-value sets, derived from URL inputs. */
  readonly selected = computed<Record<FilterKey, string[]>>(() => ({
    color:      splitCsv(this.color()),
    eyes:       splitCsv(this.eyes()),
    pose:       splitCsv(this.pose()),
    expression: splitCsv(this.expression()),
    pattern:    splitCsv(this.pattern()),
    crown:      splitCsv(this.crown()),
    glasses:    splitCsv(this.glasses()),
    background: splitCsv(this.background()),
    category:   splitCsv(this.category()),
    gender:     splitCsv(this.gender()),
  }));

  /** True when at least one chip is active across any trait family. */
  readonly hasAnyFilter = computed(() =>
    Object.values(this.selected()).some((arr) => arr.length > 0),
  );

  /** Static trait list for the template. */
  readonly traits = FILTER_KEYS.map((key) => ({ key, ...TRAIT_DEFINITIONS[key] }));

  resultsResource = rxResourceFixed({
    params: () => ({
      filters: this.selected(),
      page: this.currentPage() || 1,
    }),
    stream: ({ params }) => {
      let httpParams = new HttpParams();
      for (const key of FILTER_KEYS) {
        const values = params.filters[key];
        if (values.length > 0) {
          httpParams = httpParams.set(key, values.join(','));
        }
      }
      const url = `${environment.api}/api/cats/search/${ITEMS_PER_PAGE}/${params.page}`;
      return this.http.get<CatNumbersPaginatedResultDto>(url, { params: httpParams });
    },
  });

  readonly catNumbers = computed(() => this.resultsResource.value()?.catNumbers ?? []);
  readonly total = computed(() => this.resultsResource.value()?.total ?? 0);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / ITEMS_PER_PAGE)));

  readonly isBackendUnavailable = computed(() => {
    const err = this.resultsResource.error();
    return err instanceof HttpErrorResponse && (err.status >= 500 || err.status === 0);
  });

  /**
   * Toggle one chip on/off, then write the new state back into the URL.
   *
   * Multi-select within a row is OR (a cat matches if it has any of the
   * selected values for that trait). Across rows is AND (every active
   * row must match). The header explainer states this so the chip
   * stacking doesn't read as "show me cats with Block9 AND Cyberpunk
   * background", which would always be empty.
   *
   * The URL change re-fires the input bindings and the resource reloads —
   * no manual state mirror, no reload() call.
   */
  onToggle(key: FilterKey, value: string): void {
    const current = this.selected()[key];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    this.navigateWithSelected({ ...this.selected(), [key]: next }, 1);
  }

  clearAll(): void {
    this.navigateWithSelected(emptySelected(), 1);
  }

  changePage(page: number): void {
    this.navigateWithSelected(this.selected(), page);
  }

  private navigateWithSelected(sel: Record<FilterKey, string[]>, page: number): void {
    const queryParams: Record<string, string | null> = {};
    for (const key of FILTER_KEYS) {
      queryParams[key] = sel[key].length > 0 ? sel[key].join(',') : null;
    }
    void this.router.navigate(['/search', page], { queryParams });
  }
}

function splitCsv(value: string): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function emptySelected(): Record<FilterKey, string[]> {
  const result = {} as Record<FilterKey, string[]>;
  for (const key of FILTER_KEYS) result[key] = [];
  return result;
}
