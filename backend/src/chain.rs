use lightpool_sdk::{
    extract_market_address_from_events, extract_token_address_from_events, parse_token_contract,
    ActionBuilder, CreateMarketParams, CreateTokenParams, MarketState, SegmentSize, Signer,
    TOKEN_SCALE, TransactionBuilder, UpdateMarketParams,
};

use crate::clob::ClobIndexClient;
use crate::error::{AppError, AppResult};

pub const EXPECTED_ADMIN_ADDRESS: &str = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const USDT_SUPPLY_WHOLE: u64 = 1_000_000_000;
const STOCK_SUPPLY_WHOLE: u64 = 1_000_000_000;
const MIN_ORDER_SIZE: u64 = 100_000;
/// $0.01 in LightPool raw price units (`0.01 * TOKEN_SCALE`).
const TICK_SIZE: u64 = 10_000;

pub fn load_admin_signer(raw: &str) -> AppResult<Signer> {
    let trimmed = raw.trim();
    let hex_body = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);

    let is_hex = !hex_body.is_empty()
        && hex_body.len() == 64
        && hex_body.chars().all(|c| c.is_ascii_hexdigit());

    if !is_hex {
        return Err(AppError::BadRequest(
            "ADMIN_PRIVATE_KEY must be a 32-byte hex key (Anvil #0)".into(),
        ));
    }

    let bytes = hex::decode(hex_body)
        .map_err(|e| AppError::BadRequest(format!("invalid ADMIN_PRIVATE_KEY hex: {e}")))?;
    let key_bytes: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| AppError::BadRequest("ADMIN_PRIVATE_KEY must decode to 32 bytes".into()))?;

    Signer::from_secret_key_bytes(&key_bytes)
        .map_err(|e| AppError::Internal(format!("load admin signer: {e}")))
}

pub async fn create_token(
    clob: &ClobIndexClient,
    signer: &Signer,
    name: &str,
    symbol: &str,
    total_supply_whole: u64,
) -> AppResult<(String, String)> {
    let sender = signer.address();
    let params = CreateTokenParams {
        name: name.into(),
        symbol: symbol.into(),
        total_supply: total_supply_whole
            .checked_mul(TOKEN_SCALE)
            .ok_or_else(|| AppError::BadRequest("total_supply overflow".into()))?,
        mintable: true,
        to: sender,
    };

    let action = ActionBuilder::create_token(params)
        .map_err(|e| AppError::Internal(format!("build create_token: {e}")))?;

    let tx = TransactionBuilder::new()
        .sender(sender)
        .expiration(u64::MAX)
        .add_action(action)
        .build_and_sign_only(signer)
        .map_err(|e| AppError::Internal(format!("sign create_token: {e}")))?;

    let response = clob.submit_transaction(tx).await?;
    if !response.receipt.is_success() {
        return Err(AppError::Internal(format!(
            "create_token failed: {:?}",
            response.receipt.status
        )));
    }

    let token = extract_token_address_from_events(&response.receipt).ok_or_else(|| {
        AppError::Internal("token address missing from create_token receipt".into())
    })?;

    Ok((token.to_string(), response.digest))
}

pub async fn create_spot_market(
    clob: &ClobIndexClient,
    signer: &Signer,
    pair_name: &str,
    base_token: lightpool_sdk::ContractAddress,
    quote_token: lightpool_sdk::ContractAddress,
) -> AppResult<(String, String)> {
    let sender = signer.address();
    let params = CreateMarketParams {
        name: pair_name.into(),
        base_token,
        quote_token,
        min_order_size: MIN_ORDER_SIZE,
        tick_size: TICK_SIZE,
        maker_fee_bps: 10,
        taker_fee_bps: 20,
        allow_market_orders: true,
        state: MarketState::Active,
        limit_order: true,
        side_book_size: SegmentSize::Large,
        creator: sender,
        access: Default::default(),
    };

    let action = ActionBuilder::create_market(params)
        .map_err(|e| AppError::Internal(format!("build create_market: {e}")))?;

    let tx = TransactionBuilder::new()
        .sender(sender)
        .expiration(u64::MAX)
        .add_action(action)
        .build_and_sign_only(signer)
        .map_err(|e| AppError::Internal(format!("sign create_market: {e}")))?;

    let response = clob.submit_transaction(tx).await?;
    if !response.receipt.is_success() {
        return Err(AppError::Internal(format!(
            "create_market failed: {:?}",
            response.receipt.status
        )));
    }

    let market = extract_market_address_from_events(&response.receipt).ok_or_else(|| {
        AppError::Internal("market address missing from create_market receipt".into())
    })?;

    Ok((market.to_string(), response.digest))
}

pub async fn enable_market_orders(
    clob: &ClobIndexClient,
    signer: &Signer,
    spot_market_hex: &str,
) -> AppResult<String> {
    let spot_market = parse_token_contract(spot_market_hex.trim()).map_err(|e| {
        AppError::BadRequest(format!("invalid spot market: {e}"))
    })?;

    let action = ActionBuilder::update_market(
        spot_market,
        UpdateMarketParams {
            min_order_size: None,
            maker_fee_bps: None,
            taker_fee_bps: None,
            allow_market_orders: Some(true),
            state: None,
        },
    )
    .map_err(|e| AppError::Internal(format!("build update_market: {e}")))?;

    let tx = TransactionBuilder::new()
        .sender(signer.address())
        .expiration(u64::MAX)
        .add_action(action)
        .build_and_sign_only(signer)
        .map_err(|e| AppError::Internal(format!("sign update_market: {e}")))?;

    let response = clob.submit_transaction(tx).await?;
    if !response.receipt.is_success() {
        return Err(AppError::Internal(format!(
            "update_market failed: {:?}",
            response.receipt.status
        )));
    }
    Ok(response.digest)
}

pub async fn ensure_usdt(
    clob: &ClobIndexClient,
    signer: &Signer,
    existing: Option<&str>,
) -> AppResult<(String, bool, Option<String>)> {
    if let Some(address) = existing.filter(|v| !v.trim().is_empty()) {
        return Ok((address.to_string(), false, None));
    }

    let (address, digest) =
        create_token(clob, signer, "USDT", "USDT", USDT_SUPPLY_WHOLE).await?;
    Ok((address, true, Some(digest)))
}

pub async fn create_stock_market(
    clob: &ClobIndexClient,
    signer: &Signer,
    symbol: &str,
    name: &str,
    quote_token_hex: &str,
) -> AppResult<(String, String, String)> {
    let (base_token, _token_digest) =
        create_token(clob, signer, name, symbol, STOCK_SUPPLY_WHOLE).await?;

    let base = parse_contract_address(&base_token)?;
    let quote = parse_contract_address(quote_token_hex)?;
    let pair = format!("{symbol}/USDT");

    let (spot_market, _market_digest) =
        create_spot_market(clob, signer, &pair, base, quote).await?;

    Ok((base_token, spot_market, pair))
}

pub fn parse_contract_address(raw: &str) -> AppResult<lightpool_sdk::ContractAddress> {
    lightpool_sdk::parse_token_contract(raw)
        .map_err(|e| AppError::BadRequest(format!("invalid ContractAddress '{raw}': {e}")))
}

pub fn addresses_equal(a: &str, b: &str) -> bool {
    normalize_hex(a) == normalize_hex(b)
}

fn normalize_hex(value: &str) -> String {
    value.trim().trim_start_matches("0x").trim_start_matches("0X").to_ascii_lowercase()
}
