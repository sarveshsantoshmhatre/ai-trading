import { getEma, getMacd, getMidPrices } from "./indicators";
import type { Candlestick } from "./lighter-sdk-ts/generated";

const BASE_URL = "https://mainnet.zklighter.elliot.ai/api/v1";

type LighterCandleResponse = {
  code?: number;
  r?: string;
  c?: Array<{
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v?: number;
    V?: number;
    i?: number;
  }>;
};

export async function getIndicators(
  duration: "5m" | "4h",
  marketId: number,
): Promise<{ midPrices: number[]; macd: number[]; ema20s: number[] }> {
  // Lighter's public endpoint is /api/v1/candles (not /candlesticks).
  // Its time query parameters are Unix seconds, while candle timestamps are ms.
  const nowMs = Date.now();
  const hours = duration === "5m" ? 6 : 24 * 14;
  const params = new URLSearchParams({
    market_id: String(marketId),
    resolution: duration,
    start_timestamp: String(Math.floor((nowMs - 60 * 60_000 * hours) / 1000)),
    end_timestamp: String(Math.floor(nowMs / 1000)),
    count_back: "50",
  });
  const response = await fetch(BASE_URL + "/candles?" + params.toString(), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error("Lighter candles API returned HTTP " + response.status +
      " for market " + marketId + " (" + duration + ")");
  }
  const payload = await response.json() as LighterCandleResponse;
  if (!Array.isArray(payload.c)) {
    throw new Error("Lighter candles API returned an invalid response for market " + marketId);
  }
  const candles: Candlestick[] = payload.c.map((candle) => ({
    timestamp: Number(candle.t),
    open: Number(candle.o),
    high: Number(candle.h),
    low: Number(candle.l),
    close: Number(candle.c),
    volume0: Number(candle.v ?? 0),
    volume1: Number(candle.V ?? 0),
    lastTradeId: Number(candle.i ?? 0),
  }));
  if (candles.length < 26) {
    throw new Error("Insufficient " + duration + " candles for market " + marketId +
      ": received " + candles.length + ", need at least 26");
  }
  const ordered = [...candles].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const prices = getMidPrices(ordered);
  const rawTimestamp = Number(ordered.at(-1)?.timestamp);
  const latestTimestampMs = rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
  const staleAfterMs = (duration === "5m" ? 15 : 12 * 60) * 60_000;
  if (!Number.isFinite(latestTimestampMs) || latestTimestampMs <= 0 || nowMs - latestTimestampMs > staleAfterMs) {
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
