# Free paper-testing deployment

## Selected architecture

- **Render Free Web Service**: serves the existing React dashboard and Express API from one Docker container. It may sleep after inactivity; the first dashboard request can take about a minute to wake it.
- **Supabase Free Postgres**: persistent database for models, invocations, paper positions, and portfolio snapshots. Supabase free projects can pause after a week of low activity; the scheduled paper workflow is designed to keep the database active.
- **GitHub Actions**: runs a one-shot paper cycle every four hours, and can also be started manually. This replaces an always-on worker and avoids a paid background service.
- **OpenRouter**: model inference is an external dependency. Hosting can be $0, but inference is only $0 if the chosen model/provider offers free usage and stays within its quota.

This stack avoids using Vercel Functions for an always-running loop (serverless functions have execution time limits) and avoids Render's free Postgres, which expires after 30 days. It does not provide production-grade uptime or guaranteed real-time execution.

## Deploy

1. Merge the paper-first deployment PR to the repository's default branch only after reviewing it. GitHub scheduled workflows run from the default branch.
2. Create a Supabase project on the Free plan. Copy its Postgres connection string. Prefer the Supavisor session pooler if the environment cannot connect to the direct database host; use the connection format recommended in the Supabase dashboard for Prisma.
3. In GitHub repository **Settings → Secrets and variables → Actions**, add:
   - `DATABASE_URL`: Supabase Postgres connection string
   - `OPENROUTER_API_KEY`: key for the selected model provider
4. In Render, choose **New → Blueprint**, select this repository and the default branch, and let it read `render.yaml`. The free web service uses the Dockerfile and serves both dashboard and API from one origin.
5. In the Render service's protected environment variables, set:
   - `DATABASE_URL`: same Supabase connection string
   - `DASHBOARD_PASSWORD`: strong unique password
   - `DASHBOARD_SESSION_SECRET`: at least 32 random characters; generate with `openssl rand -base64 48`
   - `OPENROUTER_API_KEY`: key for the model provider
   - keep `TRADING_MODE=paper` and `TRADING_ENABLED=false`
6. Wait for the Render health check `/healthz` to pass. Open the service URL, log in, and add a model using its OpenRouter model ID. Select a provider/model that explicitly offers free inference if you need the total bill to remain $0.
7. In GitHub Actions, open **Paper Trading Cycle → Run workflow** for the first paper run. Inspect the run logs, then check the dashboard's invocations and performance charts. Subsequent cycles are scheduled every four hours.
8. Leave the engine in paper mode. Do not add exchange credentials, change workflow variables, or enable live order flags.

## Free-tier constraints

- Render Free web services sleep after 15 minutes without inbound traffic, have ephemeral filesystems, and can restart. All persistent data is stored in Supabase.
- Supabase Free Postgres is limited to 500 MB and may pause after seven days of low activity.
- GitHub scheduled workflows can be delayed and are not a real-time scheduler. The four-hour schedule is for paper experiments, not production trading.
- GitHub Actions has monthly usage limits for private repositories.
- OpenRouter usage may cost money depending on the model/provider. Check provider pricing before running.
- There are no exchange keys in the paper workflow. The one-shot runner rejects any mode other than `paper`.
