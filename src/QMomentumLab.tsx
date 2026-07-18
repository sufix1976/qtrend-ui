import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type Time,
} from "lightweight-charts";
import "./QMomentumLab.css";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["US30", "US100", "DE40", "UK100", "J225", "CN50", "BTCUSD", "ETHUSD", "GOLD"];
const INTERVALS = ["1m", "5m", "10m", "15m", "30m", "1h"];

type Candle = { time: number; open: number; high: number; low: number; close: number };
type Label = "perfect" | "bad" | "missed" | "unsure";
type Annotation = {
  id: number;
  symbol: string;
  interval: string;
  time: number;
  price: number;
  label: Label;
  note?: string | null;
};

type IndicatorPoint = {
  time: Time;
  macd: number;
  signal: number;
  histogram: number;
  rsi: number;
  rsiMa: number;
};

function ema(values: number[], length: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (Math.max(1, length) + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
  return out;
}

function rsi(values: number[], length = 14): number[] {
  if (!values.length) return [];
  const out = new Array(values.length).fill(50);
  if (values.length <= length) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i += 1) {
    const delta = values[i] - values[i - 1];
    gain += Math.max(delta, 0);
    loss += Math.max(-delta, 0);
  }
  gain /= length;
  loss /= length;
  out[length] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = length + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    gain = (gain * (length - 1) + Math.max(delta, 0)) / length;
    loss = (loss * (length - 1) + Math.max(-delta, 0)) / length;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  for (let i = 0; i < length; i += 1) out[i] = out[length];
  return out;
}

function sma(values: number[], length: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    out.push(sum / Math.min(i + 1, length));
  }
  return out;
}

function indicators(candles: Candle[]): IndicatorPoint[] {
  const closes = candles.map((c) => c.close);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(macd, 9);
  const rsiValues = rsi(closes, 14);
  const rsiMa = sma(rsiValues, 9);
  return candles.map((c, i) => ({
    time: c.time as Time,
    macd: macd[i],
    signal: signal[i],
    histogram: macd[i] - signal[i],
    rsi: rsiValues[i],
    rsiMa: rsiMa[i],
  }));
}

function formatTime(time: number) {
  return new Date(time * 1000).toLocaleString("de-DE");
}

function labelText(label: Label) {
  return ({ perfect: "Perfekt", bad: "Schlecht", missed: "Verpasst", unsure: "Unsicher" } as const)[label];
}

