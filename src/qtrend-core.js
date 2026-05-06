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
    events: [],
  };

  if (!Array.isArray(dist) || !Array.isArray(zones) || dist.length < 5) {
    return { longKinks, shortKinks, debug };
  }

  const zoneMap = new Map();

  for (const z of zones) {
    zoneMap.set(Number(z.time), z);
  }

  let longExtreme = null;
  let shortExtreme = null;

  let waitingForLongTurn = false;
  let waitingForShortTurn = false;

  let longLocked = false;
  let shortLocked = false;

  for (let i = 1; i < dist.length; i++) {
    const curr = dist[i];
    const prev = dist[i - 1];
    const zone = zoneMap.get(Number(curr.time));

    const longAllowed = Boolean(zone?.longZone);
    const shortAllowed = Boolean(zone?.shortZone);

    const distTurnsUp =
      Number.isFinite(curr.value) &&
      Number.isFinite(prev?.value) &&
      curr.value > prev.value;

    const distTurnsDown =
      Number.isFinite(curr.value) &&
      Number.isFinite(prev?.value) &&
      curr.value < prev.value;

    // ---------- LONG ----------
    if (longAllowed) {
      if (!longExtreme || curr.value < longExtreme.value) {
        longExtreme = {
          time: curr.time,
          value: curr.value,
        };

        waitingForLongTurn = false;
        longLocked = false;
      } else {
        waitingForLongTurn = true;

        const kinkHeight = curr.value - longExtreme.value;

        debug.lastLongHeight = kinkHeight;
        debug.lastLongRef = {
          currValue: curr.value,
          extremeValue: longExtreme.value,
          minKinkHeight,
        };

        debug.events.push({
          side: "LONG",
          time: curr.time,
          allowed: longAllowed,
          locked: longLocked,
          waitingForTurn: waitingForLongTurn,
          currValue: curr.value,
          extremeValue: longExtreme.value,
          kinkHeight,
          minKinkHeight,
          distTurnsUp,
          distTurnsDown,
          pass:
            !longLocked &&
            waitingForLongTurn &&
            distTurnsUp &&
            kinkHeight >= minKinkHeight,
        });

        if (
          !longLocked &&
          waitingForLongTurn &&
          distTurnsUp &&
          kinkHeight >= minKinkHeight
        ) {
          longKinks.push({
            time: curr.time,
            value: curr.value,
            extremeTime: longExtreme.time,
            extremeValue: longExtreme.value,
          });

          longLocked = true;
          longExtreme = null;
          waitingForLongTurn = false;
        }
      }
    } else {
      longExtreme = null;
      waitingForLongTurn = false;
      longLocked = false;
    }

    // ---------- SHORT ----------
    if (shortAllowed) {
      if (!shortExtreme || curr.value > shortExtreme.value) {
        shortExtreme = {
          time: curr.time,
          value: curr.value,
        };

        waitingForShortTurn = false;
        shortLocked = false;
      } else {
        waitingForShortTurn = true;

        const kinkHeight = shortExtreme.value - curr.value;

        debug.lastShortHeight = kinkHeight;
        debug.lastShortRef = {
          currValue: curr.value,
          extremeValue: shortExtreme.value,
          minKinkHeight,
        };

        debug.events.push({
          side: "SHORT",
          time: curr.time,
          allowed: shortAllowed,
          locked: shortLocked,
          waitingForTurn: waitingForShortTurn,
          currValue: curr.value,
          extremeValue: shortExtreme.value,
          kinkHeight,
          minKinkHeight,
          distTurnsUp,
          distTurnsDown,
          pass:
            !shortLocked &&
            waitingForShortTurn &&
            distTurnsDown &&
            kinkHeight >= minKinkHeight,
        });

        if (
          !shortLocked &&
          waitingForShortTurn &&
          distTurnsDown &&
          kinkHeight >= minKinkHeight
        ) {
          shortKinks.push({
            time: curr.time,
            value: curr.value,
            extremeTime: shortExtreme.time,
            extremeValue: shortExtreme.value,
          });

          shortLocked = true;
          shortExtreme = null;
          waitingForShortTurn = false;
        }
      }
    } else {
      shortExtreme = null;
      waitingForShortTurn = false;
      shortLocked = false;
    }
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

export function computeQTrendCore(candles, cfg) {
  const smaFast = calcSMA(candles, Number(cfg.smaFast || 10));
  const smaSlow = calcSMA(candles, Number(cfg.smaSlow || 100));

  const dist = calcDistance(smaFast, smaSlow);
  const smaTurns = buildSmaTurnMarkers(smaSlow, 5);

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

    for (const p of smaTurns.up) {
      if (Number(p.time) === t) trend = "UT";
    }

    for (const p of smaTurns.down) {
      if (Number(p.time) === t) trend = "DT";
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
