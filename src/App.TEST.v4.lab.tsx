import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
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
/*
type UiStrategyEvent = {
  id: number;
  created_at: string;
  symbol: string;
  tf: string;
  side: "long" | "short" | "flat";
  time: number;
  price: number;
  source: string;
  reason: string;
};
*/
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

type MacdKnickEvent = {
  time: number;
  value: number;
  side: "bull" | "bear";
  strength?: number;
};


/*
type WhitespaceLinePoint = {
  time: number;
  value?: number;
};
*/

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
  sma_offset?: number | null;
  min_kink: number | null;
  peak_lookback: number | null;
  sma_fast: number | null;
  sma_slow: number | null;
  sma_middle: number | null;
  adaptive_band: number | boolean | null;
  adaptive_band_mult: number | null;
  use_slow_exit?: number | boolean | null;
  size: number | null;
  updated_at?: string;
  renkoReversalBricks?: number | null;
  renko_reversal_bricks?: number | null;
  auto_enabled?: number | boolean | null;
  direction_threshold_pct?: number | null;
  directionThresholdPct?: number | null;
};

type SymbolConfigMap = Record<string, SymbolConfigRow>;

type ScannerRow = {
  symbol: string;
  interval: string;
  trades: number;
  wins: number;
  losses: number;
  pf: number | null;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  error?: string;
};




type SymbolSizeMap = Record<string, number>;

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const LIMIT = 10000;
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
  "TY",
  "EURUSD",
];

const ENTRY_BAND_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 160,
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
  TY: 0.08,
  EURUSD: 0.0019,
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
  TY: 1,
  EURUSD: 1,
};

const MIN_KINK_MOVE_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 25,
  ETHUSD: 1.5,
  XRPUSD: 0.002,
  DE40: 20,
  US100: 4,
  US500: 1,
  US30: 8,
  J225: 10,
  UK100: 3,
  GOLD: 3,
  SILVER: 0.03,
  OIL_CRUDE: 0.08,
  CORN: 0.08,
  SOLUSD: 0.08,
  TSLA: 0.08,
  TY: 0.01,
  EURUSD: 0.0003,
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
  TY: 0.01,
  EURUSD: 0.0003,
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
  TSLA: 0.5,
  TY: 0.01,
  EURUSD: 0.0003,
};

 const SMA_OFFSET_MAX_BY_SYMBOL: Record<string, number> = {
  BTCUSD: 5000,
  ETHUSD: 300,
  XRPUSD: 1,
  DE40: 1000,
  US100: 800,
  US500: 150,
  US30: 1000,
  J225: 2000,
  UK100: 300,
  GOLD: 300,
  SILVER: 5,
  OIL_CRUDE: 20,
  CORN: 20,
  SOLUSD: 50,
  TSLA: 100,
  TY: 50,
  EURUSD: 50,
};

function buildHeikinAshi(candles: Candle[]): Candle[] {
  if (!candles.length) return [];

  const out: Candle[] = [];

  let haOpen = (candles[0].open + candles[0].close) / 2;
  let haClose =
    (candles[0].open +
      candles[0].high +
      candles[0].low +
      candles[0].close) / 4;

  out.push({
    time: candles[0].time,
    open: haOpen,
    high: Math.max(candles[0].high, haOpen, haClose),
    low: Math.min(candles[0].low, haOpen, haClose),
    close: haClose,
  });

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];

    haClose =
      (c.open + c.high + c.low + c.close) / 4;

    haOpen =
      (out[i - 1].open + out[i - 1].close) / 2;

    out.push({
      time: c.time,
      open: haOpen,
      high: Math.max(c.high, haOpen, haClose),
      low: Math.min(c.low, haOpen, haClose),
      close: haClose,
    });
  }

  return out;
}

function buildDirectionLine(
  candles: Candle[],
  thresholdPct = 0.15,
  minMove = 0
) {
  if (!candles.length) return { line: [], turns: [] };

  const line: any[] = [];
  const turns: any[] = [];

  let direction: "up" | "down" = "up";
  let extreme = candles[0].close;
  let lineValue = candles[0].close;

  for (const c of candles) {
    const price = c.close;
    const threshold = Math.max(price * (thresholdPct / 100), minMove);

    if (direction === "up") {
      if (price > extreme) extreme = price;

      const pullback = extreme - price;

      if (pullback >= threshold) {
        direction = "down";
        extreme = price;
        turns.push({ time: c.time, value: price, side: "short" });
      }

      lineValue = Math.max(lineValue, extreme);
    } else {
      if (price < extreme) extreme = price;

      const rebound = price - extreme;

      if (rebound >= threshold) {
        direction = "up";
        extreme = price;
        turns.push({ time: c.time, value: price, side: "long" });
      }

      lineValue = Math.min(lineValue, extreme);
    }

    line.push({ time: c.time, value: lineValue, direction });
  }

  return { line, turns };
}


function buildLineHeikinSignals(
  haCandles: Candle[],
  dirLine: any,
  zonePct = 0.03
) {
  const longs: MarkerPoint[] = [];
  const shorts: MarkerPoint[] = [];

  if (!haCandles.length || !dirLine?.line?.length) {
    return { longs, shorts };
  }

  const dirByTime = new Map<number, any>();
  dirLine.line.forEach((p: any) => dirByTime.set(Number(p.time), p));

  let lastTrend: "up" | "down" | null = null;
  let activeSide: "long" | "short" | null = null;
  let zoneTriggered = false;
  let lastEntryWasFlip = false;

  for (let i = 1; i < haCandles.length; i++) {
    const h = haCandles[i];
    const prevLine = dirByTime.get(Number(haCandles[i - 1].time));
    const currLine = dirByTime.get(Number(h.time));

    if (!prevLine || !currLine) continue;

    const diff = Number(currLine.value) - Number(prevLine.value);
    const zoneLimit = Math.abs(Number(currLine.value)) * (zonePct / 100);
    const lineRising = diff > 0;
const lineFalling = diff < 0;

    let lineState: "up" | "down" | "zone";

    if (diff > zoneLimit) {
      lineState = "up";
    } else if (diff < -zoneLimit) {
      lineState = "down";
    } else {
      lineState = "zone";
    }

    const isGreen = h.close > h.open;
    const isRed = h.close < h.open;

    let earlySignalSide: "long" | "short" | null = null;

if (activeSide === "short" && lineRising && isGreen) {
  longs.push({
    time: h.time,
    value: h.low,
  });
  activeSide = "long";
  earlySignalSide = "long";
}

if (activeSide === "long" && lineFalling && isRed) {
  shorts.push({
    time: h.time,
    value: h.high,
  });
  activeSide = "short";
  earlySignalSide = "short";
}

    // Linie läuft wieder eindeutig
   if (!earlySignalSide && (lineState === "up" || lineState === "down")) {
      zoneTriggered = false;

      // Sofort-Flip, wenn Linie gegen aktive Position kippt
      if (activeSide === "short" && lineState === "up") {
  longs.push({
    time: h.time,
    value: h.low,
  });

  activeSide = "long";
        lastEntryWasFlip = true;

  // Wichtig:
  // Line-Flip darf die nächste Wechselzone NICHT blockieren.
  zoneTriggered = false;
}

if (activeSide === "long" && lineState === "down") {
  shorts.push({
    time: h.time,
    value: h.high,
  });

  activeSide = "short";
  lastEntryWasFlip = true;

  // Wichtig:
  // Line-Flip darf die nächste Wechselzone NICHT blockieren.
  zoneTriggered = false;
}

      lastTrend = lineState;
      continue;
    }

    if (lineState === "zone") {
      /*
  console.log("[ZONE CHECK]", {
    time: h.time,
    lastTrend,
    activeSide,
    zoneTriggered,
    earlySignalSide,
    isGreen,
    isRed,
  });
      */
}

// Wechselzone
if (!earlySignalSide && lineState === "zone" && !zoneTriggered) {
 const effectiveSide =
  lastEntryWasFlip && activeSide
    ? activeSide
    : activeSide ??
      (lastTrend === "up"
        ? "long"
        : lastTrend === "down"
        ? "short"
        : null);

  // SHORT aktiv / vorher DOWN -> erste grüne Heikin = LONG
  if (effectiveSide === "short" && isGreen) {
    longs.push({
      time: h.time,
      value: h.low,
    });

    activeSide = "long";
    zoneTriggered = true;
    lastEntryWasFlip = false;
  }

  // LONG aktiv / vorher UP -> erste rote Heikin = SHORT
  if (effectiveSide === "long" && isRed) {
    shorts.push({
      time: h.time,
      value: h.high,
    });

    activeSide = "short";
    zoneTriggered = true;
    lastEntryWasFlip = false;
  }
}

// Ende der for-Schleife
}

return { longs, shorts };
}

function buildHaTfBlocks(candles: any[]): ("blue" | "red")[] {
  if (!Array.isArray(candles) || candles.length < 10) return [];

  const ha = buildHeikinAshi(candles);
  const last10 = ha.slice(-10);

  return last10.map((c: any) =>
    Number(c.close) >= Number(c.open) ? "blue" : "red"
  );
}

function buildHaMacd1mDots(candles1m: any[]): ("green" | "red")[] {
  if (!Array.isArray(candles1m) || candles1m.length < 30) return [];

  const ha = buildHeikinAshi(candles1m);

  const macd = calcMACD(ha, 1, 18, 5);
  console.log("MACD", macd);

const line = macd.macd || [];

if (!line || line.length < 6) return [];

// Letzte 6 Punkte ergeben 5 echte Bewegungsstrecken
const lastPoints = line.slice(-6);

const dots: ("green" | "red")[] = [];

for (let i = 1; i < lastPoints.length; i++) {
  const prev = Number(lastPoints[i - 1].value);
  const curr = Number(lastPoints[i].value);

  // Jede Strecke einzeln bewerten:
  // curr > prev = Linie steigt
  // curr < prev = Linie fällt
  dots.push(curr >= prev ? "green" : "red");
}

return dots;
}

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

  const [scannerOpen, setScannerOpen] = useState(false);
const [scannerRows, setScannerRows] = useState<ScannerRow[]>([]);
const [scannerLoading, setScannerLoading] = useState(false);
const [scannerMessage, setScannerMessage] = useState("");

  const [maxPositionLossEur, setMaxPositionLossEur] = useState<string>("");
  const [maxLossMessage, setMaxLossMessage] = useState("");

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
  const [directionThresholdPctUI, setDirectionThresholdPctUI] = useState(0.20);
  const [kinkConfirmBarsUI, setKinkConfirmBarsUI] = useState(3);
  const [peakUI, setPeakUI] = useState(peakLookback);

  const [smaFastUI, setSmaFastUI] = useState(10);
  const [smaSlowUI, setSmaSlowUI] = useState(100);
  const [smaOffsetUI, setSmaOffsetUI] = useState(150);
  
  const [smaMiddleUI, setSmaMiddleUI] = useState(100);
  const [adaptiveBandUI, setAdaptiveBandUI] = useState(false);
  const [adaptiveBandMultUI, setAdaptiveBandMultUI] = useState(1);
  const [useSlowExitUI, setUseSlowExitUI] = useState(true);
  const [infoOpen, setInfoOpen] = useState(true);
  const [chartType, setChartType] = useState<"candles" | "renko" | "heikin">("heikin");
  const [macd1mDots, setMacd1mDots] = useState<("green" | "red")[]>([]);
  const [haTfMatrix, setHaTfMatrix] = useState<
  Record<string, ("blue" | "red")[]>
>({
  "1m": [],
  "5m": [],
  "15m": [],
  "30m": [],
  "1h": [],
});
  const [renkoBoxMode, setRenkoBoxMode] = useState<"fixed" | "atr">("fixed");
  const [renkoSourceMode, setRenkoSourceMode] = useState<"close" | "hl">("close");
  const [renkoReversalBricksUI, setRenkoReversalBricksUI] = useState(2);
