import { describe, expect, test } from "bun:test";
import { getEma, getMacd, getMidPrices } from "./indicators";

describe("indicator calculations", () => {
  test("EMA returns one value per input after the seed period", () => {
    expect(getEma([1, 2, 3, 4, 5], 3)).toHaveLength(3);
    expect(getEma([1, 2, 3, 4, 5], 3)[0]).toBe(2);
  });

  test("EMA rejects invalid inputs", () => {
    expect(() => getEma([1, 2], 3)).toThrow();
    expect(() => getEma([1, 0, 3], 2)).toThrow();
    expect(() => getEma([1, 2], 0)).toThrow();
  });

  test("MACD has aligned EMA output length", () => {
    expect(getMacd(Array.from({ length: 40 }, (_, i) => 100 + i))).toHaveLength(15);
  });

  test("candle body midpoint averages open and close", () => {
    expect(getMidPrices([{ open: 10, close: 14 } as any])).toEqual([12]);
  });
});
