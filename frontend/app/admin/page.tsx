"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createMarket,
  ensureCash,
  getCash,
  listMarkets,
  type Market,
} from "@/lib/api";

export default function AdminPage() {
  const [cashToken, setCashToken] = useState<string | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [symbol, setSymbol] = useState("AAPL");
  const [name, setName] = useState("Apple");
  const [busy, setBusy] = useState<"cash" | "market" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastMarket, setLastMarket] = useState<Market | null>(null);

  const refresh = useCallback(async () => {
    const [cash, marketList] = await Promise.all([getCash(), listMarkets()]);
    setCashToken(cash.cash_token);
    setMarkets(marketList);
  }, []);

  useEffect(() => {
    refresh().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load admin state");
    });
  }, [refresh]);

  async function onEnsureCash() {
    setBusy("cash");
    setError(null);
    setMessage(null);
    try {
      const result = await ensureCash();
      setCashToken(result.cash_token);
      setMessage(
        result.created
          ? `Created USDT cash token ${result.cash_token}`
          : `USDT already registered: ${result.cash_token}`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ensure USDT failed");
    } finally {
      setBusy(null);
    }
  }

  async function onCreateMarket(event: FormEvent) {
    event.preventDefault();
    setBusy("market");
    setError(null);
    setMessage(null);
    setLastMarket(null);
    try {
      const market = await createMarket({ symbol, name });
      setLastMarket(market);
      setCashToken(market.quote_token);
      setMessage(`Created ${market.pair}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create market failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="admin-top">
        <Link href="/" className="logo">
          LightPool
        </Link>
        <nav className="nav-links">
          <Link href="/" className="nav-link">
            Trade
          </Link>
          <Link href="/admin" className="nav-link active">
            Admin
          </Link>
        </nav>
        <div className="topbar-spacer" />
        <button type="button" className="connect-btn">
          Connect
        </button>
      </header>

      <main className="admin-page">
        <h1>Admin</h1>
        <p className="lead">
          Create cash USDT first, then create a stock token and its SYMBOL_USDT
          spot market. Signed by the LightPool validator (Anvil #0) on the
          backend.
        </p>

        {error && <div className="admin-alert error">{error}</div>}
        {message && <div className="admin-alert ok">{message}</div>}

        <section className="admin-card">
          <h2>Cash / USDT</h2>
          <p className="admin-meta">
            Current cash token:{" "}
            <code>{cashToken ?? "not created yet"}</code>
          </p>
          <button
            type="button"
            className="admin-btn"
            onClick={onEnsureCash}
            disabled={busy !== null}
          >
            {busy === "cash" ? "Working…" : "Ensure USDT"}
          </button>
        </section>

        <section className="admin-card">
          <h2>Create stock market</h2>
          <p>
            Creates the stock token, then the SYMBOL_USDT spot market on
            LightPool (ensures USDT first if needed).
          </p>
          <form className="admin-form" onSubmit={onCreateMarket}>
            <label>
              Symbol
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="AAPL"
                required
              />
            </label>
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Apple"
                required
              />
            </label>
            <button
              type="submit"
              className="admin-btn"
              disabled={busy !== null}
            >
              {busy === "market" ? "Creating…" : "Create token + spot market"}
            </button>
          </form>

          {lastMarket && (
            <div className="admin-result">
              <p>
                Pair: <code>{lastMarket.pair}</code>
              </p>
              <p>
                Base token: <code>{lastMarket.base_token}</code>
              </p>
              <p>
                Quote (USDT): <code>{lastMarket.quote_token}</code>
              </p>
              <p>
                Spot market: <code>{lastMarket.spot_market}</code>
              </p>
            </div>
          )}
        </section>

        <section className="admin-card">
          <h2>Registered markets</h2>
          {markets.length === 0 ? (
            <p>No markets yet. Create one above.</p>
          ) : (
            <ul className="admin-market-list">
              {markets.map((market) => (
                <li key={market.id}>
                  <strong>{market.pair}</strong>
                  <span>{market.name}</span>
                  <code>{market.spot_market}</code>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
