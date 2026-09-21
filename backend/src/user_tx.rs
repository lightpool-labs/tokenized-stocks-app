use axum::extract::State;
use axum::Json;
use lightpool_sdk::{
    parse_token_contract, ActionBuilder, Address, AuthScheme, BridgeWithdrawParams, CancelOrderParams,
    ContractAddress, OrderParamsType, OrderSide, PlaceOrderParams, SetAgentParams, Signature,
    TimeInForce, Transaction, TransactionBuilder, LIGHTPOOL_EIP712_CHAIN_ID, LIGHTPOOL_EIP712_NAME,
    LIGHTPOOL_EIP712_VERIFYING_CONTRACT, LIGHTPOOL_EIP712_VERSION,
};
use lightpool_sdk::lightpool_types::SignedTransaction;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const MARKET_SLIPPAGE_BPS: u64 = 100;

#[derive(Debug, Clone, Serialize)]
struct Eip712DomainJson {
    name: String,
    version: String,
    #[serde(rename = "chainId")]
    chain_id: u64,
    #[serde(rename = "verifyingContract")]
    verifying_contract: String,
}

#[derive(Debug, Clone, Serialize)]
struct Eip712TypeField {
    name: String,
    #[serde(rename = "type")]
    type_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct Eip712TypesJson {
    #[serde(rename = "LightPoolTx")]
    lightpool_tx: Vec<Eip712TypeField>,
}

#[derive(Debug, Clone, Serialize)]
struct Eip712MessageJson {
    digest: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Eip712TypedDataJson {
    domain: Eip712DomainJson,
    types: Eip712TypesJson,
    #[serde(rename = "primaryType")]
    primary_type: String,
    message: Eip712MessageJson,
}

#[derive(Serialize)]
pub struct PreparedTxResponse {
    pub digest_hex: String,
    pub unsigned_tx_hex: String,
    pub eip712: Eip712TypedDataJson,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_scheme: Option<String>,
}

#[derive(Deserialize)]
pub struct PrepareAgentBody {
    user: String,
    agent: String,
}

#[derive(Deserialize)]
pub struct SubmitSignedBody {
    unsigned_tx_hex: String,
    signature: String,
    #[serde(default)]
    auth_scheme: Option<String>,
}

#[derive(Serialize)]
pub struct SubmitTxResponse {
    pub digest: String,
    pub status: String,
}

#[derive(Deserialize)]
pub struct PrepareWithdrawBody {
    user: String,
    token: String,
    amount: String,
    inbound: String,
    foreign_recipient: String,
}

#[derive(Deserialize)]
pub struct PreparePlaceOrderBody {
    user: String,
    agent: String,
    spot_market: String,
    base_token: String,
    quote_token: String,
    side: String,
    size: String,
    #[serde(default)]
    price: Option<String>,
    order_type: String,
}

#[derive(Deserialize)]
pub struct PrepareCancelOrderBody {
    user: String,
    agent: String,
    spot_market: String,
    chain_order_id: String,
}

fn parse_address(raw: &str) -> AppResult<Address> {
    Address::from_str(raw.trim())
        .map_err(|e| AppError::BadRequest(format!("invalid address: {e}")))
}

fn parse_contract(raw: &str) -> AppResult<ContractAddress> {
    parse_token_contract(raw.trim())
        .map_err(|e| AppError::BadRequest(format!("invalid contract: {e}")))
}

fn parse_evm20(raw: &str) -> AppResult<[u8; 20]> {
    let trimmed = raw.trim();
    let body = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    let bytes = hex::decode(body)
        .map_err(|e| AppError::BadRequest(format!("invalid evm address: {e}")))?;
    if bytes.len() != 20 {
        return Err(AppError::BadRequest(
            "foreign_recipient must be a 20-byte address".into(),
        ));
    }
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes);
    Ok(out)
}

pub fn parse_amount_6(raw: &str) -> AppResult<u64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("amount is required".into()));
    }
    let (whole, frac) = match trimmed.split_once('.') {
        Some((whole, frac)) => (whole, frac),
        None => (trimmed, ""),
    };
    if whole.is_empty()
        || !whole.chars().all(|c| c.is_ascii_digit())
        || frac.len() > 6
        || !frac.chars().all(|c| c.is_ascii_digit())
    {
        return Err(AppError::BadRequest(
            "amount must be a positive number with at most 6 decimals".into(),
        ));
    }
    let whole_u: u64 = whole
        .parse()
        .map_err(|_| AppError::BadRequest("amount does not fit uint64".into()))?;
    let frac_padded = format!("{frac:0<6}");
    let frac_u: u64 = frac_padded
        .parse()
        .map_err(|_| AppError::BadRequest("invalid amount fraction".into()))?;
    let scaled = whole_u
        .checked_mul(1_000_000)
        .and_then(|value| value.checked_add(frac_u))
        .ok_or_else(|| AppError::BadRequest("amount does not fit uint64".into()))?;
    if scaled == 0 {
        return Err(AppError::BadRequest("amount must be > 0".into()));
    }
    Ok(scaled)
}

