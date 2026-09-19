"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchBalances,
  getBridge,
  prepareAgent,
  prepareWithdraw,
  submitAgent,
  submitWithdraw,
  type BalanceEntry,
  type BridgeConfig,
  type BridgeToken,
} from "@/lib/bridge";
import {
  agentAlreadyAuthorized,
  depositUsdt,
  ensureRethChain,
  loadOrCreateAgent,
  markAgentAuthorized,
  parseAmount6,
  requestAccount,
  signLightPoolTx,
  walletError,
} from "@/lib/wallet";

export type BalanceRow = {
  symbol: string;
  available: string;
  locked: string;
  total: string;
};

type WalletContextValue = {
  address: string | null;
  busy: boolean;
  error: string | null;
  balances: BalanceRow[];
  connect: () => Promise<string>;
  deposit: (amount: string) => Promise<void>;
  withdraw: (amount: string) => Promise<void>;
  refreshBalances: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function alignBalances(
  tokens: BridgeToken[],
  entries: BalanceEntry[],
): BalanceRow[] {
  const bySymbol = new Map(entries.map((entry) => [entry.symbol, entry]));
  return tokens.map((token) => {
    const entry = bySymbol.get(token.symbol);
    return {
      symbol: token.symbol,
      available: entry?.available ?? "0",
      locked: entry?.locked ?? "0",
      total: entry?.total ?? "0",
    };
  });
}

function usdtToken(config: BridgeConfig): BridgeToken {
  const token = config.tokens.find((item) => item.symbol === "USDT");
  if (!token) throw new Error("USDT is not in the bridge config");
  return token;
}

function watchBalances(
  account: string,
  tokens: BridgeToken[],
  apply: (rows: BalanceRow[]) => void,
) {
  void (async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      try {
        const entries = await fetchBalances(account, tokens);
        apply(alignBalances(tokens, entries));
      } catch {
        return;
      }
    }
  })();
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const bridgeRef = useRef<BridgeConfig | null>(null);
  const connectLock = useRef<Promise<string> | null>(null);
  const busyCount = useRef(0);

  const begin = useCallback(() => {
    busyCount.current += 1;
    setBusy(true);
    setError(null);
  }, []);

  const end = useCallback(() => {
    busyCount.current = Math.max(0, busyCount.current - 1);
    setBusy(busyCount.current > 0);
  }, []);

  const loadBridge = useCallback(async () => {
    if (!bridgeRef.current) {
      bridgeRef.current = await getBridge();
    }
    return bridgeRef.current;
  }, []);

  const refreshBalances = useCallback(async () => {
    const account = address;
    if (!account) {
      setBalances([]);
      return;
    }
    const config = await loadBridge();
    const entries = await fetchBalances(account, config.tokens);
    setBalances(alignBalances(config.tokens, entries));
  }, [address, loadBridge]);

  const connect = useCallback(async () => {
    if (connectLock.current) return connectLock.current;
    const run = (async () => {
      begin();
      try {
        const config = await loadBridge();
        const account = await requestAccount();
        await ensureRethChain(config.evm_chain_id, config.evm_rpc);
        if (!agentAlreadyAuthorized(account)) {
          const agent = loadOrCreateAgent(account);
          const prepared = await prepareAgent(account, agent.address);
          const signature = await signLightPoolTx(account, prepared.eip712);
          await submitAgent(prepared.unsigned_tx_hex, signature);
          markAgentAuthorized(account);
        }
        setAddress(account);
        const entries = await fetchBalances(account, config.tokens);
        setBalances(alignBalances(config.tokens, entries));
        watchBalances(account, config.tokens, setBalances);
        return account;
      } catch (err) {
        const wrapped = walletError(err);
        setError(wrapped.message);
        throw wrapped;
      } finally {
        end();
      }
    })();
    connectLock.current = run;
    try {
      return await run;
    } finally {
      connectLock.current = null;
    }
  }, [begin, end, loadBridge]);

  const requireAccount = useCallback(async () => {
    if (address && agentAlreadyAuthorized(address)) {
      const config = await loadBridge();
      await ensureRethChain(config.evm_chain_id, config.evm_rpc);
      return address;
    }
    return connect();
  }, [address, connect, loadBridge]);

  const deposit = useCallback(
    async (amount: string) => {
      begin();
      try {
        const account = await requireAccount();
        const config = await loadBridge();
        await ensureRethChain(config.evm_chain_id, config.evm_rpc);
        const usdt = usdtToken(config);
        await depositUsdt({
          from: account,
          token: usdt.evm,
          bridge: config.evm_bridge,
          amount: parseAmount6(amount),
        });
        const entries = await fetchBalances(account, config.tokens);
        setBalances(alignBalances(config.tokens, entries));
        watchBalances(account, config.tokens, setBalances);
      } catch (err) {
        const wrapped = walletError(err);
        setError(wrapped.message);
        throw wrapped;
      } finally {
        end();
      }
    },
    [begin, end, loadBridge, requireAccount],
  );

  const withdraw = useCallback(
    async (amount: string) => {
      begin();
      try {
        const account = await requireAccount();
        const config = await loadBridge();
        const usdt = usdtToken(config);
        const prepared = await prepareWithdraw({
          user: account,
          token: usdt.lp,
          amount: amount.trim(),
          inbound: usdt.inbound,
          foreign_recipient: account,
        });
        const signature = await signLightPoolTx(account, prepared.eip712);
        await submitWithdraw(prepared.unsigned_tx_hex, signature);
        const entries = await fetchBalances(account, config.tokens);
        setBalances(alignBalances(config.tokens, entries));
        watchBalances(account, config.tokens, setBalances);
      } catch (err) {
        const wrapped = walletError(err);
        setError(wrapped.message);
        throw wrapped;
      } finally {
        end();
      }
    },
    [begin, end, loadBridge, requireAccount],
  );

  const value = useMemo(
    () => ({
      address,
      busy,
      error,
      balances,
      connect,
      deposit,
      withdraw,
      refreshBalances,
    }),
    [address, balances, busy, connect, deposit, error, refreshBalances, withdraw],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside WalletProvider");
  }
  return value;
}
