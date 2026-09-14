"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001/api";

type HealthResponse = {
  status: string;
};

type ReadyResponse = {
  status: string;
  clob_index: boolean;
};

export default function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [ready, setReady] = useState<ReadyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [healthRes, readyRes] = await Promise.all([
          fetch(`${API_URL}/health`),
          fetch(`${API_URL}/ready`),
        ]);

        if (!healthRes.ok) {
          throw new Error(`health ${healthRes.status}`);
        }

        const healthJson = (await healthRes.json()) as HealthResponse;
        setHealth(healthJson);

        if (readyRes.ok) {
          setReady((await readyRes.json()) as ReadyResponse);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reach backend");
      }
    }

    void load();
  }, []);

  const readyClass =
    ready?.status === "ready"
      ? "ok"
      : ready
        ? "degraded"
        : undefined;

  return (
    <main>
      <h1>Tokenized Stocks</h1>
      <p className="lead">This is a LightPool spot-exchange sample.</p>

      <section className="status">
        {error && <p className="error">Backend unreachable: {error}</p>}
        {!error && !health && <p>Checking backend health…</p>}
        {health && <p>Backend health: {health.status}</p>}
        {ready && (
          <p className={readyClass}>
            Venue: {ready.status}
            {ready.clob_index ? "" : " (clob-index down)"}
          </p>
        )}
      </section>
    </main>
  );
}
