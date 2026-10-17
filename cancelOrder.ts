import { API_KEY_INDEX, BASE_URL } from "./config";
import { NonceManagerType } from "./lighter-sdk-ts/nonce_manager";
import { SignerClient } from "./lighter-sdk-ts/signer";
import type { Account } from "./accounts";
import { MARKETS } from "./markets";
import { getOpenPositions } from "./openPositions";
import { CandlestickApi, IsomorphicFetchHttpLibrary, ServerConfiguration } from "./lighter-sdk-ts/generated";

export async function cancelAllOrders(account: Account) {
    const client = await SignerClient.create({
        url: BASE_URL,
        privateKey: account.apiKey,
        apiKeyIndex: API_KEY_INDEX,
        accountIndex: Number(account.accountIndex),
        nonceManagementType: NonceManagerType.API
    });
    const candleStickApi = new CandlestickApi({
        baseServer: new ServerConfiguration<{  }>(BASE_URL, {  }),
        httpApi: new IsomorphicFetchHttpLibrary(),
        middleware: [],
        authMethods: {}
    }); 
    const openPositions = await getOpenPositions(account.apiKey, account.accountIndex);
    openPositions?.forEach(async ({position, sign, symbol}) => {
        if (Number(position) != 0) {
            const candleStickData = await candleStickApi.candlesticks(MARKETS[symbol as keyof typeof MARKETS].marketId, '1m', Date.now() - 1000 * 60 * 5, Date.now(), 1, false);
            const latestPrice = candleStickData.candlesticks[candleStickData.candlesticks.length - 1]?.close;
            if (!latestPrice) {
                throw new Error("No latest price found");
            }
            sign = sign == "LONG" ? "SHORT" : "LONG";
            // create opposite order to close the position
            await client.createOrder({
                marketIndex: MARKETS[symbol as keyof typeof MARKETS].marketId,
                clientOrderIndex: MARKETS[symbol as keyof typeof MARKETS].clientOrderIndex,
                baseAmount: Math.abs(Number(position)) * MARKETS[symbol as keyof typeof MARKETS].qtyDecimals,
                price: (sign == "LONG" ? latestPrice * 1.01 : latestPrice * 0.99) * MARKETS[symbol as keyof typeof MARKETS].priceDecimals,
                isAsk: sign === "LONG" ? false : true,
                orderType: SignerClient.ORDER_TYPE_MARKET,
                timeInForce: SignerClient.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL,
                reduceOnly: 0,
                triggerPrice: SignerClient.NIL_TRIGGER_PRICE,
                orderExpiry: SignerClient.DEFAULT_IOC_EXPIRY,
            });
        }
    });
}