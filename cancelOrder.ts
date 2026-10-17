import { API_KEY_INDEX, BASE_URL } from "./config";
import { NonceManagerType } from "./lighter-sdk-ts/nonce_manager";
import { SignerClient } from "./lighter-sdk-ts/signer";
import type { Account } from "./accounts";
import { MARKETS } from "./markets";
import { nextClientOrderIndex } from "./orderIndex";
import { getOpenPositions } from "./openPositions";
import { CandlestickApi, IsomorphicFetchHttpLibrary, ServerConfiguration } from "./lighter-sdk-ts/generated";

export async function cancelAllOrders(account: Account) {
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
  const openPositions = await getOpenPositions(account.apiKey, account.accountIndex);

  for (const position of openPositions ?? []) {
    const size = Math.abs(Number(position.position));
    if (!Number.isFinite(size)) throw new Error("Invalid position size for " + position.symbol);
    if (size === 0) continue;
    const market = MARKETS[position.symbol as keyof typeof MARKETS];
    if (!market) throw new Error("Unsupported open market: " + position.symbol);

    const candleData = await candleStickApi.candlesticks(
      market.marketId, "1m", Date.now() - 5 * 60_000, Date.now(), 1, false,
    );
    const latestPrice = Number(candleData.candlesticks.at(-1)?.close);
    if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
      throw new Error("No valid latest price for " + position.symbol + "; refusing to submit close order");
    }
    const closingSide = position.sign === "LONG" ? "SHORT" : "LONG";
    const slippageFraction = Number(process.env.MAX_ORDER_SLIPPAGE_FRACTION ?? "0.01");
    if (!Number.isFinite(slippageFraction) || slippageFraction <= 0 || slippageFraction > 0.05) {
      throw new Error("MAX_ORDER_SLIPPAGE_FRACTION must be > 0 and <= 0.05");
    }
    const limitPrice = closingSide === "LONG"
      ? latestPrice * (1 + slippageFraction)
      : latestPrice * (1 - slippageFraction);

    await client.createOrder({
      marketIndex: market.marketId,
      clientOrderIndex: nextClientOrderIndex(),
      baseAmount: Math.round(size * market.qtyDecimals),
      price: Math.round(limitPrice * market.priceDecimals),
      isAsk: closingSide === "SHORT",
      orderType: SignerClient.ORDER_TYPE_MARKET,
      timeInForce: SignerClient.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL,
      reduceOnly: 1,
      triggerPrice: SignerClient.NIL_TRIGGER_PRICE,
      orderExpiry: SignerClient.DEFAULT_IOC_EXPIRY,
    });
  }

  let stillOpen = (await getOpenPositions(account.apiKey, account.accountIndex) ?? [])
    .filter((position) => Number(position.position) !== 0);
  for (let attempt = 0; stillOpen.length > 0 && attempt < 4; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    stillOpen = (await getOpenPositions(account.apiKey, account.accountIndex) ?? [])
      .filter((position) => Number(position.position) !== 0);
  }
  if (stillOpen.length > 0) {
    throw new Error("Close not verified; positions remain open: " +
      stillOpen.map((position) => position.symbol + "=" + position.position).join(", "));
  }
}
