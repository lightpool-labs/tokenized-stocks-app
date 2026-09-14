"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001/api";

type HealthResponse = {
  status: string;
};

export function TopBar() {
  const [health, setHealth] = useState<"ok" | "down" | "checking">("checking");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${API_URL}/health`);
        if (!res.ok) {
          throw new Error(`health ${res.status}`);
        }
        const json = (await res.json()) as HealthResponse;
        if (!cancelled) {
          setHealth(json.status === "ok" ? "ok" : "down");
        }
      } catch {
        if (!cancelled) {
          setHealth("down");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="topbar">
      <Link href="/" className="logo">
        LightPool
      </Link>
      <nav className="nav-links">
        <Link href="/" className="nav-link active">
          Trade
        </Link>
        <Link href="/admin" className="nav-link">
          Admin
        </Link>
      </nav>
      <div className="topbar-spacer" />
      <span
        className={`health-pill ${health === "ok" ? "ok" : health === "down" ? "down" : ""}`}
        title="Backend /api/health"
      >
        {health === "checking" ? "api…" : health === "ok" ? "api ok" : "api down"}
      </span>
      <button type="button" className="connect-btn">
        Connect
      </button>
    </header>
  );
}
