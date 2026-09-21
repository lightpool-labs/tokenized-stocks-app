const CLOB_INDEX_URL =
  process.env.NEXT_PUBLIC_CLOB_INDEX_URL ?? "http://127.0.0.1:3002";
const CLOB_INDEX_WS_URL =
  process.env.NEXT_PUBLIC_CLOB_INDEX_WS_URL ?? "ws://127.0.0.1:3002";

export type BookLevel = { price: string; size: string };

export type BookResponse = {
  sequence: number;
  bids: BookLevel[];
  asks: BookLevel[];
  last_trade_price?: string | null;
};

type OrderBookDeltaMsg = {
  type: "orderbook_delta";
  spot_market: string;
  sequence: number;
  block_num?: number;
  bids: BookLevel[];
  asks: BookLevel[];
  last_trade_price?: string | null;
  trade?: MarketTrade | null;
};

export type MarketTrade = {
  id: number;
  side: string;
  price: string;
  size: string;
  time_ms: number;
  block_num: number;
};

type OrderBookSnapshotMsg = BookResponse & {
  type: "orderbook_snapshot" | "snapshot";
  spot_market: string;
};

function comparePriceDesc(a: string, b: string): number {
  return Number.parseFloat(b) - Number.parseFloat(a);
}

function comparePriceAsc(a: string, b: string): number {
  return Number.parseFloat(a) - Number.parseFloat(b);
}

function applyLevelChanges(
  levels: BookLevel[],
  changes: BookLevel[],
  sort: (a: string, b: string) => number,
): BookLevel[] {
  const map = new Map(levels.map((level) => [level.price, level.size]));
  for (const change of changes) {
    const n = Number.parseFloat(change.size);
    if (!Number.isFinite(n) || n === 0) {
      map.delete(change.price);
    } else {
      map.set(change.price, change.size);
    }
  }
  return Array.from(map.entries())
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => sort(a.price, b.price));
}

function trimLevels(levels: BookLevel[], depth: number): BookLevel[] {
  if (depth <= 0 || levels.length <= depth) return levels;
  return levels.slice(0, depth);
}

export function applyOrderBookDelta(
  book: BookResponse,
  delta: {
    sequence: number;
    bids: BookLevel[];
    asks: BookLevel[];
    last_trade_price?: string | null;
  },
  depth = 10,
): BookResponse {
  return {
    sequence: delta.sequence,
    bids: trimLevels(
      applyLevelChanges(book.bids, delta.bids, comparePriceDesc),
      depth,
    ),
    asks: trimLevels(
      applyLevelChanges(book.asks, delta.asks, comparePriceAsc),
      depth,
    ),
    last_trade_price: delta.last_trade_price ?? book.last_trade_price,
  };
}

export async function fetchBookSnapshot(
  spotMarket: string,
  depth = 10,
): Promise<BookResponse> {
  const path = encodeURIComponent(spotMarket);
  const res = await fetch(
    `${CLOB_INDEX_URL}/api/spot/${path}/book?depth=${depth}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `book HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<BookResponse>;
}

export async function fetchMarketTrades(symbol: string): Promise<MarketTrade[]> {
  const res = await fetch(
    `${CLOB_INDEX_URL}/api/markets/${encodeURIComponent(symbol)}/trades`,
  );
  if (!res.ok) {
    throw new Error(`Trades ${res.status}`);
  }
  return res.json() as Promise<MarketTrade[]>;
}

function isSnapshotMessage(
  payload: { type?: string },
): payload is OrderBookSnapshotMsg {
  return (
    payload.type === "orderbook_snapshot" || payload.type === "snapshot"
  );
}

/**
 * GET full book, then subscribe to `orderbook_delta` on clob-index.
 * Returns an unsubscribe function (unsub + close socket).
 */
export function subscribeOrderBook(
  spotMarket: string,
  depth: number,
  handlers: {
    onBook: (book: BookResponse) => void;
    onTrade?: (trade: MarketTrade) => void;
    onError?: (error: Error) => void;
  },
): () => void {
  let closed = false;
  let currentBook: BookResponse | null = null;
  let socket: WebSocket | null = null;
  let pending = false;
  let rafId: number | null = null;

  function scheduleRender() {
    if (pending || closed || !currentBook) return;
    pending = true;
    rafId = window.requestAnimationFrame(() => {
      pending = false;
      if (!closed && currentBook) {
        handlers.onBook(currentBook);
      }
    });
  }

  function publish(book: BookResponse) {
    currentBook = {
      sequence: book.sequence,
      bids: trimLevels(book.bids, depth),
      asks: trimLevels(book.asks, depth),
      last_trade_price: book.last_trade_price,
    };
    scheduleRender();
  }

  async function start() {
    try {
      const snapshot = await fetchBookSnapshot(spotMarket, depth);
      if (closed) return;
      publish(snapshot);
    } catch (error) {
      if (!closed) {
        handlers.onError?.(
          error instanceof Error ? error : new Error("Failed to load book"),
        );
      }
    }

    if (closed) return;

    socket = new WebSocket(`${CLOB_INDEX_WS_URL}/api/ws`);
    socket.onopen = () => {
      if (closed) return;
      socket?.send(
        JSON.stringify({
          op: "subscribe",
          channel: "orderbook_delta",
          spot_market: spotMarket,
          depth,
        }),
      );
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string) as
          | OrderBookSnapshotMsg
          | OrderBookDeltaMsg
          | { type: "error"; error: string }
          | { type: string };

        if (payload.type === "error") {
          handlers.onError?.(
            new Error((payload as { error: string }).error),
          );
          return;
        }

        if (isSnapshotMessage(payload)) {
          publish({
            sequence: payload.sequence,
            bids: payload.bids,
            asks: payload.asks,
            last_trade_price: payload.last_trade_price,
          });
          return;
        }

        if (payload.type === "orderbook_delta") {
          const delta = payload as OrderBookDeltaMsg;
          if (delta.trade) {
            handlers.onTrade?.(delta.trade);
          }
          if (!currentBook) {
            currentBook = {
              sequence: delta.sequence,
              bids: [],
              asks: [],
              last_trade_price: delta.last_trade_price ?? null,
            };
          }
          publish(applyOrderBookDelta(currentBook, delta, depth));
        }
      } catch (error) {
        handlers.onError?.(
          error instanceof Error
            ? error
            : new Error("Invalid order book message"),
        );
      }
    };
    socket.onerror = () => {
      handlers.onError?.(new Error("Order book websocket error"));
    };
  }

  void start();

  return () => {
    closed = true;
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
    }
    if (socket && socket.readyState <= WebSocket.OPEN) {
      try {
        socket.send(
          JSON.stringify({
            op: "unsubscribe",
            channel: "orderbook_delta",
            spot_market: spotMarket,
          }),
        );
      } catch {
        // ignore cleanup errors
      }
      socket.close();
    }
    socket = null;
  };
}
