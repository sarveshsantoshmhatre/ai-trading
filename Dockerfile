FROM oven/bun:1 AS build
WORKDIR /app
# Prisma config reads DATABASE_URL during client generation; no live database is accessed here.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run db:generate
RUN cd frontend && bun install --frozen-lockfile && bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app
COPY --from=build /app /app

ENV NODE_ENV=production
ENV TRADING_MODE=paper
ENV TRADING_ENABLED=false
EXPOSE 3000

# One free web service hosts the dashboard and API. The paper engine runs as a
# scheduled, one-shot GitHub Actions job instead of an always-on worker.
CMD ["bun", "run", "start:api"]
