"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Market } from "@/lib/api";
import {
  fetchMarketTrades,
  subscribeOrderBook,
  type BookLevel,
  type BookResponse,
  type MarketTrade,
} from "@/lib/orderbook";

const BOOK_DISPLAY_DEPTH = 10;
const BOOK_FETCH_DEPTH = 20;

type OrderBookPanelProps = {
  market: Market | null;
};

function emptyBook(): BookResponse {
  return { sequence: 0, bids: [], asks: [], last_trade_price: null };
}

function parseNum(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatPrice(price: string): string {
  const cents = parseNum(price);
  if (!Number.isFinite(cents) || (cents === 0 && price.trim() === "")) return "—";
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSize(size: string): string {
  const n = parseNum(size);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function withCumulativeTotals(levels: BookLevel[]): Array<BookLevel & { total: number }> {
  let running = 0;
  return levels.map((level) => {
    running += parseNum(level.size);
    return { ...level, total: running };
  });
}

function MidRow({ book }: { book: BookResponse }) {
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  const last = book.last_trade_price;
  const midLabel = last
    ? formatPrice(last)
    : bestBid && bestAsk
      ? formatPrice(String((parseNum(bestBid) + parseNum(bestAsk)) / 2))
      : bestBid
        ? formatPrice(bestBid)
        : bestAsk
          ? formatPrice(bestAsk)
          : "—";

  let spread: string | null = null;
  if (bestBid && bestAsk) {
    const s = parseNum(bestAsk) - parseNum(bestBid);
    if (Number.isFinite(s) && s >= 0) {
      const mid = (parseNum(bestBid) + parseNum(bestAsk)) / 2;
      const pct = mid > 0 ? (s / mid) * 100 : 0;
      spread = `${formatPrice(String(s))} (${pct.toFixed(3)}%)`;
    }
  }

  return (
    <div className="mid-price">
      <div className="mid-price-main">{midLabel}</div>
      {spread ? <div className="mid-price-spread">Spread {spread}</div> : null}
    </div>
  );
}

type LevelFlash = { dir: "up" | "down"; id: number };

function BookRow({
  side,
  level,
  maxTotal,
  flash,
}: {
  side: "ask" | "bid";
  level: BookLevel & { total: number };
  maxTotal: number;
  flash: LevelFlash | undefined;
}) {
  const ref = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !flash) return;
    el.classList.remove("flash-up", "flash-down");
    void el.offsetWidth;
    el.classList.add(flash.dir === "up" ? "flash-up" : "flash-down");
  }, [flash]);

  const fill =
    side === "ask" ? "rgba(246, 70, 93, 0.22)" : "rgba(14, 203, 129, 0.22)";
  const pct = maxTotal > 0 ? Math.min(100, (level.total / maxTotal) * 100) : 0;

  return (
    <tr
      ref={ref}
      className="book-row"
      style={{
        backgroundImage: `linear-gradient(var(--row-flash, transparent), var(--row-flash, transparent)), linear-gradient(to right, ${fill} ${pct}%, transparent ${pct}%)`,
      }}
    >
      <td className={side}>{formatPrice(level.price)}</td>
      <td>{formatSize(level.size)}</td>
      <td>{formatSize(String(level.total))}</td>
    </tr>
  );
}

function DepthRows({
  levels,
  side,
  flashes,
}: {
  levels: Array<BookLevel & { total: number }>;
  side: "ask" | "bid";
  flashes: Record<string, LevelFlash>;
}) {
  if (levels.length === 0) {
    return (
      <tr>
        <td colSpan={3} className={`book-empty ${side}`}>
          {side === "ask" ? "Asks — empty" : "Bids — empty"}
        </td>
      </tr>
    );
  }

  const maxTotal = Math.max(...levels.map((level) => level.total), 1);

  return (
    <>
      {levels.map((level) => (
        <BookRow
          key={`${side}-${level.price}`}
          side={side}
          level={level}
          maxTotal={maxTotal}
          flash={flashes[`${side}-${level.price}`]}
        />
      ))}
    </>
  );
}

