import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type Time,
} from "lightweight-charts";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["DE40", "US30", "US100", "UK100", "J225", "CN50", "BTCUSD", "ETHUSD", "GOLD"];
const INTERVALS = ["1m", "5m", "10m", "15m", "30m", "1h"];
const SOURCE = "guardian_marker";

type Candle = { time: number; open: number; high: number; low: number; close: number; atr?: number | null; macd?: number | null; macd_signal?: number | null; macd_histogram?: number | null };
type MarkerSide = "long" | "short";
type ReviewLabel = "good" | "bad" | "unsure";
type AuditStatus = "ok" | "missing" | "zero" | "constant" | "invalid";
type TraceStatus = "stored" | "calculated" | "missing" | "mismatch";

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
  indicator_source?: string;
  indicator_settings?: { macd_fast: number; macd_slow: number; macd_signal: number };
  error?: string;
  details?: string;
};

function formatTime(time: number) {
  return new Date(time * 1000).toLocaleString("de-DE");
}


function ema(values: number[], period: number) {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push(values[index] * alpha + result[index - 1] * (1 - alpha));
  }
  return result;
}

function buildMacd(candles: Candle[], settings = { macd_fast: 2, macd_slow: 26, macd_signal: 9 }) {
  const hasBackendSeries = candles.every((item) =>
    Number.isFinite(Number(item.macd)) &&
    Number.isFinite(Number(item.macd_signal)) &&
    Number.isFinite(Number(item.macd_histogram)),
  );

  if (hasBackendSeries) {
    return candles.map((item) => ({
      time: item.time,
      macd: Number(item.macd),
      signal: Number(item.macd_signal),
      histogram: Number(item.macd_histogram),
      source: "backend" as const,
    }));
  }

  const closes = candles.map((item) => Number(item.close));
  const fast = ema(closes, settings.macd_fast);
  const slow = ema(closes, settings.macd_slow);
  const macd = closes.map((_, index) => fast[index] - slow[index]);
  const signal = ema(macd, settings.macd_signal);
  return candles.map((item, index) => ({
    time: item.time,
    macd: macd[index],
    signal: signal[index],
    histogram: macd[index] - signal[index],
    source: "ui-fallback" as const,
  }));
}

