"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  barsWsUrl,
  getBars,
  type Bar,
  type ChartInterval,
  type Market,
} from "@/lib/api";

const INTERVALS: ChartInterval[] = ["1m", "5m", "15m", "1h"];
const UP = "#0ecb81";
const DOWN = "#f6465d";
const VOL_UP = "rgba(14, 203, 129, 0.55)";
const VOL_DOWN = "rgba(246, 70, 93, 0.55)";

type ChartPanelProps = {
  market: Market | null;
};

function toCandle(bar: Bar): CandlestickData<UTCTimestamp> | null {
  const open = Number(bar.open);
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close);
  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }
  return {
    time: bar.time as UTCTimestamp,
    open,
    high,
    low,
    close,
  };
}

function toVolume(bar: Bar): HistogramData<UTCTimestamp> | null {
  const candle = toCandle(bar);
  const volume = Number(bar.volume);
  if (!candle || !Number.isFinite(volume)) return null;
  return {
    time: bar.time as UTCTimestamp,
    value: volume,
    color: candle.close >= candle.open ? VOL_UP : VOL_DOWN,
  };
}

export function ChartPanel({ market }: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [interval, setInterval] = useState<ChartInterval>("1m");
  const [status, setStatus] = useState<string>("Select a market");
  const [hlCoin, setHlCoin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#12161c" },
        textColor: "#8b95a8",
      },
      grid: {
        vertLines: { color: "#1e2530" },
        horzLines: { color: "#1e2530" },
      },
      rightPriceScale: {
        borderColor: "#2a313c",
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderVisible: false,
        borderColor: "#2a313c",
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 10,
        minBarSpacing: 6,
        rightOffset: 4,
      },
      crosshair: { mode: 0 },
      width: el.clientWidth,
      height: el.clientHeight,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineVisible: false,
    });
    series.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.28 },
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
      borderVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeRef.current = volume;

    const resize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, []);

    useEffect(() => {
    const series = seriesRef.current;
    const volume = volumeRef.current;
    if (!series || !volume) return;
    const candleSeries = series;
    const volumeSeries = volume;

    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let clientAttempt = 0;

    candleSeries.setData([]);
    volumeSeries.setData([]);
    setHlCoin(null);
    setError(null);

    if (!market) {
      setStatus("Select a market");
      return;
    }

    const symbol = market.symbol;
    setStatus(`Loading history for xyz:${symbol}…`);

    function clearReconnectTimer() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function connectLive() {
      if (cancelled) return;
      const ws = new WebSocket(barsWsUrl());
      socket = ws;

      ws.onopen = () => {
        clientAttempt = 0;
        ws.send(
          JSON.stringify({
            op: "subscribe",
            channel: "bars",
            symbol,
            interval,
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            channel?: string;
            event?: string;
            message?: string;
            bar?: Bar;
            hl_coin?: string;
          };
          if (msg.channel !== "bars") return;

          if (msg.event === "reconnecting") {
            setError(null);
            setStatus(msg.message ?? "Reconnecting live feed…");
            return;
          }

          if (msg.event === "error") {
            const text = msg.message ?? "Live bars error";
            if (/connection reset|closing handshake|reconnect/i.test(text)) {
              setError(null);
              setStatus("Live feed interrupted · retrying…");
            } else {
              setError(text);
            }
            return;
          }

          if (msg.event === "subscribed") {
            if (msg.hl_coin) setHlCoin(msg.hl_coin);
            setError(null);
            setStatus(
              `Live · ${msg.hl_coin ?? `xyz:${symbol}`} · ${interval}`,
            );
            return;
          }

          if (msg.bar) {
            const candle = toCandle(msg.bar);
            const vol = toVolume(msg.bar);
            if (candle) candleSeries.update(candle);
            if (vol) volumeSeries.update(vol);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (!cancelled) {
          setError(null);
          setStatus("Live socket error · retrying…");
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        clientAttempt += 1;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(clientAttempt - 1, 5));
        setStatus(`Live disconnected · retrying in ${Math.round(delay / 1000)}s…`);
        clearReconnectTimer();
        reconnectTimer = setTimeout(() => {
          if (!cancelled) connectLive();
        }, delay);
      };
    }

    async function load() {
      try {
        const history = await getBars(symbol, interval, 300);
        if (cancelled) return;

        const candles: CandlestickData<UTCTimestamp>[] = [];
        const volumes: HistogramData<UTCTimestamp>[] = [];
        for (const bar of history.bars) {
          const candle = toCandle(bar);
          const vol = toVolume(bar);
          if (candle && vol) {
            candles.push(candle);
            volumes.push(vol);
          }
        }

        candleSeries.setData(candles);
        volumeSeries.setData(volumes);

        const chart = chartRef.current;
        if (chart) {
          const visible = Math.min(90, Math.max(candles.length, 1));
          const to = candles.length + 2;
          const from = Math.max(-2, to - visible);
          chart.timeScale().applyOptions({
            barSpacing: 12,
            minBarSpacing: 8,
            rightOffset: 6,
          });
          chart.timeScale().setVisibleLogicalRange({ from, to });
        }
        setHlCoin(history.hl_coin);
        setStatus(
          candles.length
            ? `History loaded (${candles.length} bars) · live…`
            : "No history bars yet · waiting for live…",
        );

        connectLive();
      } catch (err) {
        if (!cancelled) {
          candleSeries.setData([]);
          volumeSeries.setData([]);
          setError(err instanceof Error ? err.message : "Failed to load bars");
          setStatus("History failed");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(
              JSON.stringify({
                op: "unsubscribe",
                channel: "bars",
                symbol,
                interval,
              }),
            );
          } catch {
            // ignore
          }
        }
        socket.close();
      }
      socket = null;
    };
  }, [market, interval]);

  return (
    <section className="panel chart-panel">
      <div className="chart-toolbar">
        <div className="interval-group">
          {INTERVALS.map((item) => (
            <button
              key={item}
              type="button"
              className={item === interval ? "active" : undefined}
              onClick={() => setInterval(item)}
              disabled={!market}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="chart-meta">
          {hlCoin ? (
            <span>Hyperliquid reference · {hlCoin}</span>
          ) : (
            <span>Hyperliquid reference · US equity</span>
          )}
        </div>
      </div>
      <div className="chart-body">
        {!market && (
          <div className="chart-empty">Select a market to load bars.</div>
        )}
        {error && <div className="chart-empty error">{error}</div>}
        <div ref={containerRef} className="chart-canvas" />
      </div>
      <div className="chart-status">{status}</div>
    </section>
  );
}
