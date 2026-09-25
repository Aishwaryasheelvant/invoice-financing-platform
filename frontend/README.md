# Frontend

An Angular app that demonstrates the invoice financing flow end to end against the backend API. Kept deliberately plain — the backend is the point of this project; this exists to prove the API actually works from a real client, not as a design showcase.

## Running it

The backend must already be running (see `../backend/README.md`) on `http://localhost:3000`, with `CORS_ORIGIN` allowing this app's origin (defaults to `http://localhost:4200`, which matches Angular's default dev port).

```bash
npm install
ng serve
```

Open `http://localhost:4200`.

If you serve on a different port, update `CORS_ORIGIN` in the backend's `.env` to match, or the browser will block every request.

## What to try

1. **Register** three accounts — one each as SME, buyer, financier (`/register`).
2. Log in as the **buyer** first, and copy their user ID shown on the dashboard (there's no user directory in the API, so this is how an SME finds out who to bill).
3. Log in as the **SME**, create an invoice naming that buyer ID.
4. Log in as the **buyer**, confirm the invoice.
5. Log in as the **financier**, it should now appear as open for bidding — submit an offer.
6. Log in as the **SME**, accept the offer. A transaction (the payout) appears shortly after — it's processed by a background job, not synchronously.

## Structure

```
src/app/
  core/
    models/        plain TS interfaces mirroring the backend's response DTOs
    services/       one per resource — auth, invoices, offers, transactions — the only
                     place HttpClient is used; components never call it directly
    interceptors/    attaches the access token to every request, transparently
                     refreshes it on a 401 and retries once
    guards/          authGuard (must be logged in) and roleGuard (must have the right role)
  pages/
    login/, register/               public
    sme-dashboard/                  create invoices, review + accept offers, view payouts
    buyer-dashboard/                confirm invoices
    financier-dashboard/            browse confirmed invoices, bid, track your own offer
```

Routes are lazy-loaded (`loadComponent`) and guarded in `app.routes.ts`.

## Notable behavior

The auth interceptor de-duplicates concurrent token refreshes: if several requests 401 around the same moment, they share a single `/auth/refresh` call rather than each firing their own. That matters because the backend **rotates** the refresh token on every use — two independent refresh calls in quick succession would have the second one rejected as token reuse, which would silently log the user out on what should have been a harmless race. See `AuthService.refreshAccessToken()`.