const [renkoAtrLenUI, setRenkoAtrLenUI] = useState(14);
const [renkoAtrMultUI, setRenkoAtrMultUI] = useState(1);
const [renkoBoxInfo, setRenkoBoxInfo] = useState("-");
  const [renkoTrendInfo, setRenkoTrendInfo] = useState("-");
const [renkoTrendLookbackUI, setRenkoTrendLookbackUI] = useState(20);
  const [useKnickStrengthFilter, setUseKnickStrengthFilter] = useState(false);
const [minKnickStrengthFilter, setMinKnickStrengthFilter] = useState(0);
const [rawReplayText, setRawReplayText] = useState("-");
const [filteredReplayText, setFilteredReplayText] = useState("-");

  

  
  
  const ENTRY_BAND_MIN_BY_SYMBOL: Record<string, number> = {
  GOLD: 2,
  SILVER: 0.05,
};

  useEffect(() => {
  const cfg = symbolConfigMap[symbol];

  if (cfg) {
    setEntryBandUI(Number(cfg.entry_band ?? entryBand));
    setMinKinkUI(Number(cfg.min_kink ?? minKinkMove));
    setDirectionThresholdPctUI(
  Number(cfg.direction_threshold_pct ?? cfg.directionThresholdPct ?? 0.20)
);
    setPeakUI(Number(cfg.peak_lookback ?? peakLookback));
    setSmaFastUI(Number(cfg.sma_fast ?? 10));
    setSmaSlowUI(Number(cfg.sma_slow ?? 100));
    setSmaOffsetUI(Number(cfg.sma_offset ?? 150));
    setSmaMiddleUI(Number(cfg.sma_middle ?? 100));
    setAdaptiveBandUI(Boolean(cfg.adaptive_band ?? false));
    setAdaptiveBandMultUI(Number(cfg.adaptive_band_mult ?? 1));
    setUseSlowExitUI(cfg.use_slow_exit == null ? true : Number(cfg.use_slow_exit) === 1);
    setRenkoReversalBricksUI(
  cfg.renkoReversalBricks != null
    ? Number(cfg.renkoReversalBricks)
    : cfg.renko_reversal_bricks != null
      ? Number(cfg.renko_reversal_bricks)
      : 2
);
    
    if (cfg.interval && INTERVALS.includes(cfg.interval as IntervalOption)) {
  setInterval(cfg.interval as IntervalOption);
}

    if (cfg.size != null && Number.isFinite(Number(cfg.size))) {
      setSymbolSizes((prev) => ({
        ...prev,
        [symbol]: Number(cfg.size),
      }));
    }

    setPresetMessage(`Backend-Konfig geladen für ${symbol}`);
  } else {
    setEntryBandUI(entryBand);
    setMinKinkUI(minKinkMove);
    setDirectionThresholdPctUI(0.20);
    setPeakUI(peakLookback);
    setSmaFastUI(10);
    setSmaSlowUI(100);
    setSmaMiddleUI(100);
    setAdaptiveBandUI(false);
    setAdaptiveBandMultUI(1);
    setUseSlowExitUI(true);

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

  /*
async function fetchUiStrategyEvents(symbol: string): Promise<UiStrategyEvent[]> {
  try {
    const res = await fetch(
      `${BACKEND_BASE}/ui/strategy-events?symbol=${encodeURIComponent(symbol)}&_ts=${Date.now()}`,
      { cache: "no-store" }
    );

    const json = await res.json();
    if (!res.ok || !json?.ok || !Array.isArray(json.rows)) return [];

    return json.rows;
  } catch {
    return [];
  }

}
*/
  
async function toggleAutoEnabled(symbolToToggle: string) {
  try {
    const old = symbolConfigMap[symbolToToggle] || null;
    if (!old) return;

    const current =
      old.auto_enabled == null ? 1 : Number(old.auto_enabled) === 0 ? 0 : 1;

    const next = current === 1 ? 0 : 1;

    const row: SymbolConfigRow = {
      ...old,
      symbol: symbolToToggle,
      auto_enabled: next,
    };

    await saveSymbolConfig(row);

    setSymbolConfigMap((prev) => ({
      ...prev,
      [symbolToToggle]: row,
    }));

    setPresetMessage(
      `${symbolToToggle} Auto ${next === 1 ? "aktiviert" : "deaktiviert"}`
    );
  } catch (e) {
    console.error(e);
    setPresetMessage(`Auto-Schalter fehlgeschlagen für ${symbolToToggle}`);
  }
}
  
  async function savePreset() {
  try {
    const row: SymbolConfigRow = {
      symbol,
      interval,
      entry_band: entryBandUI,
      sma_offset: smaOffsetUI,
      min_kink: minKinkUI,
      direction_threshold_pct: directionThresholdPctUI,
      peak_lookback: peakUI,
      sma_fast: smaFastUI,
      sma_slow: smaSlowUI,
      sma_middle: smaMiddleUI,
      renkoReversalBricks: renkoReversalBricksUI,
      adaptive_band: adaptiveBandUI ? 1 : 0,
      adaptive_band_mult: adaptiveBandMultUI,
      use_slow_exit: useSlowExitUI ? 1 : 0,
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

  async function loadMaxPositionLoss() {
  try {
    const res = await fetch(`${BACKEND_BASE}/risk/position-loss?_ts=${Date.now()}`, {
      cache: "no-store",
    });

    const json = await res.json();

    if (json?.ok) {
      setMaxPositionLossEur(
        json.max_position_loss_eur == null ? "" : String(json.max_position_loss_eur)
      );
    }
  } catch (e) {
    console.error(e);
  }
}
/*
  async function fetchRealEvents(symbol: string) {
  try {
    const res = await fetch(`${BACKEND_BASE}/ui/real-events?symbol=${symbol}`);
    const json = await res.json();
    if (!json?.ok) return [];
    return json.events || [];
  } catch {
    return [];
  }
}
*/

async function saveMaxPositionLoss() {
  try {
    const n = Number(maxPositionLossEur);

    const res = await fetch(`${BACKEND_BASE}/risk/position-loss`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        max_position_loss_eur: Number.isFinite(n) && n > 0 ? n : 0,
      }),
    });

    const json = await res.json();

    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "save failed");
    }

    setMaxLossMessage(
      json.enabled
        ? `Max Loss aktiv: -${json.max_position_loss_eur} €`
        : "Max Loss deaktiviert"
    );

    setTimeout(() => setMaxLossMessage(""), 2500);
  } catch (e) {
    console.error(e);
    setMaxLossMessage("Max Loss speichern fehlgeschlagen");
  }
}

useEffect(() => {
  loadMaxPositionLoss();
}, []);


  async function resetPreset() {
  try {
    const row: SymbolConfigRow = {
      symbol,
      interval,
      entry_band: entryBand,
      sma_offset: 150,
      min_kink: minKinkMove,
      peak_lookback: peakLookback,
      sma_fast: 10,
      sma_slow: 100,
      sma_middle: 100,
      adaptive_band: 0,
      adaptive_band_mult: 1,
      direction_threshold_pct: directionThresholdPctUI,
      size: Number(symbolSizes[symbol]) > 0 ? Number(symbolSizes[symbol]) : null,
    };

    await saveSymbolConfig(row);

    setSymbolConfigMap((prev) => ({
      ...prev,
      [symbol]: row,
    }));

    setEntryBandUI(entryBand);
    setMinKinkUI(minKinkMove);
    setPeakUI(peakLookback);
    setSmaFastUI(10);
    setSmaSlowUI(100);
    setSmaMiddleUI(100);
    setAdaptiveBandUI(false);
    setAdaptiveBandMultUI(1);
    setRenkoReversalBricksUI(2);

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
      interval: old?.interval ?? interval,
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
        interval: old?.interval ?? interval,
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

      async function runBacktestScanner() {
  try {
    setScannerLoading(true);
    setScannerMessage("Scanner läuft...");

    const rows: ScannerRow[] = [];

    for (const s of SYMBOLS) {
      try {
        const cfg = symbolConfigMap[s] || null;

        const tf =
          cfg?.interval && INTERVALS.includes(cfg.interval as IntervalOption)
            ? (cfg.interval as IntervalOption)
            : interval;

        const entryBandVal = Number(cfg?.entry_band ?? ENTRY_BAND_BY_SYMBOL[s] ?? 100);
        //const minKinkVal = Number(cfg?.min_kink ?? MIN_KINK_MOVE_BY_SYMBOL[s] ?? 1);
        const smaFastVal = Number(cfg?.sma_fast ?? 10);
        const smaSlowVal = Number(cfg?.sma_slow ?? 100);
        const smaMiddleVal = Number(cfg?.sma_middle ?? 100);
        const smaOffsetVal = Number(cfg?.sma_offset ?? 150);
        const adaptiveBandVal = Boolean(cfg?.adaptive_band ?? false);
        const adaptiveBandMultVal = Number(cfg?.adaptive_band_mult ?? 1);

        const candles = await fetchCandles(s, tf);
        if (!candles.length) throw new Error("no candles");

 try {
  console.log("[HA MACD 1M] start", s);

  const candles1m = await fetchCandles(s, "1m");

  console.log("[HA MACD 1M] candles", candles1m.length);

  const dots = buildHaMacd1mDots(candles1m);

  console.log("[HA MACD 1M] dots", dots);

  setMacd1mDots(dots);
} catch (e) {
  console.warn("[HA MACD 1M] failed", e);
  setMacd1mDots([]);
}
        try {
  const tfs = ["1m", "5m", "15m", "30m", "1h"];

  const entries = await Promise.all(
    tfs.map(async (tf) => {
      const c = await fetchCandles(symbol, tf);
      return [tf, buildHaTfBlocks(c)] as const;
    })
  );

  setHaTfMatrix(Object.fromEntries(entries));
} catch (e) {
  console.warn("[HA TF MATRIX] failed", e);
  setHaTfMatrix({
    "1m": [],
    "5m": [],
    "15m": [],
    "30m": [],
    "1h": [],
  });
}

        const smaFast = sanitizeLinePoints(calcSMA(candles, smaFastVal));
        const smaSlow = sanitizeLinePoints(calcSMA(candles, smaSlowVal));

        const smaUpper = smaSlow.map((p) => ({
          time: p.time,
          value: p.value + smaOffsetVal,
        }));

        const smaLower = smaSlow.map((p) => ({
          time: p.time,
          value: p.value - smaOffsetVal,
        }));

        const outlierLongPoints: MarkerPoint[] = [];
        const outlierShortPoints: MarkerPoint[] = [];

        let lastALIndex = -9999;
        let lastASIndex = -9999;
        const outlierCooldownBars = 12;
        const markerStartIndex = Math.max(1, candles.length - 3000);

        for (let i = markerStartIndex; i < candles.length; i++) {
          const prev = candles[i - 1];
          const curr = candles[i];

          const prevUpper = smaUpper[i - 1];
          const prevLower = smaLower[i - 1];
          const currUpper = smaUpper[i];
          const currLower = smaLower[i];

          if (!prevUpper || !prevLower || !currUpper || !currLower) continue;

          if (
            i - lastALIndex >= outlierCooldownBars &&
            prev.low >= prevLower.value &&
            curr.low < currLower.value
          ) {
            outlierLongPoints.push({ time: curr.time, value: curr.low });
            lastALIndex = i;
          }

          if (
            i - lastASIndex >= outlierCooldownBars &&
            prev.high <= prevUpper.value &&
            curr.high > currUpper.value
          ) {
            outlierShortPoints.push({ time: curr.time, value: curr.high });
            lastASIndex = i;
          }
        }

        //const smaTurns = buildSmaTurnMarkers(smaSlow, 5);

        

        

        const dist = sanitizeLinePoints(calcDistance(smaFast, smaSlow));

        const distAsCandles = dist.map((p) => ({
          time: p.time,
          open: p.value,
          high: p.value,
          low: p.value,
          close: p.value,
        }));

        let distMiddle = sanitizeLinePoints(calcSMA(distAsCandles, smaMiddleVal));
        if (!distMiddle.length) distMiddle = dist;

        const distVolatility = sanitizeLinePoints(calcStdDevLine(dist, 50));
        const dynamicBand = buildAdaptiveBandLine(
          distMiddle,
          distVolatility,
          entryBandVal,
          adaptiveBandVal,
          adaptiveBandMultVal
        );

        const distIndexByTime = new Map<number, number>();
        dist.forEach((p, i) => distIndexByTime.set(p.time, i));

     

        

        

        

        const filteredLongEntries = dedupeMarkers(outlierLongPoints);
        const filteredShortEntries = dedupeMarkers(outlierShortPoints);

        const sim = simulateStrategyTESTv4(
          candles,
          dist,
          distMiddle,
          filteredLongEntries,
          filteredShortEntries,
          dynamicBand,
          SPREAD_BY_SYMBOL[s] ?? 0,
          SLIPPAGE_BY_SYMBOL[s] ?? 0,
          smaFast,
          smaUpper,
          smaSlow,
          smaLower
        );

        const pf =
          sim.grossLoss > 0
            ? sim.grossProfit / sim.grossLoss
            : sim.grossProfit > 0
              ? Number.POSITIVE_INFINITY
              : null;

        rows.push({
          symbol: s,
          interval: tf,
          trades: sim.tradeCount,
          wins: sim.winCount,
          losses: sim.lossCount,
          pf,
          netPnL: sim.netPnL,
          grossProfit: sim.grossProfit,
          grossLoss: sim.grossLoss,
        });
      } catch (e) {
        rows.push({
          symbol: s,
          interval: "-",
          trades: 0,
          wins: 0,
          losses: 0,
          pf: null,
          netPnL: 0,
          grossProfit: 0,
          grossLoss: 0,
          error: e instanceof Error ? e.message : "error",
        });
      }
    }

    rows.sort((a, b) => {
      const apf = a.pf === null ? -1 : a.pf === Number.POSITIVE_INFINITY ? 999999 : a.pf;
      const bpf = b.pf === null ? -1 : b.pf === Number.POSITIVE_INFINITY ? 999999 : b.pf;
      return bpf - apf;
    });

    setScannerRows(rows);
    setScannerMessage(`Scanner fertig: ${rows.length} Instrumente`);
  } catch (e) {
    console.error(e);
    setScannerMessage("Scanner fehlgeschlagen");
  } finally {
    setScannerLoading(false);
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
  const max = SMA_OFFSET_MAX_BY_SYMBOL[symbol] ?? 1000;
  setSmaOffsetUI((prev) => Math.min(prev, max));
}, [symbol]);

  useEffect(() => {
    if (!priceChartRef.current || !distChartRef.current) return;

    let cancelled = false;

    const priceChart = priceChartRef.current;
    const distChart = distChartRef.current;

    const mainSeries = priceChart.addSeries(CandlestickSeries, {
  upColor: "#00e5ff",
  downColor: "#ef4444",
  borderVisible: false,
  wickUpColor: "#00e5ff",
  wickDownColor: "#ef4444",
});

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
/*
    const holdLineSeries = priceChart.addSeries(LineSeries, {
  color: "#ff00ff",
  lineWidth: 3,
  priceLineVisible: false,
  lastValueVisible: false,
});
*/

    const smaUpperSeries = priceChart.addSeries(LineSeries, {
  color: "#ff4d6d",
  lineWidth: 2,
  priceLineVisible: false,
  lastValueVisible: false,
});

const smaLowerSeries = priceChart.addSeries(LineSeries, {
  color: "#00ff88",
  lineWidth: 2,
  priceLineVisible: false,
  lastValueVisible: false,
}); 

    const directionLineSeries = priceChart.addSeries(LineSeries, {
  color: "#facc15",
  lineWidth: 3,
  priceLineVisible: false,
  lastValueVisible: false,
});
/*
    const directionZoneSeries = priceChart.addSeries(LineSeries, {
  color: "#ff00ff",
  lineWidth: 4,
  priceLineVisible: false,
  lastValueVisible: false,
});
   */

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
      pointMarkersVisible: false,
      pointMarkersRadius: 5,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const strategyShortSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#ef4444",
      lineVisible: false,
      pointMarkersVisible: false,
      pointMarkersRadius: 5,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const strategyLongExitSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#f59e0b",
      lineVisible: false,
      pointMarkersVisible: false,
      pointMarkersRadius: 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const strategyShortExitSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#f59e0b",
      lineVisible: false,
      pointMarkersVisible: false,
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

    const outlierLongSeries = priceChart.addSeries(LineSeries, {
  priceScaleId: "",
  color: "#00ffff",
  lineVisible: false,
  pointMarkersVisible: false,
  priceLineVisible: false,
  lastValueVisible: false,
});

const outlierShortSeries = priceChart.addSeries(LineSeries, {
  priceScaleId: "",
  color: "#ff00ff",
  lineVisible: false,
  pointMarkersVisible: false,
  priceLineVisible: false,
  lastValueVisible: false,
});

    

    const realBuySeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#00ff88",
      lineVisible: false,
      pointMarkersVisible: false,
      pointMarkersRadius: 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const realSellSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#ff4d6d",
      lineVisible: false,
      pointMarkersVisible: false,
      pointMarkersRadius: 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const realCloseSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#c084fc",
      lineVisible: false,
      pointMarkersVisible: false,
      pointMarkersRadius: 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const macdHistSeries = distChart.addSeries(HistogramSeries, {
  priceLineVisible: false,
  lastValueVisible: false,
});

const macdLineSeries = distChart.addSeries(LineSeries, {
  color: "#00e5ff",
  lineWidth: 2,
  priceLineVisible: false,
  lastValueVisible: false,
});

const macdSignalSeries = distChart.addSeries(LineSeries, {
  color: "#ff4d6d",
  lineWidth: 2,
  priceLineVisible: false,
  lastValueVisible: false,
});

const macdZeroSeries = distChart.addSeries(LineSeries, {
  color: "#94a3b8",
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
});

    const macdBullKnickSeries = distChart.addSeries(LineSeries, {
  priceScaleId: "",
  color: "#22c55e",
  lineVisible: false,
  pointMarkersVisible: true,
  pointMarkersRadius: 9,
  priceLineVisible: false,
  lastValueVisible: false,
});

const macdBearKnickSeries = distChart.addSeries(LineSeries, {
  priceScaleId: "",
  color: "#ef4444",
  lineVisible: false,
  pointMarkersVisible: true,
  pointMarkersRadius: 9,
  priceLineVisible: false,
  lastValueVisible: false,
});

    const flipLongSeries = priceChart.addSeries(LineSeries, {
  priceScaleId: "",
  color: "#22c55e",
  lineVisible: false,
  pointMarkersVisible: true,
  pointMarkersRadius: 8,
  priceLineVisible: false,
  lastValueVisible: false,
});

const flipShortSeries = priceChart.addSeries(LineSeries, {
  priceScaleId: "",
  color: "#ef4444",
  lineVisible: false,
  pointMarkersVisible: true,
  pointMarkersRadius: 8,
  priceLineVisible: false,
  lastValueVisible: false,
});
    
/*
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

   */ 

    async function loadData() {
      const mySeq = ++loadSeqRef.current;
      try {
        setStatus("loading");
        setError("");

        const [candles, liveBrokerState, aggRows, backendStrategyState] = await Promise.all([
  fetchCandles(symbol, interval),
  fetchBrokerPositionState(symbol),
  fetchAggTrades(symbol),
  fetchStrategyState(symbol),
  //fetchUiStrategyEvents(symbol),
]);
        if (cancelled || mySeq !== loadSeqRef.current) return;
       

        if (cancelled) return;
        if (!candles.length) throw new Error("No valid candles returned");

        const smaFast = sanitizeLinePoints(calcSMA(candles, smaFastUI));
        const smaSlow = sanitizeLinePoints(calcSMA(candles, smaSlowUI));

         const haCandles = buildHeikinAshi(candles);
       const dirLine = buildDirectionLine(
  candles,
  directionThresholdPctUI,
  0
);
        const lineSignals = buildLineHeikinSignals(
  haCandles,
  dirLine,
  0.03
);
              
        const directionLongSignals: MarkerPoint[] = [];
const directionShortSignals: MarkerPoint[] = [];

let zoneFrom: "up" | "down" | null = null;
let oppositeCount = 0;

const dirByTime = new Map<number, any>();
dirLine.line.forEach((p: any) => dirByTime.set(p.time, p));

for (let i = 1; i < haCandles.length; i++) {
  const prevDir = dirByTime.get(haCandles[i - 1].time);
  const currDir = dirByTime.get(haCandles[i].time);
  if (!prevDir || !currDir) continue;

  const horizontal = currDir.value === prevDir.value;

  if (!horizontal) {
    zoneFrom = currDir.direction;
    oppositeCount = 0;
    continue;
  }

  const h = haCandles[i];

  if (zoneFrom === "up") {
    if (h.close < h.open) {
      oppositeCount += 1;
      if (oppositeCount === 2) {
        directionShortSignals.push({
          time: h.time,
          value: h.high,
        });
      }
    } else {
      oppositeCount = 0;
    }
  }

  if (zoneFrom === "down") {
    if (h.close > h.open) {
      oppositeCount += 1;
      if (oppositeCount === 2) {
        directionLongSignals.push({
          time: h.time,
          value: h.low,
        });
      }
    } else {
      oppositeCount = 0;
    }
  }
}
        const smaUpper = smaSlow.map((p) => ({
  time: p.time,
  value: p.value + smaOffsetUI,
}));

const smaLower = smaSlow.map((p) => ({
  time: p.time,
  value: p.value - smaOffsetUI,
}));

        

const outlierLongPoints: MarkerPoint[] = [];
const outlierShortPoints: MarkerPoint[] = [];

const upperMap = new Map(smaUpper.map((p) => [p.time, p.value]));
const lowerMap = new Map(smaLower.map((p) => [p.time, p.value]));

let lastALIndex = -9999;
let lastASIndex = -9999;
const outlierCooldownBars = 12;
const markerStartIndex = Math.max(1, candles.length - 3000);

for (let i = markerStartIndex; i < candles.length; i++) {
  const prev = candles[i - 1];
  const curr = candles[i];

  const prevUpper = upperMap.get(prev.time);
  const prevLower = lowerMap.get(prev.time);
  const currUpper = upperMap.get(curr.time);
  const currLower = lowerMap.get(curr.time);

  if (
    prevUpper == null ||
    prevLower == null ||
    currUpper == null ||
    currLower == null
  ) {
    continue;
  }

  if (
    i - lastALIndex >= outlierCooldownBars &&
    prev.low >= prevLower &&
    curr.low < currLower
  ) {
    outlierLongPoints.push({ time: curr.time, value: curr.low });
    lastALIndex = i;
  }

  if (
    i - lastASIndex >= outlierCooldownBars &&
    prev.high <= prevUpper &&
    curr.high > currUpper
  ) {
    outlierShortPoints.push({ time: curr.time, value: curr.high });
    lastASIndex = i;
  }
}

        const smaTurns = buildSmaTurnMarkers(smaSlow, 5);

        const trendEvents = [
          ...smaTurns.up.map((p) => ({ time: p.time, trend: "up" as const })),
          ...smaTurns.down.map((p) => ({ time: p.time, trend: "down" as const })),
        ].sort((a, b) => a.time - b.time);

        function trendAt(time: number): "up" | "down" | null {
          let trend: "up" | "down" | null = null;

          for (const e of trendEvents) {
            if (e.time > time) break;
            trend = e.trend;
          }

          return trend;
        }

        

       
        
        console.log("SMA TURNS", smaTurns.up.length, smaTurns.down.length);
        const dist = sanitizeLinePoints(calcDistance(smaFast, smaSlow));
        
        const distAsCandles = dist.map((p) => ({
          time: p.time,
          open: p.value,
          high: p.value,
          low: p.value,
          close: p.value,
        }));

        let distMiddle = sanitizeLinePoints(calcSMA(distAsCandles, smaMiddleUI));

// 🔥 Fallback: wenn leer → nimm dist selbst
if (!distMiddle.length) {
  distMiddle = dist;
}
        const distVolatility = sanitizeLinePoints(calcStdDevLine(dist, 50));
        const dynamicBand = buildAdaptiveBandLine(
          distMiddle,
          distVolatility,
          entryBandUI,
          adaptiveBandUI,
          adaptiveBandMultUI
        );
        

        const distIndexByTime = new Map<number, number>();
dist.forEach((p, i) => distIndexByTime.set(p.time, i));

function candleByTime(time: number): Candle | null {
  return candles.find((c) => c.time === time) ?? null;
}

function uniqueByTime(points: MarkerPoint[]): MarkerPoint[] {
  const out: MarkerPoint[] = [];
  const seen = new Set<number>();

  for (const p of points) {
    if (!Number.isFinite(p.time) || seen.has(p.time)) continue;
    seen.add(p.time);
    out.push(p);
  }

  return out.sort((a, b) => a.time - b.time);
}

function buildTrendKinks(side: "long" | "short"): MarkerPoint[] {
  const out: MarkerPoint[] = [];
  if (!dist.length) return out;

  let extreme = dist[0].value;
  let armed = true;

  for (let i = 1; i < dist.length; i++) {
    const d = dist[i].value;

    if (side === "long") {
      if (d < extreme) {
        extreme = d;
        armed = true;
      }

      if (armed && d - extreme >= minKinkUI) {
        const c = candleByTime(dist[i].time);
        if (c) out.push({ time: c.time, value: c.low });
        armed = false;
        extreme = d;
      }
    } else {
      if (d > extreme) {
        extreme = d;
        armed = true;
      }

      if (armed && extreme - d >= minKinkUI) {
        const c = candleByTime(dist[i].time);
        if (c) out.push({ time: c.time, value: c.high });
        armed = false;
        extreme = d;
      }
    }
  }

  return dedupeMarkers(out);
}

function buildRecoveredKinksFromOutliers(
  outliers: MarkerPoint[],
  side: "long" | "short"
): MarkerPoint[] {
  const out: MarkerPoint[] = [];
  const maxSearchBars = 80;

  for (const o of outliers) {
    const startIndex = distIndexByTime.get(o.time);
    if (startIndex == null || startIndex < 0) continue;

    let extreme = dist[startIndex]?.value;
    if (!Number.isFinite(extreme)) continue;

    const end = Math.min(dist.length - 1, startIndex + maxSearchBars);

    for (let i = startIndex + 1; i <= end; i++) {
      const d = dist[i].value;

      if (side === "long") {
        if (d < extreme) extreme = d;

        if (d - extreme >= minKinkUI) {
          const c = candleByTime(dist[i].time);
          if (c) out.push({ time: c.time, value: c.low });
          break;
        }
      } else {
        if (d > extreme) extreme = d;

        if (extreme - d >= minKinkUI) {
          const c = candleByTime(dist[i].time);
          if (c) out.push({ time: c.time, value: c.high });
          break;
        }
      }
    }
  }

  return dedupeMarkers(out);
}

const trendLongKinks = buildTrendKinks("long");
const trendShortKinks = buildTrendKinks("short");

const outlierLongKinks = buildRecoveredKinksFromOutliers(outlierLongPoints, "long");
const outlierShortKinks = buildRecoveredKinksFromOutliers(outlierShortPoints, "short");

const filteredLongEntries = uniqueByTime([
  ...trendLongKinks.filter((p) => trendAt(p.time) === "up"),
  ...outlierLongKinks.filter((p) => trendAt(p.time) !== "up"),
]);

const filteredShortEntries = uniqueByTime([
  ...trendShortKinks.filter((p) => trendAt(p.time) === "down"),
  ...outlierShortKinks.filter((p) => trendAt(p.time) !== "down"),
]);

      

        const atrBox = calcATRValue(candles, renkoAtrLenUI);

        console.log(
  "[ATR CHECK]",
  {
    last20HighLow: candles.slice(-20).map(c => ({
      h: c.high,
      l: c.low,
      c: c.close
    })),
    atrBox
  }
);

        console.log("[RENKO ATR]", {
  symbol,
  interval,
  atrLen: renkoAtrLenUI,
  atrBox,
  atrMult: renkoAtrMultUI,
  renkoBoxMode,
});

const renkoBoxSize =
  renkoBoxMode === "atr" && atrBox != null && atrBox > 0
    ? atrBox * renkoAtrMultUI
    : Number(minKinkUI) > 0
      ? Number(minKinkUI)
      : Number(entryBandUI) > 0
        ? Number(entryBandUI)
        : 100;

setRenkoBoxInfo(
  renkoBoxMode === "atr" && atrBox != null
    ? `ATR(${renkoAtrLenUI}) Box: ${renkoBoxSize.toFixed(4)}`
    : `Fixed Box: ${renkoBoxSize}`
);

const rawRenkoCandles =
  renkoBoxMode === "atr"
    ? buildDynamicAtrRenkoCandles(
        candles,
        renkoAtrLenUI,
        renkoAtrMultUI,
        renkoSourceMode,
        renkoReversalBricksUI
      )
    : buildRenkoCandles(
        candles,
        renkoBoxSize,
        renkoSourceMode,
        renkoReversalBricksUI
      );

const chartRenkoCandles = chartifyCandles(rawRenkoCandles);
        console.log(
  "[UI RENKO]",
  symbol,
  "bricks=",
  chartRenkoCandles.length,
  "last5=",
  chartRenkoCandles
    .slice(-5)
    .map((r) => r.close)
    .join(",")
);

        console.log(
  "[UI CFG]",
  symbol,
  "candles=",
  candles.length,
  "box=",
  renkoBoxSize
);

const visibleCandles =
  chartType === "renko"
    ? buildRenkoCandles(
        candles,
        renkoBoxSize,
        renkoSourceMode,
        renkoReversalBricksUI
      )
    : chartType === "heikin"
      ? buildHeikinAshi(candles)
      : candles;

        if (chartType === "renko") {
  const ts = calcRenkoTrendScore(visibleCandles as Candle[], renkoTrendLookbackUI);
  setRenkoTrendInfo(
    `TrendScore: ${ts.score}/${ts.used} | Changes: ${ts.changes}`
  );
} else {
  setRenkoTrendInfo("-");
}


      
        
        const chartSmaFast = chartifyLinePoints(smaFast);
        const chartSmaSlow = chartifyLinePoints(smaSlow);
        
        const chartSmaUpper = chartifyLinePoints(smaUpper);
        const chartSmaLower = chartifyLinePoints(smaLower);
        
        //const chartDist = chartifyLinePoints(dist);
        //const chartDistMiddle = chartifyLinePoints(distMiddle);

        

      

       


        const real = buildRealTradeMarkers(candles, aggRows);
        //const worker = buildWorkerEventMarkers(workerEvents);
        //const realEvents = await fetchRealEvents(symbol);
        //const realServer = buildRealMarkersFromServer(realEvents);
        
/*
        const alignedDist = alignLineToCandles(chartCandles, chartDist);
        const alignedDistMiddle = alignLineToCandles(chartCandles, chartDistMiddle);
        const dynamicUpperBand = alignLineToCandles(
          chartCandles,
          chartifyLinePoints(buildBandOffsetLine(distMiddle, dynamicBand, 1))
        );
        const dynamicLowerBand = alignLineToCandles(
          chartCandles,
          chartifyLinePoints(buildBandOffsetLine(distMiddle, dynamicBand, -1))
        );
        */

        console.log(
  "[SET DATA]",
  symbol,
  visibleCandles.length
);

        mainSeries.setData(visibleCandles as any);
        
        if (chartType === "renko") {
  smaFastSeries.setData([]);
  smaSlowSeries.setData([]);
       directionLineSeries.setData(dirLine.line as any);


  smaUpperSeries.setData([]);
  smaLowerSeries.setData([]);
} else {
  smaFastSeries.setData(chartSmaFast as any);
  smaSlowSeries.setData(chartSmaSlow as any);
  smaUpperSeries.setData(chartSmaUpper as any);
  smaLowerSeries.setData(chartSmaLower as any);
        
         

}
        directionLineSeries.setData(dirLine.line as any);

        const macdSource =
  chartType === "renko" && chartRenkoCandles.length
    ? buildRenkoCandles(candles, renkoBoxSize, renkoSourceMode, renkoReversalBricksUI)
    : candles;

const macd = calcMACD(macdSource, 1, 18, 5);

macdHistSeries.setData(
  macd.histogram.map((p) => ({
    time: p.time,
    value: p.value,
    color: p.value >= 0 ? "#22c55e" : "#ef4444",
  })) as any
);

macdLineSeries.setData(macd.macd as any);
macdSignalSeries.setData(macd.signal as any);

macdZeroSeries.setData(
  (visibleCandles as Candle[]).map((c: Candle) => ({
    time: c.time,
    value: 0,
  })) as any
);

        const rawMacdKnicks = buildMacdKnickEvents(macd.macd);

const filteredMacdKnicks = rawMacdKnicks.filter(
  (k) => !useKnickStrengthFilter || (k.strength ?? 0) >= minKnickStrengthFilter
);

const rawReplay = buildKnickFlipReplay(visibleCandles as any, rawMacdKnicks);
const filteredReplay = buildKnickFlipReplay(visibleCandles as any, filteredMacdKnicks);

const macdKnicks = filteredMacdKnicks;
const flipReplay = filteredReplay;

setRawReplayText(
  `RAW T:${rawReplay.tradeCount} PF:${formatPF(rawReplay.profitFactor)} Net:${rawReplay.netPnL.toFixed(2)}`
);

setFilteredReplayText(
  `FILTER T:${filteredReplay.tradeCount} PF:${formatPF(filteredReplay.profitFactor)} Net:${filteredReplay.netPnL.toFixed(2)}`
);

const renkoForHaSignals = buildRenkoCandles(
  candles,
  renkoBoxSize,
  renkoSourceMode,
  renkoReversalBricksUI
);

const renkoMacdForHa = calcMACD(renkoForHaSignals, 1, 18, 5);
const renkoKnicksForHa = buildMacdKnickEvents(renkoMacdForHa.macd);
const renkoReplayForHa = buildKnickFlipReplay(renkoForHaSignals as any, renkoKnicksForHa);

const haIndexByTime = new Map<number, number>();
haCandles.forEach((c, i) => haIndexByTime.set(c.time, i));

        /*
function confirmWithNextTwoHa(entry: any, side: "long" | "short") {
  const idx = haCandles.findIndex((c) => c.time >= entry.time);
  if (idx < 0 || idx + 1 >= haCandles.length) return null;

  const h1 = haCandles[idx + 1];

  const ok =
    side === "long"
      ? h1.close > h1.open
      : h1.close < h1.open;

  if (!ok) return null;

  return {
    time: h1.time,
    value: side === "long" ? h1.low : h1.high,
  };
}
*/
if (chartType === "heikin") {
  const haConfirmedRaw = renkoKnicksForHa
    .map((p: any) => {
      const side = p.side === "bull" ? "long" : p.side === "bear" ? "short" : null;
if (!side) return null;

      const confirmed = p;

      return {
        ...confirmed,
        side,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.time - b.time);

  const haFlipConfirmed: any[] = [];
  let lastSide: "long" | "short" | null = null;

  for (const p of haConfirmedRaw as any[]) {
    if (p.side === lastSide) continue;

    haFlipConfirmed.push(p);
    lastSide = p.side;
  }

  const haLongConfirmed = haFlipConfirmed.filter((p) => p.side === "long");
  const haShortConfirmed = haFlipConfirmed.filter((p) => p.side === "short");

  console.log("[RENKO->HA FLIP]", {
    renkoEntries: renkoReplayForHa.entries.length,
    rawConfirmed: haConfirmedRaw.length,
    flipConfirmed: haFlipConfirmed.length,
    haLongConfirmed: haLongConfirmed.length,
    haShortConfirmed: haShortConfirmed.length,
    firstFlip: haFlipConfirmed.slice(-5),
  });

flipLongSeries.setData(lineSignals.longs as any);
flipShortSeries.setData(lineSignals.shorts as any);
  
} else {
  flipLongSeries.setData(
    flipReplay.entries
      .filter((p) => p.side === "long")
      .map((p) => ({ time: p.time, value: p.value })) as any
  );

  flipShortSeries.setData(
    flipReplay.entries
      .filter((p) => p.side === "short")
      .map((p) => ({ time: p.time, value: p.value })) as any
  );
}
      

macdBullKnickSeries.setData(
  macdKnicks
    .filter((k) => k.side === "bull")
    .map((k) => ({
      time: findNextCandleTime(
  haCandles as any,
  (k as any).sourceTime ?? k.time
),
      value: k.value,
    })) as any
);

macdBearKnickSeries.setData(
  macdKnicks
    .filter((k) => k.side === "bear")
    .map((k) => ({
      time: findNextCandleTime(
  haCandles as any,
  (k as any).sourceTime ?? k.time
),
      value: k.value,
    })) as any
);

//renderKnickLines(priceRef.current, priceChart, macdKnicks);
//renderKnickLines(distRef.current, distChart, macdKnicks);

        //const candleTimes = new Set(chartCandles.map((c) => c.time));
/*
const smaTurnMarkers = [
  ...smaTurns.up.map((p) => ({
    time: p.time as any,
    position: "aboveBar" as const,
    color: "#00ff88",
    shape: "arrowUp" as const,
    text: "UT",
  })),
  ...smaTurns.down.map((p) => ({
    time: p.time as any,
    position: "aboveBar" as const,
    color: "#ff4d6d",
    shape: "arrowDown" as const,
    text: "DT",
  })),
]
  .filter((m) => candleTimes.has(m.time))
  .sort((a, b) => Number(a.time) - Number(b.time));
*/
//createSeriesMarkers(smaSlowSeries, smaTurnMarkers as any);

        
        const rawLongCandidates = filteredLongEntries;
        const rawShortCandidates = filteredShortEntries;

const sim = simulateStrategyTESTv4(
  candles,
  dist,
  distMiddle,
  rawLongCandidates,
  rawShortCandidates,
  dynamicBand,
  assumedSpread,
  assumedSlippage,
  smaFast,
  smaUpper,
  smaSlow,
  smaLower
);

const validLongCandidates = sim.acceptedLongEntryPoints;
const validShortCandidates = sim.acceptedShortEntryPoints;

const strategyLongPoints = validLongCandidates;
const strategyShortPoints = validShortCandidates;
/*
const outlierLongProjected = projectMarkerPointsToCandles(
  strategyLongPoints,
  candles,
  "below-far"
);

const outlierShortProjected = projectMarkerPointsToCandles(
  strategyShortPoints,
  candles,
  "above-far"
);

*/
        



        
        console.log(
  "VALID OUTLIER CANDIDATES",
  validLongCandidates.length,
  validShortCandidates.length
);
        
        const longExitProjected = useSlowExitUI
  ? projectMarkerPointsToCandles(sim.longExitPoints, candles, "below-near")
  : [];

const shortExitProjected = useSlowExitUI
  ? projectMarkerPointsToCandles(sim.shortExitPoints, candles, "above-near")
  : [];
        //const blockedLongProjected = projectMarkerPointsToCandles(real.blockedLongPoints, candles, "below-mid");
        //const blockedShortProjected = projectMarkerPointsToCandles(real.blockedShortPoints, candles, "above-mid");
        //const workerLongProjected = projectMarkerPointsToCandles(worker.longPoints, candles, "below-near");
        //const workerShortProjected = projectMarkerPointsToCandles(worker.shortPoints, candles, "above-near");
        //const workerFlatProjected = projectMarkerPointsToCandles(worker.flatPoints, candles, "inside-mid");
        
        

        candidateLongSeries.setData([]);
        candidateShortSeries.setData([]);
        strategyLongSeries.setData([]);
        strategyShortSeries.setData([]);
        strategyLongExitSeries.setData(longExitProjected as any);
        strategyShortExitSeries.setData(shortExitProjected as any);
        outlierLongSeries.setData([]);
        outlierShortSeries.setData([]);
       
       




        blockedLongSeries.setData([]);
        blockedShortSeries.setData([]);
        realBuySeries.setData([]);
        realSellSeries.setData([]);
        realCloseSeries.setData([]);
/*
        createSeriesMarkers(realBuySeries, buildTextMarkers(workerLongProjected, "belowBar"));
        createSeriesMarkers(realSellSeries, buildTextMarkers(workerShortProjected, "aboveBar"));
        createSeriesMarkers(realCloseSeries, buildTextMarkers(workerFlatProjected, "aboveBar"));

       

        createSeriesMarkers(
  strategyLongExitSeries,
  longExitProjected.map((p) => ({
    time: p.time,
    position: "belowBar",
    color: "#ffffff",
    shape: "arrowDown",
    text: "EXL",
  })) as any
);

createSeriesMarkers(
  strategyShortExitSeries,
  shortExitProjected.map((p) => ({
    time: p.time,
    position: "aboveBar",
    color: "#ffffff",
    shape: "arrowUp",
    text: "EXS",
  })) as any
);

        
        createSeriesMarkers(blockedLongSeries, buildTextMarkers(blockedLongProjected, "belowBar"));
        createSeriesMarkers(blockedShortSeries, buildTextMarkers(blockedShortProjected, "aboveBar"));

        createSeriesMarkers(realBuySeries, buildTextMarkers(realServer.buy, "belowBar"));
        createSeriesMarkers(realSellSeries, buildTextMarkers(realServer.sell, "aboveBar"));
        createSeriesMarkers(realCloseSeries, buildTextMarkers(realServer.close, "aboveBar"));
*/
        
/*
        createSeriesMarkers(
  outlierLongSeries,
  buildTextMarkers(
    outlierLongProjected.map((p) => ({ ...p, text: "AL", color: "#00ffff" })),
    "belowBar"
  )
);

createSeriesMarkers(
  outlierShortSeries,
  buildTextMarkers(
    outlierShortProjected.map((p) => ({ ...p, text: "AS", color: "#ff00ff" })),
    "aboveBar"
  )
);
       

        createSeriesMarkers(
  smaSlowSeries,
  [
    ...smaTurns.up.map((p) => ({
      time: p.time as any,
      position: "inBar" as const,
      color: "#00ff88",
      shape: "arrowUp" as const,
      text: "UT",
    })),
    ...smaTurns.down.map((p) => ({
      time: p.time as any,
      position: "aboveBar" as const,
      color: "#ff4d6d",
      shape: "arrowDown" as const,
      text: "DT",
    })),
  ].filter((m) => chartCandles.find(c => c.time === m.time)) as any
);


        distSeries.setData(alignedDist as any);
        distMiddleSeries.setData(alignedDistMiddle as any);
        const zeroLine = chartCandles.map(c => ({
  time: c.time,
  value: 0,
}));

zeroSeries.setData(zeroLine as any);
        upperBandSeries.setData(dynamicUpperBand as any);
        lowerBandSeries.setData(dynamicLowerBand as any);
*/
        

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

       setTradeCount(flipReplay.tradeCount);
setWinCount(flipReplay.winCount);
setLossCount(flipReplay.lossCount);

setGrossProfit(flipReplay.grossProfit);
setGrossLoss(flipReplay.grossLoss);
setNetPnL(flipReplay.netPnL);

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

setProfitFactor(flipReplay.profitFactor);

        setLastSignalText(sim.lastSignalText);

        setBlockedLongCount(real.blockedLongPoints.length);
        setBlockedShortCount(real.blockedShortPoints.length);
        setRealBuyCount(real.realBuyPoints.length);
        setRealSellCount(real.realSellPoints.length);
        setRealCloseCount(real.realClosePoints.length);
        setLastRealTradeText(real.lastRealTradeText);
        setBrokerState(liveBrokerState ?? real.brokerState);

try {
  console.log("[HA MACD 1M] start", symbol);

  const candles1m = await fetchCandles(symbol, "1m");

  console.log("[HA MACD 1M] candles", candles1m.length);

  const dots = buildHaMacd1mDots(candles1m);

  console.log("[HA MACD 1M] dots", dots);

  setMacd1mDots(dots);
} catch (e) {
  console.warn("[HA MACD 1M] failed", e);
  setMacd1mDots([]);
}

console.log("[LOAD DONE]", symbol);
        
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

        priceChart.removeSeries(smaUpperSeries);
        priceChart.removeSeries(smaLowerSeries);
        priceChart.removeSeries(mainSeries);
        priceChart.removeSeries(smaFastSeries);
        priceChart.removeSeries(smaSlowSeries);
        priceChart.removeSeries(directionLineSeries);
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
        priceChart.removeSeries(outlierLongSeries);
        priceChart.removeSeries(outlierShortSeries);
        priceChart.removeSeries(flipLongSeries);
        priceChart.removeSeries(flipShortSeries);
        distChart.removeSeries(macdHistSeries);
distChart.removeSeries(macdLineSeries);
distChart.removeSeries(macdSignalSeries);
distChart.removeSeries(macdZeroSeries);
    distChart.removeSeries(macdBullKnickSeries);
distChart.removeSeries(macdBearKnickSeries);

//clearKnickLines(priceRef.current);
//clearKnickLines(distRef.current);
        
/*
        distChart.removeSeries(distSeries);
        distChart.removeSeries(distMiddleSeries);
        distChart.removeSeries(zeroSeries);
        distChart.removeSeries(upperBandSeries);
        distChart.removeSeries(lowerBandSeries);
        */
      } catch {}
    };
    }, [
  symbol,
  interval,
  chartType,
  entryBandUI,
  peakUI,
  minKinkUI,
  kinkConfirmBarsUI,  
  smaFastUI,
  smaSlowUI,
  smaOffsetUI,
  smaMiddleUI,
  assumedSpread,
  assumedSlippage,
  adaptiveBandUI,
  useSlowExitUI,  
  adaptiveBandMultUI,
  symbolSizes,
  useKnickStrengthFilter,
  minKnickStrengthFilter,
  renkoBoxMode,
  renkoAtrLenUI,
  renkoAtrMultUI,
    renkoSourceMode,
    renkoTrendLookbackUI,
    renkoReversalBricksUI,
    directionThresholdPctUI,
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
    setChartType((prev) =>
  prev === "candles" ? "renko" : prev === "renko" ? "heikin" : "candles"
)
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
  {chartType === "candles" ? "Kerzen" : chartType === "renko" ? "Renko" : "Heikin"}
</button>

      <button
  onClick={() => setScannerOpen((v) => !v)}
  style={{
    position: "absolute",
    top: 50,
    right: 10,
    zIndex: 50,
    padding: "6px 10px",
    background: scannerOpen ? "#14532d" : "#111",
    color: "#fff",
    border: "1px solid #555",
    borderRadius: 6,
    cursor: "pointer",
  }}
>
  {scannerOpen ? "Scanner ▲" : "Scanner ▼"}
</button>

{scannerOpen && (
  <div
    style={{
      position: "absolute",
      top: 90,
      right: 10,
      zIndex: 45,
      width: 620,
      maxHeight: "82vh",
      overflowY: "auto",
      background: "rgba(2, 6, 23, 0.94)",
      border: "1px solid #334155",
      borderRadius: 10,
      padding: 10,
      fontFamily: "Arial, sans-serif",
      fontSize: 12,
      color: "#e2e8f0",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>
        Strategy Scanner / Backtest Ranking
      </div>

      <button
        onClick={runBacktestScanner}
        disabled={scannerLoading}
        style={{
          background: "#1d4ed8",
          color: "#fff",
          border: "1px solid #3b82f6",
          borderRadius: 6,
          padding: "5px 8px",
          cursor: scannerLoading ? "default" : "pointer",
          opacity: scannerLoading ? 0.7 : 1,
        }}
      >
        {scannerLoading ? "läuft..." : "Scan"}
      </button>
    </div>

    {scannerMessage ? (
      <div style={{ color: "#93c5fd", marginBottom: 8 }}>{scannerMessage}</div>
    ) : null}

    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ color: "#94a3b8", borderBottom: "1px solid #334155" }}>
          <th style={{ textAlign: "left", padding: "4px" }}>Symbol</th>
          <th style={{ textAlign: "left", padding: "4px" }}>TF</th>
          <th style={{ textAlign: "right", padding: "4px" }}>Trades</th>
          <th style={{ textAlign: "right", padding: "4px" }}>PF</th>
          <th style={{ textAlign: "right", padding: "4px" }}>Net</th>
          <th style={{ textAlign: "right", padding: "4px" }}>W/L</th>
          <th style={{ textAlign: "left", padding: "4px" }}>Status</th>
        </tr>
      </thead>

      <tbody>
        {scannerRows.map((r) => (
          <tr key={r.symbol} style={{ borderBottom: "1px solid rgba(51,65,85,0.55)" }}>
            <td style={{ padding: "4px", fontWeight: 700 }}>{r.symbol}</td>
            <td style={{ padding: "4px" }}>{r.interval}</td>
            <td style={{ padding: "4px", textAlign: "right" }}>{r.trades}</td>
            <td
              style={{
                padding: "4px",
                textAlign: "right",
                color:
                  r.pf === null
                    ? "#94a3b8"
                    : r.pf >= 2
                      ? "#22c55e"
                      : r.pf >= 1
                        ? "#facc15"
                        : "#ef4444",
                fontWeight: 700,
              }}
            >
              {r.pf === null
                ? "-"
                : Number.isFinite(r.pf)
                  ? r.pf.toFixed(2)
                  : "∞"}
            </td>
            <td
              style={{
                padding: "4px",
                textAlign: "right",
                color: r.netPnL >= 0 ? "#22c55e" : "#ef4444",
              }}
            >
              {r.netPnL.toFixed(2)}
            </td>
            <td style={{ padding: "4px", textAlign: "right" }}>
              {r.wins}/{r.losses}
            </td>
            <td style={{ padding: "4px", color: r.error ? "#fca5a5" : "#94a3b8" }}>
              {r.error ?? "ok"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
      
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
    <div style={{ marginTop: 8, borderTop: "1px solid #334155", paddingTop: 8 }}>
  <div style={{ fontWeight: 700, marginBottom: 6 }}>Renko Box</div>
      <div style={{ fontSize: 12, color: "#facc15", marginBottom: 6 }}>
  Aktives Reversal: {renkoReversalBricksUI}
</div>

  <select
    value={renkoBoxMode}
    onChange={(e) => setRenkoBoxMode(e.target.value as "fixed" | "atr")}
    style={{ width: "100%", marginBottom: 6 }}
  >
    <option value="fixed">Fixed / alte Box</option>
    <option value="atr">ATR</option>
  </select>

      <select
  value={renkoSourceMode}
  onChange={(e) => setRenkoSourceMode(e.target.value as "close" | "hl")}
  style={{ width: "100%", marginBottom: 6 }}
>
  <option value="close">Renko Source: Close</option>
  <option value="hl">Renko Source: High/Low</option>
</select>

      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
  Reversal Bricks: {renkoReversalBricksUI}
</div>

<input
  type="range"
  min={1}
  max={4}
  step={1}
  value={Number(
  symbolConfigMap[symbol]?.renkoReversalBricks ??
  (symbolConfigMap[symbol] as any)?.renko_reversal_bricks ??
  renkoReversalBricksUI ??
  2
)}
onChange={(e) => {
  const v = Number(e.target.value);

  setRenkoReversalBricksUI(v);

  setSymbolConfigMap((prev) => ({
    ...prev,
    [symbol]: {
      ...(prev[symbol] ?? {}),
      symbol,
      renkoReversalBricks: v,
      renko_reversal_bricks: v,
    } as any,
  }));
}}
  style={{ width: "100%" }}
/>

  <div style={{ fontSize: 12, color: "#94a3b8" }}>
    ATR Length: {renkoAtrLenUI}
  </div>
  <input
    type="range"
    min={2}
    max={50}
    step={1}
    value={renkoAtrLenUI}
    onChange={(e) => setRenkoAtrLenUI(Number(e.target.value))}
    style={{ width: "100%" }}
  />

  <div style={{ fontSize: 12, color: "#94a3b8" }}>
    ATR Mult: {renkoAtrMultUI.toFixed(2)}
  </div>
  <input
    type="range"
    min={0.1}
    max={3}
    step={0.05}
    value={renkoAtrMultUI}
    onChange={(e) => setRenkoAtrMultUI(Number(e.target.value))}
    style={{ width: "100%" }}
  />

  <div style={{ marginTop: 4, fontSize: 12, color: "#93c5fd" }}>
    {renkoBoxInfo}
  </div>

      <div style={{ marginTop: 4, fontSize: 12, color: "#facc15" }}>
  {renkoTrendInfo}
</div>

<div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
  Trend Lookback: {renkoTrendLookbackUI}
</div>

<input
  type="range"
  min={5}
  max={80}
  step={1}
  value={renkoTrendLookbackUI}
  onChange={(e) => setRenkoTrendLookbackUI(Number(e.target.value))}
  style={{ width: "100%" }}
/>
</div>

    <div style={{ marginTop: 8, borderTop: "1px solid #334155", paddingTop: 8 }}>
  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
    <input
      type="checkbox"
      checked={useKnickStrengthFilter}
      onChange={(e) => setUseKnickStrengthFilter(e.target.checked)}
    />
    Knickstärke Filter aktiv
  </label>

  <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
    Min Strength: {minKnickStrengthFilter}
  </div>

  <input
    type="range"
    min={0}
    max={100}
    step={0.1}
    value={minKnickStrengthFilter}
    onChange={(e) => setMinKnickStrengthFilter(Number(e.target.value))}
    style={{ width: "100%" }}
  />

      <div style={{ marginTop: 8, fontSize: 12, color: "#facc15" }}>
  Direction Threshold: {directionThresholdPctUI.toFixed(2)}
</div>

<input
  type="range"
  min={0.05}
  max={0.50}
  step={0.01}
  value={directionThresholdPctUI}
  onChange={(e) => setDirectionThresholdPctUI(Number(e.target.value))}
  style={{ width: "100%" }}
/>

  <div style={{ marginTop: 6, fontSize: 12, color: "#e2e8f0" }}>
    {rawReplayText}
  </div>
  <div style={{ marginTop: 2, fontSize: 12, color: "#93c5fd" }}>
    {filteredReplayText}
  </div>
</div>

    <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
  <input
    type="checkbox"
    checked={useSlowExitUI}
    onChange={(e) => setUseSlowExitUI(e.target.checked)}
  />
  EXL/EXS Exit aktiv
</label>

    <div style={{ marginTop: 10, borderTop: "1px solid #334155", paddingTop: 8 }}>
  <div style={{ fontWeight: 700, marginBottom: 6 }}>🛡 Max Loss Schutz</div>

  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
    Globale Absicherung pro offener Position. Beispiel: 30 = bei -30 € sofort FLAT.
  </div>

  <div style={{ display: "flex", gap: 6 }}>
    <input
      type="number"
      step="1"
      min="0"
      value={maxPositionLossEur}
      onChange={(e) => setMaxPositionLossEur(e.target.value)}
      placeholder="z.B. 30"
      style={{
        flex: 1,
        background: "#0f172a",
        color: "#fff",
        border: "1px solid #475569",
        borderRadius: 6,
        padding: "6px 8px",
      }}
    />

    <button
      onClick={saveMaxPositionLoss}
      style={{
        background: "#1d4ed8",
        color: "#fff",
        border: "1px solid #3b82f6",
        borderRadius: 6,
        padding: "6px 8px",
        cursor: "pointer",
      }}
    >
      Save
    </button>
  </div>

      

  <div style={{ marginTop: 4, fontSize: 12, color: "#93c5fd" }}>
    {maxPositionLossEur ? `Aktiv bei -${maxPositionLossEur} €` : "Deaktiviert"}
  </div>

  {maxLossMessage ? (
    <div style={{ marginTop: 4, fontSize: 12, color: "#93c5fd" }}>
      {maxLossMessage}
    </div>
  ) : null}
</div>

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
      gridTemplateColumns: "1.2fr 1fr auto auto",
      gap: 6,
      alignItems: "center",
      fontSize: 12,
    }}
  >
    <div style={{ color: "#94a3b8" }}>Symbol</div>
<div style={{ color: "#94a3b8" }}>Size</div>
<div></div>
<div style={{ color: "#94a3b8" }}>Auto</div>

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

        <button
  onClick={() => toggleAutoEnabled(s)}
  style={{
    background:
      Number(symbolConfigMap[s]?.auto_enabled ?? 1) === 1
        ? "#14532d"
        : "#7f1d1d",
    color: "#fff",
    border: "1px solid #475569",
    borderRadius: 6,
    padding: "4px 8px",
    cursor: "pointer",
  }}
>
  {Number(symbolConfigMap[s]?.auto_enabled ?? 1) === 1
    ? "AUTO ON"
    : "AUTO OFF"}
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
          <div style={{ marginTop: 8 }}>
  <div style={{ color: "#ccc", fontSize: 12 }}>
    Kink Confirm Bars: {kinkConfirmBarsUI}
  </div>

  <input
    type="range"
    min="1"
    max="10"
    step="1"
    value={kinkConfirmBarsUI}
    onChange={(e) => setKinkConfirmBarsUI(Number(e.target.value))}
    style={{ width: "100%" }}
  />
</div>

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

          <div style={{ marginTop: 8 }}>
  <div style={{ color: "#ccc", fontSize: 12 }}>
    SMA Offset: {smaOffsetUI}
  </div>

  <input
    type="range"
    min="0.01"
    max={SMA_OFFSET_MAX_BY_SYMBOL[symbol] ?? 1000}
    step="0.01"
    value={smaOffsetUI}
    onChange={(e) => setSmaOffsetUI(Number(e.target.value))}
    style={{ width: "100%" }}
  />
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
  style={{
    position: "absolute",
    right: 20,
    bottom: "29%",
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "rgba(0,0,0,0.55)",
    padding: "4px 8px",
    borderRadius: 6,
    color: "#fff",
    fontSize: 12,
    pointerEvents: "none",
  }}
>
 <span>1m</span>

        <div
  style={{
    display: "flex",
    flexDirection: "column",
    gap: 3,
    marginBottom: 6,
  }}
>
  {["1m", "5m", "15m", "30m", "1h"].map((tf) => (
    <div
      key={tf}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
      }}
    >
      <span
        style={{
          width: 26,
          fontSize: 11,
          opacity: 0.9,
        }}
      >
        HA {tf}
      </span>

      {(haTfMatrix[tf] || []).map((b, i) => (
        <span
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            display: "inline-block",
            background:
              b === "blue"
                ? "#3b82f6"
                : "#ef4444",
          }}
        />
      ))}
    </div>
  ))}
</div>

{macd1mDots.map((d, i) => (
  <span key={i}>
    {d === "green" ? "🟢" : "🔴"}
  </span>
))}

 
</div>
      
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

  const candles = sanitizeCandles(json.candles || []);

  // 🔥 UI-Live-Patch wie im Worker:
  // letzte Kerze wird mit aktuellem Brokerpreis aktualisiert,
  // damit UI-Marker und Worker-Event synchroner werden.
  try {
    const livePrice = await fetchLiveMidPrice(symbol);
    return patchLastCandleWithLivePrice(candles, livePrice);
  } catch (e) {
    console.warn("live price patch skipped:", e);
    return candles;
  }
}

async function fetchLiveMidPrice(symbol: string): Promise<number> {
  const url = new URL("/cap/market", BACKEND_BASE);
  url.searchParams.set("epic", symbol);
  url.searchParams.set("_ts", String(Date.now()));

  const res = await fetch(url.toString(), { cache: "no-store" });
  const txt = await res.text();

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`LIVE PRICE non-JSON response: ${txt}`);
  }

  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `LIVE PRICE ERROR ${res.status}: ${txt}`);
  }

  const m = json.market || {};
  const bid = Number(m.bid ?? m.snapshot?.bid ?? m.snapshot?.price?.bid);
  const ask = Number(m.offer ?? m.ask ?? m.snapshot?.offer ?? m.snapshot?.ask ?? m.snapshot?.price?.ask);

  if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2;
  if (Number.isFinite(bid)) return bid;
  if (Number.isFinite(ask)) return ask;

  throw new Error(`no live price for ${symbol}`);
}

function patchLastCandleWithLivePrice(candles: Candle[], price: number): Candle[] {
  if (!Array.isArray(candles) || !candles.length) return candles;
  if (!Number.isFinite(price) || price <= 0) return candles;

  const out = candles.slice();
  const last = { ...out[out.length - 1] };

  last.close = price;
  last.high = Math.max(Number(last.high), price);
  last.low = Math.min(Number(last.low), price);

  out[out.length - 1] = last;
  return out;
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

function buildSmaTurnMarkers(
  smaSlow: LinePoint[],
  confirmBars = 5
): { up: MarkerPoint[]; down: MarkerPoint[] } {
  const up: MarkerPoint[] = [];
  const down: MarkerPoint[] = [];

  let trend: "up" | "down" | null = null;

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
/*
function buildWorkerEventMarkers(events: UiStrategyEvent[]) {
  const longPoints: MarkerPoint[] = [];
  const shortPoints: MarkerPoint[] = [];
  const flatPoints: MarkerPoint[] = [];

  for (const e of events) {
    if (!e.time) continue;

    const point = {
      time: Number(e.time),
      value: Number(e.price) > 0 ? Number(e.price) : 1,
    };

    if (e.side === "long") {
      longPoints.push({ ...point, text: "WL", color: "#00ff88" });
    } else if (e.side === "short") {
      shortPoints.push({ ...point, text: "WS", color: "#ff4d6d" });
    } else if (e.side === "flat") {
      flatPoints.push({ ...point, text: "WF", color: "#c084fc" });
    }
  }

  return {
    longPoints,
    shortPoints,
    flatPoints,
  };
}
*/

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

function sanitizeLinePoints(points: any[]): LinePoint[] {
  return (points || [])
    .filter((p) => p && p.time != null && p.value != null)
    .map((p) => ({
      time: Number(p.time),
      value: Number(p.value),
    }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value));
}

function calcATRSeries(candles: Candle[], len = 14): (number | null)[] {
  const out: (number | null)[] = Array(candles.length).fill(null);
  if (!Array.isArray(candles) || candles.length < len + 1) return out;

  const trs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];

    trs.push(
      Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      )
    );
  }

  let atr = 0;
  for (let i = 0; i < len; i++) atr += trs[i];
  atr /= len;

  out[len] = atr;

  for (let i = len + 1; i < candles.length; i++) {
    atr = (atr * (len - 1) + trs[i - 1]) / len;
    out[i] = atr;
  }

  return out;
}

function buildDynamicAtrRenkoCandles(
  candles: Candle[],
  atrLen = 14,
  atrMult = 1,
  sourceMode: "close" | "hl" = "close",
  reversalBricks = 2
): Candle[] {
  if (!Array.isArray(candles) || candles.length < atrLen + 1) return [];

  const atrSeries = calcATRSeries(candles, atrLen);
  const out: Candle[] = [];

 let lastClose = Number.NaN;
  let lastDir = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const atr = atrSeries[i];

    if (atr == null || !Number.isFinite(atr) || atr <= 0) continue;

    const boxSize = atr * atrMult;
    if (!Number.isFinite(boxSize) || boxSize <= 0) continue;

   if (!Number.isFinite(lastClose)) {
  lastClose = Math.round(Number(c.close) / boxSize) * boxSize;
}

    const upPrice = sourceMode === "hl" ? Number(c.high) : Number(c.close);
    const downPrice = sourceMode === "hl" ? Number(c.low) : Number(c.close);

    while (
      upPrice - lastClose >=
      (lastDir === -1 ? boxSize * reversalBricks : boxSize)
    ) {
      const open = lastClose;
      const close = lastClose + boxSize;

      out.push({
  time: Number(c.time),
  sourceTime: Number(c.time),
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
} as any);

      lastClose = close;
      lastDir = 1;
    }

    while (
      lastClose - downPrice >=
      (lastDir === 1 ? boxSize * reversalBricks : boxSize)
    ) {
      const open = lastClose;
      const close = lastClose - boxSize;

      out.push({
  time: Number(c.time),
  sourceTime: Number(c.time),
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
} as any);

      lastClose = close;
      lastDir = -1;
    }
  }

  console.log("[DYNAMIC ATR RENKO]", {
    bricks: out.length,
    first: out[0],
    last: out[out.length - 1],
  });

  return out;
}

