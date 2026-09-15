"use client";

import { useState } from "react";
import type { Market } from "@/lib/api";

type OrderTicketProps = {
  pair: string;
  selected: Market | null;
};

export function OrderTicket({ pair, selected }: OrderTicketProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const baseSymbol = selected?.symbol ?? pair.split("/")[0] ?? "—";

  return (
    <aside className="ticket-column">
      <div className="ticket-section">
        <h2>Order ticket</h2>
        <p className="selected-pair">{pair}</p>
        {selected && (
          <p className="ticket-meta">
            spot <code>{selected.spot_market}</code>
          </p>
        )}

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

        <div className="field">
          <label htmlFor="price">Price</label>
          <input id="price" type="text" placeholder="0.00" disabled />
        </div>
        <div className="field">
          <label htmlFor="size">Size</label>
          <input id="size" type="text" placeholder="0.00" disabled />
        </div>

        <button type="button" className={`submit-btn ${side}`} disabled>
          {side === "buy" ? "Buy" : "Sell"} {baseSymbol}
        </button>
      </div>

      <div className="ticket-section">
        <h2>Deposit / Withdraw</h2>
        <div className="fund-actions">
          <button type="button" disabled>
            Deposit
          </button>
          <button type="button" disabled>
            Withdraw
          </button>
        </div>
      </div>
    </aside>
  );
}
