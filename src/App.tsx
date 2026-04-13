import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
} from "lightweight-charts";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type LinePoint = {
  time: number;
  value: number;
};

type MarkerPoint = {
  time: number;
  value: number;
  text?: string;
  color?: string;
};

type SignalBuildResult = {
  entries: MarkerPoint[];
  candidates: MarkerPoint[];
};

type WhitespaceLinePoint = {
  time: number;
  value?: number;
};

type PositionSide = "flat" | "long" | "short";

type AggTradeRow = {
  signal_id: string;
  received_at: string | null;
  epic: string;
  tf: string | null;
  action: string;
  size: number | null;
  exec_id: string | null;
  executed_at: string | null;
  deal_reference: string | null;
  confirm_status: number | null;
  confirm: any;
  position?: {
    state?: string | null;
    deal_id?: string | null;
    last_update?: string | null;
    source?: string | null;
  } | null;
};

type AggTradesResponse = {
  ok: boolean;
  epic: string | null;
  limit: number;
  rows: AggTradeRow[];
};

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const LIMIT = 500;
const AGG_LIMIT = 200;
const PRICE_SCALE_WIDTH = 90;

const INTERVALS = ["5m", "15m", "30m"] as const;
type IntervalOption = typeof INTERVALS[number];

const SYMBOLS = [
  "BTCUSD",
  "ETHUSD",
  "XRPUSD",
  "DE40",
  "US100",
  "US500",
  "US30",
  "J225",
  "UK100",
  "GOLD",
  "SILVER",
  "OIL_CRUDE",
  "CORN",
  "SOLUSD",
];

const ENTRY_BAND_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 330.05,
  ETHUSD: 25,
  XRPUSD: 0.015,
  DE40: 35,
  US100: 80,
  US500: 20,
  US30: 140,
  J225: 160,
  UK100: 45,
  GOLD: 22,
  SILVER: 0.22,
  OIL_CRUDE: 1.4,
  CORN: 1.4,
  SOLUSD: 1.0,
};

const PEAK_LOOKBACK_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 4,
  ETHUSD: 4,
  XRPUSD: 3,
  DE40: 3,
  US100: 3,
  US500: 3,
  US30: 3,
  J225: 3,
  UK100: 3,
  GOLD: 3,
  SILVER: 3,
  OIL_CRUDE: 3,
  CORN: 3,
  SOLUSD: 3,
};

const MIN_KINK_MOVE_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 25,
  ETHUSD: 1.5,
  XRPUSD: 0.002,
  DE40: 2,
  US100: 4,
  US500: 1,
  US30: 8,
  J225: 10,
  UK100: 3,
  GOLD: 0.8,
  SILVER: 0.03,
  OIL_CRUDE: 0.08,
  CORN: 0.08,
  SOLUSD: 0.08,
};

const SPREAD_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 25,
  ETHUSD: 1.2,
  XRPUSD: 0.01,
  DE40: 1.5,
  US100: 3,
  US500: 0.8,
  US30: 4,
  J225: 6,
  UK100: 2,
  GOLD: 0.35,
  SILVER: 0.05,
  OIL_CRUDE: 0.04,
  CORN: 0.7,
  SOLUSD: 0.08,
};

const SLIPPAGE_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 5,
  ETHUSD: 0.25,
  XRPUSD: 0.002,
  DE40: 0.3,
  US100: 0.5,
  US500: 0.2,
  US30: 0.8,
  J225: 1.0,
  UK100: 0.4,
  GOLD: 0.08,
  SILVER: 0.01,
  OIL_CRUDE: 0.01,
  CORN: 0.3,
  SOLUSD: 0.02,
};

