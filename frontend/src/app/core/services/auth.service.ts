import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, shareReplay, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '../config';
import { AuthTokens, LoginResponse } from '../models/auth.model';
import { User, UserRole } from '../models/user.model';

const ACCESS_TOKEN_KEY = 'ifp_access_token';
const REFRESH_TOKEN_KEY = 'ifp_refresh_token';
const USER_KEY = 'ifp_user';

export interface RegisterPayload {
  email: string;
  password: string;
  role: Exclude<UserRole, 'admin'>;
  companyName: string;
}

/** Where each role lands after logging in / when redirected away from a route they can't access. */
export function dashboardPathForRole(role: UserRole): string {
  switch (role) {
    case 'sme':
      return '/sme';
    case 'buyer':
      return '/buyer';
    case 'financier':
      return '/financier';
    default:
      return '/login';
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly currentUserSignal = signal<User | null>(this.readUserFromStorage());
  readonly currentUser = this.currentUserSignal.asReadonly();
  readonly isLoggedIn = computed(() => this.currentUserSignal() !== null);

  /**
   * Shared by every concurrent 401: if two requests fail around the same
   * moment, they must not each fire their own /auth/refresh call. The
   * backend rotates the refresh token on every use, so a second, distinct
   * refresh call made a moment after the first would find the token
   * already rotated and reject it as reuse — silently logging the user
   * out on what should have been a harmless race. Caching the in-flight
   * Observable (shareReplay(1)) means every concurrent caller subscribes
   * to the *same* HTTP call instead.
   */
  private refreshInFlight$: Observable<AuthTokens> | null = null;

  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  register(payload: RegisterPayload): Observable<User> {
    return this.http.post<User>(`${API_BASE_URL}/auth/register`, payload);
  }

  login(email: string, password: string): Observable<User> {
    return this.http.post<LoginResponse>(`${API_BASE_URL}/auth/login`, { email, password }).pipe(
      tap((res) => this.setSession(res.user, res.tokens)),
      map((res) => res.user),
    );
  }

  refreshAccessToken(): Observable<AuthTokens> {
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }

    const token = this.refreshToken;
    if (!token) {
      return throwError(() => new Error('No refresh token available'));
    }

    this.refreshInFlight$ = this.http.post<AuthTokens>(`${API_BASE_URL}/auth/refresh`, { refreshToken: token }).pipe(
      tap((tokens) => this.setTokens(tokens)),
      catchError((err) => {
        this.clearSession();
        return throwError(() => err);
      }),
      // Runs once for the shared execution (not once per subscriber)
      // because it sits *before* shareReplay in the pipe — that's what
      // makes it safe to clear the in-flight flag here.
      tap({ complete: () => (this.refreshInFlight$ = null), error: () => (this.refreshInFlight$ = null) }),
      shareReplay(1),
    );
    return this.refreshInFlight$;
  }

  logout(): void {
    const token = this.refreshToken;
    this.clearSession();
    this.router.navigate(['/login']);
    if (token) {
      // Best effort — the user is logged out client-side regardless of whether this call succeeds.
      this.http.post(`${API_BASE_URL}/auth/logout`, { refreshToken: token }).pipe(catchError(() => of(null))).subscribe();
    }
  }

  private setSession(user: User, tokens: AuthTokens): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.setTokens(tokens);
    this.currentUserSignal.set(user);
  }

  private setTokens(tokens: AuthTokens): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  }

  private clearSession(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.currentUserSignal.set(null);
  }

  private readUserFromStorage(): User | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  }
}
