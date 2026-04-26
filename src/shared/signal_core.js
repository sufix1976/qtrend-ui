export function sanitizeCandles(data) {
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

export function sanitizeLinePoints(points) {
  return (points || [])
    .filter((p) => p && p.time != null && p.value != null)
    .map((p) => ({
      time: Number(p.time),
      value: Number(p.value),
    }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value));
}

export function calcSMA(data, len) {
  const out = [];
  if (len <= 0) return out;

  for (let i = len - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < len; j++) sum += data[i - j].close;
    out.push({ time: data[i].time, value: sum / len });
  }

  return out;
}

export function calcDistance(a, b) {
  const map = new Map();
  for (const p of b) map.set(p.time, p.value);

  return a
    .map((p) => {
      const other = map.get(p.time);
      if (other == null) return null;
      const value = p.value - other;
      if (!Number.isFinite(value)) return null;
      return { time: p.time, value };
    })
    .filter(Boolean);
}

export function calcStdDevLine(data, len) {
  const out = [];
  if (len <= 1) return out;

  for (let i = len - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < len; j++) sum += data[i - j].value;
    const mean = sum / len;

    let variance = 0;
    for (let j = 0; j < len; j++) {
      const diff = data[i - j].value - mean;
      variance += diff * diff;
    }

    out.push({
      time: data[i].time,
      value: Math.sqrt(variance / len),
    });
  }

  return out;
}

export function buildAdaptiveBandLine(
  middle,
  volatility,
  baseBand,
  adaptiveEnabled,
  adaptiveMultiplier
) {
  const volMap = new Map();
  for (const p of volatility) volMap.set(p.time, p.value);

  return middle.map((p) => {
    const vol = volMap.get(p.time) ?? 0;
    const band = adaptiveEnabled
      ? Math.max(baseBand * 0.35, baseBand + vol * adaptiveMultiplier)
      : baseBand;

    return {
      time: p.time,
      value: band,
    };
  });
}

export function buildBandOffsetLine(base, band, direction) {
  const bandMap = new Map();
  for (const p of band) bandMap.set(p.time, p.value);

  return base.map((p) => ({
    time: p.time,
    value: p.value + (bandMap.get(p.time) ?? 0) * direction,
  }));
}

