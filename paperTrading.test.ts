import { afterEach, describe, expect, test } from "bun:test";
import { assertLiveTradingAuthorized, getTradingMode, isLiveTradingAuthorized } from "./paperTrading";

const initialEnv = {
  TRADING_MODE: process.env.TRADING_MODE,
  TRADING_ENABLED: process.env.TRADING_ENABLED,
  LIVE_TRADING_ACK: process.env.LIVE_TRADING_ACK,
};

afterEach(() => {
  for (const key of ["TRADING_MODE", "TRADING_ENABLED", "LIVE_TRADING_ACK"] as const) {
    const value = initialEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("trading mode fails closed", () => {
  test("defaults to paper mode", () => {
    delete process.env.TRADING_MODE;
    expect(getTradingMode()).toBe("paper");
  });

  test("rejects invalid trading modes", () => {
    process.env.TRADING_MODE = "production";
    expect(() => getTradingMode()).toThrow('TRADING_MODE must be exactly "paper" or "live"');
  });

  test("never authorizes live orders without all explicit gates", () => {
    process.env.TRADING_MODE = "live";
    process.env.TRADING_ENABLED = "true";
    delete process.env.LIVE_TRADING_ACK;
    expect(isLiveTradingAuthorized()).toBe(false);
    expect(() => assertLiveTradingAuthorized()).toThrow("Live orders are blocked");
  });

  test("authorizes the code path only with all three explicit gates", () => {
    process.env.TRADING_MODE = "live";
    process.env.TRADING_ENABLED = "true";
    process.env.LIVE_TRADING_ACK = "I_ACCEPT_REAL_ORDERS";
    expect(isLiveTradingAuthorized()).toBe(true);
  });
});
