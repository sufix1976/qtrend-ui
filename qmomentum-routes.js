import { berlinNowIso } from "./berlin-time.js";
const QMOMENTUM_VERSION = "QMOMENTUM_MARKER_IMITATION_E1";
const CONTEXT_BARS = 20;
const MODEL_KEY = "GLOBAL_DIRECTIONAL_V1";
const TREND_MODEL_KEY = "GLOBAL_TREND_STATE_V2";

const FORMULA_BATCH_SIZE_DEFAULT = 64;
const FORMULA_JOB_TTL_MS = 30 * 60 * 1000;
const formulaOptimizationJobs = new Map();
const kingOptimizationJobs = new Map();
const extremeOptimizationJobs = new Map();
const multiTfOptimizationJobs = new Map();
const multiTfParameterJobs = new Map();
const exitFamilyOptimizationJobs = new Map();

function cleanupFormulaJobs() {
  const now = Date.now();
  for (const [jobId, job] of formulaOptimizationJobs.entries()) {
    if (now - job.updated_at_ms > FORMULA_JOB_TTL_MS) {
      formulaOptimizationJobs.delete(jobId);
    }
  }
}


function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function ema(values, length) {
  if (!values.length) return [];
  const alpha = 2 / (Math.max(1, length) + 1);
  const out = [finite(values[0])];
  for (let i = 1; i < values.length; i += 1) {
    out.push(alpha * finite(values[i]) + (1 - alpha) * out[i - 1]);
  }
  return out;
}

function rsi(values, length = 14) {
  const out = new Array(values.length).fill(50);
  if (values.length <= length) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i += 1) {
    const delta = finite(values[i]) - finite(values[i - 1]);
    gain += Math.max(delta, 0);
    loss += Math.max(-delta, 0);
  }
  gain /= length;
  loss /= length;
  out[length] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = length + 1; i < values.length; i += 1) {
    const delta = finite(values[i]) - finite(values[i - 1]);
    gain = (gain * (length - 1) + Math.max(delta, 0)) / length;
    loss = (loss * (length - 1) + Math.max(-delta, 0)) / length;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  for (let i = 0; i < Math.min(length, out.length); i += 1) out[i] = out[length] ?? 50;
  return out;
}

function sma(values, length) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += finite(values[i]);
    if (i >= length) sum -= finite(values[i - length]);
    out.push(sum / Math.min(i + 1, length));
  }
  return out;
}

function buildIndicatorArrays(candles) {
  const closes = candles.map((c) => finite(c.close));
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(macd, 9);
  const histogram = macd.map((value, i) => value - signal[i]);
  const rsiValues = rsi(closes, 14);
  const rsiMa = sma(rsiValues, 9);
  const sma50 = sma(closes, 50);
  return { closes, macd, signal, histogram, rsiValues, rsiMa, sma50 };
}

function buildFeatures(candles, targetIndex, arrays = null) {
  const data = arrays || buildIndicatorArrays(candles);
  const { macd, signal, histogram, rsiValues, rsiMa } = data;
  const start = Math.max(0, targetIndex - CONTEXT_BARS);
  return candles.slice(start, targetIndex + 1).map((candle, offset) => {
    const i = start + offset;
    return {
      time: Number(candle.time),
      open: finite(candle.open),
      high: finite(candle.high),
      low: finite(candle.low),
      close: finite(candle.close),
      macd: macd[i],
      signal: signal[i],
      histogram: histogram[i],
      histogram_delta: i > 0 ? histogram[i] - histogram[i - 1] : 0,
      macd_delta: i > 0 ? macd[i] - macd[i - 1] : 0,
      rsi: rsiValues[i],
      rsi_ma: rsiMa[i],
      rsi_delta_1: i > 0 ? rsiValues[i] - rsiValues[i - 1] : 0,
      rsi_delta_3: i > 2 ? rsiValues[i] - rsiValues[i - 3] : 0,
    };
  });
}

function meanAbs(values) {
  if (!values.length) return 1;
  return values.reduce((sum, v) => sum + Math.abs(finite(v)), 0) / values.length || 1;
}

function vectorFromContext(context) {
  if (!Array.isArray(context) || context.length < 4) return null;

  const last = context[context.length - 1] || {};
  const prev = context[context.length - 2] || {};
  const prev3 = context[Math.max(0, context.length - 4)] || {};
  const recent = context.slice(-10);

  // Alte Annotationen können einzelne Felder noch nicht besitzen.
  // Deshalb wird jeder Eingang konsequent numerisch abgesichert.
  const lastHist = finite(last.histogram);
  const prevHist = finite(prev.histogram);
  const prev3Hist = finite(prev3.histogram);
  const lastMacd = finite(last.macd);
  const lastSignal = finite(last.signal);
  const lastRsi = finite(last.rsi, 50);
  const lastRsiMa = finite(last.rsi_ma, lastRsi);

  const macdScale = Math.max(meanAbs(recent.map((x) => finite(x?.macd))), 1e-9);
  const histScale = Math.max(meanAbs(recent.map((x) => finite(x?.histogram))), 1e-9);

  const currentAbs = Math.abs(lastHist);
  const prevAbs = Math.abs(prevHist);
  const prev3Abs = Math.abs(prev3Hist);
  const contraction1 = (prevAbs - currentAbs) / histScale;
  const contraction3 = (prev3Abs - currentAbs) / histScale;
  const sign = lastHist >= 0 ? 1 : -1;

  const vector = [
    lastHist / histScale,
    finite(last.histogram_delta) / histScale,
    lastMacd / macdScale,
    finite(last.macd_delta) / macdScale,
    (lastMacd - lastSignal) / histScale,
    (lastRsi - 50) / 25,
    finite(last.rsi_delta_1) / 10,
    finite(last.rsi_delta_3) / 20,
    (lastRsi - lastRsiMa) / 15,
    contraction1,
    contraction3,
    sign,
  ].map((value) => finite(value));

  return vector.every(Number.isFinite) ? vector : null;
}



function trueRange(candles) {
  return candles.map((candle, index) => {
    const high = finite(candle.high);
    const low = finite(candle.low);
    const prevClose = index > 0 ? finite(candles[index - 1].close) : finite(candle.close);
    return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  });
}

function buildTargetStates(candles, trendAnnotations) {
  const starts = [...(trendAnnotations || [])]
    .map((row) => ({
      time: Number(row.time),
      state: row.trend_start === "up" ? "up" : "down",
    }))
    .filter((row) => Number.isFinite(row.time))
    .sort((a, b) => a.time - b.time);

  const stateByTime = new Map();
  let state = null;
  let startCursor = 0;

  for (const candle of candles) {
    const time = Number(candle.time);
    while (startCursor < starts.length && starts[startCursor].time <= time) {
      state = starts[startCursor].state;
      startCursor += 1;
    }
    if (state) stateByTime.set(time, state);
  }

  return { starts, stateByTime };
}

function formulaStateSeries(candles, params) {
  const closes = candles.map((c) => finite(c.close));
  const basis = ema(closes, params.ema_length);
  const atr = ema(trueRange(candles), params.atr_length);
  const states = [];

  let state = "neutral";
  let pending = "neutral";
  let pendingCount = 0;
  let barsInState = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const close = closes[i];
    const atrNow = Math.max(finite(atr[i]), Math.abs(close) * 0.00001, 1e-9);
    const basisNow = finite(basis[i], close);
    const basisPrev = finite(basis[Math.max(0, i - params.slope_lookback)], basisNow);
    const closePrev = finite(closes[Math.max(0, i - params.momentum_lookback)], close);

    const distance = (close - basisNow) / atrNow;
    const slope = (basisNow - basisPrev) / atrNow;
    const momentum = (close - closePrev) / atrNow;

    const composite =
      distance +
      params.slope_weight * slope +
      params.momentum_weight * momentum;

    let wanted = state;
    if (composite >= params.hysteresis) wanted = "up";
    else if (composite <= -params.hysteresis) wanted = "down";

    if (state === "neutral") {
      if (wanted !== "neutral") {
        if (pending === wanted) pendingCount += 1;
        else {
          pending = wanted;
          pendingCount = 1;
        }
        if (pendingCount >= params.confirm_bars) {
          state = wanted;
          barsInState = 0;
          pending = "neutral";
          pendingCount = 0;
        }
      }
    } else if (wanted !== state && wanted !== "neutral" && barsInState >= params.min_state_bars) {
      if (pending === wanted) pendingCount += 1;
      else {
        pending = wanted;
        pendingCount = 1;
      }
      if (pendingCount >= params.confirm_bars) {
        state = wanted;
        barsInState = 0;
        pending = "neutral";
        pendingCount = 0;
      }
    } else {
      pending = "neutral";
      pendingCount = 0;
    }

    states.push({
      time: Number(candles[i].time),
      state,
      composite: Number(composite.toFixed(4)),
    });
    barsInState += 1;
  }

  return states;
}

function evaluateFormula(candles, trendAnnotations, params) {
  const target = buildTargetStates(candles, trendAnnotations);
  const predicted = formulaStateSeries(candles, params);

  let comparable = 0;
  let correct = 0;
  let unnecessarySwitches = 0;
  let shortIslands = 0;
  let previousState = "neutral";
  let islandLength = 0;

  for (const row of predicted) {
    const expected = target.stateByTime.get(row.time);
    if (expected) {
      comparable += 1;
      if (row.state === expected) correct += 1;
    }

    if (row.state !== previousState && row.state !== "neutral") {
      if (previousState !== "neutral") unnecessarySwitches += 1;
      if (islandLength > 0 && islandLength < 6) shortIslands += 1;
      islandLength = 1;
      previousState = row.state;
    } else if (row.state !== "neutral") {
      islandLength += 1;
    }
  }
  if (islandLength > 0 && islandLength < 6) shortIslands += 1;

  const predictedSwitchTimes = predicted
    .filter((row, index) =>
      row.state !== "neutral" &&
      (index === 0 || predicted[index - 1].state !== row.state),
    )
    .map((row) => row.time);

  let delaySum = 0;
  let delayCount = 0;
  const candleIndex = new Map(candles.map((c, i) => [Number(c.time), i]));

  for (const start of target.starts) {
    const targetIndex = candleIndex.get(start.time);
    if (!Number.isFinite(targetIndex)) continue;

    let bestDistance = Infinity;
    for (const predictedTime of predictedSwitchTimes) {
      const predictedIndex = candleIndex.get(predictedTime);
      if (!Number.isFinite(predictedIndex)) continue;
      const distance = Math.abs(predictedIndex - targetIndex);
      if (distance < bestDistance) bestDistance = distance;
    }
    if (Number.isFinite(bestDistance)) {
      delaySum += bestDistance;
      delayCount += 1;
    }
  }

  const accuracy = comparable ? correct / comparable : 0;
  const avgSwitchDistance = delayCount ? delaySum / delayCount : 999;
  const targetSwitchCount = Math.max(1, target.starts.length - 1);
  const extraSwitches = Math.max(0, unnecessarySwitches - targetSwitchCount);

  const score =
    accuracy * 100 -
    avgSwitchDistance * 1.4 -
    extraSwitches * 1.6 -
    shortIslands * 2.2;

  return {
    params,
    score: Number(score.toFixed(3)),
    accuracy_pct: Number((accuracy * 100).toFixed(2)),
    avg_switch_distance_bars: Number(avgSwitchDistance.toFixed(2)),
    switches: unnecessarySwitches,
    extra_switches: extraSwitches,
    short_islands: shortIslands,
    comparable_bars: comparable,
    states: predicted,
  };
}


const FORMULA_GRID = {
  emaLengths: [12, 24, 40, 60],
  atrLengths: [7, 14, 21],
  hysteresisValues: [0.4, 0.7, 1.0, 1.35],
  slopeLookbacks: [3, 8],
  momentumLookbacks: [3, 10],
  slopeWeights: [0, 0.6],
  momentumWeights: [0, 0.4],
  confirmBarsValues: [1, 2],
  minStateBarsValues: [2, 6],
};

const FORMULA_TOTAL =
  FORMULA_GRID.emaLengths.length *
  FORMULA_GRID.atrLengths.length *
  FORMULA_GRID.hysteresisValues.length *
  FORMULA_GRID.slopeLookbacks.length *
  FORMULA_GRID.momentumLookbacks.length *
  FORMULA_GRID.slopeWeights.length *
  FORMULA_GRID.momentumWeights.length *
  FORMULA_GRID.confirmBarsValues.length *
  FORMULA_GRID.minStateBarsValues.length;

function formulaParamsAt(index) {
  let cursor = Math.max(0, Math.floor(index));
  const take = (values) => {
    const value = values[cursor % values.length];
    cursor = Math.floor(cursor / values.length);
    return value;
  };

  // Reihenfolge entspricht exakt der bisherigen verschachtelten Matrix.
  const min_state_bars = take(FORMULA_GRID.minStateBarsValues);
  const confirm_bars = take(FORMULA_GRID.confirmBarsValues);
  const momentum_weight = take(FORMULA_GRID.momentumWeights);
  const slope_weight = take(FORMULA_GRID.slopeWeights);
  const momentum_lookback = take(FORMULA_GRID.momentumLookbacks);
  const slope_lookback = take(FORMULA_GRID.slopeLookbacks);
  const hysteresis = take(FORMULA_GRID.hysteresisValues);
  const atr_length = take(FORMULA_GRID.atrLengths);
  const ema_length = take(FORMULA_GRID.emaLengths);

  return {
    ema_length,
    atr_length,
    hysteresis,
    slope_lookback,
    momentum_lookback,
    slope_weight,
    momentum_weight,
    confirm_bars,
    min_state_bars,
  };
}

function prepareFormulaBatchContext(candles, trendAnnotations) {
  const target = buildTargetStates(candles, trendAnnotations);
  const targetState = new Int8Array(candles.length);
  const targetStartIndices = [];
  const candleIndex = new Map();

  for (let i = 0; i < candles.length; i += 1) {
    const time = Number(candles[i].time);
    candleIndex.set(time, i);
    const state = target.stateByTime.get(time);
    targetState[i] = state === "up" ? 1 : state === "down" ? -1 : 0;
  }

  for (const start of target.starts) {
    const index = candleIndex.get(Number(start.time));
    if (Number.isInteger(index)) targetStartIndices.push(index);
  }

  const closes = Float64Array.from(candles.map((c) => finite(c.close)));
  const tr = Float64Array.from(trueRange(candles));
  const basisCache = new Map();
  const atrCache = new Map();

  for (const length of FORMULA_GRID.emaLengths) {
    basisCache.set(length, Float64Array.from(ema(Array.from(closes), length)));
  }
  for (const length of FORMULA_GRID.atrLengths) {
    atrCache.set(length, Float64Array.from(ema(Array.from(tr), length)));
  }

  return {
    closes,
    targetState,
    targetStartIndices,
    basisCache,
    atrCache,
    targetSwitchCount: Math.max(1, target.starts.length - 1),
  };
}

function evaluateFormulaBatchItem(context, params) {
  const {
    closes,
    targetState,
    targetStartIndices,
    basisCache,
    atrCache,
    targetSwitchCount,
  } = context;

  const basis = basisCache.get(params.ema_length);
  const atr = atrCache.get(params.atr_length);

  let state = 0;
  let pending = 0;
  let pendingCount = 0;
  let barsInState = 0;
  let comparable = 0;
  let correct = 0;
  let switches = 0;
  let shortIslands = 0;
  let previousState = 0;
  let islandLength = 0;
  const predictedSwitchIndices = [];

  for (let i = 0; i < closes.length; i += 1) {
    const close = closes[i];
    const atrNow = Math.max(finite(atr[i]), Math.abs(close) * 0.00001, 1e-9);
    const basisNow = finite(basis[i], close);
    const basisPrev = finite(basis[Math.max(0, i - params.slope_lookback)], basisNow);
    const closePrev = finite(closes[Math.max(0, i - params.momentum_lookback)], close);

    const distanceValue = (close - basisNow) / atrNow;
    const slope = (basisNow - basisPrev) / atrNow;
    const momentum = (close - closePrev) / atrNow;
    const composite =
      distanceValue +
      params.slope_weight * slope +
      params.momentum_weight * momentum;

    let wanted = state;
    if (composite >= params.hysteresis) wanted = 1;
    else if (composite <= -params.hysteresis) wanted = -1;

    if (state === 0) {
      if (wanted !== 0) {
        if (pending === wanted) pendingCount += 1;
        else {
          pending = wanted;
          pendingCount = 1;
        }
        if (pendingCount >= params.confirm_bars) {
          state = wanted;
          barsInState = 0;
          pending = 0;
          pendingCount = 0;
        }
      }
    } else if (wanted !== state && wanted !== 0 && barsInState >= params.min_state_bars) {
      if (pending === wanted) pendingCount += 1;
      else {
        pending = wanted;
        pendingCount = 1;
      }
      if (pendingCount >= params.confirm_bars) {
        state = wanted;
        barsInState = 0;
        pending = 0;
        pendingCount = 0;
      }
    } else {
      pending = 0;
      pendingCount = 0;
    }

    const expected = targetState[i];
    if (expected !== 0) {
      comparable += 1;
      if (state === expected) correct += 1;
    }

    if (state !== previousState && state !== 0) {
      if (previousState !== 0) switches += 1;
      if (islandLength > 0 && islandLength < 6) shortIslands += 1;
      islandLength = 1;
      previousState = state;
      predictedSwitchIndices.push(i);
    } else if (state !== 0) {
      islandLength += 1;
    }

    barsInState += 1;
  }

  if (islandLength > 0 && islandLength < 6) shortIslands += 1;

  let delaySum = 0;
  let delayCount = 0;
  for (const targetIndex of targetStartIndices) {
    let bestDistance = Infinity;
    for (const predictedIndex of predictedSwitchIndices) {
      const distance = Math.abs(predictedIndex - targetIndex);
      if (distance < bestDistance) bestDistance = distance;
    }
    if (Number.isFinite(bestDistance)) {
      delaySum += bestDistance;
      delayCount += 1;
    }
  }

  const accuracy = comparable ? correct / comparable : 0;
  const avgSwitchDistance = delayCount ? delaySum / delayCount : 999;
  const extraSwitches = Math.max(0, switches - targetSwitchCount);
  const score =
    accuracy * 100 -
    avgSwitchDistance * 1.4 -
    extraSwitches * 1.6 -
    shortIslands * 2.2;

  return {
    params,
    score: Number(score.toFixed(3)),
    accuracy_pct: Number((accuracy * 100).toFixed(2)),
    avg_switch_distance_bars: Number(avgSwitchDistance.toFixed(2)),
    switches,
    extra_switches: extraSwitches,
    short_islands: shortIslands,
    comparable_bars: comparable,
  };
}

function keepFormulaTop10(top, result) {
  let insertAt = top.findIndex((row) => result.score > row.score);
  if (insertAt < 0) insertAt = top.length;
  top.splice(insertAt, 0, result);
  if (top.length > 10) top.length = 10;
}

function formulaJobPublic(job, includeResult = true) {
  const done = job.next_index >= job.total;
  const progressPct = Number(((job.next_index / Math.max(1, job.total)) * 100).toFixed(1));
  const best = job.top[0]
    ? {
        ...job.top[0],
        ...(done ? { states: formulaStateSeries(job.candles, job.top[0].params) } : {}),
      }
    : null;

  return {
    job_id: job.id,
    symbol: job.symbol,
    interval: job.interval,
    candle_count: job.candles.length,
    target_start_count: job.target_start_count,
    processed: job.next_index,
    total: job.total,
    progress_pct: progressPct,
    done,
    best: includeResult ? best : null,
    top: includeResult ? job.top : [],
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function optimizeTrendFormula(candles, trendAnnotations) {
  // Kompatibilitätsfunktion: nicht mehr von der UI verwendet.
  // Kleine synchrone Läufe bleiben für interne Tests möglich.
  const context = prepareFormulaBatchContext(candles, trendAnnotations);
  const top = [];
  for (let index = 0; index < FORMULA_TOTAL; index += 1) {
    keepFormulaTop10(top, evaluateFormulaBatchItem(context, formulaParamsAt(index)));
  }
  if (top.length) top[0] = { ...top[0], states: formulaStateSeries(candles, top[0].params) };
  top.tested_count = FORMULA_TOTAL;
  return top;
}

function buildTrendStateVector(candles, targetIndex, arrays = null) {
  if (!Array.isArray(candles) || targetIndex < 30 || targetIndex >= candles.length) return null;

  const data = arrays || buildIndicatorArrays(candles);
  const context = buildFeatures(candles, targetIndex, data);
  const momentumVector = vectorFromContext(context);
  if (!momentumVector) return null;

  const closes = data.closes;
  const sma50 = data.sma50 || sma(closes, 50);
  const close = finite(closes[targetIndex]);
  const smaNow = finite(sma50[targetIndex], close);
  const sma5 = finite(sma50[Math.max(0, targetIndex - 5)], smaNow);
  const close10 = finite(closes[Math.max(0, targetIndex - 10)], close);
  const close20 = finite(closes[Math.max(0, targetIndex - 20)], close);
  const recent = candles.slice(Math.max(0, targetIndex - 20), targetIndex + 1);

  const ranges = recent.map((candle) => Math.max(
    Math.abs(finite(candle.high) - finite(candle.low)),
    Math.abs(finite(candle.close)) * 0.0001,
  ));
  const rangeScale = meanAbs(ranges);
  const priceScale = Math.max(Math.abs(close), 1e-9);

  const extra = [
    (close - smaNow) / Math.max(rangeScale, 1e-9),
    (smaNow - sma5) / Math.max(rangeScale, 1e-9),
    (close - close10) / priceScale * 100,
    (close - close20) / priceScale * 100,
  ].map((value) => finite(value));

  const vector = [...momentumVector, ...extra];
  return vector.length === 16 && vector.every(Number.isFinite) ? vector : null;
}

function trendStateProbabilities(vector, model) {
  const dUp = distance(vector, model.up_centroid, model.norm);
  const dDown = distance(vector, model.down_centroid, model.norm);
  if (!Number.isFinite(dUp) || !Number.isFinite(dDown)) {
    return { up: 50, down: 50 };
  }

  const margin = Math.max(-20, Math.min(20, dDown - dUp));
  const up = (1 / (1 + Math.exp(-margin * 2.0))) * 100;
  return {
    up: Number(Math.max(0, Math.min(100, finite(up, 50))).toFixed(2)),
    down: Number(Math.max(0, Math.min(100, finite(100 - up, 50))).toFixed(2)),
  };
}


function markerImitationVector(candles, targetIndex, arrays = null) {
  if (!Array.isArray(candles) || targetIndex < 30 || targetIndex >= candles.length) return null;
  const data = arrays || buildIndicatorArrays(candles);
  const offsets = [0, 1, 2, 3, 5, 8, 13, 20];
  const recentStart = Math.max(0, targetIndex - 20);
  const recentHist = data.histogram.slice(recentStart, targetIndex + 1);
  const recentMacd = data.macd.slice(recentStart, targetIndex + 1);
  const histScale = Math.max(meanAbs(recentHist), 1e-9);
  const macdScale = Math.max(meanAbs(recentMacd), 1e-9);
  const vector = [];

  for (const offset of offsets) {
    const i = targetIndex - offset;
    if (i < 1) return null;
    const candle = candles[i];
    const range = Math.max(Math.abs(finite(candle.high) - finite(candle.low)), Math.abs(finite(candle.close)) * 0.00001, 1e-9);
    const body = finite(candle.close) - finite(candle.open);
    const closeLocation = (finite(candle.close) - finite(candle.low)) / range;

    vector.push(
      finite(data.histogram[i]) / histScale,
      finite(data.histogram[i] - data.histogram[i - 1]) / histScale,
      finite(data.macd[i]) / macdScale,
      finite(data.macd[i] - data.macd[i - 1]) / macdScale,
      (finite(data.rsiValues[i], 50) - 50) / 25,
      finite(data.rsiValues[i] - data.rsiValues[i - 1]) / 10,
      (finite(data.rsiValues[i], 50) - finite(data.rsiMa[i], 50)) / 15,
      body / range,
      closeLocation - 0.5,
    );
  }

  return vector.every(Number.isFinite) ? vector : null;
}

function euclideanStandardized(a, b, norm) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const std = Math.max(finite(norm?.std?.[i], 1), 0.08);
    const delta = (finite(a[i]) - finite(b[i])) / std;
    sum += delta * delta;
  }
  return Math.sqrt(sum / Math.max(1, a.length));
}

function meanKDistance(vector, rows, norm, k = 5) {
  if (!rows.length) return Infinity;
  const distances = rows
    .map((row) => euclideanStandardized(vector, row.vector, norm))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .slice(0, Math.min(k, rows.length));
  if (!distances.length) return Infinity;
  return distances.reduce((sum, value) => sum + value, 0) / distances.length;
}

function e1Scores(vector, trainUt, trainDt, trainNone, norm) {
  const dUt = meanKDistance(vector, trainUt, norm, 5);
  const dDt = meanKDistance(vector, trainDt, norm, 5);
  const dNone = meanKDistance(vector, trainNone, norm, 7);
  const similarities = [dUt, dDt, dNone].map((distance) =>
    Number.isFinite(distance) ? Math.exp(-Math.max(0, distance) * 1.8) : 0
  );
  const total = similarities.reduce((sum, value) => sum + value, 0) || 1;
  return {
    ut: similarities[0] / total * 100,
    dt: similarities[1] / total * 100,
    none: similarities[2] / total * 100,
  };
}

function suppressDirectionalPredictions(rows, minGap = 4) {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const row of sorted) {
    if (kept.every((item) => Math.abs(item.index - row.index) >= minGap)) {
      kept.push(row);
    }
  }
  return kept.sort((a, b) => a.index - b.index);
}

function evaluateMarkerImitation(predictions, truth) {
  const used = new Set();
  let exact = 0;
  let within1 = 0;
  let within2 = 0;
  let missed = 0;
  const details = [];

  for (const marker of truth) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < predictions.length; i += 1) {
      if (used.has(i)) continue;
      const prediction = predictions[i];
      if (prediction.trend_start !== marker.trend_start) continue;
      const distance = Math.abs(prediction.index - marker.index);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestDistance <= 2) {
      used.add(bestIndex);
      if (bestDistance === 0) exact += 1;
      if (bestDistance <= 1) within1 += 1;
      within2 += 1;
      details.push({
        truth_time: marker.time,
        truth_type: marker.trend_start,
        predicted_time: predictions[bestIndex].time,
        distance_bars: predictions[bestIndex].index - marker.index,
        score: predictions[bestIndex].score,
        matched: true,
      });
    } else {
      missed += 1;
      details.push({
        truth_time: marker.time,
        truth_type: marker.trend_start,
        predicted_time: null,
        distance_bars: null,
        score: null,
        matched: false,
      });
    }
  }

  const falsePositives = predictions.length - used.size;
  const truthCount = truth.length;
  const precision = predictions.length ? used.size / predictions.length : 0;
  const recall2 = truthCount ? within2 / truthCount : 0;

  return {
    marker_count: truthCount,
    exact,
    within_1: within1,
    within_2: within2,
    missed,
    false_positives: falsePositives,
    prediction_count: predictions.length,
    exact_pct: Number((truthCount ? exact / truthCount * 100 : 0).toFixed(1)),
    within_1_pct: Number((truthCount ? within1 / truthCount * 100 : 0).toFixed(1)),
    within_2_pct: Number((recall2 * 100).toFixed(1)),
    precision_pct: Number((precision * 100).toFixed(1)),
    verdict: recall2 >= 0.70 ? "PASS" : recall2 < 0.40 ? "FAIL" : "UNCLEAR",
    details,
  };
}

