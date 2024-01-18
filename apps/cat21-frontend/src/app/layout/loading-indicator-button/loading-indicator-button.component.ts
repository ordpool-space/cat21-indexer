import { NgClass, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { SubmitStatus } from '../../submit-status';
import { getInitialState, SubmittableState } from '../../submittable-state';
import { AlertComponent } from '../alert/alert.component';

@Component({
  selector: 'app-loading-indicator-button',
  templateUrl: './loading-indicator-button.component.html',
  standalone: true,
  imports: [
    NgIf, NgClass, AlertComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoadingIndicatorButtonComponent {

  SubmitStatus = SubmitStatus;

  @Input() disabled = false;
  @Input() buttonText = 'Send';
  @Input() defaultIconClass = 'bi bi-send';
  @Input() state: SubmittableState | null = getInitialState();
  @Input() showAlertOnError = false;

  @Output() buttonClick = new EventEmitter<MouseEvent>();

}