export function dedupeMarkers(points) {
  const out = [];
  const seen = new Set();

  for (const p of points) {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.value) || p.value <= 0) continue;
    const key = `${p.time}-${p.value}-${p.text ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }

  return out;
}

export function buildStableLongSignals(
  candles,
  dist,
  distMiddle,
  bandLine,
  _peakLookback,
  minKinkMove
) {
  const candleMap = new Map();
  for (const c of candles) candleMap.set(c.time, c);

  const middleMap = new Map();
  for (const p of distMiddle) middleMap.set(p.time, p.value);

  const bandMap = new Map();
  for (const p of bandLine) bandMap.set(p.time, p.value);

  const markers = [];
  const candidateMarkers = [];

  let inZone = false;
  let candidateIndex = -1;
  let inPosition = false;
  let candidateValue = Number.POSITIVE_INFINITY;
  let fired = false;

  for (let i = 1; i < dist.length; i++) {
    const d = dist[i].value;
    const middle = middleMap.get(dist[i].time);
    const band = bandMap.get(dist[i].time);
    if (middle == null || band == null) continue;

    const lowerBand = middle - band;
    const inLowerZone = d < lowerBand;

    if (!inZone && inLowerZone) {
      inZone = true;
      candidateIndex = i;
      candidateValue = d;
      fired = false;
      continue;
    }

    if (inZone && !inLowerZone) {
      inZone = false;
      candidateIndex = -1;
      candidateValue = Number.POSITIVE_INFINITY;
      fired = false;
      continue;
    }

    if (!inZone) continue;

    if (d <= candidateValue) {
      candidateValue = d;
      candidateIndex = i;
    }

    const move = d - candidateValue;

// dynamischer Knick: passt sich an Bandbreite an
const dynamicThreshold = band * 0.25;
const threshold = Math.max(minKinkMove, dynamicThreshold);

const slope = d - dist[i - 1].value;
const slopePrev = i >= 2 ? dist[i - 1].value - dist[i - 2].value : 0;
const slopeTurning = slope > slopePrev;

if (!fired && !inPosition && slopeTurning && move >= threshold && candidateIndex >= 0) {
      const t = dist[i].time;
      const c = candleMap.get(t);

      if (c) {
        candidateMarkers.push({
          time: t,
          value: c.low,
          text: "KL",
          color: "#22c55e",
        });

        markers.push({
          time: t,
          value: c.low,
        });

        fired = true;
        inPosition = true;
      }
    }
  }

  return {
    entries: dedupeMarkers(markers),
    candidates: dedupeMarkers(candidateMarkers),
  };
}

export function buildStableShortSignals(
  candles,
  dist,
  distMiddle,
  bandLine,
  _peakLookback,
  minKinkMove
) {
  const candleMap = new Map();
  for (const c of candles) candleMap.set(c.time, c);

  const middleMap = new Map();
  for (const p of distMiddle) middleMap.set(p.time, p.value);

  const bandMap = new Map();
  for (const p of bandLine) bandMap.set(p.time, p.value);

  const markers = [];
  const candidateMarkers = [];

  let inZone = false;
  let candidateIndex = -1;
  let candidateValue = Number.NEGATIVE_INFINITY;
  let inPosition = false;
  let fired = false;

  for (let i = 1; i < dist.length; i++) {
    const d = dist[i].value;
    const middle = middleMap.get(dist[i].time);
    const band = bandMap.get(dist[i].time);
    if (middle == null || band == null) continue;

    const upperBand = middle + band;
    const inUpperZone = d > upperBand;

    if (!inZone && inUpperZone) {
      inZone = true;
      candidateIndex = i;
      candidateValue = d;
      fired = false;
      continue;
    }

    if (inZone && !inUpperZone) {
      inZone = false;
      candidateIndex = -1;
      candidateValue = Number.NEGATIVE_INFINITY;
      fired = false;
      continue;
    }

    if (!inZone) continue;

    if (d >= candidateValue) {
      candidateValue = d;
      candidateIndex = i;
    }

    const move = candidateValue - d;

// dynamischer Knick: passt sich an Bandbreite an
const dynamicThreshold = band * 0.25;
const threshold = Math.max(minKinkMove, dynamicThreshold);

const slope = d - dist[i - 1].value;
const slopePrev = i >= 2 ? dist[i - 1].value - dist[i - 2].value : 0;
const slopeTurning = slope < slopePrev;

if (!fired && !inPosition && slopeTurning && move >= threshold && candidateIndex >= 0) {
      const t = dist[i].time;
      const c = candleMap.get(t);

      if (c) {
        candidateMarkers.push({
          time: t,
          value: c.high,
          text: "KS",
          color: "#ef4444",
        });

        markers.push({
          time: t,
          value: c.high,
        });

        fired = true;
        inPosition = true;
      }
    }
  }

  return {
    entries: dedupeMarkers(markers),
    candidates: dedupeMarkers(candidateMarkers),
  };
}

export function formatTime(ts) {
  return new Date(ts * 1000).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function deriveCurrentState(longEntries, shortEntries) {
  const lastLong = longEntries.length ? longEntries[longEntries.length - 1].time : null;
  const lastShort = shortEntries.length ? shortEntries[shortEntries.length - 1].time : null;

  if (lastLong && lastShort) return lastLong > lastShort ? "long" : "short";
  if (lastLong) return "long";
  if (lastShort) return "short";
  return "flat";
}

export function computeSignalCore(candles, config) {
  const stdDevLength = config.stdDevLength ?? 50;

  const smaFast = sanitizeLinePoints(calcSMA(candles, config.smaFast));
  const smaSlow = sanitizeLinePoints(calcSMA(candles, config.smaSlow));
  const dist = sanitizeLinePoints(calcDistance(smaFast, smaSlow));

  const distAsCandles = dist.map((p) => ({
    time: p.time,
    open: p.value,
    high: p.value,
    low: p.value,
    close: p.value,
  }));

  let distMiddle = sanitizeLinePoints(calcSMA(distAsCandles, config.smaMiddle));

  if (!distMiddle.length) {
    distMiddle = dist;
  }

  const distVolatility = sanitizeLinePoints(calcStdDevLine(dist, stdDevLength));

  const dynamicBand = buildAdaptiveBandLine(
    distMiddle,
    distVolatility,
    config.entryBand,
    config.adaptiveBand,
    config.adaptiveBandMult
  );

  const longData = buildStableLongSignals(
    candles,
    dist,
    distMiddle,
    dynamicBand,
    config.peakLookback,
    config.minKinkMove
  );

  const shortData = buildStableShortSignals(
    candles,
    dist,
    distMiddle,
    dynamicBand,
    config.peakLookback,
    config.minKinkMove
  );

  const upperBand = buildBandOffsetLine(distMiddle, dynamicBand, 1);
  const lowerBand = buildBandOffsetLine(distMiddle, dynamicBand, -1);

  const markers = [
    ...longData.entries.map((p) => ({ ...p, text: p.text ?? "L", color: p.color ?? "#22c55e" })),
    ...shortData.entries.map((p) => ({ ...p, text: p.text ?? "S", color: p.color ?? "#ef4444" })),
  ].sort((a, b) => a.time - b.time);

  return {
    smaFast,
    smaSlow,
    dist,
    distMiddle,
    dynamicBand,
    upperBand,
    lowerBand,
    markers,
    longEntries: longData.entries,
    shortEntries: shortData.entries,
    longCandidates: longData.candidates,
    shortCandidates: shortData.candidates,
    currentState: deriveCurrentState(longData.entries, shortData.entries),
  };
}
