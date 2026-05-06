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

export function detectKinks(dist, zones, smaFast, lookbackMinutes, minKinkHeight) {
  const longKinks = [];
  const shortKinks = [];

  const debug = {
    lastLongHeight: null,
    lastShortHeight: null,
    lastLongRef: null,
    lastShortRef: null,
  };

  if (!Array.isArray(dist) || !Array.isArray(zones) || dist.length < 5) {
    return { longKinks, shortKinks, debug };
  }

  const zoneMap = new Map();

  for (const z of zones) {
    zoneMap.set(Number(z.time), z);
  }

  const fastMap = new Map();

for (const p of smaFast || []) {
  fastMap.set(Number(p.time), Number(p.value));
}

  let longExtreme = null;
  let shortExtreme = null;

  let longArmed = true;
let shortArmed = true;

  for (let i = 1; i < dist.length; i++) {
    const curr = dist[i];
    const zone = zoneMap.get(Number(curr.time));

    const longAllowed = Boolean(zone?.longZone);
    const shortAllowed = Boolean(zone?.shortZone);

    const prev = dist[i - 1];

const fastNow = fastMap.get(Number(curr.time));
const fastPrev = fastMap.get(Number(prev?.time));

const fastTurnsUp =
  Number.isFinite(fastNow) &&
  Number.isFinite(fastPrev) &&
  fastNow > fastPrev;

const fastTurnsDown =
  Number.isFinite(fastNow) &&
  Number.isFinite(fastPrev) &&
  fastNow < fastPrev;

    if (fastTurnsDown) longArmed = true;
if (fastTurnsUp) shortArmed = true;

    // ---------- LONG ----------
    if (longAllowed) {
      if (!longExtreme || curr.value < longExtreme.value) {
        longExtreme = {
          time: curr.time,
          value: curr.value,
        };
      }

      const maxTime = longExtreme.time + lookbackMinutes * 60;

      if (curr.time <= maxTime) {
        const refTime = longExtreme.time - lookbackMinutes * 60;
        let ref = null;

        for (let j = i; j >= 0; j--) {
          if (dist[j].time <= refTime) {
            ref = dist[j];
            break;
          }
        }

        if (ref) {
          const kinkHeight = ref.value - longExtreme.value;

          const reboundBars =
  (curr.time - longExtreme.time) / 60;

const reboundSpeed =
  reboundBars > 0
    ? (curr.value - longExtreme.value) / reboundBars
    : 0;

          debug.lastLongHeight = kinkHeight;
          debug.lastLongRef = {
            currValue: curr.value,
            refValue: ref.value,
            extremeValue: longExtreme.value,
            minKinkHeight,
          };

if (
  longArmed &&
  (curr.value - longExtreme.value) >= minKinkHeight &&
  reboundSpeed >= 0.2 &&
  fastTurnsUp
) {
          
            longKinks.push({
              time: curr.time,
              value: curr.value,
              extremeTime: longExtreme.time,
              extremeValue: longExtreme.value,
              refTime: ref.time,
              refValue: ref.value,
            });

 longArmed = false;

            longExtreme = null;
          }
        }
      } else {
        longExtreme = null;
      }
    } else {
      longExtreme = null;
    }

    // ---------- SHORT ----------
    if (shortAllowed) {
      if (!shortExtreme || curr.value > shortExtreme.value) {
        shortExtreme = {
          time: curr.time,
          value: curr.value,
        };
      }

      const maxTime = shortExtreme.time + lookbackMinutes * 60;

      if (curr.time <= maxTime) {
        const refTime = shortExtreme.time - lookbackMinutes * 60;
        let ref = null;

        for (let j = i; j >= 0; j--) {
          if (dist[j].time <= refTime) {
            ref = dist[j];
            break;
          }
        }

        if (ref) {
          const kinkHeight = shortExtreme.value - ref.value;

          const reboundBars =
  (curr.time - shortExtreme.time) / 60;

const reboundSpeed =
  reboundBars > 0
    ? (shortExtreme.value - curr.value) / reboundBars
    : 0;

          debug.lastShortHeight = kinkHeight;
          debug.lastShortRef = {
            currValue: curr.value,
            refValue: ref.value,
            extremeValue: shortExtreme.value,
            minKinkHeight,
          };

        

            if (
  shortArmed &&
  (shortExtreme.value - curr.value) >= minKinkHeight &&
  reboundSpeed >= 0.2 &&
  fastTurnsDown
) {
            
            shortKinks.push({
              time: curr.time,
              value: curr.value,
              extremeTime: shortExtreme.time,
              extremeValue: shortExtreme.value,
              refTime: ref.time,
              refValue: ref.value,
            });

           shortArmed = false;

            shortExtreme = null;
          }
        }
      } else {
        shortExtreme = null;
      }
    } else {
      shortExtreme = null;
    }
  }

  return { longKinks, shortKinks, debug };
}

export function computeQTrendCore(candles, cfg) {
  const smaFast = calcSMA(candles, Number(cfg.smaFast || 10));
  const smaSlow = calcSMA(candles, Number(cfg.smaSlow || 100));

  const dist = calcDistance(smaFast, smaSlow);

  const fastMap = new Map();
  for (const p of smaFast) {
    fastMap.set(Number(p.time), Number(p.value));
  }

  const slowMap = new Map();
  for (const p of smaSlow) {
    slowMap.set(Number(p.time), Number(p.value));
  }

  const zones = [];

  let trend = null;

  for (const d of dist) {
    const t = Number(d.time);

    const fast = fastMap.get(t);
    const slow = slowMap.get(t);

    if (!Number.isFinite(fast) || !Number.isFinite(slow)) continue;

    const upperOffset = slow + Number(cfg.smaOffset || 0);
    const lowerOffset = slow - Number(cfg.smaOffset || 0);

    const prevSlow = slowMap.get(t - 300);

const slowTurnsUp =
  Number.isFinite(prevSlow) &&
  slow > prevSlow;

const slowTurnsDown =
  Number.isFinite(prevSlow) &&
  slow < prevSlow;

    if (slowTurnsUp) {
  trend = "UT";
} else if (slowTurnsDown) {
  trend = "DT";
}

    

    const longZone =
  trend === "UT"
    ? true
    : (
        d.value <= -Number(cfg.entryBand || 0) &&
        fast <= lowerOffset
      );

    const shortZone =
  trend === "DT"
    ? true
    : (
        d.value >= Number(cfg.entryBand || 0) &&
        fast >= upperOffset
      );

    zones.push({
      time: t,
      dist: d.value,
      fast,
      slow,
      upperOffset,
      lowerOffset,
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
