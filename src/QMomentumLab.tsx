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

type TrendPrediction = {
  time: number;
  price: number;
  score: number;
  source: "trend_ai";
  trend_start: "up" | "down";
  up_score?: number;
  down_score?: number;
};

type TrendState = "neutral" | "up" | "down";

type TrendStateTransition = TrendPrediction & {
  state_before: TrendState;
  state_after: TrendState;
};

type ConfirmedTrendPoint = {
  time: number;
  state: Exclude<TrendState, "neutral">;
  score: number;
};

type TrendModelInfo = {
  trained_at: string;
  positive_count: number;
  up_count: number;
  down_count: number;
  background_count: number;
  labeled_candle_count?: number;
  segment_count?: number;
  model_type?: string;
  threshold?: number;
  numeric_valid?: boolean;
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
function normalizeTrendPredictions(rows: unknown): TrendPrediction[] {
  if (!Array.isArray(rows)) return [];

  const normalized: TrendPrediction[] = [];

  for (const raw of rows) {
    const row: any = raw;
    const time = Number(row?.time ?? row?.timestamp ?? row?.candle_time);
    if (!Number.isFinite(time)) continue;

    const upScore = scoreToPercent(row?.up_score ?? row?.upScore ?? row?.up);
    const downScore = scoreToPercent(row?.down_score ?? row?.downScore ?? row?.down);
    const directScore = scoreToPercent(row?.score ?? row?.confidence ?? row?.probability);
    const trendStart: "up" | "down" =
      String(row?.trend_start || "").toLowerCase() === "down" || downScore > upScore
        ? "down"
        : "up";

    normalized.push({
      time,
      price: Number(row?.price ?? row?.close ?? 0),
      score: Math.max(directScore, upScore, downScore),
      source: "trend_ai",
      trend_start: trendStart,
      up_score: upScore,
      down_score: downScore,
    });
  }

  return normalized;
}

type TrendEvaluation = {
  transitions: TrendStateTransition[];
  points: ConfirmedTrendPoint[];
  finalState: TrendState;
  finalHold: number;
};

function evaluateTrendState(
  predictions: TrendPrediction[],
  threshold: number,
): TrendEvaluation {
  const sorted = [...predictions].sort((a, b) => a.time - b.time);
  const transitions: TrendStateTransition[] = [];
  const points: ConfirmedTrendPoint[] = [];

  let state: TrendState = "neutral";
  let hold = 0;
  let pending: TrendState = "neutral";
  let pendingCount = 0;
  let lastSwitchIndex = -9999;

  const initialConfirmationBars = 2;
  const switchConfirmationBars = 3;
  const minimumBarsBetweenSwitches = 6;
  const switchMargin = 8;
  const switchHoldLimit = 35;

  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index];
    const upScore = scoreToPercent(
      row.up_score ?? (row.trend_start === "up" ? row.score : 0),
    );
    const downScore = scoreToPercent(
      row.down_score ?? (row.trend_start === "down" ? row.score : 0),
    );

    if (state === "neutral") {
      let wanted: TrendState = "neutral";
      if (upScore >= threshold && upScore >= downScore + switchMargin) wanted = "up";
      else if (downScore >= threshold && downScore >= upScore + switchMargin) wanted = "down";

      if (wanted === "neutral") {
        pending = "neutral";
        pendingCount = 0;
        continue;
      }

      if (pending === wanted) pendingCount += 1;
      else {
        pending = wanted;
        pendingCount = 1;
      }

      if (pendingCount < initialConfirmationBars) continue;

      const stateBefore = state;
      state = wanted;
      hold = 100;
      transitions.push({
        ...row,
        score: state === "up" ? upScore : downScore,
        trend_start: state,
        state_before: stateBefore,
        state_after: state,
      });
      lastSwitchIndex = index;
      pending = "neutral";
      pendingCount = 0;
    } else {
      const supportScore = state === "up" ? upScore : downScore;
      const oppositeScore = state === "up" ? downScore : upScore;
      const oppositeState: TrendState = state === "up" ? "down" : "up";
      const supportEdge = supportScore - oppositeScore;
      const oppositeEdge = oppositeScore - supportScore;

      // Trendfortsetzung lädt den HOLD-Wert wieder auf.
      if (supportEdge >= 4) {
        hold = Math.min(100, hold + Math.min(10, 2 + supportEdge * 0.3));
      } else if (oppositeEdge > 0) {
        // Gegenbewegungen bauen HOLD abhängig von ihrer Stärke ab.
        const damage = Math.min(32, Math.max(3, oppositeEdge * 1.35));
        hold = Math.max(0, hold - damage);
      } else {
        // Unklare Kerzen schwächen den Trend nur minimal.
        hold = Math.max(0, hold - 0.75);
      }

      const canSwitch =
        index - lastSwitchIndex >= minimumBarsBetweenSwitches &&
        hold <= switchHoldLimit &&
        oppositeScore >= threshold &&
        oppositeEdge >= switchMargin;

      if (!canSwitch) {
        pending = "neutral";
        pendingCount = 0;
      } else {
        if (pending === oppositeState) pendingCount += 1;
        else {
          pending = oppositeState;
          pendingCount = 1;
        }

        if (pendingCount >= switchConfirmationBars) {
          const stateBefore = state;
          state = oppositeState;
          hold = 100;
          transitions.push({
            ...row,
            score: state === "up" ? upScore : downScore,
            trend_start: state,
            state_before: stateBefore,
            state_after: state,
          });
          lastSwitchIndex = index;
          pending = "neutral";
          pendingCount = 0;
        }
      }
    }

    if (state === "up" || state === "down") {
      points.push({
        time: row.time,
        state,
        score: state === "up" ? upScore : downScore,
      });
    }
  }

  return {
    transitions,
    points,
    finalState: state,
    finalHold: Math.round(hold),
  };
}

