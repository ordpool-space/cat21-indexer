import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';

import { environment } from '../environments/environment';
import { ApiModule, Configuration } from './openapi-client';
import { StartComponent } from './start/start.component';
import { DetailsComponent } from './details/details.component';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    importProvidersFrom(
      ApiModule.forRoot(() => new Configuration({ basePath: environment.api })),
    ),
    provideRouter([
      { path: '', pathMatch: 'full', component: StartComponent },
      { path: 'cats/:itemsPerPage/:currentPage', component: StartComponent },
      { path: 'cat/:catNumber', component: DetailsComponent, data: { smallHeader: true } },
      { path: '**', component: StartComponent },
    ]),
  ],
};
