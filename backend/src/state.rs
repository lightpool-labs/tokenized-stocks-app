use std::sync::Arc;

use lightpool_sdk::Signer;
use tokio::sync::Mutex;

use crate::clob::ClobIndexClient;
use crate::config::Config;
use crate::hyperliquid::HyperliquidClient;
use crate::registry::Registry;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub clob: ClobIndexClient,
    pub hl: HyperliquidClient,
    pub admin: Arc<Signer>,
    #[allow(dead_code)]
    pub admin_address: String,
    pub registry: Arc<Mutex<Registry>>,
}

impl AppState {
    pub fn new(config: Config, admin: Signer, registry: Registry) -> Self {
        let admin_address = admin.address().to_hex();
        let clob = ClobIndexClient::new(config.clob_index_url.clone());
        let hl = HyperliquidClient::new(config.hyperliquid_info_url.clone());
        Self {
            config,
            clob,
            hl,
            admin: Arc::new(admin),
            admin_address,
            registry: Arc::new(Mutex::new(registry)),
        }
    }
}
