import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { InscriptionExtended } from '../../openapi-client';
import { environment } from '../../../environments/environment';
import { ToggleIframeDirective } from '../toggle-iframe.directive';

@Component({
  selector: 'app-inscription-list-item',
  templateUrl: './inscription-list-item.component.html',
  styleUrls: ['./inscription-list-item.component.scss'],
  standalone: true,
  imports: [
    RouterLink,
    NgIf,
    NgFor,
    ToggleIframeDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InscriptionListItemComponent  {

  @Input() inscription?: InscriptionExtended;
  environment = environment;
}
