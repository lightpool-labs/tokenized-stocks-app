"use client";

import Link from "next/link";

export default function AdminPage() {
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
          Placeholder page. Create token, create spot market, and mint/fund will
          be wired in a later chapter.
        </p>

        <section className="admin-card">
          <h2>Create token</h2>
          <p>Placeholder — no CLI or API call yet.</p>
        </section>

        <section className="admin-card">
          <h2>Create spot market</h2>
          <p>Placeholder — e.g. AAPL/USDT spot ContractAddress.</p>
        </section>

        <section className="admin-card">
          <h2>Mint / fund</h2>
          <p>Placeholder — fund maker/taker balances later.</p>
        </section>

        <section className="admin-card">
          <h2>Liquidity maker</h2>
          <p>Ops bot comes later — not a trader widget on the trade page.</p>
        </section>
      </main>
    </>
  );
}
