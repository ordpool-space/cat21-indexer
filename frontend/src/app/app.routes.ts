import { Routes } from '@angular/router';

import { Details } from './details/details';
import { Start } from './start/start';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: Start, title: 'CAT-21 - Rescue the cats!' },
  { path: 'cats/:itemsPerPage/:currentPage', component: Start, title: 'CAT-21 - Minted cats' },
  { path: 'cat/:catNumber', component: Details, data: { smallHeader: true }, title: 'CAT-21 - Cat details' },
  { path: '**', component: Start, title: 'CAT-21 - Rescue the cats!' },
];
