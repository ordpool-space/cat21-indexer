import { HttpClient, HttpParams } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../environments/environment';
import { rxResourceFixed } from '../shared/rx-resource-fixed';

interface FeeRateSample {
  feeRate: number;
  catNumber: number | null;
}

// Inlined from ordpool-parser/src/cat21/mooncat-parser.colors.ts.
// The frontend has no ordpool-parser dep; copying the algo here lets us
// iterate on bucket thresholds without bouncing changes through the parser
// + a backend release. This page is the visual sandbox for
// hueToColorCategory in ordpool-parser/src/cat21/cat-color-category.ts.
function generativeColorPalette(t: number, baseColor: number[], amplitude: number[], frequency: number[], phase: number[]): number[] {
  return [
    baseColor[0] + amplitude[0] * Math.cos(2 * Math.PI * (frequency[0] * t + phase[0])),
    baseColor[1] + amplitude[1] * Math.cos(2 * Math.PI * (frequency[1] * t + phase[1])),
    baseColor[2] + amplitude[2] * Math.cos(2 * Math.PI * (frequency[2] * t + phase[2])),
  ];
}

function map(n: number, from1: number, to1: number, from2: number, to2: number): number {
  return ((n - from1) / (to1 - from1)) * (to2 - from2) + from2;
}

function feeRateToColor(feeRate: number, saturationSeed: number): { rgb: number[]; saturation: number } {
  const baseColor = [0.5, 0.5, 0.5];
  const amplitude = [-0.9, 0.6, 0.4];
  const frequency = [1.0, 0.5, 0.5];
  const phase = [0.0, 0.0, 0.0];

  const rgb = generativeColorPalette(feeRate / 300, baseColor, amplitude, frequency, phase);

  let saturation = map(saturationSeed, 0, 255, 0.75, 1.0);
  if (feeRate >= 420 && feeRate < 421) {
    saturation = 42.0;
  }

  if (feeRate < 300) {
    const transitionFactor = Math.max(0, (feeRate - 250) / 50);
    rgb[0] += 0.7 * (1 - transitionFactor);
    rgb[2] *= transitionFactor;
  } else {
    const postTransitionFactor = Math.min(1, (feeRate - 300) / 50);
    rgb[1] *= 1 - postTransitionFactor;
    rgb[2] = postTransitionFactor;
  }

  return { rgb, saturation };
}

