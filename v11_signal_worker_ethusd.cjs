#!/usr/bin/env node
/**
 * V11 server-side signal worker (Capital.com / 15m default)
 *
 * Purpose:
 * - run the finalized V11 logic without TradingView
 * - fetch candles from the engine's market-data route
 * - calculate entries and hybrid emergency exits 1:1 from the tested frontend logic
 * - persist last processed event to avoid duplicate broker actions
 * - optionally forward new actions back into the engine /webhook endpoint
 *
 * Default mode:
 * - SILVER / 15m
 * - DRY_RUN=true  -> only logs signals, does not execute orders
 *
 * Recommended first start:
 *   DRY_RUN=true node v11_signal_worker_silver.js
 *
 * When ready for demo execution:
 *   DRY_RUN=false SIZE=1 node v11_signal_worker_silver.js
 */

const fs = require("fs");
const path = require("path");

const PROVIDER = process.env.PROVIDER || "capital";
const SYMBOL = process.env.SYMBOL || "ETHUSD";
const INTERVAL = process.env.INTERVAL || "15m";
const BACKEND_BASE =
  process.env.BACKEND_BASE || "https://qtrend-trading-engine.onrender.com";
const LIMIT = Number(process.env.LIMIT || 2000);
const POLL_MS = Number(process.env.POLL_MS || 30_000);
const SIZE = Number(process.env.SIZE || 0.5);
const DRY_RUN = false;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "qtrend_2026_secure_8J7Z2Y";
const TF = process.env.TF || INTERVAL;
const STATE_DIR = process.env.STATE_DIR || path.join(process.cwd(), "runtime_state");
const STATE_FILE = path.join(
  STATE_DIR,
  `v11_${PROVIDER}_${SYMBOL}_${INTERVAL}`.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json"
);

const ENTRY_BAND_BY_SYMBOL = {
  BTCUSD: 470.05,
  ETHUSD: 45,
  US100: 80,
  US500: 12,
  GOLD: 8,
  SILVER: 0.25,
  BTCUSDT: 580.05,
  ETHUSDT: 45,
  BNBUSDT: 15,
  XRPUSDT: 0.03,
  SOLUSDT: 1.2,
  LINKUSD: 1.2,
  US30: 120,
  UK100: 18,
  DE40: 35,
  J225: 180,
};

const PEAK_LOOKBACK_BY_SYMBOL = {
  BTCUSD: 4,
  ETHUSD: 4,
  US100: 3,
  US500: 3,
  GOLD: 3,
  SILVER: 3,
  BTCUSDT: 4,
  ETHUSDT: 4,
  BNBUSDT: 3,
  XRPUSDT: 3,
  SOLUSDT: 3,
  LINKUSD: 3,
  US30: 3,
  UK100: 3,
  DE40: 3,
  J225: 3,
};

const MIN_VALID_INDEX = 120;
const EXIT_STRENGTH_FACTOR = Number(process.env.EXIT_STRENGTH_FACTOR || 0.5);

function getEntryBand(symbol) {
  return ENTRY_BAND_BY_SYMBOL[symbol] ?? Number(process.env.ENTRY_BAND || 100);
}

function getPeakLookback(symbol) {
  return PEAK_LOOKBACK_BY_SYMBOL[symbol] ?? Number(process.env.PEAK_LOOKBACK || 3);
}

function isoNow() {
  return new Date().toISOString();
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readState() {
  ensureStateDir();
  if (!fs.existsSync(STATE_FILE)) {
    return {
      lastProcessedEventId: null,
      lastProcessedEventTime: null,
      lastPosition: "flat",
      updatedAt: null,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {
      lastProcessedEventId: null,
      lastProcessedEventTime: null,
      lastPosition: "flat",
      updatedAt: null,
    };
  }
}

function writeState(nextState) {
  ensureStateDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2));
}

