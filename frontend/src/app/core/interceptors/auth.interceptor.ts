import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

const AUTH_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

/**
 * Attaches the access token to every outgoing request, and transparently
 * renews it on a 401: the failed request is retried once with the new
 * token. The user only ever notices a 401 if the refresh itself also
 * fails (refresh token expired/revoked) — at that point AuthService.logout()
 * runs and sends them back to /login.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const isAuthEndpoint = AUTH_ENDPOINTS.some((path) => req.url.includes(path));

  const authorizedReq = attachToken(req, authService.accessToken, isAuthEndpoint);

  return next(authorizedReq).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthEndpoint) {
        return authService.refreshAccessToken().pipe(
          switchMap((tokens) => next(attachToken(req, tokens.accessToken, false))),
          catchError((refreshError) => {
            authService.logout();
            return throwError(() => refreshError);
          }),
        );
      }
      return throwError(() => error);
    }),
  );
};

function attachToken<T>(req: HttpRequest<T>, token: string | null, isAuthEndpoint: boolean) {
  if (!token || isAuthEndpoint) {
    return req;
  }
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
