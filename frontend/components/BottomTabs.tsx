"use client";

import { useMemo, useState } from "react";
import { useWallet, type BalanceRow } from "@/components/WalletProvider";
import type { Market } from "@/lib/api";
import type { ListedOrder, TradeFill } from "@/lib/userOrders";

const TABS = [
  "Balances",
  "Open orders",
  "Order history",
  "Trade history",
] as const;

type Tab = (typeof TABS)[number];

const COLUMNS: Record<Tab, string[]> = {
  Balances: ["Asset", "Available", "Locked", "Total"],
  "Open orders": ["Market", "Side", "Price", "Size", "Status", ""],
  "Order history": ["Time", "Market", "Side", "Price", "Size", "Status"],
  "Trade history": ["Time", "Market", "Side", "Price", "Size", "Fee"],
};

type BottomTabsProps = {
  markets: Market[];
};

function isZeroAmount(raw: string): boolean {
  const value = Number.parseFloat(raw);
  return !Number.isFinite(value) || value === 0;
}

function hasNonZeroBalance(row: BalanceRow): boolean {
  return !(
    isZeroAmount(row.available) &&
    isZeroAmount(row.locked) &&
    isZeroAmount(row.total)
  );
}

function marketLabel(
  markets: Market[],
  order: { spot_market?: string; market_slug?: string },
): string {
  if (order.spot_market) {
    const hit = markets.find(
      (market) =>
        market.spot_market.toLowerCase() === order.spot_market!.toLowerCase(),
    );
    if (hit) return hit.symbol;
  }
  if (order.market_slug) return order.market_slug;
  return order.spot_market ?? "—";
}

function formatPrice(raw: string): string {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return raw || "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function formatOrderTime(order: ListedOrder): string {
  if (typeof order.status_ts_ms === "number" && order.status_ts_ms > 0) {
    return formatTime(new Date(order.status_ts_ms).toISOString());
  }
  return "—";
}

export function BottomTabs({ markets }: BottomTabsProps) {
  const [tab, setTab] = useState<Tab>("Balances");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const {
    address,
    balances,
    busy,
    openOrders,
    orderHistory,
    tradeHistory,
    tradingEnabled,
    cancelOrder,
  } = useWallet();
  const columns = COLUMNS[tab];
  const visibleBalances = useMemo(
    () => balances.filter(hasNonZeroBalance),
    [balances],
  );

  async function onCancel(order: ListedOrder) {
    setCancelError(null);
    setCancellingId(order.id);
    try {
      await cancelOrder(order);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancellingId(null);
    }
  }

  let body: React.ReactNode;
  if (tab === "Balances") {
    if (address && visibleBalances.length > 0) {
      body = visibleBalances.map((row) => (
        <tr key={row.symbol}>
          <td className="data">{row.symbol}</td>
          <td className="data">{row.available}</td>
          <td className="data">{row.locked}</td>
          <td className="data">{row.total}</td>
        </tr>
      ));
    } else {
      body = (
        <tr>
          <td colSpan={columns.length}>No balances yet.</td>
        </tr>
      );
    }
  } else if (tab === "Open orders") {
    body = renderOpenOrders(
      openOrders,
      markets,
      columns.length,
      busy || !tradingEnabled,
      cancellingId,
      onCancel,
    );
  } else if (tab === "Order history") {
    body = renderOrders(orderHistory, markets, columns.length, true);
  } else {
    body = renderTrades(tradeHistory, markets, columns.length);
  }

  return (
    <section className="bottom-tabs">
      <div className="tab-headers">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            className={tab === name ? "active" : ""}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="tab-body">
        <table className="empty-table">
          <thead>
            <tr>
              {columns.map((col, index) => (
                <th key={`${col}-${index}`}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
        {tab === "Open orders" && cancelError ? (
          <p className="fund-status error">{cancelError}</p>
        ) : null}
      </div>
    </section>
  );
}

function renderOpenOrders(
  orders: ListedOrder[],
  markets: Market[],
  colSpan: number,
  disabled: boolean,
  cancellingId: string | null,
  onCancel: (order: ListedOrder) => void,
) {
  if (orders.length === 0) {
    return (
      <tr>
        <td colSpan={colSpan}>No open orders yet.</td>
      </tr>
    );
  }
  return orders.map((order) => {
    const working = cancellingId === order.id;
    return (
      <tr key={order.id}>
        <td className="data">{marketLabel(markets, order)}</td>
        <td className="data">{order.side}</td>
        <td className="data">{formatPrice(order.price)}</td>
        <td className="data">{order.size}</td>
        <td className="data">{order.status}</td>
        <td className="data order-actions">
          <button
            type="button"
            className="cancel-order-btn"
            disabled={disabled || working}
            onClick={() => onCancel(order)}
          >
            {working ? "Cancelling…" : "Cancel"}
          </button>
        </td>
      </tr>
    );
  });
}

function renderOrders(
  orders: ListedOrder[],
  markets: Market[],
  colSpan: number,
  withTime: boolean,
) {
  if (orders.length === 0) {
    return (
      <tr>
        <td colSpan={colSpan}>No order history yet.</td>
      </tr>
    );
  }
  return orders.map((order) => (
    <tr key={order.id}>
      {withTime ? <td className="data">{formatOrderTime(order)}</td> : null}
      <td className="data">{marketLabel(markets, order)}</td>
      <td className="data">{order.side}</td>
      <td className="data">{formatPrice(order.price)}</td>
      <td className="data">{order.size}</td>
      <td className="data">{order.status}</td>
    </tr>
  ));
}

function renderTrades(
  trades: TradeFill[],
  markets: Market[],
  colSpan: number,
) {
  if (trades.length === 0) {
    return (
      <tr>
        <td colSpan={colSpan}>No trade history yet.</td>
      </tr>
    );
  }
  return trades.map((trade) => (
    <tr key={trade.id}>
      <td className="data">{formatTime(trade.time)}</td>
      <td className="data">{marketLabel(markets, trade)}</td>
      <td className="data">{trade.side}</td>
      <td className="data">{formatPrice(trade.price)}</td>
      <td className="data">{trade.size}</td>
      <td className="data">{trade.fee}</td>
    </tr>
  ));
}
