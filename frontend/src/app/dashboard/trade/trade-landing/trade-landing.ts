import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-trade-landing',
  templateUrl: './trade-landing.html',
  styleUrl: './trade-landing.scss',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TradeLanding {}