export default function App() {
  const priceRef = useRef<HTMLDivElement | null>(null);
  const distRef = useRef<HTMLDivElement | null>(null);

  const priceChartRef = useRef<IChartApi | null>(null);
  const distChartRef = useRef<IChartApi | null>(null);

  const [symbol, setSymbol] = useState("BTCUSD");
  const [interval, setInterval] = useState<IntervalOption>("15m");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [lastTime, setLastTime] = useState<number | null>(null);

  const [liveState, setLiveState] = useState<PositionSide>("flat");
  const [brokerState, setBrokerState] = useState<PositionSide>("flat");

  const [longSignalCount, setLongSignalCount] = useState(0);
  const [shortSignalCount, setShortSignalCount] = useState(0);
  const [longExitCount, setLongExitCount] = useState(0);
  const [shortExitCount, setShortExitCount] = useState(0);

  const [blockedLongCount, setBlockedLongCount] = useState(0);
  const [blockedShortCount, setBlockedShortCount] = useState(0);
  const [realBuyCount, setRealBuyCount] = useState(0);
  const [realSellCount, setRealSellCount] = useState(0);
  const [realCloseCount, setRealCloseCount] = useState(0);

  const [lastSignalText, setLastSignalText] = useState("-");
  const [lastRealTradeText, setLastRealTradeText] = useState("-");

  const [tradeCount, setTradeCount] = useState(0);
  const [winCount, setWinCount] = useState(0);
  const [lossCount, setLossCount] = useState(0);
  const [grossProfit, setGrossProfit] = useState(0);
  const [grossLoss, setGrossLoss] = useState(0);
  const [profitFactor, setProfitFactor] = useState<number | null>(null);
  const [netPnL, setNetPnL] = useState(0);

  const entryBand = useMemo(() => ENTRY_BAND_BY_SYMBOL[symbol] ?? 100, [symbol]);
  const peakLookback = useMemo(() => PEAK_LOOKBACK_BY_SYMBOL[symbol] ?? 3, [symbol]);
  const minKinkMove = useMemo(() => MIN_KINK_MOVE_BY_SYMBOL[symbol] ?? 1, [symbol]);
  const assumedSpread = useMemo(() => SPREAD_BY_SYMBOL[symbol] ?? 0, [symbol]);
  const assumedSlippage = useMemo(() => SLIPPAGE_BY_SYMBOL[symbol] ?? 0, [symbol]);

  useEffect(() => {
    if (!priceRef.current || !distRef.current) return;

    const priceChart = createChart(priceRef.current, {
      width: priceRef.current.clientWidth,
      height: priceRef.current.clientHeight,
      layout: { background: { color: "#0f172a" }, textColor: "#fff" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: {
        borderColor: "#334155",
        minimumWidth: PRICE_SCALE_WIDTH,
      },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "#94a3b8", width: 1, style: 2 },
        horzLine: { color: "#94a3b8", width: 1, style: 2 },
      },
    });

    const distChart = createChart(distRef.current, {
      width: distRef.current.clientWidth,
      height: distRef.current.clientHeight,
      layout: { background: { color: "#0f172a" }, textColor: "#fff" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: {
        borderColor: "#334155",
        minimumWidth: PRICE_SCALE_WIDTH,
      },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "#94a3b8", width: 1, style: 2 },
        horzLine: { color: "#94a3b8", width: 1, style: 2 },
      },
    });

    syncCharts(priceChart, distChart);

    priceChartRef.current = priceChart;
    distChartRef.current = distChart;

    const resize = () => {
      if (priceRef.current) {
        priceChart.applyOptions({
          width: priceRef.current.clientWidth,
          height: priceRef.current.clientHeight,
        });
      }
      if (distRef.current) {
        distChart.applyOptions({
          width: distRef.current.clientWidth,
          height: distRef.current.clientHeight,
        });
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(priceRef.current);
    ro.observe(distRef.current);

    return () => {
      ro.disconnect();
      priceChart.remove();
      distChart.remove();
      priceChartRef.current = null;
      distChartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!priceChartRef.current || !distChartRef.current) return;

    let cancelled = false;

    const priceChart = priceChartRef.current;
    const distChart = distChartRef.current;

    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: "#00e5ff",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#00e5ff",
      wickDownColor: "#ef4444",
    });

    const sma10Series = priceChart.addSeries(LineSeries, {
      color: "#ffff00",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const sma100Series = priceChart.addSeries(LineSeries, {
      color: "#ffffff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const candidateLongSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#22c55e",
      lineVisible: false,
      pointMarkersVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const candidateShortSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#ef4444",
      lineVisible: false,
      pointMarkersVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const strategyLongSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#22c55e",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 5,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const strategyShortSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#ef4444",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 5,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const strategyLongExitSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#f59e0b",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const strategyShortExitSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#f59e0b",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const blockedLongSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#9ca3af",
      lineVisible: false,
      pointMarkersVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const blockedShortSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#9ca3af",
      lineVisible: false,
      pointMarkersVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const realBuySeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#00ff88",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const realSellSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#ff4d6d",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const realCloseSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#c084fc",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const distSeries = distChart.addSeries(LineSeries, {
      color: "#00f0ff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const zeroSeries = distChart.addSeries(LineSeries, {
      color: "#94a3b8",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const upperBandSeries = distChart.addSeries(LineSeries, {
      color: "#ff3b3b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const lowerBandSeries = distChart.addSeries(LineSeries, {
      color: "#ff3b3b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    async function loadData() {
      try {
        setStatus("loading");
        setError("");

        const [candles, aggRows, liveBrokerState] = await Promise.all([
          fetchCandles(symbol, interval),
          fetchAggTrades(symbol),
          fetchBrokerPositionState(symbol),
        ]);

        if (cancelled) return;
        if (!candles.length) throw new Error("No valid candles returned");

        const sma10 = sanitizeLinePoints(calcSMA(candles, 10));
        const sma100 = sanitizeLinePoints(calcSMA(candles, 100));
        const dist = sanitizeLinePoints(calcDistance(sma10, sma100));

        const longData = buildStableLongSignals(
          candles,
          dist,
          entryBand,
          peakLookback,
          minKinkMove
        );

        const shortData = buildStableShortSignals(
          candles,
          dist,
          entryBand,
          peakLookback,
          minKinkMove
        );

        const strategyLongPoints = longData.entries;
        const strategyShortPoints = shortData.entries;

        const sim = simulateStrategy(
          candles,
          dist,
          strategyLongPoints,
          strategyShortPoints,
          entryBand,
          assumedSpread,
          assumedSlippage
        );

        const real = buildRealTradeMarkers(candles, aggRows);

        const alignedDist = alignLineToCandles(candles, dist);
        const zeroLine = buildFlatLineFromCandles(candles, 0);
        const upperBand = buildFlatLineFromCandles(candles, entryBand);
        const lowerBand = buildFlatLineFromCandles(candles, -entryBand);

        candleSeries.setData(candles as any);

        sma10Series.setData(sma10 as any);
        sma100Series.setData(sma100 as any);

        const candidateLongProjected = projectMarkerPointsToCandles(longData.candidates, candles, "below-far");
        const candidateShortProjected = projectMarkerPointsToCandles(shortData.candidates, candles, "above-far");
        const strategyLongProjected = projectMarkerPointsToCandles(strategyLongPoints, candles, "below-mid");
        const strategyShortProjected = projectMarkerPointsToCandles(strategyShortPoints, candles, "above-mid");
        const longExitProjected = projectMarkerPointsToCandles(sim.longExitPoints, candles, "below-near");
        const shortExitProjected = projectMarkerPointsToCandles(sim.shortExitPoints, candles, "above-near");
        const blockedLongProjected = projectMarkerPointsToCandles(real.blockedLongPoints, candles, "below-mid");
        const blockedShortProjected = projectMarkerPointsToCandles(real.blockedShortPoints, candles, "above-mid");
        const realBuyProjected = projectMarkerPointsToCandles(real.realBuyPoints, candles, "below-near");
        const realSellProjected = projectMarkerPointsToCandles(real.realSellPoints, candles, "above-near");
        const realCloseProjected = projectMarkerPointsToCandles(real.realClosePoints, candles, "inside-mid");

        candidateLongSeries.setData(candidateLongProjected as any);
        candidateShortSeries.setData(candidateShortProjected as any);
        strategyLongSeries.setData(strategyLongProjected as any);
        strategyShortSeries.setData(strategyShortProjected as any);
        strategyLongExitSeries.setData(longExitProjected as any);
        strategyShortExitSeries.setData(shortExitProjected as any);

        blockedLongSeries.setData(blockedLongProjected as any);
        blockedShortSeries.setData(blockedShortProjected as any);
        realBuySeries.setData(realBuyProjected as any);
        realSellSeries.setData(realSellProjected as any);
        realCloseSeries.setData(realCloseProjected as any);

        createSeriesMarkers(candidateLongSeries, buildTextMarkers(candidateLongProjected, "belowBar"));
        createSeriesMarkers(candidateShortSeries, buildTextMarkers(candidateShortProjected, "aboveBar"));
        createSeriesMarkers(blockedLongSeries, buildTextMarkers(blockedLongProjected, "belowBar"));
        createSeriesMarkers(blockedShortSeries, buildTextMarkers(blockedShortProjected, "aboveBar"));

        distSeries.setData(alignedDist as any);
        zeroSeries.setData(zeroLine as any);
        upperBandSeries.setData(upperBand as any);
        lowerBandSeries.setData(lowerBand as any);

        priceChart.timeScale().fitContent();
        const range = priceChart.timeScale().getVisibleLogicalRange();
        if (range) distChart.timeScale().setVisibleLogicalRange(range);

        const last = candles[candles.length - 1];
        setLastPrice(last.close);
        setLastTime(last.time);

        setLiveState(sim.position);
        setLongSignalCount(strategyLongPoints.length);
        setShortSignalCount(strategyShortPoints.length);
        setLongExitCount(sim.longExitPoints.length);
        setShortExitCount(sim.shortExitPoints.length);

        setTradeCount(sim.tradeCount);
        setWinCount(sim.winCount);
        setLossCount(sim.lossCount);
        setGrossProfit(sim.grossProfit);
        setGrossLoss(sim.grossLoss);
        setNetPnL(sim.netPnL);
        setProfitFactor(
          sim.grossLoss > 0
            ? sim.grossProfit / sim.grossLoss
            : sim.grossProfit > 0
              ? Number.POSITIVE_INFINITY
              : null
        );

        setLastSignalText(sim.lastSignalText);

        setBlockedLongCount(real.blockedLongPoints.length);
        setBlockedShortCount(real.blockedShortPoints.length);
        setRealBuyCount(real.realBuyPoints.length);
        setRealSellCount(real.realSellPoints.length);
        setRealCloseCount(real.realClosePoints.length);
        setLastRealTradeText(real.lastRealTradeText);
        setBrokerState(liveBrokerState ?? real.brokerState);

        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error(err);
      }
    }

    loadData();

    return () => {
      cancelled = true;
      try {
        priceChart.removeSeries(candleSeries);
        priceChart.removeSeries(sma10Series);
        priceChart.removeSeries(sma100Series);
        priceChart.removeSeries(candidateLongSeries);
        priceChart.removeSeries(candidateShortSeries);
        priceChart.removeSeries(strategyLongSeries);
        priceChart.removeSeries(strategyShortSeries);
        priceChart.removeSeries(strategyLongExitSeries);
        priceChart.removeSeries(strategyShortExitSeries);
        priceChart.removeSeries(blockedLongSeries);
        priceChart.removeSeries(blockedShortSeries);
        priceChart.removeSeries(realBuySeries);
        priceChart.removeSeries(realSellSeries);
        priceChart.removeSeries(realCloseSeries);

        distChart.removeSeries(distSeries);
        distChart.removeSeries(zeroSeries);
        distChart.removeSeries(upperBandSeries);
        distChart.removeSeries(lowerBandSeries);
      } catch {}
    };
  }, [symbol, interval, entryBand, peakLookback, minKinkMove, assumedSpread, assumedSlippage]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0f172a",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
            <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          zIndex: 20,
          padding: "10px 12px",
          border: "1px solid #334155",
          borderRadius: 10,
          background: "rgba(2, 6, 23, 0.9)",
          color: "#e2e8f0",
          fontFamily: "Arial, sans-serif",
          fontSize: 13,
          lineHeight: 1.35,
          minWidth: 360,
          maxWidth: 430,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <label>
            Symbol{" "}
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label>
            TF{" "}
            <select value={interval} onChange={(e) => setInterval(e.target.value as IntervalOption)}>
              {INTERVALS.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>Status: {status}</div>
        <div>
          Strategy:{" "}
          <span
            style={{
              color:
                liveState === "long"
                  ? "#22c55e"
                  : liveState === "short"
                    ? "#ef4444"
                    : "#cbd5e1",
              fontWeight: 700,
            }}
          >
            {liveState.toUpperCase()}
          </span>
        </div>
        <div>
          Broker:{" "}
          <span
            style={{
              color:
                brokerState === "long"
                  ? "#00ff88"
                  : brokerState === "short"
                    ? "#ff4d6d"
                    : "#cbd5e1",
              fontWeight: 700,
            }}
          >
            {brokerState.toUpperCase()}
          </span>
        </div>
        <div>Last: {lastPrice !== null ? lastPrice.toFixed(2) : "-"}</div>
        <div>Time: {lastTime ? formatTime(lastTime) : "-"}</div>
        <div>TF: {interval}</div>
        <div>Entry band: {entryBand}</div>
        <div>Peak lookback: {peakLookback}</div>
        <div>Min kink: {minKinkMove}</div>
        <div>Assumed spread: {assumedSpread}</div>
        <div>Assumed slippage: {assumedSlippage}</div>

        <div>Long signals: {longSignalCount}</div>
        <div>Short signals: {shortSignalCount}</div>
        <div>Long exits: {longExitCount}</div>
        <div>Short exits: {shortExitCount}</div>

        <div>Blocked longs: {blockedLongCount}</div>
        <div>Blocked shorts: {blockedShortCount}</div>
        <div>Real buys: {realBuyCount}</div>
        <div>Real sells: {realSellCount}</div>
        <div>Real closes: {realCloseCount}</div>

        <div>Trades: {tradeCount}</div>
        <div>Wins / Losses: {winCount} / {lossCount}</div>
        <div>Gross Profit (net of costs): {grossProfit.toFixed(2)}</div>
        <div>Gross Loss (net of costs): {grossLoss.toFixed(2)}</div>
        <div>Net PnL: {netPnL.toFixed(2)}</div>
        <div>
          PF:{" "}
          {profitFactor === null
            ? "-"
            : Number.isFinite(profitFactor)
              ? profitFactor.toFixed(2)
              : "∞"}
        </div>

        <div>Last signal: {lastSignalText}</div>
        <div>Last real trade: {lastRealTradeText}</div>

        <div style={{ marginTop: 8, borderTop: "1px solid #334155", paddingTop: 8, fontSize: 12 }}>
          <div><span style={{ color: "#22c55e", fontWeight: 700 }}>KL</span> Kandidat long</div>
          <div><span style={{ color: "#ef4444", fontWeight: 700 }}>KS</span> Kandidat short</div>
          <div><span style={{ color: "#9ca3af", fontWeight: 700 }}>BL</span> Blocked long</div>
          <div><span style={{ color: "#9ca3af", fontWeight: 700 }}>BS</span> Blocked short</div>
          <div><span style={{ color: "#22c55e", fontWeight: 700 }}>●</span> Strategy long</div>
          <div><span style={{ color: "#ef4444", fontWeight: 700 }}>●</span> Strategy short</div>
          <div><span style={{ color: "#f59e0b", fontWeight: 700 }}>●</span> Strategy exit</div>
          <div><span style={{ color: "#00ff88", fontWeight: 700 }}>●</span> Real buy</div>
          <div><span style={{ color: "#ff4d6d", fontWeight: 700 }}>●</span> Real sell</div>
          <div><span style={{ color: "#c084fc", fontWeight: 700 }}>●</span> Real close</div>
        </div>

        {error ? <div style={{ color: "#fca5a5", marginTop: 6 }}>{error}</div> : null}
      </div>

      <div ref={priceRef} style={{ flex: "0 0 72%", minHeight: 0 }} />
      <div
        ref={distRef}
        style={{
          flex: "0 0 28%",
          minHeight: 0,
          borderTop: "1px solid #334155",
        }}
      />
    </div>
  );
}

async function fetchCandles(symbol: string, interval: string): Promise<Candle[]> {
  const url = new URL("/api/market-data/klines", BACKEND_BASE);
  url.searchParams.set("provider", "capital");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(LIMIT));

  const res = await fetch(url.toString(), { cache: "no-store" });
  const txt = await res.text();

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`LOAD ERROR non-JSON response: ${txt}`);
  }

  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || json?.info || `LOAD ERROR ${res.status}: ${txt}`);
  }

  return sanitizeCandles(json.candles || []);
}

