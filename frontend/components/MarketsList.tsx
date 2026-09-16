"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Market } from "@/lib/api";

type MarketsListProps = {
  markets: Market[];
  selected: Market | null;
  loading: boolean;
  error: string | null;
  onSelect: (market: Market) => void;
};

export function MarketsList({
  markets,
  selected,
  loading,
  error,
  onSelect,
}: MarketsListProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="market-select" ref={rootRef}>
      <button
        type="button"
        className={`market-select-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="market-select-pair">
          {selected?.pair ?? (loading ? "Loading…" : "Select market")}
        </span>
        {selected && <span className="market-select-name">{selected.name}</span>}
        <span className="market-select-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="market-select-menu" role="listbox">
          {loading && <p className="markets-empty">Loading markets…</p>}
          {!loading && error && (
            <p className="markets-empty error">{error}</p>
          )}
          {!loading && !error && markets.length === 0 && (
            <p className="markets-empty">
              No markets yet. Create a pair in <Link href="/admin">Admin</Link>.
            </p>
          )}
          {!loading &&
            markets.map((market) => (
              <button
                key={market.id}
                type="button"
                role="option"
                aria-selected={selected?.id === market.id}
                className={`market-row ${selected?.id === market.id ? "selected" : ""}`}
                onClick={() => {
                  onSelect(market);
                  setOpen(false);
                }}
              >
                <span className="pair">{market.pair}</span>
                <span className="hint">{market.name}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
