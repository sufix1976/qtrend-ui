// qtrend-core.js
console.log("QTREND CORE FILE LOADED V2");
// qtrend-core.js
// Zentrale Signalengine für UI + Worker
// Keine Broker- oder DB-Logik.

export function sanitizeLinePoints(points) {
  return (points || [])
    .filter((p) => p && p.time != null && p.value != null)
    .map((p) => ({
      time: Number(p.time),
      value: Number(p.value),
    }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value));
} 

export function calcSMA(candles, length) {
  const out = [];

  if (!Array.isArray(candles) || length <= 0) {
    return out;
  }

  for (let i = length - 1; i < candles.length; i++) {
    let sum = 0;

    for (let j = 0; j < length; j++) {
      sum += Number(candles[i - j].close);
    }

    out.push({
      time: Number(candles[i].time),
      value: sum / length,
    });
  }

  return out;
}

export function calcDistance(smaFast, smaSlow) {
  const slowMap = new Map();

  for (const p of smaSlow || []) {
    slowMap.set(Number(p.time), Number(p.value));
  }

  const out = [];

  for (const f of smaFast || []) {
    const t = Number(f.time);
    const s = slowMap.get(t);

    if (!Number.isFinite(s)) continue;

    out.push({
      time: t,
      value: Number(f.value) - s,
    });
  }

  return out;
}

export function uniqueMarkers(points) {
  const out = [];
  const seen = new Set();

  for (const p of points || []) {
    if (!Number.isFinite(p.time)) continue;

    const key = `${p.time}_${p.text || ""}`;

    if (seen.has(key)) continue;

    seen.add(key);
    out.push(p);
  }

  return out.sort((a, b) => a.time - b.time);
}

export function buildSmaTurnMarkers(smaSlow, confirmBars = 5) {
  const up = [];
  const down = [];

  let trend = null;

  for (let i = confirmBars; i < smaSlow.length; i++) {
    let rising = true;
    let falling = true;

    for (let j = 0; j < confirmBars; j++) {
      const curr = smaSlow[i - j].value;
      const prev = smaSlow[i - j - 1].value;

      if (curr <= prev) rising = false;
      if (curr >= prev) falling = false;
    }

    if (rising && trend !== "up") {
      trend = "up";

      up.push({
        time: smaSlow[i].time,
        value: smaSlow[i].value,
      });
    }

    if (falling && trend !== "down") {
      trend = "down";

      down.push({
        time: smaSlow[i].time,
        value: smaSlow[i].value,
      });
    }
  }

  return { up, down };
}

function candleByTime(candles, time) {
  return candles.find((c) => c.time === time) || null;
}

function mapByTime(points) {
  const m = new Map();

  for (const p of points || []) {
    m.set(Number(p.time), Number(p.value));
  }

  return m;
}

export function computeTrendState(
  candles,
  smaFast,
  smaSlow,
  distMiddle,
  trendLength = 10
) {
  const out = [];

  if (!Array.isArray(candles) || candles.length < trendLength + 5) {
    return out;
  }

  function smaOf(values, len, index) {
    if (index < len - 1) return null;

    let sum = 0;
    for (let j = 0; j < len; j++) {
      sum += values[index - j];
    }

    return sum / len;
  }

  function trueRange(i) {
    const c = candles[i];
    const p = candles[i - 1];

    if (!c || !p) return 0;

    return Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
  }

  const highs = candles.map((c) => Number(c.high));
  const lows = candles.map((c) => Number(c.low));

  const trValues = candles.map((_, i) => (i === 0 ? 0 : trueRange(i)));

  let trend = "TRN";

  for (let i = 1; i < candles.length; i++) {
    const smaHighBase = smaOf(highs, trendLength, i);
    const smaLowBase = smaOf(lows, trendLength, i);

    const atrRaw = smaOf(trValues, 200, i);
    const atrSmooth = atrRaw == null ? null : atrRaw * 0.8;

    if (
      smaHighBase == null ||
      smaLowBase == null ||
      atrSmooth == null
    ) {
      out.push({
        time: candles[i].time,
        trend,
        score: 0,
        trendValue: null,
        smaHigh: null,
        smaLow: null,
      });
      continue;
    }

    const smaHigh = smaHighBase + atrSmooth;
    const smaLow = smaLowBase - atrSmooth;

    const prevClose = candles[i - 1].close;
    const currClose = candles[i].close;

    const crossedUp =
      prevClose <= smaHigh &&
      currClose > smaHigh;

    const crossedDown =
      prevClose >= smaLow &&
      currClose < smaLow;

    if (crossedUp) trend = "TRU";
    if (crossedDown) trend = "TRD";

    out.push({
      time: candles[i].time,
      trend,
      score: trend === "TRU" ? 1 : trend === "TRD" ? -1 : 0,
      trendValue: trend === "TRU" ? smaLow : trend === "TRD" ? smaHigh : null,
      smaHigh,
      smaLow,
    });
  }

  return out;
}

