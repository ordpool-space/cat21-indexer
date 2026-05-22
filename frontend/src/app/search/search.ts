import { DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, linkedSignal, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';

import { environment } from '../../environments/environment';
import { CatGallery } from '../cat-gallery/cat-gallery';
import { CatDto, CatSearchResultDto } from '../shared/cat21-api';
import { rxResourceFixed } from '../shared/rx-resource-fixed';
import { TraitRow } from './trait-row';

// Tuple is [URL value, display label]. URL values are exactly what the
// parser emits (Title Case for design traits; lowercase for gender,
// category, color, genesis). Labels are what shows on the trait button
// and what the keyword box accepts.
//
// Category options are derived from the OpenAPI-generated
// CatDto.CategoryEnum (filtered to drop the '' fallback used for cats
// >= 1M, which isn't a tab). One source of truth: the backend's
// CATEGORY_VALUES.
// COLOR has 11 parser buckets — see ordpool-parser/CAT21-RARITY-SCORE.md.
// Genesis is an ORIGIN row, NOT a category value (the previous version
// was a bug).
const CATEGORY_OPTIONS = Object.values(CatDto.CategoryEnum)
  .filter((v): v is Exclude<typeof v, ''> => v !== '')
  .map((v) => [v, v] as const);

const TRAIT_DEFINITIONS = {
  color:      { label: 'COLOR',      options: [['red', 'red'], ['orange', 'orange'], ['yellow', 'yellow'], ['green', 'green'], ['blue', 'blue'], ['purple', 'purple'], ['pink', 'pink'], ['black', 'black'], ['white', 'white'], ['fire', 'fire'], ['saturated', 'saturated']] },
  eyes:       { label: 'LASER EYES', options: [['Orange', 'orange'], ['Red', 'red'], ['Green', 'green'], ['Blue', 'blue'], ['None', 'none']] },
  pose:       { label: 'POSE',       options: [['Standing', 'standing'], ['Sleeping', 'sleeping'], ['Pouncing', 'pouncing'], ['Stalking', 'stalking']] },
  expression: { label: 'EXPRESSION', options: [['Smile', 'smile'], ['Grumpy', 'grumpy'], ['Pouting', 'pouting'], ['Shy', 'shy']] },
  pattern:    { label: 'PATTERN',    options: [['Solid', 'solid'], ['Striped', 'striped'], ['Eyepatch', 'eyepatch'], ['Half/Half', 'half/half']] },
  crown:      { label: 'CROWN',      options: [['Gold', 'gold'], ['Diamond', 'diamond'], ['None', 'none']] },
  glasses:    { label: 'GLASSES',    options: [['Black', 'black'], ['Cool', 'cool'], ['3D', '3D'], ['Nouns', 'nouns'], ['None', 'none']] },
  background: { label: 'BACKGROUND', options: [['Block9', 'block9'], ['Cyberpunk', 'cyberpunk'], ['Whitepaper', 'whitepaper'], ['Orange', 'orange']] },
  category:   { label: 'CATEGORY',   options: CATEGORY_OPTIONS },
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
  readonly sort       = input<string>('');

  /** Sort selector options. 'newest' is the default; 'rarity' switches
   *  to rarityRank ASC within the active category (rarest first). */
  readonly sortOptions = [
    ['newest', 'newest first'],
    ['rarity', 'rarest first'],
  ] as const;

  readonly activeSort = computed<'newest' | 'rarity'>(() => this.sort() === 'rarity' ? 'rarity' : 'newest');

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

  readonly keywordOpen = signal(false);

  // A curated rotation of trait combinations that each return a healthy
  // number of cats. The shown example is randomized whenever the user
  // opens the keyword box, so they see syntax variety on repeat visits.
  // Each entry uses broad-population traits (e.g. pose + color + eyes)
  // whose intersections are stable as new cats mint.
  private readonly KEYWORD_EXAMPLES = [
    'pose:sleeping expression:smile glasses:cool',
    'color:orange,yellow pose:standing background:cyberpunk',
    'eyes:red,blue pattern:striped expression:grumpy',
    'pose:pouncing color:green background:block9',
    'crown:gold expression:smile background:orange',
    'pattern:eyepatch glasses:black,cool pose:stalking',
    'color:fire eyes:red pose:standing',
    'background:whitepaper pose:sleeping expression:shy',
  ] as const;

  readonly currentExample = signal(this.pickExample());

  private pickExample(): string {
    const i = Math.floor(Math.random() * this.KEYWORD_EXAMPLES.length);
    return this.KEYWORD_EXAMPLES[i];
  }

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
      sort: this.activeSort(),
    }),
    stream: ({ params }) => {
      const httpParams = filtersToHttpParams(params.filters).set('sort', params.sort);
      const url = `${environment.api}/api/cats/search/${ITEMS_PER_PAGE}/${params.page}`;
      return this.http.get<CatSearchResultDto>(url, { params: httpParams });
    },
  });

  readonly catNumbers = computed(() => this.resultsResource.value()?.catNumbers ?? []);
  readonly total = computed(() => this.resultsResource.value()?.total ?? 0);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / ITEMS_PER_PAGE)));

  /** Drop size of the active category (unfiltered). Drives the "X of Y"
   *  header and the rarity-chip hide rule. Null on first paint. */
  readonly categoryTotal = computed(() => this.resultsResource.value()?.categoryTotal ?? null);

  /** Server-computed facet counts for the current selection. Empty until the
   *  first response arrives — consumers should treat absence as "no info"
   *  (show the chip optimistically), not "zero". */
  readonly facets = computed(() => this.resultsResource.value()?.facets ?? {});

  /** Category tabs filtered to only those with at least one cat under
   *  the current non-category selection. The active tab is always kept
   *  visible, so the user can see what they picked even if filters
   *  zero it out — clearing the other chips brings the rest back.
   *  Before facets arrive we show ONLY the active tab — hide-first,
   *  reveal-on-data avoids the flicker of "all tabs → some vanish". */
  readonly visibleCategoryTabs = computed(() => {
    const counts = this.facets()['category'] ?? {};
    const active = this.activeCategory();
    const haveAnyCounts = Object.keys(counts).length > 0;
    if (!haveAnyCounts) return [active];
    return CATEGORY_TABS.filter((band) => band === active || (counts[band] ?? 0) > 0);
  });

  /** Rarity threshold for each option, mirroring the backend's
   *  RARITY_THRESHOLDS. A chip is meaningful only when the active
   *  category contains more cats than the threshold (otherwise it
   *  matches every cat in the band, which isn't a filter). */
  private readonly RARITY_THRESHOLDS: Record<string, number> = {
    top10: 10,
    top100: 100,
    top1k: 1000,
  };

  /** Chip rows scoped to the current facet counts. For each trait family,
   *  options whose count is zero are dropped; the count is attached so
   *  the chip can render "label (N)". Active selections are always kept
   *  visible, mirroring the category-tab rule. The rarity row gets two
   *  extra rules: an "all" chip that clears the rarity filter, and
   *  threshold-aware hiding (top1k chip vanishes in sub1k where the
   *  whole band IS the top 1k). */
  readonly visibleTraits = computed(() => {
    const facets = this.facets();
    const selected = this.selected();
    const total = this.categoryTotal();
    return CHIP_TRAIT_KEYS.map((key) => {
      const def = TRAIT_DEFINITIONS[key];
      const counts = facets[key] ?? {};
      const haveAnyCounts = Object.keys(counts).length > 0;
      const selectedSet = new Set(selected[key]);

      let options: { value: string; label: string; count: number }[] = def.options
        .map(([value, label]) => ({ value, label, count: counts[value] ?? 0 }))
        .filter((opt) =>
          // Show the chip if it's selected (so the user can untoggle)
          // or if the backend says picking it would yield results.
          // Before facets arrive we render NO chips for this row — the
          // user sees rows reveal as data lands, never sees a chip
          // appear and then vanish.
          selectedSet.has(opt.value) || (haveAnyCounts && opt.count > 0),
        );

      let rowSelected: readonly string[] = selected[key];

      if (key === 'rarity') {
        // Hide rarity chips whose ceiling exceeds the active category's
        // drop size — e.g. "top 1k" on sub1k matches every cat.
        if (total !== null) {
          options = options.filter((opt) => {
            const threshold = this.RARITY_THRESHOLDS[opt.value];
            return threshold === undefined || threshold < total;
          });
        }
        // Always offer "all" as a clear-rarity chip, highlighted when
        // no specific rarity ceiling is selected.
        options = [
          { value: 'all', label: 'all', count: total ?? 0 },
          ...options,
        ];
        if (selected.rarity.length === 0) rowSelected = ['all'];
      }

      return { key, label: def.label, options, selected: rowSelected };
    });
  });

  readonly isBackendUnavailable = computed(() => {
    const err = this.resultsResource.error();
    return err instanceof HttpErrorResponse && (err.status >= 500 || err.status === 0);
  });

  /** True while a lucky-cat request is in flight (button disable + spinner). */
  readonly luckyLoading = signal(false);

  // OR within a row, AND across rows — the hint in the template tells
  // the user, so two traits in one row stay valid (e.g. Block9 +
  // Cyberpunk = "either background").
  //
  // The rarity "all" chip is a clear-filter affordance, not a stored
  // value — picking it drops the rarity selection so the URL stays
  // minimal and the backend sees no rarity filter.
  onToggle(key: FilterKey, value: string): void {
    if (key === 'rarity' && value === 'all') {
      this.navigateWithSelected({ ...this.selected(), rarity: [] }, 1);
      return;
    }
    const current = this.selected()[key];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    this.navigateWithSelected({ ...this.selected(), [key]: next }, 1);
  }

  /** Switch the sort order (newest ↔ rarity). Resets to page 1 so the
   *  reader sees the top of the newly ordered list. */
  setSort(value: string): void {
    void this.router.navigate(['/search', 1], {
      queryParams: { sort: value === 'rarity' ? 'rarity' : null },
      queryParamsHandling: 'merge',
    });
  }

  /** Switch the active category tab. Other chip selections survive
   *  the switch — a user with `color=red` flipping from sub1k → sub10k
   *  sees the red cats from the new category. */
  setCategory(value: string): void {
    this.navigateWithSelected({ ...this.selected(), category: [value] }, 1);
  }

  /** Show/hide the keyword input. Refreshes the example placeholder
   *  each time the box opens so users see syntax variety. */
  toggleKeyword(): void {
    this.keywordOpen.update((v) => !v);
    if (this.keywordOpen()) this.currentExample.set(this.pickExample());
  }

  /** Enter / blur on the keyword box: parse the draft text, navigate to
   *  the resulting filter set, URL re-binds the chips through `selected()`. */
  submitKeyword(): void {
    this.navigateWithSelected(parseKeyword(this.keywordDraft()), 1);
  }

  /**
   * Lucky pick. Hits /cats/search/random with the current filters and
   * routes to the cat detail page on success. A 404 from the backend
   * means "no cat matches"; the zero-results line in the header
   * already surfaces that, so the error branch just unsets the
   * loading flag.
   */
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
    // sort is a separate axis from filters but must survive filter
    // changes — preserve it explicitly so a chip click doesn't reset
    // "rarest first" back to "newest first".
    queryParams['sort'] = this.activeSort() === 'rarity' ? 'rarity' : null;
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

/**
 * Serialize chip state to the keyword-box format:
 *   `eyes:red,blue pose:sleeping background:cyberpunk`
 *
 * Each token is `key:label[,label,…]`. Values are emitted as **labels**
 * (what the user sees on the buttons), not the URL/backend values, so
 * the box stays readable and round-trips back to the same chips
 * through `parseKeyword`.
 */
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

/**
 * Parse the keyword box back into chip state. Forgiving:
 * - case-insensitive on the label side
 * - extra whitespace is fine
 * - unknown keys / labels are silently dropped (don't poison the URL)
 * - empty / whitespace-only input → empty selection (clears everything)
 */
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
