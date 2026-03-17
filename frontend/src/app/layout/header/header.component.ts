import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.scss'],
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'header',
    imports: [RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent {
  readonly smallHeader = input<boolean | null>(false);
}
