import { Routes } from '@angular/router';

import { Address } from './address/address';
import { Block } from './block/block';
import { DebugColors } from './debug-colors/debug-colors';
import { Details } from './details/details';
import { MyCats } from './my-cats/my-cats';
import { Sat } from './sat/sat';
import { Search } from './search/search';
import { Start } from './start/start';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: Start, title: 'CAT-21 - Rescue the cats!' },
  { path: 'cats/:itemsPerPage/:currentPage', component: Start, title: 'CAT-21 - Minted cats' },
  { path: 'cat/:catNumber', component: Details, data: { smallHeader: true }, title: 'CAT-21 - Cat details' },
  { path: 'address/:address', component: Address, data: { smallHeader: true }, title: 'CAT-21 - Address' },
  { path: 'block/:blockHeight', component: Block, data: { smallHeader: true }, title: 'CAT-21 - Block' },
  { path: 'block/:blockHeight/:page', component: Block, data: { smallHeader: true }, title: 'CAT-21 - Block' },
  { path: 'sat/:sat', component: Sat, data: { smallHeader: true }, title: 'CAT-21 - Sat' },
  { path: 'search', component: Search, data: { smallHeader: true }, title: 'CAT-21 - Search by trait' },
  { path: 'search/:currentPage', component: Search, data: { smallHeader: true }, title: 'CAT-21 - Search by trait' },
  { path: 'debug/colors', component: DebugColors, data: { smallHeader: true }, title: 'CAT-21 - Debug colors' },
  { path: 'my-cats', component: MyCats, data: { smallHeader: true }, title: 'CAT-21 - My cats' },
  { path: '**', component: Start, title: 'CAT-21 - Rescue the cats!' },
];
