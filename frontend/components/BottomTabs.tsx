"use client";

import { useState } from "react";
import { useWallet } from "@/components/WalletProvider";

const TABS = ["Balances", "Open orders", "History", "Fills"] as const;

type Tab = (typeof TABS)[number];

const COLUMNS: Record<Tab, string[]> = {
  Balances: ["Asset", "Available", "Locked", "Total"],
  "Open orders": ["Market", "Side", "Price", "Size", "Status"],
  History: ["Time", "Market", "Side", "Price", "Size"],
  Fills: ["Time", "Market", "Side", "Price", "Size", "Fee"],
};

export function BottomTabs() {
  const [tab, setTab] = useState<Tab>("Balances");
  const { address, balances } = useWallet();
  const columns = COLUMNS[tab];
  const showBalances = tab === "Balances" && address !== null;

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
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showBalances && balances.length > 0 ? (
              balances.map((row) => (
                <tr key={row.symbol}>
                  <td className="data">{row.symbol}</td>
                  <td className="data">{row.available}</td>
                  <td className="data">{row.locked}</td>
                  <td className="data">{row.total}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length}>No {tab.toLowerCase()} yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
