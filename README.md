# Tokenized Stocks App

A LightPool spot-exchange sample for tokenized US stocks. The trade page shows AAPL, TSLA, and INTC quoted in USDT, with Hyperliquid reference candles, a live LightPool order book, and MetaMask deposit and withdraw.

```text
Browser :3000  →  backend :3001  →  clob-index :3002  →  lightpool node
```

The backend is a client of clob-index, not of node RPC `:26300`. The frontend talks only to the backend. Admin txs are signed with the same Anvil #0 key as the LightPool validator.

## Directory layout

```text
tokenized-stocks-app/
├── README.md
├── backend/     # Rust Axum API (`tokenized-stocks-backend`)
└── frontend/    # Next.js (App Router)
```

## Run the backend

```bash
cd backend
cp .env.example .env
cargo run
```

API: `http://127.0.0.1:3001/api`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness |
| GET | `/api/ready` | clob-index connectivity |
| GET | `/api/cash` | Current USDT `ContractAddress` or null |
| POST | `/api/admin/ensure-cash` | Create USDT if missing |
| POST | `/api/admin/markets` | Body `{ "symbol", "name" }` → stock token + `SYMBOL/USDT` spot |
| GET | `/api/markets` | App-registered spot pairs |
| GET | `/api/markets/:id` | One market by id, symbol, or pair |
| GET | `/api/markets/:symbol/bars` | Hyperliquid candle history (`xyz:<SYMBOL>`) |
| WS | `/api/ws` | Live bars (`subscribe` channel `bars`) |

Chart coin rule: LightPool base `AAPL` → Hyperliquid `xyz:AAPL` (fixed prefix; no per-market coin field).

Markets are stored in `$LABS/data/tokenized-stocks/registry.json` (from `backend/`: `../../data/tokenized-stocks/registry.json`). `./scripts/run-venue.sh clean` deletes that whole course data dir, including the registry.

## Run the frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

UI: `http://127.0.0.1:3000`  
Admin: `http://127.0.0.1:3000/admin`

## Admin + chart flow

1. Start venue: `lightpool-tutorials/scripts/run-venue.sh start`
2. Admin → Ensure USDT → create e.g. AAPL market
3. Trade page: select `AAPL/USDT` → chart loads history for `xyz:AAPL`, then live candle updates (TradingView Lightweight Charts)

## Ports

| Port | Service |
|------|---------|
| 3000 | UI |
| 3001 | Backend |
| 3002 | clob-index |
