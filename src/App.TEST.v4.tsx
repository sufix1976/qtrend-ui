import {
  computeSignalCore,
} from "./shared/signal_core";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  CrosshairMode,
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

type SymbolConfigRow = {
  symbol: string;
  interval?: string | null;
  entry_band: number | null;
  min_kink: number | null;
  peak_lookback: number | null;
  sma_fast: number | null;
  sma_slow: number | null;
  sma_middle: number | null;
  adaptive_band: number | boolean | null;
  adaptive_band_mult: number | null;
  size: number | null;
  updated_at?: string;
};

type SymbolConfigMap = Record<string, SymbolConfigRow>;




type SymbolSizeMap = Record<string, number>;

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const LIMIT = 80000;
const AGG_LIMIT = 2000;
const PRICE_SCALE_WIDTH = 90;
const EURUSD_APPROX = 1.18;

const INTERVALS = ["5m", "15m", "30m", "1h"] as const;
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
  "TSLA",
];

const ENTRY_BAND_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 90,
  ETHUSD: 10,
  XRPUSD: 0.04,
  DE40: 100,
  US100: 80,
  US500: 12,
  US30: 80,
  J225: 160,
  UK100: 30,
  GOLD: 22,
  SILVER: 0.22,
  OIL_CRUDE: 1.4,
  CORN: 1.4,
  SOLUSD: 0.8,
  TSLA: 5,
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
  TSLA: 3,
};

const MIN_KINK_MOVE_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 50,
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
  TSLA: 0.08
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
  TSLA: 2,
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
  TSLA: 0.5
};

const INTERVAL_BY_SYMBOL: Record<string, IntervalOption> = {
  BTCUSD: "30m",
  ETHUSD: "30m",
  XRPUSD: "15m",
  DE40: "15m",
  US100: "15m",
  US500: "15m",
  US30: "15m",
  J225: "15m",
  UK100: "15m",
  GOLD: "15m",
  SILVER: "15m",
  OIL_CRUDE: "15m",
  CORN: "30m",
  SOLUSD: "30m",
  TSLA: "15m",
};

function formatChartTimeLabel(tsSec: number, withDate = false): string {
  const d = new Date(tsSec * 1000);

  return d.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: withDate ? "2-digit" : undefined,
    month: withDate ? "short" : undefined,
    year: withDate ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  });
}



