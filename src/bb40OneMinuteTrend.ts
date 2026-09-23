import type { Candle } from "./cockpitV2Core";

// The key is the minute's close time. A trend changes only after its candle closes.
export function bb40OneMinuteTrend(candles: Candle[], nowSeconds: number): Map<number, 1 | -1> {
  const result = new Map<number, 1 | -1>();
  const window: number[] = [];
  let sum = 0;
  let trend: 1 | -1 | 0 = 0;
  let previousTime = -Infinity;
  for (const candle of [...candles].sort((a, b) => a.time - b.time)) {
    if (candle.time <= previousTime || candle.time + 60 > nowSeconds) continue;
    previousTime = candle.time;
    window.push(candle.close);
    sum += candle.close;
    if (window.length > 40) sum -= window.shift()!;
    if (window.length < 40) continue;
    const mid = sum / 40;
    if (candle.low > mid) trend = 1;
    else if (candle.high < mid) trend = -1;
    if (trend) result.set(candle.time + 60, trend);
  }
  return result;
}
