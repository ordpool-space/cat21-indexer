import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Placeholder shell for not-yet-implemented dashboard tools. Lets us
 * ship a `/dashboard/<slug>` URL the dashboard hub can already link to,
 * so the nav structure is stable before the feature lands.
 */
@Component({
  selector: 'app-coming-soon',
  templateUrl: './coming-soon.html',
  styleUrl: './coming-soon.scss',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComingSoon {
  // `heading`/`subtitle` instead of `title`/`description` so the
  // route's data fields don't collide with Router's special `title`
  // field (which sets the document title) when bound via
  // withComponentInputBinding().
  readonly heading = input.required<string>();
  readonly subtitle = input<string>('');
}