function RGBToHSL(r: number, g: number, b: number): [number, number, number] {
  r = r / 255;
  g = g / 255;
  b = b / 255;
  const cMax = Math.max(r, g, b);
  const cMin = Math.min(r, g, b);
  const delta = cMax - cMin;
  let h = 0;
  if (delta !== 0) {
    if (cMax === r) h = 60 * (((g - b) / delta) % 6);
    else if (cMax === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  const l = (cMax + cMin) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}

function HSLToRGB(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const hx = (n: number) => ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2);
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// Mirror of cat-color-category.ts. Edit this when adjusting thresholds —
// once they look right visually, port the same edits back into the parser.
type Bucket = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink';
function hueToColorCategory(hue: number): Bucket {
  const h = ((hue % 360) + 360) % 360;
  if (h >= 345 || h < 15) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 255) return 'blue';
  if (h < 285) return 'purple';
  return 'pink';
}

const BUCKET_SWATCHES: Record<Bucket | 'fire' | 'saturated', string> = {
  red:       '#dc3545',
  orange:    '#fd7e14',
  yellow:    '#ffc107',
  green:     '#28a745',
  blue:      '#0d6efd',
  purple:    '#6f42c1',
  pink:      '#d63384',
  fire:      '#ff4500',
  saturated: '#ff00aa',
};

interface Row {
  feeRate: number;
  bodyHex: string;     // the cat's actual body pixel (derivePalette c3 — lightness 0.45)
  hue: number;         // hue of the body pixel — what we bucket on
  saturation: number;
  bucket: Bucket | 'fire' | 'saturated';
  bucketHex: string;
}

@Component({
  selector: 'app-debug-colors',
  templateUrl: './debug-colors.html',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; font-family: monospace; }
    .grid { display: grid; grid-template-columns: 70px 80px 60px 80px 90px 1fr; gap: 4px 8px; align-items: center; }
    .grid > div { line-height: 1; padding: 2px 0; }
    .swatch { width: 56px; height: 36px; border: 2px solid white; }
    .bucket-chip { padding: 4px 8px; border: 2px solid white; color: white; font-weight: bold; text-align: center; }
    .real-cat { display: flex; align-items: center; gap: 0.5rem; }
    .real-cat img { width: 60px; height: 60px; image-rendering: pixelated; background: #222; border: 2px solid white; }
    .real-cat a { color: white; text-decoration: underline; font-size: 0.75rem; }
    .real-cat .missing { color: rgba(255,255,255,0.5); font-size: 0.75rem; }
    .header { font-weight: bold; font-family: "Public Pixel", sans-serif; font-size: 0.8rem; }
    .row.boundary { outline: 2px dashed white; outline-offset: 2px; }
    .controls { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    .controls label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; }
    .controls input { width: 100px; }
  `]
})
export class DebugColors {
  private http = inject(HttpClient);

  readonly minRate = signal(1);
  readonly maxRate = signal(600);
  readonly step = signal(1);
  readonly saturationSeed = signal(128);
  readonly apiBase = environment.api;

  readonly rows = computed<Row[]>(() => {
    const min = this.minRate();
    const max = this.maxRate();
    const step = Math.max(0.1, this.step());
    const seed = this.saturationSeed();

    const out: Row[] = [];
    for (let f = min; f <= max + 1e-9; f = +(f + step).toFixed(4)) {
      out.push(this.computeRow(f, seed));
    }
    // Force inclusion of easter-egg fee rates so they're always visible.
    if (min <= 69 && max >= 69 && step !== 1) out.push(this.computeRow(69, seed));
    if (min <= 420 && max >= 420 && step !== 1) out.push(this.computeRow(420, seed));
    out.sort((a, b) => a.feeRate - b.feeRate);
    return out;
  });

  // Pull a real cat closest to each row's fee rate so the user can
  // eyeball the swatch against actual minted art. Capped at 200 entries
  // by the backend; we slice on the client to match.
  readonly samples = rxResourceFixed({
    params: () => ({ rates: this.rows().slice(0, 200).map((r) => r.feeRate) }),
    stream: ({ params }) => {
      if (params.rates.length === 0) {
        return Promise.resolve([] as FeeRateSample[]) as never;
      }
      const httpParams = new HttpParams().set('rates', params.rates.join(','));
      return this.http.get<FeeRateSample[]>(
        `${environment.api}/api/cats/debug/samples-by-feerate`,
        { params: httpParams },
      );
    },
  });

  readonly samplesByRate = computed<Record<string, number | null>>(() => {
    const out: Record<string, number | null> = {};
    for (const s of this.samples.value() ?? []) {
      out[String(s.feeRate)] = s.catNumber;
    }
    return out;
  });

  catFor(feeRate: number): number | null {
    return this.samplesByRate()[String(feeRate)] ?? null;
  }

  private computeRow(feeRate: number, seed: number): Row {
    const { rgb, saturation } = feeRateToColor(feeRate, seed);

    // The cat's actual body pixel: HSLToRGB(hue, saturation, 0.45) —
    // derivePalette's c3 slot. Everything we bucket on is derived from
    // this final pixel, not from the cos-wave output. The intermediate
    // floats from feeRateToColor are an implementation detail; the human
    // sees this color and nothing else.
    const sat = Math.min(1, saturation);
    const [rawHue] = RGBToHSL(rgb[0], rgb[1], rgb[2]);
    const bodyRgb = HSLToRGB(rawHue, sat, 0.45);
    const bodyHex = rgbToHex(bodyRgb);

    // Re-derive the hue from the body pixel itself. Algebraically equal
    // to rawHue, but framed against the thing the user sees.
    const [hue] = RGBToHSL(bodyRgb[0], bodyRgb[1], bodyRgb[2]);

    let bucket: Bucket | 'fire' | 'saturated';
    if (feeRate >= 69 && feeRate < 70) bucket = 'fire';
    else if (feeRate >= 420 && feeRate < 421) bucket = 'saturated';
    else bucket = hueToColorCategory(hue);

    return {
      feeRate,
      bodyHex,
      hue,
      saturation,
      bucket,
      bucketHex: BUCKET_SWATCHES[bucket],
    };
  }

  isBoundary(row: Row, prev: Row | undefined): boolean {
    return !!prev && prev.bucket !== row.bucket;
  }
}
