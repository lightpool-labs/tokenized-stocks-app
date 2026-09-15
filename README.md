# Tokenized Stocks App

LightPool spot-exchange sample (AAPL/USDT-style). Thin API + trade UI shell with Admin create-token / create-spot-market.

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

Markets are stored in `backend/data/registry.json` (not clob-index event markets). After `./scripts/run-venue.sh clean`, delete that file (or wipe `backend/data/`) before recreating USDT / pairs.

## Run the frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

UI: `http://127.0.0.1:3000`  
Admin: `http://127.0.0.1:3000/admin`

## Admin flow

1. Start venue: `lightpool-tutorials/scripts/run-venue.sh start`
2. Open Admin → **Ensure USDT** (cash token)
3. **Create token + spot market** (e.g. AAPL / Apple) → creates AAPL token then `AAPL/USDT` spot
4. Trade page markets list loads real pairs; selecting one stores the spot `ContractAddress` in UI state

Later chapters still own chart bars, live book, deposit/withdraw, and place-order.

SDK path dependency: [`../lightpool-sdk-rust`](../lightpool-sdk-rust).

## Ports

| Port | Service |
|------|---------|
| 3000 | UI |
| 3001 | Backend |
| 3002 | clob-index |
