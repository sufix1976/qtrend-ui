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
type Direction = "long" | "short";
type Annotation = {
  id: number;
  symbol: string;
  interval: string;
  time: number;
  price: number;
  label: Label;
  direction: Direction | "none";
  note?: string | null;
};
type TrendAnnotation = {
  id: number; symbol: string; interval: string; time: number; price: number;
  trend_start: "up" | "down"; note?: string | null;
};

type Candidate = {
  time: number;
  price: number;
  score: number;
  source: "scanner" | "ai";
  direction: Direction;
  long_score?: number;
  short_score?: number;
};

function scoreToPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const percent = Math.abs(n) <= 1.000001 ? n * 100 : n;
  return Math.max(0, Math.min(100, percent));
}

function normalizePrediction(row: any): Candidate | null {
  const time = Number(row?.time ?? row?.timestamp ?? row?.candle_time);
  if (!Number.isFinite(time)) return null;

  const longScore = scoreToPercent(
    row?.long_score ?? row?.longScore ?? row?.long_probability ?? row?.longProbability ?? row?.long,
  );
  const shortScore = scoreToPercent(
    row?.short_score ?? row?.shortScore ?? row?.short_probability ?? row?.shortProbability ?? row?.short,
  );

  let direction: Direction = String(row?.direction || row?.side || "").toLowerCase() === "short" ? "short" : "long";
  if (longScore || shortScore) direction = longScore >= shortScore ? "long" : "short";

  const directScore = scoreToPercent(row?.score ?? row?.confidence ?? row?.probability);
  const score = Math.max(directScore, longScore, shortScore);

  return {
    time,
    price: Number(row?.price ?? row?.close ?? 0),
    score,
    source: "ai",
    direction,
    long_score: longScore,
    short_score: shortScore,
  };
}

