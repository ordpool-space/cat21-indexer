import { Directive, forwardRef, HostListener } from '@angular/core';
import { DefaultValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Directive({
  selector: '[appTrimValueAccessor]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TrimValueAccessorDirective),
      multi: true,
    },
  ],
  standalone: true
})
export class TrimValueAccessorDirective extends DefaultValueAccessor {
  @HostListener('input', ['$event.target.value'])
  onInput(value: any): void {
    this.onChange(value.trim());
  }
}
