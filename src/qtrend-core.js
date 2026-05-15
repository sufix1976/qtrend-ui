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
  distMiddle
) {
  const fastMap = mapByTime(smaFast);
  const slowMap = mapByTime(smaSlow);
  const middleMap = mapByTime(distMiddle);

  const out = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];

    const fast = fastMap.get(c.time);
    const slow = slowMap.get(c.time);
    const middle = middleMap.get(c.time);

    const prevMiddle = middleMap.get(candles[i - 1].time);

    if (
      !Number.isFinite(fast) ||
      !Number.isFinite(slow) ||
      !Number.isFinite(middle) ||
      !Number.isFinite(prevMiddle)
    ) {
      continue;
    }

    let score = 0;

    if (fast > slow) score += 1;
    if (fast < slow) score -= 1;

    if (middle > 0) score += 1;
    if (middle < 0) score -= 1;

    if (middle > prevMiddle) score += 1;
    if (middle < prevMiddle) score -= 1;

    if (c.close > slow) score += 1;
    if (c.close < slow) score -= 1;

    let trend = "TRN";

    if (score >= 2) trend = "TRU";
    else if (score <= -2) trend = "TRD";

    out.push({
      time: c.time,
      trend,
      score,
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
    distMiddle
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

  const allLongEntries = uniqueMarkers([
    ...reclaim.rawLongCandidates,
    ...kinks.kinkLongCandidates,
    ...distKinks.distKinkLongCandidates,
  ]);

  const allShortEntries = uniqueMarkers([
    ...reclaim.rawShortCandidates,
    ...kinks.kinkShortCandidates,
    ...distKinks.distKinkShortCandidates,
  ]);

  const blockedLongEntries = allLongEntries.filter(
    (p) => p.text === "KL_T_BLOCK"
  );

  const blockedShortEntries = allShortEntries.filter(
    (p) => p.text === "KS_T_BLOCK"
  );

  const trendFilteredLongEntries = allLongEntries.map((p) => {
  if (p.text !== "KL_T") return p;

  const d = dist.find((x) => x.time === p.time);

  if (!d) {
    return {
      ...p,
      text: "KL_T_BLOCK",
      reason: "NO_DIST",
      color: "#9ca3af",
    };
  }

  // KL_T darf NICHT oben in Extremzone liegen
  if (d.value > distExtreme) {
    return {
      ...p,
      text: "KL_T_BLOCK",
      reason: "DIST_TOO_HIGH",
      color: "#9ca3af",
    };
  }

  return p;
});

const trendFilteredShortEntries = allShortEntries.map((p) => {
  if (p.text !== "KS_T") return p;

  const d = dist.find((x) => x.time === p.time);

  if (!d) {
    return {
      ...p,
      text: "KS_T_BLOCK",
      reason: "NO_DIST",
      color: "#9ca3af",
    };
  }

  // KS_T darf NICHT unten in Extremzone liegen
  if (d.value < -distExtreme) {
    return {
      ...p,
      text: "KS_T_BLOCK",
      reason: "DIST_TOO_LOW",
      color: "#9ca3af",
    };
  }

  return p;
});

const tradeLongEntries = trendFilteredLongEntries.filter(
  (p) => p.text !== "KL_T_BLOCK"
);

const tradeShortEntries = trendFilteredShortEntries.filter(
  (p) => p.text !== "KS_T_BLOCK"
);

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
