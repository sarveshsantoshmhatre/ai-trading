# AI Trading Bot

AI-assisted crypto trading prototype using Bun/TypeScript, OpenRouter, the Lighter exchange SDK, Prisma/PostgreSQL, and a React dashboard.

## Safety status

This is experimental software, not a validated profitable strategy. Do not enable live trading until the order behavior, exchange SDK semantics, risk limits, and backtests have been reviewed. The trading engine can submit real exchange orders.

The bot now has basic application-side caps, serialized trading cycles, close-order reconciliation, and dashboard password sessions. These do not replace independent monitoring, exchange-side risk controls, or a paper-trading phase.

## Setup

Install dependencies:

```bash
bun install
bun run db:generate
bun run db:migrate:deploy
```

Configure environment variables before starting any service:

- `DATABASE_URL`: PostgreSQL connection string.
- `OPENROUTER_API_KEY`: OpenRouter API key.
- `MAX_POSITION_NOTIONAL_USD`: maximum notional value per new position; defaults to 100 USD.
- `MAX_ORDER_QUANTITY`: maximum base quantity per order; defaults to 1.
- `MAX_ORDER_SLIPPAGE_FRACTION`: allowed price offset for IOC orders; defaults to 0.01 and must be at most 0.05.
- `TRADING_INTERVAL_MS`: minimum time between trading cycles; defaults to 300000.
- `CREDENTIAL_ENCRYPTION_KEY`: base64-encoded 32-byte key used to encrypt exchange credentials at rest. Generate with `openssl rand -base64 32` and store it outside the database.
- `DASHBOARD_PASSWORD`: password for the private dashboard.
- `DASHBOARD_SESSION_SECRET`: random secret of at least 32 characters used to sign sessions.
- `DASHBOARD_ALLOWED_ORIGINS`: comma-separated exact frontend origins; defaults to http://localhost:5173.
- `PORT`: dashboard API port; defaults to 3000.
- `VITE_BACKEND_URL`: dashboard API base URL; defaults to http://localhost:3000.

Generate a session secret with `openssl rand -base64 48`. Use a strong, unique dashboard password. In production, serve the frontend and API over HTTPS and configure exact allowed origins.

## Encrypt existing exchange credentials

Before starting the trading engine after deploying this change, configure `CREDENTIAL_ENCRYPTION_KEY` and run:

```bash
bun run secrets:encrypt
```

Back up the database first. The migration is idempotent: already encrypted credentials are skipped. Keep the encryption key backed up separately; losing it makes encrypted exchange credentials unrecoverable. Runtime trading refuses to use credentials that have not been encrypted.

## Run

Run the trading engine:

```bash
bun run start
```

Run the dashboard API in a separate process:

```bash
bun run start:api
```

Run the portfolio tracker in a separate process if needed:

```bash
bun run start:tracker
```

Build the frontend from its directory:

```bash
cd frontend
bun install
bun run build
```

## Important remaining operational work

- Existing `Models.lighterApiKey` values remain plaintext until you run `bun run secrets:encrypt` with `CREDENTIAL_ENCRYPTION_KEY` configured. Run this migration before starting the updated trading engine. Rotate any key that may have been exposed.
- Confirm Lighter's `reduceOnly` encoding, market quantity/price precision, response schema, and candle timestamp units against the currently deployed SDK/API. Test with a non-funded account first.
- Implement a proper historical backtest including fees, slippage, funding, partial fills, and liquidation. Paper trade before live trading.
- Configure database backups, log redaction, monitoring/alerts, and an exchange-side emergency kill switch.
- Run `bun run typecheck`, `bun test`, and the frontend build in CI before deployment.
