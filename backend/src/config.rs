use std::env;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub clob_index_url: String,
    pub admin_private_key: String,
    pub registry_path: PathBuf,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(3001),
            clob_index_url: env::var("CLOB_INDEX_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:3002".into()),
            admin_private_key: env::var("ADMIN_PRIVATE_KEY").unwrap_or_else(|_| {
                "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80".into()
            }),
            registry_path: env::var("REGISTRY_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("data/registry.json")),
        }
    }
}
