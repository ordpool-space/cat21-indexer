import { NgClass, NgFor, NgIf, NgStyle } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgbTooltip, NgbTooltipConfig } from '@ng-bootstrap/ng-bootstrap';
import { Cat21ParserService, CatTraits, ParsedCat21 } from 'ordpool-parser';

import { NoSanitizePipe } from '../no-sanitize.pipe';
import { Cat21 } from '../openapi-client';
import { CapitalizeFirstPipe } from './capitalize-first.pipe';
import { ShortenStringPipe } from './shorten-string.pipe';


@Component({
  selector: 'app-cat21-viewer',
  templateUrl: './cat21-viewer.component.html',
  styleUrls: ['./cat21-viewer.component.scss'],
  imports: [
    NgIf,
    NgFor,
    NoSanitizePipe,
    NgbTooltip,
    NgStyle,
    NgClass,
    ShortenStringPipe,
    CapitalizeFirstPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true
})
export class Cat21ViewerComponent {

  _cat21Transaction: Cat21 | undefined = undefined;
  svg: string | undefined = undefined;
  traits: CatTraits | undefined | null = undefined;

  constructor(
    tooltipConfig: NgbTooltipConfig
  ) {
    tooltipConfig.animation = false;

    //tooltipConfig.triggers = 'hover';
    // tooltipConfig.closeDelay = 1000 * 60;
  }

  @Input() showDetails = false;

  @Input()
  set cat21Transaction(cat21Transaction: Cat21 | undefined) {

    // early exit if setter is called multiple times
    if (this._cat21Transaction?.transactionId === cat21Transaction?.transactionId) {
      return;
    }

    this._cat21Transaction = cat21Transaction;
    const parsedCat21 = this.getParsedCat(cat21Transaction);

    if (parsedCat21) {
      this.svg = parsedCat21.getImage();
      this.traits = parsedCat21.getTraits();
      return;
    }

    this.svg = undefined;
    this.traits = undefined;
  }

  getParsedCat(cat: Cat21 | undefined): ParsedCat21 | undefined {

    if(!cat) {
      return undefined;
    }

    return Cat21ParserService.parse({
      txid: cat.transactionId,
      locktime: 21,
      status: {
        block_hash: cat.blockId
      }
    }) || undefined;
  }
}
