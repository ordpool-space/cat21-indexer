import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { environment } from '../environments/environment';
import { ApiModule, Configuration } from './openapi-client';
import { StartComponent } from './start/start.component';


export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    importProvidersFrom(
      ApiModule.forRoot(
        () =>
          new Configuration({
            basePath: environment.api,
          })
      )
    ),
    provideRouter(
      [
        { path: '', component: StartComponent },
        // { path: 'inscription/:inscriptionId', component: DetailsComponent },
        // { path: 'faq', component: FaqComponent },
        { path: '**', component: StartComponent },
      ],
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled'
      })
    )
  ],
};