export function trendAt(trendStates, time) {
  let last = null;

  for (const t of trendStates || []) {
    if (t.time > time) break;
    last = t;
  }

  return last?.trend || "TRN";
}

export function buildReclaimSignals(
  candles,
  smaFast,
  smaSlow,
  smaOffset
) {
  const fastMap = mapByTime(smaFast);
  const slowMap = mapByTime(smaSlow);

  const rawLongCandidates = [];
  const rawShortCandidates = [];

  let longArmed = false;
  let shortArmed = false;

  for (const c of candles || []) {
    const fast = fastMap.get(c.time);
    const slow = slowMap.get(c.time);

    if (!Number.isFinite(fast) || !Number.isFinite(slow)) continue;

    const upper = slow + smaOffset;
    const lower = slow - smaOffset;

    if (fast < lower) {
      longArmed = true;
    }

    if (fast > upper) {
      shortArmed = true;
    }

    if (longArmed && fast >= lower) {
      rawLongCandidates.push({
        time: c.time,
        value: c.low,
        text: "RL",
        reason: "RL",
      });

      longArmed = false;
    }

    if (shortArmed && fast <= upper) {
      rawShortCandidates.push({
        time: c.time,
        value: c.high,
        text: "RS",
        reason: "RS",
      });

      shortArmed = false;
    }
  }

  return {
    rawLongCandidates: uniqueMarkers(rawLongCandidates),
    rawShortCandidates: uniqueMarkers(rawShortCandidates),
  };
}

