import { Directive, HostListener, inject } from "@angular/core";
import { Router } from "@angular/router";


/**
 *  Apply Angular Routing behavior for own host
 */
@Directive({
  selector: "[appLinkify]",
  standalone: true
})
export class LinkifyDirective {

  router = inject(Router);

  @HostListener("click", ["$event"])
  onClick(e: MouseEvent) {

    if (!e.target) {
      return;
    }

    const url = (e.target as HTMLElement).getAttribute("href");
    if (url) {

      const currentHostname = window.location.hostname;
      const currentPort = window.location.port;
      const portPattern = currentPort ? `:${currentPort}` : '';

      const urlPattern = new RegExp(`^(?:https?:\\/\\/)?${currentHostname.replace(/\./g, '\\.')}${portPattern}(/.*)$`, 'i');
      const match = url.match(urlPattern)

      if (match && match[1]) {
        const path = match[1];

        e.preventDefault();
        this.router.navigate([path]);
      }
    }
  }
}
