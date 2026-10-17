# AI Trading Bot

AI-assisted crypto trading prototype using Bun/TypeScript, OpenRouter, the Lighter exchange SDK, Prisma/PostgreSQL, and a React dashboard.

## Safety status

This is experimental software, not a validated profitable strategy. The default is `TRADING_MODE=paper`; simulated positions and fees are persisted in the database, and the paper engine does not use stored exchange credentials or send exchange orders. Paper fills use candle-derived mark prices plus modeled slippage and fees; they are not a reliable substitute for order-book fills or a historical backtest.

Real orders require all three explicit gates: `TRADING_MODE=live`, `TRADING_ENABLED=true`, and `LIVE_TRADING_ACK=I_ACCEPT_REAL_ORDERS`. Do not configure those gates until exchange behavior, order precision, reduce-only semantics, risk controls, and paper-trading results have been independently verified and a final live-trading decision has been made.

## Setup

Configure environment variables before running setup commands or starting any service:

- `DATABASE_URL`: PostgreSQL connection string.
- `OPENROUTER_API_KEY`: OpenRouter API key.
- `MAX_POSITION_NOTIONAL_USD`: maximum notional value per new position; defaults to 100 USD.
- `MAX_ORDER_QUANTITY`: maximum base quantity per order; defaults to 1.
- `MAX_ORDER_SLIPPAGE_FRACTION`: allowed price offset for IOC orders; defaults to 0.01 and must be at most 0.05.
- `TRADING_MODE`: `paper` by default; use only `paper` for initial deployment and testing.
- `TRADING_INTERVAL_MS`: minimum time between model cycles; defaults to 3600000 (one hour) in paper mode to limit external model API usage.
- `TRADING_ENABLED`: a live-order gate; must be exactly `true`, but does not enable live orders on its own.
- `LIVE_TRADING_ACK`: must equal `I_ACCEPT_REAL_ORDERS` in addition to the other live gates; leave unset during paper testing.
- `PAPER_INITIAL_BALANCE_USD`: simulated starting balance; defaults to 1000.
- `PAPER_TRADING_FEE_RATE`: modeled fee per side; defaults to 0.0005 (0.05%).
- `CREDENTIAL_ENCRYPTION_KEY`: base64-encoded 32-byte key used to encrypt exchange credentials at rest. Generate with `openssl rand -base64 32` and store it outside the database.
- `DASHBOARD_PASSWORD`: password for the private dashboard.
- `DASHBOARD_SESSION_SECRET`: random secret of at least 32 characters used to sign sessions.
- `DASHBOARD_ALLOWED_ORIGINS`: comma-separated exact frontend origins; defaults to http://localhost:5173.
- `PORT`: dashboard API port; defaults to 3000.
- `VITE_BACKEND_URL`: optional dashboard API base URL; defaults to same-origin for the hosted single-domain deployment.

Generate a session secret with a cryptographically secure generator and configure it as a protected hosting variable. Use a strong, unique dashboard password. In production, serve the dashboard over HTTPS. The dashboard/API container serves the built frontend and records portfolio snapshots itself, reducing the initial Railway setup to a database, an API/dashboard service, and a separate paper engine service.

Install dependencies and prepare the database:

```bash
bun install
bun run db:generate
bun run db:migrate:deploy
```

## Free hosting deployment

See [`DEPLOYMENT_FREE.md`](./DEPLOYMENT_FREE.md) for the selected free-tier architecture and setup instructions: Render Free for the dashboard/API, Supabase Free Postgres for persistent data, and a scheduled GitHub Actions workflow for one-shot paper cycles. The deployment is paper-only and does not require exchange credentials. Keep `TRADING_MODE=paper` and `TRADING_ENABLED=false`.

## Exchange credentials and live trading (not for initial deployment)

Do not add exchange credentials or switch to live mode during this deployment-preparation phase. If live trading is ever approved later, first back up the database, set `CREDENTIAL_ENCRYPTION_KEY` as a protected variable, and run `bun run secrets:encrypt` in a controlled hosted one-off job. The migration is idempotent. Keep the key backed up separately; losing it makes encrypted credentials unrecoverable. Verify the current Lighter SDK/API behavior with a non-funded account before considering any live order path.

## Run

Run the paper engine:

```bash
TRADING_MODE=paper bun run start
```

Run the API and dashboard (the API process starts portfolio tracking automatically):

```bash
bun run start:api
```

The `start:tracker` script remains available for testing the tracker separately, but should not be started as a third hosted service when the API is already tracking snapshots.

Build the frontend from its directory:

```bash
cd frontend
bun install
bun run build
```

## Important remaining operational work

- Existing `Models.lighterApiKey` values remain plaintext until you run `bun run secrets:encrypt` with `CREDENTIAL_ENCRYPTION_KEY` configured. Run this migration before starting the updated trading engine. Rotate any key that may have been exposed.
- Confirm Lighter's `reduceOnly` encoding, market quantity/price precision, response schema, and candle timestamp units against the currently deployed SDK/API. Test with a non-funded account first.
- Implement historical backtests including funding, partial fills, liquidation, and robust market data before making any performance claims.
- Configure database backups, log redaction, monitoring/alerts, and an exchange-side emergency kill switch.
- Run the CI pipeline and validate hosted API/model onboarding before relying on the deployment.
