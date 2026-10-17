
// @params{period} - The period for which the EMA is being calculated

import type { Candlestick } from "./lighter-sdk-ts/generated";
export function getEma(prices: number[], period: number): number[] {
    const multiplier = 2 / (period + 1);
    
    if (prices.length < period) {
        throw new Error("Not enough prices provided");
    }

    // Calculate initial SMA
    let sma = 0;
    for (let i = 0; i < period; i++) {
        sma += (prices[i] ?? 0);
    }
    sma /= period;

    const emas = [sma];
    
    // Calculate EMA for remaining prices
    for (let i = period; i < prices.length; i++) {
        const ema = (emas[emas.length - 1] ?? 0) * (1 - multiplier) + (prices[i] ?? 0) * multiplier;
        emas.push(ema);
    }
    
    return emas;
}

export function getMidPrices(candlesticks: Candlestick[]) {
    return candlesticks.map(({open, close}) => Number(((open + close) / 2).toFixed(3)));
}

// macd => ema12 = 38 points, ema26 = 24 points
export function getMacd(prices: number[]) {

    const ema26 = getEma(prices, 26); // [].length = 24
    let ema12 = getEma(prices, 12); // [].length = 38

    ema12 = ema12.slice(-ema26.length);

    console.log(ema12.length, ema26.length);
    const macd = ema12.map((_, index) => (ema12[index] ?? 0) - (ema26[index] ?? 0));
    return macd
}