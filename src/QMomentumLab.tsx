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
import { useSharedMarket } from "./useSharedMarket";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["US30", "US100", "DE40", "UK100", "J225", "CN50", "BTCUSD", "ETHUSD", "GOLD", "SILVER", "OIL_CRUDE", "CORN"];
const INTERVALS = ["1m", "5m", "10m", "15m", "30m", "1h"];

type Candle = { time: number; open: number; high: number; low: number; close: number };

function heikinAshiCandles(candles: Candle[]): Candle[] {
  let previousHaOpen = 0;
  let previousHaClose = 0;
  return candles.map((candle, index) => {
    const haClose = (candle.open + candle.high + candle.low + candle.close) / 4;
    const haOpen = index === 0
      ? (candle.open + candle.close) / 2
      : (previousHaOpen + previousHaClose) / 2;
    const result = {
      time: candle.time,
      open: haOpen,
      high: Math.max(candle.high, haOpen, haClose),
      low: Math.min(candle.low, haOpen, haClose),
      close: haClose,
    };
    previousHaOpen = haOpen;
    previousHaClose = haClose;
    return result;
  });
}
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
  states?: FormulaStatePoint[];
};

type ExtremeParams = {
  macd_fast: number;
  macd_slow: number;
  macd_signal: number;
  rsi_length?: number;
  rsi_signal?: number;
  long_zone_sigma: number;
  short_zone_sigma: number;
  z_window: number;
  exit_mode?: string;
  heikin_source?: string;
  macd_entry_mode?: string;
  protect_family?: string;
  protect_label?: string;
  protect_ad_length?: number;
  protect_ad_threshold?: number;
  protect_ha_count?: number;
  protect_min_hold_bars?: number;
  profit_family?: string;
  profit_label?: string;
  profit_ad_length?: number;
  profit_ad_peak_min?: number;
  profit_ad_retrace_ratio?: number;
  profit_histogram_bars?: number;
  profit_ha_count?: number;
  profit_min_hold_bars?: number;
  exit_rsi_lower?: number;
  exit_rsi_upper?: number;
  exit_htf_minutes?: number;
};

type ExtremeMetrics = {
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  gross_profit: number;
  gross_loss: number;
  net: number;
  profit_factor: number;
  max_drawdown: number;
  recovery_factor: number;
  score: number;
  z_window: number;
  avg_peak_capture_pct?: number;
  largest_loss?: number;
  avg_loss?: number;
  avg_win?: number;
  loss_outlier_ratio?: number;
  exit_counts?: Record<string, number>;
  protect_exit_counts?: Record<string, number>;
  profit_exit_counts?: Record<string, number>;
  macd_distribution: { mean: number; std: number; q01: number; q05: number; q95: number; q99: number };
  final_state?: {
    position: "flat" | "long" | "short";
    long_armed: boolean;
    short_armed: boolean;
    long_ha_counter: number;
    short_ha_counter: number;
    open_entry_index: number;
    ad_value?: number;
    exit_armed?: boolean;
    long_extreme_active?: boolean;
    short_extreme_active?: boolean;
    long_extreme_phase_id?: number;
    short_extreme_phase_id?: number;
    long_extreme_consumed?: boolean;
    short_extreme_consumed?: boolean;
    htf_rsi?: number;
    ltf_rsi?: number;
    open_entry_price: number | null;
  };
  events?: Array<{
    type: "entry" | "exit" | "state";
    direction?: "long" | "short";
    side?: "long" | "short";
    action?: "ARMED" | "CONSUMED" | "RESET" | "DISARM";
    time: number;
    price: number;
    pnl?: number;
    reason?: string;
    exit_type?: "protect" | "profit" | "flip";
    long_armed?: boolean;
    short_armed?: boolean;
    long_consumed?: boolean;
    short_consumed?: boolean;
    long_phase_id?: number;
    short_phase_id?: number;
    macd?: number;
    signal?: number;
    z_score?: number;
    z_prev?: number;
    threshold?: number;
    comparison?: string;
    macd_value?: number;
  }>;
};

type ExtremeRank = {
  params: ExtremeParams;
  metrics: ExtremeMetrics;
};

type SavedExtremeProfile = {
  id: string; symbol: string; interval: string; name: string;
  params: ExtremeParams; result: ExtremeResult | null; note?: string | null;
  created_at: string; updated_at: string;
};

type ExtremeResult = {
  mode: string;
  symbol: string;
  interval: string;
  candle_count: number;
  tested_macd_sets: number;
  tested_zone_pairs: number;
  tested_protect_sets?: number;
  tested_profit_sets?: number;
  entry_best?: ExtremeRank | null;
  protect_best?: ExtremeRank | null;
  protect_top?: ExtremeRank[];
  entry_top?: ExtremeRank[];
  min_trades: number;
  best: ExtremeRank | null;
  stable_islands: Array<{
    rank: number;
    member_count: number;
    best: ExtremeRank;
    macd_fast_min: number;
    macd_fast_max: number;
    macd_slow_min: number;
    macd_slow_max: number;
    macd_fast_median: number;
    macd_slow_median: number;
    macd_signal: number;
    rsi_length_min: number;
    rsi_length_max: number;
    rsi_length_median: number;
    rsi_signal: number;
    long_sigma_min: number;
    long_sigma_max: number;
    short_sigma_min: number;
    short_sigma_max: number;
    pf_min: number;
    pf_max: number;
    pf_median: number;
    net_min: number;
    net_max: number;
    dd_min: number;
    dd_max: number;
    trades_min: number;
    trades_max: number;
  }>;
  top: ExtremeRank[];
};

type E1Prediction = {
  time: number;
  price: number;
  trend_start: "up" | "down";
  score: number;
  ut_score: number;
  dt_score: number;
  none_score: number;
};

type E1Metrics = {
  marker_count: number;
  exact: number;
  within_1: number;
  within_2: number;
  missed: number;
  false_positives: number;
  prediction_count: number;
  exact_pct: number;
  within_1_pct: number;
  within_2_pct: number;
  precision_pct: number;
  verdict: "PASS" | "FAIL" | "UNCLEAR";
};

