import {
  ApplicationConfig,
  APP_INITIALIZER,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { AuthService } from './core/services/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    // Zone-based change detection with event coalescing for performance
    provideZoneChangeDetection({ eventCoalescing: true }),

    // Router with view transitions API for smooth page changes
    provideRouter(routes, withViewTransitions()),

    // HTTP client with fetch API and Bearer token interceptor
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),

    // Angular animations
    provideAnimationsAsync(),

    // Bootstrap: load persisted session on app start
    {
      provide: APP_INITIALIZER,
      useFactory: (auth: AuthService) => () => auth.loadCurrentUser(),
      deps: [AuthService],
      multi: true,
    },
  ],
};
