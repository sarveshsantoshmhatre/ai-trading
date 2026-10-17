import { getPortfolio } from "./getPortfolio";
import { getIndicators } from "./stockData";
import { MARKETS } from "./markets";
import { PrismaClient } from "./generated/prisma/client";
import { getPaperPortfolio, isPaperMode } from "./paperTrading";

const prisma = new PrismaClient();
const TRACK_INTERVAL_MS = Math.max(60_000, Number(process.env.PORTFOLIO_TRACK_INTERVAL_MS ?? "120000"));

async function trackPortfolioOnce() {
  // The tracker never needs API keys; exclude credential columns from all queries.
  const models = await prisma.models.findMany({
    select: { id: true, name: true, openRoutermodelName: true, invocationCount: true, accountIndex: true },
  });
  const paperMode = isPaperMode();
  let paperPrices: Record<string, number> = {};

  if (paperMode) {
    const marketPrices = await Promise.all(Object.entries(MARKETS).map(async ([symbol, market]) => {
      const indicators = await getIndicators("5m", market.marketId);
      const price = Number(indicators.midPrices.at(-1));
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error("Missing valid mark price for " + symbol);
      }
      return [symbol, price] as const;
    }));
    paperPrices = Object.fromEntries(marketPrices);
  }

  for (const model of models) {
    try {
      const portfolio = paperMode
        ? await getPaperPortfolio(prisma, model.id, paperPrices)
        : await getPortfolio({
            apiKey: "",
            modelName: model.openRoutermodelName,
            name: model.name,
            invocationCount: model.invocationCount,
            id: model.id,
            accountIndex: model.accountIndex,
          });
      await prisma.portfolioSize.create({
        data: {
          modelId: model.id,
          netPortfolio: portfolio.total,
        },
      });
    } catch (error) {
      console.error("Portfolio tracking failed for model " + model.name + ":", error);
    }
  }
}

async function runPortfolioTracker() {
  while (true) {
    const startedAt = Date.now();
    try {
      await trackPortfolioOnce();
    } catch (error) {
      console.error("Portfolio tracking cycle failed:", error);
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, TRACK_INTERVAL_MS - (Date.now() - startedAt))),
    );
  }
}

void runPortfolioTracker();