function formatTime(unixSec) {
  const d = new Date(unixSec * 1000);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yy} ${hh}:${mi}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeJson(res) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${txt}`);
  }
}

async function fetchCandles() {
  if (PROVIDER !== "capital") {
    throw new Error(`This worker is currently prepared for provider=capital, got ${PROVIDER}`);
  }

  const url = new URL("/api/market-data/klines", BACKEND_BASE);
  url.searchParams.set("provider", PROVIDER);
  url.searchParams.set("symbol", SYMBOL);
  url.searchParams.set("interval", INTERVAL);
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("_ts", String(Date.now()));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`fetchCandles failed: ${res.status} ${txt}`);
  }

  const payload = await safeJson(res);
  if (!payload.ok || !Array.isArray(payload.candles)) {
    throw new Error(`Capital route not ok: ${JSON.stringify(payload)}`);
  }

  return payload.candles.map((c) => ({
    time: Number(c.time),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
  }));
}

function calcSMA(data, len) {
  const res = [];
  for (let i = len - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < len; j++) sum += data[i - j].close;
    res.push({ time: data[i].time, value: sum / len });
  }
  return res;
}

function calcDistance(a, b) {
  const map = new Map();
  for (const x of b) map.set(x.time, x.value);
  return a
    .map((x) => {
      const y = map.get(x.time);
      if (y === undefined) return null;
      return { time: x.time, value: x.value - y };
    })
    .filter(Boolean);
}

function findBestLongIndex(dist, start, end, lookback) {
  if (start < 0 || end < start) return -1;

  let bestIndex = -1;
  let bestValue = Number.POSITIVE_INFINITY;

  for (let i = start; i <= end; i++) {
    const p = dist[i];
    if (!p) continue;

    const left = Math.max(start, i - lookback);
    const right = Math.min(end, i + lookback);

    let isLocalMin = true;
    for (let j = left; j <= right; j++) {
      if (j === i) continue;
      if (dist[j] && dist[j].value < p.value) {
        isLocalMin = false;
        break;
      }
    }

    if (isLocalMin && p.value < bestValue) {
      bestValue = p.value;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0) return bestIndex;

  for (let i = start; i <= end; i++) {
    const p = dist[i];
    if (p && p.value < bestValue) {
      bestValue = p.value;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function findBestShortIndex(dist, start, end, lookback) {
  if (start < 0 || end < start) return -1;

  let bestIndex = -1;
  let bestValue = Number.NEGATIVE_INFINITY;

  for (let i = start; i <= end; i++) {
    const p = dist[i];
    if (!p) continue;

    const left = Math.max(start, i - lookback);
    const right = Math.min(end, i + lookback);

    let isLocalMax = true;
    for (let j = left; j <= right; j++) {
      if (j === i) continue;
      if (dist[j] && dist[j].value > p.value) {
        isLocalMax = false;
        break;
      }
    }

    if (isLocalMax && p.value > bestValue) {
      bestValue = p.value;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0) return bestIndex;

  for (let i = start; i <= end; i++) {
    const p = dist[i];
    if (p && p.value > bestValue) {
      bestValue = p.value;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function buildSignals(candles, entryBand, peakLookback, exitStrengthFactor) {
  const sma10 = calcSMA(candles, 10);
  const sma100 = calcSMA(candles, 100);
  const dist = calcDistance(sma10, sma100);
  const candleMap = new Map();
  for (const c of candles) candleMap.set(c.time, c);

  const longSignals = [];
  const shortSignals = [];
  const entryEvents = [];

  let inLongZone = false;
  let longZoneStart = -1;
  let inShortZone = false;
  let shortZoneStart = -1;

  for (let i = MIN_VALID_INDEX; i < dist.length; i++) {
    const p = dist[i];
    if (!p) continue;

    if (!inLongZone && p.value < -entryBand) {
      inLongZone = true;
      longZoneStart = i;
    } else if (inLongZone && p.value >= -entryBand) {
      const zoneEnd = i - 1;
      const best = findBestLongIndex(dist, longZoneStart, zoneEnd, peakLookback);
      if (best >= 0) {
        const t = dist[best].time;
        const c = candleMap.get(t);
        if (c) {
          longSignals.push(t);
          entryEvents.push({
            kind: "entry",
            side: "long",
            action: "buy",
            time: t,
            index: best,
            price: c.low,
            eventId: `entry-long-${t}`,
          });
        }
      }
      inLongZone = false;
      longZoneStart = -1;
    }

    if (!inShortZone && p.value > entryBand) {
      inShortZone = true;
      shortZoneStart = i;
    } else if (inShortZone && p.value <= entryBand) {
      const zoneEnd = i - 1;
      const best = findBestShortIndex(dist, shortZoneStart, zoneEnd, peakLookback);
      if (best >= 0) {
        const t = dist[best].time;
        const c = candleMap.get(t);
        if (c) {
          shortSignals.push(t);
          entryEvents.push({
            kind: "entry",
            side: "short",
            action: "sell",
            time: t,
            index: best,
            price: c.high,
            eventId: `entry-short-${t}`,
          });
        }
      }
      inShortZone = false;
      shortZoneStart = -1;
    }
  }

  if (inLongZone) {
    const best = findBestLongIndex(dist, longZoneStart, dist.length - 1, peakLookback);
    if (best >= 0) {
      const t = dist[best].time;
      const c = candleMap.get(t);
      if (c) {
        longSignals.push(t);
        entryEvents.push({
          kind: "entry",
          side: "long",
          action: "buy",
          time: t,
          index: best,
          price: c.low,
          eventId: `entry-long-${t}`,
        });
      }
    }
  }

  if (inShortZone) {
    const best = findBestShortIndex(dist, shortZoneStart, dist.length - 1, peakLookback);
    if (best >= 0) {
      const t = dist[best].time;
      const c = candleMap.get(t);
      if (c) {
        shortSignals.push(t);
        entryEvents.push({
          kind: "entry",
          side: "short",
          action: "sell",
          time: t,
          index: best,
          price: c.high,
          eventId: `entry-short-${t}`,
        });
      }
    }
  }

  const orderedEntries = entryEvents.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return a.side === "short" ? 1 : -1;
  });

  const exitEvents = [];
  let position = "flat";
  let nextEntryPtr = 0;

  let shortEmergencyArmed = false;
  let longEmergencyArmed = false;
  let prevDistValue = null;
  let shortBestAfterArm = Number.POSITIVE_INFINITY;
  let longBestAfterArm = Number.NEGATIVE_INFINITY;

  for (let i = MIN_VALID_INDEX; i < dist.length; i++) {
    while (nextEntryPtr < orderedEntries.length && orderedEntries[nextEntryPtr].index === i) {
      const evt = orderedEntries[nextEntryPtr];
      position = evt.side;
      shortEmergencyArmed = false;
      longEmergencyArmed = false;
      prevDistValue = null;
      shortBestAfterArm = Number.POSITIVE_INFINITY;
      longBestAfterArm = Number.NEGATIVE_INFINITY;
      nextEntryPtr += 1;
    }

    const p = dist[i];
    if (!p) continue;

    const candle = candleMap.get(p.time);
    if (!candle) {
      prevDistValue = p.value;
      continue;
    }

    if (position === "short") {
      if (!shortEmergencyArmed) {
        if (p.value < entryBand) {
          shortEmergencyArmed = true;
          shortBestAfterArm = p.value;
        }
      } else {
        if (p.value < shortBestAfterArm) shortBestAfterArm = p.value;

        const strongTrend = shortBestAfterArm <= entryBand * exitStrengthFactor;
        const kinkUp = prevDistValue !== null && p.value > prevDistValue;
        const lineReturn = p.value >= entryBand;

        if (!strongTrend && kinkUp) {
          exitEvents.push({
            kind: "exit",
            side: "short",
            action: "close_sell",
            time: p.time,
            index: i,
            price: candle.high,
            eventId: `exit-short-${p.time}`,
            reason: "hybrid_kink",
          });
          position = "flat";
          shortEmergencyArmed = false;
          shortBestAfterArm = Number.POSITIVE_INFINITY;
          prevDistValue = p.value;
          continue;
        }

        if (strongTrend && lineReturn) {
          exitEvents.push({
            kind: "exit",
            side: "short",
            action: "close_sell",
            time: p.time,
            index: i,
            price: candle.high,
            eventId: `exit-short-${p.time}`,
            reason: "hybrid_line_return",
          });
          position = "flat";
          shortEmergencyArmed = false;
          shortBestAfterArm = Number.POSITIVE_INFINITY;
          prevDistValue = p.value;
          continue;
        }
      }
    } else if (position === "long") {
      if (!longEmergencyArmed) {
        if (p.value > -entryBand) {
          longEmergencyArmed = true;
          longBestAfterArm = p.value;
        }
      } else {
        if (p.value > longBestAfterArm) longBestAfterArm = p.value;

        const strongTrend = longBestAfterArm >= -entryBand * exitStrengthFactor;
        const kinkDown = prevDistValue !== null && p.value < prevDistValue;
        const lineReturn = p.value <= -entryBand;

        if (!strongTrend && kinkDown) {
          exitEvents.push({
            kind: "exit",
            side: "long",
            action: "close_buy",
            time: p.time,
            index: i,
            price: candle.low,
            eventId: `exit-long-${p.time}`,
            reason: "hybrid_kink",
          });
          position = "flat";
          longEmergencyArmed = false;
          longBestAfterArm = Number.NEGATIVE_INFINITY;
          prevDistValue = p.value;
          continue;
        }

        if (strongTrend && lineReturn) {
          exitEvents.push({
            kind: "exit",
            side: "long",
            action: "close_buy",
            time: p.time,
            index: i,
            price: candle.low,
            eventId: `exit-long-${p.time}`,
            reason: "hybrid_line_return",
          });
          position = "flat";
          longEmergencyArmed = false;
          longBestAfterArm = Number.NEGATIVE_INFINITY;
          prevDistValue = p.value;
          continue;
        }
      }
    }

    prevDistValue = p.value;
  }

  const allEvents = [...orderedEntries, ...exitEvents].sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    if (a.kind !== b.kind) return a.kind === "entry" ? -1 : 1;
    return 0;
  });

  return {
    candles,
    sma10,
    sma100,
    dist,
    entryBand,
    peakLookback,
    exitStrengthFactor,
    longSignals,
    shortSignals,
    entryEvents: orderedEntries,
    exitEvents,
    events: allEvents,
    finalPosition: position,
    lastEvent: allEvents.length ? allEvents[allEvents.length - 1] : null,
    lastCandle: candles[candles.length - 1] || null,
  };
}

function buildWebhookBody(event) {
  const signalId = [
    "V11",
    SYMBOL,
    INTERVAL,
    event.kind,
    event.side,
    String(event.time),
  ].join("_");

  return {
    symbol: SYMBOL,
    action: event.action,
    size: SIZE,
    tf: TF,
    signal_id: signalId,
    source: "server_v11_worker",
    strategy: "V11_HYBRID_EXIT",
    metadata: {
      event_id: event.eventId,
      event_kind: event.kind,
      side: event.side,
      reason: event.reason || null,
      time: event.time,
      time_human: formatTime(event.time),
      provider: PROVIDER,
      symbol: SYMBOL,
      interval: INTERVAL,
    },
  };
}

async function postToEngine(event) {
  const url = new URL("/webhook", BACKEND_BASE).toString();
  const body = buildWebhookBody(event);
  const headers = {
    "Content-Type": "application/json",
  };
  if (WEBHOOK_SECRET) headers["x-webhook-secret"] = WEBHOOK_SECRET;

  if (DRY_RUN) {
    console.log(`[DRY_RUN] would POST -> ${url}`);
    console.log(JSON.stringify(body, null, 2));
    return { ok: true, dry_run: true };
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const payload = await safeJson(res);
  if (!res.ok) {
    throw new Error(`Webhook failed: ${res.status} ${JSON.stringify(payload)}`);
  }

  return payload;
}

function summarize(result) {
  const lastCandle = result.lastCandle;
  const lastEvent = result.lastEvent;

  console.log("------------------------------------------------------------");
  console.log(`[${isoNow()}] ${SYMBOL} ${INTERVAL} | position=${result.finalPosition.toUpperCase()} | dry_run=${DRY_RUN}`);
  if (lastCandle) {
    console.log(
      `last candle: ${formatTime(lastCandle.time)} | close=${lastCandle.close.toFixed(2)} | entryBand=${result.entryBand}`
    );
  }
  console.log(
    `signals: long=${result.longSignals.length} short=${result.shortSignals.length} exits=${result.exitEvents.length}`
  );
  if (lastEvent) {
    console.log(
      `last event: ${lastEvent.kind.toUpperCase()} ${lastEvent.side.toUpperCase()} ${formatTime(lastEvent.time)}`
      + (lastEvent.reason ? ` | reason=${lastEvent.reason}` : "")
    );
  } else {
    console.log("last event: -");
  }
}

async function runOnce() {
  const entryBand = getEntryBand(SYMBOL);
  const peakLookback = getPeakLookback(SYMBOL);
  const state = readState();

  const candles = await fetchCandles();
  if (!candles.length) {
    throw new Error("No candles returned.");
  }

  const result = buildSignals(candles, entryBand, peakLookback, EXIT_STRENGTH_FACTOR);
  summarize(result);

  const latest = result.lastEvent;
  if (!latest) {
    console.log("No events yet.");
    return;
  }

  const alreadyProcessed =
    state.lastProcessedEventId === latest.eventId &&
    Number(state.lastProcessedEventTime || 0) === Number(latest.time);

  if (alreadyProcessed) {
    console.log(`No new event. Last processed stays ${latest.eventId}.`);
    return;
  }

  const engineResponse = await postToEngine(latest);
  console.log("engine response:", JSON.stringify(engineResponse, null, 2));

  writeState({
    lastProcessedEventId: latest.eventId,
    lastProcessedEventTime: latest.time,
    lastPosition: result.finalPosition,
    updatedAt: isoNow(),
  });
}

async function main() {
  console.log(`Starting V11 worker for ${SYMBOL} ${INTERVAL}`);
  console.log(`backend=${BACKEND_BASE}`);
  console.log(`stateFile=${STATE_FILE}`);
  console.log(`dryRun=${DRY_RUN}`);
  console.log(`entryBand=${getEntryBand(SYMBOL)} peakLookback=${getPeakLookback(SYMBOL)} exitStrengthFactor=${EXIT_STRENGTH_FACTOR}`);

  while (true) {
    try {
      await runOnce();
    } catch (err) {
      console.error(`[${isoNow()}] worker error:`, err && err.stack ? err.stack : err);
    }
    await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
