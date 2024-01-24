import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { environment } from '../environments/environment';
import { ApiModule, Configuration } from './openapi-client';
import { StartComponent } from './start/start.component';
import { DetailsComponent } from './details/details.component';


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
        { path: 'cat/:transactionId', component: DetailsComponent, data: { smallHeader: true }  },
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