export function buildKinkSignals(
  candles,
  smaFast,
  smaSlow,
  smaOffset,
  outerOffset,
  minKink,
  kinkStrengthFactor,
  distMiddle,
  trendStates
) {
  
  const lowerMap = new Map();
  const upperMap = new Map();
  const outerLowerMap = new Map();
  const outerUpperMap = new Map();

  for (const p of smaSlow || []) {
    lowerMap.set(Number(p.time), Number(p.value) - smaOffset);
    upperMap.set(Number(p.time), Number(p.value) + smaOffset);
    outerLowerMap.set(Number(p.time), Number(p.value) - smaOffset - outerOffset);
    outerUpperMap.set(Number(p.time), Number(p.value) + smaOffset + outerOffset);
  }

  const distMiddleMap = mapByTime(distMiddle);


  const kinkLongCandidates = [];
  const kinkShortCandidates = [];

  for (let i = 2; i < smaFast.length; i++) {
    const prev2 = smaFast[i - 2];
    const prev1 = smaFast[i - 1];
    const curr = smaFast[i];

    const currLower = lowerMap.get(curr.time);
    const currUpper = upperMap.get(curr.time);

    if (currLower == null || currUpper == null) continue;

    const slopePrev = prev1.value - prev2.value;
    const slopeNow = curr.value - prev1.value;

    const kinkStrength = Math.abs(slopeNow);
    const minKinkStrength = minKink * kinkStrengthFactor;

    const trendNowLong = trendAt(trendStates, curr.time);
    const trendNowShort = trendAt(trendStates, curr.time);

    const dmPrev1 = distMiddleMap.get(prev1.time);
    const dmCurr = distMiddleMap.get(curr.time);

    const distRising =
      dmPrev1 != null &&
      dmCurr != null &&
      dmCurr > dmPrev1;

    const distFalling =
      dmPrev1 != null &&
      dmCurr != null &&
      dmCurr < dmPrev1;

    if (
      (prev1.value < currLower || trendNowLong === "TRU") &&
      slopePrev < 0 &&
      slopeNow > 0 &&
      kinkStrength >= minKinkStrength
    ) {

      const counterTrendLong = trendNowLong === "TRD";
      const trendLong = trendNowLong === "TRU";

      const currOuterUpper = outerUpperMap.get(curr.time);

      const blockOuterLong =
        trendLong &&
        currOuterUpper != null &&
        curr.value > currOuterUpper;

      const trendPullbackLong =
  dmPrev1 != null &&
  dmPrev1 <= 0 &&
  dmCurr != null &&
  dmCurr > dmPrev1;

const blockTrendLong =
  trendLong && (!trendPullbackLong || blockOuterLong || distFalling);

      kinkLongCandidates.push({
        time: curr.time,
        value: curr.value,
        text: counterTrendLong
          ? "KL_CT"
          : blockTrendLong
          ? "KL_T_BLOCK"
          : trendLong
          ? "KL_T"
          : "KL",
        reason: counterTrendLong
          ? "KL_CT"
          : blockTrendLong
          ? "KL_T_BLOCK"
          : trendLong
          ? "KL_T"
          : "KL",
        color: counterTrendLong
          ? "#66ccff"
          : blockTrendLong
          ? "#9ca3af"
          : trendLong
          ? "#00ff88"
          : "#00ffaa",
      });
    }

    if (
      (prev1.value > currUpper || trendNowShort === "TRD") &&
      slopePrev > 0 &&
      slopeNow < 0 &&
      kinkStrength >= minKinkStrength
    ) {

      const counterTrendShort = trendNowShort === "TRU";
      const trendShort = trendNowShort === "TRD";

      const currOuterLower = outerLowerMap.get(curr.time);

      const blockOuterShort =
        trendShort &&
        currOuterLower != null &&
        curr.value < currOuterLower;

      const trendPullbackShort =
  dmPrev1 != null &&
  dmPrev1 >= 0 &&
  dmCurr != null &&
  dmCurr < dmPrev1;

const blockTrendShort =
  trendShort && (!trendPullbackShort || blockOuterShort || distRising);

      if (curr.time === 177859900) {
  console.log("CORE SHORT BLOCK DEBUG 177859900", {
    currTime: curr.time,
    currValue: curr.value,
    trendNowShort,
    trendShort,
    counterTrendShort,
    currOuterLower,
    blockOuterShort,
    distRising,
    blockTrendShort,
    dmPrev1,
    dmCurr,
  });
}

      kinkShortCandidates.push({
        time: curr.time,
        value: curr.value,
        text: counterTrendShort
          ? "KS_CT"
          : blockTrendShort
          ? "KS_T_BLOCK"
          : trendShort
          ? "KS_T"
          : "KS",
        reason: counterTrendShort
          ? "KS_CT"
          : blockTrendShort
          ? "KS_T_BLOCK"
          : trendShort
          ? "KS_T"
          : "KS",
        color: counterTrendShort
          ? "#ffaa66"
          : blockTrendShort
          ? "#9ca3af"
          : trendShort
          ? "#ff4477"
          : "#ff77aa",
      });
    }
  }

  console.log("CORE KINK DEBUG", {
  smaFastLen: smaFast.length,
  smaSlowLen: smaSlow.length,
  distMiddleLen: distMiddle.length,
  trendStatesLen: trendStates.length,
  minKink,
  kinkStrengthFactor,
  longCount: kinkLongCandidates.length,
  shortCount: kinkShortCandidates.length,
  lastLong: kinkLongCandidates.at(-1) ?? null,
  lastShort: kinkShortCandidates.at(-1) ?? null,
});

  return {
    kinkLongCandidates: uniqueMarkers(kinkLongCandidates),
    kinkShortCandidates: uniqueMarkers(kinkShortCandidates),
  };
}

