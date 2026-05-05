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

export function detectKinks(dist, zones, lookbackMinutes) {
  const longKinks = [];
  const shortKinks = [];

  if (!Array.isArray(dist) || dist.length < 5) {
    return { longKinks, shortKinks };
  }

  let longExtreme = null;
  let shortExtreme = null;

  for (let i = 1; i < dist.length; i++) {
    const curr = dist[i];
    
const zoneMap = new Map();
for (const z of zones || []) {
  zoneMap.set(Number(z.time), z);
}

for (let i = 1; i < dist.length; i++) {
  const curr = dist[i];

  const zone = zoneMap.get(Number(curr.time));

  const longAllowed = Boolean(zone?.longZone);
  const shortAllowed = Boolean(zone?.shortZone);

  // ---------- LONG ----------
  if (longAllowed) {

    if (
      !longExtreme ||
      curr.value < longExtreme.value
    ) {
      longExtreme = {
        time: curr.time,
        value: curr.value,
      };
    }

    if (longExtreme) {
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

        if (
          ref &&
          curr.value >= ref.value
        ) {
          longKinks.push({
            time: curr.time,
            value: curr.value,
            extremeTime: longExtreme.time,
            extremeValue: longExtreme.value,
            refTime: ref.time,
            refValue: ref.value,
          });

          longExtreme = null;
        }
      } else {
        longExtreme = null;
      }
    }

  } else {
    longExtreme = null;
  }

  // ---------- SHORT ----------
  if (shortAllowed) {

    if (
      !shortExtreme ||
      curr.value > shortExtreme.value
    ) {
      shortExtreme = {
        time: curr.time,
        value: curr.value,
      };
    }

    if (shortExtreme) {
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

        if (
          ref &&
          curr.value <= ref.value
        ) {
          shortKinks.push({
            time: curr.time,
            value: curr.value,
            extremeTime: shortExtreme.time,
            extremeValue: shortExtreme.value,
            refTime: ref.time,
            refValue: ref.value,
          });

          shortExtreme = null;
        }
      } else {
        shortExtreme = null;
      }
    }

  } else {
    shortExtreme = null;
  }
}

  return {
    longKinks,
    shortKinks,
  };
}

export function computeQTrendCore(candles, cfg) {
  const smaFast = calcSMA(candles, cfg.smaFast);
  const smaSlow = calcSMA(candles, cfg.smaSlow);

  const dist = calcDistance(smaFast, smaSlow);

  const fastMap = new Map();
  for (const p of smaFast) {
    fastMap.set(Number(p.time), Number(p.value));
  }

  const slowMap = new Map();
  for (const p of smaSlow) {
    slowMap.set(Number(p.time), Number(p.value));
  }

  const distMap = new Map();
  for (const p of dist) {
    distMap.set(Number(p.time), Number(p.value));
  }

  const zones = [];

  for (const d of dist) {
    const t = Number(d.time);

    const fast = fastMap.get(t);
    const slow = slowMap.get(t);

    if (!Number.isFinite(fast) || !Number.isFinite(slow)) continue;

    const upperOffset = slow + cfg.smaOffset;
    const lowerOffset = slow - cfg.smaOffset;

    const longZone =
      d.value <= -cfg.entryBand &&
      fast <= lowerOffset;

    const shortZone =
      d.value >= cfg.entryBand &&
      fast >= upperOffset;

    zones.push({
      time: t,
      dist: d.value,
      fast,
      slow,
      longZone,
      shortZone,
    });
  }

  const kinks = detectKinks(
  dist,
  zones,
  Number(cfg.kinkLookbackMinutes || 10)
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
    },
  };
}
