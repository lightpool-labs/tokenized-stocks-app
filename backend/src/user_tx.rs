use axum::extract::State;
use axum::Json;
use lightpool_sdk::{
    parse_token_contract, ActionBuilder, Address, AuthScheme, BridgeWithdrawParams, ContractAddress,
    SetAgentParams, Signature, Transaction, TransactionBuilder, LIGHTPOOL_EIP712_CHAIN_ID,
    LIGHTPOOL_EIP712_NAME, LIGHTPOOL_EIP712_VERIFYING_CONTRACT, LIGHTPOOL_EIP712_VERSION,
};
use lightpool_sdk::lightpool_types::SignedTransaction;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

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

fn prepared_from_tx(tx: Transaction) -> AppResult<PreparedTxResponse> {
    let digest = tx.digest();
    let digest_hex = format!("0x{}", hex::encode(digest.as_bytes()));
    let bytes = bincode::serialize(&tx)
        .map_err(|e| AppError::Internal(format!("serialize tx: {e}")))?;
    Ok(PreparedTxResponse {
        digest_hex: digest_hex.clone(),
        unsigned_tx_hex: format!("0x{}", hex::encode(bytes)),
        eip712: eip712_typed_data(&digest_hex),
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
    Ok(Json(prepared_from_tx(tx)?))
}

pub async fn submit_agent(
    State(state): State<AppState>,
    Json(body): Json<SubmitSignedBody>,
) -> AppResult<Json<SubmitTxResponse>> {
    submit_signed(&state, &body).await
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
    Ok(Json(prepared_from_tx(tx)?))
}

pub async fn submit_withdraw(
    State(state): State<AppState>,
    Json(body): Json<SubmitSignedBody>,
) -> AppResult<Json<SubmitTxResponse>> {
    submit_signed(&state, &body).await
}

async fn submit_signed(
    state: &AppState,
    body: &SubmitSignedBody,
) -> AppResult<Json<SubmitTxResponse>> {
    let tx = decode_unsigned_tx(&body.unsigned_tx_hex)?;
    let signature = signature_from_rs_hex(&body.signature)?;
    let signed = SignedTransaction::new_with_scheme(tx, signature, AuthScheme::Eip712);
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
