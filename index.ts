import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { stepCountIs, streamText } from "ai";
import { z } from "zod";
import { PROMPT } from "./prompt";
import { type Account } from "./accounts";
import { getIndicators } from "./stockData";
import { getOpenPositions } from "./openPositions";
import { getPortfolio } from "./getPortfolio";
import { MARKETS } from "./markets";
import { PrismaClient, ToolCallType } from "./generated/prisma/client";
import { decryptSecret } from "./credentialCrypto";
import {
  assertLiveTradingAuthorized,
  closePaperPosition,
  getPaperOpenPositions,
  getPaperPortfolio,
  getTradingMode,
  isLiveTradingAuthorized,
  isPaperMode,
  openPaperPosition,
} from "./paperTrading";

const prisma = new PrismaClient();
const MAX_POSITION_NOTIONAL_USD = Number(process.env.MAX_POSITION_NOTIONAL_USD ?? "100");
const MAX_ORDER_QUANTITY = Number(process.env.MAX_ORDER_QUANTITY ?? "1");

function validateRiskConfiguration() {
  if (!Number.isFinite(MAX_POSITION_NOTIONAL_USD) || MAX_POSITION_NOTIONAL_USD <= 0) {
    throw new Error("MAX_POSITION_NOTIONAL_USD must be a positive finite number");
  }
  if (!Number.isFinite(MAX_ORDER_QUANTITY) || MAX_ORDER_QUANTITY <= 0) {
    throw new Error("MAX_ORDER_QUANTITY must be a positive finite number");
  }
}

