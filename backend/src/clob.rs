use lightpool_sdk::lightpool_types::SignedTransaction;
use lightpool_sdk::TransactionReceipt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
struct ErrorBody {
    error: String,
}

#[derive(Debug, Deserialize)]
struct SubmitTxResponse {
    digest: String,
    #[serde(default)]
    block_num: u64,
    receipt: TransactionReceipt,
}

#[derive(Debug, Clone)]
pub struct SubmitResult {
    pub digest: String,
    #[allow(dead_code)]
    pub block_num: u64,
    pub receipt: TransactionReceipt,
}

#[derive(Clone)]
pub struct ClobIndexClient {
    client: Client,
    base_url: String,
}

impl ClobIndexClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(0)
            .build()
            .expect("failed to build clob-index HTTP client");
        Self {
            client,
            base_url: base_url.into().trim_end_matches('/').to_string(),
        }
    }

    pub async fn health_ok(&self) -> bool {
        let url = format!("{}/api/health/health", self.base_url);
        match self.client.get(&url).send().await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }

    pub async fn submit_transaction(&self, tx: SignedTransaction) -> AppResult<SubmitResult> {
        #[derive(Serialize)]
        struct Body {
            tx: SignedTransaction,
        }

        let url = format!("{}/api/tx/submit", self.base_url);
        let response = self
            .client
            .post(&url)
            .json(&Body { tx })
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("clob-index submit failed: {e}")))?;

        let status = response.status();
        if status.is_success() {
            let body: SubmitTxResponse = response.json().await.map_err(|e| {
                AppError::Internal(format!("decode submit response: {e}"))
            })?;
            return Ok(SubmitResult {
                digest: body.digest,
                block_num: body.block_num,
                receipt: body.receipt,
            });
        }

        let message = match response.json::<ErrorBody>().await {
            Ok(body) => body.error,
            Err(_) => format!("clob-index submit HTTP {status}"),
        };
        Err(AppError::Internal(message))
    }
}
