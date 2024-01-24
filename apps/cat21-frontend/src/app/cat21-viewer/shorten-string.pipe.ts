import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'shortenString',
  standalone: true
})
export class ShortenStringPipe implements PipeTransform {
  transform(str: string, length = 12) {
    if (!str) { return; }
    if (str.length <= length) {
      return str;
    }
    const half = length / 2;
    return str.substring(0, half) + '...' + str.substring(str.length - half);
  }
}