export const invokeAgent = async (account: Account) => {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required");
  const openrouter = createOpenRouter({ apiKey: openRouterApiKey });

  const marketData = await Promise.all(Object.keys(MARKETS).map(async (marketSlug) => {
    const market = MARKETS[marketSlug as keyof typeof MARKETS];
    const [intraday, longTerm] = await Promise.all([
      getIndicators("5m", market.marketId),
      getIndicators("4h", market.marketId),
    ]);
    const latestPrice = Number(intraday.midPrices.at(-1));
    if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
      throw new Error("Missing valid mark price for " + marketSlug);
    }
    return {
      symbol: marketSlug,
      latestPrice,
      block: [
        "MARKET - " + marketSlug,
        "Current mark price: $" + latestPrice,
        "Maximum allowed quantity at this price: " + Math.min(MAX_ORDER_QUANTITY, MAX_POSITION_NOTIONAL_USD / latestPrice).toFixed(6) + " (notional cap $" + MAX_POSITION_NOTIONAL_USD + ")",
        "Intraday (5m candles; oldest to newest):",
        "Mid prices - [" + intraday.midPrices.join(",") + "]",
        "EMA20 - [" + intraday.ema20s.join(",") + "]",
        "MACD - [" + intraday.macd.join(",") + "]",
        "Long term (4h candles; oldest to newest):",
        "Mid prices - [" + longTerm.midPrices.join(",") + "]",
        "EMA20 - [" + longTerm.ema20s.join(",") + "]",
        "MACD - [" + longTerm.macd.join(",") + "]",
      ].join("\n"),
    };
  }));
  const allIndicatorData = marketData.map((item) => item.block).join("\n\n");
  const latestPrices: Record<string, number> = Object.fromEntries(
    marketData.map((item) => [item.symbol, item.latestPrice]),
  );

  const portfolio = isPaperMode()
    ? await getPaperPortfolio(prisma, account.id, latestPrices)
    : await getPortfolio(account);
  const openPositions = isPaperMode()
    ? await getPaperOpenPositions(prisma, account.id)
    : await getOpenPositions(account.apiKey, account.accountIndex);
  const modelInvocation = await prisma.invocations.create({
    data: { modelId: account.id, response: "" },
  });

  const enrichedPrompt = PROMPT
    .replace("{{INVOKATION_TIMES}}", account.invocationCount.toString())
    .replace("{{OPEN_POSITIONS}}", openPositions?.map((position) => position.symbol + " " + position.position + " " + position.sign).join(", ") ?? "")
    .replace("{{PORTFOLIO_VALUE}}", "$" + portfolio.total)
    .replace("{{ALL_INDICATOR_DATA}}", allIndicatorData)
    .replace("{{AVAILABLE_CASH}}", "$" + portfolio.available)
    .replace("{{CURRENT_ACCOUNT_VALUE}}", "$" + portfolio.total)
    .replace("{{CURRENT_ACCOUNT_POSITIONS}}", JSON.stringify(openPositions));

  const response = streamText({
    model: openrouter(account.modelName),
    prompt: enrichedPrompt,
    stopWhen: stepCountIs(3),
    tools: {
      createPosition: {
        description: "Open a position subject to application risk limits",
        inputSchema: z.object({
          symbol: z.enum(Object.keys(MARKETS) as [string, ...string[]]),
          side: z.enum(["LONG", "SHORT"]),
          quantity: z.number().finite().positive().max(MAX_ORDER_QUANTITY),
        }),
        execute: async ({ symbol, side, quantity }) => {
          if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_ORDER_QUANTITY) {
            throw new Error("Quantity must be > 0 and <= " + MAX_ORDER_QUANTITY);
          }
          const currentPositions = isPaperMode()
            ? await getPaperOpenPositions(prisma, account.id)
            : await getOpenPositions(account.apiKey, account.accountIndex);
          if (currentPositions.some((position) => Number(position.position) !== 0)) {
            throw new Error("An open position already exists. Close and reconcile it before opening another.");
          }
          if (isPaperMode()) {
            const markPrice = latestPrices[symbol];
            if (typeof markPrice !== "number" || !Number.isFinite(markPrice) || markPrice <= 0) {
              throw new Error("Missing valid paper mark price for " + symbol);
            }
            return await openPaperPosition({
              prisma,
              invocationId: modelInvocation.id,
              modelId: account.id,
              symbol,
              side,
              quantity,
              markPrice,
              maxNotionalUsd: MAX_POSITION_NOTIONAL_USD,
            });
          }
          assertLiveTradingAuthorized();
          const { createPosition } = await import("./createPosition");
          const orderResponse = await createPosition(account, symbol, side, quantity, {
            maxNotionalUsd: MAX_POSITION_NOTIONAL_USD,
          });
          await prisma.toolCalls.create({
            data: {
              invocationId: modelInvocation.id,
              toolCallType: ToolCallType.CREATE_POSITION,
              metadata: JSON.stringify({ symbol, side, quantity, orderResponse }),
            },
          });

          // IOC submission is not a fill guarantee. Poll exchange position state
          // and fail closed if no position matching this order becomes visible.
          let observedPosition: { position: string; sign: string } | undefined;
          for (let attempt = 0; attempt < 4; attempt++) {
            if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
            const positions = await getOpenPositions(account.apiKey, account.accountIndex);
            observedPosition = positions?.find((position) =>
              position.symbol === symbol && Number(position.position) > 0 && position.sign === side
            );
            if (observedPosition) break;
          }
          if (!observedPosition) {
            throw new Error("Order was submitted but no matching open position was observed. Reconcile exchange state before retrying.");
          }
          return "Verified " + side + " position in " + symbol + "; observed size " +
            observedPosition.position + ". Requested size was " + quantity + ". Check for partial fills.";
        },
      },
      closeAllPosition: {
        description: "Close all open positions and verify the account is flat",
        inputSchema: z.object({}),
        execute: async () => {
          if (isPaperMode()) {
            return await closePaperPosition({
              prisma,
              invocationId: modelInvocation.id,
              modelId: account.id,
              markPrices: latestPrices,
            });
          }
          assertLiveTradingAuthorized();
          const { cancelAllOrders } = await import("./cancelOrder");
          await cancelAllOrders(account);
          await prisma.toolCalls.create({
            data: {
              invocationId: modelInvocation.id,
              toolCallType: ToolCallType.CLOSE_POSITION,
              metadata: JSON.stringify({ verified: true, paper: false }),
            },
          });
          return "Close orders submitted and the account was verified flat.";
        },
      },
    },
  });

  try {
    await response.consumeStream();
    const responseText = (await response.text).trim();
    const steps = await response.steps;
    const toolCalls = steps.flatMap((step) => step.toolCalls ?? []);
    console.info("Model " + account.name + ": " + steps.length + " AI step(s), " + toolCalls.length + " tool call(s).");
    if (toolCalls.length === 0) {
      console.warn("Model " + account.name + " returned analysis without invoking a trading tool; no position was opened or closed.");
    }
    await prisma.models.update({
      where: { id: account.id },
      data: { invocationCount: { increment: 1 } },
    });
    await prisma.invocations.update({
      where: { id: modelInvocation.id },
      data: { response: responseText },
    });
    return responseText;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.invocations.update({
      where: { id: modelInvocation.id },
      data: { response: "Invocation failed: " + message },
    }).catch((dbError) => console.error("Failed to record invocation error:", dbError));
    throw error;
  }
};

