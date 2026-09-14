# Tokenized Stocks App

LightPool spot-exchange sample (AAPL/USDT-style). Scaffold only: thin API + home page.

```text
Browser :3000  →  backend :3001  →  clob-index :3002  →  lightpool node
```

The backend is a client of clob-index, not of node RPC `:26300`. The frontend talks only to the backend.

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
| GET | `/api/health` | Liveness `{ "status": "ok" }` |
| GET | `/api/ready` | clob-index connectivity (`ready` or `degraded`) |

## Run the frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

UI: `http://127.0.0.1:3000`

## Venue

Node + clob-index must already be running for `/api/ready` to report `ready`. If clob-index is down, `/api/ready` still returns HTTP 200 with `{ "status": "degraded", "clob_index": false }`.

Later chapters will sign txs with [`lightpool-sdk-rust`](../lightpool-sdk-rust) via path `../lightpool-sdk-rust`. This scaffold does not wire the SDK yet.

## Ports

| Port | Service |
|------|---------|
| 3000 | UI |
| 3001 | Backend |
| 3002 | clob-index |