function buildRenkoCandles(
 
  candles: Candle[],
  boxSize: number,
  sourceMode: "close" | "hl" = "close",
  reversalBricks = 2
): Candle[] {

  if (!Array.isArray(candles) || !candles.length) return [];
  if (!Number.isFinite(boxSize) || boxSize <= 0) return [];

  const out: Candle[] = [];
  let lastClose =
  Math.round(Number(candles[0].close) / boxSize) * boxSize;

  let lastDir = 0;

  for (const c of candles) {
    const upPrice = sourceMode === "hl" ? Number(c.high) : Number(c.close);
    const downPrice = sourceMode === "hl" ? Number(c.low) : Number(c.close);

    while (upPrice - lastClose >= (lastDir === -1 ? boxSize * reversalBricks : boxSize)) {
      const open = lastClose;
      const close = lastClose + boxSize;

      out.push({
        time: Number(c.time),
        open,
        high: Math.max(open, close),
        low: Math.min(open, close),
        close,
      });

      lastClose = close;
      lastDir = 1;
    }

    while (lastClose - downPrice >= (lastDir === 1 ? boxSize * reversalBricks : boxSize)) {
      const open = lastClose;
      const close = lastClose - boxSize;

      out.push({
        time: Number(c.time),
        open,
        high: Math.max(open, close),
        low: Math.min(open, close),
        close,
      });

      lastClose = close;
      lastDir = -1;
    }
  }

 

  return out;
}



