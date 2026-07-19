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
import "./QMomentumLab.css";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["US30", "US100", "DE40", "UK100", "J225", "CN50", "BTCUSD", "ETHUSD", "GOLD"];
const INTERVALS = ["1m", "5m", "10m", "15m", "30m", "1h"];

type Candle = { time: number; open: number; high: number; low: number; close: number };
type Label = "perfect" | "bad" | "missed" | "unsure";
type Annotation = {
  id: number;
  symbol: string;
  interval: string;
  time: number;
  price: number;
  label: Label;
  note?: string | null;
};
type Candidate = {
  time: number;
  price: number;
  score: number;
  source: "scanner" | "ai";
};
type ModelInfo = {
  trained_at: string;
  positive_count: number;
  negative_count: number;
  threshold: number;
};
type IndicatorPoint = {
  time: Time;
  macd: number;
  signal: number;
  histogram: number;
  rsi: number;
  rsiMa: number;
};

function ema(values: number[], length: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (Math.max(1, length) + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
  return out;
}

function rsi(values: number[], length = 14): number[] {
  if (!values.length) return [];
  const out = new Array(values.length).fill(50);
  if (values.length <= length) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i += 1) {
    const delta = values[i] - values[i - 1];
    gain += Math.max(delta, 0);
    loss += Math.max(-delta, 0);
  }
  gain /= length;
  loss /= length;
  out[length] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = length + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    gain = (gain * (length - 1) + Math.max(delta, 0)) / length;
    loss = (loss * (length - 1) + Math.max(-delta, 0)) / length;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  for (let i = 0; i < length; i += 1) out[i] = out[length];
  return out;
}

function sma(values: number[], length: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    out.push(sum / Math.min(i + 1, length));
  }
  return out;
}

function indicators(candles: Candle[]): IndicatorPoint[] {
  const closes = candles.map((c) => c.close);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(macd, 9);
  const rsiValues = rsi(closes, 14);
  const rsiMa = sma(rsiValues, 9);
  return candles.map((c, i) => ({
    time: c.time as Time,
    macd: macd[i],
    signal: signal[i],
    histogram: macd[i] - signal[i],
    rsi: rsiValues[i],
    rsiMa: rsiMa[i],
  }));
}

function formatTime(time: number) {
  return new Date(time * 1000).toLocaleString("de-DE");
}

function labelText(label: Label) {
  return ({ perfect: "Perfekt", bad: "Schlecht", missed: "Verpasst", unsure: "Unsicher" } as const)[label];
}