export function buildDistKinkSignals(
  candles,
  dist,
  distExtreme
) {
  const candleMap = new Map();
  for (const c of candles || []) {
    candleMap.set(Number(c.time), c);
  }

  const longCandidates = [];
  const shortCandidates = [];

  const confirm = Number(distExtreme) * 0.07;

  let longArmed = true;
  let shortArmed = true;

  let longExtreme = null;
  let shortExtreme = null;

  for (const d of dist || []) {
    const c = candleMap.get(Number(d.time));
    if (!c) continue;

    const val = Number(d.value);

    // ---------- LONG: unter -distExtreme ----------
    if (val < -distExtreme) {
      if (longArmed) {
        if (!longExtreme || val < longExtreme.value) {
          longExtreme = {
            time: d.time,
            value: val,
          };
        }

        if (
          longExtreme &&
          val - longExtreme.value >= confirm
        ) {
          longCandidates.push({
            time: c.time,
            value: c.low,
            text: "KL_D",
            reason: "KL_D",
          });

          longArmed = false;
        }
      }
    } else {
      // erst nach Verlassen der unteren Extremzone wieder scharf
      longArmed = true;
      longExtreme = null;
    }

    // ---------- SHORT: über +distExtreme ----------
    if (val > distExtreme) {
      if (shortArmed) {
        if (!shortExtreme || val > shortExtreme.value) {
          shortExtreme = {
            time: d.time,
            value: val,
          };
        }

        if (
          shortExtreme &&
          shortExtreme.value - val >= confirm
        ) {
          shortCandidates.push({
            time: c.time,
            value: c.high,
            text: "KS_D",
            reason: "KS_D",
          });

          shortArmed = false;
        }
      }
    } else {
      // erst nach Verlassen der oberen Extremzone wieder scharf
      shortArmed = true;
      shortExtreme = null;
    }
  }

  return {
    distKinkLongCandidates: uniqueMarkers(longCandidates),
    distKinkShortCandidates: uniqueMarkers(shortCandidates),
  };
}

export function buildExitSignals(
  candles,
  smaFast,
  smaSlow,
  smaOffset,
  useSlowExit = true
) {
  const fastMap = mapByTime(smaFast);
  const slowMap = mapByTime(smaSlow);

  const longExits = [];
  const shortExits = [];

  let wasLongAbove = false;
  let wasShortBelow = false;

  for (const c of candles || []) {
    const fast = fastMap.get(c.time);
    const slow = slowMap.get(c.time);

    if (!Number.isFinite(fast) || !Number.isFinite(slow)) continue;

    const upper = slow + smaOffset;
    const lower = slow - smaOffset;

    const longExitLine = useSlowExit ? slow : upper;
    const shortExitLine = useSlowExit ? slow : lower;

    if (fast > longExitLine) {
      wasLongAbove = true;
    }

    if (fast < shortExitLine) {
      wasShortBelow = true;
    }

    if (wasLongAbove && fast <= longExitLine) {
      longExits.push({
        time: c.time,
        value: c.low,
        text: "EXL",
        reason: "EXL",
      });

      wasLongAbove = false;
    }

    if (wasShortBelow && fast >= shortExitLine) {
      shortExits.push({
        time: c.time,
        value: c.high,
        text: "EXS",
        reason: "EXS",
      });

      wasShortBelow = false;
    }
  }

  return {
    longExits: uniqueMarkers(longExits),
    shortExits: uniqueMarkers(shortExits),
  };
}

export function computeQTrendCore(candles, cfg = {}) {
  const safeCandles = Array.isArray(candles)
    ? candles
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
            Number.isFinite(c.close)
        )
    : [];

  const smaFastLen = Number(cfg.smaFast ?? 10);
  const smaSlowLen = Number(cfg.smaSlow ?? 100);
  const smaMiddleLen = Number(cfg.smaMiddle ?? 100);
  const smaOffset = Number(cfg.smaOffset ?? 150);
  const outerOffset = Number(cfg.outerOffset ?? Math.max(1, smaOffset * 0.5));
  const minKink = Number(cfg.minKink ?? cfg.minKinkHeight ?? 1);
  const distExtreme = Number(cfg.distExtreme ?? cfg.entryBand ?? 100);
  const useSlowExit = cfg.useSlowExit == null ? true : Boolean(cfg.useSlowExit);

  const trendLength = Number(cfg.trendLength ?? 10);

  const smaFast = sanitizeLinePoints(calcSMA(safeCandles, smaFastLen));
  const smaSlow = sanitizeLinePoints(calcSMA(safeCandles, smaSlowLen));
  const dist = sanitizeLinePoints(calcDistance(smaFast, smaSlow));

  const distAsCandles = dist.map((p) => ({
    time: p.time,
    open: p.value,
    high: p.value,
    low: p.value,
    close: p.value,
  }));

  let distMiddle = sanitizeLinePoints(calcSMA(distAsCandles, smaMiddleLen));
  if (!distMiddle.length) distMiddle = dist;

  const smaTurns = buildSmaTurnMarkers(smaSlow, 5);

  const oldTrendEvents = [
    ...smaTurns.up.map((p) => ({
      time: p.time,
      trend: "up",
    })),
    ...smaTurns.down.map((p) => ({
      time: p.time,
      trend: "down",
    })),
  ].sort((a, b) => a.time - b.time);

