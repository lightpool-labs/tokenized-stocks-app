use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::State;
use axum::http::{header, HeaderValue, Method};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

#[derive(Clone)]
struct AppState {
    clob_index_url: String,
    http: reqwest::Client,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct ReadyResponse {
    status: &'static str,
    clob_index: bool,
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

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let clob_index_url = std::env::var("CLOB_INDEX_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3002".to_string());

    let state = AppState {
        clob_index_url,
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .expect("failed to build HTTP client"),
    };

    let cors = CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("http://localhost:3000"),
            HeaderValue::from_static("http://127.0.0.1:3000"),
        ])
        .allow_methods([Method::GET, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE]);

    let app = Router::new()
        .nest(
            "/api",
            Router::new()
                .route("/health", get(health))
                .route("/ready", get(ready)),
        )
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = format!("{host}:{port}")
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
    let url = format!(
        "{}/api/health/health",
        state.clob_index_url.trim_end_matches('/')
    );
    let clob_index = match state.http.get(&url).send().await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    };

    Json(ReadyResponse {
        status: if clob_index { "ready" } else { "degraded" },
        clob_index,
    })
}
