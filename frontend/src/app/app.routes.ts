import { Routes } from '@angular/router';

import { About } from './about/about';
import { Address } from './address/address';
import { Block } from './block/block';
import { Dashboard } from './dashboard/dashboard';
import { ComingSoon } from './dashboard/coming-soon/coming-soon';
import { Mint } from './dashboard/mint/mint';
import { Transfer } from './dashboard/transfer/transfer';
import { TradeLanding } from './dashboard/trade/trade-landing/trade-landing';
import { MakeOffer } from './dashboard/trade/make-offer/make-offer';
import { AcceptOffer } from './dashboard/trade/accept-offer/accept-offer';
import { DebugColors } from './debug-colors/debug-colors';
import { Details } from './details/details';
import { MyCats } from './my-cats/my-cats';
import { Orderbook } from './orderbook/orderbook';
import { Sat } from './sat/sat';
import { Search } from './search/search';
import { Start } from './start/start';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: Start, title: 'CAT-21 - Rescue the cats!' },
  { path: 'cats/:itemsPerPage/:currentPage', component: Start, title: 'CAT-21 - Minted cats' },
  { path: 'cat/:catNumber', component: Details, title: 'CAT-21 - Cat details' },
  { path: 'address/:address', component: Address, title: 'CAT-21 - Address' },
  { path: 'block/:blockHeight', component: Block, title: 'CAT-21 - Block' },
  { path: 'block/:blockHeight/:page', component: Block, title: 'CAT-21 - Block' },
  { path: 'sat/:sat', component: Sat, title: 'CAT-21 - Sat' },
  { path: 'search', component: Search, title: 'CAT-21 - Search by trait' },
  { path: 'search/:currentPage', component: Search, title: 'CAT-21 - Search by trait' },
  { path: 'debug/colors', component: DebugColors, title: 'CAT-21 - Debug colors' },
  { path: 'about', component: About, title: 'CAT-21 - About' },

  // CAT-21 orderbook — public feed of seller-signed listings. No
  // wallet required for read; sellers publish from the sell modal
  // on their cat's details page.
  { path: 'orderbook', component: Orderbook, title: 'CAT-21 - Orderbook' },
  { path: 'orderbook/:itemsPerPage/:currentPage', component: Orderbook, title: 'CAT-21 - Orderbook' },

  // Workspace — gated on a connected wallet via the components' own
  // CTA card (no router guard, since reads-without-wallet still
  // produces a useful "connect to continue" screen).
  { path: 'dashboard', component: Dashboard, title: 'CAT-21 - Dashboard' },
  { path: 'dashboard/cats', component: MyCats, title: 'CAT-21 - My cats' },
  { path: 'dashboard/mint', component: Mint, title: 'CAT-21 - Mint a cat' },
  {
    path: 'dashboard/transfer',
    component: Transfer,
    title: 'CAT-21 - Transfer a cat',
  },
  {
    path: 'dashboard/trade',
    component: TradeLanding,
    title: 'CAT-21 - Trade a cat',
  },
  {
    path: 'dashboard/trade/make',
    component: MakeOffer,
    title: 'CAT-21 - Make a buy-offer',
  },
  {
    path: 'dashboard/trade/accept',
    component: AcceptOffer,
    title: 'CAT-21 - Accept a buy-offer',
  },

  { path: '**', component: Start, title: 'CAT-21 - Rescue the cats!' },
];
