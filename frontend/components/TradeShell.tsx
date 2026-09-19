"use client";

import { useCallback, useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { MarketsList } from "@/components/MarketsList";
import { ChartPanel } from "@/components/ChartPanel";
import { OrderBookPanel } from "@/components/OrderBookPanel";
import { OrderTicket } from "@/components/OrderTicket";
import { BottomTabs } from "@/components/BottomTabs";
import { listMarkets, type Market } from "@/lib/api";

export function TradeShell() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selected, setSelected] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listMarkets();
      setMarkets(next);
      setSelected((prev) => {
        if (prev) {
          const still = next.find((m) => m.id === prev.id);
          if (still) return still;
        }
        return next[0] ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load markets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pair = selected?.pair ?? "—";

  return (
    <div className="app-shell">
      <div className="shell-top">
        <TopBar />
      </div>

      <div className="chart-stack">
        <div className="chart-topbar">
          <MarketsList
            markets={markets}
            selected={selected}
            loading={loading}
            error={error}
            onSelect={setSelected}
          />
        </div>
        <ChartPanel market={selected} />
      </div>

      <OrderBookPanel market={selected} />
      <OrderTicket pair={pair} selected={selected} />
      <BottomTabs />
    </div>
  );
}
