const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001/api";

export type Market = {
  id: string;
  symbol: string;
  name: string;
  pair: string;
  base_token: string;
  quote_token: string;
  spot_market: string;
};

export type CashInfo = {
  cash_token: string | null;
  symbol: string;
};

export type EnsureCashResult = {
  cash_token: string;
  created: boolean;
  digest: string | null;
};

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // ignore
  }
  return `HTTP ${res.status}`;
}

export async function getCash(): Promise<CashInfo> {
  const res = await fetch(`${API_URL}/cash`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function ensureCash(): Promise<EnsureCashResult> {
  const res = await fetch(`${API_URL}/admin/ensure-cash`, { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function listMarkets(): Promise<Market[]> {
  const res = await fetch(`${API_URL}/markets`);
  if (!res.ok) throw new Error(await parseError(res));
  const body = (await res.json()) as { markets: Market[] };
  return body.markets;
}

export async function createMarket(input: {
  symbol: string;
  name: string;
}): Promise<Market> {
  const res = await fetch(`${API_URL}/admin/markets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
