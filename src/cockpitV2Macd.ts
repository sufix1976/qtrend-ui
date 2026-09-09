import type { Time } from "lightweight-charts";
import { resample, tfSeconds, type Candle } from "./cockpitV2Core";

export type MacdExitConfig = {
  macdTf?: string;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
};

export type MacdPoint = {
  time: Time;
  macd: number;
  signal: number;
  histogram: number;
};

export type MacdExitRow = {
  time: number;
  exit: "LONG" | "SHORT";
  reason: "MACD_CROSS";
};

function ema(values: number[], length: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (Math.max(1, length) + 1);
  const out = new Array<number>(values.length);
  let previous = values[0];
  out[0] = previous;
  for (let i = 1; i < values.length; i += 1) {
    previous = alpha * values[i] + (1 - alpha) * previous;
    out[i] = previous;
  }
  return out;
}

export function calculateMacdExit(base: Candle[], cfg: MacdExitConfig) {
  const tf = String(cfg.macdTf || "15m");
  const sec = tfSeconds(tf);
  const knownThrough = (base[base.length - 1]?.time ?? 0) + 60;
  const bars = resample(base, tf).filter(bar => bar.time + sec <= knownThrough);
  if (!bars.length) return { points: [] as MacdPoint[], exits: [] as MacdExitRow[] };

  const closes = bars.map(bar => bar.close);
  const fast = ema(closes, cfg.macdFast);
  const slow = ema(closes, cfg.macdSlow);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(macd, cfg.macdSignal);
  const points: MacdPoint[] = bars.map((bar, i) => ({
    time: (bar.time + sec) as Time,
    macd: macd[i],
    signal: signal[i],
    histogram: macd[i] - signal[i],
  }));

  const exits: MacdExitRow[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    // Blaue MACD-Linie kreuzt rote Signallinie von unten -> SHORT EXIT.
    if (prev.macd <= prev.signal && cur.macd > cur.signal) {
      exits.push({ time: Number(cur.time), exit: "SHORT", reason: "MACD_CROSS" });
    }
    // Blaue MACD-Linie kreuzt rote Signallinie von oben -> LONG EXIT.
    if (prev.macd >= prev.signal && cur.macd < cur.signal) {
      exits.push({ time: Number(cur.time), exit: "LONG", reason: "MACD_CROSS" });
    }
  }

  return { points, exits };
}
