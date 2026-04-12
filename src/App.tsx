// CLEAN VERSION - FIXED SYNTAX + NULL SAFE
// Copy & replace your entire App.tsx

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, LineSeries } from "lightweight-charts";

export default function App() {
  const chartRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [symbol, setSymbol] = useState("BTCUSD");

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: { background: { color: "#0f172a" }, textColor: "#fff" },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {});
    const smaSeries = chart.addSeries(LineSeries, { color: "yellow" });

    chartRef.current = chart;

    loadData(candleSeries, smaSeries, symbol);

    return () => chart.remove();
  }, [symbol]);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <select onChange={(e) => setSymbol(e.target.value)} value={symbol}>
        <option>BTCUSD</option>
        <option>ETHUSD</option>
        <option>XRPUSD</option>
      </select>

      <div ref={containerRef} style={{ width: "100%", height: "90%" }} />
    </div>
  );
}

async function loadData(candleSeries: any, smaSeries: any, symbol: string) {
  try {
    const res = await fetch(`/api/market-data/klines?provider=capital&symbol=${symbol}&interval=15m&limit=500`);
    const json = await res.json();

    const candles = sanitizeCandles(json.candles || []);

    candleSeries.setData(candles);

    const sma = calcSMA(candles, 10);
    smaSeries.setData(sma);

  } catch (err) {
    console.error("LOAD ERROR", err);
  }
}

function sanitizeCandles(data: any[]) {
  return data
    .filter(c =>
      c &&
      c.time != null &&
      c.open != null &&
      c.high != null &&
      c.low != null &&
      c.close != null
    )
    .map(c => ({
      time: Number(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter(c =>
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&
      c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0
    );
}

function calcSMA(data: any[], len: number) {
  const out: any[] = [];

  for (let i = len - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < len; j++) sum += data[i - j].close;

    out.push({ time: data[i].time, value: sum / len });
  }

  return out;
}