function calcATRValue(candles: Candle[], len = 14): number | null {
  if (!Array.isArray(candles) || candles.length < len + 1) return null;

  const trs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];

    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );

    trs.push(tr);
  }

  if (trs.length < len) return null;

  let atr = 0;
  for (let i = 0; i < len; i++) atr += trs[i];
  atr = atr / len;

  // Wilder/RMA-ATR
  for (let i = len; i < trs.length; i++) {
    atr = (atr * (len - 1) + trs[i]) / len;
  }

  return atr;
}

function calcEMA(values: LinePoint[], length: number): LinePoint[] {
  if (!values.length || length <= 0) return [];

  const out: LinePoint[] = [];
  const k = 2 / (length + 1);

  let ema = values[0].value;

  for (const p of values) {
    ema = p.value * k + ema * (1 - k);
    out.push({ time: p.time, value: ema });
  }

  return out;
}

function calcMACD(
  candles: Candle[],
  fastLength = 12,
  slowLength = 26,
  signalLength = 9
): {
  macd: LinePoint[];
  signal: LinePoint[];
  histogram: LinePoint[];
} {
  const closeLine: LinePoint[] = candles.map((c) => ({
    time: c.time,
    value: c.close,
  }));

  const fastEma = calcEMA(closeLine, fastLength);
  const slowEma = calcEMA(closeLine, slowLength);

  const slowMap = new Map(slowEma.map((p) => [p.time, p.value]));

  const macdLine: LinePoint[] = fastEma
    .map((p) => {
      const slow = slowMap.get(p.time);
      if (slow == null) return null;
      return { time: p.time, value: p.value - slow };
    })
    .filter(Boolean) as LinePoint[];

  const signalLine = calcEMA(macdLine, signalLength);
  const signalMap = new Map(signalLine.map((p) => [p.time, p.value]));

  const histogram: LinePoint[] = macdLine
    .map((p) => {
      const signal = signalMap.get(p.time);
      if (signal == null) return null;
      return { time: p.time, value: p.value - signal };
    })
    .filter(Boolean) as LinePoint[];

  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
  };
}