function formatTradeTime(timeMs: number): string {
  const date = new Date(timeMs);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function TradesTable({ trades }: { trades: MarketTrade[] }) {
  if (trades.length === 0) {
    return <div className="trades-empty">No trades yet</div>;
  }
  return (
    <table className="book-table trades-table">
      <thead>
        <tr>
          <th>Price</th>
          <th>Size</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((trade) => (
          <tr key={trade.id}>
            <td className={trade.side === "sell" ? "ask" : "bid"}>
              {formatPrice(trade.price)}
            </td>
            <td>{formatSize(trade.size)}</td>
            <td>{formatTradeTime(trade.time_ms)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function sizeDirection(before: string | undefined, after: string): "up" | "down" | null {
  if (before === undefined) return "up";
  const prev = parseNum(before);
  const next = parseNum(after);
  if (prev === next) return null;
  return next > prev ? "up" : "down";
}

export function OrderBookPanel({ market }: OrderBookPanelProps) {
  const [tab, setTab] = useState<"book" | "trades">("book");
  const [book, setBook] = useState<BookResponse>(emptyBook);
  const [trades, setTrades] = useState<MarketTrade[]>([]);
  const [status, setStatus] = useState<string>("Select a market");
  const [error, setError] = useState<string | null>(null);
  const [flashes, setFlashes] = useState<Record<string, LevelFlash>>({});
  const flashSeq = useRef(0);
  const prevSizes = useRef<{ bids: Map<string, string>; asks: Map<string, string> } | null>(
    null,
  );

  useEffect(() => {
    const spotMarket = market?.spot_market?.trim();
    const symbol = market?.symbol?.trim();
    if (!spotMarket) {
      setBook(emptyBook());
      setTrades([]);
      setStatus("Select a market");
      setError(null);
      return;
    }

    setBook(emptyBook());
    setTrades([]);
    setStatus("Loading…");
    setError(null);

    if (symbol) {
      void fetchMarketTrades(symbol)
        .then((rows) => setTrades(rows))
        .catch(() => setTrades([]));
    }

    const unsubscribe = subscribeOrderBook(spotMarket, BOOK_FETCH_DEPTH, {
      onBook: (next) => {
        setBook(next);
        setStatus("Live");
        setError(null);
      },
      onTrade: (trade) => {
        setTrades((current) => {
          if (current.some((row) => row.id === trade.id)) return current;
          return [trade, ...current].slice(0, 50);
        });
      },
      onError: (err) => {
        setError(err.message);
        setStatus("Error");
      },
    });

    return () => {
      unsubscribe();
    };
  }, [market?.spot_market, market?.symbol]);

  useEffect(() => {
    prevSizes.current = null;
    setFlashes({});
  }, [market?.spot_market]);

  useEffect(() => {
    const empty =
      book.sequence === 0 && book.bids.length === 0 && book.asks.length === 0;
    if (prevSizes.current === null) {
      if (empty) return;
      prevSizes.current = {
        bids: new Map(book.bids.map((level) => [level.price, level.size])),
        asks: new Map(book.asks.map((level) => [level.price, level.size])),
      };
      return;
    }

    const nextFlashes: Record<string, LevelFlash> = {};
    const collect = (side: "bid" | "ask", levels: BookLevel[], before: Map<string, string>) => {
      for (const level of levels) {
        const dir = sizeDirection(before.get(level.price), level.size);
        if (!dir) continue;
        flashSeq.current += 1;
        nextFlashes[`${side}-${level.price}`] = { dir, id: flashSeq.current };
      }
    };
    collect("bid", book.bids, prevSizes.current.bids);
    collect("ask", book.asks, prevSizes.current.asks);
    prevSizes.current = {
      bids: new Map(book.bids.map((level) => [level.price, level.size])),
      asks: new Map(book.asks.map((level) => [level.price, level.size])),
    };
    if (Object.keys(nextFlashes).length > 0) {
      setFlashes((current) => ({ ...current, ...nextFlashes }));
    }
  }, [book]);

  const asksDisplay = useMemo(() => {
    const withTotals = withCumulativeTotals(book.asks.slice(0, BOOK_DISPLAY_DEPTH));
    return [...withTotals].reverse();
  }, [book.asks]);

  const bidsDisplay = useMemo(
    () => withCumulativeTotals(book.bids.slice(0, BOOK_DISPLAY_DEPTH)),
    [book.bids],
  );

  return (
    <section className="panel orderbook-panel" title={error ?? status}>
      <div className="order-type-tabs">
        <button
          type="button"
          className={tab === "book" ? "active" : ""}
          onClick={() => setTab("book")}
        >
          Order book
        </button>
        <button
          type="button"
          className={tab === "trades" ? "active" : ""}
          onClick={() => setTab("trades")}
        >
          Trades
        </button>
      </div>
      <div className="panel-body book-body">
        {tab === "trades" ? (
          <div className="trades-body">
            <TradesTable trades={trades} />
          </div>
        ) : (
        <div className="book-split">
          <div className="book-side book-asks">
            <table className="book-table">
              <thead>
                <tr>
                  <th>Price</th>
                  <th>Size</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <DepthRows levels={asksDisplay} side="ask" flashes={flashes} />
              </tbody>
            </table>
          </div>

          <MidRow book={book} />

          <div className="book-side book-bids">
            <table className="book-table">
              <tbody>
                <DepthRows levels={bidsDisplay} side="bid" flashes={flashes} />
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
    </section>
  );
}
