FROM oven/bun:1 AS build
WORKDIR /app

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

# Railway's dashboard/API service uses the default command. Override the start
# command to "bun run start" only for a separate paper-engine service.
CMD ["bun", "run", "start:api"]
