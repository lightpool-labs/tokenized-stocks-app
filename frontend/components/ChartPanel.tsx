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

    let cancelled = false;
    let socket: WebSocket | null = null;

    series.setData([]);
    volume.setData([]);
    setHlCoin(null);
    setError(null);

    if (!market) {
      setStatus("Select a market");
      return;
    }

    const symbol = market.symbol;
    setStatus(`Loading history for xyz:${symbol}…`);

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

        series.setData(candles);
        volume.setData(volumes);

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

        socket = new WebSocket(barsWsUrl());
        socket.onopen = () => {
          socket?.send(
            JSON.stringify({
              op: "subscribe",
              channel: "bars",
              symbol,
              interval,
            }),
          );
        };
        socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data)) as {
              channel?: string;
              event?: string;
              message?: string;
              bar?: Bar;
              hl_coin?: string;
            };
            if (msg.channel !== "bars") return;
            if (msg.event === "error") {
              setError(msg.message ?? "Live bars error");
              return;
            }
            if (msg.event === "subscribed" && msg.hl_coin) {
              setHlCoin(msg.hl_coin);
              setStatus(`Live · ${msg.hl_coin} · ${interval}`);
              return;
            }
            if (msg.bar) {
              const candle = toCandle(msg.bar);
              const vol = toVolume(msg.bar);
              if (candle) series.update(candle);
              if (vol) volume.update(vol);
            }
          } catch {
            // ignore malformed frames
          }
        };
        socket.onerror = () => {
          if (!cancelled) setError("WebSocket error");
        };
      } catch (err) {
        if (!cancelled) {
          series.setData([]);
          volume.setData([]);
          setError(err instanceof Error ? err.message : "Failed to load bars");
          setStatus("History failed");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            op: "unsubscribe",
            channel: "bars",
            symbol,
            interval,
          }),
        );
      }
      socket?.close();
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
