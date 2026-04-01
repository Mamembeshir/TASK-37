import { inject } from '@angular/core';
import {
  HttpInterceptorFn,
  HttpErrorResponse,
} from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

const TOKEN_KEY = 'roh_token';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem(TOKEN_KEY);

  // Attach Bearer token to every outgoing request that has one
  const authedReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authedReq).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        // Token expired or revoked — clear state and send to login
        localStorage.removeItem(TOKEN_KEY);
        // Lazy-inject to avoid circular dependency at construction time
        inject(AuthService).currentUser.set(null);
        inject(Router).navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
