import { Directive, forwardRef, HostListener } from '@angular/core';
import { DefaultValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Directive({
  selector: '[appNumberTrimValueAccessor]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TrimNumberValueAccessorDirective),
      multi: true,
    },
  ],
  standalone: true
})
export class TrimNumberValueAccessorDirective extends DefaultValueAccessor {
  @HostListener('input', ['$event.target.value'])
  onInput(value: any): void {
    this.onChange(
      value.trim().replace(/[,.#]/g, '')
    );
  }
}