function normalizePredictions(rows: unknown): Candidate[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePrediction).filter((row): row is Candidate => row !== null);
}
type ModelInfo = {
  trained_at: string;
  positive_count: number;
  negative_count: number;
  long_count?: number;
  short_count?: number;
  threshold: number;
};
type CompareMode = "before" | "new";
type TrainingSummary = {
  run: number;
  examples: number;
  positive: number;
  negative: number;
  beforeCount: number;
  afterCount: number;
  trainedAt: string;
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
  const [trendAnnotations, setTrendAnnotations] = useState<TrendAnnotation[]>([]);
  const [scannerCandidates, setScannerCandidates] = useState<Candidate[]>([]);
  const [chartPredictions, setChartPredictions] = useState<Candidate[]>([]);
  const [aiCandidates, setAiCandidates] = useState<Candidate[]>([]);
  const [previousAiCandidates, setPreviousAiCandidates] = useState<Candidate[]>([]);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [compareMode, setCompareMode] = useState<CompareMode>("new");
  const [threshold, setThreshold] = useState(80);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("Bereit");
  const [showReviews, setShowReviews] = useState(true);
  const [trainingSummary, setTrainingSummary] = useState<TrainingSummary | null>(null);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [showSma, setShowSma] = useState(false);
  const [note, setNote] = useState("");
  const [direction, setDirection] = useState<Direction>("long");
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
  const directionStats = useMemo(() => ({
    long: annotations.filter((a) => (a.label === "perfect" || a.label === "missed") && a.direction === "long").length,
    short: annotations.filter((a) => (a.label === "perfect" || a.label === "missed") && a.direction === "short").length,
  }), [annotations]);
  const trendStats = useMemo(() => ({
    up: trendAnnotations.filter((a) => a.trend_start === "up").length,
    down: trendAnnotations.filter((a) => a.trend_start === "down").length,
  }), [trendAnnotations]);

  async function load(resetSelection = true) {
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
      setTrendAnnotations(json.trend_annotations || []);
      setScannerCandidates(json.scanner_candidates || []);
      const predictions = normalizePredictions(json.chart_predictions || json.predictions || []);
      setChartPredictions(predictions);
      setAiCandidates(predictions.filter((row) => row.score >= threshold));
      setModel(json.model || null);
      if (resetSelection) setSelectedTime(null);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPreviousAiCandidates([]);
    setTrainingSummary(null);
    setCompareMode("new");
    setShowReviews(true);
    load();
  }, [symbol, interval]);

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
      const candidate = chartPredictions.find((c) => c.time === clickedTime) || aiCandidates.find((c) => c.time === clickedTime);
      const idx = candles.findIndex((c) => c.time === clickedTime);
      setDirection(candidate?.direction || ((values[idx]?.histogram ?? 0) <= 0 ? "long" : "short"));
      setMessage("Moment gewählt – LONG oder SHORT prüfen und bewerten.");
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
    const visibleAiCandidates = compareMode === "before" ? previousAiCandidates : aiCandidates;
    visibleAiCandidates.forEach((candidate) => markers.push({
      time: candidate.time as Time,
      position: candidate.direction === "long" ? "belowBar" : "aboveBar",
      shape: candidate.direction === "long" ? "arrowUp" : "arrowDown",
      color: compareMode === "before" ? "#64748b" : "#d946ef",
      text: `${candidate.direction === "long" ? "L" : "S"} ${compareMode === "before" ? "ALT" : "KI"} ${Math.round(candidate.score)}%`,
      size: candidate.score >= 85 ? 2 : 1.3,
    }));
    if (showReviews) annotations.forEach((annotation) => markers.push({
      time: annotation.time as Time,
      position: annotation.direction === "long" ? "belowBar" : "aboveBar",
      shape: annotation.direction === "long" ? "arrowUp" : annotation.direction === "short" ? "arrowDown" : "circle",
      color: annotation.label === "perfect" ? (annotation.direction === "long" ? "#22c55e" : "#ef4444") : annotation.label === "bad" ? "#64748b" : annotation.label === "missed" ? "#f59e0b" : "#f5c451",
      text: annotation.label === "perfect" ? (annotation.direction === "long" ? "LONG ✓" : "SHORT ✓") : annotation.label === "bad" ? "×" : annotation.label === "missed" ? `${annotation.direction === "long" ? "L" : "S"} VERPASST` : "?",
      size: 1.2,
    }));
    trendAnnotations.forEach((annotation) => markers.push({
      time: annotation.time as Time,
      position: annotation.trend_start === "up" ? "belowBar" : "aboveBar",
      shape: annotation.trend_start === "up" ? "arrowUp" : "arrowDown",
      color: annotation.trend_start === "up" ? "#38bdf8" : "#fb923c",
      text: annotation.trend_start === "up" ? "UT START" : "DT START",
      size: 2,
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
  }, [annotations, trendAnnotations, aiCandidates, previousAiCandidates, selectedTime, compareMode, showReviews, candles]);

  async function save(label: Label) {
    if (!selectedCandle) { setMessage("Bitte zuerst eine Kerze im Chart anklicken."); return; }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${BACKEND_BASE}/qmomentum/annotation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interval, time: selectedCandle.time, price: selectedCandle.close, label, direction: label === "bad" || label === "unsure" ? direction : direction, note }),
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
      const candidateTimes = [...new Set(
        aiCandidates.map((candidate) => Number(candidate.time)),
      )].sort((a, b) => a - b);

      const currentTime = Number(json.annotation.time);
      const nextTime =
        candidateTimes.find((time) => time > currentTime && !reviewedTimes.has(time)) ??
        candidateTimes.find((time) => !reviewedTimes.has(time)) ??
        null;

      if (nextTime !== null) {
        setSelectedTime(nextTime);
        const nextCandidate = aiCandidates.find((c) => c.time === nextTime);
        if (nextCandidate) setDirection(nextCandidate.direction);
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

  async function saveTrendStart(trendStart: "up" | "down") {
    if (!selectedCandle) { setMessage("Bitte zuerst die Kerze anklicken, an der der Trend beginnt."); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`${BACKEND_BASE}/qmomentum/trend-annotation`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interval, time: selectedCandle.time, price: selectedCandle.close, trend_start: trendStart, note }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`);
      const saved = json.trend_annotation as TrendAnnotation;
      setTrendAnnotations((current) => [...current.filter((row) => Number(row.time) !== Number(saved.time)), saved].sort((a,b)=>Number(a.time)-Number(b.time)));
      setNote("");
      setMessage(trendStart === "up" ? "UT-START gespeichert." : "DT-START gespeichert.");
    } catch (error: any) { setMessage(error?.message || String(error)); }
    finally { setSaving(false); }
  }

  async function analyze(showMessage = true) {
    if (analyzing) return [] as Candidate[];
    setAnalyzing(true);
    setAnalysisStatus("Anfrage wird gesendet …");
    if (showMessage) setMessage("KI analysiert jede Kerze im Chart …");

    const url = new URL("/qmomentum/predict-chart", BACKEND_BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", "5000");
    url.searchParams.set("_ts", String(Date.now()));

    try {
      console.info("[QMomentum V4.1b] predict-chart request", url.toString());
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ symbol, interval, limit: 5000 }),
      });

      setAnalysisStatus(`Antwort ${response.status} wird gelesen …`);
      const raw = await response.text();
      let json: any;
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`predict-chart lieferte kein JSON: ${raw.slice(0, 180)}`);
      }

      if (!response.ok || !json.ok) {
        throw new Error(json.error || `predict-chart HTTP ${response.status}`);
      }

      const predictions = normalizePredictions(json.predictions || json.chart_predictions || []);
      setChartPredictions(predictions);
      const visible = predictions.filter((row) => row.score >= threshold);
      const maxLong = predictions.reduce((max, row) => Math.max(max, row.long_score || 0), 0);
      const maxShort = predictions.reduce((max, row) => Math.max(max, row.short_score || 0), 0);
      const maxScore = predictions.reduce((max, row) => Math.max(max, row.score || 0), 0);
      setAiCandidates(visible);
      setModel((current) => ({ ...(current || {} as ModelInfo), ...(json.model || {}), threshold }));
      setCompareMode("new");
      setAnalysisStatus(`${json.prediction_count ?? predictions.length} Kerzen · ${visible.length} Marker · Max L ${maxLong.toFixed(1)} / S ${maxShort.toFixed(1)}`);
      if (showMessage) {
        const hint = visible.length === 0
          ? ` Höchster Score ${maxScore.toFixed(1)}%. Senke die Schwelle unter diesen Wert.`
          : "";
        setMessage(`KI hat ${json.prediction_count ?? predictions.length} Kerzen analysiert · ${visible.length} Marker ab ${threshold}%.${hint}`);
      }
      console.info("[QMomentum V4.1b] predict-chart response", {
        predictions: predictions.length,
        visible: visible.length,
        maxLong,
        maxShort,
        maxScore,
        firstRawPrediction: Array.isArray(json.predictions) ? json.predictions[0] : null,
        firstNormalizedPrediction: predictions[0] || null,
        model: json.model,
      });
      return visible;
    } catch (error: any) {
      const errorText = error?.message || String(error);
      setAnalysisStatus(`Fehler: ${errorText}`);
      setMessage(errorText);
      console.error("[QMomentum V4.1b] predict-chart failed", error);
      return [] as Candidate[];
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    const visible = chartPredictions.filter((row) => row.score >= threshold);
    setAiCandidates(visible);
  }, [threshold, chartPredictions]);

  async function train() {
    setTraining(true);
    setMessage("KI wird neu trainiert …");
    const beforeCandidates = aiCandidates.slice();
    try {
      const response = await fetch(`${BACKEND_BASE}/qmomentum/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`);

      const dataUrl = new URL("/qmomentum/data", BACKEND_BASE);
      dataUrl.searchParams.set("symbol", symbol);
      dataUrl.searchParams.set("interval", interval);
      dataUrl.searchParams.set("limit", "5000");
      dataUrl.searchParams.set("_ts", String(Date.now()));
      const dataResponse = await fetch(dataUrl, { cache: "no-store" });
      const dataJson = await dataResponse.json();
      if (!dataResponse.ok || !dataJson.ok) throw new Error(dataJson.error || `HTTP ${dataResponse.status}`);

      const predictions = normalizePredictions(dataJson.chart_predictions || dataJson.predictions || []);
      const nextAi = predictions.filter((row) => row.score >= threshold);
      const run = Number(localStorage.getItem("qmomentum_training_run") || "0") + 1;
      localStorage.setItem("qmomentum_training_run", String(run));

      setPreviousAiCandidates(beforeCandidates);
      setCandles(dataJson.candles || []);
      setAnnotations(dataJson.annotations || []);
      setScannerCandidates([]);
      setChartPredictions(predictions);
      setAiCandidates(nextAi);
      setModel(dataJson.model || json.model || null);
      setTrainingSummary({
        run,
        examples: Number(json.model.positive_count || 0) + Number(json.model.negative_count || 0),
        positive: Number(json.model.positive_count || 0),
        negative: Number(json.model.negative_count || 0),
        beforeCount: beforeCandidates.length,
        afterCount: nextAi.length,
        trainedAt: json.model.trained_at || new Date().toISOString(),
      });
      setCompareMode("new");
      setShowReviews(false);
      setMessage(`Training #${run} abgeschlossen · KI-Marker ${beforeCandidates.length} → ${nextAi.length}.`);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setTraining(false);
    }
  }

  return (
    <div className="qm-shell">
      <header className="qm-header">
        <div><h1>QMomentum Lab <span>V5</span></h1><p>Momentum-KI + Trenderkennung · UT-/DT-Starts lernen · keine Trades</p></div>
        <div className="qm-stats">
          <span>Analysiert {chartPredictions.length}</span>
          <span className="ai">KI-Marker {aiCandidates.length}</span>
          <span>KI vorher {previousAiCandidates.length}</span>
          <span className="long-stat">LONG {directionStats.long}</span><span className="short-stat">SHORT {directionStats.short}</span><span>UT {trendStats.up}</span><span>DT {trendStats.down}</span><span>👍 {stats.perfect}</span><span>👎 {stats.bad}</span><span>⭕ {stats.missed}</span><span>❓ {stats.unsure}</span>
        </div>
      </header>

      <div className="qm-toolbar">
        <label>Instrument<select value={symbol} onChange={(e) => setSymbol(e.target.value)}>{SYMBOLS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Timeframe<select value={interval} onChange={(e) => setInterval(e.target.value)}>{INTERVALS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="qm-check"><input type="checkbox" checked={showSma} onChange={(e) => setShowSma(e.target.checked)} /> SMA 50</label>
        <div className="qm-compare" role="group" aria-label="KI-Vergleich">
          <button className={compareMode === "before" ? "active before" : ""} disabled={!previousAiCandidates.length} onClick={() => setCompareMode("before")}>KI VORHER</button>
          <button className={compareMode === "new" ? "active ai" : ""} onClick={() => setCompareMode("new")}>KI AKTUELL</button>
        </div>
        <label>Schwelle <b>{threshold}%</b><input type="range" min="50" max="99" step="1" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></label>
        <button type="button" className="qm-analyze" onClick={() => { void analyze(true); }} disabled={analyzing || loading || candles.length === 0}>{analyzing ? "Analysiert …" : "KI analysieren"}</button>
        <div className={`qm-analysis-status ${analysisStatus.startsWith("Fehler") ? "error" : analyzing ? "working" : ""}`}><b>KI-Analyse</b><span>{analysisStatus}</span></div>
        <label className="qm-check"><input type="checkbox" checked={showReviews} onChange={(e) => setShowReviews(e.target.checked)} /> Bewertungen</label>
        <button onClick={() => load()} disabled={loading}>{loading ? "Lädt …" : "Neu laden"}</button>
        <button className="qm-train" onClick={train} disabled={training}>{training ? "Trainiert …" : "KI neu trainieren"}</button>
      </div>

      <div className="qm-modelbar">
        <span className="before-dot"/> KI vorher
        <span className="ai-dot"/> KI aktuell · Vollchart
        {model ? <b>Modell: LONG {model.long_count || 0} / SHORT {model.short_count || 0} / schlecht {model.negative_count} · Schwelle {threshold}%</b> : <b>Noch kein KI-Modell trainiert</b>}
      </div>

      {trainingSummary && <div className="qm-training-result">
        <strong>Training #{trainingSummary.run} abgeschlossen</strong>
        <span>Beispiele <b>{trainingSummary.examples}</b></span>
        <span>Positiv <b>{trainingSummary.positive}</b></span>
        <span>Schlecht <b>{trainingSummary.negative}</b></span>
        <span>KI-Marker vorher <b>{trainingSummary.beforeCount}</b></span>
        <span>KI-Marker jetzt <b>{trainingSummary.afterCount}</b></span>
        <span>Modellstand <b>{new Date(trainingSummary.trainedAt.replace(" ", "T") + (trainingSummary.trainedAt.includes("Z") ? "" : "Z")).toLocaleString("de-DE")}</b></span>
      </div>}

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
              {selectedScanner && <span className={selectedScanner.direction}>Scanner {selectedScanner.direction.toUpperCase()} {selectedScanner.score.toFixed(0)}</span>}
              {selectedAi && <span className={selectedAi.direction}>KI {selectedAi.direction.toUpperCase()} {selectedAi.score.toFixed(0)}%</span>}
              {previousAiCandidates.find((c) => c.time === selectedTime) && <span>KI vorher {previousAiCandidates.find((c) => c.time === selectedTime)!.score.toFixed(0)}%</span>}
              {!selectedScanner && !selectedAi && !previousAiCandidates.some((c) => c.time === selectedTime) && <span>Manuell gewählt</span>}
            </div>
            <dl>
              <dt>Close</dt><dd>{selectedCandle.close.toFixed(2)}</dd>
              <dt>MACD</dt><dd>{selectedIndicators.macd.toFixed(5)}</dd>
              <dt>Signal</dt><dd>{selectedIndicators.signal.toFixed(5)}</dd>
              <dt>Histogramm</dt><dd>{selectedIndicators.histogram.toFixed(5)}</dd>
              <dt>RSI</dt><dd>{selectedIndicators.rsi.toFixed(2)}</dd>
              <dt>RSI MA</dt><dd>{selectedIndicators.rsiMa.toFixed(2)}</dd>
            </dl>
          </> : <div className="qm-empty">Klicke einen KI-Marker oder eine fehlende Stelle im Chart an.</div>}

          <div className="qm-direction">
            <button className={direction === "long" ? "active long" : "long"} onClick={() => setDirection("long")}>▲ MÖGLICHER LONG-MOMENT</button>
            <button className={direction === "short" ? "active short" : "short"} onClick={() => setDirection("short")}>▼ MÖGLICHER SHORT-MOMENT</button>
          </div>
          <div className="qm-direction" style={{ marginTop: 10 }}>
            <button type="button" disabled={saving || !selectedCandle} onClick={() => saveTrendStart("up")} style={{ borderColor: "#38bdf8", color: "#7dd3fc" }}>↗ UT BEGINNT HIER</button>
            <button type="button" disabled={saving || !selectedCandle} onClick={() => saveTrendStart("down")} style={{ borderColor: "#fb923c", color: "#fdba74" }}>↘ DT BEGINNT HIER</button>
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz optional" />
          <div className="qm-actions">
            <button className="perfect" disabled={saving} onClick={() => save("perfect")}>👍<b>{direction === "long" ? "LONG perfekt" : "SHORT perfekt"}</b></button>
            <button className="bad" disabled={saving} onClick={() => save("bad")}>👎<b>Schlecht</b></button>
            <button className="missed" disabled={saving} onClick={() => save("missed")}>⭕<b>{direction === "long" ? "LONG verpasst" : "SHORT verpasst"}</b></button>
            <button className="unsure" disabled={saving} onClick={() => save("unsure")}>❓<b>Unsicher</b></button>
          </div>
          {message && <div className="qm-message">{message}</div>}
          <div className="qm-rule"><b>V5 – Trendstarts sammeln</b><span>Klicke exakt auf die Kerze, an der für dich ein neuer Aufwärts- oder Abwärtstrend beginnt. UT/DT werden separat gespeichert und verändern die Momentum-KI noch nicht.</span></div>
        </aside>
      </main>
    </div>
  );
}