async function runMarkerImitationE1({ db, getStoredCandles, symbol, interval, limit = 5000 }) {
  const candles = await getStoredCandles(symbol, interval, Math.min(10000, Math.max(500, limit)));
  const annotations = await db.all(
    `SELECT time,trend_start
     FROM qmomentum_trend_annotations
     WHERE symbol=? AND interval=?
     ORDER BY time ASC`,
    [symbol, interval],
  );

  if (annotations.length < 20) {
    return {
      ok: false,
      status: 400,
      error: `E1 benötigt mindestens 20 UT-/DT-Marker. Vorhanden: ${annotations.length}.`,
    };
  }

  const arrays = buildIndicatorArrays(candles);
  const indexByTime = new Map(candles.map((candle, index) => [Number(candle.time), index]));
  const markers = annotations
    .map((row) => ({
      time: Number(row.time),
      trend_start: row.trend_start === "up" ? "up" : "down",
      index: indexByTime.get(Number(row.time)),
    }))
    .filter((row) => Number.isInteger(row.index) && row.index >= 30);

  if (markers.length < 20) {
    return {
      ok: false,
      status: 400,
      error: `Zu wenige Marker liegen im geladenen Kerzenbereich. Nutzbar: ${markers.length}.`,
    };
  }

  const splitIndex = Math.max(10, Math.min(markers.length - 5, Math.floor(markers.length * 0.70)));
  const trainMarkers = markers.slice(0, splitIndex);
  const testMarkers = markers.slice(splitIndex);
  const splitCandleIndex = testMarkers[0].index;

  const trainUt = [];
  const trainDt = [];
  const allTrainVectors = [];

  for (const marker of trainMarkers) {
    const vector = markerImitationVector(candles, marker.index, arrays);
    if (!vector) continue;
    const row = { ...marker, vector };
    if (marker.trend_start === "up") trainUt.push(row);
    else trainDt.push(row);
    allTrainVectors.push(vector);
  }

  if (trainUt.length < 4 || trainDt.length < 4) {
    return {
      ok: false,
      status: 400,
      error: `E1 braucht im Trainingsabschnitt mindestens 4 UT und 4 DT. Vorhanden: UT ${trainUt.length}, DT ${trainDt.length}.`,
    };
  }

  const markerIndices = new Set(trainMarkers.flatMap((row) =>
    [-3,-2,-1,0,1,2,3].map((delta) => row.index + delta)
  ));
  const negativeCandidates = [];
  for (let i = 30; i < splitCandleIndex; i += 1) {
    if (markerIndices.has(i)) continue;
    if (i % 3 !== 0) continue;
    const vector = markerImitationVector(candles, i, arrays);
    if (vector) negativeCandidates.push({ index: i, time: Number(candles[i].time), vector });
  }

  const negativeTarget = Math.min(negativeCandidates.length, Math.max(30, allTrainVectors.length * 4));
  const trainNone = [];
  if (negativeTarget > 0) {
    const step = negativeCandidates.length / negativeTarget;
    for (let i = 0; i < negativeTarget; i += 1) {
      trainNone.push(negativeCandidates[Math.min(negativeCandidates.length - 1, Math.floor(i * step))]);
    }
  }

  const norm = statsForVectors([
    ...trainUt.map((row) => row.vector),
    ...trainDt.map((row) => row.vector),
    ...trainNone.map((row) => row.vector),
  ]);

  const rawPredictions = [];
  const threshold = 52;
  for (let i = Math.max(30, splitCandleIndex - 2); i < candles.length; i += 1) {
    const vector = markerImitationVector(candles, i, arrays);
    if (!vector) continue;
    const scores = e1Scores(vector, trainUt, trainDt, trainNone, norm);
    const direction = scores.ut >= scores.dt ? "up" : "down";
    const score = Math.max(scores.ut, scores.dt);
    if (score >= threshold && score >= scores.none + 4) {
      rawPredictions.push({
        index: i,
        time: Number(candles[i].time),
        price: finite(candles[i].close),
        trend_start: direction,
        score: Number(score.toFixed(2)),
        ut_score: Number(scores.ut.toFixed(2)),
        dt_score: Number(scores.dt.toFixed(2)),
        none_score: Number(scores.none.toFixed(2)),
      });
    }
  }

  const predictions = suppressDirectionalPredictions(rawPredictions, 4);
  const evaluation = evaluateMarkerImitation(predictions, testMarkers);

  return {
    ok: true,
    version: QMOMENTUM_VERSION,
    experiment: "E1_MARKER_IMITATION",
    symbol,
    interval,
    candle_count: candles.length,
    total_markers: markers.length,
    train_marker_count: trainMarkers.length,
    test_marker_count: testMarkers.length,
    train_ut: trainUt.length,
    train_dt: trainDt.length,
    train_none: trainNone.length,
    split_time: Number(candles[splitCandleIndex].time),
    window_bars: 30,
    features: "OHLC_MACD_HISTOGRAM_RSI_WINDOW",
    threshold,
    predictions,
    truth: testMarkers.map((row) => ({
      time: row.time,
      trend_start: row.trend_start,
      index: row.index,
    })),
    metrics: evaluation,
  };
}




function heikinAshi(candles) {
  const out = [];
  let prevOpen = null;
  let prevClose = null;
  for (const c of candles) {
    const close = (finite(c.open) + finite(c.high) + finite(c.low) + finite(c.close)) / 4;
    const open = prevOpen == null ? (finite(c.open) + finite(c.close)) / 2 : (prevOpen + prevClose) / 2;
    out.push({ time:Number(c.time), open, high:Math.max(finite(c.high),open,close), low:Math.min(finite(c.low),open,close), close });
    prevOpen = open; prevClose = close;
  }
  return out;
}

function atrSeries(candles, length) { return ema(trueRange(candles), length); }


function rollingMeanAbs(values, index, lookback = 60) {
  const from = Math.max(1, index - lookback + 1);
  let sum = 0;
  let count = 0;
  for (let i = from; i <= index; i += 1) {
    const value = Math.abs(finite(values[i]));
    if (!Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }
  return count ? sum / count : 0;
}

function kingKnickPredictions(candles, params) {
  const source = params.heikin ? heikinAshi(candles) : candles;
  const closes = source.map((c) => finite(c.close));
  const fast = ema(closes, params.macd_fast);
  const slow = ema(closes, params.macd_slow);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(macd, params.macd_signal);
  const hist = macd.map((value, i) => value - signal[i]);
  const rv = rsi(closes, params.rsi_length || 14);
  const atr = atrSeries(source, params.atr_length || 14);
  const w = Math.max(1, Number(params.kink_window || 2));
  const slope = macd.map((_, i) => i >= w ? (macd[i] - macd[i - w]) / w : 0);
  const curvature = slope.map((value, i) => i >= w ? value - slope[i - w] : 0);

  const predictions = [];
  let heldDirection = null;
  let lastIndex = -9999;
  const warmup = Math.max(params.macd_slow + w * 3, 40);

  for (let i = warmup; i < candles.length; i += 1) {
    const previousSlope = slope[i - w];
    const currentSlope = slope[i];
    const upTurn = previousSlope < 0 && currentSlope >= 0;
    const downTurn = previousSlope > 0 && currentSlope <= 0;
    if (!upTurn && !downTurn) continue;

    const scale = Math.max(
      rollingMeanAbs(curvature, i - 1, 80),
      rollingMeanAbs(slope, i - 1, 80) * 0.35,
      Math.abs(closes[i]) * 1e-8,
      1e-9,
    );
    const kinkStrength = Math.abs(curvature[i]) / scale;
    if (kinkStrength < Number(params.kink_threshold || 1.5)) continue;

    const direction = upTurn ? "up" : "down";
    if (direction === heldDirection) continue;
    if (i - lastIndex < Number(params.min_gap || 6)) continue;

    const green = finite(source[i].close) > finite(source[i].open);
    const red = finite(source[i].close) < finite(source[i].open);
    if (params.require_ha_color && ((direction === "up" && !green) || (direction === "down" && !red))) continue;

    const currentAtr = Math.max(finite(atr[i]), Math.abs(closes[i]) * 1e-7, 1e-9);
    const bodyAtr = Math.abs(finite(source[i].close) - finite(source[i].open)) / currentAtr;
    if (bodyAtr < Number(params.atr_body_min || 0)) continue;

    const rsiMode = params.rsi_mode || "none";
    if (rsiMode === "slope") {
      const rsiDelta = finite(rv[i]) - finite(rv[Math.max(0, i - w)]);
      if ((direction === "up" && rsiDelta <= 0) || (direction === "down" && rsiDelta >= 0)) continue;
    } else if (rsiMode === "level") {
      if ((direction === "up" && finite(rv[i]) < 40) || (direction === "down" && finite(rv[i]) > 60)) continue;
    }

    const histAgreement = direction === "up" ? hist[i] >= hist[i - 1] : hist[i] <= hist[i - 1];
    const score = Math.min(100, 45 + kinkStrength * 18 + (histAgreement ? 8 : 0));

    heldDirection = direction;
    lastIndex = i;
    predictions.push({
      index: i,
      time: Number(candles[i].time),
      price: finite(candles[i].close),
      trend_start: direction,
      score: Number(score.toFixed(2)),
      kink_strength: Number(kinkStrength.toFixed(3)),
      macd_value: Number(finite(macd[i]).toFixed(8)),
      slope_before: Number(finite(previousSlope).toFixed(8)),
      slope_after: Number(finite(currentSlope).toFixed(8)),
      body_atr: Number(bodyAtr.toFixed(3)),
    });
  }
  return predictions;
}

function evaluateKingKnick(predictions, markers) {
  const used = new Set();
  let exact = 0;
  let within1 = 0;
  let within2 = 0;
  let missed = 0;
  let totalDist = 0;
  let utTotal = 0;
  let dtTotal = 0;
  let utHit = 0;
  let dtHit = 0;

  for (const marker of markers) {
    if (marker.trend_start === "up") utTotal += 1;
    else dtTotal += 1;

    let best = -1;
    let distance = 999;
    for (let i = 0; i < predictions.length; i += 1) {
      if (used.has(i) || predictions[i].trend_start !== marker.trend_start) continue;
      const candidateDistance = Math.abs(predictions[i].index - marker.index);
      if (candidateDistance < distance) {
        distance = candidateDistance;
        best = i;
      }
    }

    if (best >= 0 && distance <= 2) {
      used.add(best);
      totalDist += distance;
      if (distance === 0) exact += 1;
      if (distance <= 1) within1 += 1;
      within2 += 1;
      if (marker.trend_start === "up") utHit += 1;
      else dtHit += 1;
    } else {
      missed += 1;
    }
  }

  const extras = Math.max(0, predictions.length - used.size);
  const markerCount = markers.length;
  const precision = predictions.length ? used.size / predictions.length * 100 : 0;
  const recall = markerCount ? within2 / markerCount * 100 : 0;
  const avgDistance = used.size ? totalDist / used.size : 99;

  // Große MACD-Knicke sollen wenige, saubere und alternierende Trendstarts liefern.
  const score =
    within2 * 34 +
    within1 * 10 +
    exact * 8 -
    missed * 30 -
    extras * 18 -
    avgDistance * 5 +
    precision * 0.35;

  return {
    marker_count: markerCount,
    exact,
    within_1: within1,
    within_2: within2,
    missed,
    false_positives: extras,
    prediction_count: predictions.length,
    exact_pct: Number((exact / Math.max(1, markerCount) * 100).toFixed(2)),
    within_1_pct: Number((within1 / Math.max(1, markerCount) * 100).toFixed(2)),
    within_2_pct: Number(recall.toFixed(2)),
    precision_pct: Number(precision.toFixed(2)),
    avg_distance_bars: Number(avgDistance.toFixed(2)),
    ut_total: utTotal,
    ut_hit: utHit,
    dt_total: dtTotal,
    dt_hit: dtHit,
    score: Number(score.toFixed(2)),
  };
}

function kingMacdKnickGrid() {
  const out = [];
  for (const macd_fast of [2, 3, 4, 5, 6, 8]) {
    for (const macd_slow of [22, 26, 30, 35, 40]) {
      if (macd_fast >= macd_slow) continue;
      for (const macd_signal of [5, 7, 9]) {
        for (const heikin of [false, true]) {
          for (const kink_window of [1, 2, 3]) {
            for (const kink_threshold of [1.2, 1.6, 2.0]) {
              for (const min_gap of [5, 8, 12]) {
                out.push({
                  macd_fast,
                  macd_slow,
                  macd_signal,
                  heikin,
                  kink_window,
                  kink_threshold,
                  min_gap,
                  rsi_length: 14,
                  atr_length: 14,
                  require_ha_color: false,
                  atr_body_min: 0,
                  rsi_mode: "none",
                });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

function kingFilterGrid(macdWinners) {
  const out = [];
  const seen = new Set();
  for (const winner of macdWinners.slice(0, 12)) {
    const base = winner.params;
    for (const require_ha_color of [false, true]) {
      for (const atr_length of [10, 14, 20]) {
        for (const atr_body_min of [0, 0.15, 0.3]) {
          for (const rsi_length of [10, 14, 21]) {
            for (const rsi_mode of ["none", "slope", "level"]) {
              const params = {
                ...base,
                require_ha_color,
                atr_length,
                atr_body_min,
                rsi_length,
                rsi_mode,
              };
              const key = JSON.stringify(params);
              if (!seen.has(key)) {
                seen.add(key);
                out.push(params);
              }
            }
          }
        }
      }
    }
  }
  return out;
}


//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXTREME MACD OPTIMIZER
// Sucht MACD Fast/Slow/Signal sowie LONG- und SHORT-Zone getrennt.
// Die Zonen werden instrumentabhängig aus MACD-Quantilen abgeleitet.
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function quantileSorted(sorted, q) {
  if (!Array.isArray(sorted) || !sorted.length) return NaN;
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * q));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return finite(sorted[lower]) * (1 - weight) + finite(sorted[upper]) * weight;
}

function rollingZScore(values, length = 200) {
  const window = Math.max(30, Math.floor(finite(length, 200)));
  const z = new Array(values.length).fill(0);
  const mean = new Array(values.length).fill(0);
  const std = new Array(values.length).fill(1);
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < values.length; i += 1) {
    const value = finite(values[i]);
    sum += value;
    sumSq += value * value;

    if (i >= window) {
      const old = finite(values[i - window]);
      sum -= old;
      sumSq -= old * old;
    }

    const count = Math.min(i + 1, window);
    const avg = sum / Math.max(1, count);
    const variance = Math.max(0, sumSq / Math.max(1, count) - avg * avg);
    const deviation = Math.max(Math.sqrt(variance), Math.abs(avg) * 1e-9, 1e-9);
    mean[i] = avg;
    std[i] = deviation;
    z[i] = count >= Math.min(30, window) ? (value - avg) / deviation : 0;
  }

  return { z, mean, std, window };
}

function macdDistributionStats(macd) {
  const clean = macd.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) {
    return { mean: 0, std: 0, q01: 0, q05: 0, q95: 0, q99: 0 };
  }
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length;
  return {
    mean: Number(mean.toFixed(8)),
    std: Number(Math.sqrt(Math.max(0, variance)).toFixed(8)),
    q01: Number(quantileSorted(clean, 0.01).toFixed(8)),
    q05: Number(quantileSorted(clean, 0.05).toFixed(8)),
    q95: Number(quantileSorted(clean, 0.95).toFixed(8)),
    q99: Number(quantileSorted(clean, 0.99).toFixed(8)),
  };
}

function intervalToMinutes(interval) {
  const text = String(interval || "").trim().toLowerCase();
  const match = text.match(/^(\d+)(m|h|d)$/);
  if (!match) return 15;
  const value = Math.max(1, Number(match[1]));
  if (match[2] === "h") return value * 60;
  if (match[2] === "d") return value * 1440;
  return value;
}

function buildAlignedHigherTimeframeRsi(candles, targetMinutes, length = 14) {
  const targetSeconds = Math.max(60, Math.floor(targetMinutes) * 60);
  const buckets = [];
  let current = null;
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    const time = Number(candle.time);
    const bucketTime = Math.floor(time / targetSeconds) * targetSeconds;
    if (!current || current.time !== bucketTime) {
      current = { time: bucketTime, open: finite(candle.open), high: finite(candle.high), low: finite(candle.low), close: finite(candle.close), lastBaseIndex: i };
      buckets.push(current);
    } else {
      current.high = Math.max(current.high, finite(candle.high));
      current.low = Math.min(current.low, finite(candle.low));
      current.close = finite(candle.close);
      current.lastBaseIndex = i;
    }
  }
  const values = rsi(buckets.map((row) => row.close), length);
  const aligned = Array(candles.length).fill(50);
  let lastClosedValue = 50;
  for (let b = 0; b < buckets.length; b += 1) {
    const startIndex = b === 0 ? 0 : buckets[b - 1].lastBaseIndex + 1;
    const endIndex = buckets[b].lastBaseIndex;
    for (let i = startIndex; i <= endIndex; i += 1) aligned[i] = lastClosedValue;
    // Only expose this HTF value from the next base candle onward. This avoids look-ahead.
    lastClosedValue = finite(values[b], lastClosedValue);
  }
  const lastBucket = buckets[buckets.length - 1];
  if (lastBucket && lastBucket.lastBaseIndex + 1 < aligned.length) {
    for (let i = lastBucket.lastBaseIndex + 1; i < aligned.length; i += 1) aligned[i] = lastClosedValue;
  }
  return aligned;
}


function normalizeIndicatorTfMinutes(rawValue, baseMinutes) {
  const parsed = intervalToMinutes(String(rawValue || `${baseMinutes}m`));
  return Math.max(baseMinutes, Math.min(1440, parsed));
}

function aggregateCandlesForIndicator(candles, targetMinutes) {
  const targetSeconds = Math.max(60, Math.floor(targetMinutes) * 60);
  const buckets = [];
  let current = null;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const time = Number(candle.time);
    const bucketTime = Math.floor(time / targetSeconds) * targetSeconds;

    if (!current || current.time !== bucketTime) {
      current = {
        time: bucketTime,
        open: finite(candle.open),
        high: finite(candle.high),
        low: finite(candle.low),
        close: finite(candle.close),
        volume: finite(candle.volume, 0),
        firstBaseIndex: index,
        lastBaseIndex: index,
      };
      buckets.push(current);
    } else {
      current.high = Math.max(current.high, finite(candle.high));
      current.low = Math.min(current.low, finite(candle.low));
      current.close = finite(candle.close);
      current.volume += finite(candle.volume, 0);
      current.lastBaseIndex = index;
    }
  }

  return buckets;
}

function alignClosedBucketValues(candles, buckets, values, fallbackValue) {
  const aligned = Array(candles.length).fill(fallbackValue);

  for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
    const bucket = buckets[bucketIndex];
    const exposedValue = bucketIndex > 0
      ? finite(values[bucketIndex - 1], fallbackValue)
      : fallbackValue;

    for (
      let baseIndex = bucket.firstBaseIndex;
      baseIndex <= bucket.lastBaseIndex;
      baseIndex += 1
    ) {
      aligned[baseIndex] = exposedValue;
    }
  }

  return aligned;
}

function buildClosedMacdPack(candles, targetMinutes, params, baseMinutes) {
  if (targetMinutes <= baseMinutes) {
    const closes = candles.map((candle) => finite(candle.close));
    const fast = ema(closes, params.macd_fast);
    const slow = ema(closes, params.macd_slow);
    const macd = closes.map((_, index) => finite(fast[index]) - finite(slow[index]));
    const signal = ema(macd, params.macd_signal);
    const histogram = macd.map((value, index) => value - finite(signal[index]));
    const normalized = rollingZScore(macd, params.z_window || 200);
    return { macd, signal, histogram, z: normalized.z };
  }

  const buckets = aggregateCandlesForIndicator(candles, targetMinutes);
  const closes = buckets.map((candle) => finite(candle.close));
  const fast = ema(closes, params.macd_fast);
  const slow = ema(closes, params.macd_slow);
  const bucketMacd = closes.map((_, index) => finite(fast[index]) - finite(slow[index]));
  const bucketSignal = ema(bucketMacd, params.macd_signal);
  const bucketHistogram = bucketMacd.map(
    (value, index) => value - finite(bucketSignal[index])
  );
  const normalized = rollingZScore(bucketMacd, params.z_window || 200);

  return {
    macd: alignClosedBucketValues(candles, buckets, bucketMacd, 0),
    signal: alignClosedBucketValues(candles, buckets, bucketSignal, 0),
    histogram: alignClosedBucketValues(candles, buckets, bucketHistogram, 0),
    z: alignClosedBucketValues(candles, buckets, normalized.z, 0),
  };
}

function buildClosedRsiPack(candles, targetMinutes, params, baseMinutes) {
  if (targetMinutes <= baseMinutes) {
    const closes = candles.map((candle) => finite(candle.close));
    const values = rsi(closes, params.rsi_length || 14);
    return {
      rsi: values,
      rsiSignal: sma(values, params.rsi_signal || 9),
    };
  }

  const buckets = aggregateCandlesForIndicator(candles, targetMinutes);
  const closes = buckets.map((candle) => finite(candle.close));
  const bucketRsi = rsi(closes, params.rsi_length || 14);
  const bucketSignal = sma(bucketRsi, params.rsi_signal || 9);
  return {
    rsi: alignClosedBucketValues(candles, buckets, bucketRsi, 50),
    rsiSignal: alignClosedBucketValues(candles, buckets, bucketSignal, 50),
  };
}

function buildClosedAdValues(candles, targetMinutes, length, baseMinutes) {
  if (targetMinutes <= baseMinutes) return buildAdRatio(candles, length);
  const buckets = aggregateCandlesForIndicator(candles, targetMinutes);
  const bucketValues = buildAdRatio(buckets, length);
  return alignClosedBucketValues(candles, buckets, bucketValues, 1);
}

function buildClosedChaikinValues(candles, targetMinutes, fast, slow, baseMinutes) {
  if (targetMinutes <= baseMinutes) {
    return buildChaikinOscillator(candles, fast, slow);
  }
  const buckets = aggregateCandlesForIndicator(candles, targetMinutes);
  const bucketData = buildChaikinOscillator(buckets, fast, slow);
  return {
    values: alignClosedBucketValues(candles, buckets, bucketData.values, 0),
    volume_coverage_pct: bucketData.volume_coverage_pct,
  };
}

function buildMultiTimeframeExtremeSeries(candles, params) {
  const baseMinutes = intervalToMinutes(params.interval || "5m");
  const macdMinutes = normalizeIndicatorTfMinutes(params.macd_tf, baseMinutes);
  const rsiMinutes = normalizeIndicatorTfMinutes(params.rsi_tf, baseMinutes);
  const adMinutes = normalizeIndicatorTfMinutes(params.ad_tf, baseMinutes);
  const chaikinMinutes = normalizeIndicatorTfMinutes(params.chaikin_tf, baseMinutes);

  const macdPack = buildClosedMacdPack(candles, macdMinutes, params, baseMinutes);
  const rsiPack = buildClosedRsiPack(candles, rsiMinutes, params, baseMinutes);
  const adRatio = buildClosedAdValues(
    candles,
    adMinutes,
    params.ad_length || 11,
    baseMinutes
  );
  const chaikinData = buildClosedChaikinValues(
    candles,
    chaikinMinutes,
    params.chaikin_fast || 3,
    params.chaikin_slow || 10,
    baseMinutes
  );

  const htfRsi = buildAlignedHigherTimeframeRsi(
    candles,
    params.exit_htf_minutes || 30,
    params.rsi_length || 14
  );
  const exitTimingRsi = buildAlignedHigherTimeframeRsi(
    candles,
    params.exit_timing_minutes || baseMinutes,
    params.rsi_length || 14
  );

  return {
    macd: macdPack.macd,
    signal: macdPack.signal,
    histogram: macdPack.histogram,
    z: macdPack.z,
    rsi: rsiPack.rsi,
    rsiSignal: rsiPack.rsiSignal,
    htfRsi,
    exitTimingRsi,
    adRatio,
    chaikin: chaikinData.values,
    volume_coverage_pct: chaikinData.volume_coverage_pct,
    rolling_mean: [],
    rolling_std: [],
    z_window: params.z_window || 200,
    distribution: macdDistributionStats(macdPack.macd),
    indicator_timeframes: {
      chart: `${baseMinutes}m`,
      macd: `${macdMinutes}m`,
      rsi: `${rsiMinutes}m`,
      ad: `${adMinutes}m`,
      chaikin: `${chaikinMinutes}m`,
      mode: "closed_htf",
    },
  };
}

function buildHeikinAshiForTrend(candles) {
  const out = [];
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const close = (finite(c.open) + finite(c.high) + finite(c.low) + finite(c.close)) / 4;
    const open = i === 0
      ? (finite(c.open) + finite(c.close)) / 2
      : (finite(out[i - 1].open) + finite(out[i - 1].close)) / 2;
    out.push({ open, close });
  }
  return out;
}

function buildAdRatio(candles, length = 11) {
  const source = buildHeikinAshiForTrend(candles);
  const n = Math.max(2, Math.floor(finite(length, 11)));
  const out = Array(candles.length).fill(1);
  let up = 0;
  let down = 0;
  const flags = source.map((c) => c.close >= c.open ? 1 : -1);
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i] > 0) up += 1; else down += 1;
    if (i >= n) {
      if (flags[i - n] > 0) up -= 1; else down -= 1;
    }
    out[i] = down === 0 ? up : up / down;
  }
  return out;
}

function buildChaikinOscillator(candles, fastLength = 3, slowLength = 10) {
  const adl = Array(candles.length).fill(0);
  let cumulative = 0;
  let realVolumeCount = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const high = finite(c.high);
    const low = finite(c.low);
    const close = finite(c.close);
    const rawVolume = finite(c.volume, 0);
    if (rawVolume > 0) realVolumeCount += 1;
    const volume = rawVolume > 0 ? rawVolume : 1;
    const range = high - low;
    const multiplier = range === 0 ? 0 : ((close - low) - (high - close)) / range;
    cumulative += multiplier * volume;
    adl[i] = cumulative;
  }
  const fast = ema(adl, Math.max(1, Math.floor(finite(fastLength, 3))));
  const slow = ema(adl, Math.max(2, Math.floor(finite(slowLength, 10))));
  return {
    values: adl.map((_, i) => finite(fast[i]) - finite(slow[i])),
    volume_coverage_pct: candles.length ? realVolumeCount / candles.length * 100 : 0,
  };
}

