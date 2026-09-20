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

export function isOpenStatus(status: string): boolean {
  return OPEN_STATUSES.has(status.trim().toLowerCase());
}

export function isHistoryStatus(status: string): boolean {
  return HISTORY_STATUSES.has(status.trim().toLowerCase());
}

export async function fetchUserOrders(
  userAddress: string,
): Promise<ListedOrder[]> {
  const res = await fetch(
    `${CLOB_INDEX_URL}/api/orders?user_address=${encodeURIComponent(userAddress)}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `orders HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<ListedOrder[]>;
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
  const spot = message.spot_market ?? "";
  const chain = message.chain_order_id ?? "";
  return {
    id: `${chain}:${message.block_num ?? 0}:${message.fill_amount}:${message.price ?? ""}`,
    order_id: message.order_id,
    chain_order_id: chain,
    spot_market: spot,
    market_slug: message.market_slug,
    side: message.side ?? "—",
    price: message.price ?? "—",
    size: message.fill_amount,
    fee: "—",
    time: new Date().toISOString(),
    is_fully_filled: message.is_fully_filled,
  };
}

export function subscribeUserOrders(
  userAddress: string,
  handlers: {
    onOrders: (orders: ListedOrder[]) => void;
    onTrades: (trades: TradeFill[]) => void;
    onError?: (error: Error) => void;
  },
): () => void {
  let closed = false;
  let orders: ListedOrder[] = [];
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
      handlers.onOrders(orders);
      handlers.onTrades(trades);
    });
  }

  async function loadSnapshot() {
    try {
      orders = await fetchUserOrders(userAddress);
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
        if (order) {
          orders = upsertOrder(orders, order);
          schedule();
        }
        return;
      }

      if (payload.type === "trade") {
        const fill = tradeFromWs(payload as TradeWsMessage);
        if (fill && !trades.some((item) => item.id === fill.id)) {
          trades = [fill, ...trades];
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