export default function QMomentumLab() {
  const [symbol, setSymbol] = useState("US30");
  const [interval, setInterval] = useState("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [showSma, setShowSma] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const priceEl = useRef<HTMLDivElement>(null);
  const macdEl = useRef<HTMLDivElement>(null);
  const rsiEl = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<IChartApi[]>([]);

  const values = useMemo(() => indicators(candles), [candles]);
  const selectedCandle = useMemo(
    () => candles.find((c) => c.time === selectedTime) || null,
    [candles, selectedTime],
  );
  const selectedIndicators = useMemo(() => {
    const index = candles.findIndex((c) => c.time === selectedTime);
    return index >= 0 ? values[index] : null;
  }, [candles, values, selectedTime]);
  const stats = useMemo(() => {
    const result: Record<Label, number> = { perfect: 0, bad: 0, missed: 0, unsure: 0 };
    annotations.forEach((a) => { if (a.label in result) result[a.label] += 1; });
    return result;
  }, [annotations]);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const url = new URL("/qmomentum/data", BACKEND_BASE);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("interval", interval);
      url.searchParams.set("limit", "5000");
      const response = await fetch(url, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`);
      setCandles(json.candles || []);
      setAnnotations(json.annotations || []);
      setSelectedTime(null);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [symbol, interval]);

  useEffect(() => {
    if (!priceEl.current || !macdEl.current || !rsiEl.current || !candles.length) return;

    const common = {
      layout: { background: { color: "#0b0e14" }, textColor: "#aeb8c7" },
      grid: { vertLines: { color: "#171d27" }, horzLines: { color: "#171d27" } },
      rightPriceScale: { borderColor: "#263040" },
      timeScale: { borderColor: "#263040", timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: "#8b5cf6" }, horzLine: { color: "#8b5cf6" } },
    } as const;

    const priceChart = createChart(priceEl.current, { ...common, height: Math.max(430, window.innerHeight * 0.52) });
    const macdChart = createChart(macdEl.current, { ...common, height: 220 });
    const rsiChart = createChart(rsiEl.current, { ...common, height: 220 });
    chartsRef.current = [priceChart, macdChart, rsiChart];

    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: "#24b47e", downColor: "#ef5350", borderVisible: false,
      wickUpColor: "#24b47e", wickDownColor: "#ef5350",
    });
    candleSeries.setData(candles.map((c) => ({ ...c, time: c.time as Time })));

    if (showSma) {
      const smaSeries = priceChart.addSeries(LineSeries, { lineWidth: 2, color: "#f5c451", priceLineVisible: false });
      const smaValues = sma(candles.map((c) => c.close), 50);
      smaSeries.setData(candles.map((c, i) => ({ time: c.time as Time, value: smaValues[i] })));
    }

    const histSeries = macdChart.addSeries(HistogramSeries, { priceLineVisible: false, base: 0 });
    histSeries.setData(values.map((p) => ({ time: p.time, value: p.histogram, color: p.histogram >= 0 ? "#29b6a6" : "#ef5350" })));
    const macdSeries = macdChart.addSeries(LineSeries, { color: "#42a5f5", lineWidth: 2, priceLineVisible: false });
    const signalSeries = macdChart.addSeries(LineSeries, { color: "#ffb74d", lineWidth: 2, priceLineVisible: false });
    macdSeries.setData(values.map((p) => ({ time: p.time, value: p.macd })));
    signalSeries.setData(values.map((p) => ({ time: p.time, value: p.signal })));

    const rsiSeries = rsiChart.addSeries(LineSeries, { color: "#ab47bc", lineWidth: 2, priceLineVisible: false });
    const rsiMaSeries = rsiChart.addSeries(LineSeries, { color: "#f5c451", lineWidth: 2, priceLineVisible: false });
    rsiSeries.setData(values.map((p) => ({ time: p.time, value: p.rsi })));
    rsiMaSeries.setData(values.map((p) => ({ time: p.time, value: p.rsiMa })));
    [30, 50, 70].forEach((level) => rsiSeries.createPriceLine({ price: level, color: level === 50 ? "#394657" : "#6d4c7d", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" }));

    const annotationMarkers: any[] = annotations.map((a) => ({
      time: a.time as Time,
      position: "aboveBar" as const,
      shape: "circle" as const,
      color: a.label === "perfect" ? "#28c76f" : a.label === "bad" ? "#ef5350" : a.label === "missed" ? "#8b5cf6" : "#f5c451",
      text: a.label === "missed" ? "○" : "",
      size: 1,
    }));
    if (selectedTime) {
      annotationMarkers.push({
        time: selectedTime as Time,
        position: "aboveBar",
        shape: "arrowDown",
        color: "#a855f7",
        text: "MOMENT",
        size: 2,
      });
    }
    createSeriesMarkers(candleSeries, annotationMarkers.sort((a, b) => Number(a.time) - Number(b.time)));

    let syncing = false;
    const syncRange = (source: IChartApi, targets: IChartApi[]) => {
      source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range || syncing) return;
        syncing = true;
        targets.forEach((target) => target.timeScale().setVisibleLogicalRange(range));
        syncing = false;
      });
    };
    syncRange(priceChart, [macdChart, rsiChart]);
    syncRange(macdChart, [priceChart, rsiChart]);
    syncRange(rsiChart, [priceChart, macdChart]);

    priceChart.subscribeClick((param) => {
      let clickedTime: number | null = null;

      const seriesPoint = param.seriesData.get(candleSeries) as { time?: Time } | undefined;
      if (seriesPoint?.time != null) {
        clickedTime = Number(seriesPoint.time);
      } else if (param.time != null) {
        const rawTime = Number(param.time);
        if (Number.isFinite(rawTime)) {
          let nearest = candles[0]?.time ?? null;
          let bestDistance = Number.POSITIVE_INFINITY;
          for (const candle of candles) {
            const distance = Math.abs(candle.time - rawTime);
            if (distance < bestDistance) {
              bestDistance = distance;
              nearest = candle.time;
            }
          }
          clickedTime = nearest;
        }
      }

      if (clickedTime == null) {
        setMessage("Keine Kerze getroffen. Bitte direkt auf einen Kerzenkörper klicken.");
        return;
      }

      setSelectedTime(clickedTime);
      setMessage("Moment gewählt – jetzt bewerten.");
    });

    priceChart.timeScale().fitContent();
    macdChart.timeScale().fitContent();
    rsiChart.timeScale().fitContent();

    const resize = () => {
      priceChart.applyOptions({ width: priceEl.current?.clientWidth || 800 });
      macdChart.applyOptions({ width: macdEl.current?.clientWidth || 800 });
      rsiChart.applyOptions({ width: rsiEl.current?.clientWidth || 800 });
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      priceChart.remove(); macdChart.remove(); rsiChart.remove();
      chartsRef.current = [];
    };
  }, [candles, values, annotations, selectedTime, showSma]);

  async function save(label: Label) {
    if (!selectedCandle) { setMessage("Bitte zuerst eine Kerze im Chart anklicken."); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`${BACKEND_BASE}/qmomentum/annotation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interval, time: selectedCandle.time, price: selectedCandle.close, label, note }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`);
      setAnnotations((previous) => [...previous.filter((a) => a.time !== json.annotation.time), json.annotation]);
      setNote("");
      setMessage(`${labelText(label)} gespeichert.`);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally { setSaving(false); }
  }

  return (
    <div className="qm-shell">
      <header className="qm-header">
        <div><h1>QMomentum Lab <span>V0.1</span></h1><p>Momentum sehen · Moment markieren · Alexander bewerten lassen</p></div>
        <div className="qm-stats">
          <span>👍 {stats.perfect}</span><span>👎 {stats.bad}</span><span>⭕ {stats.missed}</span><span>❓ {stats.unsure}</span>
        </div>
      </header>

      <div className="qm-toolbar">
        <label>Instrument<select value={symbol} onChange={(e) => setSymbol(e.target.value)}>{SYMBOLS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Timeframe<select value={interval} onChange={(e) => setInterval(e.target.value)}>{INTERVALS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="qm-check"><input type="checkbox" checked={showSma} onChange={(e) => setShowSma(e.target.checked)} /> SMA 50</label>
        <button onClick={load} disabled={loading}>{loading ? "Lädt …" : "Neu laden"}</button>
      </div>

      <main className="qm-main">
        <section className="qm-charts">
          <div className="qm-pane"><div className="qm-pane-title">KERZEN</div><div ref={priceEl} /></div>
          <div className="qm-pane"><div className="qm-pane-title"><span>MACD 12 / 26 / 9</span><span className="legend"><i className="blue"/>MACD <i className="orange"/>Signal</span></div><div ref={macdEl} /></div>
          <div className="qm-pane"><div className="qm-pane-title"><span>RSI 14</span><span className="legend"><i className="violet"/>RSI <i className="yellow"/>RSI MA 9</span></div><div ref={rsiEl} /></div>
        </section>

        <aside className="qm-panel">
          <div className="qm-eyebrow">GEWÄHLTER MOMENT</div>
          {selectedCandle && selectedIndicators ? <>
            <h2>{formatTime(selectedCandle.time)}</h2>
            <dl>
              <dt>Close</dt><dd>{selectedCandle.close.toFixed(2)}</dd>
              <dt>MACD</dt><dd>{selectedIndicators.macd.toFixed(5)}</dd>
              <dt>Signal</dt><dd>{selectedIndicators.signal.toFixed(5)}</dd>
              <dt>Histogramm</dt><dd>{selectedIndicators.histogram.toFixed(5)}</dd>
              <dt>RSI</dt><dd>{selectedIndicators.rsi.toFixed(2)}</dd>
              <dt>RSI MA</dt><dd>{selectedIndicators.rsiMa.toFixed(2)}</dd>
            </dl>
          </> : <div className="qm-empty">Klicke genau die Kerze an, an der der Momentum-Moment liegt.</div>}

          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz optional" />
          <div className="qm-actions">
            <button className="perfect" disabled={saving} onClick={() => save("perfect")}>👍<b>Perfekt</b></button>
            <button className="bad" disabled={saving} onClick={() => save("bad")}>👎<b>Schlecht</b></button>
            <button className="missed" disabled={saving} onClick={() => save("missed")}>⭕<b>Verpasst</b></button>
            <button className="unsure" disabled={saving} onClick={() => save("unsure")}>❓<b>Unsicher</b></button>
          </div>
          {message && <div className="qm-message">{message}</div>}
          <div className="qm-rule"><b>V0.1-Regel</b><span>Keine Trades. Keine Richtung. Nur: Ist hier ein besonderer Momentum-Moment?</span></div>
        </aside>
      </main>
    </div>
  );
}
