import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
} from "lightweight-charts";

type Provider = "binance" | "capital";
type PositionSide = "flat" | "long" | "short";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type LinePoint = { time: number; value: number };
type LineOrWhitespace = { time: number; value: number } | { time: number };
type SignalEvent = { index: number; time: number; side: "long" | "short"; price: number };

type BinanceKlineRow = [
  number, string, string, string, string, string,
  number, string, number, string, string, string
];

type CapitalKlineResponse = {
  ok: boolean;
  provider: "capital";
  symbol: string;
  interval: string;
  candles: Candle[];
  count?: number;
  time?: string;
  error?: string;
  info?: string;
};

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

const LIMIT = 5000;
const AUTO_REFRESH_MS = 20000;
const AGG_LIMIT = 200;

const PROVIDER_SYMBOLS: Record<Provider, string[]> = {
  binance: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT"],
  capital: [
    "BTCUSD",
    "ETHUSD",
    "XRPUSD",
    "SHIBUSD",
    "US30",
    "US100",
    "US500",
    "DE40",
    "J225",
    "UK100",
    "GOLD",
    "SILVER",
    "OIL_CRUDE",
    "CORN",
    "SOLUSD",
  ],
};

const PROVIDER_INTERVALS: Record<Provider, string[]> = {
  binance: ["1m", "5m", "15m", "30m", "1h", "4h"],
  capital: ["1m", "5m", "10m", "15m", "23m", "30m", "1h", "4h"],
};

const ENTRY_BAND_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 330.05,
  ETHUSD: 25,
  XRPUSD: 0.015,
  SHIBUSD: 0.01,
  US30: 120,
  US100: 80,
  US500: 20,
  DE40: 35,
  J225: 330,
  UK100: 40,
  GOLD: 22,
  SILVER: 0.22,
  OIL_CRUDE: 1.4,

  BTCUSDT: 580.05,
  ETHUSDT: 45,
  BNBUSDT: 15,
  XRPUSDT: 0.015,
  SOLUSD: 1.0,
  CORN: 1.4,
};

const PEAK_LOOKBACK_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 4,
  ETHUSD: 4,
  XRPUSD: 3,
  SHIBUSD: 3,
  US30: 3,
  US100: 3,
  US500: 3,
  DE40: 3,
  J225: 3,
  UK100: 3,
  GOLD: 3,
  SILVER: 3,
  OIL_CRUDE: 3,

  BTCUSDT: 4,
  ETHUSDT: 4,
  BNBUSDT: 3,
  XRPUSDT: 3,
  SOLUSD: 3,
  CORN: 3,
};

const SPREAD_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 25,
  ETHUSD: 1.2,
  XRPUSD: 0.01,
  SHIBUSD: 0.08,
  US30: 4,
  US100: 3,
  US500: 0.8,
  DE40: 1.5,
  J225: 8,
  UK100: 1.5,
  GOLD: 0.35,
  SILVER: 0.05,
  OIL_CRUDE: 0.04,

  BTCUSDT: 20,
  ETHUSDT: 1.0,
  BNBUSDT: 0.3,
  XRPUSDT: 0.01,
  SOLUSD: 0.08,
  CORN: 0.7,
};

const SLIPPAGE_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 5,
  ETHUSD: 0.25,
  XRPUSD: 0.002,
  SHIBUSD: 0.02,
  US30: 0.8,
  US100: 0.5,
  US500: 0.2,
  DE40: 0.3,
  J225: 1.5,
  UK100: 0.3,
  GOLD: 0.08,
  SILVER: 0.01,
  OIL_CRUDE: 0.01,

  BTCUSDT: 4,
  ETHUSDT: 0.2,
  BNBUSDT: 0.08,
  XRPUSDT: 0.002,
  SOLUSD: 0.02,
  CORN: 0.3,
};

