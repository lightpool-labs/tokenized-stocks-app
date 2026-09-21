"use client";

import { useEffect, useMemo, useState } from "react";
import type { Market } from "@/lib/api";
import { useWallet, type BalanceRow } from "@/components/WalletProvider";
import { FundDialog } from "@/components/FundDialog";
import {
  fetchBookSnapshot,
  subscribeOrderBook,
  type BookResponse,
} from "@/lib/orderbook";
import { parseAmount6 } from "@/lib/wallet";

type OrderTicketProps = {
  pair: string;
  selected: Market | null;
};

type OrderType = "market" | "limit";

function parseBalance(raw: string): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function formatSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const fixed = value.toFixed(6).replace(/\.?0+$/, "");
  return fixed === "" ? "0" : fixed;
}

/** Worst-price bound for market orders (tick 0.01); buy pads up, sell pads down. */
function marketBoundFromMid(mid: number, side: "buy" | "sell"): string {
  const slipped = side === "buy" ? mid * 1.01 : mid * 0.99;
  const cents = Math.max(1, Math.round(slipped * 100));
  return (cents / 100).toFixed(2);
}

function availableForSide(
  balances: BalanceRow[],
  side: "buy" | "sell",
  baseSymbol: string,
): { symbol: string; available: number; label: string } {
  const symbol = side === "buy" ? "USDT" : baseSymbol;
  const row = balances.find((item) => item.symbol === symbol);
  const available = parseBalance(row?.available ?? "0");
  return {
    symbol,
    available,
    label: `${formatSize(available) || "0"} ${symbol}`,
  };
}

/** Book prices are cents (same as OrderBookPanel); return human USDT dollars. */
function centsToDollars(raw: string): number | null {
  const cents = Number.parseFloat(raw);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return cents / 100;
}

/** Mid = (best bid + best ask) / 2 in dollars; fall back to one side or last trade. */
function midFromBook(book: BookResponse): number | null {
  const bid = centsToDollars(book.bids[0]?.price ?? "");
  const ask = centsToDollars(book.asks[0]?.price ?? "");
  if (bid !== null && ask !== null) {
    return (bid + ask) / 2;
  }
  if (bid !== null) return bid;
  if (ask !== null) return ask;
  return centsToDollars(book.last_trade_price ?? "");
}

/** Max base size for the percentage slider. */
function maxBaseSize(
  side: "buy" | "sell",
  available: { available: number },
  price: string,
  midPrice: number | null,
): number {
  if (side === "sell") return available.available;
  const typed = Number.parseFloat(price);
  const px =
    Number.isFinite(typed) && typed > 0
      ? typed
      : midPrice !== null && midPrice > 0
        ? midPrice
        : 0;
  if (px > 0) return available.available / px;
  return 0;
}

