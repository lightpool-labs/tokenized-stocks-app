"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchBalances,
  getBridge,
  prepareAgent,
  prepareCancelOrder,
  preparePlaceOrder,
  prepareWithdraw,
  submitAgent,
  submitCancelOrder,
  submitPlaceOrder,
  submitWithdraw,
  type BalanceEntry,
  type BridgeConfig,
  type BridgeToken,
} from "@/lib/bridge";
import { signDigestNative } from "@/lib/agentSign";
import {
  fetchUserOrders,
  isHistoryStatus,
  isOpenStatus,
  subscribeUserOrders,
  type ListedOrder,
  type TradeFill,
} from "@/lib/userOrders";
import {
  agentAlreadyAuthorized,
  depositToken,
  ensureRethChain,
  getAgent,
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

type PlaceOrderInput = {
  spot_market: string;
  base_token: string;
  quote_token: string;
  side: "buy" | "sell";
  size: string;
  price?: string;
  order_type: "limit" | "market";
};

type WalletContextValue = {
  address: string | null;
  busy: boolean;
  error: string | null;
  balances: BalanceRow[];
  tokens: BridgeToken[];
  tradingEnabled: boolean;
  openOrders: ListedOrder[];
  orderHistory: ListedOrder[];
  tradeHistory: TradeFill[];
  connect: () => Promise<string>;
  enableTrading: () => Promise<void>;
  placeOrder: (input: PlaceOrderInput) => Promise<void>;
  cancelOrder: (order: ListedOrder) => Promise<void>;
  deposit: (symbol: string, amount: string) => Promise<void>;
  withdraw: (symbol: string, amount: string) => Promise<void>;
  refreshBalances: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function tradingKey(user: string): string {
  return `lp-trading-enabled:${user.toLowerCase()}`;
}

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

function findToken(config: BridgeConfig, symbol: string): BridgeToken {
  const token = config.tokens.find(
    (item) => item.symbol.toUpperCase() === symbol.trim().toUpperCase(),
  );
  if (!token) {
    throw new Error(`${symbol} is not in the bridge config`);
  }
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
  const [tokens, setTokens] = useState<BridgeToken[]>([]);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [openOrders, setOpenOrders] = useState<ListedOrder[]>([]);
  const [orderHistory, setOrderHistory] = useState<ListedOrder[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeFill[]>([]);
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
      setTokens(bridgeRef.current.tokens);
    }
    return bridgeRef.current;
  }, []);

  useEffect(() => {
    void loadBridge().catch(() => undefined);
  }, [loadBridge]);

  const applyOrders = useCallback((orders: ListedOrder[]) => {
    setOpenOrders(orders.filter((order) => isOpenStatus(order.status)));
    setOrderHistory(orders.filter((order) => isHistoryStatus(order.status)));
  }, []);

  useEffect(() => {
    if (!address) {
      setOpenOrders([]);
      setOrderHistory([]);
      setTradeHistory([]);
      setTradingEnabled(false);
      return;
    }
    setTradingEnabled(sessionStorage.getItem(tradingKey(address)) === "1");
    return subscribeUserOrders(address, {
      onOrders: applyOrders,
      onTrades: setTradeHistory,
    });
  }, [address, applyOrders]);

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
        setTradingEnabled(sessionStorage.getItem(tradingKey(account)) === "1");
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

  const enableTrading = useCallback(async () => {
    begin();
    try {
      const account = await requireAccount();
      if (!agentAlreadyAuthorized(account)) {
        const agent = loadOrCreateAgent(account);
        const prepared = await prepareAgent(account, agent.address);
        const signature = await signLightPoolTx(account, prepared.eip712);
        await submitAgent(prepared.unsigned_tx_hex, signature);
        markAgentAuthorized(account);
      } else {
        loadOrCreateAgent(account);
      }
      sessionStorage.setItem(tradingKey(account), "1");
      setTradingEnabled(true);
    } catch (err) {
      const wrapped = walletError(err);
      setError(wrapped.message);
      throw wrapped;
    } finally {
      end();
    }
  }, [begin, end, requireAccount]);

  const placeOrder = useCallback(
    async (input: PlaceOrderInput) => {
      begin();
      try {
        const account = await requireAccount();
        if (sessionStorage.getItem(tradingKey(account)) !== "1") {
          throw new Error("Enable trading first");
        }
        const agent = getAgent(account);
        if (!agent?.privateKey) {
          throw new Error("Missing session agent key; Connect again");
        }
        parseAmount6(input.size);
        if (input.order_type === "limit" || input.order_type === "market") {
          parseAmount6(input.price ?? "");
        }
        const prepared = await preparePlaceOrder({
          user: account,
          agent: agent.address,
          spot_market: input.spot_market,
          base_token: input.base_token,
          quote_token: input.quote_token,
          side: input.side,
          size: input.size.trim(),
          price: input.price?.trim(),
          order_type: input.order_type,
        });
        const signature = signDigestNative(
          prepared.digest_hex,
          agent.privateKey,
        );
        await submitPlaceOrder(
          prepared.unsigned_tx_hex,
          signature,
          prepared.auth_scheme ?? "native",
        );
        const config = await loadBridge();
        const entries = await fetchBalances(account, config.tokens);
        setBalances(alignBalances(config.tokens, entries));
        watchBalances(account, config.tokens, setBalances);
        try {
          const listed = await fetchUserOrders(account);
          applyOrders(listed);
        } catch {
          // WS subscription still updates when the index catches up.
        }
      } catch (err) {
        const wrapped = walletError(err);
        setError(wrapped.message);
        throw wrapped;
      } finally {
        end();
      }
    },
    [applyOrders, begin, end, loadBridge, requireAccount],
  );

  const cancelOrder = useCallback(
    async (order: ListedOrder) => {
      begin();
      try {
        const account = await requireAccount();
        if (sessionStorage.getItem(tradingKey(account)) !== "1") {
          throw new Error("Enable trading first");
        }
        const agent = getAgent(account);
        if (!agent?.privateKey) {
          throw new Error("Missing session agent key; Connect again");
        }
        const spotMarket = order.spot_market?.trim();
        const chainOrderId = order.chain_order_id?.trim();
        if (!spotMarket || !chainOrderId) {
          throw new Error("Order is missing spot market or chain order id");
        }
        const prepared = await prepareCancelOrder({
          user: account,
          agent: agent.address,
          spot_market: spotMarket,
          chain_order_id: chainOrderId,
        });
        const signature = signDigestNative(
          prepared.digest_hex,
          agent.privateKey,
        );
        await submitCancelOrder(
          prepared.unsigned_tx_hex,
          signature,
          prepared.auth_scheme ?? "native",
        );
        const config = await loadBridge();
        const entries = await fetchBalances(account, config.tokens);
        setBalances(alignBalances(config.tokens, entries));
        watchBalances(account, config.tokens, setBalances);
        try {
          const listed = await fetchUserOrders(account);
          applyOrders(listed);
        } catch {
          // WS subscription still updates when the index catches up.
        }
      } catch (err) {
        const wrapped = walletError(err);
        setError(wrapped.message);
        throw wrapped;
      } finally {
        end();
      }
    },
    [applyOrders, begin, end, loadBridge, requireAccount],
  );

  const deposit = useCallback(
    async (symbol: string, amount: string) => {
      begin();
      try {
        const account = await requireAccount();
        const config = await loadBridge();
        await ensureRethChain(config.evm_chain_id, config.evm_rpc);
        const token = findToken(config, symbol);
        await depositToken({
          from: account,
          token: token.evm,
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
    async (symbol: string, amount: string) => {
      begin();
      try {
        const account = await requireAccount();
        const config = await loadBridge();
        const token = findToken(config, symbol);
        const prepared = await prepareWithdraw({
          user: account,
          token: token.lp,
          amount: amount.trim(),
          inbound: token.inbound,
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
      tokens,
      tradingEnabled,
      openOrders,
      orderHistory,
      tradeHistory,
      connect,
      enableTrading,
      placeOrder,
      cancelOrder,
      deposit,
      withdraw,
      refreshBalances,
    }),
    [
      address,
      balances,
      busy,
      cancelOrder,
      connect,
      deposit,
      enableTrading,
      error,
      openOrders,
      orderHistory,
      placeOrder,
      refreshBalances,
      tokens,
      tradeHistory,
      tradingEnabled,
      withdraw,
    ],
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
