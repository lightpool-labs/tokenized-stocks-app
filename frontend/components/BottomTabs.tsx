"use client";

import { useState } from "react";

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
  const columns = COLUMNS[tab];

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
            <tr>
              <td colSpan={columns.length}>No {tab.toLowerCase()} yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
