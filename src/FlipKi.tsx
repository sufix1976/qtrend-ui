import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type Time,
} from "lightweight-charts";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["DE40", "US30", "US100", "UK100", "J225", "CN50", "BTCUSD", "ETHUSD", "GOLD"];
const INTERVALS = ["1m", "5m", "10m", "15m", "30m", "1h"];
const SOURCE = "guardian_marker";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type MarkerSide = "long" | "short";
type ReviewLabel = "good" | "bad" | "unsure";

type StrategyMarker = {
  marker_id: string;
  symbol: string;
  interval: string;
  time: number;
  price: number;
  side: MarkerSide;
  scanner_version?: string;
  features?: Record<string, number>;
};

type Annotation = {
  id: number;
  symbol: string;
  interval: string;
  time: number;
  price: number | null;
  side: MarkerSide;
  label: ReviewLabel;
  source: string;
  note?: string | null;
};

type GuardianResponse = {
  ok: boolean;
  version: string;
  source: string;
  symbol: string;
  interval: string;
  candle_count: number;
  marker_count: number;
  candles: Candle[];
  markers: StrategyMarker[];
  annotations: Annotation[];
  annotation_map: Record<string, Annotation>;
  counts: { reviewed: number; good: number; bad: number; unsure: number };
  error?: string;
  details?: string;
};

function formatTime(time: number) {
  return new Date(time * 1000).toLocaleString("de-DE");
}

function featureName(key: string) {
  const names: Record<string, string> = {
    macd_histogram: "MACD Histogramm",
    macd_histogram_atr: "Histogramm / ATR",
    macd_slope: "MACD Steigung",
    macd_slope_atr: "MACD Steigung / ATR",
    macd_histogram_speed: "Histogramm Speed",
    rsi: "RSI",
    rsi_delta_1: "RSI Δ1",
    rsi_delta_3: "RSI Δ3",
    adx: "ADX",
    plus_di: "+DI",
    minus_di: "-DI",
    di_difference: "DI Differenz",
    bb_position: "Bollinger Position",
    bb_width_norm: "Bollinger Breite / ATR",
    trend_credit: "Trend",
    momentum: "Momentum",
    energy: "Energy",
    structure: "Structure",
    body_atr: "Kerzenkörper / ATR",
    range_atr: "Kerzenrange / ATR",
  };
  return names[key] || key;
}