export default function QMomentumLab() {
  const [symbol, setSymbol] = useState("US30");
  const [interval, setInterval] = useState("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [scannerCandidates, setScannerCandidates] = useState<Candidate[]>([]);
  const [aiCandidates, setAiCandidates] = useState<Candidate[]>([]);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [showSma, setShowSma] = useState(false);
  const [showScanner, setShowScanner] = useState(true);
  const [showAi, setShowAi] = useState(true);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [training, setTraining] = useState(false);
  const [message, setMessage] = useState("");

  const priceEl = useRef<HTMLDivElement>(null);
  const macdEl = useRef<HTMLDivElement>(null);
  const rsiEl = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<IChartApi[]>([]);
  const candleSeriesRef = useRef<any>(null);
  const markersApiRef = useRef<any>(null);
  const visibleRangeRef = useRef<any>(null);

  const values = useMemo(() => indicators(candles), [candles]);
  const selectedCandle = useMemo(
    () => candles.find((c) => c.time === selectedTime) || null,
    [candles, selectedTime],
  );
  const selectedIndicators = useMemo(() => {
    const index = candles.findIndex((c) => c.time === selectedTime);
    return index >= 0 ? values[index] : null;
  }, [candles, values, selectedTime]);
  const selectedScanner = useMemo(
    () => scannerCandidates.find((c) => c.time === selectedTime) || null,
    [scannerCandidates, selectedTime],
  );
  const selectedAi = useMemo(
    () => aiCandidates.find((c) => c.time === selectedTime) || null,
    [aiCandidates, selectedTime],
  );
  const stats = useMemo(() => {
    const result: Record<Label, number> = { perfect: 0, bad: 0, missed: 0, unsure: 0 };
    annotations.forEach((a) => { if (a.label in result) result[a.label] += 1; });
    return result;
  }, [annotations]);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const url = new URL("/qmomentum/data", BACKEND_BASE);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("interval", interval);
      url.searchParams.set("limit", "5000");
      url.searchParams.set("_ts", String(Date.now()));
      const response = await fetch(url, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`);
      setCandles(json.candles || []);
      setAnnotations(json.annotations || []);
      setScannerCandidates(json.scanner_candidates || []);
      setAiCandidates(json.ai_candidates || []);
      setModel(json.model || null);
      setSelectedTime(null);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [symbol, interval]);

  useEffect(() => {
    if (!priceEl.current || !macdEl.current || !rsiEl.current || !candles.length) return;

    const common = {
      layout: { background: { color: "#0b0e14" }, textColor: "#aeb8c7" },
      grid: { vertLines: { color: "#171d27" }, horzLines: { color: "#171d27" } },
      rightPriceScale: { borderColor: "#263040" },
      timeScale: { borderColor: "#263040", timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: "#8b5cf6" }, horzLine: { color: "#8b5cf6" } },
    } as const;

    const priceChart = createChart(priceEl.current, { ...common, height: Math.max(430, window.innerHeight * 0.52) });
    const macdChart = createChart(macdEl.current, { ...common, height: 220 });
    const rsiChart = createChart(rsiEl.current, { ...common, height: 220 });
    chartsRef.current = [priceChart, macdChart, rsiChart];

    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: "#24b47e", downColor: "#ef5350", borderVisible: false,
      wickUpColor: "#24b47e", wickDownColor: "#ef5350",
    });
    candleSeriesRef.current = candleSeries;
    candleSeries.setData(candles.map((c) => ({ ...c, time: c.time as Time })));
    markersApiRef.current = createSeriesMarkers(candleSeries, []);

    if (showSma) {
      const smaSeries = priceChart.addSeries(LineSeries, { lineWidth: 2, color: "#f5c451", priceLineVisible: false });
      const smaValues = sma(candles.map((c) => c.close), 50);
      smaSeries.setData(candles.map((c, i) => ({ time: c.time as Time, value: smaValues[i] })));
    }

    const histSeries = macdChart.addSeries(HistogramSeries, { priceLineVisible: false, base: 0 });
    histSeries.setData(values.map((p) => ({ time: p.time, value: p.histogram, color: p.histogram >= 0 ? "#29b6a6" : "#ef5350" })));
    const macdSeries = macdChart.addSeries(LineSeries, { color: "#42a5f5", lineWidth: 2, priceLineVisible: false });
    const signalSeries = macdChart.addSeries(LineSeries, { color: "#ffb74d", lineWidth: 2, priceLineVisible: false });
    macdSeries.setData(values.map((p) => ({ time: p.time, value: p.macd })));
    signalSeries.setData(values.map((p) => ({ time: p.time, value: p.signal })));

    const rsiSeries = rsiChart.addSeries(LineSeries, { color: "#ab47bc", lineWidth: 2, priceLineVisible: false });
    const rsiMaSeries = rsiChart.addSeries(LineSeries, { color: "#f5c451", lineWidth: 2, priceLineVisible: false });
    rsiSeries.setData(values.map((p) => ({ time: p.time, value: p.rsi })));
    rsiMaSeries.setData(values.map((p) => ({ time: p.time, value: p.rsiMa })));
    [30, 50, 70].forEach((level) => rsiSeries.createPriceLine({ price: level, color: level === 50 ? "#394657" : "#6d4c7d", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" }));

    let syncing = false;
    const applyRange = (targets: IChartApi[], range: any) => {
      if (!range || syncing) return;
      syncing = true;
      visibleRangeRef.current = range;
      targets.forEach((target) => target.timeScale().setVisibleLogicalRange(range));
      syncing = false;
    };
    priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => applyRange([macdChart, rsiChart], range));
    macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => applyRange([priceChart, rsiChart], range));
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => applyRange([priceChart, macdChart], range));

    priceChart.subscribeClick((param) => {
      let clickedTime: number | null = null;
      if (param.logical != null && Number.isFinite(Number(param.logical))) {
        const candleIndex = Math.max(0, Math.min(candles.length - 1, Math.round(Number(param.logical))));
        clickedTime = candles[candleIndex]?.time ?? null;
      }
      if (clickedTime == null && param.time != null) {
        const rawTime = typeof param.time === "number" ? param.time : Number(param.time);
        if (Number.isFinite(rawTime)) {
          let nearest = candles[0]?.time ?? null;
          let bestDistance = Number.POSITIVE_INFINITY;
          for (const candle of candles) {
            const distance = Math.abs(candle.time - rawTime);
            if (distance < bestDistance) { bestDistance = distance; nearest = candle.time; }
          }
          clickedTime = nearest;
        }
      }
      if (clickedTime == null) {
        setMessage("Keine Kerze getroffen. Bitte innerhalb des Kerzencharts klicken.");
        return;
      }
      setSelectedTime(clickedTime);
      setMessage("Moment gewählt – jetzt bewerten.");
    });

    if (visibleRangeRef.current) {
      [priceChart, macdChart, rsiChart].forEach((chart) => chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current));
    } else {
      priceChart.timeScale().fitContent();
      macdChart.timeScale().fitContent();
      rsiChart.timeScale().fitContent();
    }

    const resize = () => {
      priceChart.applyOptions({ width: priceEl.current?.clientWidth || 800 });
      macdChart.applyOptions({ width: macdEl.current?.clientWidth || 800 });
      rsiChart.applyOptions({ width: rsiEl.current?.clientWidth || 800 });
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      candleSeriesRef.current = null;
      markersApiRef.current = null;
      priceChart.remove();
      macdChart.remove();
      rsiChart.remove();
      chartsRef.current = [];
    };
  }, [candles, values, showSma]);

  useEffect(() => {
    const markers: any[] = [];
    if (showScanner) {
      scannerCandidates.forEach((candidate) => markers.push({
        time: candidate.time as Time,
        position: "belowBar",
        shape: "circle",
        color: "#8b5cf6",
        text: candidate.score >= 75 ? `S ${Math.round(candidate.score)}` : "",
        size: candidate.score >= 75 ? 1.4 : 0.8,
      }));
    }
    if (showAi) {
      aiCandidates.forEach((candidate) => markers.push({
        time: candidate.time as Time,
        position: "aboveBar",
        shape: "square",
        color: "#d946ef",
        text: `KI ${Math.round(candidate.score)}%`,
        size: candidate.score >= 85 ? 2 : 1.3,
      }));
    }
    annotations.forEach((annotation) => markers.push({
      time: annotation.time as Time,
      position: "aboveBar",
      shape: annotation.label === "missed" ? "arrowDown" : "circle",
      color: annotation.label === "perfect" ? "#28c76f" : annotation.label === "bad" ? "#ef5350" : annotation.label === "missed" ? "#f59e0b" : "#f5c451",
      text: annotation.label === "perfect" ? "✓" : annotation.label === "bad" ? "×" : annotation.label === "missed" ? "VERPASST" : "?",
      size: 1.2,
    }));
    if (selectedTime) {
      markers.push({
        time: selectedTime as Time,
        position: "belowBar",
        shape: "arrowUp",
        color: "#ffffff",
        text: "AUSWAHL",
        size: 1.5,
      });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    markersApiRef.current?.setMarkers(markers);
  }, [annotations, scannerCandidates, aiCandidates, selectedTime, showScanner, showAi, candles]);

  async function save(label: Label) {
    if (!selectedCandle) { setMessage("Bitte zuerst eine Kerze im Chart anklicken."); return; }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${BACKEND_BASE}/qmomentum/annotation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interval, time: selectedCandle.time, price: selectedCandle.close, label, note }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`);
      const nextAnnotations = [
        ...annotations.filter((a) => a.time !== json.annotation.time),
        json.annotation,
      ];
      setAnnotations(nextAnnotations);
      setNote("");

      const reviewedTimes = new Set(nextAnnotations.map((a) => Number(a.time)));
      const candidateTimes = [...new Set([
        ...scannerCandidates.map((candidate) => Number(candidate.time)),
        ...aiCandidates.map((candidate) => Number(candidate.time)),
      ])].sort((a, b) => a - b);

      const currentTime = Number(json.annotation.time);
      const nextTime =
        candidateTimes.find((time) => time > currentTime && !reviewedTimes.has(time)) ??
        candidateTimes.find((time) => !reviewedTimes.has(time)) ??
        null;

      if (nextTime !== null) {
        setSelectedTime(nextTime);
        setMessage(`${labelText(label)} gespeichert · nächster Kandidat gewählt.`);
      } else {
        setMessage(`${labelText(label)} gespeichert · alle sichtbaren Kandidaten bewertet.`);
      }
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setSaving(false);
    }
  }

  async function train() {
    setTraining(true);
    setMessage("KI wird neu trainiert …");
    try {
      const response = await fetch(`${BACKEND_BASE}/qmomentum/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`);
      setMessage(`Training fertig: ${json.model.positive_count} positiv / ${json.model.negative_count} schlecht.`);
      await load();
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setTraining(false);
    }
  }

  return (
    <div className="qm-shell">
      <header className="qm-header">
        <div><h1>QMomentum Lab <span>V0.2</span></h1><p>Scanner zeigt Kandidaten · Alexander korrigiert · KI lernt sichtbar</p></div>
        <div className="qm-stats">
          <span>Scanner {scannerCandidates.length}</span>
          <span className="ai">KI {aiCandidates.length}</span>
          <span>👍 {stats.perfect}</span><span>👎 {stats.bad}</span><span>⭕ {stats.missed}</span><span>❓ {stats.unsure}</span>
        </div>
      </header>

      <div className="qm-toolbar">
        <label>Instrument<select value={symbol} onChange={(e) => setSymbol(e.target.value)}>{SYMBOLS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Timeframe<select value={interval} onChange={(e) => setInterval(e.target.value)}>{INTERVALS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="qm-check"><input type="checkbox" checked={showSma} onChange={(e) => setShowSma(e.target.checked)} /> SMA 50</label>
        <label className="qm-check scanner"><input type="checkbox" checked={showScanner} onChange={(e) => setShowScanner(e.target.checked)} /> Scanner</label>
        <label className="qm-check ai"><input type="checkbox" checked={showAi} onChange={(e) => setShowAi(e.target.checked)} /> KI</label>
        <button onClick={load} disabled={loading}>{loading ? "Lädt …" : "Neu laden"}</button>
        <button className="qm-train" onClick={train} disabled={training}>{training ? "Trainiert …" : "KI neu trainieren"}</button>
      </div>

      <div className="qm-modelbar">
        <span className="scanner-dot"/> Scanner = großzügige Kandidaten
        <span className="ai-dot"/> KI = gelerntes Muster
        {model ? <b>Modell: {model.positive_count} positiv / {model.negative_count} schlecht · Schwelle {model.threshold}%</b> : <b>Noch kein KI-Modell trainiert</b>}
      </div>

      <main className="qm-main">
        <section className="qm-charts">
          <div className="qm-pane"><div className="qm-pane-title">KERZEN</div><div ref={priceEl} /></div>
          <div className="qm-pane"><div className="qm-pane-title"><span>MACD 12 / 26 / 9</span><span className="legend"><i className="blue"/>MACD <i className="orange"/>Signal</span></div><div ref={macdEl} /></div>
          <div className="qm-pane"><div className="qm-pane-title"><span>RSI 14</span><span className="legend"><i className="violet"/>RSI <i className="yellow"/>RSI MA 9</span></div><div ref={rsiEl} /></div>
        </section>

        <aside className="qm-panel">
          <div className="qm-eyebrow">GEWÄHLTER MOMENT</div>
          {selectedCandle && selectedIndicators ? <>
            <h2>{formatTime(selectedCandle.time)}</h2>
            <div className="qm-source-score">
              {selectedScanner && <span className="scanner">Scanner {selectedScanner.score.toFixed(0)}</span>}
              {selectedAi && <span className="ai">KI {selectedAi.score.toFixed(0)}%</span>}
              {!selectedScanner && !selectedAi && <span>Manuell gewählt</span>}
            </div>
            <dl>
              <dt>Close</dt><dd>{selectedCandle.close.toFixed(2)}</dd>
              <dt>MACD</dt><dd>{selectedIndicators.macd.toFixed(5)}</dd>
              <dt>Signal</dt><dd>{selectedIndicators.signal.toFixed(5)}</dd>
              <dt>Histogramm</dt><dd>{selectedIndicators.histogram.toFixed(5)}</dd>
              <dt>RSI</dt><dd>{selectedIndicators.rsi.toFixed(2)}</dd>
              <dt>RSI MA</dt><dd>{selectedIndicators.rsiMa.toFixed(2)}</dd>
            </dl>
          </> : <div className="qm-empty">Klicke einen Scanner-/KI-Marker oder eine fehlende Stelle im Chart an.</div>}

          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz optional" />
          <div className="qm-actions">
            <button className="perfect" disabled={saving} onClick={() => save("perfect")}>👍<b>Perfekt</b></button>
            <button className="bad" disabled={saving} onClick={() => save("bad")}>👎<b>Schlecht</b></button>
            <button className="missed" disabled={saving} onClick={() => save("missed")}>⭕<b>Verpasst</b></button>
            <button className="unsure" disabled={saving} onClick={() => save("unsure")}>❓<b>Unsicher</b></button>
          </div>
          {message && <div className="qm-message">{message}</div>}
          <div className="qm-rule"><b>V0.2-Ablauf</b><span>Violetten Scanner-Kandidaten bewerten. Fehlende Momente anklicken und „Verpasst“ wählen. Danach „KI neu trainieren“. Magenta KI-Marker zeigen, was das Modell gelernt hat.</span></div>
        </aside>
      </main>
    </div>
  );
}
