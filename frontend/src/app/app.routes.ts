import { Routes } from '@angular/router';

import { Start } from './start/start';
import { Details } from './details/details';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: Start },
  { path: 'cats/:itemsPerPage/:currentPage', component: Start },
  { path: 'cat/:catNumber', component: Details, data: { smallHeader: true } },
  { path: '**', component: Start },
];
