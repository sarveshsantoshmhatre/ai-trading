import { getEma, getMacd, getMidPrices } from "./indicators";
import { CandlestickApi, IsomorphicFetchHttpLibrary, ServerConfiguration } from "./lighter-sdk-ts/generated";

const BASE_URL = "https://mainnet.zklighter.elliot.ai";
const klinesApi = new CandlestickApi({
  baseServer: new ServerConfiguration<{}>(BASE_URL, {}),
  httpApi: new IsomorphicFetchHttpLibrary(),
  middleware: [],
  authMethods: {},
});

export async function getIndicators(
  duration: "5m" | "4h",
  marketId: number,
): Promise<{ midPrices: number[]; macd: number[]; ema20s: number[] }> {
  const hours = duration === "5m" ? 6 : 24 * 14;
  const response = await klinesApi.candlesticks(
    marketId, duration, Date.now() - 60 * 60_000 * hours, Date.now(), 50, false,
  );
  const candles = response.candlesticks ?? [];
  if (candles.length < 26) {
    throw new Error("Insufficient " + duration + " candles for market " + marketId +
      ": received " + candles.length + ", need at least 26");
  }
  const ordered = [...candles].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const prices = getMidPrices(ordered);
  const rawTimestamp = Number(ordered.at(-1)?.timestamp);
  // Some exchange APIs express candle timestamps in seconds and others in milliseconds.
  const latestTimestampMs = rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
  const staleAfterMs = (duration === "5m" ? 15 : 12 * 60) * 60_000;
  if (!Number.isFinite(latestTimestampMs) || latestTimestampMs <= 0 || Date.now() - latestTimestampMs > staleAfterMs) {
    throw new Error("Stale candle data for market " + marketId + " (" + duration + ")");
  }
  const macd = getMacd(prices);
  const ema20 = getEma(prices, 20);
  return {
    midPrices: prices.slice(-10).map((value) => Number(value.toFixed(8))),
    ema20s: ema20.slice(-10).map((value) => Number(value.toFixed(8))),
    macd: macd.slice(-10).map((value) => Number(value.toFixed(8))),
  };
}