export default function AppTESTv4() {
  const priceRef = useRef<HTMLDivElement | null>(null);
  const distRef = useRef<HTMLDivElement | null>(null);

  const priceChartRef = useRef<IChartApi | null>(null);
  const distChartRef = useRef<IChartApi | null>(null);
  const loadSeqRef = useRef(0);
  const lastViewKeyRef = useRef("");
  
  useEffect(() => {
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.documentElement.style.margin = "0";
  document.documentElement.style.overflow = "hidden";
}, []);
  

  const [symbol, setSymbol] = useState("BTCUSD");
  const [interval, setInterval] = useState<IntervalOption>("15m");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [lastTime, setLastTime] = useState<number | null>(null);

  const [liveState, setLiveState] = useState<PositionSide>("flat");

const [brokerState, setBrokerState] = useState<PositionSide>("flat");
  
  async function setStrategyState(state: "flat" | "long" | "short") {
  try {
    await postStrategyState(symbol, state);

    

    setLiveState(state);
  } catch (e) {
    console.error(e);
  }
}

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
  const [netPnL, setNetPnL] = useState(0);

  const [grossProfitUsd, setGrossProfitUsd] = useState(0);
  const [grossLossUsd, setGrossLossUsd] = useState(0);
  const [netPnLUsd, setNetPnLUsd] = useState(0);

  const [grossProfitEur, setGrossProfitEur] = useState(0);
  const [grossLossEur, setGrossLossEur] = useState(0);
  const [netPnLEur, setNetPnLEur] = useState(0);

  const [profitFactor, setProfitFactor] = useState<number | null>(null);

  const [presetMessage, setPresetMessage] = useState("");

  const [symbolSizes, setSymbolSizes] = useState<SymbolSizeMap>({});
  const [sizeMessage, setSizeMessage] = useState("");
  const [sizeLoading, setSizeLoading] = useState(false);
  const [symbolConfigMap, setSymbolConfigMap] = useState<SymbolConfigMap>({});
  const [, setConfigLoading] = useState(false);

  const entryBand = useMemo(() => ENTRY_BAND_BY_SYMBOL[symbol] ?? 100, [symbol]);
  const peakLookback = useMemo(() => PEAK_LOOKBACK_BY_SYMBOL[symbol] ?? 3, [symbol]);
  const minKinkMove = useMemo(() => MIN_KINK_MOVE_BY_SYMBOL[symbol] ?? 1, [symbol]);
  const assumedSpread = useMemo(() => SPREAD_BY_SYMBOL[symbol] ?? 0, [symbol]);
  const assumedSlippage = useMemo(() => SLIPPAGE_BY_SYMBOL[symbol] ?? 0, [symbol]);
  
  const [entryBandUI, setEntryBandUI] = useState(entryBand);
  const [minKinkUI, setMinKinkUI] = useState(minKinkMove);
  const [peakUI, setPeakUI] = useState(peakLookback);

  const [smaFastUI, setSmaFastUI] = useState(10);
  const [smaSlowUI, setSmaSlowUI] = useState(100);
  const [smaMiddleUI, setSmaMiddleUI] = useState(100);
  const [adaptiveBandUI, setAdaptiveBandUI] = useState(false);
  const [adaptiveBandMultUI, setAdaptiveBandMultUI] = useState(1);
  const [infoOpen, setInfoOpen] = useState(true);
  const [chartType, setChartType] = useState<"candles" | "line">("candles");
  const [_multiTfData, setMultiTfData] = useState<any>(null);

  

  
  
  const ENTRY_BAND_MIN_BY_SYMBOL: Record<string, number> = {
  GOLD: 2,
  SILVER: 0.05,
};

  useEffect(() => {
  const cfg = symbolConfigMap[symbol];

  if (cfg) {
        const nextInterval = String(cfg.interval || "").trim();
    if (nextInterval && INTERVALS.includes(nextInterval as IntervalOption)) {
      setInterval(nextInterval as IntervalOption);
    } else {
      setInterval(INTERVAL_BY_SYMBOL[symbol] ?? "15m");
    }
    setEntryBandUI(Number(cfg.entry_band ?? entryBand));
    setMinKinkUI(Number(cfg.min_kink ?? minKinkMove));
    setPeakUI(Number(cfg.peak_lookback ?? peakLookback));
    setSmaFastUI(Number(cfg.sma_fast ?? 10));
    setSmaSlowUI(Number(cfg.sma_slow ?? 100));
    setSmaMiddleUI(Number(cfg.sma_middle ?? 100));
    setAdaptiveBandUI(Boolean(cfg.adaptive_band ?? false));
    setAdaptiveBandMultUI(Number(cfg.adaptive_band_mult ?? 1));

    if (cfg.size != null && Number.isFinite(Number(cfg.size))) {
      setSymbolSizes((prev) => ({
        ...prev,
        [symbol]: Number(cfg.size),
      }));
    }

    setPresetMessage(`Backend-Konfig geladen für ${symbol}`);
  } else {
    setInterval(INTERVAL_BY_SYMBOL[symbol] ?? "15m");
    setEntryBandUI(entryBand);
    setMinKinkUI(minKinkMove);
    setPeakUI(peakLookback);
    setSmaFastUI(10);
    setSmaSlowUI(100);
    setSmaMiddleUI(100);
    setAdaptiveBandUI(false);
    setAdaptiveBandMultUI(1);

    setPresetMessage(`Default geladen für ${symbol}`);
  }
}, [symbol, entryBand, minKinkMove, peakLookback, symbolConfigMap]);

  useEffect(() => {
    if (smaFastUI >= smaSlowUI) {
  setSmaSlowUI(smaFastUI + 1);
}
  }, [smaFastUI, smaSlowUI]);

  useEffect(() => {
    if (!presetMessage) return;
    const t = setTimeout(() => setPresetMessage(""), 1800);
    return () => clearTimeout(t);
  }, [presetMessage]);
  
  useEffect(() => {
  let cancelled = false;

  async function loadBackendConfig() {
    try {
      setConfigLoading(true);

      const cfgMap = await fetchSymbolConfig();
      if (cancelled) return;

      setSymbolConfigMap(cfgMap);

      // Sizes daraus ableiten
      const sizeMap: SymbolSizeMap = {};
      for (const s of Object.keys(cfgMap)) {
        const n = Number(cfgMap[s]?.size);
        if (Number.isFinite(n) && n > 0) {
          sizeMap[s] = n;
        }
      }
      setSymbolSizes(sizeMap);

    } catch (e) {
      if (!cancelled) {
        console.error(e);
        setSizeMessage("Backend-Konfig laden fehlgeschlagen");
      }
    } finally {
      if (!cancelled) setConfigLoading(false);
    }
  }

  loadBackendConfig();

  return () => {
    cancelled = true;
  };
}, []);

  

  async function savePreset() {
  try {
    const row: SymbolConfigRow = {
  symbol,
  interval,
  entry_band: entryBandUI,
  min_kink: minKinkUI,
  peak_lookback: peakUI,
  sma_fast: smaFastUI,
  sma_slow: smaSlowUI,
  sma_middle: smaMiddleUI,
  adaptive_band: adaptiveBandUI ? 1 : 0,
  adaptive_band_mult: adaptiveBandMultUI,
  size: Number(symbolSizes[symbol]) > 0 ? Number(symbolSizes[symbol]) : null,
};

    await saveSymbolConfig(row);

    setSymbolConfigMap((prev) => ({
      ...prev,
      [symbol]: row,
    }));

    setPresetMessage(`Backend-Konfig gespeichert für ${symbol}`);
  } catch (e) {
    console.error(e);
    setPresetMessage(`Backend-Konfig speichern fehlgeschlagen für ${symbol}`);
  }
}

  


  async function resetPreset() {
  try {
    const row: SymbolConfigRow = {
      symbol,
      interval: INTERVAL_BY_SYMBOL[symbol] ?? "15m",
      entry_band: entryBand,
      min_kink: minKinkMove,
      peak_lookback: peakLookback,
      sma_fast: 10,
      sma_slow: 100,
      sma_middle: 100,
      adaptive_band: 0,
      adaptive_band_mult: 1,
      size: Number(symbolSizes[symbol]) > 0 ? Number(symbolSizes[symbol]) : null,
    };

    await saveSymbolConfig(row);

    setSymbolConfigMap((prev) => ({
      ...prev,
      [symbol]: row,
    }));

    setInterval(INTERVAL_BY_SYMBOL[symbol] ?? "15m");
    setEntryBandUI(entryBand);
    setMinKinkUI(minKinkMove);
    setPeakUI(peakLookback);
    setSmaFastUI(10);
    setSmaSlowUI(100);
    setSmaMiddleUI(100);
    setAdaptiveBandUI(false);
    setAdaptiveBandMultUI(1);

    setPresetMessage(`Backend-Konfig zurückgesetzt für ${symbol}`);
  } catch (e) {
    console.error(e);
    setPresetMessage(`Backend-Reset fehlgeschlagen für ${symbol}`);
  }
}

function updateLocalSize(symbol: string, value: string) {
  const n = Number(value);

  setSymbolSizes((prev) => ({
    ...prev,
    [symbol]: Number.isFinite(n) && n > 0 ? n : 0,
  }));
}

async function saveOneSize(symbolToSave: string) {
  try {
    const size = Number(symbolSizes[symbolToSave]);
    if (!Number.isFinite(size) || size <= 0) {
      setSizeMessage(`Ungültige Size für ${symbolToSave}`);
      return;
    }

    const old = symbolConfigMap[symbolToSave] || null;

    const row: SymbolConfigRow = {
      symbol: symbolToSave,

      interval:
        old?.interval && INTERVALS.includes(old.interval as IntervalOption)
          ? old.interval
          : (INTERVAL_BY_SYMBOL[symbolToSave] ?? "15m"),

      entry_band: old?.entry_band ?? ENTRY_BAND_BY_SYMBOL[symbolToSave] ?? null,
      min_kink: old?.min_kink ?? MIN_KINK_MOVE_BY_SYMBOL[symbolToSave] ?? null,
      peak_lookback: old?.peak_lookback ?? PEAK_LOOKBACK_BY_SYMBOL[symbolToSave] ?? null,
      sma_fast: old?.sma_fast ?? 10,
      sma_slow: old?.sma_slow ?? 100,
      sma_middle: old?.sma_middle ?? 100,
      adaptive_band: old?.adaptive_band ?? 0,
      adaptive_band_mult: old?.adaptive_band_mult ?? 1,
      size,
    };

    await saveSymbolConfig(row);

    setSymbolConfigMap((prev) => ({
      ...prev,
      [symbolToSave]: row,
    }));

    setSizeMessage(`Size gespeichert für ${symbolToSave}`);
  } catch (e) {
    console.error(e);
    setSizeMessage(`Size speichern fehlgeschlagen für ${symbolToSave}`);
  }
}

async function saveAllSizes() {
  try {
    setSizeLoading(true);

    for (const s of SYMBOLS) {
      const n = Number(symbolSizes[s]);
      if (!Number.isFinite(n) || n <= 0) continue;

      const old = symbolConfigMap[s] || null;

      const row: SymbolConfigRow = {
        symbol: s,

        interval:
          old?.interval && INTERVALS.includes(old.interval as IntervalOption)
            ? old.interval
            : (INTERVAL_BY_SYMBOL[s] ?? "15m"),

        entry_band: old?.entry_band ?? ENTRY_BAND_BY_SYMBOL[s] ?? null,
        min_kink: old?.min_kink ?? MIN_KINK_MOVE_BY_SYMBOL[s] ?? null,
        peak_lookback: old?.peak_lookback ?? PEAK_LOOKBACK_BY_SYMBOL[s] ?? null,
        sma_fast: old?.sma_fast ?? 10,
        sma_slow: old?.sma_slow ?? 100,
        sma_middle: old?.sma_middle ?? 100,
        adaptive_band: old?.adaptive_band ?? 0,
        adaptive_band_mult: old?.adaptive_band_mult ?? 1,
        size: n,
      };

      await saveSymbolConfig(row);
    }

    const refreshed = await fetchSymbolConfig();
    setSymbolConfigMap(refreshed);

    setSizeMessage("Alle Sizes im Backend gespeichert");
  } catch (e) {
    console.error(e);
    setSizeMessage("Speichern der Sizes fehlgeschlagen");
  } finally {
    setSizeLoading(false);
  }
}
  
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
    autoScale: true,
  },
  localization: {
    timeFormatter: (time: number) => formatChartTimeLabel(Number(time), true),
  },
  timeScale: {
    borderColor: "#334155",
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 0,
    lockVisibleTimeRangeOnResize: true,
    tickMarkFormatter: (time: number) => formatChartTimeLabel(Number(time), false),
  },
  crosshair: {
    mode: CrosshairMode.Normal,
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
    autoScale: true,
  },

  // 👇 DAS IST NEU
  localization: {
    timeFormatter: (time: number) => formatChartTimeLabel(Number(time), true),
  },

  timeScale: {
    borderColor: "#334155",
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 0,
    lockVisibleTimeRangeOnResize: true,

    // 👇 DAS IST NEU
    tickMarkFormatter: (time: number) => formatChartTimeLabel(Number(time), false),
  },

  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: "#94a3b8", width: 1, style: 2 },
    horzLine: { color: "#94a3b8", width: 1, style: 2 },
  },
});

    syncCharts(priceChart, distChart);

    const cleanupVerticalOverlay = setupVerticalCrosshairOverlay(
  priceRef.current,
  distRef.current,
  priceChart,
  distChart
);
    
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
      cleanupVerticalOverlay();
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

    const mainSeries =
  chartType === "candles"
    ? priceChart.addSeries(CandlestickSeries, {
        upColor: "#00e5ff",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#00e5ff",
        wickDownColor: "#ef4444",
      })
    : priceChart.addSeries(LineSeries, {
        color: "#00e5ff",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
    const multiLongSeries = priceChart.addSeries(LineSeries, {
  color: "rgba(0,255,0,0.7)",
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  priceScaleId: "",
});

const multiShortSeries = priceChart.addSeries(LineSeries, {
  color: "rgba(255,0,0,0.7)",
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  priceScaleId: "",
});
    multiLongSeries.setData([]);
    multiShortSeries.setData([]);

    const smaFastSeries = priceChart.addSeries(LineSeries, {
      color: "#ffff00",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const smaSlowSeries = priceChart.addSeries(LineSeries, {
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
    
    

    const distMiddleSeries = distChart.addSeries(LineSeries, {
      color: "rgba(180,180,180,0.75)",
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
      const mySeq = ++loadSeqRef.current;
      try {
        setStatus("loading");
        setError("");

        const [candles, liveBrokerState, aggRows, backendStrategyState, mtf] = await Promise.all([
  fetchCandles(symbol, interval),
  fetchBrokerPositionState(symbol),
  fetchAggTrades(symbol),
  fetchStrategyState(symbol),
  fetchMultiTf(symbol),
]);
        if (cancelled || mySeq !== loadSeqRef.current) return;
        setMultiTfData(mtf);
       

        if (cancelled) return;
        if (!candles.length) throw new Error("No valid candles returned");

        const core = computeSignalCore(candles, {
  smaFast: smaFastUI,
  smaSlow: smaSlowUI,
  smaMiddle: smaMiddleUI,
  entryBand: entryBandUI,
  adaptiveBand: adaptiveBandUI,
  adaptiveBandMult: adaptiveBandMultUI,
  peakLookback: peakUI,
  minKinkMove: minKinkUI,
  stdDevLength: 50,
});

const smaFast = core.smaFast;
const smaSlow = core.smaSlow;
const dist = core.dist;
const distMiddle = core.distMiddle;
const dynamicBand = core.dynamicBand;

const chartCandles = chartifyCandles(candles);
const chartSmaFast = chartifyLinePoints(smaFast);
const chartSmaSlow = chartifyLinePoints(smaSlow);
const chartDist = chartifyLinePoints(dist);
const chartDistMiddle = chartifyLinePoints(distMiddle);

const longData = {
  entries: core.longEntries,
  candidates: core.longCandidates,
};

const shortData = {
  entries: core.shortEntries,
  candidates: core.shortCandidates,
};

        const strategyLongPoints = longData.entries;
        const strategyShortPoints = shortData.entries;

        const sim = simulateStrategyTESTv4(
  candles,
  dist,
  distMiddle,
  strategyLongPoints,
  strategyShortPoints,
  dynamicBand,
  assumedSpread,
  assumedSlippage,
);



        const real = buildRealTradeMarkers(candles, aggRows);

        const alignedDist = alignLineToCandles(chartCandles, chartDist);
        const alignedDistMiddle = alignLineToCandles(chartCandles, chartDistMiddle);
        const dynamicUpperBand = alignLineToCandles(
  chartCandles,
  chartifyLinePoints(core.upperBand)
);
const dynamicLowerBand = alignLineToCandles(
  chartCandles,
  chartifyLinePoints(core.lowerBand)
);

        if (chartType === "candles") {
  mainSeries.setData(chartCandles as any);
} else {
  mainSeries.setData(
    chartCandles.map((c) => ({
      time: c.time,
      value: c.close,
    })) as any
  );
}
        if (mtf) {
  const mapped = mapMultiTfMarkers(mtf);

  multiLongSeries.setData(mapped.long as any);
  multiShortSeries.setData(mapped.short as any);
}

        smaFastSeries.setData(chartSmaFast as any);
        smaSlowSeries.setData(chartSmaSlow as any);

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
        distMiddleSeries.setData(alignedDistMiddle as any);
        const zeroLine = chartCandles.map(c => ({
  time: c.time,
  value: 0,
}));

zeroSeries.setData(zeroLine as any);
        upperBandSeries.setData(dynamicUpperBand as any);
        lowerBandSeries.setData(dynamicLowerBand as any);

        

priceChart.priceScale("right").applyOptions({
  autoScale: true,
});

distChart.priceScale("right").applyOptions({
  autoScale: true,
});

const currentViewKey = `${symbol}|${interval}`;

if (lastViewKeyRef.current !== currentViewKey) {
  priceChart.timeScale().fitContent();

  const range = priceChart.timeScale().getVisibleLogicalRange();
  if (range) distChart.timeScale().setVisibleLogicalRange(range);

  lastViewKeyRef.current = currentViewKey;
}
        
if (cancelled || mySeq !== loadSeqRef.current) return;
        const last = candles[candles.length - 1];
        setLastPrice(last.close);
        setLastTime(last.time);

        // nur initial sync, danach UI bleibt stabil
setLiveState(backendStrategyState);
        
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

const activeSize = Number(symbolSizes[symbol]) || 0;

const grossProfitUsdVal = sim.grossProfit * activeSize;
const grossLossUsdVal = sim.grossLoss * activeSize;
const netPnLUsdVal = sim.netPnL * activeSize;

setGrossProfitUsd(grossProfitUsdVal);
setGrossLossUsd(grossLossUsdVal);
setNetPnLUsd(netPnLUsdVal);

setGrossProfitEur(grossProfitUsdVal / EURUSD_APPROX);
setGrossLossEur(grossLossUsdVal / EURUSD_APPROX);
setNetPnLEur(netPnLUsdVal / EURUSD_APPROX);

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

const poll = window.setInterval(() => {
  loadData();
}, 5000);

return () => {
  cancelled = true;
  window.clearInterval(poll);
  try {

        priceChart.removeSeries(mainSeries);
        priceChart.removeSeries(smaFastSeries);
        priceChart.removeSeries(smaSlowSeries);
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
        distChart.removeSeries(distMiddleSeries);
        distChart.removeSeries(zeroSeries);
        distChart.removeSeries(upperBandSeries);
        distChart.removeSeries(lowerBandSeries);
      } catch {}
    };
    }, [
  symbol,
  interval,
  chartType,
  entryBandUI,
  peakUI,
  minKinkUI,
  smaFastUI,
  smaSlowUI,
  smaMiddleUI,
  assumedSpread,
  assumedSlippage,
  adaptiveBandUI,
  adaptiveBandMultUI,
  symbolSizes,
]);

  const displayState = liveState;
  
  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        overflow: "hidden",
        background: "#0f172a",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <button
  onClick={() => setInfoOpen(!infoOpen)}
  style={{
    position: "absolute",
    top: 10,
    left: 10,
    zIndex: 50,
    padding: "6px 10px",
    background: "#111",
    color: "#fff",
    border: "1px solid #555",
    borderRadius: 6,
    cursor: "pointer",
  }}
>
  {infoOpen ? "Hide Panel" : "Show Panel"}
</button>

      <button
  onClick={() =>
    setChartType((prev) => (prev === "candles" ? "line" : "candles"))
  }
  style={{
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 50,
    padding: "6px 10px",
    background: "#111",
    color: "#fff",
    border: "1px solid #555",
    borderRadius: 6,
    cursor: "pointer",
  }}
>
  {chartType === "candles" ? "Linie" : "Kerzen"}
</button>
      
      {infoOpen && (
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
      maxHeight: "92vh",
      overflowY: "auto",
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

        <div>Status: {status} | TEST V4</div>
        <div>
          Strategy:{" "}
          <span
            style={{
              color:
  displayState === "long"
    ? "#22c55e"
    : displayState === "short"
    ? "#ef4444"
    : "#cbd5e1",
              fontWeight: 700,
            }}
          >
            {displayState.toUpperCase()}
            
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
        <div>Entry band: {entryBandUI}</div>
        <div>Peak lookback: {peakUI}</div>
        <div>Min kink: {minKinkUI}</div>
        <div>Assumed spread: {assumedSpread}</div>
        <div>Assumed slippage: {assumedSlippage}</div>
        <div>Adaptive band: {adaptiveBandUI ? "ON" : "OFF"}</div>
        <div>Adaptive mult: {adaptiveBandMultUI.toFixed(2)}</div>

        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
  <button
    onClick={() => setStrategyState("flat")}
    style={{
      width: "100%",
      background: "#7f1d1d",
      color: "#fff",
      border: "1px solid #ef4444",
      borderRadius: 6,
      padding: "8px 10px",
      cursor: "pointer",
      fontWeight: 700,
    }}
  >
    ⛔ Set FLAT
  </button>

  <button
    onClick={() => setStrategyState("long")}
    style={{
      width: "100%",
      background: "#14532d",
      color: "#fff",
      border: "1px solid #22c55e",
      borderRadius: 6,
      padding: "8px 10px",
      cursor: "pointer",
      fontWeight: 700,
    }}
  >
    🟢 Set LONG
  </button>

  <button
    onClick={() => setStrategyState("short")}
    style={{
      width: "100%",
      background: "#7f1d1d",
      color: "#fff",
      border: "1px solid #ef4444",
      borderRadius: 6,
      padding: "8px 10px",
      cursor: "pointer",
      fontWeight: 700,
    }}
  >
    🔴 Set SHORT
  </button>
</div>


        <div style={{ marginTop: 10, borderTop: "1px solid #334155", paddingTop: 8 }}>
  <div style={{ fontWeight: 700, marginBottom: 6 }}>Size Tabelle</div>

  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>
    Diese Werte überschreiben beim nächsten echten Entry die Webhook-Size.
  </div>

  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1.2fr 1fr auto",
      gap: 6,
      alignItems: "center",
      fontSize: 12,
    }}
  >
    <div style={{ color: "#94a3b8" }}>Symbol</div>
    <div style={{ color: "#94a3b8" }}>Size</div>
    <div></div>

    {SYMBOLS.map((s) => (
      <Fragment key={s}>
        <div>{s}</div>

        <input
          type="number"
          step="any"
          min="0"
          value={symbolSizes[s] ?? ""}
          onChange={(e) => updateLocalSize(s, e.target.value)}
          style={{
            width: "100%",
            background: "#0f172a",
            color: "#fff",
            border: "1px solid #475569",
            borderRadius: 6,
            padding: "4px 6px",
          }}
        />

        <button
          onClick={() => saveOneSize(s)}
          style={{
            background: "#334155",
            color: "#fff",
            border: "1px solid #475569",
            borderRadius: 6,
            padding: "4px 8px",
            cursor: "pointer",
          }}
        >
          Save
        </button>
      </Fragment>
    ))}
  </div>

  <div style={{ marginTop: 8 }}>
    <button
      onClick={saveAllSizes}
      disabled={sizeLoading}
      style={{
        width: "100%",
        background: "#14532d",
        color: "#fff",
        border: "1px solid #22c55e",
        borderRadius: 6,
        padding: "6px 8px",
        cursor: "pointer",
        opacity: sizeLoading ? 0.7 : 1,
      }}
    >
      {sizeLoading ? "Speichert..." : "Alle Sizes speichern"}
    </button>
  </div>

  {sizeMessage ? (
    <div style={{ marginTop: 6, fontSize: 12, color: "#93c5fd" }}>
      {sizeMessage}
    </div>
  ) : null}
</div>
        <div style={{ marginTop: 10, borderTop: "1px solid #334155", paddingTop: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>⚙️ Parameter TEST V4</div>

          <div>Entry Band: {entryBandUI}</div>

<input
  type="range"
  min={(ENTRY_BAND_MIN_BY_SYMBOL[symbol] ?? Math.max(0, entryBand * 0.5))}
  max={entryBand * 2}
  step={entryBand < 2 ? 0.001 : entryBand < 20 ? 0.01 : 1}
  value={entryBandUI}
  onChange={(e) => setEntryBandUI(Number(e.target.value))}
  style={{ width: "100%" }}
/>

          <div style={{ marginTop: 6 }}>Min Kink: {minKinkUI}</div>
          <input
            type="range"
            min={0}
            max={Math.max(minKinkMove * 3, minKinkMove + 1)}
            step={minKinkMove < 1 ? 0.001 : 0.1}
            value={minKinkUI}
            onChange={(e) => setMinKinkUI(Number(e.target.value))}
            style={{ width: "100%" }}
          />

          <div style={{ marginTop: 6 }}>Peak Lookback: {peakUI}</div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={peakUI}
            onChange={(e) => setPeakUI(Number(e.target.value))}
            style={{ width: "100%" }}
          />


          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="adaptive-band-toggle"
              type="checkbox"
              checked={adaptiveBandUI}
              onChange={(e) => setAdaptiveBandUI(e.target.checked)}
            />
            <label htmlFor="adaptive-band-toggle" style={{ cursor: "pointer" }}>
              Adaptive Band
            </label>
          </div>

          <div style={{ marginTop: 6 }}>Adaptive Multiplier: {adaptiveBandMultUI.toFixed(2)}</div>
          <input
            type="range"
            min={0.25}
            max={3}
            step={0.05}
            value={adaptiveBandMultUI}
            onChange={(e) => setAdaptiveBandMultUI(Number(e.target.value))}
            style={{ width: "100%", opacity: adaptiveBandUI ? 1 : 0.45 }}
          />
        </div>

        <div style={{ marginTop: 10, borderTop: "1px solid #334155", paddingTop: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>SMA Test</div>

          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1 }}>
              Fast
              <select
                value={smaFastUI}
                onChange={(e) => setSmaFastUI(Number(e.target.value))}
                style={{ width: "100%" }}
              >
                <option value={7}>7</option>
                <option value={8}>8</option>

                <option value={9}>9</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={40}>40</option>
              </select>
            </label>

            <label style={{ flex: 1 }}>
              Slow
              <select
                value={smaSlowUI}
                onChange={(e) => setSmaSlowUI(Number(e.target.value))}
                style={{ width: "100%" }}
              >
                <option value={70}>70</option>
                <option value={80}>80</option>
                <option value={90}>90</option>
                <option value={100}>100</option>
                <option value={120}>120</option>
                <option value={150}>150</option>
                <option value={200}>200</option>
              </select>
            </label>
          </div>

          <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
  Aktiv: SMA {smaFastUI} / {smaSlowUI}
</div>

<div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8" }}>
  Middle SMA: {smaMiddleUI}
</div>

<input
  type="range"
  min={20}
  max={250}
  step={1}
  value={smaMiddleUI}
  onChange={(e) => setSmaMiddleUI(Number(e.target.value))}
  style={{ width: "100%" }}
/>
        </div>

        <div style={{ marginTop: 10, borderTop: "1px solid #334155", paddingTop: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={savePreset}
              style={{
                flex: 1,
                background: "#1d4ed8",
                color: "#fff",
                border: "1px solid #3b82f6",
                borderRadius: 6,
                padding: "6px 8px",
                cursor: "pointer",
              }}
            >
              💾 Save Preset
            </button>

            <button
              onClick={resetPreset}
              style={{
                flex: 1,
                background: "#334155",
                color: "#fff",
                border: "1px solid #475569",
                borderRadius: 6,
                padding: "6px 8px",
                cursor: "pointer",
              }}
            >
              ↺ Reset Preset
            </button>
          </div>

          {presetMessage ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "#93c5fd" }}>
              {presetMessage}
            </div>
          ) : null}
        </div>

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
        <div>Gross Profit Punkte: {grossProfit.toFixed(2)}</div>
        <div>Aktive Size: {(Number(symbolSizes[symbol]) || 0).toString()}</div>
<div>Gross Loss Punkte: {grossLoss.toFixed(2)}</div>
<div>Net PnL Punkte: {netPnL.toFixed(2)}</div>

<div>Gross Profit USD: {grossProfitUsd.toFixed(2)}</div>
<div>Gross Loss USD: {grossLossUsd.toFixed(2)}</div>
<div>Net PnL USD: {netPnLUsd.toFixed(2)}</div>

<div>Gross Profit EUR: {grossProfitEur.toFixed(2)}</div>
<div>Gross Loss EUR: {grossLossEur.toFixed(2)}</div>
<div>Net PnL EUR: {netPnLEur.toFixed(2)}</div>
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
          <div style={{ color: "#94a3b8" }}>TEST V4: Gegentrend-Exit + Adaptive Band</div>
          <div><span style={{ color: "#00ff88", fontWeight: 700 }}>●</span> Real buy</div>
          <div><span style={{ color: "#ff4d6d", fontWeight: 700 }}>●</span> Real sell</div>
          <div><span style={{ color: "#c084fc", fontWeight: 700 }}>●</span> Real close</div>
          <div><span style={{ color: "#b4b4b4", fontWeight: 700 }}>—</span> Middle SMA {smaMiddleUI} / Dynamic Band</div>
        </div>

        {error ? <div style={{ color: "#fca5a5", marginTop: 6 }}>{error}</div> : null}
  </div>
)}

      <div
  ref={priceRef}
  style={{
    flex: "0 0 72%",
    minHeight: 0,
    width: "100%",
    overflow: "hidden",
  }}
/>
      <div
    ref={distRef}
    style={{
    flex: "0 0 28%",
    minHeight: 0,
    width: "100%",
    overflow: "hidden",
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

async function fetchMultiTf(symbol: string): Promise<any | null> {
  try {
    const url = new URL("/strategy/multitf", BACKEND_BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("_ts", String(Date.now()));

    const res = await fetch(url.toString(), { cache: "no-store" });
    const json = await res.json();

    if (!res.ok || !json?.ok) return null;
    return json;
  } catch (e) {
    console.error("multitf fetch error", e);
    return null;
  }
}

async function postStrategyState(symbol: string, state: "flat" | "long" | "short"): Promise<void> {
  const res = await fetch(`${BACKEND_BASE}/strategy/state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol, state }),
  });

  const txt = await res.text();

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`STRATEGY STATE non-JSON response: ${txt}`);
  }

  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || json?.info || `STRATEGY STATE ERROR ${res.status}: ${txt}`);
  }
}

async function fetchStrategyState(symbol: string): Promise<"flat" | "long" | "short"> {
  const res = await fetch(
    `${BACKEND_BASE}/strategy/state?symbol=${encodeURIComponent(symbol)}&_ts=${Date.now()}`
  );

  const txt = await res.text();

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`STRATEGY STATE GET non-JSON response: ${txt}`);
  }

  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || json?.info || `STRATEGY STATE GET ERROR ${res.status}: ${txt}`);
  }

  const state = String(json.state || "flat").toLowerCase();
  return state === "long" || state === "short" ? state : "flat";
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


async function fetchSymbolConfig(): Promise<SymbolConfigMap> {
  const res = await fetch(`${BACKEND_BASE}/ui/config?_ts=${Date.now()}`, {
    cache: "no-store",
  });

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

  const rows: SymbolConfigRow[] = Array.isArray(json.rows) ? json.rows : [];
  const out: SymbolConfigMap = {};

  for (const row of rows) {
    const symbol = String(row.symbol || "").trim();
    if (symbol) out[symbol] = row;
  }

  return out;
}
async function saveSymbolConfig(row: SymbolConfigRow): Promise<void> {
  const res = await fetch(`${BACKEND_BASE}/ui/config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(row),
  });

  const txt = await res.text();

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`SAVE ERROR non-JSON response: ${txt}`);
  }

  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || json?.info || `SAVE ERROR ${res.status}: ${txt}`);
  }
}

function syncCharts(
  chartA: IChartApi,
  chartB: IChartApi,
  seriesA?: any,
  seriesB?: any
) {
  let isUpdatingRange = false;
  let isUpdatingCrosshair = false;

  const syncFromA = (range: any) => {
    if (!range || isUpdatingRange) return;
    isUpdatingRange = true;
    chartB.timeScale().setVisibleLogicalRange(range);
    isUpdatingRange = false;
  };

  const syncFromB = (range: any) => {
    if (!range || isUpdatingRange) return;
    isUpdatingRange = true;
    chartA.timeScale().setVisibleLogicalRange(range);
    isUpdatingRange = false;
  };

  chartA.timeScale().subscribeVisibleLogicalRangeChange(syncFromA);
  chartB.timeScale().subscribeVisibleLogicalRangeChange(syncFromB);

  if (!seriesA || !seriesB) return;

  chartA.subscribeCrosshairMove((param: any) => {
    if (isUpdatingCrosshair) return;

    if (!param || param.time == null) {
      if (typeof (chartB as any).clearCrosshairPosition === "function") {
        isUpdatingCrosshair = true;
        (chartB as any).clearCrosshairPosition();
        isUpdatingCrosshair = false;
      }
      return;
    }

    const price = param.seriesData?.get?.(seriesA)?.value
      ?? param.seriesData?.get?.(seriesA)?.close
      ?? param.seriesPrices?.get?.(seriesA);

    if (price == null || !Number.isFinite(Number(price))) return;

    if (typeof (chartB as any).setCrosshairPosition === "function") {
      isUpdatingCrosshair = true;
      (chartB as any).setCrosshairPosition(null, param.time, seriesB);
      isUpdatingCrosshair = false;
    }
  });

  chartB.subscribeCrosshairMove((param: any) => {
    if (isUpdatingCrosshair) return;

    if (!param || param.time == null) {
      if (typeof (chartA as any).clearCrosshairPosition === "function") {
        isUpdatingCrosshair = true;
        (chartA as any).clearCrosshairPosition();
        isUpdatingCrosshair = false;
      }
      return;
    }

    const price = param.seriesData?.get?.(seriesB)?.value
      ?? param.seriesData?.get?.(seriesB)?.close
      ?? param.seriesPrices?.get?.(seriesB);

    if (price == null || !Number.isFinite(Number(price))) return;

    if (typeof (chartA as any).setCrosshairPosition === "function") {
      isUpdatingCrosshair = true;
      (chartA as any).setCrosshairPosition(null, param.time, seriesA);
      isUpdatingCrosshair = false;
    }
  });
}



function setupVerticalCrosshairOverlay(
  priceContainer: HTMLDivElement,
  distContainer: HTMLDivElement,
  priceChart: IChartApi,
  distChart: IChartApi
) {
  const makeLine = (host: HTMLDivElement) => {
    const line = document.createElement("div");
    line.style.position = "absolute";
    line.style.top = "0";
    line.style.bottom = "0";
    line.style.width = "0";
    line.style.borderLeft = "1px dashed #94a3b8";
    line.style.pointerEvents = "none";
    line.style.zIndex = "15";
    line.style.display = "none";
    host.appendChild(line);
    return line;
  };

  const ensureRelative = (el: HTMLDivElement) => {
    const style = window.getComputedStyle(el);
    if (style.position === "static") {
      el.style.position = "relative";
    }
  };

  ensureRelative(priceContainer);
  ensureRelative(distContainer);

  const priceLine = makeLine(priceContainer);
  const distLine = makeLine(distContainer);

  const showAtTime = (time: any, sourceChart: IChartApi) => {
    if (time == null) {
      priceLine.style.display = "none";
      distLine.style.display = "none";
      return;
    }

    const sourceX = sourceChart.timeScale().timeToCoordinate(time);
    if (sourceX == null || !Number.isFinite(sourceX)) {
      priceLine.style.display = "none";
      distLine.style.display = "none";
      return;
    }

    const logical = sourceChart.timeScale().coordinateToLogical(sourceX);
    if (logical == null || !Number.isFinite(logical)) {
      priceLine.style.display = "none";
      distLine.style.display = "none";
      return;
    }

    const priceX = priceChart.timeScale().logicalToCoordinate(logical);
    const distX = distChart.timeScale().logicalToCoordinate(logical);

    if (priceX == null || distX == null) {
      priceLine.style.display = "none";
      distLine.style.display = "none";
      return;
    }

    priceLine.style.left = `${Math.round(priceX)}px`;
    distLine.style.left = `${Math.round(distX)}px`;
    priceLine.style.display = "block";
    distLine.style.display = "block";
  };

  const leave = () => {
    priceLine.style.display = "none";
    distLine.style.display = "none";
  };

  const onPriceMove = (param: any) => {
    if (!param || param.time == null) {
      leave();
      return;
    }
    showAtTime(param.time, priceChart);
  };

  const onDistMove = (param: any) => {
    if (!param || param.time == null) {
      leave();
      return;
    }
    showAtTime(param.time, distChart);
  };

  priceChart.subscribeCrosshairMove(onPriceMove);
  distChart.subscribeCrosshairMove(onDistMove);

  const onPriceLeave = () => leave();
  const onDistLeave = () => leave();

  priceContainer.addEventListener("mouseleave", onPriceLeave);
  distContainer.addEventListener("mouseleave", onDistLeave);

  return () => {
    try {
      priceChart.unsubscribeCrosshairMove(onPriceMove);
      distChart.unsubscribeCrosshairMove(onDistMove);
    } catch {}

    priceContainer.removeEventListener("mouseleave", onPriceLeave);
    distContainer.removeEventListener("mouseleave", onDistLeave);

    try {
      priceLine.remove();
      distLine.remove();
    } catch {}
  };
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

function alignLineToCandles(
  candles: Candle[],
  line: LinePoint[]
): WhitespaceLinePoint[] {
  const map = new Map<number, number>();
  for (const p of line) map.set(p.time, p.value);

  return candles.map((c: Candle) => {
    const value = map.get(c.time);
    if (value == null || !Number.isFinite(value)) return { time: c.time };
    return { time: c.time, value };
  });
}



function dedupeMarkers(points: MarkerPoint[]): MarkerPoint[] {
  const out: MarkerPoint[] = [];
  const seen = new Set<string>();

  for (const p of points) {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.value) || p.value <= 0) continue;
    const key = `${p.time}-${p.value}-${p.text ?? ""}`;
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
    .filter((p) => p.text)
    .map((p) => ({
      time: p.time,
      position,
      color: p.color ?? "#9ca3af",
      shape: "circle",
      text: p.text ?? "",
    })) as any;
}

function simulateStrategyTESTv4(
  candles: Candle[],
  dist: LinePoint[],
  distMiddle: LinePoint[],
  longEntries: MarkerPoint[],
  shortEntries: MarkerPoint[],
  bandLine: LinePoint[],
  assumedSpread: number,
  assumedSlippage: number
) {
  const candleMap = new Map<number, Candle>();
  for (const c of candles) candleMap.set(c.time, c);

  const distMapIndex = new Map<number, number>();
  dist.forEach((p, i) => distMapIndex.set(p.time, i));

  const middleMap = new Map<number, number>();
  for (const p of distMiddle) middleMap.set(p.time, p.value);

  const bandMap = new Map<number, number>();
  for (const p of bandLine) bandMap.set(p.time, p.value);

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

  let longRetestLevel: number | null = null;
  let shortRetestLevel: number | null = null;


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
    longRetestLevel = null;
    shortRetestLevel = null;
  };

  for (let i = 0; i < dist.length; i++) {
    const p = dist[i];
    const candle = candleMap.get(p.time);
    if (!candle) continue;

    const middle = middleMap.get(p.time) ?? null;
    if (middle === null) {
      prevDistValue = p.value;
      continue;
    }

    const band = bandMap.get(p.time) ?? null;
    if (band === null) {
      prevDistValue = p.value;
      continue;
    }

    const upperBand = middle + band;
    const lowerBand = middle - band;

    while (currentEntryPtr < entryEvents.length && entryEvents[currentEntryPtr].index === i) {
      const evt = entryEvents[currentEntryPtr];

      if (evt.side === "long") {
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
          longRetestLevel = null;
          shortRetestLevel = null;
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
          shortRetestLevel = null;
          longRetestLevel = null;
                }
      }

      currentEntryPtr += 1;
    }

    if (position === "long" && openTrade && prevDistValue !== null) {
      if (p.value > lowerBand && longRetestLevel === null) {
        longRetestLevel = lowerBand;
      }

      if (p.value > middle) {
        longRetestLevel = middle;
      }

      if (
        longRetestLevel !== null &&
        prevDistValue > longRetestLevel &&
        p.value <= longRetestLevel
      ) {
        longExitPoints.push({ time: candle.time, value: candle.low });
        closeTrade(candle, "long");
        prevDistValue = p.value;
          continue;
      }
    }

    if (position === "short" && openTrade && prevDistValue !== null) {
      if (p.value < upperBand && shortRetestLevel === null) {
        shortRetestLevel = upperBand;
      }

      if (p.value < middle) {
        shortRetestLevel = middle;
      }

      if (
        shortRetestLevel !== null &&
        prevDistValue < shortRetestLevel &&
        p.value >= shortRetestLevel
      ) {
        shortExitPoints.push({ time: candle.time, value: candle.high });
        closeTrade(candle, "short");
        prevDistValue = p.value;
          continue;
      }
    }

    prevDistValue = p.value;
  }

  const netPnL = grossProfit - grossLoss;

  let lastSignalText = "-";
  const lastLong = longEntries.length ? longEntries[longEntries.length - 1].time : null;
  const lastShort = shortEntries.length ? shortEntries[shortEntries.length - 1].time : null;

  if (lastLong && lastShort) {
    lastSignalText =
      lastLong > lastShort ? `LONG ${formatTime(lastLong)}` : `SHORT ${formatTime(lastShort)}`;
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
          text: "BL",
          color: "#9ca3af",
        });
      } else {
        blockedShortPoints.push({
          time: baseTime,
          value: candleNear?.high ?? price,
          text: "BS",
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


function chartifyCandles(candles: Candle[]): Candle[] {
  return candles.map((c) => ({
    ...c,
    time: Number(c.time),
  }));
}

function chartifyLinePoints<T extends { time: number }>(points: T[]): T[] {
  return points.map((p) => ({
    ...p,
    time: Number(p.time),
  }));
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
