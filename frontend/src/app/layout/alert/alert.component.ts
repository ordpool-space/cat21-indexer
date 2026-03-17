import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-alert',
  templateUrl: './alert.component.html',
  imports: [NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AlertComponent {
  readonly type = input<'primary' | 'success' | 'warning' | 'danger'>('warning');
}
