import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'shortenAddress',
  standalone: true
})
export class ShortenAddressPipe implements PipeTransform  {

   transform(address: string | undefined | null): string {
    if (!address) return '';
    return shortenAddress(address);
   }
}

// like on magic eden
export function shortenAddress(address: string): string {
  return `${address.slice(0, 7)}...${address.slice(-4)}`
}