function calcRenkoTrendScore(renko: Candle[], lookback = 20) {
  if (!Array.isArray(renko) || renko.length < 2) {
    return { score: 0, changes: 0, used: 0 };
  }

  const used = Math.min(lookback, renko.length - 1);
  const start = Math.max(1, renko.length - used);

  let changes = 0;

  for (let i = start; i < renko.length; i++) {
    const prevDir = renko[i - 1].close >= renko[i - 1].open ? 1 : -1;
    const curDir = renko[i].close >= renko[i].open ? 1 : -1;

    if (prevDir !== curDir) changes++;
  }

  return {
    score: used - changes,
    changes,
    used,
  };
}

function buildMacdKnickEvents(line: LinePoint[]): MacdKnickEvent[] {
  const out: MacdKnickEvent[] = [];

  for (let i = 1; i < line.length - 1; i++) {
    const prev = line[i - 1];
    const cur = line[i];
    const next = line[i + 1];

    const slopeIn = cur.value - prev.value;
    const slopeOut = next.value - cur.value;
    const strength = Math.abs(slopeOut - slopeIn);

    if (cur.value < prev.value && cur.value < next.value) {
      out.push({
        time: (prev as any).sourceTime ?? prev.time,
        value: prev.value,
        side: "bull",
        strength,
      });
    }

    if (cur.value > prev.value && cur.value > next.value) {
      out.push({
        time: (prev as any).sourceTime ?? prev.time,
        value: prev.value,
        side: "bear",
        strength,
      });
    }
  }

  return out;
}

