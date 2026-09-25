# Invoice Financing Platform

A platform where SMEs convert buyer-confirmed invoices into immediate cash via financier bidding. Buyers confirm invoices, financiers bid to advance payment at a discount, SMEs accept an offer and get paid immediately, and on the invoice's due date the platform settles automatically through an internal escrow ledger.

This is a monorepo with two independent apps:

```
backend/     NestJS API — the focus of this project. See backend/README.md for the full
             architecture writeup, schema diagram, concurrency safeguards, and setup guide.
frontend/    Angular app that demonstrates the end-to-end flow against the backend API.
```

## Quick start

The whole backend (API + Postgres + Redis) in one command, from this directory:

```bash
docker compose up --build
```

API at `http://localhost:3000`, interactive docs at `http://localhost:3000/api/docs`.

To get a database with something worth looking at — accounts plus invoices in every state, including overdue and defaulted — seed it:

```bash
cd backend && npm run seed
```

For local development (fast reload, running the frontend, running tests), see:

- **[backend/README.md](backend/README.md)** — architecture, database schema, concurrency safeguards, environment variables, testing.
- **[frontend/README.md](frontend/README.md)** — running the Angular app against the backend.

## Why a monorepo, and why so plain

`docker-compose.yml` sits at the root because it's the one thing that spans both apps (and will run the frontend too, once that's containerized). Everything else — dependencies, `tsconfig`, tests — stays scoped inside `backend/` and `frontend/` independently; there's no shared workspace tooling (Nx, npm workspaces, etc.) linking them, since the two apps don't share code and that would be complexity this project doesn't need.
