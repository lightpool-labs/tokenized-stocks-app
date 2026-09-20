import { API_URL } from "@/lib/api";
import type { Eip712Payload } from "@/lib/wallet";

const CLOB_INDEX_URL =
  process.env.NEXT_PUBLIC_CLOB_INDEX_URL ?? "http://127.0.0.1:3002";

export type BridgeToken = {
  symbol: string;
  evm: string;
  lp: string;
  inbound: string;
};

export type BridgeConfig = {
  evm_chain_id: number;
  evm_rpc: string;
  evm_bridge: string;
  tokens: BridgeToken[];
};

export type PreparedTx = {
  digest_hex: string;
  unsigned_tx_hex: string;
  eip712: Eip712Payload;
  auth_scheme?: string | null;
};

export type BalanceEntry = {
  token: string;
  symbol: string;
  total: string;
  locked: string;
  available: string;
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

export async function getBridge(): Promise<BridgeConfig> {
  const res = await fetch(`${API_URL}/bridge`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function prepareAgent(
  user: string,
  agent: string,
): Promise<PreparedTx> {
  const res = await fetch(`${API_URL}/agent/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, agent }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function submitAgent(
  unsignedTxHex: string,
  signature: string,
): Promise<{ digest: string; status: string }> {
  const res = await fetch(`${API_URL}/agent/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      unsigned_tx_hex: unsignedTxHex,
      signature,
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function prepareWithdraw(body: {
  user: string;
  token: string;
  amount: string;
  inbound: string;
  foreign_recipient: string;
}): Promise<PreparedTx> {
  const res = await fetch(`${API_URL}/withdraw/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function submitWithdraw(
  unsignedTxHex: string,
  signature: string,
): Promise<{ digest: string; status: string }> {
  const res = await fetch(`${API_URL}/withdraw/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      unsigned_tx_hex: unsignedTxHex,
      signature,
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function preparePlaceOrder(body: {
  user: string;
  agent: string;
  spot_market: string;
  base_token: string;
  quote_token: string;
  side: string;
  size: string;
  price?: string;
  order_type: string;
}): Promise<PreparedTx> {
  const res = await fetch(`${API_URL}/orders/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function submitPlaceOrder(
  unsignedTxHex: string,
  signature: string,
  authScheme = "native",
): Promise<{ digest: string; status: string }> {
  const res = await fetch(`${API_URL}/orders/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      unsigned_tx_hex: unsignedTxHex,
      signature,
      auth_scheme: authScheme,
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function prepareCancelOrder(body: {
  user: string;
  agent: string;
  spot_market: string;
  chain_order_id: string;
}): Promise<PreparedTx> {
  const res = await fetch(`${API_URL}/orders/cancel/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function submitCancelOrder(
  unsignedTxHex: string,
  signature: string,
  authScheme = "native",
): Promise<{ digest: string; status: string }> {
  const res = await fetch(`${API_URL}/orders/cancel/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      unsigned_tx_hex: unsignedTxHex,
      signature,
      auth_scheme: authScheme,
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchBalances(
  address: string,
  tokens: BridgeToken[],
): Promise<BalanceEntry[]> {
  const res = await fetch(
    `${CLOB_INDEX_URL}/api/accounts/${encodeURIComponent(address)}/balances`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokens: tokens.map((token) => ({
          symbol: token.symbol,
          address: token.lp,
        })),
      }),
    },
  );
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
