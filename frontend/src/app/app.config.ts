import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom, inject, provideBrowserGlobalErrorListeners, provideEnvironmentInitializer } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';

import { environment } from '../environments/environment';
import { ApiModule, Configuration } from './openapi-client';
import { routes } from './app.routes';
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
      // Track scroll positions & emit Scroll events, but don't scroll (SmartScrollService handles it)
      withInMemoryScrolling({ scrollPositionRestoration: 'disabled', anchorScrolling: 'disabled' }),
    ),
    // Initialize SmartScrollService (replaces Angular's built-in scroll restoration)
    provideEnvironmentInitializer(() => inject(SmartScrollService)),
  ],
};
