import { Directive, ElementRef, OnInit, OnDestroy, Input } from '@angular/core';

export const placeholderAsString =
`<html>
  <head>
    <style>

      html,body {
        width: 100%;
        height: 100%;
        margin: 0;
      }

      body {
        background-color: #000000;
        background-image: linear-gradient(180deg, transparent 52%, black 52%, #212121 90%),
        linear-gradient(180deg, #000000 20%, #5a5a5a 80%);
      }
    </style>

  </head>
  <body>
  </body>
</html>`;

@Directive({
  selector: '[appToggleIframe]',
  standalone: true
})
export class ToggleIframeDirective implements OnInit, OnDestroy {

  @Input() toggleSrc = '';
  @Input() toggleSrcDoc = '';

  private intersectionObserver: IntersectionObserver | undefined;

  constructor(private element: ElementRef) { }

  ngOnInit() {
    this.intersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {

        if (this.toggleSrc) {
          if (entry.isIntersecting) {
            this.element.nativeElement.src = this.toggleSrc;
          } else {
            this.element.nativeElement.src = '/assets/placeholder.html';
          }
        }

        if (this.toggleSrcDoc) {
          if (entry.isIntersecting) {
            this.element.nativeElement.srcdoc = this.toggleSrcDoc;
          } else {
            this.element.nativeElement.srcdoc = placeholderAsString;
          }
        }

      });
    });

    this.intersectionObserver.observe(this.element.nativeElement);
  }

  ngOnDestroy() {
    this.intersectionObserver?.disconnect();
  }

}
