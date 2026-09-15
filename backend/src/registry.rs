use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MarketRecord {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub pair: String,
    pub base_token: String,
    pub quote_token: String,
    pub spot_market: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Registry {
    pub cash_token: Option<String>,
    pub markets: Vec<MarketRecord>,
}

impl Registry {
    pub fn load(path: &Path) -> AppResult<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(path)
            .map_err(|e| AppError::Internal(format!("read registry: {e}")))?;
        serde_json::from_str(&raw)
            .map_err(|e| AppError::Internal(format!("parse registry: {e}")))
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::Internal(format!("create registry dir: {e}")))?;
        }
        let raw = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Internal(format!("serialize registry: {e}")))?;
        fs::write(path, raw).map_err(|e| AppError::Internal(format!("write registry: {e}")))
    }

    pub fn find_market(&self, id_or_symbol: &str) -> Option<&MarketRecord> {
        let key = id_or_symbol.trim();
        self.markets.iter().find(|m| {
            m.id.eq_ignore_ascii_case(key)
                || m.symbol.eq_ignore_ascii_case(key)
                || m.pair.eq_ignore_ascii_case(key)
        })
    }

    pub fn upsert_market(&mut self, record: MarketRecord) {
        if let Some(existing) = self
            .markets
            .iter_mut()
            .find(|m| m.symbol.eq_ignore_ascii_case(&record.symbol))
        {
            *existing = record;
        } else {
            self.markets.push(record);
        }
    }
}

pub fn new_market_id() -> String {
    Uuid::new_v4().to_string()
}
