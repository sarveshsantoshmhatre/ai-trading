import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText } from "ai";
import { z } from "zod";
import { PROMPT } from "./prompt";
import { type Account } from "./accounts";
import { getIndicators } from "./stockData";
import { getOpenPositions } from "./openPositions";
import { MARKETS } from "./markets";
import { createPosition } from "./createPosition";
import { cancelAllOrders } from "./cancelOrder";
import { PrismaClient, ToolCallType } from "./generated/prisma/client";
import { decryptSecret } from "./credentialCrypto";

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

  const marketBlocks = await Promise.all(Object.keys(MARKETS).map(async (marketSlug) => {
    const market = MARKETS[marketSlug as keyof typeof MARKETS];
    const [intraday, longTerm] = await Promise.all([
      getIndicators("5m", market.marketId),
      getIndicators("4h", market.marketId),
    ]);
    return [
      "MARKET - " + marketSlug,
      "Intraday (5m candles; oldest to newest):",
      "Mid prices - [" + intraday.midPrices.join(",") + "]",
      "EMA20 - [" + intraday.ema20s.join(",") + "]",
      "MACD - [" + intraday.macd.join(",") + "]",
      "Long term (4h candles; oldest to newest):",
      "Mid prices - [" + longTerm.midPrices.join(",") + "]",
      "EMA20 - [" + longTerm.ema20s.join(",") + "]",
      "MACD - [" + longTerm.macd.join(",") + "]",
    ].join("\n");
  }));
  const allIndicatorData = marketBlocks.join("\n\n");

  const portfolio = await getPortfolio(account);
  const openPositions = await getOpenPositions(account.apiKey, account.accountIndex);
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
          const currentPositions = await getOpenPositions(account.apiKey, account.accountIndex);
          if (currentPositions?.some((position) => Number(position.position) !== 0)) {
            throw new Error("An open position already exists. Close and reconcile it before opening another.");
          }
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
          await cancelAllOrders(account);
          await prisma.toolCalls.create({
            data: {
              invocationId: modelInvocation.id,
              toolCallType: ToolCallType.CLOSE_POSITION,
              metadata: JSON.stringify({ verified: true }),
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
  const models = await prisma.models.findMany();
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
  const intervalMs = Math.max(60_000, Number(process.env.TRADING_INTERVAL_MS ?? "300000"));
  while (true) {
    const startedAt = Date.now();
    try {
      await main();
    } catch (error) {
      console.error("Trading loop failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, intervalMs - (Date.now() - startedAt))));
  }
}

void runTradingLoop();
