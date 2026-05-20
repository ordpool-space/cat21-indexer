import { DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, linkedSignal, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';

import { environment } from '../../environments/environment';
import { CatGallery } from '../cat-gallery/cat-gallery';
import { CatNumbersPaginatedResultDto } from '../shared/cat21-api';
import { rxResourceFixed } from '../shared/rx-resource-fixed';
import { TraitRow } from './trait-row';

// Tuple is [URL value, display label]. URL values are exactly what the
// parser emits (Title Case for design traits; lowercase for gender,
// category, color, genesis). Labels are what shows on the trait button
// and what the keyword box accepts.
//
// COLOR has 11 parser buckets — see ordpool-parser/CAT21-RARITY-SCORE.md.
// Genesis is an ORIGIN row, NOT a category value (the previous version
// was a bug).
const TRAIT_DEFINITIONS = {
  color:      { label: 'COLOR',      options: [['red', 'red'], ['orange', 'orange'], ['yellow', 'yellow'], ['green', 'green'], ['blue', 'blue'], ['purple', 'purple'], ['pink', 'pink'], ['black', 'black'], ['white', 'white'], ['fire', 'fire'], ['saturated', 'saturated']] },
  eyes:       { label: 'LASER EYES', options: [['Orange', 'orange'], ['Red', 'red'], ['Green', 'green'], ['Blue', 'blue'], ['None', 'none']] },
  pose:       { label: 'POSE',       options: [['Standing', 'standing'], ['Sleeping', 'sleeping'], ['Pouncing', 'pouncing'], ['Stalking', 'stalking']] },
  expression: { label: 'EXPRESSION', options: [['Smile', 'smile'], ['Grumpy', 'grumpy'], ['Pouting', 'pouting'], ['Shy', 'shy']] },
  pattern:    { label: 'PATTERN',    options: [['Solid', 'solid'], ['Striped', 'striped'], ['Eyepatch', 'eyepatch'], ['Half/Half', 'half/half']] },
  crown:      { label: 'CROWN',      options: [['Gold', 'gold'], ['Diamond', 'diamond'], ['None', 'none']] },
  glasses:    { label: 'GLASSES',    options: [['Black', 'black'], ['Cool', 'cool'], ['3D', '3D'], ['Nouns', 'nouns'], ['None', 'none']] },
  background: { label: 'BACKGROUND', options: [['Block9', 'block9'], ['Cyberpunk', 'cyberpunk'], ['Whitepaper', 'whitepaper'], ['Orange', 'orange']] },
  category:   { label: 'CATEGORY',   options: [['sub1', 'sub1'], ['sub1k', 'sub1k'], ['sub10k', 'sub10k'], ['sub50k', 'sub50k'], ['sub100k', 'sub100k'], ['sub250k', 'sub250k'], ['sub500k', 'sub500k'], ['sub1M', 'sub1M']] },
  gender:     { label: 'GENDER',     options: [['Male', 'male'], ['Female', 'female']] },
  genesis:    { label: 'ORIGIN',     options: [['genesis', 'genesis cat'], ['normal', 'normal cat']] },
  rarity:     { label: 'RARITY',     options: [['top10', 'top 10'], ['top100', 'top 100'], ['top1k', 'top 1k']] },
} as const satisfies Record<string, { label: string; options: readonly (readonly [string, string])[] }>;

type FilterKey = keyof typeof TRAIT_DEFINITIONS;

const FILTER_KEYS: readonly FilterKey[] = [
  'rarity', 'color', 'eyes', 'pose', 'expression', 'pattern', 'crown', 'glasses', 'background', 'category', 'gender', 'genesis',
];

// Category renders as a tab strip (primary scope), not a chip row.
// Everything else renders as chip rows underneath.
const CHIP_TRAIT_KEYS: readonly FilterKey[] = FILTER_KEYS.filter((k) => k !== 'category') as FilterKey[];

// Default tab on landing. Per ordpool-parser/CAT21-RARITY-SCORE.md: sub1k is the most
// prestigious collection; first-time visitors land there. Holders of
// other categories click through.
const DEFAULT_CATEGORY = 'sub1k';

// Tab list, in declaration order. Same as TRAIT_DEFINITIONS.category.options
// but extracted here so the template doesn't need to index into the trait map.
const CATEGORY_TABS = TRAIT_DEFINITIONS.category.options.map(([value]) => value);

const ITEMS_PER_PAGE = 48;

// Precomputed lookup tables: URL value ↔ display label (the second element
// of the tuple). The keyword box reads/writes labels because that's what
// the user sees on the buttons; we translate to URL values when routing.
const VALUE_TO_LABEL = buildValueToLabel();
const LABEL_TO_VALUE = buildLabelToValue();

@Component({
  selector: 'app-search',
  templateUrl: './search.html',
  styleUrl: './search.scss',
  imports: [RouterLink, CatGallery, TraitRow, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Search {
  private http = inject(HttpClient);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  // Page comes from the route; trait selections come from query params.
  // All are read via withComponentInputBinding() from `app.config.ts`.
  readonly currentPage = input(1, { transform: numberAttribute });

  // One input() per trait family. Routes pass comma-separated strings (URL
  // shape: `?eyes=red,blue`) and we split them locally into arrays.
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
  readonly genesis    = input<string>('');
  readonly rarity     = input<string>('');

  /**
   * Per-trait selected-value sets, derived from URL inputs.
   *
   * Category is special: it always resolves to exactly one value (the
   * active tab). If the URL has no category, the default tab is used
   * — so the backend query is always scoped to one category, never to
   * "all cats" (no such mode exists by design —
   * see ordpool-parser/CAT21-RARITY-SCORE.md).
   */
  readonly selected = computed<Record<FilterKey, string[]>>(() => {
    const rawCategory = splitCsv(this.category());
    return {
      color:      splitCsv(this.color()),
      eyes:       splitCsv(this.eyes()),
      pose:       splitCsv(this.pose()),
      expression: splitCsv(this.expression()),
      pattern:    splitCsv(this.pattern()),
      crown:      splitCsv(this.crown()),
      glasses:    splitCsv(this.glasses()),
      background: splitCsv(this.background()),
      category:   rawCategory.length > 0 ? [rawCategory[0]] : [DEFAULT_CATEGORY],
      gender:     splitCsv(this.gender()),
      genesis:    splitCsv(this.genesis()),
      rarity:     splitCsv(this.rarity()),
    };
  });

  /** The active category tab. Always defined; defaults to sub1k. */
  readonly activeCategory = computed(() => this.selected().category[0]);

  /** Static list of category tab values, smallest-supply first. */
  readonly categoryTabs = CATEGORY_TABS;

  /**
   * True when at least one non-category trait is active. Used to show
   * the "clear all" affordance — clearing doesn't change the active
   * tab, only the chip selections inside it.
   */
  readonly hasAnyFilter = computed(() =>
    CHIP_TRAIT_KEYS.some((key) => this.selected()[key].length > 0),
  );

  /** Chip rows rendered in the grid (everything except category). */
  readonly traits = CHIP_TRAIT_KEYS.map((key) => ({ key, ...TRAIT_DEFINITIONS[key] }));

  readonly keywordOpen = signal(false);

  // Linked to `selected()` so trait changes overwrite the user's draft.
  // The alternative (an independent signal) lets traits and text drift
  // out of sync silently.
  readonly keywordDraft = linkedSignal({
    source: () => this.selected(),
    computation: (sel) => serializeSelected(sel),
  });

  resultsResource = rxResourceFixed({
    params: () => ({
      filters: this.selected(),
      page: this.currentPage() || 1,
    }),
    stream: ({ params }) => {
      const httpParams = filtersToHttpParams(params.filters);
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

  /** True while a lucky-cat request is in flight (button disable + spinner). */
  readonly luckyLoading = signal(false);

  // OR within a row, AND across rows — the hint in the template tells
  // the user, so two traits in one row stay valid (e.g. Block9 +
  // Cyberpunk = "either background").
  onToggle(key: FilterKey, value: string): void {
    const current = this.selected()[key];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    this.navigateWithSelected({ ...this.selected(), [key]: next }, 1);
  }

  /** Switch the active category tab. Other chip selections survive
   *  the switch — a user with `color=red` flipping from sub1k → sub10k
   *  sees the red cats from the new category. */
  setCategory(value: string): void {
    this.navigateWithSelected({ ...this.selected(), category: [value] }, 1);
  }

  toggleKeyword(): void {
    this.keywordOpen.update((v) => !v);
  }

  submitKeyword(): void {
    this.navigateWithSelected(parseKeyword(this.keywordDraft()), 1);
  }

  // 404 from the backend means "no match"; the zero-results line in the
  // header already surfaces that, so swallow it here.
  pickLucky(): void {
    if (this.luckyLoading()) return;
    this.luckyLoading.set(true);

    const httpParams = filtersToHttpParams(this.selected());
    const url = `${environment.api}/api/cats/search/random`;

    this.http.get<{ catNumber: number }>(url, { params: httpParams })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.luckyLoading.set(false);
          void this.router.navigate(['/cat', res.catNumber]);
        },
        error: () => {
          this.luckyLoading.set(false);
        },
      });
  }

  /** Clear all chip selections; the active category tab is preserved.
   *  Clearing "all" means clearing your filters inside the current
   *  collection, not jumping to a different collection. */
  clearAll(): void {
    const empty = emptySelected();
    empty.category = this.selected().category;
    this.navigateWithSelected(empty, 1);
  }

  private navigateWithSelected(sel: Record<FilterKey, string[]>, page: number): void {
    const queryParams: Record<string, string | null> = {};
    for (const key of FILTER_KEYS) {
      const vals = sel[key];
      // Category is structurally single-valued. If the user (or the
      // keyword parser) handed us multiple, take the first so the URL
      // stays in sync with what the tab UI shows.
      const effective = key === 'category' ? vals.slice(0, 1) : vals;
      queryParams[key] = effective.length > 0 ? effective.join(',') : null;
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

function filtersToHttpParams(filters: Record<FilterKey, string[]>): HttpParams {
  let httpParams = new HttpParams();
  for (const key of FILTER_KEYS) {
    const values = filters[key];
    if (values.length > 0) {
      httpParams = httpParams.set(key, values.join(','));
    }
  }
  return httpParams;
}

// Emits labels (what the buttons show), not URL values, so the keyword
// box reads naturally and round-trips through parseKeyword.
function serializeSelected(sel: Record<FilterKey, string[]>): string {
  const parts: string[] = [];
  for (const key of FILTER_KEYS) {
    if (sel[key].length > 0) {
      const labels = sel[key].map((v) => VALUE_TO_LABEL[key][v] ?? v);
      parts.push(`${key}:${labels.join(',')}`);
    }
  }
  return parts.join(' ');
}

// Forgiving: case-insensitive labels, unknown keys/labels dropped so junk
// input never poisons the URL, empty string clears all selection.
function parseKeyword(text: string): Record<FilterKey, string[]> {
  const result = emptySelected();
  const tokens = text.trim().split(/\s+/).filter((t) => t.length > 0);

  for (const token of tokens) {
    const colon = token.indexOf(':');
    if (colon <= 0) continue;
    const key = token.slice(0, colon).toLowerCase();
    const valueList = token.slice(colon + 1);
    if (!isFilterKey(key) || !valueList) continue;

    for (const rawLabel of valueList.split(',')) {
      const label = rawLabel.trim().toLowerCase();
      if (!label) continue;
      const value = LABEL_TO_VALUE[key][label];
      if (value && !result[key].includes(value)) {
        result[key].push(value);
      }
    }
  }
  return result;
}

function isFilterKey(s: string): s is FilterKey {
  return (FILTER_KEYS as readonly string[]).includes(s);
}

function buildValueToLabel(): Record<FilterKey, Record<string, string>> {
  const result = {} as Record<FilterKey, Record<string, string>>;
  for (const key of FILTER_KEYS) {
    const map: Record<string, string> = {};
    for (const [value, label] of TRAIT_DEFINITIONS[key].options) {
      map[value] = label;
    }
    result[key] = map;
  }
  return result;
}

function buildLabelToValue(): Record<FilterKey, Record<string, string>> {
  const result = {} as Record<FilterKey, Record<string, string>>;
  for (const key of FILTER_KEYS) {
    const map: Record<string, string> = {};
    for (const [value, label] of TRAIT_DEFINITIONS[key].options) {
      map[label.toLowerCase()] = value;
    }
    result[key] = map;
  }
  return result;
}
