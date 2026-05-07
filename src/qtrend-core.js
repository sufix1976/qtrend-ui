// qtrend-core.js
// Eine Quelle für UI + Worker.
// Keine Broker-Logik. Keine DB-Logik. Keine nachträglichen Marker.

export function calcSMA(candles, length) {
  const out = [];
  if (!Array.isArray(candles) || length <= 0) return out;

  for (let i = length - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = 0; j < length; j++) {
      sum += Number(candles[i - j].close);
    }
    out.push({ time: Number(candles[i].time), value: sum / length });
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

export function detectKinks(dist, zones, smaFast, lookbackMinutes, minKinkHeight) {
  const longKinks = [];
  const shortKinks = [];

  const debug = {
    events: [],
  };

  if (!Array.isArray(dist) || !Array.isArray(zones) || dist.length < 2) {
    return { longKinks, shortKinks, debug };
  }

  const zoneMap = new Map();
  for (const z of zones) {
    zoneMap.set(Number(z.time), z);
  }

 let longWatch = false;
let shortWatch = false;

let wasLongZone = false;
let wasShortZone = false;

let longExtreme = null;
let shortExtreme = null;

  for (let i = 1; i < dist.length; i++) {
    const curr = dist[i];
    const prev = dist[i - 1];
    const zone = zoneMap.get(Number(curr.time));
    const slopeNow = curr.value - prev.value;
    const slopePrev =
  i >= 2
    ? prev.value - dist[i - 2].value
    : 0;
    
    if (!zone) continue;

   const enteredLongZone =
  zone.longZone && !wasLongZone;

if (enteredLongZone && !longWatch) {
  longWatch = true;
  longExtreme = { time: curr.time, value: curr.value };
}

   const enteredShortZone =
  zone.shortZone && !wasShortZone;

if (enteredShortZone && !shortWatch) {
  shortWatch = true;
  shortExtreme = { time: curr.time, value: curr.value };
}

    if (longWatch && longExtreme) {
      if (curr.value < longExtreme.value) {
        longExtreme = { time: curr.time, value: curr.value };
      }

      const recovery = curr.value - longExtreme.value;

      const candlesFromExtreme =
  i - dist.findIndex(
    (d) => d.time === longExtreme.time
  );

     if (
  recovery >= minKinkHeight &&
  slopePrev < 0 &&
  slopeNow > 0 &&
  slopeChange > 0 &&
  candlesFromExtreme >= 5
) {
        const slopeNow = curr.value - prev.value;
const slopePrev =
  i >= 2
    ? prev.value - dist[i - 2].value
    : 0;

longKinks.push({
  time: curr.time,
  value: curr.value,
  extremeTime: longExtreme.time,
  extremeValue: longExtreme.value,

  recovery,
slopeNow,
slopePrev,
slopeChange: slopeNow - slopePrev,
candlesFromExtreme:
 
  i - dist.findIndex(
    (d) => d && longExtreme && d.time === longExtreme.time
  ),
});

        longWatch = false;
        longExtreme = null;
      }
    }

    if (shortWatch && shortExtreme) {
      if (curr.value > shortExtreme.value) {
        shortExtreme = { time: curr.time, value: curr.value };
      }

      const recovery = shortExtreme.value - curr.value;

      const candlesFromExtreme =
  i - dist.findIndex(
    (d) => d.time === shortExtreme.time
  );

    if (
  recovery >= minKinkHeight &&
  slopePrev > 0 &&
  slopeNow < 0 &&
  slopeChange < 0 &&
  candlesFromExtreme >= 5
) {
        const slopeNow = curr.value - prev.value;
const slopePrev =
  i >= 2
    ? prev.value - dist[i - 2].value
    : 0;

shortKinks.push({
  time: curr.time,
  value: curr.value,
  extremeTime: shortExtreme.time,
  extremeValue: shortExtreme.value,

  recovery,
slopeNow,
slopePrev,
slopeChange: slopeNow - slopePrev,
candlesFromExtreme:
  i - dist.findIndex(
    (d) => d && shortExtreme && d.time === shortExtreme.time
  ),
});

        shortWatch = false;
        shortExtreme = null;
      }
    }

    debug.events.push({
      time: curr.time,
      longWatch,
      shortWatch,
      longExtreme: longExtreme?.value ?? null,
      shortExtreme: shortExtreme?.value ?? null,
    });
  }

  return { longKinks, shortKinks, debug };
}

function buildSmaTurnMarkers(smaSlow, confirmBars = 5) {
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
      up.push({ time: smaSlow[i].time, value: smaSlow[i].value });
    }

    if (falling && trend !== "down") {
      trend = "down";
      down.push({ time: smaSlow[i].time, value: smaSlow[i].value });
    }
  }

  return { up, down };
}

export function computeQTrendCore(candles, cfg) {
  const smaFast = calcSMA(candles, Number(cfg.smaFast || 10));
  const smaSlow = calcSMA(candles, Number(cfg.smaSlow || 100));
  const dist = calcDistance(smaFast, smaSlow);
  const smaTurns = buildSmaTurnMarkers(smaSlow, 5);

  const fastMap = new Map();
  for (const p of smaFast) fastMap.set(Number(p.time), Number(p.value));

  const slowMap = new Map();
  for (const p of smaSlow) slowMap.set(Number(p.time), Number(p.value));

  const zones = [];
  let trend = null;

  for (const d of dist) {
    const t = Number(d.time);
    const fast = fastMap.get(t);
    const slow = slowMap.get(t);

    if (!Number.isFinite(fast) || !Number.isFinite(slow)) continue;

    const upperOffset = slow + Number(cfg.smaOffset || 0);
    const lowerOffset = slow - Number(cfg.smaOffset || 0);

    for (const p of smaTurns.up) {
      if (Number(p.time) === t) trend = "UT";
    }

    for (const p of smaTurns.down) {
      if (Number(p.time) === t) trend = "DT";
    }

    const longZone =
      trend === "UT"
        ? true
        : d.value <= -Number(cfg.entryBand || 0) && fast <= lowerOffset;

    const shortZone =
      trend === "DT"
        ? true
        : d.value >= Number(cfg.entryBand || 0) && fast >= upperOffset;

    zones.push({
      time: t,
      dist: d.value,
      fast,
      slow,
      upperOffset,
      lowerOffset,
      trend,
      longZone,
      shortZone,
    });
  }

  const kinks = detectKinks(
    dist,
    zones,
    smaFast,
    Number(cfg.kinkLookbackMinutes || 10),
    Number(cfg.minKinkHeight || 0)
  );

  return {
    smaFast,
    smaSlow,
    dist,
    zones,
    kinks,

    longEntries: [],
    shortEntries: [],
    longExits: [],
    shortExits: [],

    debug: {
      lastZone: zones[zones.length - 1] || null,
      zonesCount: zones.length,
      longZoneCount: zones.filter((z) => z.longZone).length,
      shortZoneCount: zones.filter((z) => z.shortZone).length,
    },
  };
}
