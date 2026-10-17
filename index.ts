import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';
import { int, z } from 'zod';
import { PROMPT } from './prompt';
import { type Account } from './accounts';
import { getIndicators } from './stockData';
import { getOpenPositions } from './openPositions';
import { MARKETS } from './markets';
import { createPosition } from './createPosition';
import { cancelAllOrders } from './cancelOrder';
import { PrismaClient, ToolCallType } from './generated/prisma/client';
import { getPortfolio } from './getPortfolio';
const prisma = new PrismaClient();

export const invokeAgent = async (account: Account) => {
  const openrouter = createOpenRouter({
    apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
  });

  let ALL_INDICATOR_DATA = "";
  const indicators = await Promise.all(Object.keys(MARKETS).map(async marketSlug => {
    const intradayIndicators = await getIndicators("5m", MARKETS[marketSlug].marketId);
    const longTermIndicators = await getIndicators("4h", MARKETS[marketSlug].marketId);
    
    ALL_INDICATOR_DATA = ALL_INDICATOR_DATA + `
    MARKET - ${marketSlug}
    Intraday (5m candles) (oldest → latest):
    Mid prices - [${intradayIndicators.midPrices.join(",")}]
    EMA20 - [${intradayIndicators.ema20s.join(",")}]
    MACD - [${intradayIndicators.macd.join(",")}]

    Long Term (4h candles) (oldest → latest):
    Mid prices - [${longTermIndicators.midPrices.join(",")}]
    EMA20 - [${longTermIndicators.ema20s.join(",")}]
    MACD - [${longTermIndicators.macd.join(",")}]

    `
  }))
  
  const portfolio = await getPortfolio(account);

  const openPositions = await getOpenPositions(account.apiKey, account.accountIndex);
  const modelInvocation = await prisma.invocations.create({
    data: {
      modelId: account.id,
      response: "",
    },
  });
  const enrichedPrompt = PROMPT.replace("{{INVOKATION_TIMES}}", account.invocationCount.toString())
  .replace("{{OPEN_POSITIONS}}", openPositions?.map((position) => `${position.symbol} ${position.position} ${position.sign}`).join(", ") ?? "")
  .replace("{{PORTFOLIO_VALUE}}", `$${portfolio.total}`)
  .replace("{{ALL_INDICATOR_DATA}}", ALL_INDICATOR_DATA)
  .replace("{{AVAILABLE_CASH}}", `$${portfolio.available}`)
  .replace("{{CURRENT_ACCOUNT_VALUE}}", `$${portfolio.total}`)
  .replace("{{CURRENT_ACCOUNT_POSITIONS}}", JSON.stringify(openPositions))

  console.log(enrichedPrompt)

  const response = streamText({
    model: openrouter(account.modelName),
    prompt: enrichedPrompt,
    tools: {
      createPosition: {
        description: 'Open a position in the given market',
        inputSchema: z.object({
          symbol: z.enum(Object.keys(MARKETS)).describe('The symbol to open the position at'),
          side: z.enum(["LONG", "SHORT"]),
          quantity: z.number().describe('The quantity of the position to open.'),
        }),
        execute: async ({ symbol, side, quantity }) => {
          // Do the opposite of what the AI infers
          side = side === "LONG" ? "SHORT" : "LONG";
          await createPosition(account, symbol, side, quantity);
          await prisma.toolCalls.create({
            data: {
              invocationId: modelInvocation.id,
              toolCallType: ToolCallType.CREATE_POSITION,
              metadata: JSON.stringify({ symbol, side, quantity }),
            },
          });
          return `Position opened successfully for ${quantity} ${symbol}`;
        },
      },
      closeAllPosition: {
        description: 'Close all the currently open positions',
        inputSchema: z.object({}),
        execute: async () => {
          await cancelAllOrders(account);
          await prisma.toolCalls.create({
            data: {
              invocationId: modelInvocation.id,
              toolCallType: ToolCallType.CLOSE_POSITION,
              metadata: "",
            },
          });
          console.log(`All positions closed successfully`);
          return `All positions closed successfully`;
        },
      },
    },
  });

  await response.consumeStream();
  await prisma.models.update({
    where: { id: account.id },
    data: { invocationCount: { increment: 1 } },
  });
  await prisma.invocations.update({
    where: { id: modelInvocation.id },
    data: { response: (await response.text).trim() },
  });
  return response.text;
};

async function main() {
    const models = await prisma.models.findMany();

    for (const model of models) {
        await invokeAgent({
            apiKey: model.lighterApiKey,
            modelName: model.openRoutermodelName,
            name: model.name,
            invocationCount: model.invocationCount,
            id: model.id,
            accountIndex: model.accountIndex
        });
    }
}

setInterval(() => {
    main()
}, 1000 * 60 * 5);

main()