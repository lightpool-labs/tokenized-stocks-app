"use client";

import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { MarketsList } from "@/components/MarketsList";
import { ChartPanel } from "@/components/ChartPanel";
import { OrderBookPanel } from "@/components/OrderBookPanel";
import { OrderTicket } from "@/components/OrderTicket";
import { BottomTabs } from "@/components/BottomTabs";

export function TradeShell() {
  const [selectedMarket, setSelectedMarket] = useState("AAPL/USDT");

  return (
    <div className="app-shell">
      <div className="main-column">
        <TopBar />
        <div className="workspace">
          <MarketsList selected={selectedMarket} onSelect={setSelectedMarket} />
          <ChartPanel pair={selectedMarket} />
          <OrderBookPanel />
        </div>
        <BottomTabs />
      </div>
      <OrderTicket pair={selectedMarket} />
    </div>
  );
}
