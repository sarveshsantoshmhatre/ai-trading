import type { Account } from "./accounts";

type ExchangeAccount = { collateral?: string | number; available_balance?: string | number };
type ExchangeAccountResponse = { accounts?: ExchangeAccount[] };

export async function getPortfolio(account: Account): Promise<{ total: string; available: string }> {
  const url = new URL("https://mainnet.zklighter.elliot.ai/api/v1/account");
  url.searchParams.set("by", "index");
  url.searchParams.set("value", account.accountIndex);

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Portfolio API returned HTTP " + response.status);
  const data = await response.json() as ExchangeAccountResponse;
  const exchangeAccount = data.accounts?.[0];
  if (!exchangeAccount) throw new Error("Portfolio API returned no account for index " + account.accountIndex);
  if (exchangeAccount.collateral == null || exchangeAccount.available_balance == null) {
    throw new Error("Portfolio API response is missing collateral or available balance");
  }
  const total = Number(exchangeAccount.collateral);
  const available = Number(exchangeAccount.available_balance);
  if (!Number.isFinite(total) || !Number.isFinite(available)) {
    throw new Error("Portfolio API returned invalid balance values");
  }
  return { total: String(total), available: String(available) };
}