const trendStates = computeTrendState(
  safeCandles,
  smaFast,
  smaSlow,
  distMiddle,
  trendLength
);

  const reclaim = buildReclaimSignals(
    safeCandles,
    smaFast,
    smaSlow,
    smaOffset
  );

 const kinkStrengthFactor = Number(cfg.kinkStrengthFactor ?? 0.15);

const kinks = buildKinkSignals(
  safeCandles,
  smaFast,
  smaSlow,
  smaOffset,
  outerOffset,
  minKink,
  kinkStrengthFactor,
  distMiddle,
  trendStates
);

  const distKinks = buildDistKinkSignals(
    safeCandles,
    dist,
    distExtreme
  );

  const exits = buildExitSignals(
    safeCandles,
    smaFast,
    smaSlow,
    smaOffset,
    useSlowExit
  );

  const trendSwitchLongEntries = [];
const trendSwitchShortEntries = [];

for (let i = 1; i < trendStates.length; i++) {
  const prev = trendStates[i - 1];
  const curr = trendStates[i];

  if (!prev || !curr) continue;

  const d = dist.find((x) => x.time === curr.time);
  if (!d) continue;

  // SOFORT LONG bei Wechsel auf TRU
  // aber NICHT wenn Dist oben überdehnt
  if (
    prev.trend !== "TRU" &&
    curr.trend === "TRU" &&
    d.value < distExtreme
  ) {
    trendSwitchLongEntries.push({
      time: curr.time,
      value: 1,
      text: "TRU",
      color: "#00ff88",
    });
  }

  // SOFORT SHORT bei Wechsel auf TRD
  // aber NICHT wenn Dist unten überdehnt
  if (
    prev.trend !== "TRD" &&
    curr.trend === "TRD" &&
    d.value > -distExtreme
  ) {
    trendSwitchShortEntries.push({
      time: curr.time,
      value: 1,
      text: "TRD",
      color: "#ff4d6d",
    });
  }
}

const allLongEntries = [
  ...reclaim.rawLongCandidates,
  ...kinks.kinkLongCandidates,
  ...distKinks.distKinkLongCandidates,
  ...trendSwitchLongEntries,
];

const allShortEntries = [
  ...reclaim.rawShortCandidates,
  ...kinks.kinkShortCandidates,
  ...distKinks.distKinkShortCandidates,
  ...trendSwitchShortEntries,
];
  
  const blockedLongEntries = allLongEntries.filter(
    (p) => p.text === "KL_T_BLOCK"
  );

  const blockedShortEntries = allShortEntries.filter(
    (p) => p.text === "KS_T_BLOCK"
  );

 const distMap = new Map(dist.map((p) => [p.time, p.value]));

let virtualState = "flat";
let lastTrendMode = "TRN";

const tradeLongEntries = [];
const tradeShortEntries = [];

const mixedEvents = [
  ...allLongEntries.map((p) => ({ ...p, side: "long", kind: "entry" })),
  ...allShortEntries.map((p) => ({ ...p, side: "short", kind: "entry" })),
  ...exits.longExits.map((p) => ({ ...p, side: "flat", kind: "exit_long" })),
  ...exits.shortExits.map((p) => ({ ...p, side: "flat", kind: "exit_short" })),
].sort((a, b) => a.time - b.time);