function featureName(key: string) {
  const names: Record<string, string> = {
    atr: "ATR",
    macd: "MACD",
    macd_signal: "MACD Signal",
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
  const macdHost = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
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
      visibleRangeRef.current = chartRef.current?.timeScale().getVisibleLogicalRange() || null;
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
      visibleRangeRef.current = chartRef.current?.timeScale().getVisibleLogicalRange() || null;
      await load();
    } catch (exception: any) {
      setError(exception?.message || String(exception));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => { void load(); }, [symbol, interval]);

  useEffect(() => {
    if (!chartHost.current || !macdHost.current || !candles.length) return;
    chartHost.current.innerHTML = "";
    macdHost.current.innerHTML = "";

    const chart = createChart(chartHost.current, {
      height: 500,
      layout: { background: { color: "#07111f" }, textColor: "#a9b8ca" },
      grid: { vertLines: { color: "#142235" }, horzLines: { color: "#142235" } },
      rightPriceScale: { borderColor: "#26364b" },
      timeScale: { borderColor: "#26364b", timeVisible: true, visible: false },
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

    const macdChart = createChart(macdHost.current, {
      height: 180,
      layout: { background: { color: "#07111f" }, textColor: "#a9b8ca" },
      grid: { vertLines: { color: "#142235" }, horzLines: { color: "#142235" } },
      rightPriceScale: { borderColor: "#26364b" },
      timeScale: { borderColor: "#26364b", timeVisible: true },
    });
    const macdData = buildMacd(candles, data?.indicator_settings);
    const histogram = macdChart.addSeries(HistogramSeries, { priceFormat: { type: "price", precision: 3, minMove: 0.001 } });
    histogram.setData(macdData.map((item) => ({ time: item.time as Time, value: item.histogram, color: item.histogram >= 0 ? "#22c55e" : "#ef4444" })));
    const macdLine = macdChart.addSeries(LineSeries, { lineWidth: 2, priceFormat: { type: "price", precision: 3, minMove: 0.001 } });
    macdLine.setData(macdData.map((item) => ({ time: item.time as Time, value: item.macd })));
    const signalLine = macdChart.addSeries(LineSeries, { lineWidth: 2, priceFormat: { type: "price", precision: 3, minMove: 0.001 } });
    signalLine.setData(macdData.map((item) => ({ time: item.time as Time, value: item.signal })));

    if (selected) {
      const point = macdData.find((item) => item.time === selected.time);
      if (point) createSeriesMarkers(macdLine, [{ time: point.time as Time, position: "inBar", shape: "circle", color: "#ffffff", text: "MARKER" }] as any);
    }

    let syncing = false;
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || syncing) return;
      syncing = true;
      macdChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });
    macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || syncing) return;
      syncing = true;
      chart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });

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
      chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
      macdChart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
    } else {
      chart.timeScale().fitContent();
      macdChart.timeScale().fitContent();
    }
    chartRef.current = chart;
    macdChartRef.current = macdChart;
    return () => {
      chart.remove();
      macdChart.remove();
      chartRef.current = null;
      macdChartRef.current = null;
    };
  }, [candles, markers, annotationMap, selected?.marker_id, showReviewed, data?.indicator_settings]);

  function choose(marker: StrategyMarker) {
    setSelected(marker);
    const index = candles.findIndex((item) => item.time >= marker.time);
    if (index >= 0) {
      const range = { from: Math.max(0, index - 35), to: Math.min(candles.length - 1, index + 35) };
      visibleRangeRef.current = range;
      chartRef.current?.timeScale().setVisibleLogicalRange(range);
      macdChartRef.current?.timeScale().setVisibleLogicalRange(range);
    }
  }

  const featureRows = useMemo(() => {
    if (!selected?.features) return [];
    const preferred = ["macd_histogram", "macd_histogram_atr", "macd_slope", "macd_histogram_speed", "rsi", "rsi_delta_1", "rsi_delta_3", "adx", "plus_di", "minus_di", "di_difference", "bb_position", "bb_width_norm", "trend_credit", "momentum", "energy", "structure", "body_atr", "range_atr"];
    return preferred.map((key) => [key, Number(selected.features?.[key])]).filter(([, value]) => Number.isFinite(value));
  }, [selected]);

  const featureAudit = useMemo(() => {
    const preferred = ["macd_histogram", "macd_histogram_atr", "macd_slope", "macd_slope_atr", "macd_histogram_speed", "rsi", "rsi_delta_1", "rsi_delta_3", "adx", "plus_di", "minus_di", "di_difference", "bb_position", "bb_width_norm", "trend_credit", "momentum", "energy", "structure", "body_atr", "range_atr"];
    return preferred.map((key) => {
      const raw = markers.map((item) => item.features?.[key]);
      const finite = raw.map(Number).filter((value) => Number.isFinite(value));
      const missing = raw.length - finite.length;
      const unique = new Set(finite.map((value) => value.toFixed(9))).size;
      let status: AuditStatus = "ok";
      if (!finite.length) status = "missing";
      else if (missing > 0) status = "invalid";
      else if (finite.every((value) => Math.abs(value) < 1e-12)) status = "zero";
      else if (unique <= 1) status = "constant";
      const min = finite.length ? Math.min(...finite) : null;
      const max = finite.length ? Math.max(...finite) : null;
      return { key, status, missing, total: raw.length, min, max, unique };
    });
  }, [markers]);

  const auditProblems = featureAudit.filter((item) => item.status !== "ok").length;

  const sensorTrace = useMemo(() => {
    if (!selected || !candles.length) return null;

    const macdData = buildMacd(candles, data?.indicator_settings);
    let index = candles.findIndex((item) => item.time === selected.time);
    if (index < 0) index = candles.findIndex((item) => item.time >= selected.time);
    if (index < 0) return null;

    const current = macdData[index];
    const previous = index > 0 ? macdData[index - 1] : null;
    const features = selected.features || {};
    const has = (key: string) => Object.prototype.hasOwnProperty.call(features, key) && Number.isFinite(Number(features[key]));
    const stored = (key: string) => has(key) ? Number(features[key]) : null;
    const atr = stored("atr");
    const calculated = {
      macd: current?.macd ?? null,
      macd_previous: previous?.macd ?? null,
      signal: current?.signal ?? null,
      signal_previous: previous?.signal ?? null,
      histogram: current?.histogram ?? null,
      histogram_previous: previous?.histogram ?? null,
      histogram_delta: current && previous ? current.histogram - previous.histogram : null,
      histogram_atr: current && atr && Math.abs(atr) > 1e-12 ? current.histogram / atr : null,
      macd_slope: current && previous ? current.macd - previous.macd : null,
      macd_slope_atr: current && previous && atr && Math.abs(atr) > 1e-12 ? (current.macd - previous.macd) / atr : null,
    };

    const tolerance = (value: number | null) => Math.max(0.001, Math.abs(Number(value || 0)) * 0.02);
    const row = (key: string, label: string, calc: number | null, prerequisites: string[]) => {
      const value = stored(key);
      let status: TraceStatus = "missing";
      if (value != null && calc != null) status = Math.abs(value - calc) <= tolerance(calc) ? "stored" : "mismatch";
      else if (value != null) status = "stored";
      else if (calc != null) status = "calculated";
      return { key, label, stored: value, calculated: calc, status, prerequisites };
    };

    return {
      index,
      candleTime: candles[index]?.time ?? selected.time,
      rows: [
        row("macd", "MACD aktuell", calculated.macd, ["Schlusskurse", "EMA 2", "EMA 26"]),
        row("macd_previous", "MACD vorher", calculated.macd_previous, ["vorherige Kerze"]),
        row("macd_signal", "Signal aktuell", calculated.signal, ["MACD", "EMA 9"]),
        row("macd_signal_previous", "Signal vorher", calculated.signal_previous, ["vorherige Kerze"]),
        row("macd_histogram", "Histogramm aktuell", calculated.histogram, ["MACD", "Signal"]),
        row("macd_histogram_previous", "Histogramm vorher", calculated.histogram_previous, ["vorherige Kerze"]),
        { key: "histogram_delta", label: "Histogramm Delta", stored: stored("macd_histogram_speed"), calculated: calculated.histogram_delta, status: stored("macd_histogram_speed") == null ? (calculated.histogram_delta == null ? "missing" : "calculated") : (calculated.histogram_delta != null && Math.abs(stored("macd_histogram_speed")! - calculated.histogram_delta) <= tolerance(calculated.histogram_delta) ? "stored" : "mismatch"), prerequisites: ["Histogramm aktuell", "Histogramm vorher"] } as any,
        row("atr", "ATR", atr, ["Snapshot"]),
        row("macd_histogram_atr", "Histogramm / ATR", calculated.histogram_atr, ["Histogramm", "ATR"]),
        row("macd_slope", "MACD Steigung", calculated.macd_slope, ["MACD aktuell", "MACD vorher"]),
        row("macd_slope_atr", "MACD Steigung / ATR", calculated.macd_slope_atr, ["MACD Steigung", "ATR"]),
      ],
    };
  }, [selected, candles, data?.indicator_settings]);

  const reviewed = data?.counts?.reviewed || 0;
  const progress = markers.length ? (reviewed / markers.length) * 100 : 0;

  return (
    <div className="guardian-page">
      <header className="guardian-header">
        <div>
          <b>QTrend Strategy Flip Guardian V13.4</b>
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
          <div className="guardian-macd-title"><strong>MACD {data?.indicator_settings?.macd_fast ?? 2} / {data?.indicator_settings?.macd_slow ?? 26} / {data?.indicator_settings?.macd_signal ?? 9}</strong><span>Backend-Quelle · MACD · Signal · Histogramm</span></div>
          <div ref={macdHost} className="guardian-macd-chart" />
        </section>

        <aside className="guardian-sidebar">
          <div className={`guardian-audit ${auditProblems ? "warning" : "ok"}`}>
            <div className="guardian-audit-head"><strong>FEATURE-AUDIT</strong><b>{auditProblems ? `${auditProblems} PROBLEME` : "SAUBER"}</b></div>
            <small>Prüft alle sichtbaren Strategie-Marker auf fehlende, ungültige, konstante oder ausschließlich null gesetzte Werte.</small>
            <div className="guardian-audit-list">
              {featureAudit.map((item) => (
                <div key={item.key} className={item.status}>
                  <span>{featureName(item.key)}</span>
                  <b>{item.status === "ok" ? "OK" : item.status === "zero" ? "IMMER 0" : item.status === "constant" ? "KONSTANT" : item.status === "missing" ? "FEHLT" : `${item.missing} FEHLEN`}</b>
                  <small>{item.min == null ? "keine Werte" : `${item.min.toFixed(3)} … ${item.max?.toFixed(3)} · ${item.unique} Werte`}</small>
                </div>
              ))}
            </div>
          </div>
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

              {sensorTrace && (
                <div className="guardian-trace">
                  <div className="guardian-trace-head">
                    <div><strong>V13.4 · SNAPSHOT REPAIR</strong><small>Kanonischer Strategie-Snapshot gegen dieselbe Backend-Indikatorserie</small></div>
                    <b>{formatTime(sensorTrace.candleTime)}</b>
                  </div>
                  <div className="guardian-trace-columns"><span>Sensor</span><span>Snapshot</span><span>UI berechnet</span><span>Status</span></div>
                  <div className="guardian-trace-list">
                    {sensorTrace.rows.map((item: any) => (
                      <div key={item.key} className={item.status}>
                        <span><b>{item.label}</b><small>benötigt: {item.prerequisites.join(" · ")}</small></span>
                        <strong>{item.stored == null ? "—" : Number(item.stored).toFixed(6)}</strong>
                        <strong>{item.calculated == null ? "—" : Number(item.calculated).toFixed(6)}</strong>
                        <em>{item.status === "stored" ? "OK" : item.status === "calculated" ? "NUR UI" : item.status === "mismatch" ? "ABWEICHUNG" : "FEHLT"}</em>
                      </div>
                    ))}
                  </div>
                  <div className="guardian-trace-legend">
                    <span className="stored">OK = Snapshot stimmt</span>
                    <span className="calculated">NUR UI = berechenbar, aber nicht gespeichert</span>
                    <span className="mismatch">ABWEICHUNG = Backend und UI rechnen unterschiedlich</span>
                  </div>
                </div>
              )}

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
