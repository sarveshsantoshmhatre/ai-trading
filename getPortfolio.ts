import axios from "axios";
import type { Account } from "./accounts";

export async function getPortfolio(account: Account): Promise<{total: string, available: string}> {
    const response = await axios.get(`https://mainnet.zklighter.elliot.ai/api/v1/account?by=index&value=${account.accountIndex}`)
    return {total: response.data.accounts[0]?.collateral, available: response.data.accounts[0]?.available_balance};
}