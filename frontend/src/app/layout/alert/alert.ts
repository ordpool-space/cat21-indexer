import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-alert',
  templateUrl: './alert.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Alert {
  readonly type = input<'primary' | 'success' | 'warning' | 'danger'>('warning');
  readonly alertClass = computed(() => `alert alert-${this.type()} d-flex align-items-center m-0`);
}
