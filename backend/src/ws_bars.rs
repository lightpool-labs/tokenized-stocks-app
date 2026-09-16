use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio_tungstenite::{connect_async, tungstenite::Message as TsMessage};

use crate::hyperliquid::{
    bar_from_hl_json, hl_coin_for_symbol, normalize_interval, normalize_symbol, Bar,
};

#[derive(Debug, Deserialize)]
struct ClientMessage {
    op: String,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    symbol: Option<String>,
    #[serde(default)]
    interval: Option<String>,
}

#[derive(Debug, Serialize)]
struct BarsPush {
    channel: &'static str,
    symbol: String,
    hl_coin: String,
    interval: String,
    bar: Bar,
}

#[derive(Debug, Serialize)]
struct ServerNotice {
    channel: &'static str,
    event: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hl_coin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    interval: Option<String>,
}

pub async fn handle_client_socket(socket: WebSocket, hl_ws_url: Arc<String>) {
    let (mut client_tx, mut client_rx) = socket.split();

    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        while let Some(text) = out_rx.recv().await {
            if client_tx.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
    });

    let mut active: Option<tokio::task::JoinHandle<()>> = None;

    while let Some(Ok(msg)) = client_rx.next().await {
        match msg {
            Message::Text(text) => {
                let parsed: ClientMessage = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = out_tx.send(notice_error(format!("invalid client message: {e}")));
                        continue;
                    }
                };

                match parsed.op.as_str() {
                    "subscribe" => {
                        if parsed.channel.as_deref().unwrap_or("bars") != "bars" {
                            let _ = out_tx.send(notice_error(
                                "only channel bars is supported".into(),
                            ));
                            continue;
                        }

                        let symbol = match normalize_symbol(parsed.symbol.as_deref().unwrap_or(""))
                        {
                            Ok(s) => s,
                            Err(e) => {
                                let _ = out_tx.send(notice_error(e.to_string()));
                                continue;
                            }
                        };
                        let interval =
                            match normalize_interval(parsed.interval.as_deref().unwrap_or("1m")) {
                                Ok(i) => i.to_string(),
                                Err(e) => {
                                    let _ = out_tx.send(notice_error(e.to_string()));
                                    continue;
                                }
                            };

                        if let Some(prev) = active.take() {
                            prev.abort();
                        }

                        let hl_coin = hl_coin_for_symbol(&symbol);
                        let out = out_tx.clone();
                        let url = hl_ws_url.as_str().to_string();
                        let symbol_task = symbol.clone();
                        let interval_task = interval.clone();
                        let hl_coin_task = hl_coin.clone();

                        let handle = tokio::spawn(async move {
                            if let Err(e) = bridge_hl_candles(
                                &url,
                                &symbol_task,
                                &hl_coin_task,
                                &interval_task,
                                out.clone(),
                            )
                            .await
                            {
                                let _ = out.send(
                                    serde_json::to_string(&ServerNotice {
                                        channel: "bars",
                                        event: "error",
                                        message: Some(e),
                                        symbol: Some(symbol_task),
                                        hl_coin: Some(hl_coin_task),
                                        interval: Some(interval_task),
                                    })
                                    .unwrap_or_default(),
                                );
                            }
                        });

                        let _ = out_tx.send(
                            serde_json::to_string(&ServerNotice {
                                channel: "bars",
                                event: "subscribed",
                                message: None,
                                symbol: Some(symbol),
                                hl_coin: Some(hl_coin),
                                interval: Some(interval),
                            })
                            .unwrap_or_default(),
                        );

                        active = Some(handle);
                    }
                    "unsubscribe" => {
                        if let Some(prev) = active.take() {
                            prev.abort();
                            let _ = out_tx.send(
                                serde_json::to_string(&ServerNotice {
                                    channel: "bars",
                                    event: "unsubscribed",
                                    message: None,
                                    symbol: None,
                                    hl_coin: None,
                                    interval: None,
                                })
                                .unwrap_or_default(),
                            );
                        }
                    }
                    "ping" => {
                        let _ = out_tx.send(r#"{"channel":"bars","event":"pong"}"#.to_string());
                    }
                    other => {
                        let _ = out_tx.send(notice_error(format!("unknown op '{other}'")));
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    if let Some(prev) = active.take() {
        prev.abort();
    }
    drop(out_tx);
    let _ = writer.await;
}

fn notice_error(message: String) -> String {
    serde_json::to_string(&ServerNotice {
        channel: "bars",
        event: "error",
        message: Some(message),
        symbol: None,
        hl_coin: None,
        interval: None,
    })
    .unwrap_or_default()
}

async fn bridge_hl_candles(
    hl_ws_url: &str,
    symbol: &str,
    hl_coin: &str,
    interval: &str,
    out_tx: tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<(), String> {
    let (ws, _) = connect_async(hl_ws_url)
        .await
        .map_err(|e| format!("connect Hyperliquid WS failed: {e}"))?;
    let (mut hl_tx, mut hl_rx) = ws.split();

    let sub = json!({
        "method": "subscribe",
        "subscription": {
            "type": "candle",
            "coin": hl_coin,
            "interval": interval,
        }
    });
    hl_tx
        .send(TsMessage::Text(sub.to_string()))
        .await
        .map_err(|e| format!("Hyperliquid subscribe failed: {e}"))?;

    while let Some(msg) = hl_rx.next().await {
        match msg {
            Ok(TsMessage::Text(text)) => {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    let channel = value
                        .get("channel")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if channel == "candle" {
                        if let Some(data) = value.get("data") {
                            if let Some(bar) = bar_from_hl_json(data) {
                                let push = BarsPush {
                                    channel: "bars",
                                    symbol: symbol.to_string(),
                                    hl_coin: hl_coin.to_string(),
                                    interval: interval.to_string(),
                                    bar,
                                };
                                if out_tx
                                    .send(serde_json::to_string(&push).unwrap_or_default())
                                    .is_err()
                                {
                                    break;
                                }
                            }
                        }
                    } else if let Some(err) = value.get("error").and_then(|v| v.as_str()) {
                        return Err(err.to_string());
                    }
                }
            }
            Ok(TsMessage::Ping(payload)) => {
                let _ = hl_tx.send(TsMessage::Pong(payload)).await;
            }
            Ok(TsMessage::Close(_)) => break,
            Err(e) => return Err(format!("Hyperliquid WS error: {e}")),
            _ => {}
        }
    }

    Ok(())
}