async function fetchAggTrades(symbol: string): Promise<AggTradeRow[]> {
  const url = new URL("/agg/trades", BACKEND_BASE);
  url.searchParams.set("epic", symbol);
  url.searchParams.set("limit", String(AGG_LIMIT));
  url.searchParams.set("_ts", String(Date.now()));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return [];

  const txt = await res.text();

  let json: AggTradesResponse | null = null;
  try {
    json = JSON.parse(txt);
  } catch {
    return [];
  }

  if (!json?.ok || !Array.isArray(json.rows)) return [];
  return json.rows;
}

async function fetchBrokerPositionState(symbol: string): Promise<PositionSide | null> {
  try {
    const res = await fetch(
      `${BACKEND_BASE}/ui/broker-state?symbol=${symbol}&_ts=${Date.now()}`,
      { cache: "no-store" }
    );

    if (!res.ok) return null;

    const txt = await res.text();

    let json: any;
    try {
      json = JSON.parse(txt);
    } catch {
      return null;
    }

    const side = String(json?.side || "").toLowerCase();

    if (side === "long") return "long";
    if (side === "short") return "short";
    if (side === "flat") return "flat";

    return null;
  } catch {
    return null;
  }
}

function syncCharts(chartA: IChartApi, chartB: IChartApi) {
  let isUpdating = false;

  const syncFromA = (range: any) => {
    if (!range || isUpdating) return;
    isUpdating = true;
    chartB.timeScale().setVisibleLogicalRange(range);
    isUpdating = false;
  };

  const syncFromB = (range: any) => {
    if (!range || isUpdating) return;
    isUpdating = true;
    chartA.timeScale().setVisibleLogicalRange(range);
    isUpdating = false;
  };

  chartA.timeScale().subscribeVisibleLogicalRangeChange(syncFromA);
  chartB.timeScale().subscribeVisibleLogicalRangeChange(syncFromB);
}