function buildExtremeMacdSeries(candles, params) {
  const closes = candles.map((candle) => finite(candle.close));
  const fast = ema(closes, params.macd_fast);
  const slow = ema(closes, params.macd_slow);
  const macd = closes.map((_, index) => finite(fast[index]) - finite(slow[index]));
  const signal = ema(macd, params.macd_signal);
  const histogram = macd.map((value, index) => value - finite(signal[index]));
  const rsiValues = rsi(closes, params.rsi_length || 14);
  const rsiSignal = sma(rsiValues, params.rsi_signal || 9);
  const normalized = rollingZScore(macd, params.z_window || 200);
  const htfRsi = buildAlignedHigherTimeframeRsi(candles, params.exit_htf_minutes || 30, params.rsi_length || 14);
  const exitTimingRsi = buildAlignedHigherTimeframeRsi(
    candles,
    params.exit_timing_minutes || intervalToMinutes(params.interval || "5m"),
    params.rsi_length || 14,
  );
  const adRatio = buildAdRatio(candles, params.ad_length || 11);
  const chaikinData = buildChaikinOscillator(candles, params.chaikin_fast || 3, params.chaikin_slow || 10);
  return {
    macd,
    signal,
    histogram,
    rsi: rsiValues,
    rsiSignal,
    htfRsi,
    exitTimingRsi,
    adRatio,
    chaikin: chaikinData.values,
    volume_coverage_pct: chaikinData.volume_coverage_pct,
    z: normalized.z,
    rolling_mean: normalized.mean,
    rolling_std: normalized.std,
    z_window: normalized.window,
    distribution: macdDistributionStats(macd),
  };
}

function extremeZonePairs() {
  const longSigma = [-0.5, -0.75, -1.0, -1.25, -1.5, -1.75, -2.0];
  const shortSigma = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const pairs = [];
  for (const long_zone_sigma of longSigma) {
    for (const short_zone_sigma of shortSigma) pairs.push({ long_zone_sigma, short_zone_sigma });
  }
  return pairs;
}

function simulateExtremeMacd(candles, series, params, includeEvents = false) {
  const { macd, signal, histogram, rsi: rsiValues, rsiSignal, htfRsi, exitTimingRsi, adRatio, chaikin, z } = series;
  let position = 0;
  let entryPrice = NaN;
  let entryIndex = -1;
  let entryOriginNullReset = false;
  let longArmed = false;
  let shortArmed = false;
  // State Audit V7.1a: A continuous sigma-extreme phase may arm only once.
  // Staying inside the same extreme zone after an entry must not re-arm it.
  let longExtremeActive = false;
  let shortExtremeActive = false;
  let longExtremePhaseId = 0;
  let shortExtremePhaseId = 0;
  let longExtremeConsumed = false;
  let shortExtremeConsumed = false;
  let exitArmed = false;
  let macdSupportSeen = false;
  let tradeMfe = 0;
  let captureSum = 0;
  let capturedTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let net = 0;
  let wins = 0;
  let losses = 0;
  let trades = 0;
  let extremeEntryCount = 0;
  let trendEntryCount = 0;
  let largestLoss = 0;
  let totalLoss = 0;
  let totalWin = 0;
  let equityPeak = 0;
  let maxDrawdown = 0;
  const events = [];
  const exitCounts = {};
  const protectExitCounts = {};
  const profitExitCounts = {};
  const lower = Math.max(1, Math.min(49, finite(params.exit_rsi_lower, 30)));
  const upper = Math.max(51, Math.min(99, finite(params.exit_rsi_upper, 70)));
  const protectBars = Math.max(1, Math.floor(finite(params.protect_min_hold_bars, 3)));

  const warmup = Math.max(
    params.macd_slow + params.macd_signal + 5,
    (params.rsi_length || 14) + (params.rsi_signal || 9) + 5,
    Math.min(30, params.z_window || 200),
    40,
  );

  const pushStateEvent = (i, side, action, details = {}) => {
    if (!includeEvents) return;
    const candle = candles[i];
    events.push({
      type: "state", side, action, index: i, time: Number(candle.time), price: finite(candle.close),
      long_armed: longArmed, short_armed: shortArmed,
      long_consumed: longExtremeConsumed, short_consumed: shortExtremeConsumed,
      long_phase_id: longExtremePhaseId, short_phase_id: shortExtremePhaseId,
      ...details,
    });
  };

  const closeTrade = (direction, i, reason, exitType) => {
    const candle = candles[i];
    const exitPrice = finite(candle.close);
    const pnl = direction === "long" ? exitPrice - entryPrice : entryPrice - exitPrice;
    net += pnl;
    trades += 1;
    exitCounts[reason] = (exitCounts[reason] || 0) + 1;
    if (exitType === "protect") protectExitCounts[reason] = (protectExitCounts[reason] || 0) + 1;
    if (exitType === "profit") profitExitCounts[reason] = (profitExitCounts[reason] || 0) + 1;
    if (pnl > 0) { grossProfit += pnl; totalWin += pnl; wins += 1; }
    else { const loss = Math.abs(pnl); grossLoss += loss; totalLoss += loss; largestLoss = Math.max(largestLoss, loss); losses += 1; }
    if (tradeMfe > 0) { captureSum += pnl / tradeMfe; capturedTrades += 1; }
    if (includeEvents) events.push({
      type: "exit", direction, index: i, time: Number(candle.time), price: exitPrice,
      pnl: Number(pnl.toFixed(6)), reason, exit_type: exitType,
      mfe: Number(tradeMfe.toFixed(6)), capture_pct: tradeMfe > 0 ? Number((pnl / tradeMfe * 100).toFixed(2)) : null,
      rsi: Number(finite(rsiValues[i], 50).toFixed(4)), htf_rsi: Number(finite(htfRsi[i], 50).toFixed(4)),
      exit_timing_rsi: Number(finite(exitTimingRsi[i], 50).toFixed(4)),
    });
    position = 0; entryPrice = NaN; entryIndex = -1; exitArmed = false; macdSupportSeen = false; tradeMfe = 0;
  };

  const openTrade = (direction, i, reason, zNow, rsiNow, rsiSignalNow, consumeExtreme = true) => {
    const candle = candles[i];
    const close = finite(candle.close);
    position = direction === "long" ? 1 : -1;
    entryPrice = close; entryIndex = i; exitArmed = false; tradeMfe = 0; entryOriginNullReset = false;
    if (String(reason).startsWith("TREND ")) trendEntryCount += 1;
    else extremeEntryCount += 1;
    macdSupportSeen = direction === "long" ? finite(histogram[i]) > 0 : finite(histogram[i]) < 0;
    if (consumeExtreme && direction === "long") {
      longArmed = false;
      longExtremeConsumed = true;
      pushStateEvent(i, "long", "CONSUMED", { reason: "ENTRY" });
    } else if (consumeExtreme) {
      shortArmed = false;
      shortExtremeConsumed = true;
      pushStateEvent(i, "short", "CONSUMED", { reason: "ENTRY" });
    }
    if (includeEvents) events.push({
      type: "entry", direction, index: i, time: Number(candle.time), price: close,
      macd: Number(finite(macd[i]).toFixed(8)), signal: Number(finite(signal[i]).toFixed(8)),
      rsi: Number(rsiNow.toFixed(6)), rsi_signal: Number(rsiSignalNow.toFixed(6)),
      htf_rsi: Number(finite(htfRsi[i], 50).toFixed(6)),
      exit_timing_rsi: Number(finite(exitTimingRsi[i], 50).toFixed(6)),
      z_score: Number(zNow.toFixed(6)), reason,
      extreme_phase_id: direction === "long" ? longExtremePhaseId : shortExtremePhaseId,
    });
  };

  for (let i = warmup; i < candles.length; i += 1) {
    const zNow = finite(z[i]);
    const zPrev = finite(z[i - 1]);
    const macdNow = finite(macd[i]);
    const histNow = finite(histogram[i]);
    const rsiPrev = finite(rsiValues[i - 1], 50);
    const rsiNow = finite(rsiValues[i], 50);
    const rsiSignalPrev = finite(rsiSignal[i - 1], 50);
    const rsiSignalNow = finite(rsiSignal[i], 50);
    const htfNow = finite(htfRsi[i], 50);
    const exitTimingPrev = finite(exitTimingRsi[i - 1], 50);
    const exitTimingNow = finite(exitTimingRsi[i], 50);
    const adNow = finite(adRatio?.[i], 1);
    const chaikinNow = finite(chaikin?.[i], 0);
    const filterMode = String(params.trend_filter_mode || "none").toLowerCase();
    const trendLongAllowed = filterMode === "ad" ? adNow > 1 : filterMode === "chaikin" ? chaikinNow > 0 : false;
    const trendShortAllowed = filterMode === "ad" ? adNow < 1 : filterMode === "chaikin" ? chaikinNow < 0 : false;

    const inLongExtreme = zNow <= params.long_zone_sigma;
    const inShortExtreme = zNow >= params.short_zone_sigma;

    // Arm only on a NEW entry into the extreme zone. One uninterrupted
    // extreme phase can therefore create at most one entry per side.
    if (inLongExtreme && !longExtremeActive) {
      longExtremeActive = true;
      longExtremePhaseId += 1;
      longExtremeConsumed = false;
      longArmed = true;
      pushStateEvent(i, "long", "ARMED", {
        reason: "NEUER_ZONE_EINTRITT",
        z_prev: Number(zPrev.toFixed(6)),
        z_score: Number(zNow.toFixed(6)),
        threshold: Number(params.long_zone_sigma.toFixed(6)),
        comparison: "Z_NOW <= LONG_GRENZE",
      });
    }

    if (inShortExtreme && !shortExtremeActive) {
      shortExtremeActive = true;
      shortExtremePhaseId += 1;
      shortExtremeConsumed = false;
      shortArmed = true;
      pushStateEvent(i, "short", "ARMED", {
        reason: "NEUER_ZONE_EINTRITT",
        z_prev: Number(zPrev.toFixed(6)),
        z_score: Number(zNow.toFixed(6)),
        threshold: Number(params.short_zone_sigma.toFixed(6)),
        comparison: "Z_NOW >= SHORT_GRENZE",
      });
    }

    // V7.2: Eine Extremphase endet nicht schon beim Verlassen der Sigma-Zone.
    // Sie bleibt aktiv/verbrauchbar gesperrt, bis der MACD die Nulllinie auf
    // die Gegenseite überschreitet. So kann dieselbe Welle nicht mehrfach
    // neue Entries derselben Richtung erzeugen.
    if (longExtremeActive && macdNow >= 0) {
      if (position === 1) entryOriginNullReset = true;
      if (longArmed) {
        longArmed = false;
        pushStateEvent(i, "long", "DISARM", {
          reason: "MACD_NULLLINIE",
          macd_value: Number(macdNow.toFixed(8)),
          comparison: "MACD >= 0",
        });
      }
      pushStateEvent(i, "long", "RESET", {
        reason: "MACD_NULLLINIE_GEGEN_SEITE",
        z_prev: Number(zPrev.toFixed(6)),
        z_score: Number(zNow.toFixed(6)),
        threshold: 0,
        macd_value: Number(macdNow.toFixed(8)),
        comparison: "MACD >= 0",
      });
      longExtremeActive = false;
      longExtremeConsumed = false;
    }
    if (shortExtremeActive && macdNow <= 0) {
      if (position === -1) entryOriginNullReset = true;
      if (shortArmed) {
        shortArmed = false;
        pushStateEvent(i, "short", "DISARM", {
          reason: "MACD_NULLLINIE",
          macd_value: Number(macdNow.toFixed(8)),
          comparison: "MACD <= 0",
        });
      }
      pushStateEvent(i, "short", "RESET", {
        reason: "MACD_NULLLINIE_GEGEN_SEITE",
        z_prev: Number(zPrev.toFixed(6)),
        z_score: Number(zNow.toFixed(6)),
        threshold: 0,
        macd_value: Number(macdNow.toFixed(8)),
        comparison: "MACD <= 0",
      });
      shortExtremeActive = false;
      shortExtremeConsumed = false;
    }

    const longCross = rsiPrev <= rsiSignalPrev && rsiNow > rsiSignalNow;
    const shortCross = rsiPrev >= rsiSignalPrev && rsiNow < rsiSignalNow;
    const longEntryTrigger = longArmed && longCross;
    const shortEntryTrigger = shortArmed && shortCross;
    const trendSigma = Math.max(0, finite(params.trend_sigma_abs, 0.5));
    const histPrev = finite(histogram[i - 1]);
    const longKnick = histNow > histPrev;
    const shortKnick = histNow < histPrev;
    // Trendpfad is strictly additional. True sigma-extreme entries above keep priority
    // and deliberately ignore AD/Chaikin so reversal entries are never filtered away.
    const longTrendTrigger = !longEntryTrigger && !shortEntryTrigger && trendLongAllowed && zNow <= -trendSigma && longCross && longKnick;
    const shortTrendTrigger = !longEntryTrigger && !shortEntryTrigger && trendShortAllowed && zNow >= trendSigma && shortCross && shortKnick;

    if (position === 1) {
      tradeMfe = Math.max(tradeMfe, finite(candles[i].high) - entryPrice);
      if (histNow > 0) macdSupportSeen = true;
      if (htfNow >= upper) exitArmed = true;
    } else if (position === -1) {
      tradeMfe = Math.max(tradeMfe, entryPrice - finite(candles[i].low));
      if (histNow < 0) macdSupportSeen = true;
      if (htfNow <= lower) exitArmed = true;
    }

    let handledThisBar = false;
    if (position === 1) {
      if (shortEntryTrigger) {
        closeTrade("long", i, "GEGEN-EXTREM + RSI CROSS DOWN", "flip");
        openTrade("short", i, "SHORT ARMED + RSI CROSS DOWN", zNow, rsiNow, rsiSignalNow);
        handledThisBar = true;
      } else {
        const heldBars = i - entryIndex;
        const pnl = finite(candles[i].close) - entryPrice;
        const oppositeSigma = zNow >= params.short_zone_sigma;
        const macdInvalid = macdSupportSeen && histNow < 0;
        if (heldBars >= protectBars && pnl < 0 && (oppositeSigma || macdInvalid)) {
          const protectReason = oppositeSigma ? "PROTECT GEGEN-EXTREM" : "PROTECT MACD-UNTERSTÜTZUNG VERLOREN";
          const continuationFlip = !entryOriginNullReset;
          closeTrade("long", i, protectReason, "protect");
          if (continuationFlip) {
            openTrade("short", i, "PROTECT-FAILURE FLIP: LONG → SHORT OHNE NULLRESET", zNow, rsiNow, rsiSignalNow, false);
          }
          handledThisBar = true;
        } else if (exitArmed && exitTimingNow < exitTimingPrev) {
          closeTrade("long", i, `PROFIT HTF-RSI ≥ ${upper} → ${params.exit_timing_minutes || intervalToMinutes(params.interval || "5m")}m-RSI DREHT`, "profit");
          handledThisBar = true;
        }
      }
    } else if (position === -1) {
      if (longEntryTrigger) {
        closeTrade("short", i, "GEGEN-EXTREM + RSI CROSS UP", "flip");
        openTrade("long", i, "LONG ARMED + RSI CROSS UP", zNow, rsiNow, rsiSignalNow);
        handledThisBar = true;
      } else {
        const heldBars = i - entryIndex;
        const pnl = entryPrice - finite(candles[i].close);
        const oppositeSigma = zNow <= params.long_zone_sigma;
        const macdInvalid = macdSupportSeen && histNow > 0;
        if (heldBars >= protectBars && pnl < 0 && (oppositeSigma || macdInvalid)) {
          const protectReason = oppositeSigma ? "PROTECT GEGEN-EXTREM" : "PROTECT MACD-UNTERSTÜTZUNG VERLOREN";
          const continuationFlip = !entryOriginNullReset;
          closeTrade("short", i, protectReason, "protect");
          if (continuationFlip) {
            openTrade("long", i, "PROTECT-FAILURE FLIP: SHORT → LONG OHNE NULLRESET", zNow, rsiNow, rsiSignalNow, false);
          }
          handledThisBar = true;
        } else if (exitArmed && exitTimingNow > exitTimingPrev) {
          closeTrade("short", i, `PROFIT HTF-RSI ≤ ${lower} → ${params.exit_timing_minutes || intervalToMinutes(params.interval || "5m")}m-RSI DREHT`, "profit");
          handledThisBar = true;
        }
      }
    }

    if (!handledThisBar && position === 0) {
      if (longEntryTrigger && !shortEntryTrigger) openTrade("long", i, "LONG ARMED + RSI CROSS UP", zNow, rsiNow, rsiSignalNow);
      else if (shortEntryTrigger && !longEntryTrigger) openTrade("short", i, "SHORT ARMED + RSI CROSS DOWN", zNow, rsiNow, rsiSignalNow);
      else if (longTrendTrigger && !shortTrendTrigger) openTrade("long", i, `TREND ${filterMode.toUpperCase()} + GELÖSTES SIGMA + RSI/MACD KNICK UP`, zNow, rsiNow, rsiSignalNow, false);
      else if (shortTrendTrigger && !longTrendTrigger) openTrade("short", i, `TREND ${filterMode.toUpperCase()} + GELÖSTES SIGMA + RSI/MACD KNICK DOWN`, zNow, rsiNow, rsiSignalNow, false);
    }

    equityPeak = Math.max(equityPeak, net);
    maxDrawdown = Math.max(maxDrawdown, equityPeak - net);
  }

  const winRate = trades > 0 ? wins / trades * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const recovery = maxDrawdown > 0 ? net / maxDrawdown : net > 0 ? 99 : 0;
  const avgCapture = capturedTrades > 0 ? captureSum / capturedTrades * 100 : 0;
  const avgLoss = losses > 0 ? totalLoss / losses : 0;
  const avgWin = wins > 0 ? totalWin / wins : 0;
  const lossOutlierRatio = largestLoss / Math.max(1, avgWin || avgLoss || 1);
  const score = Math.min(5, profitFactor) * 28 + Math.max(-50, Math.min(70, recovery * 8)) + Math.log1p(trades) * 4 + winRate * 0.06 - Math.min(45, lossOutlierRatio * 7);

  return {
    trades, wins, losses, win_rate_pct: Number(winRate.toFixed(2)), net: Number(net.toFixed(6)),
    gross_profit: Number(grossProfit.toFixed(6)), gross_loss: Number(grossLoss.toFixed(6)),
    profit_factor: Number(profitFactor.toFixed(4)), max_drawdown: Number(maxDrawdown.toFixed(6)),
    recovery_factor: Number(recovery.toFixed(4)), avg_peak_capture_pct: Number(avgCapture.toFixed(2)),
    largest_loss: Number(largestLoss.toFixed(6)), avg_loss: Number(avgLoss.toFixed(6)), avg_win: Number(avgWin.toFixed(6)),
    loss_outlier_ratio: Number(lossOutlierRatio.toFixed(4)), score: Number(score.toFixed(4)), events,
    exit_counts: exitCounts, protect_exit_counts: protectExitCounts, profit_exit_counts: profitExitCounts,
    extreme_entry_count: extremeEntryCount, trend_entry_count: trendEntryCount,
    trend_filter_mode: String(params.trend_filter_mode || "none"),
    chaikin_volume_coverage_pct: Number(finite(series.volume_coverage_pct, 0).toFixed(2)),
    final_state: {
      position: position === 1 ? "long" : position === -1 ? "short" : "flat",
      long_armed: longArmed, short_armed: shortArmed, exit_armed: exitArmed,
      long_extreme_active: longExtremeActive, short_extreme_active: shortExtremeActive,
      long_extreme_consumed: longExtremeConsumed, short_extreme_consumed: shortExtremeConsumed,
      long_extreme_phase_id: longExtremePhaseId, short_extreme_phase_id: shortExtremePhaseId,
      entry_index: entryIndex, htf_rsi: Number(finite(htfRsi[htfRsi.length - 1], 50).toFixed(4)),
      exit_timing_rsi: Number(finite(exitTimingRsi[exitTimingRsi.length - 1], 50).toFixed(4)),
      ltf_rsi: Number(finite(rsiValues[rsiValues.length - 1], 50).toFixed(4)),
    },
    macd_distribution: series.distribution,
  };
}

function keepExtremeTop(top, result, limit = 40) {
  let insertAt = top.findIndex((row) => result.metrics.score > row.metrics.score);
  if (insertAt < 0) insertAt = top.length;
  top.splice(insertAt, 0, result);
  if (top.length > limit) top.length = limit;
}

function buildExtremeMacdGrid(body = {}) {
  const fastValues = Array.isArray(body.fast_values) && body.fast_values.length
    ? body.fast_values.map(Number)
    : [6, 8, 10, 11, 12, 14, 16, 18];

  const slowValues = Array.isArray(body.slow_values) && body.slow_values.length
    ? body.slow_values.map(Number)
    : [18, 20, 22, 24, 26, 30, 35];

  // MACD Signal und RSI-Signal bleiben fest auf 9. Optimiert werden
  // Fast, Slow, RSI-Laenge sowie LONG-/SHORT-Sigma.
  const macd_signal = 9;
  const rsi_signal = 9;
  const rsiValues = Array.isArray(body.rsi_length_values) && body.rsi_length_values.length
    ? body.rsi_length_values.map(Number)
    : [6, 8, 10, 12, 14, 16, 18, 21, 24, 28];

  const grid = [];
  for (const macd_fast of fastValues) {
    for (const macd_slow of slowValues) {
      if (!Number.isFinite(macd_fast) || !Number.isFinite(macd_slow) || macd_fast >= macd_slow) continue;
      for (const rsi_length of rsiValues) {
        if (!Number.isFinite(rsi_length) || rsi_length < 2 || rsi_length > 100) continue;
        const mode = String(body.trend_filter_mode || "none").toLowerCase();
        const trendSigmas = mode === "none"
          ? [0]
          : (Array.isArray(body.trend_sigma_values) && body.trend_sigma_values.length
              ? body.trend_sigma_values.map(Number)
              : [0, 0.25, 0.5, 0.75, 1.0]);
        for (const trend_sigma_abs of trendSigmas) {
          if (!Number.isFinite(trend_sigma_abs) || trend_sigma_abs < 0 || trend_sigma_abs > 2) continue;
          grid.push({ macd_fast, macd_slow, macd_signal, rsi_length: Math.floor(rsi_length), rsi_signal, trend_sigma_abs });
        }
      }
    }
  }
  return grid;
}

function median(values) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? quantileSorted(sorted, 0.5) : NaN;
}

function relativeDistance(a, b) {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale;
}

function sameExtremeIsland(a, b) {
  const fastNear = Math.abs(a.params.macd_fast - b.params.macd_fast) <= 2;
  const slowNear = Math.abs(a.params.macd_slow - b.params.macd_slow) <= 4;
  const longNear = Math.abs(a.params.long_zone_sigma - b.params.long_zone_sigma) <= 0.5;
  const shortNear = Math.abs(a.params.short_zone_sigma - b.params.short_zone_sigma) <= 0.5;
  const rsiNear = Math.abs((a.params.rsi_length || 14) - (b.params.rsi_length || 14)) <= 2;
  return fastNear && slowNear && longNear && shortNear && rsiNear;
}

function summarizeExtremeIsland(rows, rank) {
  const longZones = rows.map((row) => row.params.long_zone_sigma).sort((a, b) => a - b);
  const shortZones = rows.map((row) => row.params.short_zone_sigma).sort((a, b) => a - b);
  const fastValues = rows.map((row) => row.params.macd_fast);
  const slowValues = rows.map((row) => row.params.macd_slow);
  const rsiLengths = rows.map((row) => row.params.rsi_length || 14);
  const pfs = rows.map((row) => row.metrics.profit_factor);
  const nets = rows.map((row) => row.metrics.net);
  const drawdowns = rows.map((row) => row.metrics.max_drawdown);
  const trades = rows.map((row) => row.metrics.trades);
  const best = [...rows].sort((a, b) => b.metrics.score - a.metrics.score)[0];

  return {
    rank,
    member_count: rows.length,
    best,
    macd_fast_min: Math.min(...fastValues),
    macd_fast_max: Math.max(...fastValues),
    macd_slow_min: Math.min(...slowValues),
    macd_slow_max: Math.max(...slowValues),
    macd_fast_median: Math.round(median(fastValues)),
    macd_slow_median: Math.round(median(slowValues)),
    macd_signal: best.params.macd_signal,
    rsi_length_min: Math.min(...rsiLengths),
    rsi_length_max: Math.max(...rsiLengths),
    rsi_length_median: Math.round(median(rsiLengths)),
    rsi_signal: best.params.rsi_signal || 9,
    long_sigma_min: Number(longZones[0].toFixed(8)),
    long_sigma_max: Number(longZones.at(-1).toFixed(8)),
    short_sigma_min: Number(shortZones[0].toFixed(8)),
    short_sigma_max: Number(shortZones.at(-1).toFixed(8)),
    pf_min: Number(Math.min(...pfs).toFixed(4)),
    pf_max: Number(Math.max(...pfs).toFixed(4)),
    pf_median: Number(median(pfs).toFixed(4)),
    net_min: Number(Math.min(...nets).toFixed(6)),
    net_max: Number(Math.max(...nets).toFixed(6)),
    dd_min: Number(Math.min(...drawdowns).toFixed(6)),
    dd_max: Number(Math.max(...drawdowns).toFixed(6)),
    trades_min: Math.min(...trades),
    trades_max: Math.max(...trades),
  };
}

function extremeStableIslands(top) {
  const rows = top.slice(0, Math.min(30, top.length));
  const clusters = [];

  for (const row of rows) {
    let cluster = clusters.find((group) =>
      group.some((member) => sameExtremeIsland(member, row)),
    );
    if (!cluster) {
      cluster = [];
      clusters.push(cluster);
    }
    cluster.push(row);
  }

  return clusters
    .map((group) => summarizeExtremeIsland(group, 0))
    .sort((a, b) =>
      (b.member_count >= 2 ? 1 : 0) - (a.member_count >= 2 ? 1 : 0) ||
      b.member_count - a.member_count ||
      b.best.metrics.score - a.best.metrics.score
    )
    .slice(0, 6)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}


function scannerScore(context) {
  if (!Array.isArray(context) || context.length < 6) return 0;
  const last = context.at(-1);
  const p1 = context.at(-2);
  const p2 = context.at(-3);
  const p3 = context.at(-4);
  const recent = context.slice(-12);
  const histScale = meanAbs(recent.map((x) => x.histogram));
  const absH = Math.abs(last.histogram);
  const abs1 = Math.abs(p1.histogram);
  const abs2 = Math.abs(p2.histogram);
  const abs3 = Math.abs(p3.histogram);
  const extreme = Math.min(1, Math.max(abs1, abs2, abs3, absH) / Math.max(histScale * 2.1, 1e-9));
  const contraction = Math.max(0, (Math.max(abs1, abs2, abs3) - absH) / Math.max(histScale, 1e-9));
  const histTurn = Math.sign(last.histogram_delta) !== Math.sign(p2.histogram_delta) || absH < abs1;
  const macdTurn = Math.sign(last.macd_delta) !== Math.sign(p2.macd_delta) || Math.abs(last.macd_delta) > Math.abs(p1.macd_delta);
  const rsiTurn = Math.sign(last.rsi_delta_1) !== Math.sign(p2.rsi_delta_1) || Math.abs(last.rsi_delta_1) > 1.2;
  const rsiExtreme = last.rsi < 38 || last.rsi > 62 || p2.rsi < 34 || p2.rsi > 66;
  const rsiCross = (last.rsi - last.rsi_ma) * (p1.rsi - p1.rsi_ma) <= 0;
  let score = 0;
  score += extreme * 28;
  score += Math.min(1, contraction) * 28;
  if (histTurn) score += 14;
  if (macdTurn) score += 12;
  if (rsiTurn) score += 8;
  if (rsiExtreme) score += 6;
  if (rsiCross) score += 8;
  return Math.max(0, Math.min(100, score));
}