export default function App() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pricePaneRef = useRef<HTMLDivElement | null>(null);
  const distPaneRef = useRef<HTMLDivElement | null>(null);

  const priceChartRef = useRef<IChartApi | null>(null);
  const distChartRef = useRef<IChartApi | null>(null);

  const candlesSeriesRef = useRef<any>(null);
  const sma10SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma100SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const strategyLongEntrySeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const strategyShortEntrySeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const strategyLongExitSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const strategyShortExitSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const blockedLongSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const blockedShortSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const realBuySeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const realSellSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const realCloseSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const distSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const zeroSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const upperBandSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lowerBandSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const candlesDataRef = useRef<Candle[]>([]);

  const isAutoFollowRef = useRef(true);
  const suppressLogicalRangeRef = useRef(false);

  const [provider, setProvider] = useState<Provider>("capital");
  const [symbol, setSymbol] = useState("BTCUSD");
  const [interval, setIntervalValue] = useState("15m");
  const [backendBase, setBackendBase] = useState("https://qtrend-trading-engine.onrender.com");

  const [chartReady, setChartReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [liveState, setLiveState] = useState<PositionSide>("flat");
  const [brokerState, setBrokerState] = useState<PositionSide>("flat");
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [lastTime, setLastTime] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

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

  const entryBand = ENTRY_BAND_BY_SYMBOL[symbol] ?? 100;
  const peakLookback = PEAK_LOOKBACK_BY_SYMBOL[symbol] ?? 3;
  const exitStrengthFactor = 0.5;
  const assumedSpread = SPREAD_BY_SYMBOL[symbol] ?? 0;
  const assumedSlippage = SLIPPAGE_BY_SYMBOL[symbol] ?? 0;

  const headerText = useMemo(() => {
    const stateColor =
      liveState === "long" ? "#22c55e" : liveState === "short" ? "#ef4444" : "#cbd5e1";
    return { color: stateColor, label: liveState.toUpperCase() };
  }, [liveState]);

  const brokerHeaderText = useMemo(() => {
    const stateColor =
      brokerState === "long" ? "#00ff88" : brokerState === "short" ? "#ff4d6d" : "#cbd5e1";
    return { color: stateColor, label: brokerState.toUpperCase() };
  }, [brokerState]);

  const displayStatus = errorMsg ? "error" : lastPrice !== null ? "ready" : isLoading ? "loading" : "idle";

  useEffect(() => {
    const symbols = PROVIDER_SYMBOLS[provider];
    if (!symbols.includes(symbol)) setSymbol(symbols[0]);

    const intervals = PROVIDER_INTERVALS[provider];
    if (!intervals.includes(interval)) setIntervalValue(intervals[0]);
  }, [provider, symbol, interval]);

  useEffect(() => {
    if (!rootRef.current || !pricePaneRef.current || !distPaneRef.current) return;

    const priceEl = pricePaneRef.current;
    const distEl = distPaneRef.current;

    const priceChart = createChart(priceEl, {
      width: priceEl.clientWidth,
      height: priceEl.clientHeight,
      layout: { background: { color: "#0f172a" }, textColor: "#d1d5db" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderColor: "#334155", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { visible: true, timeVisible: true, secondsVisible: false, borderColor: "#334155" },
      localization: {
        locale: "de-DE",
        timeFormatter: (time: number) => formatTime(time),
      },
      crosshair: {
        vertLine: { color: "#94a3b8", width: 1, style: 2 },
        horzLine: { color: "#94a3b8", width: 1, style: 2 },
      },
    });

    const distChart = createChart(distEl, {
      width: distEl.clientWidth,
      height: distEl.clientHeight,
      layout: { background: { color: "#0f172a" }, textColor: "#d1d5db" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderColor: "#334155", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { visible: true, timeVisible: true, secondsVisible: false, borderColor: "#334155" },
      localization: {
        locale: "de-DE",
        timeFormatter: (time: number) => formatTime(time),
      },
      crosshair: {
        vertLine: { color: "#94a3b8", width: 1, style: 2 },
        horzLine: { color: "#94a3b8", width: 1, style: 2 },
      },
    });

    candlesSeriesRef.current = priceChart.addSeries(CandlestickSeries, {
      upColor: "#00e5ff",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#00e5ff",
      wickDownColor: "#ef4444",
    });

    sma10SeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#ffff00",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    sma100SeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#ffffff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    strategyLongEntrySeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#22c55e",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 6,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    strategyShortEntrySeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#ef4444",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 6,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    strategyLongExitSeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 5,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    strategyShortExitSeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 5,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    blockedLongSeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#94a3b8",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 7,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    blockedShortSeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#64748b",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 7,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    realBuySeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#00ff88",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 8,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    realSellSeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#ff4d6d",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 8,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    realCloseSeriesRef.current = priceChart.addSeries(LineSeries, {
      color: "#c084fc",
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 8,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    distSeriesRef.current = distChart.addSeries(LineSeries, {
      color: "#00f0ff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    zeroSeriesRef.current = distChart.addSeries(LineSeries, {
      color: "#94a3b8",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    upperBandSeriesRef.current = distChart.addSeries(LineSeries, {
      color: "#ff3b3b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    lowerBandSeriesRef.current = distChart.addSeries(LineSeries, {
      color: "#ff3b3b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    syncCharts(priceChart, distChart, isAutoFollowRef, suppressLogicalRangeRef);

    priceChartRef.current = priceChart;
    distChartRef.current = distChart;
    setChartReady(true);

    const resizeObserver = new ResizeObserver(() => {
      priceChart.resize(priceEl.clientWidth, priceEl.clientHeight);
      distChart.resize(distEl.clientWidth, distEl.clientHeight);
    });

    resizeObserver.observe(rootRef.current);
    resizeObserver.observe(priceEl);
    resizeObserver.observe(distEl);

    return () => {
      resizeObserver.disconnect();
      priceChart.remove();
      distChart.remove();
      priceChartRef.current = null;
      distChartRef.current = null;
      candlesSeriesRef.current = null;
      sma10SeriesRef.current = null;
      sma100SeriesRef.current = null;
      strategyLongEntrySeriesRef.current = null;
      strategyShortEntrySeriesRef.current = null;
      strategyLongExitSeriesRef.current = null;
      strategyShortExitSeriesRef.current = null;
      blockedLongSeriesRef.current = null;
      blockedShortSeriesRef.current = null;
      realBuySeriesRef.current = null;
      realSellSeriesRef.current = null;
      realCloseSeriesRef.current = null;
      distSeriesRef.current = null;
      zeroSeriesRef.current = null;
      upperBandSeriesRef.current = null;
      lowerBandSeriesRef.current = null;
      setChartReady(false);
    };
  }, []);

  useEffect(() => {
    if (!chartReady) return;

    const t1 = window.setTimeout(() => setReloadKey((x) => x + 1), 300);
    const t2 = window.setTimeout(() => {
      if (candlesDataRef.current.length === 0) setReloadKey((x) => x + 1);
    }, 1200);
    const t3 = window.setTimeout(() => {
      if (candlesDataRef.current.length === 0) setReloadKey((x) => x + 1);
    }, 2500);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [chartReady]);

  useEffect(() => {
    if (!chartReady) return;
    if (!candlesSeriesRef.current || !sma10SeriesRef.current || !sma100SeriesRef.current) return;

    let aborted = false;

    const renderAll = (aggRows: AggTradeRow[]) => {
      const candles = candlesDataRef.current;
      if (!candles.length) return;

      const sma10 = calcSMA(candles, 10);
      const sma100 = calcSMA(candles, 100);
      const dist = calcDistance(sma10, sma100);

      candlesSeriesRef.current.setData(candles as any);
      sma10SeriesRef.current!.setData(sma10 as any);
      sma100SeriesRef.current!.setData(sma100 as any);
      distSeriesRef.current!.setData(alignLineToCandles(candles, dist) as any);
      zeroSeriesRef.current!.setData(buildFlatLine(candles, 0) as any);
      upperBandSeriesRef.current!.setData(buildFlatLine(candles, entryBand) as any);
      lowerBandSeriesRef.current!.setData(buildFlatLine(candles, -entryBand) as any);

      const candleMap = new Map<number, Candle>();
      for (const c of candles) candleMap.set(c.time, c);

      const longSignals: number[] = [];
      const shortSignals: number[] = [];
      const strategyLongEntryPoints: LinePoint[] = [];
      const strategyShortEntryPoints: LinePoint[] = [];
      const strategyLongExitPoints: LinePoint[] = [];
      const strategyShortExitPoints: LinePoint[] = [];
      const entryEvents: SignalEvent[] = [];

      let inLongZone = false;
      let longZoneStart = -1;
      let inShortZone = false;
      let shortZoneStart = -1;

      const MIN_VALID_INDEX = 120;

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
              strategyLongEntryPoints.push({ time: t, value: c.low });
              entryEvents.push({ index: best, time: t, side: "long", price: c.low });
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
              strategyShortEntryPoints.push({ time: t, value: c.high });
              entryEvents.push({ index: best, time: t, side: "short", price: c.high });
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
            strategyLongEntryPoints.push({ time: t, value: c.low });
            entryEvents.push({ index: best, time: t, side: "long", price: c.low });
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
            strategyShortEntryPoints.push({ time: t, value: c.high });
            entryEvents.push({ index: best, time: t, side: "short", price: c.high });
          }
        }
      }

      const orderedEntries = entryEvents.sort((a, b) => (a.index - b.index) || (a.side === "short" ? 1 : -1));

      let closedTradeCount = 0;
      let closedWinCount = 0;
      let closedLossCount = 0;
      let closedGrossProfit = 0;
      let closedGrossLoss = 0;
      let openTrade: { side: "long" | "short"; entryPrice: number; entryTime: number } | null = null;

      const perSideCost = assumedSpread / 2 + assumedSlippage;

      const realisticEntryPrice = (side: "long" | "short", candle: Candle) => {
        const base = candle.close;
        return side === "long" ? base + perSideCost : base - perSideCost;
      };

      const realisticExitPrice = (side: "long" | "short", candle: Candle) => {
        const base = candle.close;
        return side === "long" ? base - perSideCost : base + perSideCost;
      };

      const closeOpenTrade = (exitPrice: number) => {
        if (!openTrade) return;
        const pnl = openTrade.side === "long"
          ? exitPrice - openTrade.entryPrice
          : openTrade.entryPrice - exitPrice;

        closedTradeCount += 1;
        if (pnl >= 0) {
          closedWinCount += 1;
          closedGrossProfit += pnl;
        } else {
          closedLossCount += 1;
          closedGrossLoss += Math.abs(pnl);
        }
        openTrade = null;
      };

      let position: PositionSide = "flat";
      let nextEntryPtr = 0;

      let shortEmergencyArmed = false;
      let longEmergencyArmed = false;
      let prevDistValue: number | null = null;

      let shortBestAfterArm = Number.POSITIVE_INFINITY;
      let longBestAfterArm = Number.NEGATIVE_INFINITY;

      for (let i = MIN_VALID_INDEX; i < dist.length; i++) {
        while (nextEntryPtr < orderedEntries.length && orderedEntries[nextEntryPtr].index === i) {
          const evt = orderedEntries[nextEntryPtr];
          const entryCandle = candleMap.get(evt.time);
          const entryPrice = entryCandle ? realisticEntryPrice(evt.side, entryCandle) : evt.price;

          if (openTrade && entryCandle) {
            closeOpenTrade(realisticExitPrice(openTrade.side, entryCandle));
          }
          openTrade = { side: evt.side, entryPrice, entryTime: evt.time };

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
              strategyShortExitPoints.push({ time: p.time, value: candle.high });
              closeOpenTrade(realisticExitPrice("short", candle));
              position = "flat";
              shortEmergencyArmed = false;
              shortBestAfterArm = Number.POSITIVE_INFINITY;
              prevDistValue = p.value;
              continue;
            }

            if (strongTrend && lineReturn) {
              strategyShortExitPoints.push({ time: p.time, value: candle.high });
              closeOpenTrade(realisticExitPrice("short", candle));
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
              strategyLongExitPoints.push({ time: p.time, value: candle.low });
              closeOpenTrade(realisticExitPrice("long", candle));
              position = "flat";
              longEmergencyArmed = false;
              longBestAfterArm = Number.NEGATIVE_INFINITY;
              prevDistValue = p.value;
              continue;
            }

            if (strongTrend && lineReturn) {
              strategyLongExitPoints.push({ time: p.time, value: candle.low });
              closeOpenTrade(realisticExitPrice("long", candle));
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

      strategyLongEntrySeriesRef.current?.setData(dedupePoints(strategyLongEntryPoints) as any);
      strategyShortEntrySeriesRef.current?.setData(dedupePoints(strategyShortEntryPoints) as any);
      strategyLongExitSeriesRef.current?.setData(dedupePoints(strategyLongExitPoints) as any);
      strategyShortExitSeriesRef.current?.setData(dedupePoints(strategyShortExitPoints) as any);

      setLiveState(position);
      setLongSignalCount(longSignals.length);
      setShortSignalCount(shortSignals.length);
      setLongExitCount(strategyLongExitPoints.length);
      setShortExitCount(strategyShortExitPoints.length);
      setTradeCount(closedTradeCount);
      setWinCount(closedWinCount);
      setLossCount(closedLossCount);
      setGrossProfit(closedGrossProfit);
      setGrossLoss(closedGrossLoss);
      setProfitFactor(closedGrossLoss > 0 ? closedGrossProfit / closedGrossLoss : (closedGrossProfit > 0 ? Number.POSITIVE_INFINITY : null));
      setNetPnL(closedGrossProfit - closedGrossLoss);

      const lastLong = longSignals.length ? longSignals[longSignals.length - 1] : null;
      const lastShort = shortSignals.length ? shortSignals[shortSignals.length - 1] : null;

      if (lastLong && lastShort) {
        setLastSignalText(lastLong > lastShort ? `LONG ${formatTime(lastLong)}` : `SHORT ${formatTime(lastShort)}`);
      } else if (lastLong) {
        setLastSignalText(`LONG ${formatTime(lastLong)}`);
      } else if (lastShort) {
        setLastSignalText(`SHORT ${formatTime(lastShort)}`);
      } else {
        setLastSignalText("-");
      }

      const realBuyPoints: LinePoint[] = [];
      const realSellPoints: LinePoint[] = [];
      const realClosePoints: LinePoint[] = [];
      const blockedLongPoints: LinePoint[] = [];
      const blockedShortPoints: LinePoint[] = [];

      let lastRealText = "-";
      let nextBrokerState: PositionSide = "flat";

      const sortedRows = [...aggRows].sort((a, b) => toUnixSec(a.received_at ?? a.executed_at) - toUnixSec(b.received_at ?? b.executed_at));
      for (const row of sortedRows) {
        const baseTime = toUnixSec(row.executed_at ?? row.received_at);
        if (!baseTime) continue;

        const executed = Boolean(row.exec_id || row.executed_at);
        const candleNear = findNearestCandle(candles, baseTime);
        const price = extractTradePrice(row, candleNear);

        if ((row.action === "buy" || row.action === "sell") && !executed) {
          if (row.action === "buy") {
            blockedLongPoints.push({ time: baseTime, value: candleNear?.low ?? price });
          } else {
            blockedShortPoints.push({ time: baseTime, value: candleNear?.high ?? price });
          }
          continue;
        }

        if (!executed) continue;

        if (row.action === "buy") {
          realBuyPoints.push({ time: baseTime, value: price });
          lastRealText = `BUY ${formatTime(baseTime)}`;
          nextBrokerState = "long";
        } else if (row.action === "sell") {
          realSellPoints.push({ time: baseTime, value: price });
          lastRealText = `SELL ${formatTime(baseTime)}`;
          nextBrokerState = "short";
        } else if (row.action === "close") {
          realClosePoints.push({ time: baseTime, value: price });
          lastRealText = `CLOSE ${formatTime(baseTime)}`;
          nextBrokerState = "flat";
        }
      }

      const latestRow = sortedRows.length ? sortedRows[sortedRows.length - 1] : null;
      const latestPositionState = normalizeBrokerState(latestRow?.position?.state ?? null);
      if (latestPositionState) nextBrokerState = latestPositionState;

      realBuySeriesRef.current?.setData(dedupePoints(realBuyPoints) as any);
      realSellSeriesRef.current?.setData(dedupePoints(realSellPoints) as any);
      realCloseSeriesRef.current?.setData(dedupePoints(realClosePoints) as any);
      blockedLongSeriesRef.current?.setData(dedupePoints(blockedLongPoints) as any);
      blockedShortSeriesRef.current?.setData(dedupePoints(blockedShortPoints) as any);

      setBlockedLongCount(blockedLongPoints.length);
      setBlockedShortCount(blockedShortPoints.length);
      setRealBuyCount(realBuyPoints.length);
      setRealSellCount(realSellPoints.length);
      setRealCloseCount(realClosePoints.length);
      setLastRealTradeText(lastRealText);
      setBrokerState(nextBrokerState);

      const last = candles[candles.length - 1];
      setLastPrice(last.close);
      setLastTime(last.time);
      setErrorMsg("");
      setIsLoading(false);
    };

    const loadHistory = async () => {
      setIsLoading(true);
      setErrorMsg("");

      try {
        const [candles, aggRows] = await Promise.all([
          fetchCandles({ provider, symbol, interval, limit: LIMIT, backendBase }),
          fetchAggTrades({ provider, symbol, backendBase, limit: AGG_LIMIT }),
        ]);

        if (aborted) return;

        if (!candles.length) {
          setErrorMsg("No candles returned");
          setIsLoading(false);
          return;
        }

        const hadNoDataBefore = candlesDataRef.current.length === 0;
        candlesDataRef.current = candles;
        renderAll(aggRows);

        if (hadNoDataBefore || isAutoFollowRef.current) {
          suppressLogicalRangeRef.current = true;
          priceChartRef.current?.timeScale().fitContent();
          distChartRef.current?.timeScale().fitContent();
          window.setTimeout(() => {
            suppressLogicalRangeRef.current = false;
          }, 0);
        }
      } catch (err) {
        if (aborted) return;
        setErrorMsg(err instanceof Error ? err.message : "Unknown error");
        setIsLoading(false);
      }
    };

    loadHistory();

    const autoTimer = window.setInterval(() => {
      loadHistory();
    }, AUTO_REFRESH_MS);

    return () => {
      aborted = true;
      window.clearInterval(autoTimer);
    };
  }, [chartReady, reloadKey, provider, symbol, interval, backendBase, entryBand, peakLookback, assumedSpread, assumedSlippage]);

  return (
    <div
      ref={rootRef}
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        background: "#0f172a",
        overflow: "hidden",
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
          minWidth: 400,
          maxWidth: 430,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <label>
            <div style={{ fontSize: 11, opacity: 0.8 }}>Provider</div>
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
              <option value="capital">Capital.com</option>
              <option value="binance">Binance</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 11, opacity: 0.8 }}>Symbol</div>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {PROVIDER_SYMBOLS[provider].map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ fontSize: 11, opacity: 0.8 }}>Timeframe</div>
            <select value={interval} onChange={(e) => setIntervalValue(e.target.value)}>
              {PROVIDER_INTERVALS[provider].map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <button onClick={() => {
            isAutoFollowRef.current = true;
            setReloadKey((x) => x + 1);
          }}>Reload</button>
        </div>

        <label style={{ display: "block", marginBottom: 8 }}>
          <div style={{ fontSize: 11, opacity: 0.8 }}>Engine base URL</div>
          <input
            value={backendBase}
            onChange={(e) => setBackendBase(e.target.value)}
            style={{ width: "100%" }}
            placeholder="https://qtrend-trading-engine.onrender.com"
          />
        </label>

        <div style={{ fontWeight: 700 }}>
          {provider.toUpperCase()} · {symbol} · {interval}
        </div>
        <div>
          Strategy: <span style={{ color: headerText.color, fontWeight: 700 }}>{headerText.label}</span>
        </div>
        <div>
          Broker: <span style={{ color: brokerHeaderText.color, fontWeight: 700 }}>{brokerHeaderText.label}</span>
        </div>
        <div>Last: {lastPrice !== null ? lastPrice.toFixed(2) : "-"}</div>
        <div>Time: {lastTime ? formatTime(lastTime) : "-"}</div>
        <div>Status: {displayStatus}</div>
        <div>Entry band: {entryBand}</div>
        <div>Peak lookback: {peakLookback}</div>
        <div>Exit strength factor: {exitStrengthFactor}</div>
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
        <div>PF: {profitFactor === null ? "-" : (Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞")}</div>
        <div>Last signal: {lastSignalText}</div>
        <div>Last real trade: {lastRealTradeText}</div>

        <div style={{ marginTop: 8, borderTop: "1px solid #334155", paddingTop: 8, fontSize: 12 }}>
          <div><span style={{ color: "#22c55e", fontWeight: 700 }}>●</span> Strategy long</div>
          <div><span style={{ color: "#ef4444", fontWeight: 700 }}>●</span> Strategy short</div>
          <div><span style={{ color: "#f59e0b", fontWeight: 700 }}>●</span> Strategy exit</div>
          <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>●</span> Blocked long / skip</div>
          <div><span style={{ color: "#64748b", fontWeight: 700 }}>●</span> Blocked short / skip</div>
          <div><span style={{ color: "#00ff88", fontWeight: 700 }}>●</span> Real buy</div>
          <div><span style={{ color: "#ff4d6d", fontWeight: 700 }}>●</span> Real sell</div>
          <div><span style={{ color: "#c084fc", fontWeight: 700 }}>●</span> Real close</div>
        </div>

        {errorMsg && <div style={{ color: "#fca5a5", marginTop: 6 }}>{errorMsg}</div>}
      </div>

      <div ref={pricePaneRef} style={{ flex: "0 0 72%", minHeight: 0 }} />
      <div ref={distPaneRef} style={{ flex: "0 0 28%", minHeight: 0, borderTop: "1px solid #334155" }} />
    </div>
  );
}

function findBestLongIndex(dist: LinePoint[], start: number, end: number, lookback: number): number {
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

function findBestShortIndex(dist: LinePoint[], start: number, end: number, lookback: number): number {
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

async function fetchCandles(args: {
  provider: Provider;
  symbol: string;
  interval: string;
  limit: number;
  backendBase: string;
}): Promise<Candle[]> {
  const { provider, symbol, interval, limit, backendBase } = args;

  if (provider === "binance") {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Binance history failed: ${res.status}`);
    const raw = (await res.json()) as BinanceKlineRow[];
    return raw.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
    }));
  }

  const url = new URL("/api/market-data/klines", backendBase);
  url.searchParams.set("provider", "capital");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("_ts", String(Date.now()));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const txt = await safeReadText(res);
    throw new Error(`Capital route failed: ${res.status} ${txt}`);
  }

  const payload = (await res.json()) as CapitalKlineResponse;
  if (!payload.ok) throw new Error(payload.error || payload.info || "Capital response not ok");
  return payload.candles;
}

async function fetchAggTrades(args: {
  provider: Provider;
  symbol: string;
  backendBase: string;
  limit: number;
}): Promise<AggTradeRow[]> {
  const { provider, symbol, backendBase, limit } = args;
  if (provider !== "capital") return [];

  const url = new URL("/agg/trades", backendBase);
  url.searchParams.set("epic", symbol);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("_ts", String(Date.now()));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const txt = await safeReadText(res);
    throw new Error(`agg/trades failed: ${res.status} ${txt}`);
  }

  const payload = (await res.json()) as AggTradesResponse;
  if (!payload.ok) throw new Error("agg/trades response not ok");
  return Array.isArray(payload.rows) ? payload.rows : [];
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function calcSMA(data: Candle[], len: number): LinePoint[] {
  const res: LinePoint[] = [];
  for (let i = len - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < len; j++) sum += data[i - j].close;
    res.push({ time: data[i].time, value: sum / len });
  }
  return res;
}

function calcDistance(a: LinePoint[], b: LinePoint[]): LinePoint[] {
  const map = new Map<number, number>();
  b.forEach((x) => map.set(x.time, x.value));
  return a
    .map((x) => {
      const y = map.get(x.time);
      if (y === undefined) return null;
      return { time: x.time, value: x.value - y };
    })
    .filter(Boolean) as LinePoint[];
}

function alignLineToCandles(candles: Candle[], line: LinePoint[]): LineOrWhitespace[] {
  const lineMap = new Map<number, number>();
  line.forEach((p) => lineMap.set(p.time, p.value));
  return candles.map((c) => {
    const value = lineMap.get(c.time);
    if (value === undefined) return { time: c.time };
    return { time: c.time, value };
  });
}

function buildFlatLine(candles: Candle[], value: number): LinePoint[] {
  return candles.map((c) => ({ time: c.time, value }));
}

function dedupePoints(points: LinePoint[]): LinePoint[] {
  const out: LinePoint[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    const key = `${p.time}-${p.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

function syncCharts(
  chartA: IChartApi,
  chartB: IChartApi,
  isAutoFollowRef: { current: boolean },
  suppressLogicalRangeRef: { current: boolean }
) {
  let isSyncing = false;

  const applyRangeToOther = (target: IChartApi, range: LogicalRange | null) => {
    if (!range) return;
    target.timeScale().setVisibleLogicalRange(range);
  };

  const handleRangeChange = (target: IChartApi, range: LogicalRange | null) => {
    if (isSyncing) return;
    if (!suppressLogicalRangeRef.current) {
      isAutoFollowRef.current = false;
    }
    isSyncing = true;
    applyRangeToOther(target, range);
    isSyncing = false;
  };

  chartA.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    handleRangeChange(chartB, range);
  });

  chartB.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    handleRangeChange(chartA, range);
  });
}

function formatTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yy} ${hh}:${mi}`;
}

function toUnixSec(input: string | null | undefined): number {
  if (!input) return 0;
  const t = Date.parse(input);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

function normalizeBrokerState(state: string | null | undefined): PositionSide | null {
  const s = String(state || "").trim().toUpperCase();
  if (!s) return null;
  if (s === "LONG") return "long";
  if (s === "SHORT") return "short";
  if (s === "FLAT") return "flat";
  return null;
}

function findNearestCandle(candles: Candle[], targetTime: number): Candle | null {
  if (!candles.length || !targetTime) return null;
  let best: Candle | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const c of candles) {
    const diff = Math.abs(c.time - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best;
}

function extractTradePrice(row: AggTradeRow, candle: Candle | null): number {
  const fromConfirm = deepFindNumeric(row.confirm, [
    "level",
    "price",
    "fillPrice",
    "filledPrice",
    "stopLevel",
    "limitLevel",
    "affectedDealConfirmationLevel",
  ]);
  if (fromConfirm !== null) return fromConfirm;

  if (candle) {
    if (row.action === "buy") return candle.low;
    if (row.action === "sell") return candle.high;
    return candle.close;
  }
  return 0;
}

function deepFindNumeric(input: any, preferredKeys: string[]): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object") return null;

  for (const key of preferredKeys) {
    const value = input?.[key];
    const num = Number(value);
    if (Number.isFinite(num) && num !== 0) return num;
  }

  for (const value of Object.values(input)) {
    if (value && typeof value === "object") {
      const nested = deepFindNumeric(value, preferredKeys);
      if (nested !== null) return nested;
    }
  }
  return null;
}
