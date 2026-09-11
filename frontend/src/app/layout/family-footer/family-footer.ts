import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ORDPOOL_FAMILY, ORDPOOL_FAMILY_HEADING } from 'ordpool-sdk';

/**
 * The Ordpool-family strip at the foot of every page: a heading, a one-line
 * lede, and every family member as its own column. cat21.space renders ALL
 * four members (including itself) and marks its own row as the current site
 * rather than dropping it, so a reader sees the whole set from here. The
 * heading, lede and per-member copy are SDK-owned (`ORDPOOL_FAMILY*`) so the
 * family reads identically on every site.
 */
@Component({
  selector: 'app-family-footer',
  templateUrl: './family-footer.html',
  styleUrl: './family-footer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamilyFooter {
  readonly heading = ORDPOOL_FAMILY_HEADING;
  /**
   * cat21.space's own tagline, one sentence per line. The per-site tagline is
   * written and formatted here, NOT read from the SDK: the SDK owns the shared
   * heading and the member lines, but each site owns its own tagline. The
   * coin-check clause lives at the action (singleAddressCaveat), not here — a
   * footer greets every visitor and shouldn't lead with a caution.
   */
  readonly ledeLines = [
    'Sometimes Bitcoin is hard money.',
    'Sometimes Bitcoin is a pixelated cat.',
  ];
  readonly members = ORDPOOL_FAMILY;

  /** This site's key in the family, so its own row renders as "you're here". */
  readonly currentKey = 'cat21' as const;
}
