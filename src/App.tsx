import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
} from "lightweight-charts";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type LinePoint = {
  time: number;
  value: number;
};

type MarkerPoint = {
  time: number;
  value: number;
};

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const LIMIT = 500;
const INTERVAL = "15m";
const PRICE_SCALE_WIDTH = 90;

const SYMBOLS = [
  "BTCUSD",
  "ETHUSD",
  "XRPUSD",
  "DE40",
  "US100",
  "US500",
  "GOLD",
  "SILVER",
  "OIL_CRUDE",
  "CORN",
  "SOLUSD",
];

const ENTRY_BAND_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 330.05,
  ETHUSD: 25,
  XRPUSD: 0.015,
  DE40: 35,
  US100: 80,
  US500: 20,
  GOLD: 22,
  SILVER: 0.22,
  OIL_CRUDE: 1.4,
  CORN: 1.4,
  SOLUSD: 1.0,
};

const PEAK_LOOKBACK_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 4,
  ETHUSD: 4,
  XRPUSD: 3,
  DE40: 3,
  US100: 3,
  US500: 3,
  GOLD: 3,
  SILVER: 3,
  OIL_CRUDE: 3,
  CORN: 3,
  SOLUSD: 3,
};

const MIN_KINK_MOVE_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 25,
  ETHUSD: 1.5,
  XRPUSD: 0.002,
  DE40: 2,
  US100: 4,
  US500: 1,
  GOLD: 0.8,
  SILVER: 0.03,
  OIL_CRUDE: 0.08,
  CORN: 0.08,
  SOLUSD: 0.08,
};