function suppressNearby(candidates, minGap = 4) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const candidate of sorted) {
    if (kept.every((x) => Math.abs(x.index - candidate.index) >= minGap)) kept.push(candidate);
  }
  return kept.sort((a, b) => a.index - b.index);
}

function buildScannerCandidates(candles, arrays) {
  const raw = [];
  for (let i = 30; i < candles.length; i += 1) {
    const context = buildFeatures(candles, i, arrays);
    const score = scannerScore(context);
    if (score >= 52) raw.push({
      index: i,
      time: Number(candles[i].time),
      price: finite(candles[i].close),
      score: Number(score.toFixed(1)),
      source: "scanner",
      direction: context.at(-1).histogram <= 0 ? "long" : "short",
    });
  }
  return suppressNearby(raw, 4);
}

function statsForVectors(vectors) {
  const clean = (vectors || []).filter(
    (vector) => Array.isArray(vector) && vector.length > 0 && vector.every(Number.isFinite),
  );
  const dims = clean[0]?.length || 0;
  const mean = new Array(dims).fill(0);
  const variance = new Array(dims).fill(0);

  for (const vector of clean) {
    for (let i = 0; i < dims; i += 1) mean[i] += finite(vector[i]);
  }
  for (let i = 0; i < dims; i += 1) mean[i] /= Math.max(1, clean.length);

  for (const vector of clean) {
    for (let i = 0; i < dims; i += 1) {
      const delta = finite(vector[i]) - mean[i];
      variance[i] += delta * delta;
    }
  }

  const std = variance.map((value) =>
    Math.max(Math.sqrt(value / Math.max(1, clean.length - 1)), 0.08),
  );

  return {
    mean: mean.map((value) => finite(value)),
    std: std.map((value) => finite(value, 1)),
  };
}

function standardizedCentroid(vectors, norm) {
  const dims = Array.isArray(norm?.mean) ? norm.mean.length : 0;
  const clean = (vectors || []).filter(
    (vector) => Array.isArray(vector) && vector.length === dims && vector.every(Number.isFinite),
  );
  const centroid = new Array(dims).fill(0);

  for (const vector of clean) {
    for (let i = 0; i < dims; i += 1) {
      const std = Math.max(Math.abs(finite(norm.std?.[i], 1)), 0.08);
      centroid[i] += (finite(vector[i]) - finite(norm.mean?.[i])) / std;
    }
  }

  for (let i = 0; i < dims; i += 1) {
    centroid[i] = finite(centroid[i] / Math.max(1, clean.length));
  }
  return centroid;
}

function distance(vector, centroid, norm) {
  if (
    !Array.isArray(vector) ||
    !Array.isArray(centroid) ||
    !Array.isArray(norm?.mean) ||
    !Array.isArray(norm?.std)
  ) return Number.POSITIVE_INFINITY;

  const dims = Math.min(vector.length, centroid.length, norm.mean.length, norm.std.length);
  if (!dims) return Number.POSITIVE_INFINITY;

  let sum = 0;
  for (let i = 0; i < dims; i += 1) {
    const std = Math.max(Math.abs(finite(norm.std[i], 1)), 0.08);
    const z = (finite(vector[i]) - finite(norm.mean[i])) / std;
    const delta = z - finite(centroid[i]);
    sum += delta * delta;
  }

  const result = Math.sqrt(sum / dims);
  return Number.isFinite(result) ? result : Number.POSITIVE_INFINITY;
}

function classProbability(vector, centroid, negativeCentroid, norm) {
  const dPos = distance(vector, centroid, norm);
  const dNeg = distance(vector, negativeCentroid, norm);
  if (!Number.isFinite(dPos) || !Number.isFinite(dNeg)) return 0;

  const margin = Math.max(-20, Math.min(20, dNeg - dPos));
  const probability = (1 / (1 + Math.exp(-margin * 2.2))) * 100;
  return Math.max(0, Math.min(100, finite(probability)));
}

