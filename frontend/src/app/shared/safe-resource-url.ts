import { inject, Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * SECURITY LOCK: only safe inside a `sandbox="allow-scripts"` iframe
 * WITHOUT `allow-same-origin`.
 *
 * This bypasses Angular's resource-URL sanitizer so an untrusted
 * `/preview/<id>` URL can be bound to an `<iframe src>`. The inscription
 * bytes behind that URL are attacker-controlled. What contains them is
 * the consuming iframe's sandbox (scripts run, but in an opaque origin
 * with no access to the parent DOM, cookies, or storage) plus the fact
 * that the preview host is cross-origin to cat21.space. Do NOT use this
 * pipe anywhere else, and NEVER add `allow-same-origin` to an iframe that
 * consumes it — either would let inscription scripts reach cat21.space.
 */
@Pipe({ name: 'safeResourceUrl' })
export class SafeResourceUrlPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}