function formatPF(v: number | null): string {
  if (v == null) return "-";
  if (!Number.isFinite(v)) return "∞";
  return v.toFixed(2);
}

function buildKnickFlipReplay(
  candles: Candle[],
  events: MacdKnickEvent[]
) {
  let side: "flat" | "long" | "short" = "flat";
  let entryPrice = 0;

  const entries: Array<{ time: number; value: number; side: "long" | "short" }> = [];
  const profits: number[] = [];

  const candleMap = new Map<number, Candle>();
  candles.forEach((c) => candleMap.set(Number(c.time), c));

  for (const e of events.sort((a, b) => a.time - b.time)) {
    const c = candleMap.get(Number(e.time));
    if (!c) continue;

    const nextSide = e.side === "bull" ? "long" : "short";
    const price = c.close;

    if (side === "flat") {
      side = nextSide;
      entryPrice = price;
      entries.push({ time: c.time, value: price, side: nextSide });
      continue;
    }

    if (side === nextSide) {
      continue;
    }

    const pnl =
      side === "long"
        ? price - entryPrice
        : entryPrice - price;

    profits.push(pnl);

    side = nextSide;
    entryPrice = price;
    entries.push({ time: c.time, value: price, side: nextSide });
  }

  const grossProfit = profits.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLossAbs = Math.abs(profits.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  const netPnL = grossProfit - grossLossAbs;

  return {
    entries,
    tradeCount: profits.length,
    winCount: profits.filter((p) => p > 0).length,
    lossCount: profits.filter((p) => p < 0).length,
    grossProfit,
    grossLoss: grossLossAbs,
    netPnL,
    profitFactor:
      grossLossAbs > 0
        ? grossProfit / grossLossAbs
        : grossProfit > 0
          ? Number.POSITIVE_INFINITY
          : null,
  };
}

/*
function clearKnickLines(container: HTMLDivElement | null) {
  if (!container) return;
  container.querySelectorAll(".macd-knick-line").forEach((el) => el.remove());
}

function renderKnickLines(
  container: HTMLDivElement | null,
  chart: IChartApi,
  events: MacdKnickEvent[]
) {
  if (!container) return;

  clearKnickLines(container);

  container.style.position = "relative";

  for (const e of events) {
    const x = chart.timeScale().timeToCoordinate(e.time as any);
    if (x == null) continue;

    const line = document.createElement("div");
    line.className = "macd-knick-line";

    line.style.position = "absolute";
    line.style.left = `${x}px`;
    line.style.top = "0";
    line.style.bottom = "0";
    line.style.width = "0";
    line.style.pointerEvents = "none";
    line.style.zIndex = "10";
    line.style.borderLeft =
      e.side === "bull"
        ? "1px dashed rgba(34, 197, 94, 0.85)"
        : "1px dashed rgba(239, 68, 68, 0.85)";

    container.appendChild(line);
  }
}
*/
function calcSMA(data: Candle[], len: number): LinePoint[] {
  const out: LinePoint[] = [];
  if (len <= 0) return out;
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
/*
function alignLineToCandles(candles: Candle[], line: LinePoint[]): WhitespaceLinePoint[] {
  const map = new Map<number, number>();
  for (const p of line) map.set(p.time, p.value);

  return candles.map((c) => {
    const value = map.get(c.time);
    if (value == null || !Number.isFinite(value)) return { time: c.time };
    return { time: c.time, value };
  });
}
*/

function calcStdDevLine(data: LinePoint[], len: number): LinePoint[] {
  const out: LinePoint[] = [];
  if (len <= 1) return out;

  for (let i = len - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < len; j++) sum += data[i - j].value;
    const mean = sum / len;

    let variance = 0;
    for (let j = 0; j < len; j++) {
      const diff = data[i - j].value - mean;
      variance += diff * diff;
    }

    out.push({
      time: data[i].time,
      value: Math.sqrt(variance / len),
    });
  }

  return out;
}

function buildAdaptiveBandLine(
  middle: LinePoint[],
  volatility: LinePoint[],
  baseBand: number,
  adaptiveEnabled: boolean,
  adaptiveMultiplier: number
): LinePoint[] {
  const volMap = new Map<number, number>();
  for (const p of volatility) volMap.set(p.time, p.value);

  return middle.map((p) => {
    const vol = volMap.get(p.time) ?? 0;
    const band = adaptiveEnabled
      ? Math.max(baseBand * 0.35, baseBand + vol * adaptiveMultiplier)
      : baseBand;

    return {
      time: p.time,
      value: band,
    };
  });
}
/*
function buildRealMarkersFromServer(events: any[]) {
  const buy: any[] = [];
  const sell: any[] = [];
  const close: any[] = [];

  for (const e of events) {
    if (e.action === "buy") {
      buy.push({
        time: e.time,
        value: e.price,
        text: "RL",
        color: "#00ff88",
      });
    }

    if (e.action === "sell") {
      sell.push({
        time: e.time,
        value: e.price,
        text: "RS",
        color: "#ff4d6d",
      });
    }

    if (e.action === "close") {
      const pnl = Number(e.pnl || 0);
      const sign = pnl >= 0 ? "+" : "";

      close.push({
        time: e.time,
        value: e.price,
        text: `RC ${sign}${pnl.toFixed(0)}€`,
        color: "#c084fc",
      });
    }
  }

  return { buy, sell, close };
}



function buildBandOffsetLine(
  base: LinePoint[],
  band: LinePoint[],
  direction: 1 | -1
): LinePoint[] {
  const bandMap = new Map<number, number>();
  for (const p of band) bandMap.set(p.time, p.value);

  return base.map((p) => ({
    time: p.time,
    value: p.value + (bandMap.get(p.time) ?? 0) * direction,
  }));
}

*/



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
/*
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
*/

function simulateStrategyTESTv4(
  candles: Candle[],
  dist: LinePoint[],
  _distMiddle: LinePoint[],
  longEntries: MarkerPoint[],
  shortEntries: MarkerPoint[],
  _bandLine: LinePoint[],
  assumedSpread: number,
  assumedSlippage: number,
  smaFast: LinePoint[],
  smaUpper: LinePoint[],
  smaSlow: LinePoint[],
  smaLower: LinePoint[]
) {
  const candleMap = new Map<number, Candle>();
  for (const c of candles) candleMap.set(c.time, c);

  const distMapIndex = new Map<number, number>();
  dist.forEach((p, i) => distMapIndex.set(p.time, i));

  const smaFastMap = new Map<number, number>();
  for (const p of smaFast) smaFastMap.set(p.time, p.value);

  const smaUpperMap = new Map<number, number>();
  for (const p of smaUpper) smaUpperMap.set(p.time, p.value);

  const smaSlowMap = new Map<number, number>();
  for (const p of smaSlow) smaSlowMap.set(p.time, p.value);

  const smaLowerMap = new Map<number, number>();
  for (const p of smaLower) smaLowerMap.set(p.time, p.value);

  const longExitPoints: MarkerPoint[] = [];
  const shortExitPoints: MarkerPoint[] = [];
  const acceptedLongEntryPoints: MarkerPoint[] = [];
  const acceptedShortEntryPoints: MarkerPoint[] = [];

  const entryEvents = [
    ...longEntries.map((p) => ({
      time: p.time,
      value: p.value,
      side: "long" as const,
      index: distMapIndex.get(p.time) ?? -1,
    })),
    ...shortEntries.map((p) => ({
      time: p.time,
      value: p.value,
      side: "short" as const,
      index: distMapIndex.get(p.time) ?? -1,
    })),
  ]
    .filter((x) => x.index >= 0)
    .sort((a, b) => a.index - b.index);

  let position: PositionSide = "flat";
  let openTrade: { side: "long" | "short"; entryPrice: number; entryIndex: number } | null = null;

  let tradeCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  let currentEntryPtr = 0;

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
        entryIndex: i,
      };
      position = "long";

      acceptedLongEntryPoints.push({
        time: evt.time,
        value: evt.value,
      });
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
        entryIndex: i,
      };
      position = "short";

      acceptedShortEntryPoints.push({
        time: evt.time,
        value: evt.value,
      });
    }
  }

  currentEntryPtr += 1;
}

    if (!openTrade || i <= openTrade.entryIndex || i <= 0) continue;

    const prevTime = dist[i - 1]?.time;
    if (!prevTime) continue;

    const prevFast = smaFastMap.get(prevTime) ?? null;
    const currFast = smaFastMap.get(p.time) ?? null;

    if (
      prevFast === null ||
      currFast === null ||
      !Number.isFinite(prevFast) ||
      !Number.isFinite(currFast)
    ) {
      continue;
    }

    
    const prevUpper = smaUpperMap.get(prevTime) ?? null;