async function ensureQMomentumTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS qmomentum_annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL, interval TEXT NOT NULL, time INTEGER NOT NULL, price REAL NOT NULL,
      label TEXT NOT NULL CHECK(label IN ('perfect','bad','missed','unsure')),
      direction TEXT NOT NULL DEFAULT 'none', note TEXT, context_json TEXT NOT NULL,
      feature_version TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), UNIQUE(symbol, interval, time)
    );
    CREATE INDEX IF NOT EXISTS idx_qmomentum_symbol_tf_time ON qmomentum_annotations(symbol, interval, time);
    CREATE TABLE IF NOT EXISTS qmomentum_models (
      model_key TEXT PRIMARY KEY, model_json TEXT NOT NULL, positive_count INTEGER NOT NULL,
      negative_count INTEGER NOT NULL, trained_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS qmomentum_trend_annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL, interval TEXT NOT NULL, time INTEGER NOT NULL, price REAL NOT NULL,
      trend_start TEXT NOT NULL CHECK(trend_start IN ('up','down')), note TEXT,
      context_json TEXT NOT NULL, feature_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(symbol, interval, time)
    );
    CREATE INDEX IF NOT EXISTS idx_qmomentum_trend_symbol_tf_time
      ON qmomentum_trend_annotations(symbol, interval, time);
    CREATE TABLE IF NOT EXISTS extreme_live_profiles (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      params_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY(symbol, interval)
    );
    CREATE TABLE IF NOT EXISTS extreme_profile_snapshots (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      name TEXT NOT NULL,
      params_json TEXT NOT NULL,
      result_json TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_extreme_profiles_market
      ON extreme_profile_snapshots(symbol, interval, updated_at DESC);
  `);
  const cols = await db.all(`PRAGMA table_info(qmomentum_annotations)`);
  if (!cols.some((c) => c.name === "direction")) {
    await db.exec(`ALTER TABLE qmomentum_annotations ADD COLUMN direction TEXT NOT NULL DEFAULT 'none'`);
  }
  // Bestehende positive Beispiele einmalig nach Histogramm-Vorzeichen zuordnen.
  const legacy = await db.all(`SELECT id,label,direction,context_json FROM qmomentum_annotations WHERE direction='none' AND label IN ('perfect','missed')`);
  for (const row of legacy) {
    try {
      const context = JSON.parse(row.context_json);
      const last = context.at(-1);
      const direction = finite(last?.histogram) <= 0 ? "long" : "short";
      await db.run(`UPDATE qmomentum_annotations SET direction=? WHERE id=?`, [direction, row.id]);
    } catch {}
  }
}

function isUsableModel(model) {
  const arrays = [
    model?.norm?.mean,
    model?.norm?.std,
    model?.long_centroid,
    model?.short_centroid,
    model?.negative_centroid,
  ];
  if (!arrays.every((value) => Array.isArray(value) && value.length === 12)) return false;
  return arrays.every((value) => value.every(Number.isFinite));
}

async function readModel(db) {
  const row = await db.get(`SELECT * FROM qmomentum_models WHERE model_key=?`, [MODEL_KEY]);
  if (!row) return null;
  try {
    const model = {
      ...JSON.parse(row.model_json),
      trained_at: row.trained_at,
      positive_count: Number(row.positive_count),
      negative_count: Number(row.negative_count),
    };
    return { ...model, numeric_valid: isUsableModel(model) };
  } catch {
    return null;
  }
}

function isUsableTrendModel(model) {
  const arrays = [
    model?.norm?.mean,
    model?.norm?.std,
    model?.up_centroid,
    model?.down_centroid,
  ];
  if (!arrays.every((value) => Array.isArray(value) && value.length === 16)) return false;
  return arrays.every((value) => value.every(Number.isFinite));
}

async function readTrendModel(db) {
  const row = await db.get(`SELECT * FROM qmomentum_models WHERE model_key=?`, [TREND_MODEL_KEY]);
  if (!row) return null;
  try {
    const model = {
      ...JSON.parse(row.model_json),
      trained_at: row.trained_at,
      positive_count: Number(row.positive_count),
      negative_count: Number(row.negative_count),
    };
    return { ...model, numeric_valid: isUsableTrendModel(model) };
  } catch {
    return null;
  }
}

function buildTrendPredictions(candles, arrays, model) {
  if (!model || !model.numeric_valid) return [];
  const predictions = [];

  for (let i = 30; i < candles.length; i += 1) {
    const vector = buildTrendStateVector(candles, i, arrays);
    if (!vector) continue;

    const probabilities = trendStateProbabilities(vector, model);
    const trendState = probabilities.up >= probabilities.down ? "up" : "down";
    const score = Math.max(probabilities.up, probabilities.down);

    predictions.push({
      index: i,
      time: Number(candles[i].time),
      price: finite(candles[i].close),
      score: Number(score.toFixed(2)),
      up_score: probabilities.up,
      down_score: probabilities.down,
      source: "trend_state_ai",
      trend_start: trendState,
      trend_state: trendState,
    });
  }

  return predictions;
}

function trendPredictionsToMarkers(predictions, threshold = 70) {
  return predictions.filter((row) => row.score >= threshold);
}

function buildChartPredictions(candles, arrays, model) {
  if (!model) return [];
  const predictions = [];
  for (let i = 30; i < candles.length; i += 1) {
    const context = buildFeatures(candles, i, arrays);
    const vector = vectorFromContext(context);
    if (!vector) continue;
    const longScore = classProbability(vector, model.long_centroid, model.negative_centroid, model.norm);
    const shortScore = classProbability(vector, model.short_centroid, model.negative_centroid, model.norm);
    const direction = longScore >= shortScore ? "long" : "short";
    const score = Math.max(longScore, shortScore);
    predictions.push({
      index: i,
      time: Number(candles[i].time),
      price: finite(candles[i].close),
      score: Number(score.toFixed(2)),
      long_score: Number(longScore.toFixed(2)),
      short_score: Number(shortScore.toFixed(2)),
      none_score: Number(Math.max(0, 100 - score).toFixed(2)),
      source: "ai",
      direction,
    });
  }
  return predictions;
}

function predictionsToMarkers(predictions, threshold = 70) {
  return suppressNearby(
    predictions.filter((row) => row.score >= threshold),
    3,
  );
}



function stableResearchValue(value) {
  if (Array.isArray(value)) return value.map(stableResearchValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (
        key === "activation_time_ms" ||
        key === "created_at" ||
        key === "updated_at"
      ) continue;
      out[key] = stableResearchValue(value[key]);
    }
    return out;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toFixed(12)) : 0;
  }
  return value;
}

function researchFingerprint(value) {
  const text = JSON.stringify(stableResearchValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `qr_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function optimizerWarmupBars(params) {
  return Math.max(
    80,
    Math.floor(finite(params?.z_window, 200)),
    Math.floor(finite(params?.macd_slow, 20) * 4),
    Math.floor(finite(params?.rsi_length, 14) * 3),
    Math.floor(finite(params?.ad_length, 11) * 3),
    Math.floor(finite(params?.chaikin_slow, 10) * 4)
  );
}

function buildOptimizerSnapshot({
  runId,
  parentRunId = null,
  phase,
  symbol,
  interval,
  candles,
  requestedLimit,
  params,
  metrics = null,
}) {
  const candleCount = Array.isArray(candles) ? candles.length : 0;
  const startTime = candleCount ? Number(candles[0]?.time || 0) : 0;
  const endTime = candleCount
    ? Number(candles[candleCount - 1]?.time || 0)
    : 0;

  const normalizedParams = stableResearchValue(params || {});
  const paramsFingerprint = researchFingerprint(normalizedParams);

  const environment = {
    snapshot_version: "QRESEARCH_REPRO_V1",
    engine_version: QMOMENTUM_VERSION,
    run_id: runId || null,
    parent_run_id: parentRunId || null,
    phase: Number(phase || 0),
    symbol,
    interval,
    requested_limit: Number(requestedLimit || candleCount),
    candle_count: candleCount,
    start_time: startTime,
    end_time: endTime,
    warmup_bars: optimizerWarmupBars(params),
    closed_htf: true,
    params_fingerprint: paramsFingerprint,
  };

  return {
    ...environment,
    environment_fingerprint: researchFingerprint(environment),
    params: normalizedParams,
    expected_metrics: metrics
      ? stableResearchValue({
          trades: Number(metrics.trades || 0),
          profit_factor: Number(metrics.profit_factor || 0),
          net: Number(metrics.net || 0),
          max_drawdown: Number(metrics.max_drawdown || 0),
          win_rate_pct: Number(metrics.win_rate_pct || 0),
        })
      : null,
  };
}

function multiTfOptimizerScore(metrics, minTrades = 20) {
  const pf = Math.max(0, finite(metrics?.profit_factor, 0));
  const net = finite(metrics?.net, 0);
  const dd = Math.max(0, finite(metrics?.max_drawdown, 0));
  const trades = Math.max(0, finite(metrics?.trades, 0));
  const winRate = Math.max(0, finite(metrics?.win_rate_pct, 0));
  const efficiency = dd > 0 ? net / dd : net > 0 ? net : 0;

  // Kein reiner PF-Wettbewerb:
  // - PF und Effizienz tragen am stärksten
  // - Netto und Winrate moderat
  // - zu wenige Trades werden deutlich bestraft
  const tradeFactor = Math.min(1, trades / Math.max(1, minTrades * 2));
  const score =
    (Math.min(pf, 6) * 28) +
    (Math.max(-5, Math.min(efficiency, 12)) * 12) +
    (Math.sign(net) * Math.log10(Math.abs(net) + 1) * 10) +
    (Math.min(winRate, 100) * 0.12);

  return Number((score * tradeFactor).toFixed(4));
}

function normalizedTfOptions(raw, baseMinutes) {
  const defaults = [baseMinutes, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
  const source = Array.isArray(raw) && raw.length ? raw : defaults;
  return [...new Set(
    source
      .map((value) => normalizeIndicatorTfMinutes(value, baseMinutes))
      .filter((value) => value >= baseMinutes && value <= 1440)
  )].sort((a, b) => a - b);
}

function buildMultiTfGrid(body, interval) {
  const baseMinutes = intervalToMinutes(interval);
  const macd = normalizedTfOptions(body?.macd_tf_options, baseMinutes);
  const rsiValues = normalizedTfOptions(body?.rsi_tf_options, baseMinutes);
  const chaikin = normalizedTfOptions(body?.chaikin_tf_options, baseMinutes);
  const ad = normalizedTfOptions(body?.ad_tf_options, baseMinutes);

  const grid = [];
  for (const macdTf of macd) {
    for (const rsiTf of rsiValues) {
      for (const chaikinTf of chaikin) {
        for (const adTf of ad) {
          grid.push({
            macd_tf: `${macdTf}m`,
            rsi_tf: `${rsiTf}m`,
            chaikin_tf: `${chaikinTf}m`,
            ad_tf: `${adTf}m`,
          });
        }
      }
    }
  }

  return {
    grid,
    options: { macd, rsi: rsiValues, chaikin, ad },
  };
}

function keepMultiTfTop(top, row, limit = 100) {
  top.push(row);
  top.sort((a, b) =>
    finite(b.score, 0) - finite(a.score, 0) ||
    finite(b.metrics?.profit_factor, 0) - finite(a.metrics?.profit_factor, 0) ||
    finite(b.metrics?.net, 0) - finite(a.metrics?.net, 0)
  );
  if (top.length > limit) top.length = limit;
}


function multiTfFrequencyAnalysis(topRows) {
  const fields = [
    ["macd_tf", "macd"],
    ["rsi_tf", "rsi"],
    ["chaikin_tf", "chaikin"],
    ["ad_tf", "ad"],
  ];
  const result = {};

  for (const [field, key] of fields) {
    const map = new Map();
    for (let index = 0; index < topRows.length; index += 1) {
      const row = topRows[index];
      const tf = String(row?.params?.[field] || "");
      if (!tf) continue;
      const previous = map.get(tf) || {
        tf,
        count: 0,
        score_sum: 0,
        pf_sum: 0,
        best_rank: Number.MAX_SAFE_INTEGER,
      };
      previous.count += 1;
      previous.score_sum += finite(row?.score, 0);
      previous.pf_sum += finite(row?.metrics?.profit_factor, 0);
      previous.best_rank = Math.min(previous.best_rank, index + 1);
      map.set(tf, previous);
    }

    result[key] = [...map.values()]
      .map((row) => ({
        tf: row.tf,
        count: row.count,
        share_pct: topRows.length
          ? Number(((row.count / topRows.length) * 100).toFixed(1))
          : 0,
        avg_score: row.count
          ? Number((row.score_sum / row.count).toFixed(2))
          : 0,
        avg_pf: row.count
          ? Number((row.pf_sum / row.count).toFixed(3))
          : 0,
        best_rank: row.best_rank,
      }))
      .sort((a, b) =>
        b.count - a.count ||
        b.avg_score - a.avg_score ||
        a.best_rank - b.best_rank
      );
  }

  return result;
}

function uniqueNumeric(values, minimum, maximum) {
  return [...new Set(
    values
      .map((value) => Math.round(finite(value, minimum)))
      .filter((value) => value >= minimum && value <= maximum)
  )].sort((a, b) => a - b);
}

function aroundInteger(value, deltas, minimum, maximum) {
  const base = Math.round(finite(value, minimum));
  return uniqueNumeric(
    deltas.map((delta) => base + delta),
    minimum,
    maximum
  );
}

function buildMultiTfParameterGrid(body, fixedParams, tfRows) {
  const macdFast = aroundInteger(
    fixedParams.macd_fast,
    body?.wide_search ? [-4, -2, 0, 2, 4] : [-2, 0, 2],
    1,
    30
  );
  const macdSlow = aroundInteger(
    fixedParams.macd_slow,
    body?.wide_search ? [-8, -4, 0, 4, 8] : [-4, 0, 4],
    2,
    80
  );
  const macdSignal = aroundInteger(
    fixedParams.macd_signal,
    body?.wide_search ? [-4, -2, 0, 2, 4] : [-2, 0, 2],
    1,
    40
  );
  const rsiLength = aroundInteger(
    fixedParams.rsi_length,
    body?.wide_search ? [-8, -4, 0, 4, 8] : [-4, 0, 4],
    2,
    60
  );
  const rsiSignal = aroundInteger(
    fixedParams.rsi_signal,
    body?.wide_search ? [-4, -2, 0, 2, 4] : [-2, 0, 2],
    1,
    40
  );
  const adLength = aroundInteger(
    fixedParams.ad_length,
    body?.wide_search ? [-8, -4, 0, 4, 8] : [-4, 0, 4],
    2,
    60
  );
  const chaikinFast = aroundInteger(
    fixedParams.chaikin_fast,
    body?.wide_search ? [-2, -1, 0, 1, 2] : [-1, 0, 1],
    1,
    30
  );
  const chaikinSlow = aroundInteger(
    fixedParams.chaikin_slow,
    body?.wide_search ? [-6, -3, 0, 3, 6] : [-3, 0, 3],
    2,
    80
  );

  const grid = [];
  for (const tfRow of tfRows) {
    for (const fast of macdFast) {
      for (const slow of macdSlow) {
        if (slow <= fast) continue;
        for (const signal of macdSignal) {
          for (const rsiLen of rsiLength) {
            for (const rsiSig of rsiSignal) {
              for (const adLen of adLength) {
                for (const cFast of chaikinFast) {
                  for (const cSlow of chaikinSlow) {
                    if (cSlow <= cFast) continue;
                    grid.push({
                      ...tfRow,
                      macd_fast: fast,
                      macd_slow: slow,
                      macd_signal: signal,
                      rsi_length: rsiLen,
                      rsi_signal: rsiSig,
                      ad_length: adLen,
                      chaikin_fast: cFast,
                      chaikin_slow: cSlow,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    grid,
    ranges: {
      macd_fast: macdFast,
      macd_slow: macdSlow,
      macd_signal: macdSignal,
      rsi_length: rsiLength,
      rsi_signal: rsiSignal,
      ad_length: adLength,
      chaikin_fast: chaikinFast,
      chaikin_slow: chaikinSlow,
    },
  };
}

function publicParameterJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    parent_run_id: job.parent_run_id,
    symbol: job.symbol,
    interval: job.interval,
    status: job.status,
    total: job.grid.length,
    processed: job.next,
    progress_pct: Number(
      ((job.next / Math.max(1, job.grid.length)) * 100).toFixed(1)
    ),
    min_trades: job.min_trades,
    tf_count: job.tf_rows.length,
    ranges: job.ranges,
    created_at: job.created_at,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
    error: job.error || null,
    top: job.top.slice(0, 100),
    frequency: multiTfFrequencyAnalysis(job.top.slice(0, 100)),
    snapshot: buildOptimizerSnapshot({
      runId: job.id,
      parentRunId: job.parent_run_id,
      phase: 2,
      symbol: job.symbol,
      interval: job.interval,
      candles: job.candles,
      requestedLimit: job.requested_limit,
      params: job.fixed_params,
    }),
  };
}

function publicMultiTfJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    symbol: job.symbol,
    interval: job.interval,
    status: job.status,
    total: job.grid.length,
    processed: job.next,
    progress_pct: Number(
      ((job.next / Math.max(1, job.grid.length)) * 100).toFixed(1)
    ),
    min_trades: job.min_trades,
    created_at: job.created_at,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
    error: job.error || null,
    options: job.options,
    fixed_params: job.fixed_params,
    top: job.top.slice(0, 100),
    snapshot: buildOptimizerSnapshot({
      runId: job.id,
      phase: 1,
      symbol: job.symbol,
      interval: job.interval,
      candles: job.candles,
      requestedLimit: job.requested_limit,
      params: job.fixed_params,
    }),
  };
}


function buildExitLabMetrics(trades) {
  let grossProfit = 0;
  let grossLoss = 0;
  let net = 0;
  let wins = 0;
  let losses = 0;
  let equity = 0;
  let equityPeak = 0;
  let maxDrawdown = 0;
  let efficiencySum = 0;
  let efficiencyCount = 0;
  let leftOnTable = 0;
  let holdBarsSum = 0;

  for (const trade of trades) {
    const pnl = finite(trade.pnl, 0);
    net += pnl;
    equity += pnl;
    equityPeak = Math.max(equityPeak, equity);
    maxDrawdown = Math.max(maxDrawdown, equityPeak - equity);
    holdBarsSum += Math.max(0, finite(trade.hold_bars, 0));

    if (pnl > 0) {
      grossProfit += pnl;
      wins += 1;
    } else {
      grossLoss += Math.abs(pnl);
      losses += 1;
    }

    const mfe = Math.max(0, finite(trade.mfe, 0));
    if (mfe > 0) {
      efficiencySum += Math.max(-1, Math.min(1.5, pnl / mfe));
      efficiencyCount += 1;
      leftOnTable += Math.max(0, mfe - Math.max(0, pnl));
    }
  }

  const count = trades.length;
  return {
    trades: count,
    wins,
    losses,
    win_rate_pct: count ? Number((wins / count * 100).toFixed(2)) : 0,
    gross_profit: Number(grossProfit.toFixed(6)),
    gross_loss: Number(grossLoss.toFixed(6)),
    net: Number(net.toFixed(6)),
    profit_factor:
      grossLoss > 0
        ? Number((grossProfit / grossLoss).toFixed(6))
        : grossProfit > 0
        ? 999
        : 0,
    max_drawdown: Number(maxDrawdown.toFixed(6)),
    exit_efficiency_pct:
      efficiencyCount
        ? Number((efficiencySum / efficiencyCount * 100).toFixed(2))
        : 0,
    left_on_table: Number(leftOnTable.toFixed(6)),
    avg_hold_bars:
      count ? Number((holdBarsSum / count).toFixed(2)) : 0,
  };
}

function evaluateFrozenExitFamily({
  candles,
  series,
  entryEvents,
  currentExitEvents,
  family,
  minHoldBars,
  options = {},
}) {
  const {
    histogram = [],
    rsi: rsiValues = [],
    rsiSignal = [],
    chaikin = [],
    adRatio = [],
  } = series || {};

  const currentExitByEntry = [];
  let exitCursor = 0;

  for (let entryIndex = 0; entryIndex < entryEvents.length; entryIndex += 1) {
    const entry = entryEvents[entryIndex];
    while (
      exitCursor < currentExitEvents.length &&
      Number(currentExitEvents[exitCursor].index) <= Number(entry.index)
    ) {
      exitCursor += 1;
    }
    const nextEntryIndex =
      entryIndex + 1 < entryEvents.length
        ? Number(entryEvents[entryIndex + 1].index)
        : candles.length - 1;

    let currentExit = null;
    for (let cursor = exitCursor; cursor < currentExitEvents.length; cursor += 1) {
      const candidate = currentExitEvents[cursor];
      if (Number(candidate.index) >= nextEntryIndex) break;
      if (String(candidate.direction) === String(entry.direction)) {
        currentExit = candidate;
        break;
      }
    }
    currentExitByEntry.push(currentExit);
  }

  const trades = [];

  for (let entryNo = 0; entryNo < entryEvents.length; entryNo += 1) {
    const entry = entryEvents[entryNo];
    const direction = String(entry.direction) === "short" ? "short" : "long";
    const entryIndex = Number(entry.index);
    const entryPrice = finite(entry.price, finite(candles[entryIndex]?.close));
    const nextEntryIndex =
      entryNo + 1 < entryEvents.length
        ? Number(entryEvents[entryNo + 1].index)
        : candles.length - 1;

    const windowEnd = Math.max(
      entryIndex + 1,
      Math.min(candles.length - 1, nextEntryIndex - 1)
    );
    const start = Math.min(windowEnd, entryIndex + Math.max(1, minHoldBars));

    let exitIndex = windowEnd;
    let reason = "WINDOW_END";

    if (family === "current" && currentExitByEntry[entryNo]) {
      exitIndex = Math.max(
        start,
        Math.min(windowEnd, Number(currentExitByEntry[entryNo].index))
      );
      reason = String(currentExitByEntry[entryNo].reason || "CURRENT_EXIT");
    } else if (family !== "current") {
      for (let index = start; index <= windowEnd; index += 1) {
        const prev = Math.max(entryIndex, index - 1);
        const macdThreshold = Math.max(0, finite(options.macd_threshold, 0));
        const rsiBuffer = Math.max(0, finite(options.rsi_buffer, 0));
        const chaikinThreshold = Math.max(
          0,
          finite(options.chaikin_threshold, 0)
        );
        const adNeutral = Math.max(
          0.5,
          Math.min(1.5, finite(options.ad_neutral, 1))
        );

        const macdLost =
          direction === "long"
            ? finite(histogram[index]) <= -macdThreshold &&
              finite(histogram[prev]) > -macdThreshold
            : finite(histogram[index]) >= macdThreshold &&
              finite(histogram[prev]) < macdThreshold;

        const rsiLost =
          direction === "long"
            ? finite(rsiValues[index], 50) <
                finite(rsiSignal[index], 50) - rsiBuffer &&
              finite(rsiValues[prev], 50) >=
                finite(rsiSignal[prev], 50) - rsiBuffer
            : finite(rsiValues[index], 50) >
                finite(rsiSignal[index], 50) + rsiBuffer &&
              finite(rsiValues[prev], 50) <=
                finite(rsiSignal[prev], 50) + rsiBuffer;

        const chaikinLost =
          direction === "long"
            ? finite(chaikin[index]) <= -chaikinThreshold &&
              finite(chaikin[prev]) > -chaikinThreshold
            : finite(chaikin[index]) >= chaikinThreshold &&
              finite(chaikin[prev]) < chaikinThreshold;

        const adLost =
          direction === "long"
            ? finite(adRatio[index], 1) <= adNeutral &&
              finite(adRatio[prev], 1) > adNeutral
            : finite(adRatio[index], 1) >= adNeutral &&
              finite(adRatio[prev], 1) < adNeutral;

        let triggered = false;
        if (family === "macd") triggered = macdLost;
        else if (family === "rsi") triggered = rsiLost;
        else if (family === "chaikin") triggered = chaikinLost;
        else if (family === "ad") triggered = adLost;
        else if (family === "combo") {
          const votes = [macdLost, rsiLost, chaikinLost, adLost]
            .filter(Boolean).length;
          triggered = votes >= 2;
        }

        if (triggered) {
          exitIndex = index;
          reason = `${family.toUpperCase()}_LOSS`;
          break;
        }
      }
    }

    const exitPrice = finite(candles[exitIndex]?.close, entryPrice);
    let mfe = 0;
    for (let index = entryIndex; index <= windowEnd; index += 1) {
      const favorable =
        direction === "long"
          ? finite(candles[index]?.high, entryPrice) - entryPrice
          : entryPrice - finite(candles[index]?.low, entryPrice);
      mfe = Math.max(mfe, favorable);
    }

    const pnl =
      direction === "long"
        ? exitPrice - entryPrice
        : entryPrice - exitPrice;

    trades.push({
      trade_no: entryNo + 1,
      direction,
      entry_index: entryIndex,
      entry_time: Number(entry.time),
      entry_price: Number(entryPrice.toFixed(8)),
      exit_index: exitIndex,
      exit_time: Number(candles[exitIndex]?.time || 0),
      exit_price: Number(exitPrice.toFixed(8)),
      pnl: Number(pnl.toFixed(8)),
      mfe: Number(mfe.toFixed(8)),
      capture_pct:
        mfe > 0 ? Number((pnl / mfe * 100).toFixed(2)) : null,
      left_on_table: Number(
        Math.max(0, mfe - Math.max(0, pnl)).toFixed(8)
      ),
      hold_bars: exitIndex - entryIndex,
      reason,
      family,
    });
  }

  return {
    family,
    trades,
    metrics: buildExitLabMetrics(trades),
  };
}


function exitOptimizerScore(metrics, minimumTrades = 20) {
  const trades = Math.max(0, finite(metrics?.trades, 0));
  const pf = Math.max(0, finite(metrics?.profit_factor, 0));
  const efficiency = finite(metrics?.exit_efficiency_pct, 0);
  const net = finite(metrics?.net, 0);
  const dd = Math.max(0, finite(metrics?.max_drawdown, 0));
  const left = Math.max(0, finite(metrics?.left_on_table, 0));

  const tradeFactor = Math.min(
    1,
    trades / Math.max(1, minimumTrades * 1.5)
  );
  const ddEfficiency = dd > 0 ? net / dd : net > 0 ? net : 0;
  const leftPenalty =
    Math.log10(left + 1) * 4;

  const raw =
    Math.min(pf, 8) * 30 +
    Math.max(-100, Math.min(150, efficiency)) * 0.45 +
    Math.max(-10, Math.min(20, ddEfficiency)) * 9 +
    Math.sign(net) * Math.log10(Math.abs(net) + 1) * 10 -
    leftPenalty;

  return Number((raw * tradeFactor).toFixed(4));
}

function exitTfOptions(interval, supplied) {
  const base = intervalToMinutes(interval);
  const defaults = [base, 10, 15, 20, 30, 45, 60, 90, 120];
  return [...new Set(
    (Array.isArray(supplied) && supplied.length ? supplied : defaults)
      .map((value) => normalizeIndicatorTfMinutes(value, base))
      .filter((value) => value >= base && value <= 240)
  )].sort((a, b) => a - b);
}

function aroundExitInteger(value, deltas, minimum, maximum) {
  const base = Math.round(finite(value, minimum));
  return [...new Set(
    deltas
      .map((delta) => base + delta)
      .filter((candidate) =>
        candidate >= minimum && candidate <= maximum
      )
  )].sort((a, b) => a - b);
}

function buildExitFamilyGrid(family, params, interval, body) {
  const tfs = exitTfOptions(interval, body?.tf_options);
  const holds = [...new Set(
    (Array.isArray(body?.hold_options)
      ? body.hold_options
      : [2, 4, 6, 8, 12]
    )
      .map((value) => Math.max(1, Math.floor(finite(value, 1))))
  )].sort((a, b) => a - b);

  const grid = [];

  if (family === "macd") {
    const fastValues = aroundExitInteger(
      params.macd_fast,
      [-4, -2, 0, 2, 4],
      1,
      30
    );
    const slowValues = aroundExitInteger(
      params.macd_slow,
      [-8, -4, 0, 4, 8],
      2,
      80
    );
    const signalValues = aroundExitInteger(
      params.macd_signal,
      [-4, -2, 0, 2, 4],
      1,
      40
    );
    const thresholds = [0, 0.05, 0.1];

    for (const tf of tfs) {
      for (const fast of fastValues) {
        for (const slow of slowValues) {
          if (slow <= fast) continue;
          for (const signal of signalValues) {
            for (const hold of holds) {
              for (const threshold of thresholds) {
                grid.push({
                  macd_tf: `${tf}m`,
                  macd_fast: fast,
                  macd_slow: slow,
                  macd_signal: signal,
                  min_hold_bars: hold,
                  options: { macd_threshold: threshold },
                });
              }
            }
          }
        }
      }
    }
  } else if (family === "rsi") {
    const lengths = aroundExitInteger(
      params.rsi_length,
      [-8, -4, 0, 4, 8],
      2,
      60
    );
    const signals = aroundExitInteger(
      params.rsi_signal,
      [-4, -2, 0, 2, 4],
      1,
      40
    );
    const buffers = [0, 1, 2, 3];

    for (const tf of tfs) {
      for (const length of lengths) {
        for (const signal of signals) {
          for (const hold of holds) {
            for (const buffer of buffers) {
              grid.push({
                rsi_tf: `${tf}m`,
                rsi_length: length,
                rsi_signal: signal,
                min_hold_bars: hold,
                options: { rsi_buffer: buffer },
              });
            }
          }
        }
      }
    }
  } else if (family === "chaikin") {
    const fastValues = aroundExitInteger(
      params.chaikin_fast,
      [-2, -1, 0, 1, 2],
      1,
      25
    );
    const slowValues = aroundExitInteger(
      params.chaikin_slow,
      [-8, -4, 0, 4, 8],
      2,
      80
    );
    const thresholds = [0, 0.05, 0.1];

    for (const tf of tfs) {
      for (const fast of fastValues) {
        for (const slow of slowValues) {
          if (slow <= fast) continue;
          for (const hold of holds) {
            for (const threshold of thresholds) {
              grid.push({
                chaikin_tf: `${tf}m`,
                chaikin_fast: fast,
                chaikin_slow: slow,
                min_hold_bars: hold,
                options: { chaikin_threshold: threshold },
              });
            }
          }
        }
      }
    }
  } else if (family === "ad") {
    const lengths = aroundExitInteger(
      params.ad_length,
      [-8, -4, 0, 4, 8],
      2,
      60
    );
    const neutralValues = [0.95, 0.98, 1, 1.02, 1.05];

    for (const tf of tfs) {
      for (const length of lengths) {
        for (const hold of holds) {
          for (const neutral of neutralValues) {
            grid.push({
              ad_tf: `${tf}m`,
              ad_length: length,
              min_hold_bars: hold,
              options: { ad_neutral: neutral },
            });
          }
        }
      }
    }
  }

  return grid;
}

function keepExitTop(top, row, limit = 50) {
  top.push(row);
  top.sort((a, b) =>
    finite(b.score, 0) - finite(a.score, 0) ||
    finite(b.metrics?.profit_factor, 0) -
      finite(a.metrics?.profit_factor, 0) ||
    finite(b.metrics?.net, 0) - finite(a.metrics?.net, 0)
  );
  if (top.length > limit) top.length = limit;
}

function publicExitOptimizationJob(job) {
  return {
    id: job.id,
    family: job.family,
    symbol: job.symbol,
    interval: job.interval,
    status: job.status,
    total: job.grid.length,
    processed: job.next,
    progress_pct: Number(
      ((job.next / Math.max(1, job.grid.length)) * 100).toFixed(1)
    ),
    minimum_trades: job.minimum_trades,
    frozen_entry_count: job.entries.length,
    created_at: job.created_at,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
    error: job.error || null,
    top: job.top.slice(0, 50),
  };
}

export function createQMomentumRoutes({ db, getStoredCandles, sendJson, readJsonBody }) {

  async function runExitFamilyOptimizer(job) {
    if (
      job.running ||
      job.status === "FINISHED" ||
      job.status === "CANCELLED"
    ) return;

    job.running = true;
    job.status = "RUNNING";
    job.started_at = job.started_at || berlinNowIso();
    job.error = null;

    try {
      const batchSize = 3;

      while (
        job.next < job.grid.length &&
        job.status === "RUNNING"
      ) {
        const end = Math.min(job.grid.length, job.next + batchSize);

        for (let index = job.next; index < end; index += 1) {
          const candidate = job.grid[index];
          const candidateParams = {
            ...job.base_params,
            ...candidate,
            interval: job.interval,
            activation_time_ms: 0,
          };
          delete candidateParams.options;
          delete candidateParams.min_hold_bars;

          if (
            candidateParams.macd_slow <= candidateParams.macd_fast ||
            candidateParams.chaikin_slow <= candidateParams.chaikin_fast
          ) continue;

          const series = buildMultiTimeframeExtremeSeries(
            job.candles,
            candidateParams
          );

          const evaluated = evaluateFrozenExitFamily({
            candles: job.candles,
            series,
            entryEvents: job.entries,
            currentExitEvents: job.current_exits,
            family: job.family,
            minHoldBars: candidate.min_hold_bars,
            options: candidate.options || {},
          });

          const metrics = evaluated.metrics;
          if (finite(metrics.trades, 0) < job.minimum_trades) continue;

          keepExitTop(job.top, {
            family: job.family,
            score: exitOptimizerScore(metrics, job.minimum_trades),
            params: candidateParams,
            min_hold_bars: candidate.min_hold_bars,
            options: candidate.options || {},
            metrics,
          }, 50);
        }

        job.next = end;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      if (job.status === "RUNNING") {
        job.status = "FINISHED";
        job.finished_at = berlinNowIso();
      }
    } catch (error) {
      job.status = "PAUSED";
      job.error = String(error?.stack || error?.message || error);
    } finally {
      job.running = false;
    }
  }

  async function ensureMultiTfOptimizerTables() {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS multi_tf_optimizer_runs (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        progress REAL NOT NULL DEFAULT 0,
        min_trades INTEGER NOT NULL DEFAULT 20,
        options_json TEXT,
        fixed_params_json TEXT,
        top_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS multi_tf_optimizer_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        rank_no INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        macd_tf TEXT NOT NULL,
        rsi_tf TEXT NOT NULL,
        chaikin_tf TEXT NOT NULL,
        ad_tf TEXT NOT NULL,
        score REAL NOT NULL,
        profit_factor REAL,
        net REAL,
        max_drawdown REAL,
        efficiency REAL,
        trades INTEGER,
        win_rate_pct REAL,
        params_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_multi_tf_runs_created
        ON multi_tf_optimizer_runs(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_multi_tf_results_run_rank
        ON multi_tf_optimizer_results(run_id, rank_no);

      CREATE TABLE IF NOT EXISTS multi_tf_parameter_runs (
        id TEXT PRIMARY KEY,
        parent_run_id TEXT,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        progress REAL NOT NULL DEFAULT 0,
        min_trades INTEGER NOT NULL DEFAULT 20,
        tf_rows_json TEXT,
        ranges_json TEXT,
        fixed_params_json TEXT,
        top_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_multi_tf_parameter_runs_created
        ON multi_tf_parameter_runs(created_at DESC);
    `);

    await db.run(
      `UPDATE multi_tf_optimizer_runs
          SET status='PAUSED',
              error=COALESCE(error,'Engine-Neustart: Lauf kann neu gestartet werden'),
              updated_at=?
        WHERE status='RUNNING'`,
      [berlinNowIso()]
    );
  }

  async function persistMultiTfJob(job) {
    await db.run(
      `INSERT INTO multi_tf_optimizer_runs(
         id,symbol,interval,status,total,processed,progress,min_trades,
         options_json,fixed_params_json,top_json,error,
         created_at,started_at,finished_at,updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         status=excluded.status,
         total=excluded.total,
         processed=excluded.processed,
         progress=excluded.progress,
         top_json=excluded.top_json,
         error=excluded.error,
         started_at=excluded.started_at,
         finished_at=excluded.finished_at,
         updated_at=excluded.updated_at`,
      [
        job.id,
        job.symbol,
        job.interval,
        job.status,
        job.grid.length,
        job.next,
        Number(((job.next / Math.max(1, job.grid.length)) * 100).toFixed(1)),
        job.min_trades,
        JSON.stringify(job.options),
        JSON.stringify(job.fixed_params),
        JSON.stringify(job.top.slice(0, 100)),
        job.error || null,
        job.created_at,
        job.started_at || null,
        job.finished_at || null,
        berlinNowIso(),
      ]
    );
  }

  async function finishMultiTfJob(job) {
    job.status = "FINISHED";
    job.finished_at = berlinNowIso();
    await persistMultiTfJob(job);

    await db.run(
      `DELETE FROM multi_tf_optimizer_results WHERE run_id=?`,
      [job.id]
    );

    for (let index = 0; index < job.top.length; index += 1) {
      const row = job.top[index];
      const dd = Math.max(0, finite(row.metrics?.max_drawdown, 0));
      const net = finite(row.metrics?.net, 0);
      await db.run(
        `INSERT INTO multi_tf_optimizer_results(
           run_id,rank_no,symbol,interval,
           macd_tf,rsi_tf,chaikin_tf,ad_tf,
           score,profit_factor,net,max_drawdown,efficiency,
           trades,win_rate_pct,params_json,metrics_json,created_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          job.id,
          index + 1,
          job.symbol,
          job.interval,
          row.params.macd_tf,
          row.params.rsi_tf,
          row.params.chaikin_tf,
          row.params.ad_tf,
          row.score,
          finite(row.metrics?.profit_factor, 0),
          net,
          dd,
          dd > 0 ? net / dd : 0,
          finite(row.metrics?.trades, 0),
          finite(row.metrics?.win_rate_pct, 0),
          JSON.stringify(row.params),
          JSON.stringify(row.metrics),
          berlinNowIso(),
        ]
      );
    }
  }


  async function persistParameterJob(job) {
    await db.run(
      `INSERT INTO multi_tf_parameter_runs(
         id,parent_run_id,symbol,interval,status,total,processed,progress,
         min_trades,tf_rows_json,ranges_json,fixed_params_json,top_json,
         error,created_at,started_at,finished_at,updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         status=excluded.status,
         total=excluded.total,
         processed=excluded.processed,
         progress=excluded.progress,
         top_json=excluded.top_json,
         error=excluded.error,
         started_at=excluded.started_at,
         finished_at=excluded.finished_at,
         updated_at=excluded.updated_at`,
      [
        job.id,
        job.parent_run_id || null,
        job.symbol,
        job.interval,
        job.status,
        job.grid.length,
        job.next,
        Number(((job.next / Math.max(1, job.grid.length)) * 100).toFixed(1)),
        job.min_trades,
        JSON.stringify(job.tf_rows),
        JSON.stringify(job.ranges),
        JSON.stringify(job.fixed_params),
        JSON.stringify(job.top.slice(0, 100)),
        job.error || null,
        job.created_at,
        job.started_at || null,
        job.finished_at || null,
        berlinNowIso(),
      ]
    );
  }

  async function runParameterOptimizer(job) {
    if (job.running || job.status === "FINISHED" || job.status === "CANCELLED") {
      return;
    }

    job.running = true;
    job.status = "RUNNING";
    job.started_at = job.started_at || berlinNowIso();
    job.error = null;
    await persistParameterJob(job);

    try {
      const batchSize = 3;
      while (job.next < job.grid.length && job.status === "RUNNING") {
        const end = Math.min(job.grid.length, job.next + batchSize);
        for (let index = job.next; index < end; index += 1) {
          const candidate = job.grid[index];
          const params = {
            ...job.fixed_params,
            ...candidate,
            interval: job.interval,
            activation_time_ms: 0,
          };

          const series = buildMultiTimeframeExtremeSeries(job.candles, params);
          const metrics = simulateExtremeMacd(
            job.candles,
            series,
            params,
            false
          );

          if (finite(metrics.trades, 0) >= job.min_trades) {
            const normalizedMetrics = {
              trades: Number(metrics.trades || 0),
              profit_factor: Number(metrics.profit_factor || 0),
              net: Number(metrics.net || 0),
              max_drawdown: Number(metrics.max_drawdown || 0),
              win_rate_pct: Number(metrics.win_rate_pct || 0),
            };
            keepMultiTfTop(job.top, {
              params,
              metrics: normalizedMetrics,
              score: multiTfOptimizerScore(metrics, job.min_trades),
              snapshot: buildOptimizerSnapshot({
                runId: job.id,
                parentRunId: job.parent_run_id,
                phase: 2,
                symbol: job.symbol,
                interval: job.interval,
                candles: job.candles,
                requestedLimit: job.requested_limit,
                params,
                metrics: normalizedMetrics,
              }),
            }, 100);
          }
        }

        job.next = end;
        await persistParameterJob(job);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      if (job.status === "RUNNING") {
        job.status = "FINISHED";
        job.finished_at = berlinNowIso();
      }
      await persistParameterJob(job);
    } catch (error) {
      job.status = "PAUSED";
      job.error = String(error?.stack || error?.message || error);
      await persistParameterJob(job);
    } finally {
      job.running = false;
    }
  }

  async function runMultiTfOptimizer(job) {
    if (job.running || job.status === "FINISHED" || job.status === "CANCELLED") {
      return;
    }

    job.running = true;
    job.status = "RUNNING";
    job.started_at = job.started_at || berlinNowIso();
    job.error = null;
    await persistMultiTfJob(job);

    try {
      const batchSize = 4;

      while (
        job.next < job.grid.length &&
        job.status === "RUNNING"
      ) {
        const end = Math.min(job.grid.length, job.next + batchSize);

        for (let index = job.next; index < end; index += 1) {
          const tfSet = job.grid[index];
          const params = {
            ...job.fixed_params,
            ...tfSet,
            interval: job.interval,
            activation_time_ms: 0,
          };

          const series = buildMultiTimeframeExtremeSeries(job.candles, params);
          const metrics = simulateExtremeMacd(
            job.candles,
            series,
            params,
            false
          );

          if (finite(metrics.trades, 0) >= job.min_trades) {
            const score = multiTfOptimizerScore(metrics, job.min_trades);
            const normalizedMetrics = {
              trades: Number(metrics.trades || 0),
              profit_factor: Number(metrics.profit_factor || 0),
              net: Number(metrics.net || 0),
              max_drawdown: Number(metrics.max_drawdown || 0),
              win_rate_pct: Number(metrics.win_rate_pct || 0),
            };
            keepMultiTfTop(job.top, {
              params,
              metrics: normalizedMetrics,
              score,
              snapshot: buildOptimizerSnapshot({
                runId: job.id,
                phase: 1,
                symbol: job.symbol,
                interval: job.interval,
                candles: job.candles,
                requestedLimit: job.requested_limit,
                params,
                metrics: normalizedMetrics,
              }),
            }, 100);
          }
        }

        job.next = end;
        await persistMultiTfJob(job);

        // Render/Event-Loop bewusst freigeben.
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      if (job.status === "RUNNING") {
        await finishMultiTfJob(job);
      } else {
        await persistMultiTfJob(job);
      }
    } catch (error) {
      job.status = "PAUSED";
      job.error = String(error?.stack || error?.message || error);
      await persistMultiTfJob(job);
    } finally {
      job.running = false;
    }
  }

  if (!db || !getStoredCandles || !sendJson || !readJsonBody) {
    throw new Error("QMomentum route dependencies missing");
  }

  return async function handleQMomentumRoute(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/qmomentum/")) return false;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-webhook-secret, x-secret",
      });
      res.end();
      return true;
    }

    await ensureQMomentumTables(db);

    if (req.method === "GET" && url.pathname === "/qmomentum/data") {
      try {
        const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
        const interval = String(url.searchParams.get("interval") || "").trim().toLowerCase();
        const limit = Math.min(10000, Math.max(200, Number(url.searchParams.get("limit") || 5000)));
        if (!symbol || !interval) {
          sendJson(res, 400, { ok: false, error: "symbol/interval missing" });
          return true;
        }
        const candles = await getStoredCandles(symbol, interval, limit);
        const arrays = buildIndicatorArrays(candles);
        const annotations = await db.all(
          `SELECT id,symbol,interval,time,price,label,direction,note,created_at,updated_at
           FROM qmomentum_annotations WHERE symbol=? AND interval=? ORDER BY time ASC`,
          [symbol, interval],
        );
        const trendAnnotations = await db.all(
          `SELECT id,symbol,interval,time,price,trend_start,note,created_at,updated_at
           FROM qmomentum_trend_annotations WHERE symbol=? AND interval=? ORDER BY time ASC`,
          [symbol, interval],
        );
        const scannerCandidates = buildScannerCandidates(candles, arrays);
        const model = await readModel(db);
        const chartPredictions = buildChartPredictions(candles, arrays, model);
        const aiCandidates = predictionsToMarkers(chartPredictions, 70);
        const trendModel = await readTrendModel(db);
        const trendPredictions = buildTrendPredictions(candles, arrays, trendModel);
        const trendAiCandidates = trendPredictionsToMarkers(trendPredictions, 70);
        sendJson(res, 200, {
          ok: true,
          version: QMOMENTUM_VERSION,
          candles,
          annotations,
          trend_annotations: trendAnnotations,
          scanner_candidates: scannerCandidates,
          ai_candidates: aiCandidates,
          chart_predictions: chartPredictions,
          trend_predictions: trendPredictions,
          trend_ai_candidates: trendAiCandidates,
          prediction_mode: "FULL_CHART_EVERY_CANDLE",
          trend_prediction_mode: "FULL_CHART_TREND_START",
          model: model ? {
            trained_at: model.trained_at,
            positive_count: model.positive_count,
            long_count: model.long_count || 0,
            short_count: model.short_count || 0,
            negative_count: model.negative_count,
            threshold: 70,
          } : null,
          trend_model: trendModel ? {
            trained_at: trendModel.trained_at,
            positive_count: trendModel.positive_count,
            up_count: trendModel.up_count || 0,
            down_count: trendModel.down_count || 0,
            background_count: trendModel.background_count || 0,
            labeled_candle_count: trendModel.labeled_candle_count || 0,
            segment_count: trendModel.segment_count || 0,
            model_type: trendModel.model_type || "TREND_STATE_CENTROID_V2",
            threshold: 60,
            numeric_valid: Boolean(trendModel.numeric_valid),
          } : null,
        });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }


    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/qmomentum/predict-chart") {
      try {
        let symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
        let interval = String(url.searchParams.get("interval") || "").trim().toLowerCase();
        let limit = Math.min(10000, Math.max(200, Number(url.searchParams.get("limit") || 5000)));
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          symbol = String(body.symbol || symbol).trim().toUpperCase();
          interval = String(body.interval || interval).trim().toLowerCase();
          limit = Math.min(10000, Math.max(200, Number(body.limit || limit)));
        }
        if (!symbol || !interval) {
          sendJson(res, 400, { ok: false, error: "symbol/interval missing" });
          return true;
        }
        const model = await readModel(db);
        if (!model) {
          sendJson(res, 404, { ok: false, code: "MODEL_MISSING", error: "Noch kein QMomentum-Modell trainiert." });
          return true;
        }
        if (!model.numeric_valid) {
          sendJson(res, 409, {
            ok: false,
            code: "MODEL_NUMERIC_INVALID",
            error: "Das gespeicherte Modell enthält ungültige Zahlen. Bitte KI einmal neu trainieren.",
          });
          return true;
        }
        const candles = await getStoredCandles(symbol, interval, limit);
        const arrays = buildIndicatorArrays(candles);
        const predictions = buildChartPredictions(candles, arrays, model);
        const trendModel = await readTrendModel(db);
        const trendPredictions = buildTrendPredictions(candles, arrays, trendModel);
        sendJson(res, 200, {
          ok: true,
          version: QMOMENTUM_VERSION,
          mode: "FULL_CHART_EVERY_CANDLE",
          symbol,
          interval,
          candle_count: candles.length,
          prediction_count: predictions.length,
          predictions,
          trend_prediction_count: trendPredictions.length,
          trend_predictions: trendPredictions,
          model: {
            trained_at: model.trained_at,
            positive_count: model.positive_count,
            long_count: model.long_count || 0,
            short_count: model.short_count || 0,
            negative_count: model.negative_count,
          },
          trend_model: trendModel ? {
            trained_at: trendModel.trained_at,
            positive_count: trendModel.positive_count,
            up_count: trendModel.up_count || 0,
            down_count: trendModel.down_count || 0,
            background_count: trendModel.background_count || 0,
            labeled_candle_count: trendModel.labeled_candle_count || 0,
            segment_count: trendModel.segment_count || 0,
            model_type: trendModel.model_type || "TREND_STATE_CENTROID_V2",
            numeric_valid: Boolean(trendModel.numeric_valid),
          } : null,
        });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }



    if (req.method === "POST" && url.pathname === "/qmomentum/marker-imitation-test") {
      try {
        const body = await readJsonBody(req);
        const symbol = String(body.symbol || "").trim().toUpperCase();
        const interval = String(body.interval || "").trim().toLowerCase();
        const limit = Number(body.limit || 5000);

        if (!symbol || !interval) {
          sendJson(res, 400, { ok: false, error: "symbol/interval missing" });
          return true;
        }

        const result = await runMarkerImitationE1({
          db,
          getStoredCandles,
          symbol,
          interval,
          limit,
        });

        if (!result.ok) {
          sendJson(res, result.status || 400, result);
          return true;
        }

        sendJson(res, 200, result);
        return true;
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: String(error?.stack || error?.message || error),
        });
        return true;
      }
    }



    if (req.method === "POST" && url.pathname === "/qmomentum/king-optimize/start") {
      try {
        const body = await readJsonBody(req);
        const symbol = String(body.symbol || "").trim().toUpperCase();
        const interval = String(body.interval || "").trim().toLowerCase();
        if (!symbol || !interval) {
          sendJson(res, 400, { ok: false, error: "symbol/interval missing" });
          return true;
        }

        const candles = await getStoredCandles(
          symbol,
          interval,
          Math.min(5000, Math.max(500, Number(body.limit || 5000))),
        );
        const rows = await db.all(
          `SELECT time,trend_start
           FROM qmomentum_trend_annotations
           WHERE symbol=? AND interval=?
           ORDER BY time ASC`,
          [symbol, interval],
        );
        const indexByTime = new Map(candles.map((c, i) => [Number(c.time), i]));
        const markers = rows
          .map((row) => ({
            time: Number(row.time),
            trend_start: row.trend_start,
            index: indexByTime.get(Number(row.time)),
          }))
          .filter((row) => Number.isInteger(row.index));

        if (markers.length < 10) {
          sendJson(res, 400, {
            ok: false,
            error: `Mindestens 10 UT-/DT-Marker nötig. Nutzbar: ${markers.length}.`,
          });
          return true;
        }

        const split = Math.max(6, Math.min(markers.length - 3, Math.floor(markers.length * 0.7)));
        const splitIndex = markers[split].index;
        const jobId = `king_v3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const grid = kingMacdKnickGrid();

        kingOptimizationJobs.set(jobId, {
          id: jobId,
          version: "KING_OPTIMIZER_V3_MACD_KNICK",
          symbol,
          interval,
          candles,
          markers,
          train: markers.slice(0, split),
          test: markers.slice(split),
          splitIndex,
          phase: "macd_knick",
          grid,
          entry_grid_count: grid.length,
          next: 0,
          top: [],
          created: Date.now(),
        });

        sendJson(res, 200, {
          ok: true,
          version: "KING_OPTIMIZER_V3_MACD_KNICK",
          job_id: jobId,
          phase: "macd_knick",
          total: grid.length,
          processed: 0,
          progress_pct: 0,
          train_markers: split,
          test_markers: markers.length - split,
        });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/king-optimize/step") {
      try {
        const body = await readJsonBody(req);
        const job = kingOptimizationJobs.get(String(body.job_id || ""));
        if (!job) {
          sendJson(res, 404, { ok: false, error: "King-Optimizer-Job nicht gefunden." });
          return true;
        }

        const batch = Math.min(180, Math.max(10, Number(body.batch_size || 100)));
        const end = Math.min(job.grid.length, job.next + batch);

        for (let k = job.next; k < end; k += 1) {
          const params = job.grid[k];
          const predictions = kingKnickPredictions(job.candles, params);
          const trainPredictions = predictions.filter((prediction) => prediction.index < job.splitIndex);
          const metrics = evaluateKingKnick(trainPredictions, job.train);
          job.top.push({ params, score: metrics.score, train: metrics });
        }

        job.next = end;
        job.top.sort((a, b) => b.score - a.score);
        job.top = job.top.slice(0, job.phase === "macd_knick" ? 24 : 20);

        if (job.next >= job.grid.length && job.phase === "macd_knick") {
          job.phase = "filters";
          job.grid = kingFilterGrid(job.top);
          job.next = 0;
          job.top = [];
          sendJson(res, 200, {
            ok: true,
            version: job.version,
            job_id: job.id,
            phase: "filters",
            total: job.grid.length,
            processed: 0,
            progress_pct: 0,
            done: false,
            message: "MACD-Knick gefunden. Heikin-Farbe, ATR und RSI werden jetzt nur noch als Filter geprüft.",
          });
          return true;
        }

        const done = job.phase === "filters" && job.next >= job.grid.length;
        let result = null;

        if (done) {
          const ranked = job.top
            .map((row) => {
              const predictions = kingKnickPredictions(job.candles, row.params);
              const testPredictions = predictions.filter(
                (prediction) => prediction.index >= job.splitIndex - 2,
              );
              const test = evaluateKingKnick(testPredictions, job.test);
              const combinedScore = row.train.score * 0.4 + test.score;
              return {
                ...row,
                test,
                predictions,
                combined_score: Number(combinedScore.toFixed(2)),
              };
            })
            .sort((a, b) => b.combined_score - a.combined_score);

          const best = ranked[0];
          result = {
            version: job.version,
            mode: "MACD_KNICK_FIRST_FILTERS_SECOND",
            best: { ...best, predictions: best.predictions },
            top: ranked.slice(0, 20).map((row) => ({
              params: row.params,
              score: row.score,
              combined_score: row.combined_score,
              train: row.train,
              test: row.test,
            })),
          };
          kingOptimizationJobs.delete(job.id);
        }

        sendJson(res, 200, {
          ok: true,
          version: job.version,
          job_id: job.id,
          phase: job.phase,
          total: job.grid.length,
          processed: job.next,
          progress_pct: Number((job.next / Math.max(1, job.grid.length) * 100).toFixed(1)),
          done,
          result,
        });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }


    if (req.method === "POST" && url.pathname === "/qmomentum/extreme-optimize/start") {
      try {
        const body = await readJsonBody(req);
        const symbol = String(body.symbol || "").trim().toUpperCase();
        const interval = String(body.interval || "").trim().toLowerCase();
        const requestedLimit = Number(body.limit || 5000);
        const limit = Math.min(10000, Math.max(500, Number.isFinite(requestedLimit) ? requestedLimit : 5000));
        if (!symbol || !interval) { sendJson(res, 400, { ok: false, error: "symbol/interval missing" }); return true; }
        const candles = await getStoredCandles(symbol, interval, limit);
        if (!Array.isArray(candles) || candles.length < 300) {
          sendJson(res, 400, { ok: false, error: `V7.4 benötigt mindestens 300 Kerzen. Vorhanden: ${candles?.length || 0}.` }); return true;
        }
        const grid = buildExtremeMacdGrid(body);
        const id = `extreme_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const baseMinutes = intervalToMinutes(interval);
        const requestedHtf = Math.max(baseMinutes, Math.floor(finite(body.exit_htf_minutes, Math.max(30, baseMinutes * 2))));
        const requestedExitTiming = Math.max(baseMinutes, Math.floor(finite(body.exit_timing_minutes, Math.max(15, baseMinutes))));
        const common = {
          macd_entry_mode: "SIGMA_ARMED_THEN_RSI_SIGNAL_CROSSOVER_ZERO_INVALIDATION",
          macd_signal: 9, rsi_signal: 9,
          z_window: Math.max(50, Math.min(1000, Math.floor(finite(body.z_window, 200)))),
          protect_family: "FIXED_INVALIDATION", protect_label: "3 Bars · Verlust · Gegen-Extrem/MACD",
          protect_min_hold_bars: 3,
          profit_family: "HTF_RSI_ARMED_MTF_TURN", profit_label: `HTF-RSI Extrem → ${requestedExitTiming}m-RSI Drehung`,
          exit_rsi_lower: Math.max(1, Math.min(49, finite(body.exit_rsi_lower, 30))),
          exit_rsi_upper: Math.max(51, Math.min(99, finite(body.exit_rsi_upper, 70))),
          interval,
          exit_htf_minutes: requestedHtf,
          exit_timing_minutes: requestedExitTiming,
          trend_filter_mode: ["ad", "chaikin"].includes(String(body.trend_filter_mode || "none").toLowerCase())
            ? String(body.trend_filter_mode).toLowerCase()
            : "none",
          ad_length: Math.max(2, Math.min(50, Math.floor(finite(body.ad_length, 11)))),
          chaikin_fast: Math.max(1, Math.min(20, Math.floor(finite(body.chaikin_fast, 3)))),
          chaikin_slow: Math.max(2, Math.min(60, Math.floor(finite(body.chaikin_slow, 10)))),
        };
        const resumeProcessed = Math.max(0, Math.min(grid.length, Math.floor(finite(body.resume_processed, 0))));
        const resumeTop = Array.isArray(body.resume_top) ? body.resume_top.slice(0, 50) : [];
        const job = {
          id, symbol, interval, candles, common, phase: "entry", grid, next: resumeProcessed, top: resumeTop, entry_ranked: [],
          min_trades: Math.max(5, Math.floor(finite(body.min_trades, 30))), tested_zone_pairs: resumeProcessed * extremeZonePairs().length,
          created_at: berlinNowIso(), updated_at_ms: Date.now(), entry_grid_count: grid.length,
        };
        extremeOptimizationJobs.set(id, job);
        sendJson(res, 200, {
          ok: true, version: "EXTREME_MACD_AD_CHAIKIN_LAB_V1_2", job_id: id, phase: "entry",
          symbol, interval, candle_count: candles.length, total: grid.length, processed: job.next, progress_pct: Number((job.next / Math.max(1, grid.length) * 100).toFixed(1)), done: false,
          message: `Entry-Optimizer läuft. Exit fest: ${requestedHtf}m RSI ${common.exit_rsi_lower}/${common.exit_rsi_upper} armed, ${requestedExitTiming}m-RSI-Drehung exit.`,
        });
        return true;
      } catch (error) { sendJson(res, 500, { ok: false, error: String(error?.stack || error?.message || error) }); return true; }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/extreme-optimize/step") {
      try {
        const body = await readJsonBody(req);
        const jobId = String(body.job_id || "").trim();
        const job = extremeOptimizationJobs.get(jobId);
        if (!job) { sendJson(res, 404, { ok: false, code: "EXTREME_JOB_NOT_FOUND", error: "V7.4-Optimizer-Job nicht gefunden oder abgelaufen." }); return true; }
        const batchSize = Math.min(12, Math.max(1, Math.floor(finite(body.batch_size, 4))));
        const end = Math.min(job.grid.length, job.next + batchSize);
        for (let gridIndex = job.next; gridIndex < end; gridIndex += 1) {
          const baseParams = { ...job.grid[gridIndex], ...job.common };
          const series = buildExtremeMacdSeries(job.candles, baseParams);
          const zonePairs = extremeZonePairs();
          job.tested_zone_pairs += zonePairs.length;
          for (const zones of zonePairs) {
            const params = { ...baseParams, ...zones };
            const metrics = simulateExtremeMacd(job.candles, series, params, false);
            if (metrics.trades < job.min_trades) continue;
            keepExtremeTop(job.top, { params, metrics }, 50);
          }
        }
        job.next = end; job.updated_at_ms = Date.now();
        const done = job.next >= job.grid.length;
        let result = null;
        if (done) {
          job.entry_ranked = [...job.top].sort((a, b) => b.metrics.score - a.metrics.score);
          const bestBase = job.entry_ranked[0] || null;
          if (bestBase) {
            const bestSeries = buildExtremeMacdSeries(job.candles, bestBase.params);
            const bestMetrics = simulateExtremeMacd(job.candles, bestSeries, bestBase.params, true);
            result = {
              mode: "MACD_EXTREME_PLUS_OPTIONAL_AD_CHAIKIN_TREND_PATH_V1_2", symbol: job.symbol, interval: job.interval,
              candle_count: job.candles.length, tested_macd_sets: job.entry_grid_count,
              tested_zone_pairs: job.tested_zone_pairs, tested_protect_sets: 1, tested_profit_sets: 1,
              min_trades: job.min_trades, entry_best: bestBase, protect_best: bestBase,
              best: { params: bestBase.params, metrics: bestMetrics }, stable_islands: extremeStableIslands(job.entry_ranked),
              entry_top: job.entry_ranked.slice(0, 20), protect_top: [], top: job.entry_ranked.slice(0, 20),
            };
          }
          extremeOptimizationJobs.delete(job.id);
        }
        sendJson(res, 200, {
          ok: true, version: "EXTREME_MACD_AD_CHAIKIN_LAB_V1_2", job_id: job.id, phase: "entry",
          total: job.grid.length, processed: job.next, progress_pct: Number((job.next / Math.max(1, job.grid.length) * 100).toFixed(1)),
          tested_zone_pairs: job.tested_zone_pairs, tested_protect_sets: 1, tested_profit_sets: 1,
          done, best_so_far: job.top[0] || null, resume_top: done ? [] : job.top.slice(0, 50), result,
        });
        return true;
      } catch (error) { sendJson(res, 500, { ok: false, error: String(error?.stack || error?.message || error) }); return true; }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/formula-optimize/start") {
      try {
        cleanupFormulaJobs();
        const body = await readJsonBody(req);
        const symbol = String(body.symbol || "").trim().toUpperCase();
        const interval = String(body.interval || "").trim().toLowerCase();
        const requestedLimit = Number(body.limit || 800);
        const limit = Math.min(800, Math.max(300, Number.isFinite(requestedLimit) ? requestedLimit : 800));

        if (!symbol || !interval) {
          sendJson(res, 400, { ok: false, error: "symbol/interval missing" });
          return true;
        }

        const candles = await getStoredCandles(symbol, interval, limit);
        const trendAnnotations = await db.all(
          `SELECT time,trend_start
           FROM qmomentum_trend_annotations
           WHERE symbol=? AND interval=?
           ORDER BY time ASC`,
          [symbol, interval],
        );

        if (trendAnnotations.length < 6) {
          sendJson(res, 400, {
            ok: false,
            error: `Mindestens 6 Trendstarts nötig. Vorhanden: ${trendAnnotations.length}.`,
          });
          return true;
        }

        const now = berlinNowIso();
        const id = `formula_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const job = {
          id,
          symbol,
          interval,
          candles,
          target_start_count: trendAnnotations.length,
          context: prepareFormulaBatchContext(candles, trendAnnotations),
          top: [],
          next_index: 0,
          total: FORMULA_TOTAL,
          created_at: now,
          updated_at: now,
          updated_at_ms: Date.now(),
        };

        formulaOptimizationJobs.set(id, job);
        sendJson(res, 200, {
          ok: true,
          version: QMOMENTUM_VERSION,
          optimizer_mode: "BATCH_64",
          batch_size_default: FORMULA_BATCH_SIZE_DEFAULT,
          ...formulaJobPublic(job, false),
        });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/formula-optimize/step") {
      try {
        cleanupFormulaJobs();
        const body = await readJsonBody(req);
        const jobId = String(body.job_id || "").trim();
        const requestedBatchSize = Number(body.batch_size || FORMULA_BATCH_SIZE_DEFAULT);
        const batchSize = Math.min(96, Math.max(8, Number.isFinite(requestedBatchSize) ? requestedBatchSize : FORMULA_BATCH_SIZE_DEFAULT));
        const job = formulaOptimizationJobs.get(jobId);

        if (!job) {
          sendJson(res, 404, { ok: false, code: "FORMULA_JOB_NOT_FOUND", error: "Formelsuch-Job nicht gefunden oder abgelaufen." });
          return true;
        }

        const endIndex = Math.min(job.total, job.next_index + batchSize);
        for (let index = job.next_index; index < endIndex; index += 1) {
          const params = formulaParamsAt(index);
          const result = evaluateFormulaBatchItem(job.context, params);
          keepFormulaTop10(job.top, result);
        }

        job.next_index = endIndex;
        job.updated_at = berlinNowIso();
        job.updated_at_ms = Date.now();

        sendJson(res, 200, {
          ok: true,
          version: QMOMENTUM_VERSION,
          optimizer_mode: "BATCH_64",
          batch_size: batchSize,
          ...formulaJobPublic(job, true),
        });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }

    if (req.method === "GET" && url.pathname === "/qmomentum/formula-optimize/status") {
      cleanupFormulaJobs();
      const jobId = String(url.searchParams.get("job_id") || "").trim();
      const job = formulaOptimizationJobs.get(jobId);
      if (!job) {
        sendJson(res, 404, { ok: false, code: "FORMULA_JOB_NOT_FOUND", error: "Formelsuch-Job nicht gefunden oder abgelaufen." });
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        version: QMOMENTUM_VERSION,
        optimizer_mode: "BATCH_64",
        ...formulaJobPublic(job, true),
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/qmomentum/formula-optimize") {
      sendJson(res, 410, {
        ok: false,
        code: "FORMULA_BATCH_REQUIRED",
        error: "Diese Route wurde durch den V0.3 Batch-Optimizer ersetzt.",
        start_route: "/qmomentum/formula-optimize/start",
        step_route: "/qmomentum/formula-optimize/step",
        status_route: "/qmomentum/formula-optimize/status",
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/trend-annotation") {
      try {
        const body = await readJsonBody(req);
        const symbol = String(body.symbol || "").trim().toUpperCase();
        const interval = String(body.interval || "").trim().toLowerCase();
        const time = Number(body.time);
        const price = finite(body.price, NaN);
        const trendStart = String(body.trend_start || "").trim().toLowerCase();
        const note = body.note == null ? null : String(body.note).slice(0, 500);
        if (!symbol || !interval || !Number.isFinite(time) || !Number.isFinite(price)) {
          sendJson(res, 400, { ok: false, error: "invalid trend annotation point" }); return true;
        }
        if (!["up", "down"].includes(trendStart)) {
          sendJson(res, 400, { ok: false, error: "trend_start must be up or down" }); return true;
        }
        const candles = await getStoredCandles(symbol, interval, 10000);
        const index = candles.findIndex((c) => Number(c.time) === time);
        if (index < 0) { sendJson(res, 404, { ok: false, error: "candle not found" }); return true; }
        const context = buildFeatures(candles, index);
        await db.run(`
          INSERT INTO qmomentum_trend_annotations
            (symbol,interval,time,price,trend_start,note,context_json,feature_version,updated_at)
          VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))
          ON CONFLICT(symbol,interval,time) DO UPDATE SET
            price=excluded.price,trend_start=excluded.trend_start,note=excluded.note,
            context_json=excluded.context_json,feature_version=excluded.feature_version,
            updated_at=datetime('now','localtime')
        `, [symbol, interval, time, price, trendStart, note, JSON.stringify(context), QMOMENTUM_VERSION]);
        const annotation = await db.get(
          `SELECT id,symbol,interval,time,price,trend_start,note,created_at,updated_at
           FROM qmomentum_trend_annotations WHERE symbol=? AND interval=? AND time=?`,
          [symbol, interval, time],
        );
        sendJson(res, 200, { ok: true, trend_annotation: annotation, context_bars: context.length });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) }); return true;
      }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/annotation") {
      try {
        const body = await readJsonBody(req);
        const symbol = String(body.symbol || "").trim().toUpperCase();
        const interval = String(body.interval || "").trim().toLowerCase();
        const time = Number(body.time);
        const price = finite(body.price, NaN);
        const label = String(body.label || "").trim().toLowerCase();
        const direction = String(body.direction || "none").trim().toLowerCase();
        const note = body.note == null ? null : String(body.note).slice(0, 500);
        if (!symbol || !interval || !Number.isFinite(time) || !Number.isFinite(price)) {
          sendJson(res, 400, { ok: false, error: "invalid annotation point" });
          return true;
        }
        if (!["perfect", "bad", "missed", "unsure"].includes(label) || !["long","short","none"].includes(direction)) {
          sendJson(res, 400, { ok: false, error: "invalid momentum label" });
          return true;
        }
        const candles = await getStoredCandles(symbol, interval, 10000);
        const index = candles.findIndex((c) => Number(c.time) === time);
        if (index < 0) {
          sendJson(res, 404, { ok: false, error: "candle not found" });
          return true;
        }
        const context = buildFeatures(candles, index);
        await db.run(`
          INSERT INTO qmomentum_annotations
            (symbol,interval,time,price,label,direction,note,context_json,feature_version,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))
          ON CONFLICT(symbol,interval,time) DO UPDATE SET
            price=excluded.price,label=excluded.label,direction=excluded.direction,note=excluded.note,
            context_json=excluded.context_json,feature_version=excluded.feature_version,
            updated_at=datetime('now','localtime')
        `, [symbol, interval, time, price, label, direction, note, JSON.stringify(context), QMOMENTUM_VERSION]);
        const annotation = await db.get(
          `SELECT id,symbol,interval,time,price,label,direction,note,created_at,updated_at
           FROM qmomentum_annotations WHERE symbol=? AND interval=? AND time=?`,
          [symbol, interval, time],
        );
        sendJson(res, 200, { ok: true, annotation, context_bars: context.length });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }


    if (req.method === "POST" && url.pathname === "/qmomentum/train-trend") {
      try {
        const rows = await db.all(`
          SELECT symbol,interval,time,trend_start
          FROM qmomentum_trend_annotations
          ORDER BY symbol,interval,time ASC
        `);

        const grouped = new Map();
        for (const row of rows) {
          const key = `${row.symbol}::${row.interval}`;
          if (!grouped.has(key)) {
            grouped.set(key, {
              symbol: row.symbol,
              interval: row.interval,
              starts: [],
            });
          }
          grouped.get(key).starts.push({
            time: Number(row.time),
            state: row.trend_start === "up" ? "up" : "down",
          });
        }

        const upVectors = [];
        const downVectors = [];
        let labeledCandles = 0;
        let usableSegments = 0;

        for (const group of grouped.values()) {
          const starts = [...group.starts].sort((a, b) => a.time - b.time);
          if (starts.length < 2) continue;

          const candles = await getStoredCandles(group.symbol, group.interval, 10000);
          if (!candles.length) continue;
          const arrays = buildIndicatorArrays(candles);

          for (let segmentIndex = 0; segmentIndex < starts.length - 1; segmentIndex += 1) {
            const current = starts[segmentIndex];
            const next = starts[segmentIndex + 1];
            const startIndex = candles.findIndex((c) => Number(c.time) === current.time);
            const endIndex = candles.findIndex((c) => Number(c.time) === next.time);
            if (startIndex < 0 || endIndex <= startIndex) continue;

            usableSegments += 1;

            // Die ersten zwei Kerzen nach dem manuellen Start werden ausgelassen.
            // So lernt das Modell eher den aktiven Trendzustand als nur die Startkerze.
            const first = Math.max(30, startIndex + 2);
            const last = Math.max(first, endIndex - 1);

            for (let i = first; i <= last; i += 1) {
              const vector = buildTrendStateVector(candles, i, arrays);
              if (!vector) continue;

              if (current.state === "up") upVectors.push(vector);
              else downVectors.push(vector);
              labeledCandles += 1;
            }
          }
        }

        if (upVectors.length < 100 || downVectors.length < 100) {
          sendJson(res, 400, {
            ok: false,
            error:
              `Für das echte Trendzustandsmodell werden mindestens 100 UPTREND- und ` +
              `100 DOWNTREND-Kerzen benötigt. Vorhanden: UT ${upVectors.length}, DT ${downVectors.length}.`,
          });
          return true;
        }

        // Klassen ausgleichen, damit die längere Richtung das Modell nicht dominiert.
        const balancedCount = Math.min(upVectors.length, downVectors.length, 6000);
        function evenlySample(vectors, count) {
          if (vectors.length <= count) return vectors;
          const sampled = [];
          const step = vectors.length / count;
          for (let i = 0; i < count; i += 1) {
            sampled.push(vectors[Math.min(vectors.length - 1, Math.floor(i * step))]);
          }
          return sampled;
        }

        const balancedUp = evenlySample(upVectors, balancedCount);
        const balancedDown = evenlySample(downVectors, balancedCount);
        const norm = statsForVectors([...balancedUp, ...balancedDown]);

        const model = {
          version: QMOMENTUM_VERSION,
          model_type: "TREND_STATE_CENTROID_V2",
          feature_names: [
            "hist_norm",
            "hist_delta_norm",
            "macd_norm",
            "macd_delta_norm",
            "macd_signal_gap_norm",
            "rsi_centered",
            "rsi_delta_1",
            "rsi_delta_3",
            "rsi_ma_gap",
            "hist_contraction_1",
            "hist_contraction_3",
            "hist_sign",
            "distance_sma50_range",
            "sma50_slope_5_range",
            "price_change_10_pct",
            "price_change_20_pct",
          ],
          norm,
          up_centroid: standardizedCentroid(balancedUp, norm),
          down_centroid: standardizedCentroid(balancedDown, norm),
          up_count: upVectors.length,
          down_count: downVectors.length,
          balanced_count_per_class: balancedCount,
          segment_count: usableSegments,
          labeled_candle_count: labeledCandles,
        };

        if (!isUsableTrendModel(model)) {
          sendJson(res, 500, {
            ok: false,
            code: "TREND_STATE_MODEL_BUILD_INVALID",
            error: "Trendzustandstraining erzeugte ungültige Modellwerte.",
          });
          return true;
        }

        await db.run(`
          INSERT INTO qmomentum_models(model_key,model_json,positive_count,negative_count,trained_at)
          VALUES(?,?,?,?,datetime('now','localtime'))
          ON CONFLICT(model_key) DO UPDATE SET
            model_json=excluded.model_json,
            positive_count=excluded.positive_count,
            negative_count=excluded.negative_count,
            trained_at=datetime('now','localtime')
        `, [
          TREND_MODEL_KEY,
          JSON.stringify(model),
          upVectors.length,
          downVectors.length,
        ]);

        const saved = await readTrendModel(db);
        sendJson(res, 200, {
          ok: true,
          trend_model: {
            trained_at: saved.trained_at,
            positive_count: upVectors.length + downVectors.length,
            up_count: upVectors.length,
            down_count: downVectors.length,
            background_count: 0,
            balanced_count_per_class: balancedCount,
            segment_count: usableSegments,
            labeled_candle_count: labeledCandles,
            threshold: 60,
            numeric_valid: Boolean(saved.numeric_valid),
            model_type: saved.model_type,
          },
        });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/train") {
      try {
        const rows = await db.all(`
          SELECT label,direction,context_json FROM qmomentum_annotations
          WHERE label IN ('perfect','missed','bad') ORDER BY updated_at ASC
        `);
        const longs = []; const shorts = []; const negatives = [];
        for (const row of rows) {
          let context; try { context = JSON.parse(row.context_json); } catch { continue; }
          const vector = vectorFromContext(context);
          if (!vector || !vector.every(Number.isFinite)) continue;
          if ((row.label === "perfect" || row.label === "missed") && row.direction === "long") longs.push(vector);
          if ((row.label === "perfect" || row.label === "missed") && row.direction === "short") shorts.push(vector);
          if (row.label === "bad") negatives.push(vector);
        }
        if (longs.length < 3 || shorts.length < 3 || negatives.length < 3) {
          sendJson(res, 400, { ok:false, error:`Mindestens 3 LONG-positive, 3 SHORT-positive und 3 schlechte Beispiele nötig. Vorhanden: LONG ${longs.length}, SHORT ${shorts.length}, schlecht ${negatives.length}.` });
          return true;
        }
        const all = [...longs, ...shorts, ...negatives];
        const norm = statsForVectors(all);
        const model = {
          version: QMOMENTUM_VERSION,
          feature_names: ["hist_norm","hist_delta_norm","macd_norm","macd_delta_norm","macd_signal_gap_norm","rsi_centered","rsi_delta_1","rsi_delta_3","rsi_ma_gap","hist_contraction_1","hist_contraction_3","hist_sign"],
          norm,
          long_centroid: standardizedCentroid(longs, norm),
          short_centroid: standardizedCentroid(shorts, norm),
          negative_centroid: standardizedCentroid(negatives, norm),
          long_count: longs.length,
          short_count: shorts.length,
        };

        if (!isUsableModel(model)) {
          sendJson(res, 500, {
            ok: false,
            code: "MODEL_BUILD_INVALID",
            error: "Training erzeugte ungültige Modellwerte. Modell wurde nicht gespeichert.",
          });
          return true;
        }
        await db.run(`
          INSERT INTO qmomentum_models(model_key,model_json,positive_count,negative_count,trained_at)
          VALUES(?,?,?,?,datetime('now','localtime'))
          ON CONFLICT(model_key) DO UPDATE SET
            model_json=excluded.model_json,
            positive_count=excluded.positive_count,
            negative_count=excluded.negative_count,
            trained_at=datetime('now','localtime')
        `, [MODEL_KEY, JSON.stringify(model), longs.length + shorts.length, negatives.length]);
        const saved = await readModel(db);
        sendJson(res, 200, {
          ok: true,
          model: {
            trained_at: saved.trained_at,
            positive_count: longs.length + shorts.length,
            long_count: longs.length, short_count: shorts.length,
            negative_count: negatives.length, threshold: 62,
          },
        });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }





    if (url.pathname.startsWith("/qmomentum/multi-tf-optimize")) {
      try {
        await ensureMultiTfOptimizerTables();

        if (
          req.method === "POST" &&
          url.pathname === "/qmomentum/multi-tf-optimize/start"
        ) {
          const body = await readJsonBody(req);
          const symbol = String(body?.symbol || "").trim().toUpperCase();
          const interval = String(body?.interval || "").trim().toLowerCase();

          if (!symbol || !interval) {
            sendJson(res, 400, {
              ok:false,
              error:"symbol/interval missing",
            });
            return true;
          }

          const limit = Math.max(
            500,
            Math.min(10000, Math.floor(finite(body?.limit, 5000)))
          );
          const candles = await getStoredCandles(symbol, interval, limit);

          if (!Array.isArray(candles) || candles.length < 300) {
            sendJson(res, 400, {
              ok:false,
              error:`Mindestens 300 Kerzen erforderlich. Vorhanden: ${candles?.length || 0}`,
            });
            return true;
          }

          const raw = body?.params || {};
          const fixedParams = {
            macd_fast: Math.max(1, Math.floor(finite(raw.macd_fast, 10))),
            macd_slow: Math.max(2, Math.floor(finite(raw.macd_slow, 20))),
            macd_signal: Math.max(1, Math.floor(finite(raw.macd_signal, 9))),
            rsi_length: Math.max(2, Math.floor(finite(raw.rsi_length, 14))),
            rsi_signal: Math.max(1, Math.floor(finite(raw.rsi_signal, 9))),
            long_zone_sigma: Math.min(-0.1, finite(raw.long_zone_sigma, -1.5)),
            short_zone_sigma: Math.max(0.1, finite(raw.short_zone_sigma, 1.5)),
            z_window: Math.max(30, Math.floor(finite(raw.z_window, 200))),
            protect_min_hold_bars: Math.max(
              1,
              Math.floor(finite(raw.protect_min_hold_bars, 3))
            ),
            exit_htf_minutes: Math.max(
              intervalToMinutes(interval),
              Math.floor(finite(raw.exit_htf_minutes, 60))
            ),
            exit_timing_minutes: Math.max(
              intervalToMinutes(interval),
              Math.floor(finite(
                raw.exit_timing_minutes,
                intervalToMinutes(interval)
              ))
            ),
            exit_rsi_lower: Math.max(
              1,
              Math.min(49, finite(raw.exit_rsi_lower, 30))
            ),
            exit_rsi_upper: Math.max(
              51,
              Math.min(99, finite(raw.exit_rsi_upper, 70))
            ),
            strategy_mode: ["basis","basis_ad","basis_chaikin"].includes(
              String(raw.strategy_mode || "basis")
            ) ? String(raw.strategy_mode) : "basis",
            trend_filter_mode: ["none","ad","chaikin"].includes(
              String(raw.trend_filter_mode || "none")
            ) ? String(raw.trend_filter_mode) : "none",
            trend_sigma_abs: Math.max(
              0,
              Math.min(2, finite(raw.trend_sigma_abs, 0))
            ),
            ad_length: Math.max(
              2,
              Math.min(50, Math.floor(finite(raw.ad_length, 11)))
            ),
            chaikin_fast: Math.max(
              1,
              Math.min(20, Math.floor(finite(raw.chaikin_fast, 3)))
            ),
            chaikin_slow: Math.max(
              2,
              Math.min(60, Math.floor(finite(raw.chaikin_slow, 10)))
            ),
          };

          if (fixedParams.macd_slow <= fixedParams.macd_fast) {
            fixedParams.macd_slow = fixedParams.macd_fast + 2;
          }
          if (fixedParams.chaikin_slow <= fixedParams.chaikin_fast) {
            fixedParams.chaikin_slow = fixedParams.chaikin_fast + 1;
          }

          const built = buildMultiTfGrid(body, interval);
          const maxCombinations = Math.max(
            1,
            Math.min(50000, Math.floor(finite(body?.max_combinations, 20000)))
          );

          if (built.grid.length > maxCombinations) {
            sendJson(res, 400, {
              ok:false,
              error:
                `Zu viele Kombinationen: ${built.grid.length}. ` +
                `Maximal erlaubt: ${maxCombinations}. TF-Auswahl verkleinern.`,
              combinations: built.grid.length,
            });
            return true;
          }

          const id =
            `mtf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

          const job = {
            id,
            symbol,
            interval,
            candles,
            requested_limit: limit,
            grid: built.grid,
            options: built.options,
            fixed_params: fixedParams,
            min_trades: Math.max(
              5,
              Math.floor(finite(body?.min_trades, 20))
            ),
            next: 0,
            top: [],
            status: "WAITING",
            running: false,
            created_at: berlinNowIso(),
            started_at: null,
            finished_at: null,
            error: null,
          };

          multiTfOptimizationJobs.set(id, job);
          await persistMultiTfJob(job);

          setTimeout(() => {
            runMultiTfOptimizer(job).catch((error) => {
              console.error("[MULTI-TF OPTIMIZER]", error);
            });
          }, 0);

          sendJson(res, 200, {
            ok:true,
            lab_only:true,
            closed_htf:true,
            job: publicMultiTfJob(job),
          });
          return true;
        }

        if (
          req.method === "GET" &&
          url.pathname === "/qmomentum/multi-tf-optimize/status"
        ) {
          const requestedId = String(
            url.searchParams.get("job_id") || ""
          ).trim();

          let job = requestedId
            ? multiTfOptimizationJobs.get(requestedId)
            : null;

          if (job) {
            sendJson(res, 200, {
              ok:true,
              lab_only:true,
              closed_htf:true,
              job: publicMultiTfJob(job),
            });
            return true;
          }

          const row = requestedId
            ? await db.get(
                `SELECT * FROM multi_tf_optimizer_runs WHERE id=?`,
                [requestedId]
              )
            : await db.get(
                `SELECT * FROM multi_tf_optimizer_runs
                  ORDER BY created_at DESC LIMIT 1`
              );

          sendJson(res, 200, {
            ok:true,
            lab_only:true,
            closed_htf:true,
            job: row ? {
              id: row.id,
              symbol: row.symbol,
              interval: row.interval,
              status: row.status,
              total: Number(row.total || 0),
              processed: Number(row.processed || 0),
              progress_pct: Number(row.progress || 0),
              min_trades: Number(row.min_trades || 0),
              options: row.options_json
                ? JSON.parse(row.options_json)
                : null,
              fixed_params: row.fixed_params_json
                ? JSON.parse(row.fixed_params_json)
                : null,
              top: row.top_json ? JSON.parse(row.top_json) : [],
              frequency: multiTfFrequencyAnalysis(
                row.top_json ? JSON.parse(row.top_json) : []
              ),
              snapshot: null,
              error: row.error || null,
              created_at: row.created_at,
              started_at: row.started_at,
              finished_at: row.finished_at,
            } : null,
          });
          return true;
        }

        if (
          req.method === "GET" &&
          url.pathname === "/qmomentum/multi-tf-optimize/history"
        ) {
          const symbol = String(
            url.searchParams.get("symbol") || ""
          ).trim().toUpperCase();
          const interval = String(
            url.searchParams.get("interval") || ""
          ).trim().toLowerCase();

          const rows = symbol && interval
            ? await db.all(
                `SELECT * FROM multi_tf_optimizer_runs
                  WHERE symbol=? AND interval=?
                  ORDER BY created_at DESC LIMIT 30`,
                [symbol, interval]
              )
            : await db.all(
                `SELECT * FROM multi_tf_optimizer_runs
                  ORDER BY created_at DESC LIMIT 30`
              );

          sendJson(res, 200, {
            ok:true,
            runs: rows.map((row) => ({
              id: row.id,
              symbol: row.symbol,
              interval: row.interval,
              status: row.status,
              total: Number(row.total || 0),
              processed: Number(row.processed || 0),
              progress_pct: Number(row.progress || 0),
              min_trades: Number(row.min_trades || 0),
              top: row.top_json ? JSON.parse(row.top_json) : [],
              created_at: row.created_at,
              finished_at: row.finished_at,
              error: row.error || null,
            })),
          });
          return true;
        }

        if (
          req.method === "POST" &&
          (
            url.pathname === "/qmomentum/multi-tf-optimize/pause" ||
            url.pathname === "/qmomentum/multi-tf-optimize/resume" ||
            url.pathname === "/qmomentum/multi-tf-optimize/cancel"
          )
        ) {
          const body = await readJsonBody(req);
          const id = String(body?.job_id || "").trim();
          const job = multiTfOptimizationJobs.get(id);

          if (!job) {
            sendJson(res, 404, {
              ok:false,
              error:"Multi-TF-Lauf nicht im Arbeitsspeicher gefunden",
            });
            return true;
          }

          if (url.pathname.endsWith("/pause")) {
            job.status = "PAUSED";
          } else if (url.pathname.endsWith("/cancel")) {
            job.status = "CANCELLED";
          } else {
            job.status = "RUNNING";
            setTimeout(() => {
              runMultiTfOptimizer(job).catch((error) => {
                console.error("[MULTI-TF OPTIMIZER RESUME]", error);
              });
            }, 0);
          }

          await persistMultiTfJob(job);
          sendJson(res, 200, {
            ok:true,
            job: publicMultiTfJob(job),
          });
          return true;
        }


        if (
          req.method === "POST" &&
          url.pathname === "/qmomentum/multi-tf-optimize/parameter-start"
        ) {
          const body = await readJsonBody(req);
          const symbol = String(body?.symbol || "").trim().toUpperCase();
          const interval = String(body?.interval || "").trim().toLowerCase();
          const parentRunId = String(body?.parent_run_id || "").trim();
          const topTfCount = Math.max(
            1,
            Math.min(10, Math.floor(finite(body?.top_tf_count, 3)))
          );

          if (!symbol || !interval) {
            sendJson(res, 400, { ok:false, error:"symbol/interval missing" });
            return true;
          }

          let parentTop = [];
          const memoryParent = parentRunId
            ? multiTfOptimizationJobs.get(parentRunId)
            : null;

          if (memoryParent) {
            parentTop = memoryParent.top || [];
          } else {
            const row = parentRunId
              ? await db.get(
                  `SELECT top_json FROM multi_tf_optimizer_runs WHERE id=?`,
                  [parentRunId]
                )
              : await db.get(
                  `SELECT top_json FROM multi_tf_optimizer_runs
                    WHERE symbol=? AND interval=?
                    ORDER BY created_at DESC LIMIT 1`,
                  [symbol, interval]
                );
            parentTop = row?.top_json ? JSON.parse(row.top_json) : [];
          }

          if (!parentTop.length) {
            sendJson(res, 400, {
              ok:false,
              error:"Keine TF-Ergebnisse für Phase 2 vorhanden",
            });
            return true;
          }

          const tfRows = [];
          const tfKeys = new Set();
          for (const row of parentTop) {
            const tfRow = {
              macd_tf: String(row?.params?.macd_tf || interval),
              rsi_tf: String(row?.params?.rsi_tf || interval),
              chaikin_tf: String(row?.params?.chaikin_tf || interval),
              ad_tf: String(row?.params?.ad_tf || interval),
            };
            const key = JSON.stringify(tfRow);
            if (tfKeys.has(key)) continue;
            tfKeys.add(key);
            tfRows.push(tfRow);
            if (tfRows.length >= topTfCount) break;
          }

          const raw = body?.params || {};
          const fixedParams = {
            ...raw,
            strategy_mode: ["basis","basis_ad","basis_chaikin"].includes(
              String(raw.strategy_mode || "basis")
            ) ? String(raw.strategy_mode) : "basis",
            trend_filter_mode: ["none","ad","chaikin"].includes(
              String(raw.trend_filter_mode || "none")
            ) ? String(raw.trend_filter_mode) : "none",
          };

          const built = buildMultiTfParameterGrid(body, fixedParams, tfRows);
          const maxCombinations = Math.max(
            100,
            Math.min(100000, Math.floor(finite(body?.max_combinations, 50000)))
          );

          if (built.grid.length > maxCombinations) {
            sendJson(res, 400, {
              ok:false,
              error:
                `Phase 2 erzeugt ${built.grid.length} Kombinationen. ` +
                `Maximal erlaubt: ${maxCombinations}. Weniger TF-Sieger verwenden.`,
              combinations: built.grid.length,
            });
            return true;
          }

          const parameterLimit = Math.max(
            500,
            Math.min(10000, Math.floor(finite(body?.limit, 5000)))
          );
          const candles = await getStoredCandles(
            symbol,
            interval,
            parameterLimit
          );

          if (!Array.isArray(candles) || candles.length < 300) {
            sendJson(res, 400, {
              ok:false,
              error:"Mindestens 300 Kerzen erforderlich",
            });
            return true;
          }

          const id =
            `mtfp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const job = {
            id,
            parent_run_id: parentRunId || null,
            symbol,
            interval,
            candles,
            requested_limit: parameterLimit,
            grid: built.grid,
            ranges: built.ranges,
            tf_rows: tfRows,
            fixed_params: fixedParams,
            min_trades: Math.max(5, Math.floor(finite(body?.min_trades, 20))),
            next: 0,
            top: [],
            status: "WAITING",
            running: false,
            created_at: berlinNowIso(),
            started_at: null,
            finished_at: null,
            error: null,
          };

          multiTfParameterJobs.set(id, job);
          await persistParameterJob(job);
          setTimeout(() => {
            runParameterOptimizer(job).catch((error) => {
              console.error("[MULTI-TF PARAMETER OPTIMIZER]", error);
            });
          }, 0);

          sendJson(res, 200, {
            ok:true,
            lab_only:true,
            phase:2,
            job: publicParameterJob(job),
          });
          return true;
        }

        if (
          req.method === "GET" &&
          url.pathname === "/qmomentum/multi-tf-optimize/parameter-status"
        ) {
          const id = String(url.searchParams.get("job_id") || "").trim();
          const memoryJob = id ? multiTfParameterJobs.get(id) : null;
          if (memoryJob) {
            sendJson(res, 200, {
              ok:true,
              lab_only:true,
              phase:2,
              job: publicParameterJob(memoryJob),
            });
            return true;
          }

          const row = id
            ? await db.get(`SELECT * FROM multi_tf_parameter_runs WHERE id=?`, [id])
            : await db.get(
                `SELECT * FROM multi_tf_parameter_runs
                  ORDER BY created_at DESC LIMIT 1`
              );

          sendJson(res, 200, {
            ok:true,
            lab_only:true,
            phase:2,
            job: row ? {
              id: row.id,
              parent_run_id: row.parent_run_id,
              symbol: row.symbol,
              interval: row.interval,
              status: row.status,
              total: Number(row.total || 0),
              processed: Number(row.processed || 0),
              progress_pct: Number(row.progress || 0),
              min_trades: Number(row.min_trades || 0),
              tf_count: row.tf_rows_json
                ? JSON.parse(row.tf_rows_json).length
                : 0,
              ranges: row.ranges_json ? JSON.parse(row.ranges_json) : {},
              top: row.top_json ? JSON.parse(row.top_json) : [],
              error: row.error || null,
              created_at: row.created_at,
              started_at: row.started_at,
              finished_at: row.finished_at,
            } : null,
          });
          return true;
        }

        if (
          req.method === "POST" &&
          (
            url.pathname === "/qmomentum/multi-tf-optimize/parameter-pause" ||
            url.pathname === "/qmomentum/multi-tf-optimize/parameter-resume" ||
            url.pathname === "/qmomentum/multi-tf-optimize/parameter-cancel"
          )
        ) {
          const body = await readJsonBody(req);
          const id = String(body?.job_id || "").trim();
          const job = multiTfParameterJobs.get(id);
          if (!job) {
            sendJson(res, 404, {
              ok:false,
              error:"Parameterlauf nicht im Arbeitsspeicher gefunden",
            });
            return true;
          }

          if (url.pathname.endsWith("/parameter-pause")) {
            job.status = "PAUSED";
          } else if (url.pathname.endsWith("/parameter-cancel")) {
            job.status = "CANCELLED";
          } else {
            job.status = "RUNNING";
            setTimeout(() => {
              runParameterOptimizer(job).catch((error) => {
                console.error("[PARAMETER OPTIMIZER RESUME]", error);
              });
            }, 0);
          }

          await persistParameterJob(job);
          sendJson(res, 200, { ok:true, job: publicParameterJob(job) });
          return true;
        }

        sendJson(res, 404, {
          ok:false,
          error:"Multi-TF-Optimizer-Route nicht gefunden",
        });
        return true;
      } catch (error) {
        sendJson(res, 500, {
          ok:false,
          error:String(error?.stack || error?.message || error),
        });
        return true;
      }
    }



    if (url.pathname.startsWith("/qmomentum/exit-lab/optimize")) {
      try {
        if (
          req.method === "POST" &&
          url.pathname === "/qmomentum/exit-lab/optimize/start"
        ) {
          const body = await readJsonBody(req);
          const symbol = String(body?.symbol || "").trim().toUpperCase();
          const interval = String(body?.interval || "").trim().toLowerCase();
          const family = String(body?.family || "").trim().toLowerCase();

          if (
            !symbol ||
            !interval ||
            !["macd", "rsi", "chaikin", "ad"].includes(family)
          ) {
            sendJson(res, 400, {
              ok:false,
              error:"symbol, interval oder Exitfamilie ungültig",
            });
            return true;
          }

          const raw = body?.params || {};
          const baseParams = {
            ...raw,
            interval,
            activation_time_ms: 0,
          };

          const limit = Math.max(
            500,
            Math.min(10000, Math.floor(finite(body?.limit, 5000)))
          );
          const candles = await getStoredCandles(symbol, interval, limit);

          if (!Array.isArray(candles) || candles.length < 300) {
            sendJson(res, 400, {
              ok:false,
              error:"Mindestens 300 Kerzen erforderlich",
            });
            return true;
          }

          const baseSeries = buildMultiTimeframeExtremeSeries(
            candles,
            baseParams
          );
          const baseReplay = simulateExtremeMacd(
            candles,
            baseSeries,
            baseParams,
            true
          );
          const baseEvents = Array.isArray(baseReplay.events)
            ? baseReplay.events
            : [];
          const entries = baseEvents.filter(
            (event) => event.type === "entry"
          );
          const currentExits = baseEvents.filter(
            (event) => event.type === "exit"
          );

          if (entries.length < 5) {
            sendJson(res, 400, {
              ok:false,
              error:`Zu wenige eingefrorene Entries: ${entries.length}`,
            });
            return true;
          }

          const grid = buildExitFamilyGrid(
            family,
            baseParams,
            interval,
            body
          );
          const maximum = Math.max(
            100,
            Math.min(
              50000,
              Math.floor(finite(body?.max_combinations, 20000))
            )
          );

          if (grid.length > maximum) {
            sendJson(res, 400, {
              ok:false,
              error:
                `Zu viele Kombinationen: ${grid.length}. ` +
                `Maximal erlaubt: ${maximum}.`,
            });
            return true;
          }

          const id =
            `exit_${family}_${Date.now()}_` +
            Math.random().toString(36).slice(2, 8);

          const job = {
            id,
            family,
            symbol,
            interval,
            candles,
            base_params: baseParams,
            entries,
            current_exits: currentExits,
            grid,
            next: 0,
            top: [],
            minimum_trades: Math.max(
              5,
              Math.floor(finite(body?.minimum_trades, 20))
            ),
            status: "WAITING",
            running: false,
            error: null,
            created_at: berlinNowIso(),
            started_at: null,
            finished_at: null,
          };

          exitFamilyOptimizationJobs.set(id, job);

          setTimeout(() => {
            runExitFamilyOptimizer(job).catch((error) => {
              console.error("[EXIT FAMILY OPTIMIZER]", error);
            });
          }, 0);

          sendJson(res, 200, {
            ok:true,
            lab_only:true,
            frozen_entries:true,
            job: publicExitOptimizationJob(job),
          });
          return true;
        }

        if (
          req.method === "GET" &&
          url.pathname === "/qmomentum/exit-lab/optimize/status"
        ) {
          const id = String(
            url.searchParams.get("job_id") || ""
          ).trim();
          const job = id
            ? exitFamilyOptimizationJobs.get(id)
            : null;

          sendJson(res, 200, {
            ok:true,
            lab_only:true,
            job: job ? publicExitOptimizationJob(job) : null,
          });
          return true;
        }

        if (
          req.method === "POST" &&
          (
            url.pathname === "/qmomentum/exit-lab/optimize/pause" ||
            url.pathname === "/qmomentum/exit-lab/optimize/resume" ||
            url.pathname === "/qmomentum/exit-lab/optimize/cancel"
          )
        ) {
          const body = await readJsonBody(req);
          const id = String(body?.job_id || "").trim();
          const job = exitFamilyOptimizationJobs.get(id);

          if (!job) {
            sendJson(res, 404, {
              ok:false,
              error:"Exit-Optimizer-Lauf nicht gefunden",
            });
            return true;
          }

          if (url.pathname.endsWith("/pause")) {
            job.status = "PAUSED";
          } else if (url.pathname.endsWith("/cancel")) {
            job.status = "CANCELLED";
          } else {
            job.status = "RUNNING";
            setTimeout(() => {
              runExitFamilyOptimizer(job).catch((error) => {
                console.error("[EXIT OPTIMIZER RESUME]", error);
              });
            }, 0);
          }

          sendJson(res, 200, {
            ok:true,
            job: publicExitOptimizationJob(job),
          });
          return true;
        }

        sendJson(res, 404, {
          ok:false,
          error:"Exit-Optimizer-Route nicht gefunden",
        });
        return true;
      } catch (error) {
        sendJson(res, 500, {
          ok:false,
          error:String(error?.stack || error?.message || error),
        });
        return true;
      }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/exit-lab/preview") {
      try {
        const body = await readJsonBody(req);
        const symbol = String(body?.symbol || "").trim().toUpperCase();
        const interval = String(body?.interval || "").trim().toLowerCase();

        if (!symbol || !interval) {
          sendJson(res, 400, {
            ok:false,
            error:"symbol/interval missing",
          });
          return true;
        }

        const raw = body?.params || {};
        const params = {
          macd_fast: Math.max(1, Math.floor(finite(raw.macd_fast, 10))),
          macd_slow: Math.max(2, Math.floor(finite(raw.macd_slow, 20))),
          macd_signal: Math.max(1, Math.floor(finite(raw.macd_signal, 9))),
          rsi_length: Math.max(2, Math.floor(finite(raw.rsi_length, 14))),
          rsi_signal: Math.max(1, Math.floor(finite(raw.rsi_signal, 9))),
          long_zone_sigma: Math.min(-0.1, finite(raw.long_zone_sigma, -1.5)),
          short_zone_sigma: Math.max(0.1, finite(raw.short_zone_sigma, 1.5)),
          z_window: Math.max(30, Math.floor(finite(raw.z_window, 200))),
          protect_min_hold_bars: Math.max(
            1,
            Math.floor(finite(raw.protect_min_hold_bars, 3))
          ),
          exit_htf_minutes: Math.max(
            intervalToMinutes(interval),
            Math.floor(finite(raw.exit_htf_minutes, 60))
          ),
          exit_timing_minutes: Math.max(
            intervalToMinutes(interval),
            Math.floor(finite(
              raw.exit_timing_minutes,
              intervalToMinutes(interval)
            ))
          ),
          exit_rsi_lower: Math.max(
            1,
            Math.min(49, finite(raw.exit_rsi_lower, 30))
          ),
          exit_rsi_upper: Math.max(
            51,
            Math.min(99, finite(raw.exit_rsi_upper, 70))
          ),
          strategy_mode: ["basis","basis_ad","basis_chaikin"].includes(
            String(raw.strategy_mode || "basis")
          ) ? String(raw.strategy_mode) : "basis",
          trend_filter_mode: ["none","ad","chaikin"].includes(
            String(raw.trend_filter_mode || "none")
          ) ? String(raw.trend_filter_mode) : "none",
          trend_sigma_abs: Math.max(
            0,
            Math.min(2, finite(raw.trend_sigma_abs, 0))
          ),
          ad_length: Math.max(
            2,
            Math.min(50, Math.floor(finite(raw.ad_length, 11)))
          ),
          chaikin_fast: Math.max(
            1,
            Math.min(20, Math.floor(finite(raw.chaikin_fast, 3)))
          ),
          chaikin_slow: Math.max(
            2,
            Math.min(60, Math.floor(finite(raw.chaikin_slow, 10)))
          ),
          macd_tf: String(raw.macd_tf || interval).trim().toLowerCase(),
          rsi_tf: String(raw.rsi_tf || interval).trim().toLowerCase(),
          ad_tf: String(raw.ad_tf || interval).trim().toLowerCase(),
          chaikin_tf: String(raw.chaikin_tf || interval).trim().toLowerCase(),
          activation_time_ms: 0,
          interval,
        };

        if (params.macd_slow <= params.macd_fast) {
          params.macd_slow = params.macd_fast + 2;
        }
        if (params.chaikin_slow <= params.chaikin_fast) {
          params.chaikin_slow = params.chaikin_fast + 1;
        }

        const limit = Math.max(
          300,
          Math.min(10000, Math.floor(finite(body?.limit, 5000)))
        );
        const candles = await getStoredCandles(symbol, interval, limit);

        if (!Array.isArray(candles) || candles.length < 100) {
          sendJson(res, 400, {
            ok:false,
            error:"Nicht genügend Kerzen für Exit Lab",
          });
          return true;
        }

        const series = buildMultiTimeframeExtremeSeries(candles, params);
        const replay = simulateExtremeMacd(candles, series, params, true);
        const events = Array.isArray(replay.events) ? replay.events : [];
        const entries = events.filter((event) => event.type === "entry");
        const currentExits = events.filter((event) => event.type === "exit");
        const minHoldBars = Math.max(
          1,
          Math.floor(finite(body?.min_hold_bars, params.protect_min_hold_bars))
        );

        const families = {};
        for (const family of [
          "current",
          "macd",
          "rsi",
          "chaikin",
          "ad",
          "combo",
        ]) {
          families[family] = evaluateFrozenExitFamily({
            candles,
            series,
            entryEvents: entries,
            currentExitEvents: currentExits,
            family,
            minHoldBars,
          });
        }

        sendJson(res, 200, {
          ok:true,
          lab_only:true,
          frozen_entries:true,
          no_live_activation:true,
          symbol,
          interval,
          params,
          candle_count: candles.length,
          start_time: Number(candles[0]?.time || 0),
          end_time: Number(candles[candles.length - 1]?.time || 0),
          candles,
          indicators: series,
          entries,
          current_exits: currentExits,
          families,
        });
        return true;
      } catch (error) {
        sendJson(res, 500, {
          ok:false,
          error:String(error?.stack || error?.message || error),
        });
        return true;
      }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/profile-lab/preview") {
      try {
        const body = await readJsonBody(req);
        const symbol = String(body?.symbol || "").trim().toUpperCase();
        const interval = String(body?.interval || "").trim().toLowerCase();
        if (!symbol || !interval) {
          sendJson(res, 400, { ok:false, error:"symbol/interval missing" });
          return true;
        }

        const raw = body?.params || {};
        const params = {
          macd_fast: Math.max(1, Math.floor(finite(raw.macd_fast, 10))),
          macd_slow: Math.max(2, Math.floor(finite(raw.macd_slow, 20))),
          macd_signal: Math.max(1, Math.floor(finite(raw.macd_signal, 9))),
          rsi_length: Math.max(2, Math.floor(finite(raw.rsi_length, 14))),
          rsi_signal: Math.max(1, Math.floor(finite(raw.rsi_signal, 9))),
          long_zone_sigma: Math.min(-0.1, finite(raw.long_zone_sigma, -1.5)),
          short_zone_sigma: Math.max(0.1, finite(raw.short_zone_sigma, 1.5)),
          z_window: Math.max(30, Math.floor(finite(raw.z_window, 200))),
          protect_min_hold_bars: Math.max(1, Math.floor(finite(raw.protect_min_hold_bars, 3))),
          exit_htf_minutes: Math.max(
            intervalToMinutes(interval),
            Math.floor(finite(raw.exit_htf_minutes, 60))
          ),
          exit_timing_minutes: Math.max(
            intervalToMinutes(interval),
            Math.floor(finite(raw.exit_timing_minutes, intervalToMinutes(interval)))
          ),
          exit_rsi_lower: Math.max(1, Math.min(49, finite(raw.exit_rsi_lower, 30))),
          exit_rsi_upper: Math.max(51, Math.min(99, finite(raw.exit_rsi_upper, 70))),
          strategy_mode: ["basis","basis_ad","basis_chaikin"].includes(String(raw.strategy_mode || "basis"))
            ? String(raw.strategy_mode)
            : "basis",
          trend_filter_mode: ["none","ad","chaikin"].includes(String(raw.trend_filter_mode || "none"))
            ? String(raw.trend_filter_mode)
            : "none",
          trend_sigma_abs: Math.max(0, Math.min(2, finite(raw.trend_sigma_abs, 0))),
          ad_length: Math.max(2, Math.min(50, Math.floor(finite(raw.ad_length, 11)))),
          chaikin_fast: Math.max(1, Math.min(20, Math.floor(finite(raw.chaikin_fast, 3)))),
          chaikin_slow: Math.max(2, Math.min(60, Math.floor(finite(raw.chaikin_slow, 10)))),
          macd_tf: String(raw.macd_tf || interval).trim().toLowerCase(),
          rsi_tf: String(raw.rsi_tf || interval).trim().toLowerCase(),
          ad_tf: String(raw.ad_tf || interval).trim().toLowerCase(),
          chaikin_tf: String(raw.chaikin_tf || interval).trim().toLowerCase(),
          activation_time_ms: 0,
          interval,
        };

        if (params.macd_slow <= params.macd_fast) {
          params.macd_slow = params.macd_fast + 2;
        }
        if (params.chaikin_slow <= params.chaikin_fast) {
          params.chaikin_slow = params.chaikin_fast + 1;
        }

        const requestedSnapshot =
          body?.snapshot && typeof body.snapshot === "object"
            ? body.snapshot
            : null;
        const limit = Math.max(
          200,
          Math.min(
            10000,
            Math.floor(
              finite(
                requestedSnapshot?.requested_limit ??
                  requestedSnapshot?.candle_count ??
                  body?.limit,
                1500
              )
            )
          )
        );

        let candles = await getStoredCandles(
          symbol,
          interval,
          requestedSnapshot?.end_time ? 10000 : limit
        );

        if (requestedSnapshot?.end_time && Array.isArray(candles)) {
          const endTime = Number(requestedSnapshot.end_time);
          const wantedCount = Math.max(
            80,
            Math.floor(
              finite(requestedSnapshot.candle_count, limit)
            )
          );
          candles = candles
            .filter((candle) => Number(candle.time) <= endTime)
            .slice(-wantedCount);
        }

        if (!Array.isArray(candles) || candles.length < 80) {
          sendJson(res, 400, { ok:false, error:"Nicht genügend Kerzen für Vorschau" });
          return true;
        }

        const series = buildMultiTimeframeExtremeSeries(candles, params);
        const replay = simulateExtremeMacd(candles, series, params, true);

        const baselineParams = {
          ...params,
          macd_tf: interval,
          rsi_tf: interval,
          ad_tf: interval,
          chaikin_tf: interval,
        };
        const baselineSeries = buildMultiTimeframeExtremeSeries(
          candles,
          baselineParams
        );
        const baselineReplay = simulateExtremeMacd(
          candles,
          baselineSeries,
          baselineParams,
          true
        );

        const metricsFromReplay = (row) => ({
          trades: Number(row.trades || 0),
          profit_factor: Number(row.profit_factor || 0),
          net: Number(row.net || 0),
          max_drawdown: Number(row.max_drawdown || 0),
          win_rate_pct: Number(row.win_rate_pct || 0),
        });

        const previewMetrics = metricsFromReplay(replay);
        const previewSnapshot = buildOptimizerSnapshot({
          runId: requestedSnapshot?.run_id || null,
          parentRunId: requestedSnapshot?.parent_run_id || null,
          phase: requestedSnapshot?.phase || 0,
          symbol,
          interval,
          candles,
          requestedLimit: limit,
          params,
          metrics: previewMetrics,
        });

        sendJson(res, 200, {
          ok:true,
          temporary:true,
          persisted:false,
          activated:false,
          multi_tf_lab_only:true,
          closed_htf:true,
          symbol,
          interval,
          params,
          candles,
          indicators: series,
          events: replay.events || [],
          metrics: previewMetrics,
          reproduction_snapshot: previewSnapshot,
          requested_snapshot: requestedSnapshot,
          comparison: {
            baseline: {
              label: "A · ALLES CHART-TF",
              params: baselineParams,
              indicators: baselineSeries,
              events: baselineReplay.events || [],
              metrics: metricsFromReplay(baselineReplay),
            },
            multi_tf: {
              label: "B · MULTI-TF",
              params,
              indicators: series,
              events: replay.events || [],
              metrics: metricsFromReplay(replay),
            },
          },
          final_state: replay.final_state || null,
          mirror_meta: {
            start_time: Number(candles[0]?.time || 0),
            end_time: Number(candles[candles.length - 1]?.time || 0),
            candle_count: candles.length,
          },
        });
        return true;
      } catch (error) {
        sendJson(res, 500, {
          ok:false,
          error:String(error?.message || error),
        });
        return true;
      }
    }

    if (req.method === "GET" && url.pathname === "/qmomentum/extreme-profiles") {
      try {
        const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
        const interval = String(url.searchParams.get("interval") || "").trim().toLowerCase();
        const clauses = []; const args = [];
        if (symbol) { clauses.push("symbol=?"); args.push(symbol); }
        if (interval) { clauses.push("interval=?"); args.push(interval); }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const rows = await db.all(`SELECT id,symbol,interval,name,params_json,result_json,note,created_at,updated_at FROM extreme_profile_snapshots ${where} ORDER BY updated_at DESC`, args);
        const active = symbol && interval ? await db.get(`SELECT params_json,updated_at FROM extreme_live_profiles WHERE symbol=? AND interval=?`, [symbol, interval]) : null;
        sendJson(res, 200, { ok:true, profiles: rows.map(row => ({ ...row, params: JSON.parse(row.params_json), result: row.result_json ? JSON.parse(row.result_json) : null, params_json:undefined, result_json:undefined })), active_params: active ? JSON.parse(active.params_json) : null, active_updated_at: active?.updated_at || null });
        return true;
      } catch (error) { sendJson(res, 500, { ok:false, error:String(error?.message || error) }); return true; }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/extreme-profiles") {
      try {
        const body = await readJsonBody(req);
        const symbol = String(body?.symbol || "").trim().toUpperCase();
        const interval = String(body?.interval || "").trim().toLowerCase();
        const name = String(body?.name || "Profil").trim().slice(0, 100) || "Profil";
        if (!symbol || !interval) { sendJson(res,400,{ok:false,error:"symbol/interval missing"}); return true; }
        const raw = body?.params || {};
        const params = {
          macd_fast: Math.max(1, Math.floor(finite(raw.macd_fast, 10))), macd_slow: Math.max(2, Math.floor(finite(raw.macd_slow, 20))), macd_signal:9,
          rsi_length: Math.max(2, Math.floor(finite(raw.rsi_length,14))), rsi_signal:9,
          long_zone_sigma: Math.min(-0.1, finite(raw.long_zone_sigma,-1.5)), short_zone_sigma: Math.max(0.1,finite(raw.short_zone_sigma,1.5)),
          z_window: Math.max(30,Math.floor(finite(raw.z_window,200))), protect_min_hold_bars:Math.max(1,Math.floor(finite(raw.protect_min_hold_bars,3))),
          exit_htf_minutes:Math.max(intervalToMinutes(interval),Math.floor(finite(raw.exit_htf_minutes,60))),
          exit_timing_minutes:Math.max(intervalToMinutes(interval),Math.floor(finite(raw.exit_timing_minutes,intervalToMinutes(interval)))),
          exit_rsi_lower:Math.max(1,Math.min(49,finite(raw.exit_rsi_lower,30))), exit_rsi_upper:Math.max(51,Math.min(99,finite(raw.exit_rsi_upper,70))),
          strategy_mode:["basis","basis_ad","basis_chaikin"].includes(String(raw.strategy_mode||"basis"))?String(raw.strategy_mode):"basis",
          trend_filter_mode:["ad","chaikin"].includes(String(raw.trend_filter_mode||"none"))?String(raw.trend_filter_mode):"none",
          trend_sigma_abs:Math.max(0,Math.min(2,finite(raw.trend_sigma_abs,0))),
          ad_length:Math.max(2,Math.min(50,Math.floor(finite(raw.ad_length,11)))),
          chaikin_fast:Math.max(1,Math.min(20,Math.floor(finite(raw.chaikin_fast,3)))),
          chaikin_slow:Math.max(2,Math.min(60,Math.floor(finite(raw.chaikin_slow,10)))),
          activation_time_ms:Math.max(0,Math.floor(finite(raw.activation_time_ms,Date.now())))
        };
        if (params.macd_slow <= params.macd_fast) params.macd_slow = params.macd_fast + 2;
        if (params.chaikin_slow <= params.chaikin_fast) params.chaikin_slow = params.chaikin_fast + 1;
        const id = String(body?.id || `${symbol}_${interval}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`);
        await db.run(`INSERT INTO extreme_profile_snapshots(id,symbol,interval,name,params_json,result_json,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,datetime('now','localtime'),datetime('now','localtime')) ON CONFLICT(id) DO UPDATE SET name=excluded.name,params_json=excluded.params_json,result_json=excluded.result_json,note=excluded.note,updated_at=datetime('now','localtime')`, [id,symbol,interval,name,JSON.stringify(params),body?.result ? JSON.stringify(body.result) : null,String(body?.note || "")]);
        if (body?.activate !== false) {
          const activeParams = { ...params, activation_time_ms: Date.now() };
          await db.run(`INSERT INTO extreme_live_profiles(symbol,interval,params_json,updated_at) VALUES(?,?,?,datetime('now','localtime')) ON CONFLICT(symbol,interval) DO UPDATE SET params_json=excluded.params_json,updated_at=datetime('now','localtime')`, [symbol,interval,JSON.stringify(activeParams)]);
        }
        sendJson(res,200,{ok:true,id,symbol,interval,name,params,active:body?.activate !== false}); return true;
      } catch(error){ sendJson(res,500,{ok:false,error:String(error?.message||error)}); return true; }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/extreme-profiles/activate") {
      try { const body=await readJsonBody(req); const id=String(body?.id||""); const row=await db.get(`SELECT * FROM extreme_profile_snapshots WHERE id=?`,[id]); if(!row){sendJson(res,404,{ok:false,error:"Profil nicht gefunden"});return true;} const activatedParams={...JSON.parse(row.params_json),activation_time_ms:Date.now()}; await db.run(`INSERT INTO extreme_live_profiles(symbol,interval,params_json,updated_at) VALUES(?,?,?,datetime('now','localtime')) ON CONFLICT(symbol,interval) DO UPDATE SET params_json=excluded.params_json,updated_at=datetime('now','localtime')`,[row.symbol,row.interval,JSON.stringify(activatedParams)]); sendJson(res,200,{ok:true,profile:{id:row.id,symbol:row.symbol,interval:row.interval,name:row.name,params:activatedParams,result:row.result_json?JSON.parse(row.result_json):null}}); return true; } catch(error){sendJson(res,500,{ok:false,error:String(error?.message||error)});return true;}
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/extreme-profiles/delete") {
      try { const body=await readJsonBody(req); const id=String(body?.id||""); await db.run(`DELETE FROM extreme_profile_snapshots WHERE id=?`,[id]); sendJson(res,200,{ok:true,id}); return true; } catch(error){sendJson(res,500,{ok:false,error:String(error?.message||error)});return true;}
    }

    if (req.method === "GET" && url.pathname === "/qmomentum/extreme-live/mirror") {
      try {
        const id = String(url.searchParams.get("id") || "").trim();
        if (!id) { sendJson(res, 400, { ok:false, error:"profile id missing" }); return true; }
        const row = await db.get(`SELECT id,symbol,interval,name,params_json,result_json,created_at,updated_at FROM extreme_profile_snapshots WHERE id=?`, [id]);
        if (!row) { sendJson(res, 404, { ok:false, error:"Profil nicht gefunden" }); return true; }
        const params = JSON.parse(row.params_json);
        const result = row.result_json ? JSON.parse(row.result_json) : null;
        const meta = result?.mirror_meta || {};
        let candles = await getStoredCandles(row.symbol, row.interval, 5000);
        const startTime = Number(meta.start_time || 0);
        const endTime = Number(meta.end_time || 0);
        if (startTime > 0 && endTime >= startTime) candles = candles.filter(c => Number(c.time) >= startTime && Number(c.time) <= endTime);
        if (!Array.isArray(candles) || candles.length < 80) { sendJson(res, 400, {ok:false,error:"Nicht genügend Kerzen für Profilzeitraum"}); return true; }
        const series = buildExtremeMacdSeries(candles, params);
        const replay = simulateExtremeMacd(candles, series, params, true);
        const labMetrics = result?.best?.metrics || null;
        const labEvents = Array.isArray(labMetrics?.events) ? labMetrics.events.filter(e => e.type === "entry" || e.type === "exit") : [];
        const replayEvents = Array.isArray(replay?.events) ? replay.events.filter(e => e.type === "entry" || e.type === "exit") : [];
        const eventKey = e => `${e.type}|${String(e.direction||"")}|${Number(e.time)}`;
        const labKeys = labEvents.map(eventKey);
        const replayKeys = replayEvents.map(eventKey);
        const markerMatch = labKeys.length > 0 && labKeys.length === replayKeys.length && labKeys.every((key, index) => key === replayKeys[index]);
        const close = (a,b,tol=1e-6) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a)-Number(b)) <= tol;
        const profileMetrics = labMetrics ? { trades:Number(labMetrics.trades||0), profit_factor:Number(labMetrics.profit_factor||0), net:Number(labMetrics.net||0), max_drawdown:Number(labMetrics.max_drawdown||0) } : null;
        const replayMetrics = { trades:Number(replay.trades||0), profit_factor:Number(replay.profit_factor||0), net:Number(replay.net||0), max_drawdown:Number(replay.max_drawdown||0) };
        const tradesMatch = profileMetrics ? profileMetrics.trades === replayMetrics.trades : false;
        const pfMatch = profileMetrics ? close(profileMetrics.profit_factor, replayMetrics.profit_factor, 0.005) : false;
        const netMatch = profileMetrics ? close(profileMetrics.net, replayMetrics.net, 0.01) : false;
        const ddMatch = profileMetrics ? close(profileMetrics.max_drawdown, replayMetrics.max_drawdown, 0.01) : false;
        const expectedCount = Number(meta.candle_count || result?.candle_count || 0);
        const candlesMatch = expectedCount > 0 ? expectedCount === candles.length : false;
        sendJson(res, 200, {
          ok:true,
          profile:{ id:row.id,name:row.name,symbol:row.symbol,interval:row.interval,params,metrics:profileMetrics,range:{start_time:startTime||Number(candles[0]?.time||0),end_time:endTime||Number(candles[candles.length-1]?.time||0),candle_count:expectedCount||candles.length}},
          replay:{ metrics:replayMetrics,range:{start_time:Number(candles[0]?.time||0),end_time:Number(candles[candles.length-1]?.time||0),candle_count:candles.length},entry_count:replayEvents.filter(e=>e.type==="entry").length,exit_count:replayEvents.filter(e=>e.type==="exit").length },
          compare:{ candles_match:candlesMatch,trades_match:tradesMatch,pf_match:pfMatch,net_match:netMatch,drawdown_match:ddMatch,markers_match:markerMatch,profile_entry_count:labEvents.filter(e=>e.type==="entry").length,profile_exit_count:labEvents.filter(e=>e.type==="exit").length,replay_entry_count:replayEvents.filter(e=>e.type==="entry").length,replay_exit_count:replayEvents.filter(e=>e.type==="exit").length,identical:Boolean(candlesMatch&&tradesMatch&&pfMatch&&netMatch&&ddMatch&&markerMatch) }
        });
        return true;
      } catch (error) { sendJson(res,500,{ok:false,error:String(error?.message||error)}); return true; }
    }

    if (req.method === "GET" && url.pathname === "/qmomentum/extreme-live/profile") {
      try {
        const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
        const interval = String(url.searchParams.get("interval") || "").trim().toLowerCase();
        if (!symbol || !interval) {
          sendJson(res, 400, { ok: false, error: "symbol/interval missing" });
          return true;
        }
        const row = await db.get(`SELECT params_json,updated_at FROM extreme_live_profiles WHERE symbol=? AND interval=?`, [symbol, interval]);
        const defaults = {
          macd_fast: 10, macd_slow: 20, macd_signal: 9,
          rsi_length: 14, rsi_signal: 9,
          long_zone_sigma: -1.5, short_zone_sigma: 1.5,
          z_window: 200, protect_min_hold_bars: 3,
          exit_htf_minutes: Math.max(30, intervalToMinutes(interval) * 4),
          exit_timing_minutes: Math.max(15, intervalToMinutes(interval)),
          exit_rsi_lower: 30, exit_rsi_upper: 70,
          strategy_mode: "basis", trend_filter_mode: "none",
          trend_sigma_abs: 0, ad_length: 11, chaikin_fast: 3, chaikin_slow: 10,
          activation_time_ms: 0,
        };
        sendJson(res, 200, { ok: true, symbol, interval, params: row ? { ...defaults, ...JSON.parse(row.params_json) } : defaults, updated_at: row?.updated_at || null });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }

    if (req.method === "POST" && url.pathname === "/qmomentum/extreme-live/profile") {
      try {
        const body = await readJsonBody(req);
        const symbol = String(body?.symbol || "").trim().toUpperCase();
        const interval = String(body?.interval || "").trim().toLowerCase();
        if (!symbol || !interval) {
          sendJson(res, 400, { ok: false, error: "symbol/interval missing" });
          return true;
        }
        const raw = body?.params || {};
        const params = {
          macd_fast: Math.max(1, Math.floor(finite(raw.macd_fast, 10))),
          macd_slow: Math.max(2, Math.floor(finite(raw.macd_slow, 20))),
          macd_signal: 9,
          rsi_length: Math.max(2, Math.floor(finite(raw.rsi_length, 14))),
          rsi_signal: 9,
          long_zone_sigma: Math.min(-0.1, finite(raw.long_zone_sigma, -1.5)),
          short_zone_sigma: Math.max(0.1, finite(raw.short_zone_sigma, 1.5)),
          z_window: Math.max(30, Math.floor(finite(raw.z_window, 200))),
          protect_min_hold_bars: Math.max(1, Math.floor(finite(raw.protect_min_hold_bars, 3))),
          exit_htf_minutes: Math.max(intervalToMinutes(interval), Math.floor(finite(raw.exit_htf_minutes, 60))),
          exit_timing_minutes: Math.max(intervalToMinutes(interval), Math.floor(finite(raw.exit_timing_minutes, intervalToMinutes(interval)))),
          exit_rsi_lower: Math.max(1, Math.min(49, finite(raw.exit_rsi_lower, 30))),
          exit_rsi_upper: Math.max(51, Math.min(99, finite(raw.exit_rsi_upper, 70))),
          strategy_mode: ["basis","basis_ad","basis_chaikin"].includes(String(raw.strategy_mode||"basis")) ? String(raw.strategy_mode) : "basis",
          trend_filter_mode: ["ad","chaikin"].includes(String(raw.trend_filter_mode||"none")) ? String(raw.trend_filter_mode) : "none",
          trend_sigma_abs: Math.max(0, Math.min(2, finite(raw.trend_sigma_abs, 0))),
          ad_length: Math.max(2, Math.min(50, Math.floor(finite(raw.ad_length, 11)))),
          chaikin_fast: Math.max(1, Math.min(20, Math.floor(finite(raw.chaikin_fast, 3)))),
          chaikin_slow: Math.max(2, Math.min(60, Math.floor(finite(raw.chaikin_slow, 10)))),
          activation_time_ms: Math.max(0, Math.floor(finite(raw.activation_time_ms, Date.now()))),
        };
        if (params.macd_slow <= params.macd_fast) params.macd_slow = params.macd_fast + 2;
        await db.run(`INSERT INTO extreme_live_profiles(symbol,interval,params_json,updated_at) VALUES(?,?,?,datetime('now','localtime')) ON CONFLICT(symbol,interval) DO UPDATE SET params_json=excluded.params_json,updated_at=datetime('now','localtime')`, [symbol, interval, JSON.stringify(params)]);
        sendJson(res, 200, { ok: true, symbol, interval, params });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }

    if (req.method === "GET" && url.pathname === "/qmomentum/extreme-live/state") {
      try {
        const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
        const interval = String(url.searchParams.get("interval") || "").trim().toLowerCase();
        const limit = Math.min(5000, Math.max(300, Number(url.searchParams.get("limit") || 1500)));
        if (!symbol || !interval) {
          sendJson(res, 400, { ok: false, error: "symbol/interval missing" });
          return true;
        }
        const row = await db.get(`SELECT params_json FROM extreme_live_profiles WHERE symbol=? AND interval=?`, [symbol, interval]);
        const defaults = {
          macd_fast: 10, macd_slow: 20, macd_signal: 9,
          rsi_length: 14, rsi_signal: 9,
          long_zone_sigma: -1.5, short_zone_sigma: 1.5,
          z_window: 200, protect_min_hold_bars: 3,
          exit_htf_minutes: Math.max(30, intervalToMinutes(interval) * 4),
          exit_timing_minutes: Math.max(15, intervalToMinutes(interval)),
          exit_rsi_lower: 30, exit_rsi_upper: 70,
          strategy_mode: "basis", trend_filter_mode: "none",
          trend_sigma_abs: 0, ad_length: 11, chaikin_fast: 3, chaikin_slow: 10,
          activation_time_ms: 0,
        };
        const params = row ? { ...defaults, ...JSON.parse(row.params_json) } : defaults;
        const candles = await getStoredCandles(symbol, interval, limit);
        if (!Array.isArray(candles) || candles.length < 80) {
          sendJson(res, 400, { ok: false, error: "not enough candles" });
          return true;
        }
        const series = buildExtremeMacdSeries(candles, params);
        const metrics = simulateExtremeMacd(candles, series, params, true);
        const last = candles.length - 1;
        const indicators = candles.map((c, i) => ({
          time: Number(c.time), macd: finite(series.macd[i]), signal: finite(series.signal[i]),
          histogram: finite(series.histogram[i]), rsi: finite(series.rsi[i], 50),
          rsi_signal: finite(series.rsiSignal[i], 50), htf_rsi: finite(series.htfRsi[i], 50),
          exit_timing_rsi: finite(series.exitTimingRsi[i], 50), z_score: finite(series.z[i]),
        }));
        const tradingEvents = metrics.events.filter((event) => event.type === "entry" || event.type === "exit");
        const activationTime = Math.max(0, Number(params.activation_time_ms || 0));
        const executionEvents = tradingEvents.filter((event) => Number(event.time || 0) * (Number(event.time||0) < 100000000000 ? 1000 : 1) >= activationTime);
        sendJson(res, 200, {
          ok: true, symbol, interval, mode: "SIGNAL_MIRROR_NO_AUTO_ORDERS", params,
          final_state: metrics.final_state,
          current: indicators[last],
          events: tradingEvents,
          execution_events: executionEvents,
          activation_time_ms: activationTime,
          indicators,
          metrics: { trades: metrics.trades, profit_factor: metrics.profit_factor, net: metrics.net, max_drawdown: metrics.max_drawdown, extreme_entry_count:metrics.extreme_entry_count||0, trend_entry_count:metrics.trend_entry_count||0, trend_filter_mode:params.trend_filter_mode||"none" },
        });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
    }

    if (req.method === "GET" && url.pathname === "/qmomentum/export") {
      const rows = await db.all(`SELECT * FROM qmomentum_annotations ORDER BY symbol,interval,time`);
      const trendRows = await db.all(`SELECT * FROM qmomentum_trend_annotations ORDER BY symbol,interval,time`);
      sendJson(res, 200, {
        ok: true, version: QMOMENTUM_VERSION,
        rows: rows.map((row) => ({ ...row, context: JSON.parse(row.context_json) })),
        trend_rows: trendRows.map((row) => ({ ...row, context: JSON.parse(row.context_json) })),
      });
      return true;
    }

    return false;
  };
}