function buildTrendStateTransitions(
  predictions: TrendPrediction[],
  threshold: number,
): TrendStateTransition[] {
  return evaluateTrendState(predictions, threshold).transitions;
}



type FormulaParams = {
  ema_length: number;
  atr_length: number;
  hysteresis: number;
  slope_lookback: number;
  momentum_lookback: number;
  slope_weight: number;
  momentum_weight: number;
  confirm_bars: number;
  min_state_bars: number;
};

type FormulaStatePoint = {
  time: number;
  state: "neutral" | "up" | "down";
  composite: number;
};

type FormulaResult = {
  params: FormulaParams;
  score: number;
  accuracy_pct: number;
  avg_switch_distance_bars: number;
  switches: number;
  extra_switches: number;
  short_islands: number;
  comparable_bars: number;
  states: FormulaStatePoint[];
};

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
  const [trendPredictions, setTrendPredictions] = useState<TrendPrediction[]>([]);
  const [trendAiCandidates, setTrendAiCandidates] = useState<TrendPrediction[]>([]);
  const [trendModel, setTrendModel] = useState<TrendModelInfo | null>(null);
  const [trendThreshold, setTrendThreshold] = useState(60);
  const [showTrendAi, setShowTrendAi] = useState(true);
  const [showTrendConfirmation, setShowTrendConfirmation] = useState(true);
  const [trendTraining, setTrendTraining] = useState(false);
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
  const [formulaOptimizing, setFormulaOptimizing] = useState(false);
  const [formulaStatus, setFormulaStatus] = useState("Bereit");
  const [formulaResult, setFormulaResult] = useState<FormulaResult | null>(null);
  const [showFormulaTrend, setShowFormulaTrend] = useState(true);
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
  const currentTrendState = useMemo(
    () => evaluateTrendState(trendPredictions, trendThreshold).finalState,
    [trendPredictions, trendThreshold],
  );
  const trendEvaluation = useMemo(
    () => evaluateTrendState(trendPredictions, trendThreshold),
    [trendPredictions, trendThreshold],
  );
  const confirmedTrendPoints = trendEvaluation.points;
  const currentTrendHold = trendEvaluation.finalHold;

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
      const loadedTrendPredictions = normalizeTrendPredictions(json.trend_predictions || []);
      setTrendPredictions(loadedTrendPredictions);
      setTrendAiCandidates(buildTrendStateTransitions(loadedTrendPredictions, trendThreshold));
      setTrendModel(json.trend_model || null);
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
    setTrendAiCandidates(
      buildTrendStateTransitions(trendPredictions, trendThreshold),
    );
  }, [trendThreshold, trendPredictions]);

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
    if (showFormulaTrend && formulaResult) formulaResult.states.forEach((point) => {
      if (point.state === "neutral") return;
      markers.push({
        time: point.time as Time,
        position: point.state === "up" ? "belowBar" : "aboveBar",
        shape: "circle",
        color: point.state === "up" ? "#16a34a" : "#dc2626",
        size: 0.5,
      });
    });

    if (showTrendConfirmation) confirmedTrendPoints.forEach((point) => markers.push({
      time: point.time as Time,
      position: point.state === "up" ? "belowBar" : "aboveBar",
      shape: "circle",
      color: point.state === "up" ? "#22c55e" : "#ef4444",
      size: 0.45,
    }));

    if (showTrendAi) trendAiCandidates.forEach((candidate) => markers.push({
      time: candidate.time as Time,
      position: candidate.trend_start === "up" ? "belowBar" : "aboveBar",
      shape: candidate.trend_start === "up" ? "arrowUp" : "arrowDown",
      color: candidate.trend_start === "up" ? "#0ea5e9" : "#f97316",
      text: `${candidate.trend_start === "up" ? "UT KI START" : "DT KI START"} ${Math.round(candidate.score)}%`,
      size: candidate.score >= 85 ? 2 : 1.4,
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
  }, [annotations, trendAnnotations, trendAiCandidates, confirmedTrendPoints, formulaResult, showFormulaTrend, showTrendAi, showTrendConfirmation, aiCandidates, previousAiCandidates, selectedTime, compareMode, showReviews, candles]);

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
      console.info("[Trend Formula Lab V0.3] predict-chart request", url.toString());
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
      const nextTrendPredictions = normalizeTrendPredictions(json.trend_predictions || []);
      setChartPredictions(predictions);
      setTrendPredictions(nextTrendPredictions);
      setTrendAiCandidates(buildTrendStateTransitions(nextTrendPredictions, trendThreshold));
      setTrendModel(json.trend_model || null);
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
      console.info("[Trend Formula Lab V0.3] predict-chart response", {
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
      console.error("[Trend Formula Lab V0.3] predict-chart failed", error);
      return [] as Candidate[];
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    const visible = chartPredictions.filter((row) => row.score >= threshold);
    setAiCandidates(visible);
  }, [threshold, chartPredictions]);

  async function optimizeFormula() {
    if (formulaOptimizing) return;

    setFormulaOptimizing(true);
    setFormulaResult(null);
    setFormulaStatus("Job wird vorbereitet …");
    setMessage("Trendformel-Batchsuche wird gestartet …");

    try {
      const startResponse = await fetch(
        `${BACKEND_BASE}/qmomentum/formula-optimize/start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify({ symbol, interval, limit: 800 }),
        },
      );

      const startJson = await startResponse.json();
      if (!startResponse.ok || !startJson?.ok) {
        throw new Error(startJson?.error || `Start HTTP ${startResponse.status}`);
      }

      const jobId = String(startJson.job_id || "");
      if (!jobId) throw new Error("Formelsuche lieferte keine Job-ID.");

      let done = false;
      let lastBest: FormulaResult | null = null;

      while (!done) {
        const stepResponse = await fetch(
          `${BACKEND_BASE}/qmomentum/formula-optimize/step`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
            body: JSON.stringify({
              job_id: jobId,
              batch_size: 64,
            }),
          },
        );

        const stepJson = await stepResponse.json();
        if (!stepResponse.ok || !stepJson?.ok) {
          throw new Error(stepJson?.error || `Step HTTP ${stepResponse.status}`);
        }

        const processed = Number(stepJson.processed || 0);
        const total = Number(stepJson.total || 3072);
        const percent = Number(stepJson.progress_pct || 0);
        done = Boolean(stepJson.done);
        lastBest = stepJson.best || lastBest;

        setFormulaStatus(`${processed} / ${total} · ${percent.toFixed(1)}%`);
        if (stepJson.best) {
          setFormulaResult(stepJson.best);
          setShowFormulaTrend(done);
        }

        // Browser und Render kurz Luft geben, bevor der nächste Block startet.
        if (!done) await new Promise((resolve) => window.setTimeout(resolve, 35));
      }

      if (!lastBest) throw new Error("Formelsuche wurde beendet, aber ohne Ergebnis.");

      setFormulaResult(lastBest);
      setShowFormulaTrend(true);
      setFormulaStatus("Fertig · 3072 / 3072 · 100%");
      setMessage(
        `Beste Formel aus 3072 Varianten · ` +
        `Treffer ${lastBest.accuracy_pct || 0}% · ` +
        `Wechselabweichung ${lastBest.avg_switch_distance_bars || 0} Kerzen.`,
      );
    } catch (error: any) {
      const errorText = error?.message || String(error);
      setFormulaStatus(`Fehler: ${errorText}`);
      setMessage(errorText);
      console.error("[Trend Formula Lab V0.3] batch optimize failed", {
        symbol,
        interval,
        error,
      });
    } finally {
      setFormulaOptimizing(false);
    }
  }

  async function trainTrend() {
    setTrendTraining(true);
    setMessage("Trend-KI wird trainiert …");
    try {
      const response = await fetch(`${BACKEND_BASE}/qmomentum/train-trend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`);

      setTrendModel(json.trend_model || null);

      const dataUrl = new URL("/qmomentum/data", BACKEND_BASE);
      dataUrl.searchParams.set("symbol", symbol);
      dataUrl.searchParams.set("interval", interval);
      dataUrl.searchParams.set("limit", "5000");
      dataUrl.searchParams.set("_ts", String(Date.now()));
      const dataResponse = await fetch(dataUrl, { cache: "no-store" });
      const dataJson = await dataResponse.json();
      if (!dataResponse.ok || !dataJson.ok) {
        throw new Error(dataJson.error || `HTTP ${dataResponse.status}`);
      }

      const nextTrendPredictions = normalizeTrendPredictions(dataJson.trend_predictions || []);
      setTrendPredictions(nextTrendPredictions);
      setTrendAiCandidates(buildTrendStateTransitions(nextTrendPredictions, trendThreshold));
      setTrendModel(dataJson.trend_model || json.trend_model || null);
      setMessage(
        `Trendzustand gelernt · UT-Kerzen ${json.trend_model?.up_count || 0} · DT-Kerzen ${json.trend_model?.down_count || 0} · Segmente ${json.trend_model?.segment_count || 0}.`,
      );
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setTrendTraining(false);
    }
  }

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
        <div><h1>QMomentum Lab <span>Formula Lab V0.3</span></h1><p>Automatische Parametersuche gegen deine UT-/DT-Zielmarker · keine Trades</p></div>
        <div className="qm-stats">
          <span>Analysiert {chartPredictions.length}</span>
          <span className="ai">KI-Marker {aiCandidates.length}</span>
          <span>KI vorher {previousAiCandidates.length}</span>
          <span className="long-stat">LONG {directionStats.long}</span><span className="short-stat">SHORT {directionStats.short}</span><span>UT {trendStats.up}</span><span>DT {trendStats.down}</span><span>Wechsel {trendAiCandidates.length}</span><span>Bestätigt {confirmedTrendPoints.length}</span><span>HOLD {currentTrendHold}</span><span>STATE {currentTrendState === "up" ? "UT" : currentTrendState === "down" ? "DT" : "NEUTRAL"}</span><span>👍 {stats.perfect}</span><span>👎 {stats.bad}</span><span>⭕ {stats.missed}</span><span>❓ {stats.unsure}</span>
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
        <button type="button" onClick={() => { void optimizeFormula(); }} disabled={formulaOptimizing || loading}>
          {formulaOptimizing ? "Batch läuft …" : "Trendformel suchen"}
        </button>
        <div className={`qm-analysis-status ${formulaStatus.startsWith("Fehler") ? "error" : formulaOptimizing ? "working" : ""}`}>
          <b>Formelsuche</b><span>{formulaStatus}</span>
        </div>
        <label className="qm-check"><input type="checkbox" checked={showFormulaTrend} onChange={(e) => setShowFormulaTrend(e.target.checked)} /> Formeltrend</label>
        <label>Trend-Schwelle <b>{trendThreshold}%</b><input type="range" min="50" max="99" step="1" value={trendThreshold} onChange={(e) => setTrendThreshold(Number(e.target.value))} /></label>
        <label className="qm-check"><input type="checkbox" checked={showTrendAi} onChange={(e) => setShowTrendAi(e.target.checked)} /> Trendstarts</label>
        <label className="qm-check"><input type="checkbox" checked={showTrendConfirmation} onChange={(e) => setShowTrendConfirmation(e.target.checked)} /> Trendbestätigung</label>
        <button type="button" onClick={trainTrend} disabled={trendTraining}>{trendTraining ? "Trendzustand lernt …" : "Trendzustand trainieren"}</button>
        <label className="qm-check"><input type="checkbox" checked={showReviews} onChange={(e) => setShowReviews(e.target.checked)} /> Bewertungen</label>
        <button onClick={() => load()} disabled={loading}>{loading ? "Lädt …" : "Neu laden"}</button>
        <button className="qm-train" onClick={train} disabled={training}>{training ? "Trainiert …" : "KI neu trainieren"}</button>
      </div>

      <div className="qm-modelbar">
        <span className="before-dot"/> KI vorher
        <span className="ai-dot"/> KI aktuell · Vollchart
        {model ? <b>Momentum: LONG {model.long_count || 0} / SHORT {model.short_count || 0} / schlecht {model.negative_count} · Schwelle {threshold}%</b> : <b>Noch kein Momentum-Modell</b>}
        {trendModel ? <b>Trendzustand: UT-Kerzen {trendModel.up_count || 0} / DT-Kerzen {trendModel.down_count || 0} / Segmente {trendModel.segment_count || 0} · Schwelle {trendThreshold}%</b> : <b>Noch kein Trendzustandsmodell trainiert</b>}
        <b>Aktiver Zustand: {currentTrendState === "up" ? "UPTREND" : currentTrendState === "down" ? "DOWNTREND" : "NEUTRAL"}</b>
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

      {formulaResult && <div className="qm-training-result">
        <strong>Beste Trendformel</strong>
        <span>Score <b>{formulaResult.score}</b></span>
        <span>Treffer <b>{formulaResult.accuracy_pct}%</b></span>
        <span>Wechselabweichung <b>{formulaResult.avg_switch_distance_bars} Kerzen</b></span>
        <span>Zusatzwechsel <b>{formulaResult.extra_switches}</b></span>
        <span>Kurze Inseln <b>{formulaResult.short_islands}</b></span>
        <span>EMA <b>{formulaResult.params.ema_length}</b></span>
        <span>ATR <b>{formulaResult.params.atr_length}</b></span>
        <span>Hysterese <b>{formulaResult.params.hysteresis}</b></span>
        <span>Bestätigung <b>{formulaResult.params.confirm_bars}</b></span>
        <span>Mindestdauer <b>{formulaResult.params.min_state_bars}</b></span>
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
          <div className="qm-rule"><b>Trend Formula Lab V0.3</b><span>Die 3.072 Formeln werden in kleinen 64er-Blöcken geprüft. Der Fortschritt bleibt sichtbar, Render erhält nach jedem Block eine neue kurze Anfrage und die beste bisherige Formel wird fortlaufend aktualisiert.</span></div>
        </aside>
      </main>
    </div>
  );
}