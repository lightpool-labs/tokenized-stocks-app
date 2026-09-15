"use client";

import Link from "next/link";
import type { Market } from "@/lib/api";

type MarketsListProps = {
  markets: Market[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (market: Market) => void;
};

export function MarketsList({
  markets,
  selectedId,
  loading,
  error,
  onSelect,
}: MarketsListProps) {
  return (
    <section className="panel">
      <div className="panel-header">Markets</div>
      <div className="panel-body" style={{ padding: "0.35rem" }}>
        {loading && <p className="markets-empty">Loading markets…</p>}
        {!loading && error && <p className="markets-empty error">{error}</p>}
        {!loading && !error && markets.length === 0 && (
          <p className="markets-empty">
            No markets yet. Create USDT and a stock pair in{" "}
            <Link href="/admin">Admin</Link>.
          </p>
        )}
        {!loading &&
          markets.map((market) => (
            <button
              key={market.id}
              type="button"
              className={`market-row ${selectedId === market.id ? "selected" : ""}`}
              onClick={() => onSelect(market)}
            >
              <span className="pair">{market.pair}</span>
              <span className="hint">{market.name}</span>
            </button>
          ))}
      </div>
    </section>
  );
}