fn eip712_typed_data(digest_hex: &str) -> Eip712TypedDataJson {
    Eip712TypedDataJson {
        domain: Eip712DomainJson {
            name: LIGHTPOOL_EIP712_NAME.to_string(),
            version: LIGHTPOOL_EIP712_VERSION.to_string(),
            chain_id: LIGHTPOOL_EIP712_CHAIN_ID,
            verifying_contract: format!(
                "0x{}",
                hex::encode(LIGHTPOOL_EIP712_VERIFYING_CONTRACT)
            ),
        },
        types: Eip712TypesJson {
            lightpool_tx: vec![Eip712TypeField {
                name: "digest".into(),
                type_name: "bytes32".into(),
            }],
        },
        primary_type: "LightPoolTx".into(),
        message: Eip712MessageJson {
            digest: digest_hex.to_string(),
        },
    }
}

fn prepared_from_tx(tx: Transaction, auth_scheme: Option<&str>) -> AppResult<PreparedTxResponse> {
    let digest = tx.digest();
    let digest_hex = format!("0x{}", hex::encode(digest.as_bytes()));
    let bytes = bincode::serialize(&tx)
        .map_err(|e| AppError::Internal(format!("serialize tx: {e}")))?;
    Ok(PreparedTxResponse {
        digest_hex: digest_hex.clone(),
        unsigned_tx_hex: format!("0x{}", hex::encode(bytes)),
        eip712: eip712_typed_data(&digest_hex),
        auth_scheme: auth_scheme.map(|s| s.to_string()),
    })
}

fn decode_unsigned_tx(hex_raw: &str) -> AppResult<Transaction> {
    let trimmed = hex_raw.trim();
    let body = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    let bytes = hex::decode(body)
        .map_err(|e| AppError::BadRequest(format!("invalid tx hex: {e}")))?;
    bincode::deserialize(&bytes)
        .map_err(|e| AppError::BadRequest(format!("invalid unsigned tx: {e}")))
}

fn signature_from_rs_hex(raw: &str) -> AppResult<Signature> {
    let trimmed = raw.trim();
    let body = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    let bytes = hex::decode(body)
        .map_err(|e| AppError::BadRequest(format!("invalid signature hex: {e}")))?;
    let rs = if bytes.len() == 65 {
        bytes[..64].to_vec()
    } else if bytes.len() == 64 {
        bytes
    } else {
        return Err(AppError::BadRequest(
            "signature must be 64 bytes (r||s)".into(),
        ));
    };
    bincode::deserialize(&rs)
        .map_err(|e| AppError::BadRequest(format!("invalid signature: {e}")))
}

fn parse_auth_scheme(raw: Option<&str>) -> AppResult<AuthScheme> {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        None | Some("") | Some("eip712") => Ok(AuthScheme::Eip712),
        Some("native") | Some("lightpool_native") | Some("lightpoolnative") => {
            Ok(AuthScheme::LightPoolNative)
        }
        Some(other) => Err(AppError::BadRequest(format!(
            "unsupported auth_scheme: {other}"
        ))),
    }
}

pub async fn prepare_agent(
    Json(body): Json<PrepareAgentBody>,
) -> AppResult<Json<PreparedTxResponse>> {
    let user = parse_address(&body.user)?;
    let agent = parse_address(&body.agent)?;
    let action = ActionBuilder::set_agent(SetAgentParams { agent })
        .map_err(|e| AppError::Internal(format!("build set_agent action: {e}")))?;
    let tx = TransactionBuilder::new()
        .sender(user)
        .expiration(u64::MAX)
        .add_action(action)
        .build()
        .map_err(|e| AppError::Internal(format!("build set_agent tx: {e}")))?;
    Ok(Json(prepared_from_tx(tx, Some("eip712"))?))
}

pub async fn submit_agent(
    State(state): State<AppState>,
    Json(body): Json<SubmitSignedBody>,
) -> AppResult<Json<SubmitTxResponse>> {
    submit_signed(&state, &body, AuthScheme::Eip712).await
}

pub async fn prepare_withdraw(
    Json(body): Json<PrepareWithdrawBody>,
) -> AppResult<Json<PreparedTxResponse>> {
    let user = parse_address(&body.user)?;
    let token = parse_contract(&body.token)?;
    let inbound = parse_contract(&body.inbound)?;
    let amount = parse_amount_6(&body.amount)?;
    let foreign_recipient = parse_evm20(&body.foreign_recipient)?;
    let action = ActionBuilder::bridge_withdraw(
        inbound,
        BridgeWithdrawParams {
            token,
            amount,
            foreign_recipient,
        },
    )
    .map_err(|e| AppError::Internal(format!("build bridge_withdraw action: {e}")))?;
    let tx = TransactionBuilder::new()
        .sender(user)
        .expiration(u64::MAX)
        .add_action(action)
        .build()
        .map_err(|e| AppError::Internal(format!("build bridge_withdraw tx: {e}")))?;
    Ok(Json(prepared_from_tx(tx, Some("eip712"))?))
}