function sanitizeCandles(data: any[]): Candle[] {
  return (data || [])
    .filter(
      (c) =>
        c &&
        c.time != null &&
        c.open != null &&
        c.high != null &&
        c.low != null &&
        c.close != null
    )
    .map((c) => ({
      time: Number(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        c.open > 0 &&
        c.high > 0 &&
        c.low > 0 &&
        c.close > 0
    );
}

function sanitizeLinePoints(points: any[]): LinePoint[] {
  return (points || [])
    .filter((p) => p && p.time != null && p.value != null)
    .map((p) => ({
      time: Number(p.time),
      value: Number(p.value),
    }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value));
}

function calcSMA(data: Candle[], len: number): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = len - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < len; j++) sum += data[i - j].close;
    out.push({ time: data[i].time, value: sum / len });
  }
  return out;
}

function calcDistance(a: LinePoint[], b: LinePoint[]): LinePoint[] {
  const map = new Map<number, number>();
  for (const p of b) map.set(p.time, p.value);

  return a
    .map((p) => {
      const other = map.get(p.time);
      if (other == null) return null;
      const value = p.value - other;
      if (!Number.isFinite(value)) return null;
      return { time: p.time, value };
    })
    .filter(Boolean) as LinePoint[];
}

function alignLineToCandles(candles: Candle[], line: LinePoint[]): WhitespaceLinePoint[] {
  const map = new Map<number, number>();
  for (const p of line) map.set(p.time, p.value);

  return candles.map((c) => {
    const value = map.get(c.time);
    if (value == null || !Number.isFinite(value)) return { time: c.time };
    return { time: c.time, value };
  });
}