for (const e of mixedEvents) {
  const tr = trendAt(trendStates, e.time);
  const d = distMap.get(e.time);

  if (e.kind === "exit_long" && virtualState === "long") {
    virtualState = "flat";
    continue;
  }

  if (e.kind === "exit_short" && virtualState === "short") {
    virtualState = "flat";
    continue;
  }

  if (e.kind !== "entry") continue;

  if (e.text === "KL_T") {
    const allowedByTrendSwitch = tr === "TRU" && lastTrendMode !== "TRU";
    const allowedByFlat = virtualState === "flat";
    const allowedByDist = d == null || d <= distExtreme;

    if (!(allowedByTrendSwitch || allowedByFlat) || !allowedByDist) {
      continue;
    }
  }

  if (e.text === "KS_T") {
    const allowedByTrendSwitch = tr === "TRD" && lastTrendMode !== "TRD";
    const allowedByFlat = virtualState === "flat";
    const allowedByDist = d == null || d >= -distExtreme;

    if (!(allowedByTrendSwitch || allowedByFlat) || !allowedByDist) {
      continue;
    }
  }

  if (e.text === "KL_T_BLOCK" || e.text === "KS_T_BLOCK") {
    continue;
  }

  if (e.side === "long") {
    if (virtualState !== "long") {
      tradeLongEntries.push(e);
      virtualState = "long";
      lastTrendMode = tr;
    }
  }

  if (e.side === "short") {
    if (virtualState !== "short") {
      tradeShortEntries.push(e);
      virtualState = "short";
      lastTrendMode = tr;
    }
  }
}

  const eventStream = [
    ...tradeLongEntries.map((p) => ({
      ...p,
      side: "long",
      eventType: "entry",
    })),
    ...tradeShortEntries.map((p) => ({
      ...p,
      side: "short",
      eventType: "entry",
    })),
    ...exits.longExits.map((p) => ({
      ...p,
      side: "flat",
      eventType: "exit_long",
    })),
    ...exits.shortExits.map((p) => ({
      ...p,
      side: "flat",
      eventType: "exit_short",
    })),
  ].sort((a, b) => a.time - b.time);

  let state = "flat";
  let latestStrategyEvent = null;

  for (const e of eventStream) {
    if (e.eventType === "entry") {
      if (state === e.side) continue;

      state = e.side;
      latestStrategyEvent = e;
      continue;
    }

    if (e.eventType === "exit_long" && state === "long") {
      state = "flat";
      latestStrategyEvent = e;
      continue;
    }

    if (e.eventType === "exit_short" && state === "short") {
      state = "flat";
      latestStrategyEvent = e;
      continue;
    }
  }

  return {
    smaFast,
    smaSlow,
    dist,
    distMiddle,

    smaTurns,
    oldTrendEvents,
    trendStates,

    rawLongCandidates: reclaim.rawLongCandidates,
    rawShortCandidates: reclaim.rawShortCandidates,

    kinkLongCandidates: kinks.kinkLongCandidates,
    kinkShortCandidates: kinks.kinkShortCandidates,

    distKinkLongCandidates: distKinks.distKinkLongCandidates,
    distKinkShortCandidates: distKinks.distKinkShortCandidates,

    allLongEntries,
    allShortEntries,

    blockedLongEntries,
    blockedShortEntries,

    tradeLongEntries,
    tradeShortEntries,

    longExits: exits.longExits,
    shortExits: exits.shortExits,

    eventStream,
    latestStrategyEvent,
    latestStrategyEventTime: latestStrategyEvent?.time ?? null,
    latestStrategyEventType: latestStrategyEvent?.reason ?? null,
    state,

    debug: {
      lastCandle: safeCandles[safeCandles.length - 1] || null,
      lastTrend: trendStates[trendStates.length - 1] || null,
      lastEvent: latestStrategyEvent,
      counts: {
        rawLong: reclaim.rawLongCandidates.length,
        rawShort: reclaim.rawShortCandidates.length,
        kinkLong: kinks.kinkLongCandidates.length,
        kinkShort: kinks.kinkShortCandidates.length,
        distKinkLong: distKinks.distKinkLongCandidates.length,
        distKinkShort: distKinks.distKinkShortCandidates.length,
        tradeLong: tradeLongEntries.length,
        tradeShort: tradeShortEntries.length,
        longExits: exits.longExits.length,
        shortExits: exits.shortExits.length,
      },
    },
  };
}
