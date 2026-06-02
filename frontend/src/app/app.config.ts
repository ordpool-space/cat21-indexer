import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  importProvidersFrom,
  inject,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { Network, bitcoinNetwork, storage } from 'ordpool-sdk';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { BrowserStorageAdapter } from './shared/browser-storage.adapter';
import { ApiModule, Configuration } from './shared/cat21-api';
import { SmartScrollService } from './shared/smart-scroll.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    importProvidersFrom(
      ApiModule.forRoot(() => new Configuration({ basePath: environment.api })),
    ),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'disabled', anchorScrolling: 'disabled' }),
    ),
    provideEnvironmentInitializer(() => inject(SmartScrollService)),
    { provide: bitcoinNetwork, useValue: Network.Mainnet },
    { provide: storage, useExisting: BrowserStorageAdapter },
  ],
};