function buildFlatLineFromCandles(candles: Candle[], value: number): LinePoint[] {
  return candles.map((c) => ({ time: c.time, value }));
}

function buildStableLongSignals(
  candles: Candle[],
  dist: LinePoint[],
  entryBand: number,
  _peakLookback: number,
  minKinkMove: number
): SignalBuildResult {
  const candleMap = new Map<number, Candle>();
  for (const c of candles) candleMap.set(c.time, c);

  const markers: MarkerPoint[] = [];
  const candidateMarkers: MarkerPoint[] = [];

  let inZone = false;
  let candidateIndex = -1;
  let candidateValue = Number.POSITIVE_INFINITY;
  let fired = false;

  for (let i = 1; i < dist.length; i++) {
    const d = dist[i].value;
    const inLowerZone = d < -entryBand;

    if (!inZone && inLowerZone) {
      inZone = true;
      candidateIndex = i;
      candidateValue = d;
      fired = false;
      continue;
    }

    if (inZone && !inLowerZone) {
      inZone = false;
      candidateIndex = -1;
      candidateValue = Number.POSITIVE_INFINITY;
      fired = false;
      continue;
    }

    if (!inZone) continue;

    if (d <= candidateValue) {
      candidateValue = d;
      candidateIndex = i;
    }

    const move = d - candidateValue;

    if (!fired && move >= minKinkMove && candidateIndex >= 0) {
      const t = dist[candidateIndex].time;
      const c = candleMap.get(t);

      if (c) {
        candidateMarkers.push({
          time: t,
          value: c.low,
          text: "KL",
          color: "#22c55e",
        });

        markers.push({
          time: t,
          value: c.low,
        });

        fired = true;
      }
    }
  }

  return {
    entries: dedupeMarkers(markers),
    candidates: dedupeMarkers(candidateMarkers),
  };
}

