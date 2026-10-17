import type { Candlestick } from "./lighter-sdk-ts/generated";

/** EMA seeded with the SMA of the first period observations. */
export function getEma(prices: number[], period: number): number[] {
  if (!Number.isInteger(period) || period <= 0) throw new Error("EMA period must be a positive integer");
  if (prices.length < period) throw new Error("Not enough prices provided");
  if (prices.some((price) => !Number.isFinite(price) || price <= 0)) {
    throw new Error("EMA prices must be positive finite numbers");
  }
  const multiplier = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += prices[i]!;
  seed /= period;
  const emas = [seed];
  for (let i = period; i < prices.length; i++) {
    emas.push(emas[emas.length - 1]! * (1 - multiplier) + prices[i]! * multiplier);
  }
  return emas;
}

/** Candle body midpoint (average of open and close), not a bid/ask midpoint. */
export function getMidPrices(candlesticks: Candlestick[]) {
  return candlesticks.map(({ open, close }) => {
    const price = (Number(open) + Number(close)) / 2;
    if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid candle open/close price");
    return Number(price.toFixed(8));
  });
}

/** MACD line = EMA(12) - EMA(26), aligned on trailing observations. */
export function getMacd(prices: number[]) {
  const ema26 = getEma(prices, 26);
  const ema12 = getEma(prices, 12).slice(-ema26.length);
  if (ema12.length !== ema26.length) throw new Error("MACD EMA alignment failed");
  return ema12.map((value, index) => value - ema26[index]!);
}
