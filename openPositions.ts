import { AccountApi, ApiKeyAuthentication, IsomorphicFetchHttpLibrary, OrderApi, ServerConfiguration } from "./lighter-sdk-ts/generated";

const BASE_URL = "https://mainnet.zklighter.elliot.ai"

export async function getOpenPositions(apiKey: string, accountIndex: string) {
    const accountApi = new AccountApi({
        baseServer: new ServerConfiguration<{  }>(BASE_URL, {  }),
        httpApi: new IsomorphicFetchHttpLibrary(),
        middleware: [],
        authMethods: {
            apiKey: new ApiKeyAuthentication(apiKey)
        }
    });

    const currentOpenOrders = await accountApi.accountWithHttpInfo(
        'index',
        accountIndex
    );

    return currentOpenOrders.data.accounts[0]?.positions.map((accountPosition) => ({
        symbol: accountPosition.symbol,
        position: accountPosition.position,
        sign: accountPosition.sign == 1 ? "LONG" : "SHORT",
        unrealizedPnl: accountPosition.unrealizedPnl,
        realizedPnl: accountPosition.realizedPnl,
        liquidationPrice: accountPosition.liquidationPrice
    }));
}