type E1Result = {
  experiment: string;
  symbol: string;
  interval: string;
  total_markers: number;
  train_marker_count: number;
  test_marker_count: number;
  train_ut: number;
  train_dt: number;
  train_none: number;
  split_time: number;
  window_bars: number;
  predictions: E1Prediction[];
  metrics: E1Metrics;
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


function alignedHigherTimeframeRsi(candles: Candle[], targetMinutes: number, length = 14): number[] {
  const seconds = Math.max(60, Math.floor(targetMinutes || 30) * 60);
  const buckets: Array<{ time: number; close: number; lastIndex: number }> = [];
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    const bucketTime = Math.floor(Number(candle.time) / seconds) * seconds;
    const current = buckets[buckets.length - 1];
    if (!current || current.time !== bucketTime) buckets.push({ time: bucketTime, close: candle.close, lastIndex: i });
    else { current.close = candle.close; current.lastIndex = i; }
  }
  const bucketRsi = rsi(buckets.map((row) => row.close), length);
  const aligned = Array(candles.length).fill(50);
  let lastClosed = 50;
  for (let b = 0; b < buckets.length; b += 1) {
    const start = b === 0 ? 0 : buckets[b - 1].lastIndex + 1;
    const stop = buckets[b].lastIndex;
    for (let i = start; i <= stop; i += 1) aligned[i] = lastClosed;
    lastClosed = Number.isFinite(bucketRsi[b]) ? bucketRsi[b] : lastClosed;
  }
  return aligned;
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

function indicators(candles: Candle[], config = { fast: 12, slow: 26, signal: 9, rsiLength: 14, rsiSignal: 9 }): IndicatorPoint[] {
  const closes = candles.map((c) => c.close);
  const fast = ema(closes, config.fast);
  const slow = ema(closes, config.slow);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(macd, config.signal);
  const rsiValues = rsi(closes, config.rsiLength);
  const rsiMa = sma(rsiValues, config.rsiSignal);
  return candles.map((c, i) => ({
    time: c.time as Time,
    macd: macd[i],
    signal: signal[i],
    histogram: macd[i] - signal[i],
    rsi: rsiValues[i],
    rsiMa: rsiMa[i],
  }));
}

function normalizeIndicatorPoints(points: IndicatorPoint[], window = 200): IndicatorPoint[] {
  const size = Math.max(30, Math.floor(window));
  let sum = 0;
  let sumSq = 0;
  return points.map((point, index) => {
    sum += point.macd;
    sumSq += point.macd * point.macd;
    if (index >= size) {
      const old = points[index - size].macd;
      sum -= old;
      sumSq -= old * old;
    }
    const count = Math.min(index + 1, size);
    const mean = sum / Math.max(1, count);
    const variance = Math.max(0, sumSq / Math.max(1, count) - mean * mean);
    const std = Math.max(Math.sqrt(variance), 1e-9);
    const macdZ = count >= Math.min(30, size) ? (point.macd - mean) / std : 0;
    const signalZ = count >= Math.min(30, size) ? (point.signal - mean) / std : 0;
    return { ...point, macd: macdZ, signal: signalZ, histogram: macdZ - signalZ };
  });
}

function formatTime(time: number) {
  return new Date(time * 1000).toLocaleString("de-DE");
}

function labelText(label: Label) {
  return ({ perfect: "Perfekt", bad: "Schlecht", missed: "Verpasst", unsure: "Unsicher" } as const)[label];
}

export default function QMomentumLab() {
  const { symbol, interval, setSymbol, setInterval } = useSharedMarket();
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
  const [extremeOptimizing, setExtremeOptimizing] = useState(false);
  const [extremeStatus, setExtremeStatus] = useState("Bereit");
  const [extremeResult, setExtremeResult] = useState<ExtremeResult | null>(null);
  const [showExtremeMarkers, setShowExtremeMarkers] = useState(true);
  const [showStateDebug, setShowStateDebug] = useState(true);
  const [extremeMinTrades, setExtremeMinTrades] = useState(30);
  const [workspace, setWorkspace] = useState<"extreme" | "legacy">("extreme");
  const [extremeZWindow, setExtremeZWindow] = useState(200);
  const [exitRsiLower, setExitRsiLower] = useState(30);
  const [exitRsiUpper, setExitRsiUpper] = useState(70);
  const [exitHtfMinutes, setExitHtfMinutes] = useState(30);
  const [formulaOptimizing, setFormulaOptimizing] = useState(false);
  const [e1Running, setE1Running] = useState(false);
  const [e1Status, setE1Status] = useState("Bereit");
  const [e1Result, setE1Result] = useState<E1Result | null>(null);
  const [showE1Markers, setShowE1Markers] = useState(true);
  const [formulaStatus, setFormulaStatus] = useState("Bereit");
  const [formulaResult, setFormulaResult] = useState<FormulaResult | null>(null);
  const [showFormulaTrend, setShowFormulaTrend] = useState(true);
  const [message, setMessage] = useState("");
  const [savedProfiles, setSavedProfiles] = useState<SavedExtremeProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileStatus, setProfileStatus] = useState("Profile laden …");

  const priceEl = useRef<HTMLDivElement>(null);
  const macdEl = useRef<HTMLDivElement>(null);
  const rsiEl = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<IChartApi[]>([]);
  const candleSeriesRef = useRef<any>(null);
  const markersApiRef = useRef<any>(null);
  const visibleRangeRef = useRef<any>(null);

  const activeMacdConfig = useMemo(() => {
    const params = extremeResult?.best?.params;
    return params
      ? { fast: params.macd_fast, slow: params.macd_slow, signal: params.macd_signal, rsiLength: params.rsi_length || 14, rsiSignal: params.rsi_signal || 9 }
      : { fast: 12, slow: 26, signal: 9, rsiLength: 14, rsiSignal: 9 };
  }, [extremeResult]);

  const values = useMemo(() => {
    const raw = indicators(candles, activeMacdConfig);
    return extremeResult?.best
      ? normalizeIndicatorPoints(raw, extremeResult.best.params.z_window || 200)
      : raw;
  }, [candles, activeMacdConfig, extremeResult]);
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

  const formulaTransitions = useMemo(() => {
    const states = Array.isArray(formulaResult?.states) ? formulaResult.states : [];
    const transitions: FormulaStatePoint[] = [];
    let previous: FormulaStatePoint["state"] = "neutral";

    for (const point of states) {
      if (point.state === "neutral") continue;
      if (point.state !== previous) {
        transitions.push(point);
        previous = point.state;
      }
    }

    return transitions;
  }, [formulaResult]);

  const currentFormulaState = useMemo(() => {
    const states = Array.isArray(formulaResult?.states) ? formulaResult.states : [];
    for (let index = states.length - 1; index >= 0; index -= 1) {
      if (states[index].state === "up" || states[index].state === "down") {
        return states[index].state;
      }
    }
    return "neutral" as const;
  }, [formulaResult]);

  async function loadProfiles() {
    try {
      const response = await fetch(`${BACKEND_BASE}/qmomentum/extreme-profiles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&_ts=${Date.now()}`, { cache:"no-store" });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || `HTTP ${response.status}`);
      setSavedProfiles(Array.isArray(json.profiles) ? json.profiles : []);
      setProfileStatus(`${Array.isArray(json.profiles) ? json.profiles.length : 0} Profile gespeichert`);
    } catch (error:any) { setProfileStatus(`Profilfehler: ${error?.message || error}`); }
  }

  function bestParamsForProfile() {
    const best = extremeResult?.best;
    if (!best) return null;
    return {
      macd_fast:best.params.macd_fast, macd_slow:best.params.macd_slow, macd_signal:9,
      rsi_length:best.params.rsi_length ?? 14, rsi_signal:9,
      long_zone_sigma:best.params.long_zone_sigma, short_zone_sigma:best.params.short_zone_sigma,
      z_window:best.params.z_window || extremeZWindow, protect_min_hold_bars:best.params.protect_min_hold_bars ?? 3,
      exit_htf_minutes:best.params.exit_htf_minutes ?? exitHtfMinutes,
      exit_rsi_lower:best.params.exit_rsi_lower ?? exitRsiLower, exit_rsi_upper:best.params.exit_rsi_upper ?? exitRsiUpper,
    };
  }

  async function saveNamedProfile(copySuffix = "") {
    const params = bestParamsForProfile();
    if (!params || !extremeResult?.best) { setProfileStatus("Zuerst Optimierung starten"); return; }
    const defaultName = `${symbol} ${interval} · PF ${extremeResult.best.metrics.profit_factor.toFixed(2)}`;
    const name = `${profileName.trim() || defaultName}${copySuffix}`;
    const response = await fetch(`${BACKEND_BASE}/qmomentum/extreme-profiles`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({symbol,interval,name,params,result:{...extremeResult,mirror_meta:{start_time:Number(candles[0]?.time||0),end_time:Number(candles[candles.length-1]?.time||0),candle_count:candles.length}},activate:true}) });
    const json = await response.json(); if(!response.ok || !json?.ok) throw new Error(json?.error || `HTTP ${response.status}`);
    setProfileName(""); setSelectedProfileId(json.id); setProfileStatus(`Gespeichert und aktiv: ${name}`); await loadProfiles();
  }

  async function loadSelectedProfile() {
    const selected = savedProfiles.find(row => row.id === selectedProfileId); if(!selected) return;
    const response=await fetch(`${BACKEND_BASE}/qmomentum/extreme-profiles/activate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:selected.id})});
    const json=await response.json(); if(!response.ok||!json?.ok) throw new Error(json?.error||`HTTP ${response.status}`);
    if(selected.result?.best){ setExtremeResult(selected.result); setShowExtremeMarkers(true); }
    setExtremeZWindow(Number(selected.params.z_window || 200)); setExitHtfMinutes(Number(selected.params.exit_htf_minutes || 30));
    setExitRsiLower(Number(selected.params.exit_rsi_lower || 30)); setExitRsiUpper(Number(selected.params.exit_rsi_upper || 70));
    setProfileStatus(`Aktiv: ${selected.name}`);
  }

  async function deleteSelectedProfile() {
    if(!selectedProfileId) return;
    const response=await fetch(`${BACKEND_BASE}/qmomentum/extreme-profiles/delete`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:selectedProfileId})});
    const json=await response.json(); if(!response.ok||!json?.ok) throw new Error(json?.error||`HTTP ${response.status}`);
    setSelectedProfileId(""); setProfileStatus("Profil gelöscht"); await loadProfiles();
  }

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
    setE1Result(null);
    setE1Status("Bereit");
    setExtremeResult(null);
    setExtremeStatus("Bereit");
    load();
    void loadProfiles();
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

    const priceChart = createChart(priceEl.current, { ...common, height: Math.max(560, window.innerHeight * 0.58) });
    const macdChart = createChart(macdEl.current, { ...common, height: 270 });
    const rsiChart = createChart(rsiEl.current, { ...common, height: 270 });
    chartsRef.current = [priceChart, macdChart, rsiChart];

    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: "#24b47e", downColor: "#ef5350", borderVisible: false,
      wickUpColor: "#24b47e", wickDownColor: "#ef5350",
    });
    candleSeriesRef.current = candleSeries;
    const displayedCandles = workspace === "extreme" ? heikinAshiCandles(candles) : candles;
    candleSeries.setData(displayedCandles.map((c) => ({ ...c, time: c.time as Time })));
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

    const extremeParams = extremeResult?.best?.params;
    if (extremeParams) {
      macdSeries.createPriceLine({
        price: extremeParams.long_zone_sigma,
        color: "#22c55e",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "LONG σ",
      });
      macdSeries.createPriceLine({
        price: extremeParams.short_zone_sigma,
        color: "#ef4444",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "SHORT σ",
      });
    }

    const rsiSeries = rsiChart.addSeries(LineSeries, { color: "#ab47bc", lineWidth: 2, priceLineVisible: false });
    const rsiMaSeries = rsiChart.addSeries(LineSeries, { color: "#f5c451", lineWidth: 2, priceLineVisible: false });
    const htfRsiSeries = rsiChart.addSeries(LineSeries, { color: "#42c7ff", lineWidth: 3, priceLineVisible: false });
    const activeExitHtf = extremeResult?.best?.params.exit_htf_minutes ?? exitHtfMinutes;
    const htfRsiValues = alignedHigherTimeframeRsi(candles, activeExitHtf, 14);
    rsiSeries.setData(values.map((p) => ({ time: p.time, value: p.rsi })));
    rsiMaSeries.setData(values.map((p) => ({ time: p.time, value: p.rsiMa })));
    htfRsiSeries.setData(candles.map((c, i) => ({ time: c.time as Time, value: htfRsiValues[i] })));
    const activeLower = extremeResult?.best?.params.exit_rsi_lower ?? exitRsiLower;
    const activeUpper = extremeResult?.best?.params.exit_rsi_upper ?? exitRsiUpper;
    [activeLower, 50, activeUpper].forEach((level) => rsiSeries.createPriceLine({ price: level, color: level === 50 ? "#394657" : "#6d4c7d", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: level === activeLower ? "EXIT SHORT ARMED" : level === activeUpper ? "EXIT LONG ARMED" : "" }));

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
  }, [candles, values, showSma, extremeResult, workspace]);

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
    if (showFormulaTrend) formulaTransitions.forEach((point) => {
      markers.push({
        time: point.time as Time,
        position: point.state === "up" ? "belowBar" : "aboveBar",
        shape: point.state === "up" ? "arrowUp" : "arrowDown",
        color: point.state === "up" ? "#16a34a" : "#dc2626",
        text: point.state === "up" ? "FORMEL UT START" : "FORMEL DT START",
        size: 1.7,
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

    if (showE1Markers && e1Result) e1Result.predictions.forEach((prediction) => markers.push({
      time: prediction.time as Time,
      position: prediction.trend_start === "up" ? "belowBar" : "aboveBar",
      shape: prediction.trend_start === "up" ? "arrowUp" : "arrowDown",
      color: prediction.trend_start === "up" ? "#22d3ee" : "#f472b6",
      text: `${prediction.trend_start === "up" ? "E1 UT" : "E1 DT"} ${Math.round(prediction.score)}%`,
      size: 1.8,
    }));

    if (showExtremeMarkers && extremeResult?.best?.metrics?.events) {
      extremeResult.best.metrics.events.forEach((event) => {
        if (event.type === "state") {
          if (!showStateDebug) return;
          const side = event.side || "long";
          const action = event.action || "STATE";
          const letter = action === "ARMED" ? "A" : action === "CONSUMED" ? "C" : action === "RESET" ? "R" : "D";
          const phaseId = side === "long" ? event.long_phase_id ?? "–" : event.short_phase_id ?? "–";
          const zNowText = Number.isFinite(event.z_score) ? Number(event.z_score).toFixed(2) : "–";
          const zPrevText = Number.isFinite(event.z_prev) ? Number(event.z_prev).toFixed(2) : "–";
          const thresholdText = Number.isFinite(event.threshold) ? Number(event.threshold).toFixed(2) : "–";
          const macdText = Number.isFinite(event.macd_value) ? Number(event.macd_value).toFixed(3) : "–";
          const reasonText = action === "ARMED"
            ? `NEU ${zPrevText}→${zNowText} / G ${thresholdText}`
            : action === "RESET"
              ? `NULL-RESET MACD ${macdText}`
              : action === "DISARM"
                ? `NULL MACD ${macdText}`
                : "ENTRY";
          markers.push({
            time: event.time as Time,
            position: side === "long" ? "belowBar" : "aboveBar",
            shape: "circle",
            color: action === "ARMED" ? "#38bdf8" : action === "CONSUMED" ? "#a855f7" : action === "RESET" ? "#94a3b8" : "#f97316",
            text: `${letter} ${side === "long" ? "L" : "S"} #${phaseId} · ${reasonText}`,
            size: 0.8,
          });
          return;
        }
        const direction = event.direction || "long";
        const isEntry = event.type === "entry";
        markers.push({
          time: event.time as Time,
          position:
            direction === "long"
              ? (isEntry ? "belowBar" : "aboveBar")
              : (isEntry ? "aboveBar" : "belowBar"),
          shape: isEntry
            ? (direction === "long" ? "arrowUp" : "arrowDown")
            : "circle",
          color: isEntry
            ? (direction === "long" ? "#22c55e" : "#ef4444")
            : "#facc15",
          text: isEntry
            ? (direction === "long" ? "LONG" : "SHORT")
            : `EXIT ${event.reason || ""} ${Number(event.pnl || 0).toFixed(1)}`,
          size: isEntry ? 1.8 : 1,
        });
      });
    }

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
    const visibleMarkers = workspace === "extreme"
      ? markers.filter((marker) => ["LONG", "SHORT"].includes(String(marker.text || "")) || String(marker.text || "").startsWith("EXIT") || (showStateDebug && /^(A|C|R|D) [LS]/.test(String(marker.text || ""))))
      : markers;
    visibleMarkers.sort((a, b) => Number(a.time) - Number(b.time));
    markersApiRef.current?.setMarkers(visibleMarkers);
  }, [annotations, trendAnnotations, trendAiCandidates, confirmedTrendPoints, formulaTransitions, showFormulaTrend, e1Result, showE1Markers, showTrendAi, showTrendConfirmation, aiCandidates, previousAiCandidates, selectedTime, compareMode, showReviews, candles, extremeResult, showExtremeMarkers, showStateDebug, workspace]);

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
      console.info("[Trend Marker Imitation E1] predict-chart request", url.toString());
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
      console.info("[Trend Formula Lab V0.31] predict-chart response", {
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
      console.error("[Trend Formula Lab V0.31] predict-chart failed", error);
      return [] as Candidate[];
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    const visible = chartPredictions.filter((row) => row.score >= threshold);
    setAiCandidates(visible);
  }, [threshold, chartPredictions]);

  async function runMarkerImitationE1() {
    if (e1Running) return;
    setE1Running(true);
    setE1Result(null);
    setE1Status("Train/Test wird berechnet …");
    setMessage("E1 prüft, ob deine UT-/DT-Marker aus OHLC, MACD und RSI nachgebildet werden können …");

    try {
      const response = await fetch(`${BACKEND_BASE}/qmomentum/marker-imitation-test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ symbol, interval, limit: 5000 }),
      });

      const raw = await response.text();
      let json: any;
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`E1 lieferte kein JSON: ${raw.slice(0, 180)}`);
      }

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `E1 HTTP ${response.status}`);
      }

      const result = json as E1Result;
      setE1Result(result);
      setShowE1Markers(true);
      setE1Status(
        `${result.metrics.within_2} / ${result.metrics.marker_count} innerhalb ±2 · ${result.metrics.within_2_pct}% · ${result.metrics.verdict}`,
      );
      setMessage(
        `E1 abgeschlossen: exakt ${result.metrics.exact_pct}% · ±1 ${result.metrics.within_1_pct}% · ` +
        `±2 ${result.metrics.within_2_pct}% · Fehlmarker ${result.metrics.false_positives}.`,
      );
    } catch (error: any) {
      const errorText = error?.message || String(error);
      setE1Status(`Fehler: ${errorText}`);
      setMessage(errorText);
    } finally {
      setE1Running(false);
    }
  }

  async function optimizeExtremeMacd() {
    if (extremeOptimizing) return;

    setExtremeOptimizing(true);
    setExtremeResult(null);
    setExtremeStatus("Job wird vorbereitet …");
    setMessage(`V7.4 startet: Entry bleibt unverändert. Protect fest, Exit über ${exitHtfMinutes}m-RSI ${exitRsiLower}/${exitRsiUpper} und Basis-RSI-Drehung …`);

    try {
      const startResponse = await fetch(
        `${BACKEND_BASE}/qmomentum/extreme-optimize/start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify({
            symbol,
            interval,
            limit: 5000,
            min_trades: extremeMinTrades,
            macd_signal: 9,
            rsi_length_values: [6, 8, 10, 12, 14, 16, 18, 21, 24, 28],
            z_window: extremeZWindow,
            exit_rsi_lower: exitRsiLower,
            exit_rsi_upper: exitRsiUpper,
            exit_htf_minutes: exitHtfMinutes,
          }),
        },
      );

      const startRaw = await startResponse.text();
      let startJson: any;
      try {
        startJson = startRaw ? JSON.parse(startRaw) : {};
      } catch {
        throw new Error(`Extreme-Start lieferte kein JSON: ${startRaw.slice(0, 180)}`);
      }

      if (!startResponse.ok || !startJson?.ok) {
        throw new Error(startJson?.error || `Extreme-Start HTTP ${startResponse.status}`);
      }

      const jobId = String(startJson.job_id || "");
      if (!jobId) throw new Error("Extreme-Suche lieferte keine Job-ID.");

      let done = false;
      let finalResult: ExtremeResult | null = null;

      while (!done) {
        const stepResponse = await fetch(
          `${BACKEND_BASE}/qmomentum/extreme-optimize/step`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
            body: JSON.stringify({
              job_id: jobId,
              batch_size: 4,
            }),
          },
        );

        const stepRaw = await stepResponse.text();
        let stepJson: any;
        try {
          stepJson = stepRaw ? JSON.parse(stepRaw) : {};
        } catch {
          throw new Error(`Extreme-Step lieferte kein JSON: ${stepRaw.slice(0, 180)}`);
        }

        if (!stepResponse.ok || !stepJson?.ok) {
          throw new Error(stepJson?.error || `Extreme-Step HTTP ${stepResponse.status}`);
        }

        done = Boolean(stepJson.done);
        const phaseLabel = stepJson.phase === "protect" ? "PROTECT" : stepJson.phase === "profit" ? "PROFIT" : "ENTRY";
        setExtremeStatus(
          `${phaseLabel} · ${stepJson.processed || 0} / ${stepJson.total || 0} · ` +
          `${stepJson.tested_zone_pairs || 0} Zonen · ${stepJson.tested_protect_sets || 0} Protect · ${stepJson.tested_profit_sets || 0} Profit · ${Number(stepJson.progress_pct || 0).toFixed(1)}%`,
        );

        if (done) finalResult = stepJson.result as ExtremeResult;
        if (!done) await new Promise((resolve) => window.setTimeout(resolve, 35));
      }

      if (!finalResult?.best) {
        throw new Error("Keine Kombination erreichte die Mindestzahl an Trades.");
      }

      setExtremeResult(finalResult);
      setShowExtremeMarkers(true);

      const best = finalResult.best;
      const sharedProfile = {
        macd_fast: best.params.macd_fast,
        macd_slow: best.params.macd_slow,
        macd_signal: 9,
        rsi_length: best.params.rsi_length ?? 14,
        rsi_signal: 9,
        long_zone_sigma: best.params.long_zone_sigma,
        short_zone_sigma: best.params.short_zone_sigma,
        z_window: best.params.z_window || extremeZWindow,
        protect_min_hold_bars: best.params.protect_min_hold_bars ?? 3,
        exit_htf_minutes: best.params.exit_htf_minutes ?? exitHtfMinutes,
        exit_rsi_lower: best.params.exit_rsi_lower ?? exitRsiLower,
        exit_rsi_upper: best.params.exit_rsi_upper ?? exitRsiUpper,
      };
      const profileResponse = await fetch(`${BACKEND_BASE}/qmomentum/extreme-live/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ symbol, interval, params: sharedProfile }),
      });
      const profileRaw = await profileResponse.text();
      let profileJson: any = {};
      try { profileJson = profileRaw ? JSON.parse(profileRaw) : {}; } catch { /* status below */ }
      if (!profileResponse.ok || !profileJson?.ok) {
        throw new Error(profileJson?.error || `Profil-Sync HTTP ${profileResponse.status}: ${profileRaw.slice(0, 140)}`);
      }
      const autoName = `${symbol} ${interval} · PF ${best.metrics.profit_factor.toFixed(2)} · ${new Date().toLocaleString("de-DE")}`;
      await fetch(`${BACKEND_BASE}/qmomentum/extreme-profiles`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({symbol,interval,name:autoName,params:sharedProfile,result:{...finalResult,mirror_meta:{start_time:Number(candles[0]?.time||0),end_time:Number(candles[candles.length-1]?.time||0),candle_count:candles.length}},activate:true}) });
      await loadProfiles();

      setExtremeStatus(
        `Fertig · PF ${best.metrics.profit_factor.toFixed(2)} · ` +
        `${best.metrics.trades} Trades · ${finalResult.tested_zone_pairs} Zonenpaare`,
      );
      setMessage(
        `Beste Sigma-Sicht: MACD ${best.params.macd_fast}/${best.params.macd_slow}/${best.params.macd_signal} · ` +
        `LONG ${best.params.long_zone_sigma.toFixed(2)}σ · SHORT +${best.params.short_zone_sigma.toFixed(2)}σ · ` +
        `PROTECT ${best.params.protect_label || best.params.protect_family || "–"} · PROFIT ${best.params.profit_label || best.params.profit_family || "–"} · PF ${best.metrics.profit_factor.toFixed(2)} · Profil automatisch für Cockpit/Engine gespeichert.`,
      );
    } catch (error: any) {
      const errorText = error?.message || String(error);
      setExtremeStatus(`Fehler: ${errorText}`);
      setMessage(errorText);
      console.error("[Extreme MACD Optimizer] failed", error);
    } finally {
      setExtremeOptimizing(false);
    }
  }

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
      console.error("[Trend Formula Lab V0.31] batch optimize failed", {
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

  const extremeBest = extremeResult?.best || null;
  const currentIndicator = values.length ? values[values.length - 1] : null;
  const currentCandle = candles.length ? candles[candles.length - 1] : null;
  const currentSigma = currentIndicator?.macd ?? 0;
  const currentHistSigma = currentIndicator?.histogram ?? 0;
  const primaryIsland = extremeResult?.stable_islands?.[0] || null;
  const recentExtremeTrades = (extremeBest?.metrics?.events || [])
    .filter((event) => event.type === "exit")
    .slice(-5)
    .reverse();
  const longArmedNow = Boolean(extremeBest?.metrics.final_state?.long_armed);
  const shortArmedNow = Boolean(extremeBest?.metrics.final_state?.short_armed);
  const positionNow = extremeBest?.metrics.final_state?.position || "flat";
  const extremeStatusText = longArmedNow && shortArmedNow
    ? "LONG + SHORT ARMED"
    : longArmedNow
      ? "LONG ARMED"
      : shortArmedNow
        ? "SHORT ARMED"
        : positionNow !== "flat"
          ? `POSITION ${positionNow.toUpperCase()}`
          : "WAITING FOR EXTREME";

  if (workspace === "extreme") {
    return (
      <div className="ex6-shell">
        <header className="ex6-header">
          <div className="ex6-brand"><span className="ex6-logo">▥</span><div><h1>Extreme MACD HTF RSI Exit Lab V7.4</h1><p>MACD Armed · RSI Entry · fester Protect · HTF-RSI Exit Armed</p></div></div>
          <div className="ex6-header-actions">
            <span className="ex6-live">● LIVE</span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>{SYMBOLS.map((x) => <option key={x}>{x}</option>)}</select>
            <select value={interval} onChange={(e) => setInterval(e.target.value)}>{INTERVALS.map((x) => <option key={x}>{x}</option>)}</select>
            <button onClick={() => setWorkspace("legacy")}>Marker-Labor</button>
          </div>
        </header>

        <section style={{display:"grid",gridTemplateColumns:"minmax(220px,1fr) minmax(180px,1fr) auto auto auto auto",gap:8,alignItems:"end",padding:"10px 14px",background:"#0b1220",borderBottom:"1px solid #26344d"}}>
          <label style={{display:"grid",gap:4,fontSize:11,color:"#94a3b8"}}>GESPEICHERTE PROFILE
            <select value={selectedProfileId} onChange={(e)=>setSelectedProfileId(e.target.value)} style={{background:"#08101d",color:"#eef2ff",border:"1px solid #334155",borderRadius:7,padding:8}}>
              <option value="">Profil auswählen …</option>{savedProfiles.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label style={{display:"grid",gap:4,fontSize:11,color:"#94a3b8"}}>NEUER PROFILNAME
            <input value={profileName} onChange={(e)=>setProfileName(e.target.value)} placeholder="z. B. Demo Juli" style={{background:"#08101d",color:"#eef2ff",border:"1px solid #334155",borderRadius:7,padding:8}}/>
          </label>
          <button onClick={()=>void loadSelectedProfile()} disabled={!selectedProfileId}>LADEN + AKTIVIEREN</button>
          <button onClick={()=>void saveNamedProfile() } disabled={!extremeResult?.best}>SPEICHERN</button>
          <button onClick={()=>void saveNamedProfile(" · Kopie")} disabled={!extremeResult?.best}>KOPIEREN</button>
          <button onClick={()=>void deleteSelectedProfile()} disabled={!selectedProfileId}>LÖSCHEN</button>
          <span style={{gridColumn:"1/-1",fontSize:11,color:"#94a3b8"}}>{profileStatus}</span>
        </section>

        <section className="ex6-toolbar">
          <button className="ex6-search" onClick={() => { void optimizeExtremeMacd(); }} disabled={extremeOptimizing || loading || candles.length === 0}>
            {extremeOptimizing ? "Optimizer läuft …" : "Entry + HTF-RSI Exit optimieren"}
          </button>
          <label>Min. Trades<input type="number" min="5" step="1" value={extremeMinTrades} onChange={(e) => setExtremeMinTrades(Number(e.target.value))} /></label>
          <label>Z-Fenster<input type="number" min="30" step="10" value={extremeZWindow} onChange={(e) => setExtremeZWindow(Number(e.target.value))} /></label>
          <label>Exit HTF (Min.)<input type="number" min="5" step="5" value={exitHtfMinutes} onChange={(e) => setExitHtfMinutes(Number(e.target.value))} /></label>
          <label>RSI Untergrenze<input type="number" min="10" max="45" step="1" value={exitRsiLower} onChange={(e) => setExitRsiLower(Number(e.target.value))} /></label>
          <label>RSI Obergrenze<input type="number" min="55" max="90" step="1" value={exitRsiUpper} onChange={(e) => setExitRsiUpper(Number(e.target.value))} /></label>
          <span className="ex61-rule">ENTRY UNVERÄNDERT → PROTECT OHNE NULLRESET FLIPPT GEGENRICHTUNG → HTF-RSI EXIT</span>
          <button type="button" className={showStateDebug ? "ex61-debug-on" : ""} onClick={() => setShowStateDebug((value) => !value)}>STATE DEBUG {showStateDebug ? "ON" : "OFF"}</button>
          <span className={extremeStatus.startsWith("Fehler") ? "ex6-run error" : "ex6-run"}>{extremeStatus}</span>
        </section>

        <section className="ex6-kpis">
          <div><small>BESTE KOMBINATION</small><strong>MACD {extremeBest ? `${extremeBest.params.macd_fast} / ${extremeBest.params.macd_slow} / ${extremeBest.params.macd_signal}` : "–"}</strong><em>RSI {extremeBest?.params.rsi_length ?? 14} / Signal {extremeBest?.params.rsi_signal ?? 9}</em></div>
          <div><small>LONG ZONE</small><strong className="green">≤ {extremeBest ? extremeBest.params.long_zone_sigma.toFixed(2) : "–"}σ</strong><em>{primaryIsland ? `Optimal: ${primaryIsland.long_sigma_min.toFixed(2)} bis ${primaryIsland.long_sigma_max.toFixed(2)}σ` : "Noch kein Lauf"}</em></div>
          <div><small>SHORT ZONE</small><strong className="red">≥ +{extremeBest ? extremeBest.params.short_zone_sigma.toFixed(2) : "–"}σ</strong><em>{primaryIsland ? `Optimal: +${primaryIsland.short_sigma_min.toFixed(2)} bis +${primaryIsland.short_sigma_max.toFixed(2)}σ` : "Noch kein Lauf"}</em></div>
          <div><small>PROTECT FEST</small><strong className="red">{extremeBest?.params.protect_label || "3 Bars · Verlust · Invalidierung"}</strong><em>Größter Verlust {extremeBest?.metrics.largest_loss?.toFixed(1) ?? "–"}</em></div>
          <div><small>EXIT-MODELL</small><strong className="violet">HTF RSI {extremeBest?.params.exit_rsi_lower ?? exitRsiLower}/{extremeBest?.params.exit_rsi_upper ?? exitRsiUpper}</strong><em>{extremeBest?.params.exit_htf_minutes ?? exitHtfMinutes}m Armed → Basis-RSI dreht</em></div>
          <div><small>PF (BEST)</small><strong className="violet">{extremeBest ? extremeBest.metrics.profit_factor.toFixed(2) : "–"}</strong><em>Netto {extremeBest ? extremeBest.metrics.net.toFixed(2) : "–"}</em></div>
          <div><small>TRADES (BEST)</small><strong>{extremeBest ? extremeBest.metrics.trades : "–"}</strong><em>Winrate {extremeBest ? `${extremeBest.metrics.win_rate_pct.toFixed(1)}%` : "–"}</em></div>
          <div><small>DRAWDOWN (BEST)</small><strong>{extremeBest ? extremeBest.metrics.max_drawdown.toFixed(2) : "–"}</strong><em>Recovery {extremeBest ? extremeBest.metrics.recovery_factor.toFixed(2) : "–"}</em></div>
          <div><small>STATUS</small><strong className={longArmedNow ? "green" : shortArmedNow ? "red" : "violet"}>{extremeStatusText}</strong><em>Aktuell {currentSigma.toFixed(2)}σ</em></div>
        </section>

        <main className="ex6-grid">
          <section className="ex6-charts">
            <div className="ex6-pane ex6-price"><div className="ex6-pane-title"><b>{symbol} · {interval}</b><span>{currentCandle ? `O ${currentCandle.open.toFixed(2)}  H ${currentCandle.high.toFixed(2)}  L ${currentCandle.low.toFixed(2)}  C ${currentCandle.close.toFixed(2)}` : ""}</span></div><div ref={priceEl} /></div>
            <div className="ex6-pane ex6-macd"><div className="ex6-pane-title"><b>MACD ({activeMacdConfig.fast}, {activeMacdConfig.slow}, {activeMacdConfig.signal}) · Sigma-normalisiert</b><span>MACD {currentSigma.toFixed(2)}σ · HIST {currentHistSigma.toFixed(2)}σ</span></div><div ref={macdEl} /></div>
            <div className="ex6-pane ex6-rsi"><div className="ex6-pane-title"><b>Basis-RSI ({extremeBest?.params.rsi_length ?? 14}) · Signal {extremeBest?.params.rsi_signal ?? 9} · Exit-Timing</b><span>Basis {currentIndicator?.rsi.toFixed(1) || "–"} · HTF {extremeBest?.metrics.final_state?.htf_rsi?.toFixed(1) ?? "–"}</span></div><div ref={rsiEl} /></div>
          </section>

          <aside className="ex6-side">
            <div className="ex6-card">
              <h3>AKTUELLER STATUS</h3>
              <div className={`ex6-status ${longArmedNow ? "green" : shortArmedNow ? "red" : "violet"}`}>{extremeStatusText}</div>
              <div className="ex61-armed"><span className={longArmedNow ? "on long" : "off"}>LONG ARMED {longArmedNow ? "ON" : "OFF"}</span><span className={shortArmedNow ? "on short" : "off"}>SHORT ARMED {shortArmedNow ? "ON" : "OFF"}</span></div>
              <div className="ex6-big-sigma">{currentSigma >= 0 ? "+" : ""}{currentSigma.toFixed(2)}σ</div>
              <div className="ex6-meter"><span className="long">LONG</span><div><i style={{ left: `${Math.max(0, Math.min(100, (currentSigma + 4) / 8 * 100))}%` }} /></div><span className="short">SHORT</span></div>
            </div>

            <div className="ex6-card"><h3>DETAILS ZU AKTUELL</h3><dl>
              <dt>MACD (Roh)</dt><dd>{extremeBest?.metrics.macd_distribution.mean != null && currentIndicator ? "Sigma-Ansicht" : "–"}</dd>
              <dt>Mittelwert</dt><dd>{extremeBest ? extremeBest.metrics.macd_distribution.mean.toFixed(3) : "–"}</dd>
              <dt>Std. Abw.</dt><dd>{extremeBest ? extremeBest.metrics.macd_distribution.std.toFixed(3) : "–"}</dd>
              <dt>Histogramm</dt><dd>{currentHistSigma.toFixed(2)}σ</dd>
              <dt>Z-Fenster</dt><dd>{extremeBest?.params.z_window || extremeZWindow}</dd>
              <dt>RSI Länge</dt><dd>{extremeBest?.params.rsi_length ?? 14}</dd>
              <dt>RSI Signal</dt><dd>{extremeBest?.params.rsi_signal ?? 9}</dd>
              <dt>Position</dt><dd>{positionNow.toUpperCase()}</dd>
              <dt>Protect</dt><dd>{extremeBest?.params.protect_label || "Fest"}</dd>
              <dt>Exit HTF</dt><dd>{extremeBest?.params.exit_htf_minutes ?? exitHtfMinutes}m</dd>
              <dt>RSI Grenzen</dt><dd>{extremeBest?.params.exit_rsi_lower ?? exitRsiLower} / {extremeBest?.params.exit_rsi_upper ?? exitRsiUpper}</dd>
              <dt>HTF RSI</dt><dd>{extremeBest?.metrics.final_state?.htf_rsi?.toFixed(1) ?? "–"}</dd>
              <dt>Exit Armed</dt><dd>{extremeBest?.metrics.final_state?.exit_armed ? "JA" : "NEIN"}</dd>
              <dt>LONG Extremphase</dt><dd>{extremeBest?.metrics.final_state?.long_extreme_active ? `AKTIV #${extremeBest?.metrics.final_state?.long_extreme_phase_id ?? "–"}` : "INAKTIV"}</dd>
              <dt>SHORT Extremphase</dt><dd>{extremeBest?.metrics.final_state?.short_extreme_active ? `AKTIV #${extremeBest?.metrics.final_state?.short_extreme_phase_id ?? "–"}` : "INAKTIV"}</dd>
              <dt>LONG Consumed</dt><dd>{extremeBest?.metrics.final_state?.long_extreme_consumed ? "JA" : "NEIN"}</dd>
              <dt>SHORT Consumed</dt><dd>{extremeBest?.metrics.final_state?.short_extreme_consumed ? "JA" : "NEIN"}</dd>
            </dl></div>

            <div className="ex6-card"><h3>LETZTE TRADES</h3>{recentExtremeTrades.length ? <table><thead><tr><th>Zeit</th><th>Typ</th><th>Ergebnis</th></tr></thead><tbody>{recentExtremeTrades.map((trade, index) => <tr key={`${trade.time}-${index}`}><td>{new Date(trade.time * 1000).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td className={trade.direction === "long" ? "green" : trade.direction === "short" ? "red" : ""}>{trade.direction?.toUpperCase() ?? "–"}</td><td className={(trade.pnl || 0) >= 0 ? "green" : "red"}>{(trade.pnl || 0) >= 0 ? "+" : ""}{Number(trade.pnl || 0).toFixed(2)}</td></tr>)}</tbody></table> : <p className="ex6-muted">Nach der Optimierung erscheinen hier die letzten abgeschlossenen Trades.</p>}</div>

            <div className="ex6-card"><h3>STATE DEBUG V7.4</h3><p><b>A</b> = neuer Eintritt in die Sigma-Zone; zeigt Z vorher → jetzt und Grenzwert</p><p><b>C</b> = Extremphase durch Entry verbraucht</p><p><b>R</b> = Extremphase erst an der MACD-Nulllinie zurückgesetzt</p><p><b>D</b> = Armed an der MACD-Nulllinie gelöscht; zeigt MACD-Wert</p><p><b>F</b> = Protect-Exit ohne Nullreset seit Entry erzeugt sofort einen Gegen-Trade</p></div>

            <div className="ex6-card"><h3>LEGENDE</h3><p><span className="green">▲</span> LONG nach Armed + RSI Cross Up</p><p><span className="red">▼</span> SHORT nach Armed + RSI Cross Down</p><p>ⓧ Exit: HTF-RSI armed, danach erste Basis-RSI-Drehung</p><p>– – Sigma-Armed-Zonen</p></div>
          </aside>
        </main>

        <footer className="ex6-footer"><span>Extreme MACD HTF RSI Exit Lab V7.4 Protect-Failure Flip</span><span>Sigma-Normalisierung (Z-Score)</span><span>Z-Fenster: {extremeBest?.params.z_window || extremeZWindow} Kerzen (rollend)</span><span>Status: LIVE</span></footer>
        {message && <div className="ex6-message">{message}</div>}
      </div>
    );
  }

  return (
    <div className="qm-shell">
      <header className="qm-header">
        <div><h1>QMomentum Lab <span>Formula Lab V0.31</span></h1><p>Automatische Parametersuche gegen deine UT-/DT-Zielmarker · keine Trades</p></div><button type="button" onClick={() => setWorkspace("extreme")}>Extreme Dashboard</button>
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
        <button type="button" className="qm-analyze" onClick={() => { void runMarkerImitationE1(); }} disabled={e1Running || loading}>
          {e1Running ? "E1 prüft …" : "E1 Marker-Test"}
        </button>
        <div className={`qm-analysis-status ${e1Status.startsWith("Fehler") ? "error" : e1Running ? "working" : ""}`}>
          <b>Marker-Imitation</b><span>{e1Status}</span>
        </div>
        <label className="qm-check"><input type="checkbox" checked={showE1Markers} onChange={(e) => setShowE1Markers(e.target.checked)} /> E1-Marker</label>
        <button type="button" className="qm-analyze" onClick={() => { void optimizeExtremeMacd(); }} disabled={extremeOptimizing || loading || candles.length === 0}>
          {extremeOptimizing ? "Optimizer läuft …" : "Entry + HTF-RSI Exit optimieren"}
        </button>
        <div className={`qm-analysis-status ${extremeStatus.startsWith("Fehler") ? "error" : extremeOptimizing ? "working" : ""}`}>
          <b>Extreme-Optimizer</b><span>{extremeStatus}</span>
        </div>
        <label>Min. Trades <input type="number" min="5" step="1" value={extremeMinTrades} onChange={(e) => setExtremeMinTrades(Number(e.target.value))} /></label>
        <label>Z-Fenster <input type="number" min="50" max="1000" step="10" value={extremeZWindow} onChange={(e) => setExtremeZWindow(Number(e.target.value))} /></label>
        <label className="qm-check"><input type="checkbox" checked={showExtremeMarkers} onChange={(e) => setShowExtremeMarkers(e.target.checked)} /> Extreme Trades</label>
        <button type="button" onClick={() => { void optimizeFormula(); }} disabled={formulaOptimizing || loading}>
          {formulaOptimizing ? "Batch läuft …" : "Trendformel suchen"}
        </button>
        <div className={`qm-analysis-status ${formulaStatus.startsWith("Fehler") ? "error" : formulaOptimizing ? "working" : ""}`}>
          <b>Formelsuche</b><span>{formulaStatus}</span>
        </div>
        <label className="qm-check"><input type="checkbox" checked={showFormulaTrend} onChange={(e) => setShowFormulaTrend(e.target.checked)} /> Formelwechsel</label>
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

      {e1Result && <div className={`qm-training-result e1-${e1Result.metrics.verdict.toLowerCase()}`}>
        <strong>E1 Marker-Imitation · {e1Result.metrics.verdict}</strong>
        <span>Testmarker <b>{e1Result.metrics.marker_count}</b></span>
        <span>Exakt <b>{e1Result.metrics.exact} · {e1Result.metrics.exact_pct}%</b></span>
        <span>Innerhalb ±1 <b>{e1Result.metrics.within_1} · {e1Result.metrics.within_1_pct}%</b></span>
        <span>Innerhalb ±2 <b>{e1Result.metrics.within_2} · {e1Result.metrics.within_2_pct}%</b></span>
        <span>Nicht gefunden <b>{e1Result.metrics.missed}</b></span>
        <span>Zusätzliche Marker <b>{e1Result.metrics.false_positives}</b></span>
        <span>Precision <b>{e1Result.metrics.precision_pct}%</b></span>
        <span>Training <b>{e1Result.train_marker_count} Marker</b></span>
        <span>Test <b>{e1Result.test_marker_count} Marker</b></span>
        <span>Regel <b>≥70 PASS · &lt;40 FAIL</b></span>
      </div>}

      {extremeResult?.best && <div className="qm-training-result">
        <strong>Extreme MACD V7 · Entry / Protect / Profit getrennt optimiert</strong>
        <span>MACD <b>{extremeResult.best.params.macd_fast}/{extremeResult.best.params.macd_slow}/{extremeResult.best.params.macd_signal}</b></span>
        <span>LONG-Zone <b>{extremeResult.best.params.long_zone_sigma.toFixed(2)}σ</b></span>
        <span>SHORT-Zone <b>+{extremeResult.best.params.short_zone_sigma.toFixed(2)}σ</b></span>
        <span>PF <b>{extremeResult.best.metrics.profit_factor.toFixed(3)}</b></span>
        <span>Netto <b>{extremeResult.best.metrics.net.toFixed(2)}</b></span>
        <span>Trades <b>{extremeResult.best.metrics.trades}</b></span>
        <span>Winrate <b>{extremeResult.best.metrics.win_rate_pct.toFixed(1)}%</b></span>
        <span>Drawdown <b>{extremeResult.best.metrics.max_drawdown.toFixed(2)}</b></span>
        <span>Recovery <b>{extremeResult.best.metrics.recovery_factor.toFixed(2)}</b></span>
        <span>Protect <b>{extremeResult.best.params.protect_label || extremeResult.best.params.protect_family || "–"}</b></span>
        <span>Profit <b>{extremeResult.best.params.profit_label || extremeResult.best.params.profit_family || "–"}</b></span>
        <span>Größter Verlust <b>{extremeResult.best.metrics.largest_loss?.toFixed(2) ?? "–"}</b></span>
        <span>Peak Capture <b>{extremeResult.best.metrics.avg_peak_capture_pct?.toFixed(1) ?? "–"}%</b></span>
        <span>Signal-Länge <b>{extremeResult.best.params.macd_signal} fest · nicht optimiert</b></span>
        <span>Z-Fenster <b>{extremeResult.best.params.z_window} Kerzen · rollend</b></span>
        <span>MACD Ø / σ <b>{extremeResult.best.metrics.macd_distribution.mean.toFixed(3)} / {extremeResult.best.metrics.macd_distribution.std.toFixed(3)}</b></span>
        <span>MACD 5% / 95% <b>{extremeResult.best.metrics.macd_distribution.q05.toFixed(3)} / {extremeResult.best.metrics.macd_distribution.q95.toFixed(3)}</b></span>
        <span>MACD 1% / 99% <b>{extremeResult.best.metrics.macd_distribution.q01.toFixed(3)} / {extremeResult.best.metrics.macd_distribution.q99.toFixed(3)}</b></span>
        <span>Gefundene Inseln <b>{extremeResult.stable_islands?.length || 0}</b></span>
        <span>Geprüft <b>{extremeResult.tested_macd_sets} Fast/Slow · {extremeResult.tested_zone_pairs} Zonen · {extremeResult.tested_protect_sets || 0} Protect · {extremeResult.tested_profit_sets || 0} Profit</b></span>
      </div>}

      {extremeResult?.stable_islands?.length ? <div className="qm-training-result" style={{ alignItems: "stretch" }}>
        <strong>Stabile Ergebnis-Inseln</strong>
        <div style={{ width: "100%", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              <th style={{ textAlign: "left" }}>Insel</th><th>Treffer</th><th>Fast</th><th>Slow</th>
              <th>LONG σ</th><th>SHORT σ</th><th>PF</th><th>Trades</th><th>DD</th>
            </tr></thead>
            <tbody>
              {extremeResult.stable_islands.map((island) => <tr key={`island-${island.rank}`}>
                <td>{island.rank}</td>
                <td style={{ textAlign: "center" }}>{island.member_count}</td>
                <td style={{ textAlign: "center" }}>{island.macd_fast_min === island.macd_fast_max ? island.macd_fast_min : `${island.macd_fast_min}–${island.macd_fast_max}`}</td>
                <td style={{ textAlign: "center" }}>{island.macd_slow_min === island.macd_slow_max ? island.macd_slow_min : `${island.macd_slow_min}–${island.macd_slow_max}`}</td>
                <td style={{ textAlign: "center" }}>{island.long_sigma_min.toFixed(2)}σ bis {island.long_sigma_max.toFixed(2)}σ</td>
                <td style={{ textAlign: "center" }}>+{island.short_sigma_min.toFixed(2)}σ bis +{island.short_sigma_max.toFixed(2)}σ</td>
                <td style={{ textAlign: "center" }}>{island.pf_min.toFixed(2)}–{island.pf_max.toFixed(2)}</td>
                <td style={{ textAlign: "center" }}>{island.trades_min === island.trades_max ? island.trades_min : `${island.trades_min}–${island.trades_max}`}</td>
                <td style={{ textAlign: "center" }}>{island.dd_min.toFixed(1)}–{island.dd_max.toFixed(1)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div> : null}

      {extremeResult?.top?.length ? <div className="qm-training-result" style={{ alignItems: "stretch" }}>
        <strong>Top 10 Profit-Modelle bei eingefrorenem Entry + Protect</strong>
        <div style={{ width: "100%", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              <th style={{ textAlign: "left" }}>#</th><th>Profit-Modell</th><th>Parameter</th><th>PF</th><th>Netto</th><th>Trades</th><th>DD</th><th>Max Loss</th>
            </tr></thead>
            <tbody>
              {extremeResult.top.slice(0, 10).map((row, index) => <tr key={`${row.params.macd_fast}-${row.params.macd_slow}-${row.params.macd_signal}-${row.params.long_zone_sigma}-${row.params.short_zone_sigma}`}>
                <td>{index + 1}</td>
                <td style={{ textAlign: "center" }}>{row.params.profit_label || row.params.profit_family || "–"}</td>
                <td style={{ textAlign: "center" }}>{row.params.profit_ad_length ? `AD ${row.params.profit_ad_length}${row.params.profit_ad_peak_min ? ` · Peak ${row.params.profit_ad_peak_min} · Rest ${(row.params.profit_ad_retrace_ratio || 0) * 100}%` : ""}` : row.params.profit_histogram_bars ? `${row.params.profit_histogram_bars} Kerzen` : row.params.profit_ha_count ? `${row.params.profit_ha_count} Kerzen` : "–"}</td>
                <td style={{ textAlign: "center" }}>{row.metrics.profit_factor.toFixed(2)}</td>
                <td style={{ textAlign: "center" }}>{row.metrics.net.toFixed(1)}</td>
                <td style={{ textAlign: "center" }}>{row.metrics.trades}</td>
                <td style={{ textAlign: "center" }}>{row.metrics.max_drawdown.toFixed(1)}</td>
                <td style={{ textAlign: "center" }}>{row.metrics.largest_loss?.toFixed(1) ?? "–"}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div> : null}

      {formulaResult && <div className="qm-training-result">
        <strong>Beste Trendformel</strong>
        <span>Score <b>{formulaResult.score}</b></span>
        <span>Treffer <b>{formulaResult.accuracy_pct}%</b></span>
        <span>Wechselabweichung <b>{formulaResult.avg_switch_distance_bars} Kerzen</b></span>
        <span>Zusatzwechsel <b>{formulaResult.extra_switches}</b></span>
        <span>Kurze Inseln <b>{formulaResult.short_islands}</b></span>
        <span>Formelzustand <b>{currentFormulaState === "up" ? "UPTREND" : currentFormulaState === "down" ? "DOWNTREND" : "NEUTRAL"}</b></span>
        <span>Trendwechsel <b>{formulaTransitions.length}</b></span>
        <span>EMA <b>{formulaResult.params.ema_length}</b></span>
        <span>ATR <b>{formulaResult.params.atr_length}</b></span>
        <span>Hysterese <b>{formulaResult.params.hysteresis}</b></span>
        <span>Bestätigung <b>{formulaResult.params.confirm_bars}</b></span>
        <span>Mindestdauer <b>{formulaResult.params.min_state_bars}</b></span>
      </div>}
      <main className="qm-main">
        <section className="qm-charts">
          <div className="qm-pane"><div className="qm-pane-title">KERZEN</div><div ref={priceEl} /></div>
          <div className="qm-pane"><div className="qm-pane-title"><span>MACD {activeMacdConfig.fast} / {activeMacdConfig.slow} / {activeMacdConfig.signal}{extremeResult?.best ? ` · Sigma ${extremeResult.best.params.long_zone_sigma.toFixed(2)}σ / +${extremeResult.best.params.short_zone_sigma.toFixed(2)}σ` : ""}</span><span className="legend"><i className="blue"/>MACD <i className="orange"/>Signal</span></div><div ref={macdEl} /></div>
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
          <div className="qm-rule"><b>Experiment E1</b><span>Die ersten 70% deiner UT-/DT-Marker dienen als Training, die letzten 30% bleiben unbekannter Test. Gewertet wird ausschließlich, wie viele Testmarker exakt oder innerhalb ±1/±2 Kerzen getroffen werden. Ab 70% innerhalb ±2 gilt die Idee als bestanden, unter 40% als gescheitert.</span></div>
        </aside>
      </main>
    </div>
  );
}