const currUpper = smaUpperMap.get(p.time) ?? null;

const prevSlow = smaSlowMap.get(prevTime) ?? null;
const currSlow = smaSlowMap.get(p.time) ?? null;

const prevLower = smaLowerMap.get(prevTime) ?? null;
const currLower = smaLowerMap.get(p.time) ?? null;

   const longExitBySmaBreak =
  (
    prevUpper !== null &&
    currUpper !== null &&
    prevFast > prevUpper &&
    currFast <= currUpper
  ) ||
  (
    prevSlow !== null &&
    currSlow !== null &&
    prevFast > prevSlow &&
    currFast <= currSlow
  ) ||
  (
    prevLower !== null &&
    currLower !== null &&
    prevFast > prevLower &&
    currFast <= currLower
  );

const shortExitBySmaBreak =
  (
    prevUpper !== null &&
    currUpper !== null &&
    prevFast < prevUpper &&
    currFast >= currUpper
  ) ||
  (
    prevSlow !== null &&
    currSlow !== null &&
    prevFast < prevSlow &&
    currFast >= currSlow
  ) ||
  (
    prevLower !== null &&
    currLower !== null &&
    prevFast < prevLower &&
    currFast >= currLower
  );

if (position === "long" && longExitBySmaBreak) {
  longExitPoints.push({ time: candle.time, value: candle.low });
  closeTrade(candle, "long");
  continue;
}

