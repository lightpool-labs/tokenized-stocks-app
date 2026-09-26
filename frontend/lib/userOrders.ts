const CLOB_INDEX_URL =
  process.env.NEXT_PUBLIC_CLOB_INDEX_URL ?? "http://127.0.0.1:3002";
const CLOB_INDEX_WS_URL =
  process.env.NEXT_PUBLIC_CLOB_INDEX_WS_URL ?? "ws://127.0.0.1:3002";

export type ListedOrder = {
  id: string;
  market_id?: string;
  market_slug?: string;
  question?: string;
  outcome?: string;
  side: string;
  price: string;
  size: string;
  status: string;
  chain_order_id: string;
  spot_market?: string;
  user_address?: string;
  size_raw?: number;
  filled_raw?: number;
  /** Archive time from indexer (unix ms). */
  status_ts_ms?: number;
};

export type TradeFill = {
  id: string;
  order_id: string;
  chain_order_id: string;
  spot_market: string;
  market_slug?: string;
  side: string;
  price: string;
  size: string;
  fee: string;
  time: string;
  is_fully_filled?: boolean;
};

type OrderWsMessage = {
  type: string;
  event?: string;
  user_address?: string;
  chain_order_id?: string;
  block_num?: number;
  id?: string;
  market_id?: string;
  market_slug?: string;
  question?: string;
  outcome?: string;
  side?: string;
  price?: string;
  size?: string;
  status?: string;
  spot_market?: string;
};

type TradeWsMessage = {
  type: string;
  user_address?: string;
  chain_order_id?: string;
  order_id?: string;
  market_slug?: string;
  outcome?: string;
  side?: string;
  price?: string;
  fill_amount?: string;
  remaining_amount?: string;
  is_fully_filled?: boolean;
  spot_market?: string;
  block_num?: number;
};

const OPEN_STATUSES = new Set(["open", "partial_filled"]);
const HISTORY_STATUSES = new Set([
  "filled",
  "cancelled",
  "canceled",
  "rejected",
  "failed",
]);

const TOKEN_SCALE = 1_000_000;

export function isOpenStatus(status: string): boolean {
  return OPEN_STATUSES.has(status.trim().toLowerCase());
}

export function isHistoryStatus(status: string): boolean {
  return HISTORY_STATUSES.has(status.trim().toLowerCase());
}

async function parseOrdersResponse(res: Response): Promise<ListedOrder[]> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `orders HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<ListedOrder[]>;
}

/** Live open / partial orders (hot index). */
export async function fetchOpenOrders(
  userAddress: string,
): Promise<ListedOrder[]> {
  const q = `user_address=${encodeURIComponent(userAddress)}`;
  const res = await fetch(`${CLOB_INDEX_URL}/api/orders/openOrders?${q}`, {
    cache: "no-store",
  });
  if (res.status === 404) {
    const fallback = await fetch(`${CLOB_INDEX_URL}/api/orders?${q}`, {
      cache: "no-store",
    });
    return parseOrdersResponse(fallback);
  }
  return parseOrdersResponse(res);
}

/** Terminal orders from sqlite history (filled / cancelled / …). */
export async function fetchHistoricalOrders(
  userAddress: string,
): Promise<ListedOrder[]> {
  const q = `user_address=${encodeURIComponent(userAddress)}`;
  const res = await fetch(
    `${CLOB_INDEX_URL}/api/orders/historicalOrders?${q}`,
    { cache: "no-store" },
  );
  return parseOrdersResponse(res);
}

/** @deprecated Prefer fetchOpenOrders + fetchHistoricalOrders. */
export async function fetchUserOrders(
  userAddress: string,
): Promise<ListedOrder[]> {
  return fetchOpenOrders(userAddress);
}

function formatRawAmount(raw: number): string {
  if (!Number.isFinite(raw) || raw < 0) return "—";
  const whole = Math.floor(raw / TOKEN_SCALE);
  const frac = raw % TOKEN_SCALE;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(6, "0").replace(/0+$/, "")}`;
}

function fillSizeFromOrder(order: ListedOrder): string | null {
  if (typeof order.filled_raw === "number" && order.filled_raw > 0) {
    return formatRawAmount(order.filled_raw);
  }
  const status = order.status.trim().toLowerCase();
  if (status === "filled" && order.size && order.size !== "—") {
    return order.size;
  }
  return null;
}

