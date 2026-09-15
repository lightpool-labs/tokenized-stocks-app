use std::net::SocketAddr;

use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

mod chain;
mod clob;
mod config;
mod error;
mod registry;
mod state;

use chain::{
    addresses_equal, create_stock_market, ensure_usdt, load_admin_signer, EXPECTED_ADMIN_ADDRESS,
};
use config::Config;
use error::{AppError, AppResult};
use registry::{new_market_id, MarketRecord, Registry};
use state::AppState;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct ReadyResponse {
    status: &'static str,
    clob_index: bool,
}

#[derive(Serialize)]
struct CashResponse {
    cash_token: Option<String>,
    symbol: &'static str,
}

#[derive(Serialize)]
struct EnsureCashResponse {
    cash_token: String,
    created: bool,
    digest: Option<String>,
}

#[derive(Deserialize)]
struct CreateMarketBody {
    symbol: String,
    name: String,
}

#[derive(Serialize)]
struct MarketsResponse {
    markets: Vec<MarketRecord>,
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                "tokenized_stocks_backend=debug,tower_http=debug".into()
            }),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env();
    let admin = load_admin_signer(&config.admin_private_key)
        .expect("failed to load ADMIN_PRIVATE_KEY");
    let admin_address = admin.address().to_hex();

    if !addresses_equal(&admin_address, EXPECTED_ADMIN_ADDRESS) {
        tracing::error!(
            admin_address = %admin_address,
            expected = EXPECTED_ADMIN_ADDRESS,
            "ADMIN_PRIVATE_KEY does not match LightPool validator (Anvil #0)"
        );
        panic!("admin address mismatch: got {admin_address}, expected {EXPECTED_ADMIN_ADDRESS}");
    }

    tracing::info!(
        address = %admin_address,
        "admin signer loaded (validator Anvil #0)"
    );

    let registry = Registry::load(&config.registry_path).unwrap_or_else(|e| {
        tracing::warn!("failed to load registry, starting empty: {e}");
        Registry::default()
    });

    let state = AppState::new(config.clone(), admin, registry);

    let cors = CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("http://localhost:3000"),
            HeaderValue::from_static("http://127.0.0.1:3000"),
        ])
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE]);

    let app = Router::new()
        .nest(
            "/api",
            Router::new()
                .route("/health", get(health))
                .route("/ready", get(ready))
                .route("/cash", get(get_cash))
                .route("/admin/ensure-cash", post(ensure_cash))
                .route("/admin/markets", post(create_market))
                .route("/markets", get(list_markets))
                .route("/markets/:id", get(get_market)),
        )
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("invalid listen address");

    tracing::info!("tokenized-stocks backend listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind");

    axum::serve(listener, app)
        .await
        .expect("server failed");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn ready(State(state): State<AppState>) -> Json<ReadyResponse> {
    let clob_index = state.clob.health_ok().await;
    Json(ReadyResponse {
        status: if clob_index { "ready" } else { "degraded" },
        clob_index,
    })
}

async fn get_cash(State(state): State<AppState>) -> Json<CashResponse> {
    let registry = state.registry.lock().await;
    Json(CashResponse {
        cash_token: registry.cash_token.clone(),
        symbol: "USDT",
    })
}

async fn ensure_cash(State(state): State<AppState>) -> AppResult<Json<EnsureCashResponse>> {
    let existing = {
        let registry = state.registry.lock().await;
        registry.cash_token.clone()
    };

    let (cash_token, created, digest) =
        ensure_usdt(&state.clob, state.admin.as_ref(), existing.as_deref()).await?;

    if created {
        let mut registry = state.registry.lock().await;
        registry.cash_token = Some(cash_token.clone());
        registry.save(&state.config.registry_path)?;
    }

    Ok(Json(EnsureCashResponse {
        cash_token,
        created,
        digest,
    }))
}

async fn create_market(
    State(state): State<AppState>,
    Json(body): Json<CreateMarketBody>,
) -> AppResult<(StatusCode, Json<MarketRecord>)> {
    let symbol = body.symbol.trim().to_uppercase();
    let name = body.name.trim().to_string();

    if symbol.is_empty() {
        return Err(AppError::BadRequest("symbol is required".into()));
    }
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    if symbol == "USDT" {
        return Err(AppError::BadRequest(
            "USDT is the cash token; create it via Ensure USDT".into(),
        ));
    }

    {
        let registry = state.registry.lock().await;
        if registry.find_market(&symbol).is_some() {
            return Err(AppError::BadRequest(format!(
                "market {symbol}/USDT already registered"
            )));
        }
    }

    let cash_token = {
        let existing = {
            let registry = state.registry.lock().await;
            registry.cash_token.clone()
        };
        let (cash_token, created, _) =
            ensure_usdt(&state.clob, state.admin.as_ref(), existing.as_deref()).await?;
        if created {
            let mut registry = state.registry.lock().await;
            registry.cash_token = Some(cash_token.clone());
            registry.save(&state.config.registry_path)?;
        }
        cash_token
    };

    let (base_token, spot_market, pair) = create_stock_market(
        &state.clob,
        state.admin.as_ref(),
        &symbol,
        &name,
        &cash_token,
    )
    .await?;

    let record = MarketRecord {
        id: new_market_id(),
        symbol: symbol.clone(),
        name,
        pair,
        base_token,
        quote_token: cash_token,
        spot_market,
    };

    {
        let mut registry = state.registry.lock().await;
        registry.upsert_market(record.clone());
        registry.save(&state.config.registry_path)?;
    }

    Ok((StatusCode::CREATED, Json(record)))
}

async fn list_markets(State(state): State<AppState>) -> Json<MarketsResponse> {
    let registry = state.registry.lock().await;
    Json(MarketsResponse {
        markets: registry.markets.clone(),
    })
}

async fn get_market(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<MarketRecord>> {
    let registry = state.registry.lock().await;
    registry
        .find_market(&id)
        .cloned()
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("market '{id}' not found")))
}