export default function FlipKi() {
  const [symbol, setSymbol] = useState("US30");
  const [interval, setInterval] = useState("15m");
  const [data, setData] = useState<GuardianResponse | null>(null);
  const [selected, setSelected] = useState<StrategyMarker | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showReviewed, setShowReviewed] = useState(true);
  const chartHost = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const visibleRangeRef = useRef<any>(null);

  const candles = data?.candles || [];
  const markers = data?.markers || [];
  const annotationMap = data?.annotation_map || {};
  const selectedAnnotation = selected ? annotationMap[`${selected.time}:${selected.side}`] : undefined;

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${BACKEND_BASE}/trainer/flip-guardian/data?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=5000&_ts=${Date.now()}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as GuardianResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.details || payload.error || `HTTP ${response.status}`);
      setData(payload);
      setSelected((current) => {
        if (!current) return payload.markers[0] || null;
        return payload.markers.find((item) => item.marker_id === current.marker_id) || payload.markers[0] || null;
      });
    } catch (exception: any) {
      setData(null);
      setError(exception?.message || String(exception));
    } finally {
      setLoading(false);
    }
  }

  async function review(label: ReviewLabel) {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${BACKEND_BASE}/trainer/annotation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selected.symbol,
          interval: selected.interval,
          time: selected.time,
          price: selected.price,
          side: selected.side,
          label,
          source: SOURCE,
          scanner_version: selected.scanner_version || "QTREND_PINE_MIRROR",
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      visibleRangeRef.current =
  chartRef.current?.timeScale().getVisibleLogicalRange() || null;
      await load();
      const index = markers.findIndex((item) => item.marker_id === selected.marker_id);
      const next = markers[index + 1];
      if (next) setSelected(next);
    } catch (exception: any) {
      setError(exception?.message || String(exception));
    } finally {
      setSaving(false);
    }
  }

  async function removeReview() {
    if (!selected || !selectedAnnotation) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${BACKEND_BASE}/trainer/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selected.symbol,
          interval: selected.interval,
          time: selected.time,
          side: selected.side,
          source: SOURCE,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      await load();
    } catch (exception: any) {
      setError(exception?.message || String(exception));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => { void load(); }, [symbol, interval]);

  useEffect(() => {
    if (!chartHost.current || !candles.length) return;
    chartHost.current.innerHTML = "";
    const chart = createChart(chartHost.current, {
      height: 650,
      layout: { background: { color: "#07111f" }, textColor: "#a9b8ca" },
      grid: { vertLines: { color: "#142235" }, horzLines: { color: "#142235" } },
      rightPriceScale: { borderColor: "#26364b" },
      timeScale: { borderColor: "#26364b", timeVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444", wickUpColor: "#22c55e", wickDownColor: "#ef4444", borderVisible: false,
    });
    series.setData(candles.map((item) => ({ ...item, time: item.time as Time })));

    const visibleMarkers = markers.filter((item) => showReviewed || !annotationMap[`${item.time}:${item.side}`]);
    createSeriesMarkers(series, visibleMarkers.map((item) => {
      const annotation = annotationMap[`${item.time}:${item.side}`];
      const isSelected = selected?.marker_id === item.marker_id;
      const color = annotation?.label === "good" ? "#22c55e" : annotation?.label === "bad" ? "#ef4444" : annotation?.label === "unsure" ? "#f59e0b" : "#38bdf8";
      const text = annotation ? annotation.label.toUpperCase() : item.side.toUpperCase();
      return {
        time: item.time as Time,
        position: item.side === "short" ? "aboveBar" : "belowBar",
        shape: item.side === "short" ? "arrowDown" : "arrowUp",
        color: isSelected ? "#ffffff" : color,
        text,
      };
    }) as any);

    chart.subscribeClick((param) => {
      const clickedTime = Number(param.time);
      if (!Number.isFinite(clickedTime)) return;
      const nearest = markers.reduce<StrategyMarker | null>((best, item) => {
        if (!best) return item;
        return Math.abs(item.time - clickedTime) < Math.abs(best.time - clickedTime) ? item : best;
      }, null);
      if (nearest) setSelected(nearest);
    });

    if (visibleRangeRef.current) {
  chart.timeScale().setVisibleLogicalRange(
    visibleRangeRef.current,
  );
} else {
  chart.timeScale().fitContent();
}
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; };
  }, [candles, markers, annotationMap, selected?.marker_id, showReviewed]);

  function choose(marker: StrategyMarker) {
    setSelected(marker);
    const index = candles.findIndex((item) => item.time >= marker.time);
    if (index >= 0) chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, index - 35), to: Math.min(candles.length - 1, index + 35) });
  }

  const featureRows = useMemo(() => {
    if (!selected?.features) return [];
    const preferred = ["macd_histogram", "macd_histogram_atr", "macd_slope", "macd_histogram_speed", "rsi", "rsi_delta_1", "rsi_delta_3", "adx", "plus_di", "minus_di", "di_difference", "bb_position", "bb_width_norm", "trend_credit", "momentum", "energy", "structure", "body_atr", "range_atr"];
    return preferred.map((key) => [key, Number(selected.features?.[key])]).filter(([, value]) => Number.isFinite(value));
  }, [selected]);

  const reviewed = data?.counts?.reviewed || 0;
  const progress = markers.length ? (reviewed / markers.length) * 100 : 0;

  return (
    <div className="guardian-page">
      <header className="guardian-header">
        <div>
          <b>QTrend Strategy Flip Guardian</b>
          <span>Nur bestätigte Strategie-Marker · keine internen Kandidaten · keine Orders</span>
        </div>
        <div className="guardian-controls">
          <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{SYMBOLS.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={interval} onChange={(event) => setInterval(event.target.value)}>{INTERVALS.map((item) => <option key={item}>{item}</option>)}</select>
          <label><input type="checkbox" checked={showReviewed} onChange={(event) => setShowReviewed(event.target.checked)} /> Bewertete anzeigen</label>
          <button onClick={() => void load()} disabled={loading}>{loading ? "LÄDT …" : "NEU LADEN"}</button>
          <button className="scout-button" disabled title="Wird als eigenes, unabhängiges Labor gebaut">KI-SCOUT · EIGENES FENSTER</button>
        </div>
      </header>

      {error && <div className="guardian-error">{error}</div>}

      <main className="guardian-layout">
        <section className="guardian-chart-panel">
          <div className="guardian-progress">
            <span>Strategie-Marker <b>{markers.length}</b></span>
            <span>Bewertet <b>{reviewed}</b></span>
            <span className="good">GOOD <b>{data?.counts?.good || 0}</b></span>
            <span className="bad">BAD <b>{data?.counts?.bad || 0}</b></span>
            <span>UNSICHER <b>{data?.counts?.unsure || 0}</b></span>
            <div><i style={{ width: `${progress}%` }} /></div>
          </div>
          <div ref={chartHost} />
        </section>

        <aside className="guardian-sidebar">
          {selected ? (
            <>
              <div className={`guardian-selection ${selectedAnnotation?.label || "open"}`}>
                <small>BESTÄTIGTER STRATEGIE-MARKER</small>
                <strong>{selected.side.toUpperCase()}</strong>
                <span>{formatTime(selected.time)}</span>
                <span>Preis <b>{selected.price.toFixed(2)}</b></span>
                <span>Status <b>{selectedAnnotation?.label.toUpperCase() || "NOCH OFFEN"}</b></span>
              </div>

              <div className="guardian-review-buttons">
                <button className="good" onClick={() => void review("good")} disabled={saving}>GUTER FLIP</button>
                <button className="bad" onClick={() => void review("bad")} disabled={saving}>SCHLECHTER FLIP</button>
                <button className="unsure" onClick={() => void review("unsure")} disabled={saving}>UNSICHER</button>
                <button onClick={() => void removeReview()} disabled={saving || !selectedAnnotation}>BEWERTUNG LÖSCHEN</button>
              </div>

              <div className="guardian-rule">
                Du bewertest nur den sichtbaren, echten Entry-Marker. Der Guardian lernt später: Strategie-Flip zulassen oder bestehenden Trend halten.
              </div>

              <div className="guardian-features">
                <strong>ZUSTAND AM MARKER</strong>
                {featureRows.map(([key, value]) => <div key={String(key)}><span>{featureName(String(key))}</span><b>{Number(value).toFixed(3)}</b></div>)}
              </div>
            </>
          ) : <div className="guardian-empty">Marker im Chart oder in der Liste auswählen.</div>}

          <div className="guardian-marker-list">
            <strong>MARKER</strong>
            {markers.slice().reverse().map((item) => {
              const annotation = annotationMap[`${item.time}:${item.side}`];
              return <button key={item.marker_id} className={`${item.side} ${annotation?.label || "open"} ${selected?.marker_id === item.marker_id ? "active" : ""}`} onClick={() => choose(item)}>
                <span>{item.side.toUpperCase()}</span><small>{formatTime(item.time)}</small><b>{annotation?.label.toUpperCase() || "OFFEN"}</b>
              </button>;
            })}
          </div>
        </aside>
      </main>
    </div>
  );
}