/** Stable fill id shared by HTTP history rows and live WS trades. */
function fillTradeId(
  chainOrderId: string,
  side: string,
  price: string,
  size: string,
): string {
  return `fill:${chainOrderId.trim().toLowerCase()}:${side}:${price}:${size}`;
}

/** Trade rows for refresh / snapshot — only from historicalOrders (filled size > 0). */
export function tradesFromHistoricalOrders(
  orders: ListedOrder[],
): TradeFill[] {
  const out: TradeFill[] = [];
  for (const order of orders) {
    const size = fillSizeFromOrder(order);
    if (!size) continue;
    const spot = order.spot_market ?? "";
    const chain = order.chain_order_id ?? "";
    const time =
      typeof order.status_ts_ms === "number" && order.status_ts_ms > 0
        ? new Date(order.status_ts_ms).toISOString()
        : "";
    out.push({
      id: fillTradeId(chain, order.side, order.price, size),
      order_id: order.id,
      chain_order_id: chain,
      spot_market: spot,
      market_slug: order.market_slug,
      side: order.side,
      price: order.price,
      size,
      fee: "—",
      time,
      is_fully_filled: order.status.trim().toLowerCase() === "filled",
    });
  }
  return out;
}

function upsertOrder(orders: ListedOrder[], next: ListedOrder): ListedOrder[] {
  const index = orders.findIndex(
    (item) =>
      item.id === next.id ||
      (item.chain_order_id &&
        item.chain_order_id === next.chain_order_id &&
        item.spot_market === next.spot_market),
  );
  if (index < 0) return [next, ...orders];
  const copy = orders.slice();
  copy[index] = { ...copy[index], ...next };
  return copy;
}

function removeOrder(orders: ListedOrder[], next: ListedOrder): ListedOrder[] {
  return orders.filter(
    (item) =>
      !(
        item.id === next.id ||
        (item.chain_order_id &&
          item.chain_order_id === next.chain_order_id &&
          item.spot_market === next.spot_market)
      ),
  );
}

function orderFromWs(message: OrderWsMessage): ListedOrder | null {
  if (!message.id || !message.side || !message.status) return null;
  return {
    id: message.id,
    market_id: message.market_id,
    market_slug: message.market_slug,
    question: message.question,
    outcome: message.outcome,
    side: message.side,
    price: message.price ?? "—",
    size: message.size ?? "—",
    status: message.status,
    chain_order_id: message.chain_order_id ?? "",
    spot_market: message.spot_market,
    user_address: message.user_address,
  };
}

function tradeFromWs(message: TradeWsMessage): TradeFill | null {
  if (!message.order_id || !message.fill_amount) return null;
  const chain = message.chain_order_id ?? "";
  const side = message.side ?? "—";
  const price = message.price ?? "—";
  const size = message.fill_amount;
  return {
    id: fillTradeId(chain, side, price, size),
    order_id: message.order_id,
    chain_order_id: chain,
    spot_market: message.spot_market ?? "",
    market_slug: message.market_slug,
    side,
    price,
    size,
    fee: "—",
    time: new Date().toISOString(),
    is_fully_filled: message.is_fully_filled,
  };
}

/** Upsert by stable fill id; keep a non-empty time when present. */
function upsertTrade(trades: TradeFill[], next: TradeFill): TradeFill[] {
  const index = trades.findIndex((item) => item.id === next.id);
  if (index < 0) return [next, ...trades];
  const prev = trades[index];
  const copy = trades.slice();
  copy[index] = {
    ...prev,
    ...next,
    time: next.time || prev.time,
  };
  return copy;
}

export type UserOrdersHandlers = {
  onOpenOrders: (orders: ListedOrder[]) => void;
  onOrderHistory: (orders: ListedOrder[]) => void;
  onTrades: (trades: TradeFill[]) => void;
  onError?: (error: Error) => void;
};

/**
 * Orders: HTTP open + historical; live WS `order` updates those lists only.
 * Trades: HTTP historical fills on snapshot; live WS `trade` only (not derived from order).
 */
