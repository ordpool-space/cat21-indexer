import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  importProvidersFrom,
  inject,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { Network, bitcoinNetwork, cat21Config, storage } from 'ordpool-sdk';

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
    // cat21Config feeds the SDK's mint pipeline. All four endpoints are
    // ours (no third-party deps):
    //  - mempoolApiUrl   → api.ordpool.space — electrs (UTXOs, broadcast,
    //    tx hex, mempool txs) + mempool framework (recommended fees)
    //  - cat21ApiUrl     → backend2.cat21.space — cat21-indexer REST API
    //    (status, latest cat numbers, cat image URL)
    //  - ordApiUrl       → ord.ordpool.space — our ord instance, per-
    //    outpoint inscription + rune detection for UtxoContentScanner
    //  - cat21OrdApiUrl  → ord.cat21.space — cat21-ord, per-outpoint
    //    CAT-21 cat detection for the same scanner
    {
      provide: cat21Config,
      useValue: {
        mempoolApiUrl: 'https://api.ordpool.space',
        cat21ApiUrl: 'https://backend2.cat21.space',
        ordApiUrl: 'https://ord.ordpool.space',
        cat21OrdApiUrl: 'https://ord.cat21.space',
      },
    },
  ],
};
