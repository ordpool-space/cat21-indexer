import { Routes } from '@angular/router';

import { About } from './about/about';
import { Address } from './address/address';
import { Block } from './block/block';
import { Dashboard } from './dashboard/dashboard';
import { ComingSoon } from './dashboard/coming-soon/coming-soon';
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
  { path: 'about', component: About, data: { smallHeader: true }, title: 'CAT-21 - About' },

  // Workspace — gated on a connected wallet via the components' own
  // CTA card (no router guard, since reads-without-wallet still
  // produces a useful "connect to continue" screen).
  { path: 'dashboard', component: Dashboard, data: { smallHeader: true }, title: 'CAT-21 - Dashboard' },
  { path: 'dashboard/cats', component: MyCats, data: { smallHeader: true }, title: 'CAT-21 - My cats' },
  {
    path: 'dashboard/transfer',
    component: ComingSoon,
    data: { smallHeader: true, heading: 'Transfer a cat', subtitle: 'Send one of your cats to another address.' },
    title: 'CAT-21 - Transfer a cat',
  },
  {
    path: 'dashboard/trade',
    component: ComingSoon,
    data: { smallHeader: true, heading: 'Trade a cat', subtitle: 'The native CAT-21 marketplace. The ultimate goal — list, bid, settle on-chain.' },
    title: 'CAT-21 - Trade a cat',
  },

  { path: '**', component: Start, title: 'CAT-21 - Rescue the cats!' },
];
