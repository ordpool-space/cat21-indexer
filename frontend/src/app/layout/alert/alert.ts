import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-alert',
  templateUrl: './alert.html',
  imports: [NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Alert {
  readonly type = input<'primary' | 'success' | 'warning' | 'danger'>('warning');
}
