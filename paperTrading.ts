import { PrismaClient, ToolCallType } from "./generated/prisma/client";

export type TradeSide = "LONG" | "SHORT";
export type PaperPosition = {
  symbol: string;
  side: TradeSide;
  quantity: number;
  entryPrice: number;
  entryFeeUsd: number;
  openedAt: Date;
};
type PaperState = {
  openPosition: PaperPosition | null;
  realizedPnlUsd: number;
  totalFeesUsd: number;
};
type PaperEvent = Record<string, unknown> & { paper?: unknown; action?: unknown };

const prismaCallTypes = [ToolCallType.CREATE_POSITION, ToolCallType.CLOSE_POSITION];

export function getTradingMode(): "paper" | "live" {
  const mode = process.env.TRADING_MODE ?? "paper";
  if (mode !== "paper" && mode !== "live") {
    throw new Error('TRADING_MODE must be exactly "paper" or "live"');
  }
  return mode;
}

export function isPaperMode(): boolean {
  return getTradingMode() === "paper";
}

export function isLiveTradingAuthorized(): boolean {
  return getTradingMode() === "live" &&
    process.env.TRADING_ENABLED === "true" &&
    process.env.LIVE_TRADING_ACK === "I_ACCEPT_REAL_ORDERS";
}

export function assertLiveTradingAuthorized(): void {
  if (!isLiveTradingAuthorized()) {
    throw new Error(
      "Live orders are blocked. Set TRADING_MODE=live, TRADING_ENABLED=true, and " +
      'LIVE_TRADING_ACK=I_ACCEPT_REAL_ORDERS only after completing exchange and paper-trading validation.',
    );
  }
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePaperEvent(value: string): PaperEvent | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as PaperEvent;
    }
    return null;
  } catch {
    return null;
  }
}

async function loadPaperState(prisma: PrismaClient, modelId: string): Promise<PaperState> {
  const calls = await prisma.toolCalls.findMany({
    where: {
      invocation: { is: { modelId } },
      toolCallType: { in: prismaCallTypes },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { toolCallType: true, metadata: true, createdAt: true },
  });

  const state: PaperState = { openPosition: null, realizedPnlUsd: 0, totalFeesUsd: 0 };
  for (const call of calls) {
    const event = parsePaperEvent(call.metadata);
    if (event?.paper !== true) continue;

    if (call.toolCallType === ToolCallType.CREATE_POSITION && event.action === "OPEN") {
      if (state.openPosition) continue;
      const quantity = finitePositive(event.quantity);
      const entryPrice = finitePositive(event.fillPrice);
      const entryFeeUsd = Number(event.feeUsd);
      const symbol = typeof event.symbol === "string" ? event.symbol : "";
      const side = event.side === "LONG" || event.side === "SHORT" ? event.side : null;
      if (!quantity || !entryPrice || !Number.isFinite(entryFeeUsd) || entryFeeUsd < 0 || !symbol || !side) {
        continue;
      }
      state.openPosition = {
        symbol,
        side,
        quantity,
        entryPrice,
        entryFeeUsd,
        openedAt: call.createdAt,
      };
      state.totalFeesUsd += entryFeeUsd;
    } else if (call.toolCallType === ToolCallType.CLOSE_POSITION && event.action === "CLOSE") {
      if (!state.openPosition) continue;
      const realizedPnlUsd = Number(event.realizedPnlUsd);
      const feeUsd = Number(event.feeUsd);
      if (!Number.isFinite(realizedPnlUsd) || !Number.isFinite(feeUsd) || feeUsd < 0) continue;
      state.realizedPnlUsd += realizedPnlUsd;
      state.totalFeesUsd += feeUsd;
      state.openPosition = null;
    }
  }
  return state;
}

function validateSlippage(): number {
  const slippage = Number(process.env.MAX_ORDER_SLIPPAGE_FRACTION ?? "0.01");
  if (!Number.isFinite(slippage) || slippage <= 0 || slippage > 0.05) {
    throw new Error("MAX_ORDER_SLIPPAGE_FRACTION must be > 0 and <= 0.05");
  }
  return slippage;
}

function validatePaperFeeRate(): number {
  const rate = Number(process.env.PAPER_TRADING_FEE_RATE ?? "0.0005");
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.01) {
    throw new Error("PAPER_TRADING_FEE_RATE must be between 0 and 0.01");
  }
  return rate;
}

export async function getPaperOpenPositions(
  prisma: PrismaClient,
  modelId: string,
): Promise<Array<{ symbol: string; position: string; sign: TradeSide; unrealizedPnl: string; realizedPnl: string; liquidationPrice: string }>> {
  const state = await loadPaperState(prisma, modelId);
  if (!state.openPosition) return [];
  return [{
    symbol: state.openPosition.symbol,
    position: String(state.openPosition.quantity),
    sign: state.openPosition.side,
    unrealizedPnl: "0",
    realizedPnl: String(state.realizedPnlUsd),
    liquidationPrice: "0",
  }];
}

