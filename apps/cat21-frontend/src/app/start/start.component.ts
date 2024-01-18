import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgbPagination } from '@ng-bootstrap/ng-bootstrap';

import { AlertComponent } from '../layout/alert/alert.component';
import { LoadingIndicatorButtonComponent } from '../layout/loading-indicator-button/loading-indicator-button.component';
import { LoadingIndicatorComponent } from '../layout/loading-indicator/loading-indicator.component';


@Component({
    selector: 'app-start',
    templateUrl: './start.component.html',
    styleUrls: ['./start.component.scss'],
    standalone: true,
    imports: [
      LoadingIndicatorComponent,
      LoadingIndicatorButtonComponent,
      AlertComponent,
      NgFor,
      NgIf,
      RouterLink,
      NgbPagination
    ],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class StartComponent {

}
