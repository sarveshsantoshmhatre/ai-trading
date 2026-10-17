import { NonceManagerType } from "./lighter-sdk-ts/nonce_manager";
import { SignerClient } from "./lighter-sdk-ts/signer";
import { IsomorphicFetchHttpLibrary, ServerConfiguration, CandlestickApi } from "./lighter-sdk-ts/generated";
import type { Account } from "./accounts";
import { API_KEY_INDEX, BASE_URL } from "./config";
import { MARKETS } from "./markets";

type PositionLimits = { maxNotionalUsd: number };

export async function createPosition(
  account: Account,
  symbol: string,
  side: "LONG" | "SHORT",
  quantity: number,
  limits: PositionLimits,
) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Order quantity must be positive and finite");
  if (!Number.isFinite(limits.maxNotionalUsd) || limits.maxNotionalUsd <= 0) throw new Error("Invalid maxNotionalUsd");
  const market = MARKETS[symbol as keyof typeof MARKETS];
  if (!market) throw new Error("Unsupported market: " + symbol);

  const client = await SignerClient.create({
    url: BASE_URL,
    privateKey: account.apiKey,
    apiKeyIndex: API_KEY_INDEX,
    accountIndex: Number(account.accountIndex),
    nonceManagementType: NonceManagerType.API,
  });
  const candleStickApi = new CandlestickApi({
    baseServer: new ServerConfiguration<{}>(BASE_URL, {}),
    httpApi: new IsomorphicFetchHttpLibrary(),
    middleware: [],
    authMethods: {},
  });
  const candles = await candleStickApi.candlesticks(
    market.marketId, "1m", Date.now() - 5 * 60_000, Date.now(), 1, false,
  );
  const latestPrice = Number(candles.candlesticks.at(-1)?.close);
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) throw new Error("No valid latest market price");

  const notionalUsd = quantity * latestPrice;
  if (!Number.isFinite(notionalUsd) || notionalUsd > limits.maxNotionalUsd) {
    throw new Error("Order notional " + notionalUsd.toFixed(2) + " USD exceeds configured limit " + limits.maxNotionalUsd + " USD");
  }
  const slippageFraction = Number(process.env.MAX_ORDER_SLIPPAGE_FRACTION ?? "0.01");
  if (!Number.isFinite(slippageFraction) || slippageFraction <= 0 || slippageFraction > 0.05) {
    throw new Error("MAX_ORDER_SLIPPAGE_FRACTION must be > 0 and <= 0.05");
  }
  const limitPrice = side === "LONG"
    ? latestPrice * (1 + slippageFraction)
    : latestPrice * (1 - slippageFraction);

  // Preserve the requested direction. A LONG opens with a buy; a SHORT with a sell.
  return await client.createOrder({
    marketIndex: market.marketId,
    clientOrderIndex: market.clientOrderIndex,
    baseAmount: Math.round(quantity * market.qtyDecimals),
    price: Math.round(limitPrice * market.priceDecimals),
    isAsk: side === "SHORT",
    orderType: SignerClient.ORDER_TYPE_MARKET,
    timeInForce: SignerClient.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL,
    reduceOnly: 0,
    triggerPrice: SignerClient.NIL_TRIGGER_PRICE,
    orderExpiry: SignerClient.DEFAULT_IOC_EXPIRY,
  });
}
