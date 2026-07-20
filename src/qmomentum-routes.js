const QMOMENTUM_VERSION = "QMOMENTUM_TREND_FORMULA_LAB_V0_2_MEMORY_SAFE";
const CONTEXT_BARS = 20;
const MODEL_KEY = "GLOBAL_DIRECTIONAL_V1";
const TREND_MODEL_KEY = "GLOBAL_TREND_STATE_V2";

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

function evaluateFormula(candles, trendAnnotations, params, includeStates = false) {
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

  const result = {
    params,
    score: Number(score.toFixed(3)),
    accuracy_pct: Number((accuracy * 100).toFixed(2)),
    avg_switch_distance_bars: Number(avgSwitchDistance.toFixed(2)),
    switches: unnecessarySwitches,
    extra_switches: extraSwitches,
    short_islands: shortIslands,
    comparable_bars: comparable,
  };

  // Während der Optimierung werden keine tausenden vollständigen
  // Zustandsreihen im RAM gehalten. Nur die Siegerformel bekommt states.
  if (includeStates) result.states = predicted;
  return result;
}

function optimizeTrendFormula(candles, trendAnnotations) {
  // Memory-safe Top-10-Suche:
  // Jede Variante wird sofort ausgewertet. Im Speicher bleiben ausschließlich
  // die zehn besten Zusammenfassungen – niemals alle 3.072 Zustandsreihen.
  const top = [];
  let testedCount = 0;

  const emaLengths = [12, 24, 40, 60];
  const atrLengths = [7, 14, 21];
  const hysteresisValues = [0.4, 0.7, 1.0, 1.35];
  const slopeLookbacks = [3, 8];
  const momentumLookbacks = [3, 10];
  const slopeWeights = [0, 0.6];
  const momentumWeights = [0, 0.4];
  const confirmBarsValues = [1, 2];
  const minStateBarsValues = [2, 6];

  function keepTop(result) {
    top.push(result);
    top.sort((a, b) => b.score - a.score);
    if (top.length > 10) top.pop();
  }

  for (const ema_length of emaLengths)
  for (const atr_length of atrLengths)
  for (const hysteresis of hysteresisValues)
  for (const slope_lookback of slopeLookbacks)
  for (const momentum_lookback of momentumLookbacks)
  for (const slope_weight of slopeWeights)
  for (const momentum_weight of momentumWeights)
  for (const confirm_bars of confirmBarsValues)
  for (const min_state_bars of minStateBarsValues) {
    const params = {
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

    keepTop(evaluateFormula(candles, trendAnnotations, params, false));
    testedCount += 1;
  }

  // Nur für die beste Formel wird die vollständige Zustandsreihe erzeugt.
  if (top.length) {
    top[0] = evaluateFormula(candles, trendAnnotations, top[0].params, true);
  }

  top.tested_count = testedCount;
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
      feature_version TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(symbol, interval, time)
    );
    CREATE INDEX IF NOT EXISTS idx_qmomentum_symbol_tf_time ON qmomentum_annotations(symbol, interval, time);
    CREATE TABLE IF NOT EXISTS qmomentum_models (
      model_key TEXT PRIMARY KEY, model_json TEXT NOT NULL, positive_count INTEGER NOT NULL,
      negative_count INTEGER NOT NULL, trained_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS qmomentum_trend_annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL, interval TEXT NOT NULL, time INTEGER NOT NULL, price REAL NOT NULL,
      trend_start TEXT NOT NULL CHECK(trend_start IN ('up','down')), note TEXT,
      context_json TEXT NOT NULL, feature_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(symbol, interval, time)
    );
    CREATE INDEX IF NOT EXISTS idx_qmomentum_trend_symbol_tf_time
      ON qmomentum_trend_annotations(symbol, interval, time);
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

export function createQMomentumRoutes({ db, getStoredCandles, sendJson, readJsonBody }) {
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

    if (req.method === "GET" && url.pathname === "/qmomentum/formula-optimize") {
      try {
        const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
        const interval = String(url.searchParams.get("interval") || "").trim().toLowerCase();
        // Die Formelsuche benötigt keine 3.000 Kerzen. 800 Kerzen liefern
        // genügend Trendsegmente und halten den Speicherverbrauch stabil.
        const requestedLimit = Number(url.searchParams.get("limit") || 800);
        const limit = Math.min(
          800,
          Math.max(300, Number.isFinite(requestedLimit) ? requestedLimit : 800),
        );

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

        const top = optimizeTrendFormula(candles, trendAnnotations);
        const best = top[0] || null;

        sendJson(res, 200, {
          ok: true,
          version: QMOMENTUM_VERSION,
          symbol,
          interval,
          candle_count: candles.length,
          target_start_count: trendAnnotations.length,
          tested_formulas: top.tested_count || 0,
          optimizer_mode: "MEMORY_SAFE_TOP_10",
          requested_limit: Number(url.searchParams.get("limit") || 800),
          effective_limit: limit,
          best,
          top: top.map((row) => ({
            params: row.params,
            score: row.score,
            accuracy_pct: row.accuracy_pct,
            avg_switch_distance_bars: row.avg_switch_distance_bars,
            switches: row.switches,
            extra_switches: row.extra_switches,
            short_islands: row.short_islands,
            comparable_bars: row.comparable_bars,
          })),
        });
        return true;
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        return true;
      }
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
          VALUES (?,?,?,?,?,?,?,?,datetime('now'))
          ON CONFLICT(symbol,interval,time) DO UPDATE SET
            price=excluded.price,trend_start=excluded.trend_start,note=excluded.note,
            context_json=excluded.context_json,feature_version=excluded.feature_version,
            updated_at=datetime('now')
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
          VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
          ON CONFLICT(symbol,interval,time) DO UPDATE SET
            price=excluded.price,label=excluded.label,direction=excluded.direction,note=excluded.note,
            context_json=excluded.context_json,feature_version=excluded.feature_version,
            updated_at=datetime('now')
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
          VALUES(?,?,?,?,datetime('now'))
          ON CONFLICT(model_key) DO UPDATE SET
            model_json=excluded.model_json,
            positive_count=excluded.positive_count,
            negative_count=excluded.negative_count,
            trained_at=datetime('now')
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
          VALUES(?,?,?,?,datetime('now'))
          ON CONFLICT(model_key) DO UPDATE SET
            model_json=excluded.model_json,
            positive_count=excluded.positive_count,
            negative_count=excluded.negative_count,
            trained_at=datetime('now')
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