function buildStableShortSignals(
  candles: Candle[],
  dist: LinePoint[],
  entryBand: number,
  _peakLookback: number,
  minKinkMove: number
): SignalBuildResult {
  const candleMap = new Map<number, Candle>();
  for (const c of candles) candleMap.set(c.time, c);

  const markers: MarkerPoint[] = [];
  const candidateMarkers: MarkerPoint[] = [];

  let inZone = false;
  let candidateIndex = -1;
  let candidateValue = Number.NEGATIVE_INFINITY;
  let fired = false;

  for (let i = 1; i < dist.length; i++) {
    const d = dist[i].value;
    const inUpperZone = d > entryBand;

    if (!inZone && inUpperZone) {
      inZone = true;
      candidateIndex = i;
      candidateValue = d;
      fired = false;
      continue;
    }

    if (inZone && !inUpperZone) {
      inZone = false;
      candidateIndex = -1;
      candidateValue = Number.NEGATIVE_INFINITY;
      fired = false;
      continue;
    }

    if (!inZone) continue;

    if (d >= candidateValue) {
      candidateValue = d;
      candidateIndex = i;
    }

    const move = candidateValue - d;

    if (!fired && move >= minKinkMove && candidateIndex >= 0) {
      const t = dist[candidateIndex].time;
      const c = candleMap.get(t);

      if (c) {
        candidateMarkers.push({
          time: t,
          value: c.high,
          text: "KS",
          color: "#ef4444",
        });

        markers.push({
          time: t,
          value: c.high,
        });

        fired = true;
      }
    }
  }

  return {
    entries: dedupeMarkers(markers),
    candidates: dedupeMarkers(candidateMarkers),
  };
}

