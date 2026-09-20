"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { parseAmount6 } from "@/lib/wallet";

type FundKind = "deposit" | "withdraw";

type FundDialogProps = {
  kind: FundKind;
  onClose: () => void;
};

export function FundDialog({ kind, onClose }: FundDialogProps) {
  const { busy, tokens, deposit, withdraw } = useWallet();
  const [symbol, setSymbol] = useState("USDT");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const options = useMemo(() => {
    if (tokens.length > 0) return tokens.map((token) => token.symbol);
    return ["USDT", "AAPL", "TSLA", "INTC"];
  }, [tokens]);

  useEffect(() => {
    if (!options.includes(symbol) && options[0]) {
      setSymbol(options[0]);
    }
  }, [options, symbol]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function onConfirm() {
    setError(null);
    setStatus(null);
    try {
      parseAmount6(amount);
      if (kind === "deposit") {
        await deposit(symbol, amount);
        setStatus("Deposit submitted");
      } else {
        await withdraw(symbol, amount);
        setStatus("Withdraw submitted");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `${kind} failed`);
    }
  }

  const title = kind === "deposit" ? "Deposit" : "Withdraw";

  return (
    <div className="fund-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="fund-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fund-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="fund-dialog-header">
          <h3 id="fund-dialog-title">{title}</h3>
          <button
            type="button"
            className="fund-dialog-close"
            disabled={busy}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="field">
          <label htmlFor="fund-token">Token</label>
          <select
            id="fund-token"
            value={symbol}
            disabled={busy}
            onChange={(event) => setSymbol(event.target.value)}
          >
            {options.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="fund-dialog-amount">Amount</label>
          <input
            id="fund-dialog-amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            disabled={busy}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>

        {status ? <p className="fund-status">{status}</p> : null}
        {error ? <p className="fund-status error">{error}</p> : null}

        <div className="fund-dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fund-dialog-confirm"
            disabled={busy}
            onClick={() => {
              void onConfirm();
            }}
          >
            {busy ? "Confirm in MetaMask…" : title}
          </button>
        </div>
      </div>
    </div>
  );
}