export async function getPaperPortfolio(
  prisma: PrismaClient,
  modelId: string,
  markPrices: Record<string, number>,
): Promise<{ total: string; available: string }> {
  const initialBalance = Number(process.env.PAPER_INITIAL_BALANCE_USD ?? "1000");
  if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
    throw new Error("PAPER_INITIAL_BALANCE_USD must be positive and finite");
  }
  const state = await loadPaperState(prisma, modelId);
  let unrealizedPnlUsd = 0;
  let reservedNotionalUsd = 0;
  if (state.openPosition) {
    const markPrice = finitePositive(markPrices[state.openPosition.symbol]);
    if (!markPrice) {
      throw new Error("Missing valid paper mark price for " + state.openPosition.symbol);
    }
    const position = state.openPosition;
    unrealizedPnlUsd = (position.side === "LONG"
      ? markPrice - position.entryPrice
      : position.entryPrice - markPrice) * position.quantity;
    reservedNotionalUsd = position.entryPrice * position.quantity;
  }
  const total = initialBalance + state.realizedPnlUsd + unrealizedPnlUsd - state.totalFeesUsd;
  const available = Math.max(0, total - reservedNotionalUsd);
  return { total: String(total), available: String(available) };
}

export async function openPaperPosition(args: {
  prisma: PrismaClient;
  invocationId: string;
  modelId: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  markPrice: number;
  maxNotionalUsd: number;
}): Promise<string> {
  const { prisma, invocationId, modelId, symbol, side, quantity, markPrice, maxNotionalUsd } = args;
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Paper quantity must be positive and finite");
  if (!Number.isFinite(markPrice) || markPrice <= 0) throw new Error("Paper mark price is invalid");
  const markNotional = quantity * markPrice;
  if (!Number.isFinite(markNotional) || markNotional > maxNotionalUsd) {
    throw new Error("Paper order notional exceeds MAX_POSITION_NOTIONAL_USD");
  }
  const state = await loadPaperState(prisma, modelId);
  if (state.openPosition) {
    throw new Error("A paper position is already open; close it before opening another");
  }
  const slippage = validateSlippage();
  const feeRate = validatePaperFeeRate();
  const fillPrice = markPrice * (side === "LONG" ? 1 + slippage : 1 - slippage);
  const feeUsd = fillPrice * quantity * feeRate;
  await prisma.toolCalls.create({
    data: {
      invocationId,
      toolCallType: ToolCallType.CREATE_POSITION,
      metadata: JSON.stringify({
        paper: true,
        action: "OPEN",
        symbol,
        side,
        quantity,
        markPrice,
        fillPrice,
        feeUsd,
        estimatedSlippageFraction: slippage,
      }),
    },
  });
  return "PAPER ONLY: simulated " + side + " " + symbol + " quantity " + quantity +
    " at estimated fill " + fillPrice.toFixed(6) + " (fee " + feeUsd.toFixed(4) +
    " USD). No exchange order was sent.";
}

export async function closePaperPosition(args: {
  prisma: PrismaClient;
  invocationId: string;
  modelId: string;
  markPrices: Record<string, number>;
}): Promise<string> {
  const { prisma, invocationId, modelId, markPrices } = args;
  const state = await loadPaperState(prisma, modelId);
  const position = state.openPosition;
  if (!position) {
    return "PAPER ONLY: no paper position is open; no exchange order was sent.";
  }
  const markPrice = finitePositive(markPrices[position.symbol]);
  if (!markPrice) throw new Error("Missing valid paper mark price for " + position.symbol);
  const slippage = validateSlippage();
  const feeRate = validatePaperFeeRate();
  const exitPrice = markPrice * (position.side === "LONG" ? 1 - slippage : 1 + slippage);
  const grossPnlUsd = (position.side === "LONG"
    ? exitPrice - position.entryPrice
    : position.entryPrice - exitPrice) * position.quantity;
  const exitFeeUsd = exitPrice * position.quantity * feeRate;
  const netTradePnlUsd = grossPnlUsd - exitFeeUsd - position.entryFeeUsd;
  await prisma.toolCalls.create({
    data: {
      invocationId,
      toolCallType: ToolCallType.CLOSE_POSITION,
      metadata: JSON.stringify({
        paper: true,
        action: "CLOSE",
        symbol: position.symbol,
        side: position.side,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        markPrice,
        exitPrice,
        realizedPnlUsd: grossPnlUsd,
        feeUsd: exitFeeUsd,
        netTradePnlUsd,
        estimatedSlippageFraction: slippage,
      }),
    },
  });
  return "PAPER ONLY: simulated close of " + position.side + " " + position.symbol +
    " at estimated fill " + exitPrice.toFixed(6) + "; estimated net trade PnL " +
    netTradePnlUsd.toFixed(4) + " USD after modeled fees. No exchange order was sent.";
}
