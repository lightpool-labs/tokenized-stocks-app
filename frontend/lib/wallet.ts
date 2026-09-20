import { keccak_256 } from "@noble/hashes/sha3";
import { getPublicKey, utils } from "@noble/secp256k1";

export type Eip712Payload = {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: {
    LightPoolTx: Array<{ name: string; type: string }>;
  };
  primaryType: string;
  message: {
    digest: string;
  };
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type StoredAgent = {
  privateKey: string;
  address: string;
  authorized: boolean;
};

const APPROVE_SELECTOR = selector("approve(address,uint256)");
const DEPOSIT_SELECTOR = selector("deposit(address,uint64,address)");

function selector(signature: string): string {
  const hash = keccak_256(new TextEncoder().encode(signature));
  return bytesToHex(hash.slice(0, 4));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getProvider(): EthereumProvider {
  const ethereum = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  if (!ethereum?.request) {
    throw new Error("MetaMask is not installed");
  }
  return ethereum;
}

export function walletError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object" && "message" in error) {
    return new Error(String((error as { message: unknown }).message));
  }
  return new Error("Wallet request failed");
}

export function shortAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function agentStorageKey(user: string): string {
  return `lp-agent:${user.toLowerCase()}`;
}

function readAgent(user: string): StoredAgent | null {
  const raw = sessionStorage.getItem(agentStorageKey(user));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredAgent;
    if (!parsed.address || !parsed.privateKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getAgent(user: string): StoredAgent | null {
  return readAgent(user);
}

function writeAgent(user: string, agent: StoredAgent) {
  sessionStorage.setItem(agentStorageKey(user), JSON.stringify(agent));
}

export function loadOrCreateAgent(user: string): StoredAgent {
  const existing = readAgent(user);
  if (existing) return existing;

  const privateKey = utils.randomPrivateKey();
  const publicKey = getPublicKey(privateKey, false);
  const hash = keccak_256(publicKey.slice(1));
  const agent: StoredAgent = {
    privateKey: `0x${bytesToHex(privateKey)}`,
    address: `0x${bytesToHex(hash.slice(-20))}`,
    authorized: false,
  };
  writeAgent(user, agent);
  return agent;
}

export function markAgentAuthorized(user: string) {
  const agent = readAgent(user);
  if (!agent) return;
  agent.authorized = true;
  writeAgent(user, agent);
}

export function agentAlreadyAuthorized(user: string): boolean {
  return readAgent(user)?.authorized === true;
}

export async function requestAccount(): Promise<string> {
  const accounts = (await getProvider().request({
    method: "eth_requestAccounts",
  })) as string[];
  const account = accounts[0];
  if (!account) {
    throw new Error("MetaMask returned no account");
  }
  return account;
}

export async function ensureRethChain(chainId: number, rpcUrl: string) {
  const provider = getProvider();
  const target = `0x${chainId.toString(16)}`;
  const current = String(
    await provider.request({ method: "eth_chainId" }),
  ).toLowerCase();
  if (current === target.toLowerCase()) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target }],
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? Number((error as { code: unknown }).code)
        : 0;
    if (code !== 4902) throw walletError(error);
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: target,
          chainName: "LightPool Local Reth",
          rpcUrls: [rpcUrl],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
      ],
    });
  }
}

export async function signLightPoolTx(
  account: string,
  eip712: Eip712Payload,
): Promise<string> {
  const typed = {
    domain: eip712.domain,
    primaryType: eip712.primaryType,
    message: eip712.message,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      LightPoolTx: eip712.types.LightPoolTx,
    },
  };
  const signature = String(
    await getProvider().request({
      method: "eth_signTypedData_v4",
      params: [account, JSON.stringify(typed)],
    }),
  );
  return compactRs(signature);
}

function compactRs(signature: string): string {
  const body = signature.startsWith("0x") ? signature.slice(2) : signature;
  if (body.length === 128) return `0x${body.toLowerCase()}`;
  if (body.length === 130) return `0x${body.slice(0, 128).toLowerCase()}`;
  throw new Error("MetaMask signature must be 65 bytes");
}

export function parseAmount6(raw: string): bigint {
  const trimmed = raw.trim();
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(trimmed);
  if (!match) {
    throw new Error("amount must be a positive number with at most 6 decimals");
  }
  const whole = BigInt(match[1]);
  const frac = (match[2] ?? "").padEnd(6, "0");
  const scaled = whole * BigInt(1000000) + BigInt(frac || "0");
  if (scaled <= BigInt(0)) {
    throw new Error("amount must be > 0");
  }
  if (scaled > BigInt("18446744073709551615")) {
    throw new Error("amount does not fit uint64");
  }
  return scaled;
}

function encodeWord(value: string): string {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function encodeAmount(amount: bigint): string {
  return amount.toString(16).padStart(64, "0");
}

async function sendAndWait(tx: {
  from: string;
  to: string;
  data: string;
  gas: string;
}): Promise<void> {
  const provider = getProvider();
  const hash = String(
    await provider.request({
      method: "eth_sendTransaction",
      params: [tx],
    }),
  );
  for (let i = 0; i < 60; i += 1) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status && receipt.status !== "0x1") {
        throw new Error("transaction reverted");
      }
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error("timed out waiting for the transaction receipt");
}

export async function depositToken(input: {
  from: string;
  token: string;
  bridge: string;
  amount: bigint;
}) {
  const approveData =
    "0x" +
    APPROVE_SELECTOR +
    encodeWord(input.bridge) +
    encodeAmount(input.amount);
  await sendAndWait({
    from: input.from,
    to: input.token,
    data: approveData,
    gas: "0x7a120",
  });

  const depositData =
    "0x" +
    DEPOSIT_SELECTOR +
    encodeWord(input.token) +
    encodeAmount(input.amount) +
    encodeWord(input.from);
  await sendAndWait({
    from: input.from,
    to: input.bridge,
    data: depositData,
    gas: "0xf4240",
  });
}

/** @deprecated Use depositToken */
export const depositUsdt = depositToken;