export function subscribeUserOrders(
  userAddress: string,
  handlers: UserOrdersHandlers,
): () => void {
  let closed = false;
  let openOrders: ListedOrder[] = [];
  let orderHistory: ListedOrder[] = [];
  let trades: TradeFill[] = [];
  let socket: WebSocket | null = null;
  let rafId: number | null = null;
  let pending = false;

  function schedule() {
    if (pending || closed) return;
    pending = true;
    rafId = window.requestAnimationFrame(() => {
      pending = false;
      if (closed) return;
      handlers.onOpenOrders(openOrders);
      handlers.onOrderHistory(orderHistory);
      handlers.onTrades(trades);
    });
  }

  async function loadSnapshot() {
    try {
      const [open, historical] = await Promise.all([
        fetchOpenOrders(userAddress),
        fetchHistoricalOrders(userAddress),
      ]);
      if (closed) return;
      openOrders = open.filter((order) => isOpenStatus(order.status));
      orderHistory = historical.filter((order) =>
        isHistoryStatus(order.status),
      );
      // Snapshot is source of truth for past fills; keep live WS fills not yet archived.
      const fromHistory = tradesFromHistoricalOrders(orderHistory);
      const histIds = new Set(fromHistory.map((t) => t.id));
      const livePending = trades.filter((t) => !histIds.has(t.id));
      trades = [...livePending, ...fromHistory];
      schedule();
    } catch (error) {
      handlers.onError?.(
        error instanceof Error ? error : new Error("Failed to load orders"),
      );
    }
  }

  void loadSnapshot();

  socket = new WebSocket(`${CLOB_INDEX_WS_URL}/api/ws`);
  socket.onopen = () => {
    socket?.send(
      JSON.stringify({
        op: "subscribe",
        channel: "user",
        user_address: userAddress,
      }),
    );
  };
  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data as string) as
        | OrderWsMessage
        | TradeWsMessage
        | { type: "error"; error: string }
        | { type: "subscribed" | "unsubscribed" };

      if (payload.type === "error") {
        handlers.onError?.(new Error((payload as { error: string }).error));
        return;
      }
      if (payload.type === "subscribed" || payload.type === "unsubscribed") {
        return;
      }

      if (payload.type === "order") {
        const order = orderFromWs(payload as OrderWsMessage);
        if (!order) return;
        if (isOpenStatus(order.status)) {
          openOrders = upsertOrder(openOrders, order);
          orderHistory = removeOrder(orderHistory, order);
        } else if (isHistoryStatus(order.status)) {
          openOrders = removeOrder(openOrders, order);
          orderHistory = upsertOrder(orderHistory, order);
        } else {
          openOrders = upsertOrder(openOrders, order);
        }
        schedule();
        return;
      }

      if (payload.type === "trade") {
        const fill = tradeFromWs(payload as TradeWsMessage);
        if (fill) {
          trades = upsertTrade(trades, fill);
          schedule();
        }
      }
    } catch (error) {
      handlers.onError?.(
        error instanceof Error ? error : new Error("Invalid user WS message"),
      );
    }
  };
  socket.onerror = () => {
    handlers.onError?.(new Error("User orders websocket error"));
  };

  return () => {
    closed = true;
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    if (socket && socket.readyState <= WebSocket.OPEN) {
      try {
        socket.send(
          JSON.stringify({
            op: "unsubscribe",
            channel: "user",
            user_address: userAddress,
          }),
        );
      } catch {
        // ignore
      }
      socket.close();
    }
    socket = null;
  };
}

/** One-shot refresh after place/cancel (does not touch the WS). */
export async function refreshUserOrderTabs(userAddress: string): Promise<{
  openOrders: ListedOrder[];
  orderHistory: ListedOrder[];
  trades: TradeFill[];
}> {
  const [open, historical] = await Promise.all([
    fetchOpenOrders(userAddress),
    fetchHistoricalOrders(userAddress),
  ]);
  const openOrders = open.filter((order) => isOpenStatus(order.status));
  const orderHistory = historical.filter((order) =>
    isHistoryStatus(order.status),
  );
  return {
    openOrders,
    orderHistory,
    trades: tradesFromHistoricalOrders(orderHistory),
  };
}