pub async fn submit_withdraw(
    State(state): State<AppState>,
    Json(body): Json<SubmitSignedBody>,
) -> AppResult<Json<SubmitTxResponse>> {
    submit_signed(&state, &body, AuthScheme::Eip712).await
}

pub async fn prepare_place_order(
    Json(body): Json<PreparePlaceOrderBody>,
) -> AppResult<Json<PreparedTxResponse>> {
    let user = parse_address(&body.user)?;
    let agent = parse_address(&body.agent)?;
    let spot_market = parse_contract(&body.spot_market)?;
    let base_token = parse_contract(&body.base_token)?;
    let quote_token = parse_contract(&body.quote_token)?;
    let amount = parse_amount_6(&body.size)?;

    let side = match body.side.trim().to_ascii_lowercase().as_str() {
        "buy" => OrderSide::Buy,
        "sell" => OrderSide::Sell,
        other => {
            return Err(AppError::BadRequest(format!("invalid side: {other}")));
        }
    };

    let is_market = matches!(
        body.order_type.trim().to_ascii_lowercase().as_str(),
        "market"
    );

    let (order_type, limit_price) = if is_market {
        // Market still locks quote using `limit_price` as the worst-price bound
        // (`buy_lock_quote(size, bound)`). Pass a realistic mid/ask bound from the
        // client — a huge constant (e.g. $1M) locks size*$1M USDT and fails.
        let bound = parse_amount_6(body.price.as_deref().unwrap_or("")).map_err(|_| {
            AppError::BadRequest(
                "market order requires a bound price near mid (e.g. mid ± slippage)".into(),
            )
        })?;
        (
            OrderParamsType::Market {
                slippage: MARKET_SLIPPAGE_BPS,
            },
            bound,
        )
    } else {
        let price_raw = parse_amount_6(body.price.as_deref().unwrap_or(""))?;
        (
            OrderParamsType::Limit {
                tif: TimeInForce::GTC,
            },
            price_raw,
        )
    };

    let token_address = match side {
        OrderSide::Buy => quote_token,
        OrderSide::Sell => base_token,
    };

    let action = ActionBuilder::place_order(
        spot_market,
        PlaceOrderParams {
            cloid: None,
            side,
            amount,
            order_type,
            limit_price,
            token_address,
        },
    )
    .map_err(|e| AppError::Internal(format!("build place_order action: {e}")))?;

    let tx = TransactionBuilder::new()
        .sender(agent)
        .account(user)
        .expiration(u64::MAX)
        .add_action(action)
        .build()
        .map_err(|e| AppError::Internal(format!("build place_order tx: {e}")))?;

    Ok(Json(prepared_from_tx(tx, Some("native"))?))
}

pub async fn prepare_cancel_order(
    Json(body): Json<PrepareCancelOrderBody>,
) -> AppResult<Json<PreparedTxResponse>> {
    let user = parse_address(&body.user)?;
    let agent = parse_address(&body.agent)?;
    let spot_market = parse_contract(&body.spot_market)?;
    let order_id: u64 = body
        .chain_order_id
        .trim()
        .parse()
        .map_err(|_| AppError::BadRequest("invalid chain_order_id".into()))?;

    let action = ActionBuilder::cancel_order(spot_market, CancelOrderParams { order_id })
        .map_err(|e| AppError::Internal(format!("build cancel_order action: {e}")))?;

    let tx = TransactionBuilder::new()
        .sender(agent)
        .account(user)
        .expiration(u64::MAX)
        .add_action(action)
        .build()
        .map_err(|e| AppError::Internal(format!("build cancel_order tx: {e}")))?;

    Ok(Json(prepared_from_tx(tx, Some("native"))?))
}

pub async fn submit_place_order(
    State(state): State<AppState>,
    Json(body): Json<SubmitSignedBody>,
) -> AppResult<Json<SubmitTxResponse>> {
    let scheme = parse_auth_scheme(body.auth_scheme.as_deref())?;
    submit_signed(&state, &body, scheme).await
}

async fn submit_signed(
    state: &AppState,
    body: &SubmitSignedBody,
    default_scheme: AuthScheme,
) -> AppResult<Json<SubmitTxResponse>> {
    let scheme = match body.auth_scheme.as_deref() {
        Some(raw) => parse_auth_scheme(Some(raw))?,
        None => default_scheme,
    };
    let tx = decode_unsigned_tx(&body.unsigned_tx_hex)?;
    let signature = signature_from_rs_hex(&body.signature)?;
    let signed = SignedTransaction::new_with_scheme(tx, signature, scheme);
    let response = state.clob.submit_transaction(signed).await?;
    if !response.receipt.is_success() {
        return Err(AppError::Internal(format!(
            "transaction failed: {:?}",
            response.receipt.status
        )));
    }
    Ok(Json(SubmitTxResponse {
        digest: response.digest,
        status: "submitted".into(),
    }))
}