function dedupeMarkers(points: MarkerPoint[]): MarkerPoint[] {
  const out: MarkerPoint[] = [];
  const seen = new Set<string>();

  for (const p of points) {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.value) || p.value <= 0) continue;
    const key = `${p.time}-${p.value}-${p.label ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }

  return out;
}

function projectMarkerPointsToCandles(
  points: MarkerPoint[],
  candles: Candle[],
  placement: "below-far" | "below-mid" | "below-near" | "above-far" | "above-mid" | "above-near" | "inside-mid"
): MarkerPoint[] {
  const candleMap = new Map<number, Candle>();
  for (const c of candles) candleMap.set(c.time, c);

  const out: MarkerPoint[] = [];

  for (const p of points) {
    const candle = candleMap.get(p.time);
    if (!candle) continue;
    if (!Number.isFinite(p.value) || p.value <= 0) continue;

    const projected = projectMarkerValue(candle, placement);
    if (!Number.isFinite(projected) || projected <= 0) continue;

    const minAllowed = candle.low * 0.985;
    const maxAllowed = candle.high * 1.015;
    const clamped = Math.min(Math.max(projected, minAllowed), maxAllowed);

    out.push({ ...p, value: clamped });
  }

  return dedupeMarkers(out);
}

function projectMarkerValue(
  candle: Candle,
  placement: "below-far" | "below-mid" | "below-near" | "above-far" | "above-mid" | "above-near" | "inside-mid"
): number {
  const range = Math.max(candle.high - candle.low, Math.abs(candle.close) * 0.0012);
  const far = range * 0.32;
  const mid = range * 0.20;
  const near = range * 0.10;
  const bodyMid = (candle.open + candle.close) / 2;

  switch (placement) {
    case "below-far":
      return candle.low - far;
    case "below-mid":
      return candle.low - mid;
    case "below-near":
      return candle.low - near;
    case "above-far":
      return candle.high + far;
    case "above-mid":
      return candle.high + mid;
    case "above-near":
      return candle.high + near;
    case "inside-mid":
    default:
      return bodyMid;
  }
}

function buildTextMarkers(points: MarkerPoint[], position: "aboveBar" | "belowBar") {
  return points
    .filter((p) => p.label)
    .map((p) => ({
      time: p.time,
      position,
      color: p.color ?? "#9ca3af",
      shape: "circle",
      text: p.label ?? "",
    })) as any;
}

function simulateStrategy(
  candles: Candle[],
  dist: LinePoint[],
  longEntries: MarkerPoint[],
  shortEntries: MarkerPoint[],
  _entryBand: number,
  assumedSpread: number,
  assumedSlippage: number
) {
  const candleMap = new Map<number, Candle>();
  for (const c of candles) candleMap.set(c.time, c);

  const distMapIndex = new Map<number, number>();
  dist.forEach((p, i) => distMapIndex.set(p.time, i));

  const longExitPoints: MarkerPoint[] = [];
  const shortExitPoints: MarkerPoint[] = [];

  const entryEvents = [
    ...longEntries.map((p) => ({
      time: p.time,
      side: "long" as const,
      index: distMapIndex.get(p.time) ?? -1,
    })),
    ...shortEntries.map((p) => ({
      time: p.time,
      side: "short" as const,
      index: distMapIndex.get(p.time) ?? -1,
    })),
  ]
    .filter((x) => x.index >= 0)
    .sort((a, b) => a.index - b.index);

  let position: PositionSide = "flat";
  let openTrade: { side: "long" | "short"; entryPrice: number } | null = null;

  let tradeCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  let currentEntryPtr = 0;
  let prevDistValue: number | null = null;

  let shortEmergencyArmed = false;
  let longEmergencyArmed = false;
  let shortBestAfterArm = Number.POSITIVE_INFINITY;
  let longBestAfterArm = Number.NEGATIVE_INFINITY;

  const perSideCost = assumedSpread / 2 + assumedSlippage;

  const realisticEntryPrice = (side: "long" | "short", candle: Candle) =>
    side === "long" ? candle.close + perSideCost : candle.close - perSideCost;

  const realisticExitPrice = (side: "long" | "short", candle: Candle) =>
    side === "long" ? candle.close - perSideCost : candle.close + perSideCost;

  const closeTrade = (candle: Candle, side: "long" | "short") => {
    if (!openTrade) return;

    const exitPrice = realisticExitPrice(side, candle);
    const pnl =
      openTrade.side === "long"
        ? exitPrice - openTrade.entryPrice
        : openTrade.entryPrice - exitPrice;

    tradeCount += 1;

    if (pnl >= 0) {
      winCount += 1;
      grossProfit += pnl;
    } else {
      lossCount += 1;
      grossLoss += Math.abs(pnl);
    }

    openTrade = null;
    position = "flat";
  };

  for (let i = 0; i < dist.length; i++) {
    const p = dist[i];
    const candle = candleMap.get(p.time);
    if (!candle) continue;

    while (currentEntryPtr < entryEvents.length && entryEvents[currentEntryPtr].index === i) {
      const event = entryEvents[currentEntryPtr];

      if (event.side === "long") {
        if (position === "short" && openTrade) {
          shortExitPoints.push({ time: candle.time, value: candle.high });
          closeTrade(candle, "short");
        }

        if (position === "flat") {
          openTrade = {
            side: "long",
            entryPrice: realisticEntryPrice("long", candle),
          };
          position = "long";
          longEmergencyArmed = false;
          longBestAfterArm = Number.NEGATIVE_INFINITY;
        }
      } else {
        if (position === "long" && openTrade) {
          longExitPoints.push({ time: candle.time, value: candle.low });
          closeTrade(candle, "long");
        }

        if (position === "flat") {
          openTrade = {
            side: "short",
            entryPrice: realisticEntryPrice("short", candle),
          };
          position = "short";
          shortEmergencyArmed = false;
          shortBestAfterArm = Number.POSITIVE_INFINITY;
        }
      }

      currentEntryPtr += 1;
    }

    if (prevDistValue !== null) {
      if (position === "long" && openTrade) {
        if (!longEmergencyArmed && prevDistValue < 0 && p.value >= 0) {
          longEmergencyArmed = true;
          longBestAfterArm = p.value;
        }

        if (longEmergencyArmed) {
          if (p.value > longBestAfterArm) longBestAfterArm = p.value;

          const rollback = longBestAfterArm - p.value;
          if (rollback > 0 && rollback >= Math.max(0.000001, Math.abs(longBestAfterArm) * 0.15)) {
            longExitPoints.push({ time: candle.time, value: candle.low });
            closeTrade(candle, "long");
            longEmergencyArmed = false;
            longBestAfterArm = Number.NEGATIVE_INFINITY;
          }
        }
      }

      if (position === "short" && openTrade) {
        if (!shortEmergencyArmed && prevDistValue > 0 && p.value <= 0) {
          shortEmergencyArmed = true;
          shortBestAfterArm = p.value;
        }

        if (shortEmergencyArmed) {
          if (p.value < shortBestAfterArm) shortBestAfterArm = p.value;

          const rollback = p.value - shortBestAfterArm;
          if (rollback > 0 && rollback >= Math.max(0.000001, Math.abs(shortBestAfterArm) * 0.15)) {
            shortExitPoints.push({ time: candle.time, value: candle.high });
            closeTrade(candle, "short");
            shortEmergencyArmed = false;
            shortBestAfterArm = Number.POSITIVE_INFINITY;
          }
        }
      }
    }

    prevDistValue = p.value;
  }

  const netPnL = grossProfit - grossLoss;

  let lastSignalText = "-";
  const lastLong = longEntries.length ? longEntries[longEntries.length - 1].time : null;
  const lastShort = shortEntries.length ? shortEntries[shortEntries.length - 1].time : null;

  if (lastLong && lastShort) {
    lastSignalText = lastLong > lastShort ? `LONG ${formatTime(lastLong)}` : `SHORT ${formatTime(lastShort)}`;
  } else if (lastLong) {
    lastSignalText = `LONG ${formatTime(lastLong)}`;
  } else if (lastShort) {
    lastSignalText = `SHORT ${formatTime(lastShort)}`;
  }

  return {
    position,
    longExitPoints: dedupeMarkers(longExitPoints),
    shortExitPoints: dedupeMarkers(shortExitPoints),
    tradeCount,
    winCount,
    lossCount,
    grossProfit,
    grossLoss,
    netPnL,
    lastSignalText,
  };
}

function buildRealTradeMarkers(candles: Candle[], rows: AggTradeRow[]) {
  const realBuyPoints: MarkerPoint[] = [];
  const realSellPoints: MarkerPoint[] = [];
  const realClosePoints: MarkerPoint[] = [];
  const blockedLongPoints: MarkerPoint[] = [];
  const blockedShortPoints: MarkerPoint[] = [];

  let lastRealTradeText = "-";
  let brokerState: PositionSide = "flat";

  const sorted = [...rows].sort(
    (a, b) => toUnixSec(a.received_at ?? a.executed_at) - toUnixSec(b.received_at ?? b.executed_at)
  );

  for (const row of sorted) {
    const baseTime = toUnixSec(row.executed_at ?? row.received_at);
    if (!baseTime) continue;

    const candleNear = findNearestCandle(candles, baseTime);
    const price = extractTradePrice(row, candleNear);

    if (price === null || !Number.isFinite(price) || price <= 0) continue;
    if (candleNear && Math.abs(price - candleNear.close) / candleNear.close > 0.2) continue;

    const executed = Boolean(row.exec_id || row.executed_at);

    if ((row.action === "buy" || row.action === "sell") && !executed) {
      if (row.action === "buy") {
        blockedLongPoints.push({
          time: baseTime,
          value: candleNear?.low ?? price,
          label: "BL",
          color: "#9ca3af",
        });
      } else {
        blockedShortPoints.push({
          time: baseTime,
          value: candleNear?.high ?? price,
          label: "BS",
          color: "#9ca3af",
        });
      }
      continue;
    }

    if (!executed) continue;

    if (row.action === "buy") {
      realBuyPoints.push({ time: baseTime, value: price });
      lastRealTradeText = `BUY ${formatTime(baseTime)}`;
      brokerState = "long";
    } else if (row.action === "sell") {
      realSellPoints.push({ time: baseTime, value: price });
      lastRealTradeText = `SELL ${formatTime(baseTime)}`;
      brokerState = "short";
    } else if (row.action === "close") {
      realClosePoints.push({ time: baseTime, value: price });
      lastRealTradeText = `CLOSE ${formatTime(baseTime)}`;
      brokerState = "flat";
    }
  }

  const latestRow = sorted.length ? sorted[sorted.length - 1] : null;
  const latestPositionState = normalizeBrokerState(latestRow?.position?.state ?? null);
  if (latestPositionState) brokerState = latestPositionState;

  return {
    realBuyPoints: dedupeMarkers(realBuyPoints),
    realSellPoints: dedupeMarkers(realSellPoints),
    realClosePoints: dedupeMarkers(realClosePoints),
    blockedLongPoints: dedupeMarkers(blockedLongPoints),
    blockedShortPoints: dedupeMarkers(blockedShortPoints),
    lastRealTradeText,
    brokerState,
  };
}

function toUnixSec(v: string | null | undefined): number {
  if (!v) return 0;
  const ms = Date.parse(v);
  if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000);

  const normalized = v.replace(" ", "T");
  const ms2 = Date.parse(normalized);
  if (Number.isFinite(ms2) && ms2 > 0) return Math.floor(ms2 / 1000);

  return 0;
}

function findNearestCandle(candles: Candle[], ts: number): Candle | null {
  if (!candles.length || !ts) return null;

  let best: Candle | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const c of candles) {
    const diff = Math.abs(c.time - ts);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }

  return best;
}

function pickNumber(...values: any[]): number | null {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractTradePrice(row: AggTradeRow, candleNear: Candle | null): number | null {
  const confirm = row.confirm ?? {};

  return pickNumber(
    confirm?.level,
    confirm?.price,
    confirm?.fillPrice,
    confirm?.filledPrice,
    confirm?.stopLevel,
    confirm?.limitLevel,
    candleNear?.close,
    candleNear?.open
  );
}

function normalizeBrokerState(v: string | null): PositionSide | null {
  if (!v) return null;
  const s = String(v).toLowerCase();

  if (s.includes("buy") || s.includes("long")) return "long";
  if (s.includes("sell") || s.includes("short")) return "short";
  if (s.includes("flat") || s.includes("closed") || s.includes("close")) return "flat";

  return null;
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("de-DE", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
