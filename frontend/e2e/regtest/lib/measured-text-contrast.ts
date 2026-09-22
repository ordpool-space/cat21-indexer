import { Page } from '@playwright/test';

/**
 * WCAG contrast of an element's text against the colour it actually paints on,
 * MEASURED from `getComputedStyle` in the real browser: it walks ancestors and
 * alpha-composites their backgrounds up to the first opaque layer (falling back
 * to the orange body `#FF9900`), so a translucent overlay is seen, not read as
 * solid. A hex-pair check on the source cannot see a background set without
 * pinning the text colour; this can.
 *
 * OPACITY GUARD: it THROWS if any ancestor carries `opacity < 1`. A dimmed
 * subtree composites the whole element (its background AND its text) toward what
 * is behind it, so the on-screen contrast is not the pair `getComputedStyle`
 * reports, and a naive read passes a contrast the user never sees. Rather than
 * return that misleading number (a silent false-pass, the worst direction for a
 * contrast guard), it refuses: WCAG AA does not apply to a dimmed/disabled
 * element anyway, so a caller measuring a deliberately dimmed control should
 * assert its dimmed STATE, not its contrast.
 */
export async function measuredTextContrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el: Element) => {
    const parse = (c: string): [number, number, number, number] => {
      const m = c.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
      if (!m) throw new Error(`unparseable colour: ${c}`);
      return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    };

    // Refuse a dimmed subtree: cumulative ancestor opacity must be 1.
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity || '1');
    }
    if (opacity < 0.999) {
      throw new Error(
        `measuredTextContrast: cumulative ancestor opacity ${opacity.toFixed(2)} < 1, the element is ` +
          'dimmed. Its on-screen contrast is not the getComputedStyle pair, and AA does not apply to a ' +
          'dimmed/disabled element. Assert its dimmed state instead of its contrast.',
      );
    }

    const layers: Array<[number, number, number, number]> = [];
    let base: [number, number, number] = [255, 153, 0]; // #FF9900 body fallback
    for (let node: Element | null = el; node; node = node.parentElement) {
      const [r, g, b, a] = parse(getComputedStyle(node).backgroundColor);
      if (a >= 1) { base = [r, g, b]; break; }
      if (a > 0) layers.push([r, g, b, a]);
    }
    for (let i = layers.length - 1; i >= 0; i--) {
      const [r, g, b, a] = layers[i];
      base = [a * r + (1 - a) * base[0], a * g + (1 - a) * base[1], a * b + (1 - a) * base[2]];
    }
    const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const [fr, fg, fb] = parse(getComputedStyle(el).color);
    const lf = lum([fr, fg, fb]) + 0.05;
    const lb = lum(base) + 0.05;
    return lf > lb ? lf / lb : lb / lf;
  });
}
