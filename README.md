# UnionDrive #16

UnionDrive #16 is a responsive ride-hailing demo built with React, TypeScript, Vite, Express, and SQLite. It has a real local API and server-owned demo ledger, but it is **not a live ride service**: it does not dispatch real drivers or process real payments.

## Run locally

Requirements: Node.js 22.13 or later and npm.

On Windows, from this folder:

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

Open the Vite URL printed in the terminal (default `http://127.0.0.1:5173`). The Vite development server proxies `/api` requests to the local Express API at `http://127.0.0.1:3001`. Keep both processes running. The app creates its SQLite database at `./data/uniondrive.sqlite`.

Useful commands:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

`npm run build` typechecks and builds the web client and API. `npm run preview` previews the built **web client only**; it does not provide the API proxy or a deployable combined service.

## What works in the local demo

### Accounts and security boundaries

- Create rider or driver accounts and sign in/out. Passwords are hashed with bcrypt; the browser receives an HttpOnly, SameSite session cookie, while CSRF tokens stay in memory.
- Sessions and CSRF tokens are stored as HMAC-SHA-256 digests keyed by `SESSION_SECRET`. The API validates request origin and CSRF tokens, applies Helmet security headers and rate limits, validates request bodies, and rejects role-inappropriate operations.
- The database is the source of truth for users, trip state, demo wallet balances, and ledger entries. Client `localStorage` is used only for the appearance preference, not money or ride state.
- API responses are not cached by the service worker. In production builds the service worker caches the app shell and static GET responses for basic offline loading; ride and account actions still require the API.
- Driver accounts begin pending and cannot go online until an operator verifies them. An optional local-only endpoint can mark a driver verified when `ADMIN_API_TOKEN` is configured; there is no operator dashboard or document review workflow.

### Ride requests and demo wallets

- Riders select a pickup, destination, and vehicle class, request a server-generated fare quote, and submit a trip request. A request remains unpaid until an online, verified driver accepts it.
- The demo route estimator produces illustrative distance/time values. A Mapbox geocoding/directions adapter can be configured for server-side quote estimates, but the client map remains an illustration and its destination suggestions are static.
- The three server-side demo wallets follow the requested split: upon driver acceptance, the customer wallet pays the fare that was quoted and accepted; Union Wallet routes the funds, retains 20%, and credits the driver 80%.
- Fare amounts are stored as integer cents, and the split uses integer arithmetic. The SQLite ledger applies acceptance and refund entries transactionally. Cancellation of an accepted demo trip restores the customer balance and reverses the driver and Union entries.
- Demo riders receive $250 in starting credits. In demo mode, riders can add fixed $25 or $50 credit amounts. These are simulated credits; no card, bank, payment processor, withdrawal, or payout is involved.
- Riders and assigned drivers can view their trip history and current trip status. Drivers can manually refresh available requests, accept a quoted fare, cancel an active trip, and mark an accepted trip complete.

### Product and device support

- Responsive rider, activity, wallet, and driver screens; white/light-blue/blue/platinum light theme; persistent dark theme with green accents.
- Web app manifest and installable PWA shell for supported mobile browsers. This is not a native Android or iOS application, and background location and push notifications are not implemented.

## Configuration

Copy `.env.example` to `.env` for local work. Important settings:

| Variable | Local behavior |
|---|---|
| `APP_ORIGIN` | Exact browser origin allowed by the API; default is `http://127.0.0.1:5173`. |
| `SESSION_SECRET` | HMAC key; use at least 32 characters and replace the example value outside local development. |
| `DATABASE_PATH` | SQLite file path; defaults to `./data/uniondrive.sqlite`. |
| `DEMO_MODE` | Keep `true` for the local demo and its fixed-value credit top-ups. |
| `MAP_PROVIDER` | `demo` uses illustrative routes; `mapbox` requires `MAPBOX_ACCESS_TOKEN` and enables geocoding/directions for fare quotes. |
| `ADMIN_API_TOKEN` | Optional local operator token for manually changing driver verification status. Keep it secret; this is not a production admin system. |

`PAYMENT_PROVIDER=stripe` is deliberately rejected: a Stripe/Connect adapter and webhook verification do not exist. Production startup is also deliberately blocked, even if credentials are supplied. Do not use this demo to take real payments, onboard real drivers, or provide rides.

## Validation

- `npm.cmd run typecheck` — TypeScript checks for browser and server code.
- `npm.cmd test` — API tests for quote/request/accept, the 80/20 ledger split, cancellation/refund, CSRF/origin/role checks, and idempotent demo top-ups.
- `npm.cmd run build` — client and server compilation plus Vite production assets.

## Still required before a live launch

These are not implemented, and cannot be completed without provider accounts, business decisions, legal review, production infrastructure, and real operational processes:

### Payments, wallets, and trip correctness

- Integrate a real payment provider (including customer payment methods, authorization/capture, refunds, disputes, reconciliation, and verified webhooks). Implement driver payouts through an appropriate connected-account product. The displayed wallets are a demo ledger, not custodial or withdrawable money accounts.
- Design a durable payment/trip state machine for partial provider failures, asynchronous webhooks, retries, chargebacks, cancellation fees, and reconciliation. The local demo's SQLite transaction cannot make an external payment effect atomic.
- Decide and implement pricing, taxes, fees, tips, promotions, minimums, cancellation policies, and regional fare rules. Current fare arithmetic is illustrative, not approved commercial pricing.
- Deploy a production database with migrations, backup/restore, access controls, monitoring, and a tested recovery plan. The current schema is initialized automatically by SQLite and has no production migration/backup process.

### Dispatch, location, and mobile

- Implement real-time location updates, consent and permission handling, geospatial driver/rider matching, dispatch timeouts, trip-state synchronization, navigation, and reliable handling of connectivity loss.
- Add a real interactive map, address autocomplete, route display, driver positions, and location privacy controls. Mapbox is currently used only by the server-side fare estimate adapter.
- Build and release native Android and iOS apps or a validated production-grade mobile experience, including background location, push notifications, accessibility checks, crash reporting, and app-store compliance.
- Add rider/driver messaging, trip safety tooling, support workflows, incident escalation, and operational status reporting.

### Trust, legal, privacy, and operations

- Create authenticated, role-based operator tools with audit trails; collect and verify driver identity, licenses, insurance, and vehicle/safety documents; implement ongoing eligibility checks.
- Complete jurisdiction-specific transportation, employment, insurance, tax, consumer-protection, accessibility, and payment compliance review. Publish and operationalize privacy, retention/deletion, consent, terms, and safety policies.
- Establish production secrets management, TLS/domain and hosting configuration, database encryption and backups, logging/monitoring/alerting, vulnerability management, incident response, and disaster recovery.
- Perform security, privacy, load, accessibility, and end-to-end testing against the production architecture before inviting real users.
