import { JsonPipe, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'header',
  standalone: true,
  imports: [
    NgIf,
    RouterLink,
    RouterLinkActive,
    JsonPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent {

  @Input() smallHeader: boolean | null = false;
}
