import { Routes } from '@angular/router';

import { StartComponent } from './start/start.component';
import { DetailsComponent } from './details/details.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: StartComponent },
  { path: 'cats/:itemsPerPage/:currentPage', component: StartComponent },
  { path: 'cat/:catNumber', component: DetailsComponent, data: { smallHeader: true } },
  { path: '**', component: StartComponent },
];