export function OrderTicket({ pair, selected }: OrderTicketProps) {
  const [orderType, setOrderType] = useState<OrderType>("limit");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [pct, setPct] = useState(0);
  const [midPrice, setMidPrice] = useState<number | null>(null);
  const [fundKind, setFundKind] = useState<"deposit" | "withdraw" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    busy,
    balances,
    tradingEnabled,
    enableTrading,
    placeOrder,
  } = useWallet();

  const baseSymbol = selected?.symbol ?? pair.split("/")[0] ?? "—";
  const quoteSymbol = "USDT";
  const available = useMemo(
    () => availableForSide(balances, side, baseSymbol),
    [balances, side, baseSymbol],
  );
  const maxBase = useMemo(
    () => maxBaseSize(side, available, price, midPrice),
    [side, available, price, midPrice],
  );

  useEffect(() => {
    const spotMarket = selected?.spot_market?.trim();
    if (!spotMarket) {
      setMidPrice(null);
      return;
    }

    let cancelled = false;
    void fetchBookSnapshot(spotMarket, 1)
      .then((book) => {
        if (!cancelled) setMidPrice(midFromBook(book));
      })
      .catch(() => {
        if (!cancelled) setMidPrice(null);
      });

    const unsubscribe = subscribeOrderBook(spotMarket, 1, {
      onBook: (book) => {
        if (!cancelled) setMidPrice(midFromBook(book));
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [selected?.spot_market]);

  useEffect(() => {
    if (pct <= 0) return;
    if (maxBase <= 0) return;
    setSize(formatSize((maxBase * pct) / 100));
  }, [maxBase, pct]);

  function applyPct(nextPct: number) {
    const clamped = Math.max(0, Math.min(100, nextPct));
    setPct(clamped);
    if (maxBase <= 0) {
      setSize("");
      return;
    }
    setSize(formatSize((maxBase * clamped) / 100));
  }

  function onSizeChange(raw: string) {
    setSize(raw);
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || maxBase <= 0) {
      setPct(0);
      return;
    }
    setPct(Math.max(0, Math.min(100, (value / maxBase) * 100)));
  }

  async function onPrimary() {
    setStatus(null);
    setError(null);
    try {
      if (!tradingEnabled) {
        await enableTrading();
        setStatus("Trading enabled");
        return;
      }
      if (!selected) {
        throw new Error("Select a market first");
      }
      parseAmount6(size.trim());
      let limitPrice: string | undefined;
      if (orderType === "limit") {
        if (!price.trim()) {
          throw new Error("Enter a price");
        }
        parseAmount6(price.trim());
        limitPrice = price.trim();
      } else {
        if (midPrice === null || midPrice <= 0) {
          throw new Error("Wait for book mid before placing a market order");
        }
        limitPrice = marketBoundFromMid(midPrice, side);
        parseAmount6(limitPrice);
      }
      await placeOrder({
        spot_market: selected.spot_market,
        base_token: selected.base_token,
        quote_token: selected.quote_token,
        side,
        size: size.trim(),
        price: limitPrice,
        order_type: orderType,
      });
      setStatus(`${side === "buy" ? "Buy" : "Sell"} submitted`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  const primaryLabel = !tradingEnabled
    ? "Enable trading"
    : `${side === "buy" ? "Buy" : "Sell"} ${baseSymbol}`;

  return (
    <aside className="ticket-column">
      <div className="ticket-order">
        <div className="order-type-tabs">
          <button
            type="button"
            className={orderType === "market" ? "active" : ""}
            onClick={() => setOrderType("market")}
          >
            Market
          </button>
          <button
            type="button"
            className={orderType === "limit" ? "active" : ""}
            onClick={() => setOrderType("limit")}
          >
            Limit
          </button>
        </div>

        <div className="ticket-order-body">
        <div className="side-toggle">
          <button
            type="button"
            className={`buy ${side === "buy" ? "active" : ""}`}
            onClick={() => setSide("buy")}
          >
            Buy
          </button>
          <button
            type="button"
            className={`sell ${side === "sell" ? "active" : ""}`}
            onClick={() => setSide("sell")}
          >
            Sell
          </button>
        </div>

        <div className="available-line">
          <span>Available</span>
          <span className="available-value">{available.label}</span>
        </div>

        <div className="field">
          <label htmlFor="size">Size</label>
          <div className="size-row">
            <input
              id="size"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={size}
              onChange={(event) => onSizeChange(event.target.value)}
            />
            <span className="size-unit">{baseSymbol}</span>
          </div>
        </div>

        <div className="size-slider">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(pct)}
            onChange={(event) => applyPct(Number(event.target.value))}
            aria-label="Size percentage of available"
          />
          <div className="size-slider-marks">
            {[0, 25, 50, 75, 100].map((mark) => (
              <button
                key={mark}
                type="button"
                className={Math.round(pct) === mark ? "active" : ""}
                onClick={() => applyPct(mark)}
              >
                {mark}%
              </button>
            ))}
          </div>
        </div>

        {orderType === "limit" ? (
          <div className="field">
            <label htmlFor="price">Price</label>
            <div className="size-row">
              <input
                id="price"
                type="text"
                inputMode="decimal"
                placeholder={
                  midPrice !== null ? formatSize(midPrice) || "0.00" : "0.00"
                }
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
              <span className="size-unit">{quoteSymbol}</span>
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="price-market">Price</label>
            <input id="price-market" type="text" value="Market" disabled />
          </div>
        )}

        <div className="ticket-order-spacer" />

        <button
          type="button"
          className={`submit-btn ${side === "sell" && tradingEnabled ? "sell" : "buy"}`}
          disabled={busy}
          onClick={() => {
            void onPrimary();
          }}
        >
          {busy ? "Working…" : primaryLabel}
        </button>
        {status ? <p className="fund-status">{status}</p> : null}
        {error ? <p className="fund-status error">{error}</p> : null}
        </div>
      </div>

      <div className="ticket-fund">
        <div className="fund-actions">
          <button
            type="button"
            className="fund-deposit"
            disabled={busy}
            onClick={() => setFundKind("deposit")}
          >
            Deposit
          </button>
          <button
            type="button"
            className="fund-withdraw"
            disabled={busy}
            onClick={() => setFundKind("withdraw")}
          >
            Withdraw
          </button>
        </div>
      </div>

      {fundKind ? (
        <FundDialog kind={fundKind} onClose={() => setFundKind(null)} />
      ) : null}
    </aside>
  );
}