async function main() {
  validateRiskConfiguration();
  const mode = getTradingMode();
  if (mode === "live") assertLiveTradingAuthorized();
  if (mode === "paper") {
    // Do not even select the secret column in paper mode.
    const models = await prisma.models.findMany({
      select: { id: true, name: true, openRoutermodelName: true, invocationCount: true, accountIndex: true },
    });
    for (const model of models) {
      try {
        await invokeAgent({
          apiKey: "",
          modelName: model.openRoutermodelName,
          name: model.name,
          invocationCount: model.invocationCount,
          id: model.id,
          accountIndex: model.accountIndex,
        });
      } catch (error) {
        console.error("Paper cycle failed for model " + model.name + ":", error);
      }
    }

    // Persist a mark-to-market snapshot after each scheduled paper cycle.
    const snapshotPrices = Object.fromEntries(await Promise.all(
      Object.entries(MARKETS).map(async ([symbol, market]) => {
        const indicators = await getIndicators("5m", market.marketId);
        const price = Number(indicators.midPrices.at(-1));
        if (!Number.isFinite(price) || price <= 0) {
          throw new Error("Missing valid portfolio mark price for " + symbol);
        }
        return [symbol, price] as const;
      }),
    ));
    for (const model of models) {
      try {
        const portfolio = await getPaperPortfolio(prisma, model.id, snapshotPrices);
        await prisma.portfolioSize.create({
          data: { modelId: model.id, netPortfolio: portfolio.total },
        });
      } catch (error) {
        console.error("Paper portfolio snapshot failed for model " + model.name + ":", error);
      }
    }
    return;
  }

  // Only the explicitly authorized live path selects and decrypts exchange credentials.
  const models = await prisma.models.findMany({
    select: {
      id: true, name: true, openRoutermodelName: true, invocationCount: true,
      accountIndex: true, lighterApiKey: true,
    },
  });
  for (const model of models) {
    try {
      await invokeAgent({
        apiKey: decryptSecret(model.lighterApiKey),
        modelName: model.openRoutermodelName,
        name: model.name,
        invocationCount: model.invocationCount,
        id: model.id,
        accountIndex: model.accountIndex,
      });
    } catch (error) {
      console.error("Trading cycle failed for model " + model.name + ":", error);
    }
  }
}

async function runTradingLoop() {
  const mode = getTradingMode();
  // Paper runs hourly by default to limit third-party model API usage.
  const defaultIntervalMs = mode === "paper" ? "3600000" : "300000";
  const intervalMs = Math.max(60_000, Number(process.env.TRADING_INTERVAL_MS ?? defaultIntervalMs));
  if (mode === "paper") {
    console.warn("PAPER MODE is active. Positions are simulated in the database; no exchange orders can be sent.");
  } else if (!isLiveTradingAuthorized()) {
    console.error("Live mode is configured but not authorized. The engine will remain idle.");
  }
  while (true) {
    const startedAt = Date.now();
    if (mode === "paper" || isLiveTradingAuthorized()) {
      try {
        await main();
      } catch (error) {
        console.error("Trading loop failed:", error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, intervalMs - (Date.now() - startedAt))));
  }
}

if (process.env.PAPER_RUN_ONCE === "true") {
  // Scheduler entry point: one paper cycle, then exit. Never permit live mode here.
  if (getTradingMode() !== "paper") {
    throw new Error("Scheduled runner is paper-only; TRADING_MODE must be paper");
  }
  try {
    await main();
  } finally {
    await prisma.$disconnect();
  }
} else {
  void runTradingLoop();
}