if (position === "short" && shortExitBySmaBreak) {
  shortExitPoints.push({ time: candle.time, value: candle.high });
  closeTrade(candle, "short");
  continue;
}
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
    acceptedLongEntryPoints: dedupeMarkers(acceptedLongEntryPoints),
    acceptedShortEntryPoints: dedupeMarkers(acceptedShortEntryPoints),
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

    const action = String(row.action || "").toLowerCase();
    const candleNear = findNearestCandle(candles, baseTime);
    const price = extractTradePrice(row, candleNear);

    if (price === null || !Number.isFinite(price) || price <= 0) continue;
    if (candleNear && Math.abs(price - candleNear.close) / candleNear.close > 0.2) continue;

    const executed = Boolean(row.exec_id || row.executed_at);

    if ((action === "buy" || action === "sell") && !executed) {
      if (action === "buy") {
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

    if (action === "buy") {
      realBuyPoints.push({
        time: baseTime,
        value: price,
        text: "RL",
        color: "#00ff88",
      });
      lastRealTradeText = `BUY ${formatTime(baseTime)}`;
      brokerState = "long";
    } else if (action === "sell") {
      realSellPoints.push({
        time: baseTime,
        value: price,
        text: "RS",
        color: "#ff4d6d",
      });
      lastRealTradeText = `SELL ${formatTime(baseTime)}`;
      brokerState = "short";
    } else if (
      action === "close" ||
      action === "close_all" ||
      action === "close_buy" ||
      action === "close_sell"
    ) {
      const affected = Array.isArray(row.confirm?.affectedDeals)
        ? row.confirm.affectedDeals[0]
        : null;

      const profitRaw = affected?.profit ?? row.confirm?.profit ?? null;
      const profit = Number(profitRaw);
      const currency = String(affected?.profitCurrency || row.confirm?.profitCurrency || "").trim();

      let text = "RC";
      if (Number.isFinite(profit)) {
        const sign = profit >= 0 ? "+" : "";
        text = `RC ${sign}${profit.toFixed(0)}${currency ? " " + currency : ""}`;
      }

      realClosePoints.push({
        time: baseTime,
        value: price,
        text,
        color: "#c084fc",
      });

      lastRealTradeText = `${text} ${formatTime(baseTime)}`;
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

function findNextCandleTime(candles: Candle[], ts: number): number {
  if (!candles.length || !ts) return ts;

  for (const c of candles) {
    if (Number(c.time) >= Number(ts)) {
      return Number(c.time);
    }
  }

  return Number(ts);
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
