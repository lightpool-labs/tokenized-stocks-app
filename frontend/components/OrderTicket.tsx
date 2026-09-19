"use client";

import { useState } from "react";
import type { Market } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import { parseAmount6 } from "@/lib/wallet";

type OrderTicketProps = {
  pair: string;
  selected: Market | null;
};

export function OrderTicket({ pair, selected }: OrderTicketProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, deposit, withdraw } = useWallet();
  const baseSymbol = selected?.symbol ?? pair.split("/")[0] ?? "—";

  async function onDeposit() {
    setStatus(null);
    setError(null);
    try {
      parseAmount6(amount);
      await deposit(amount);
      setStatus("Deposit submitted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    }
  }

  async function onWithdraw() {
    setStatus(null);
    setError(null);
    try {
      parseAmount6(amount);
      await withdraw(amount);
      setStatus("Withdraw submitted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdraw failed");
    }
  }

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
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void onDeposit();
            }}
          >
            Deposit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void onWithdraw();
            }}
          >
            Withdraw
          </button>
        </div>
        <div className="field fund-amount">
          <label htmlFor="fund-amount">Amount (USDT)</label>
          <input
            id="fund-amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        {status ? <p className="fund-status">{status}</p> : null}
        {error ? <p className="fund-status error">{error}</p> : null}
      </div>
    </aside>
  );
}
