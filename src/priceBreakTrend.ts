export type PriceCandle = { time: number; open: number; high: number; low: number; close: number };
export type PriceBreakEvent = { time: number; direction: number; close: number; boundary: number };

// Each input timestamp is the OPEN of a 1m candle. Decisions become available
// only at the TF close; chart colors/limits use the state known at the 1m OPEN.
export function priceBreakTrend(
  base: PriceCandle[], minutes: number, lookback: number, initialDirection = 1,
  knownThrough = Math.floor(Date.now() / 60000) * 60,
) {
  if (!Number.isInteger(minutes) || minutes < 1 || !Number.isInteger(lookback) || lookback < 1)
    throw new Error("TF und N müssen positive ganze Zahlen sein.");
  if (initialDirection !== 1 && initialDirection !== -1) throw new Error("Ungültige Startrichtung.");
  const seconds = minutes * 60;
  const buckets = new Map<number, Map<number, PriceCandle>>();
  for (const candle of base) {
    if (candle.time + 60 > knownThrough || candle.time % 60 !== 0) continue;
    const time = Math.floor(candle.time / seconds) * seconds;
    if (!buckets.has(time)) buckets.set(time, new Map());
    buckets.get(time)!.set(candle.time, candle);
  }
  const bars: PriceCandle[] = [];
  for (const [time, entries] of [...buckets].sort((a, b) => a[0] - b[0])) {
    // Never treat a partial first/last bucket or a bucket with missing minutes
    // as a completed TF candle. Session gaps do not manufacture candles.
    if (time + seconds > knownThrough || entries.size !== minutes) continue;
    const rows = [...entries.values()].sort((a, b) => a.time - b.time);
    if (rows.some((row, i) => row.time !== time + i * 60)) continue;
    bars.push({ time, open: rows[0].open, high: Math.max(...rows.map(row => row.high)),
      low: Math.min(...rows.map(row => row.low)), close: rows.at(-1)!.close });
  }
  const updates: { time: number; direction: number; high: number | null; low: number | null }[] = [];
  const events: PriceBreakEvent[] = [];
  const window: PriceCandle[] = [];
  let direction = initialDirection;
  for (const bar of bars) {
    if (window.length === lookback) {
      const high = Math.max(...window.map(row => row.high));
      const low = Math.min(...window.map(row => row.low));
      const next = bar.close > high ? 1 : bar.close < low ? -1 : direction;
      if (next !== direction) events.push({ time: bar.time + seconds, direction: next,
        close: bar.close, boundary: next === 1 ? high : low });
      direction = next;
    }
    // Include this now-closed candle only in the NEXT candle's boundaries.
    window.push(bar);
    if (window.length > lookback) window.shift();
    updates.push({ time: bar.time + seconds, direction,
      high: window.length === lookback ? Math.max(...window.map(row => row.high)) : null,
      low: window.length === lookback ? Math.min(...window.map(row => row.low)) : null });
  }
  let j = -1;
  const trend: number[] = [], line: (number | null)[] = [], upper: (number | null)[] = [], lower: (number | null)[] = [];
  for (const candle of base) {
    while (j + 1 < updates.length && updates[j + 1].time <= candle.time) j++;
    const state = updates[j], dir = state?.direction ?? initialDirection;
    trend.push(dir); upper.push(state?.high ?? null); lower.push(state?.low ?? null);
    line.push(dir === 1 ? state?.low ?? null : state?.high ?? null);
  }
  return { trend, line, upper, lower, events, completeBars: bars.length };
}