export default function App() {
  const priceRef = useRef<HTMLDivElement | null>(null);
  const distRef = useRef<HTMLDivElement | null>(null);

  const priceChartRef = useRef<IChartApi | null>(null);
  const distChartRef = useRef<IChartApi | null>(null);

  const [symbol, setSymbol] = useState("BTCUSD");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [lastPrice, setLastPrice] = useState<number | null>(null);

  const entryBand = useMemo(() => ENTRY_BAND_BY_SYMBOL[symbol] ?? 100, [symbol]);
  const peakLookback = useMemo(() => PEAK_LOOKBACK_BY_SYMBOL[symbol] ?? 3, [symbol]);
  const minKinkMove = useMemo(() => MIN_KINK_MOVE_BY_SYMBOL[symbol] ?? 1, [symbol]);

  useEffect(() => {
    if (!priceRef.current || !distRef.current) return;

    const priceChart = createChart(priceRef.current, {
      width: priceRef.current.clientWidth,
      height: priceRef.current.clientHeight,
      layout: { background: { color: "#0f172a" }, textColor: "#fff" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: {
        borderColor: "#334155",
        minimumWidth: PRICE_SCALE_WIDTH,
      },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "#94a3b8", width: 1, style: 2 },
        horzLine: { color: "#94a3b8", width: 1, style: 2 },
      },
    });

    const distChart = createChart(distRef.current, {
      width: distRef.current.clientWidth,
      height: distRef.current.clientHeight,
      layout: { background: { color: "#0f172a" }, textColor: "#fff" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: {
        borderColor: "#334155",
        minimumWidth: PRICE_SCALE_WIDTH,
      },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "#94a3b8", width: 1, style: 2 },
        horzLine: { color: "#94a3b8", width: 1, style: 2 },
      },
    });

    syncCharts(priceChart, distChart);

    priceChartRef.current = priceChart;
    distChartRef.current = distChart;

    const resize = () => {
      if (priceRef.current) {
        priceChart.applyOptions({
          width: priceRef.current.clientWidth,
          height: priceRef.current.clientHeight,
        });
      }
      if (distRef.current) {
        distChart.applyOptions({
          width: distRef.current.clientWidth,
          height: distRef.current.clientHeight,
        });
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(priceRef.current);
    ro.observe(distRef.current);

    return () => {
      ro.disconnect();
      priceChart.remove();
      distChart.remove();
      priceChartRef.current = null;
      distChartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!priceChartRef.current || !distChartRef.current) return;

    let cancelled = false;

    const priceChart = priceChartRef.current;
    const distChart = distChartRef.current;

    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: "#00e5ff",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#00e5ff",
      wickDownColor: "#ef4444",
    });

    const sma10Series = priceChart.addSeries(LineSeries, {
      color: "#ffff00",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const sma100Series = priceChart.addSeries(LineSeries, {
      color: "#ffffff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const longMarkerSeries = priceChart.addSeries(LineSeries, {
      color: "#22c55e",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 6,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const shortMarkerSeries = priceChart.addSeries(LineSeries, {
      color: "#ef4444",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 6,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const distSeries = distChart.addSeries(LineSeries, {
      color: "#00f0ff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const zeroSeries = distChart.addSeries(LineSeries, {
      color: "#94a3b8",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const upperBandSeries = distChart.addSeries(LineSeries, {
      color: "#ff3b3b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const lowerBandSeries = distChart.addSeries(LineSeries, {
      color: "#ff3b3b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    async function loadData() {
      try {
        setStatus("loading");
        setError("");

        const url = new URL("/api/market-data/klines", BACKEND_BASE);
        url.searchParams.set("provider", "capital");
        url.searchParams.set("symbol", symbol);
        url.searchParams.set("interval", INTERVAL);
        url.searchParams.set("limit", String(LIMIT));

        const res = await fetch(url.toString(), { cache: "no-store" });
        const txt = await res.text();

        let json: any;
        try {
          json = JSON.parse(txt);
        } catch {
          throw new Error(`LOAD ERROR non-JSON response: ${txt}`);
        }

        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || json?.info || `LOAD ERROR ${res.status}: ${txt}`);
        }

        const candles = sanitizeCandles(json.candles || []);
        if (!candles.length) {
          throw new Error("No valid candles returned");
        }

        const sma10 = sanitizeLinePoints(calcSMA(candles, 10));
        const sma100 = sanitizeLinePoints(calcSMA(candles, 100));
        const dist = sanitizeLinePoints(calcDistance(sma10, sma100));

        const longMarkers = buildStableLongSignals(
          candles,
          dist,
          entryBand,
          peakLookback,
          minKinkMove
        );

        const shortMarkers = buildStableShortSignals(
          candles,
          dist,
          entryBand,
          peakLookback,
          minKinkMove
        );

        if (cancelled) return;

        candleSeries.setData(candles as any);
        sma10Series.setData(sma10 as any);
        sma100Series.setData(sma100 as any);
        longMarkerSeries.setData(longMarkers as any);
        shortMarkerSeries.setData(shortMarkers as any);

        distSeries.setData(dist as any);
        zeroSeries.setData(buildFlatLineFromLine(dist, 0) as any);
        upperBandSeries.setData(buildFlatLineFromLine(dist, entryBand) as any);
        lowerBandSeries.setData(buildFlatLineFromLine(dist, -entryBand) as any);

        priceChart.timeScale().fitContent();
        const range = priceChart.timeScale().getVisibleLogicalRange();
        if (range) {
          distChart.timeScale().setVisibleLogicalRange(range);
        }

        setLastPrice(candles[candles.length - 1]?.close ?? null);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error(err);
      }
    }

    loadData();

    return () => {
      cancelled = true;
      try {
        priceChart.removeSeries(candleSeries);
        priceChart.removeSeries(sma10Series);
        priceChart.removeSeries(sma100Series);
        priceChart.removeSeries(longMarkerSeries);
        priceChart.removeSeries(shortMarkerSeries);
        distChart.removeSeries(distSeries);
        distChart.removeSeries(zeroSeries);
        distChart.removeSeries(upperBandSeries);
        distChart.removeSeries(lowerBandSeries);
      } catch {}
    };
  }, [symbol, entryBand, peakLookback, minKinkMove]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0f172a",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: 8, display: "flex", gap: 12, alignItems: "center" }}>
        <label>
          Symbol{" "}
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div>Status: {status}</div>
        <div>Last: {lastPrice !== null ? lastPrice.toFixed(2) : "-"}</div>
        <div>Band: {entryBand}</div>
        <div>Lookback: {peakLookback}</div>
        <div>Min kink: {minKinkMove}</div>
        {error ? <div style={{ color: "#fca5a5" }}>{error}</div> : null}
      </div>

      <div ref={priceRef} style={{ flex: "0 0 72%", minHeight: 0 }} />
      <div
        ref={distRef}
        style={{
          flex: "0 0 28%",
          minHeight: 0,
          borderTop: "1px solid #334155",
        }}
      />
    </div>
  );
}

function syncCharts(chartA: IChartApi, chartB: IChartApi) {
  let isUpdating = false;

  const syncFromA = (range: any) => {
    if (!range || isUpdating) return;
    isUpdating = true;
    chartB.timeScale().setVisibleLogicalRange(range);
    isUpdating = false;
  };

  const syncFromB = (range: any) => {
    if (!range || isUpdating) return;
    isUpdating = true;
    chartA.timeScale().setVisibleLogicalRange(range);
    isUpdating = false;
  };

  chartA.timeScale().subscribeVisibleLogicalRangeChange(syncFromA);
  chartB.timeScale().subscribeVisibleLogicalRangeChange(syncFromB);
}

function sanitizeCandles(data: any[]): Candle[] {
  return (data || [])
    .filter(
      (c) =>
        c &&
        c.time != null &&
        c.open != null &&
        c.high != null &&
        c.low != null &&
        c.close != null
    )
    .map((c) => ({
      time: Number(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        c.open > 0 &&
        c.high > 0 &&
        c.low > 0 &&
        c.close > 0
    );
}

function sanitizeLinePoints(points: any[]): LinePoint[] {
  return (points || [])
    .filter((p) => p && p.time != null && p.value != null)
    .map((p) => ({
      time: Number(p.time),
      value: Number(p.value),
    }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value));
}

function calcSMA(data: Candle[], len: number): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = len - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < len; j++) sum += data[i - j].close;
    out.push({ time: data[i].time, value: sum / len });
  }
  return out;
}

function calcDistance(a: LinePoint[], b: LinePoint[]): LinePoint[] {
  const map = new Map<number, number>();
  for (const p of b) map.set(p.time, p.value);

  return a
    .map((p) => {
      const other = map.get(p.time);
      if (other == null) return null;
      const value = p.value - other;
      if (!Number.isFinite(value)) return null;
      return { time: p.time, value };
    })
    .filter(Boolean) as LinePoint[];
}

function buildFlatLineFromLine(base: LinePoint[], value: number): LinePoint[] {
  return base.map((p) => ({ time: p.time, value }));
}

function buildStableLongSignals(
  candles: Candle[],
  dist: LinePoint[],
  entryBand: number,
  peakLookback: number,
  minKinkMove: number
): MarkerPoint[] {
  const candleMap = new Map<number, Candle>();
  for (const c of candles) candleMap.set(c.time, c);

  const markers: MarkerPoint[] = [];
  let inZone = false;
  let zoneStart = -1;

  for (let i = 1; i < dist.length; i++) {
    const p = dist[i];

    if (!inZone && p.value < -entryBand) {
      inZone = true;
      zoneStart = i;
      continue;
    }

    if (inZone && p.value >= -entryBand) {
      const zoneEnd = i - 1;
      const best = findBestLongIndexStable(
        dist,
        zoneStart,
        zoneEnd,
        peakLookback,
        minKinkMove
      );
      if (best >= 0) {
        const t = dist[best].time;
        const c = candleMap.get(t);
        if (c) markers.push({ time: t, value: c.low });
      }
      inZone = false;
      zoneStart = -1;
    }
  }

  if (inZone) {
    const best = findBestLongIndexStable(
      dist,
      zoneStart,
      dist.length - 1,
      peakLookback,
      minKinkMove
    );
    if (best >= 0) {
      const t = dist[best].time;
      const c = candleMap.get(t);
      if (c) markers.push({ time: t, value: c.low });
    }
  }

  return dedupeMarkers(markers);
}

function buildStableShortSignals(
  candles: Candle[],
  dist: LinePoint[],
  entryBand: number,
  peakLookback: number,
  minKinkMove: number
): MarkerPoint[] {
  const candleMap = new Map<number, Candle>();
  for (const c of candles) candleMap.set(c.time, c);

  const markers: MarkerPoint[] = [];
  let inZone = false;
  let zoneStart = -1;

  for (let i = 1; i < dist.length; i++) {
    const p = dist[i];

    if (!inZone && p.value > entryBand) {
      inZone = true;
      zoneStart = i;
      continue;
    }

    if (inZone && p.value <= entryBand) {
      const zoneEnd = i - 1;
      const best = findBestShortIndexStable(
        dist,
        zoneStart,
        zoneEnd,
        peakLookback,
        minKinkMove
      );
      if (best >= 0) {
        const t = dist[best].time;
        const c = candleMap.get(t);
        if (c) markers.push({ time: t, value: c.high });
      }
      inZone = false;
      zoneStart = -1;
    }
  }

  if (inZone) {
    const best = findBestShortIndexStable(
      dist,
      zoneStart,
      dist.length - 1,
      peakLookback,
      minKinkMove
    );
    if (best >= 0) {
      const t = dist[best].time;
      const c = candleMap.get(t);
      if (c) markers.push({ time: t, value: c.high });
    }
  }

  return dedupeMarkers(markers);
}

function findBestLongIndexStable(
  dist: LinePoint[],
  start: number,
  end: number,
  lookback: number,
  minKinkMove: number
): number {
  if (start < 0 || end < start) return -1;

  let bestIndex = -1;
  let bestValue = Number.POSITIVE_INFINITY;

  for (let i = start; i <= end; i++) {
    const p = dist[i];
    if (!p) continue;

    const left = Math.max(start, i - lookback);
    const right = Math.min(end, i + lookback);

    let isLocalMin = true;
    for (let j = left; j <= right; j++) {
      if (j === i) continue;
      if (dist[j] && dist[j].value < p.value) {
        isLocalMin = false;
        break;
      }
    }

    if (!isLocalMin) continue;

    const prev = dist[i - 1];
    const next = dist[i + 1];
    const leftMove = prev ? prev.value - p.value : 0;
    const rightMove = next ? next.value - p.value : 0;
    const kinkStrength = Math.max(leftMove, rightMove);

    if (kinkStrength >= minKinkMove && p.value < bestValue) {
      bestValue = p.value;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0) return bestIndex;

  for (let i = start; i <= end; i++) {
    const p = dist[i];
    if (p && p.value < bestValue) {
      bestValue = p.value;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function findBestShortIndexStable(
  dist: LinePoint[],
  start: number,
  end: number,
  lookback: number,
  minKinkMove: number
): number {
  if (start < 0 || end < start) return -1;

  let bestIndex = -1;
  let bestValue = Number.NEGATIVE_INFINITY;

  for (let i = start; i <= end; i++) {
    const p = dist[i];
    if (!p) continue;

    const left = Math.max(start, i - lookback);
    const right = Math.min(end, i + lookback);

    let isLocalMax = true;
    for (let j = left; j <= right; j++) {
      if (j === i) continue;
      if (dist[j] && dist[j].value > p.value) {
        isLocalMax = false;
        break;
      }
    }

    if (!isLocalMax) continue;

    const prev = dist[i - 1];
    const next = dist[i + 1];
    const leftMove = prev ? p.value - prev.value : 0;
    const rightMove = next ? p.value - next.value : 0;
    const kinkStrength = Math.max(leftMove, rightMove);

    if (kinkStrength >= minKinkMove && p.value > bestValue) {
      bestValue = p.value;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0) return bestIndex;

  for (let i = start; i <= end; i++) {
    const p = dist[i];
    if (p && p.value > bestValue) {
      bestValue = p.value;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function dedupeMarkers(points: MarkerPoint[]): MarkerPoint[] {
  const out: MarkerPoint[] = [];
  const seen = new Set<string>();

  for (const p of points) {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.value) || p.value <= 0) continue;
    const key = `${p.time}-${p.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }

  return out;
}
