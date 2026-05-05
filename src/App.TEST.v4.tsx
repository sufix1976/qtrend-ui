import { Fragment, useEffect, useMemo, useRef, useState } from "react";
// @ts-ignore
import { computeQTrendCore } from "./qtrend-core";
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
  use_slow_exit?: number | null;
  entry_band: number | null;
  sma_offset?: number | null;
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
];

function uniqueSymbols(base: string[], cfgMap: SymbolConfigMap): string[] {
  const set = new Set<string>();

  for (const s of base) {
    const x = String(s || "").trim().toUpperCase();
    if (x) set.add(x);
  }

  for (const s of Object.keys(cfgMap || {})) {
    const x = String(s || "").trim().toUpperCase();
    if (x) set.add(x);
  }

  return Array.from(set).sort();
}

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
  const [newSymbolInput, setNewSymbolInput] = useState("");
  
  const [, setConfigLoading] = useState(false);

  const entryBand = useMemo(() => ENTRY_BAND_BY_SYMBOL[symbol] ?? 100, [symbol]);
  const peakLookback = useMemo(() => PEAK_LOOKBACK_BY_SYMBOL[symbol] ?? 3, [symbol]);
  const minKinkMove = useMemo(() => MIN_KINK_MOVE_BY_SYMBOL[symbol] ?? 1, [symbol]);
  const assumedSpread = useMemo(() => SPREAD_BY_SYMBOL[symbol] ?? 0, [symbol]);
  const assumedSlippage = useMemo(() => SLIPPAGE_BY_SYMBOL[symbol] ?? 0, [symbol]);

  const availableSymbols = useMemo(
  () => uniqueSymbols(SYMBOLS, symbolConfigMap),
  [symbolConfigMap]
);
  
  const [entryBandUI, setEntryBandUI] = useState(entryBand);
  const [minKinkUI, setMinKinkUI] = useState(minKinkMove);
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
  const [chartType, setChartType] = useState<"candles" | "line">("candles");

  

  
  
 

  useEffect(() => {
  const cfg = symbolConfigMap[symbol];

  if (cfg) {
    setEntryBandUI(Number(cfg.entry_band ?? entryBand));
    setMinKinkUI(Number(cfg.min_kink ?? minKinkMove));
    setPeakUI(Number(cfg.peak_lookback ?? peakLookback));
    setSmaFastUI(Number(cfg.sma_fast ?? 10));
    setSmaSlowUI(Number(cfg.sma_slow ?? 100));
    setSmaOffsetUI(Number(cfg.sma_offset ?? 150));
    setSmaMiddleUI(Number(cfg.sma_middle ?? 100));
    setAdaptiveBandUI(Boolean(cfg.adaptive_band ?? false));
    setAdaptiveBandMultUI(Number(cfg.adaptive_band_mult ?? 1));
    setUseSlowExitUI(
  cfg?.use_slow_exit == null
    ? true
    : Boolean(cfg.use_slow_exit)
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
  
async function addNewSymbol() {
  const s = newSymbolInput.trim().toUpperCase();
  if (!s) return;

  const row: SymbolConfigRow = {
    symbol: s,
    interval,
    entry_band: s.endsWith("USD") && s.length === 6 ? 0.0015 : 100,
    sma_offset: s.endsWith("USD") && s.length === 6 ? 0.003 : 150,
    min_kink: s.endsWith("USD") && s.length === 6 ? 0.0003 : 1,
    peak_lookback: 3,
    sma_fast: 10,
    sma_slow: 100,
    sma_middle: 100,
    adaptive_band: 0,
    adaptive_band_mult: 1,
    use_slow_exit: 1,
    size: null,
  };

  await saveSymbolConfig(row);

  setSymbolConfigMap((prev) => ({
    ...prev,
    [s]: row,
  }));

  setSymbol(s);
  setNewSymbolInput("");
  setPresetMessage(`Neues Instrument angelegt: ${s}`);
}
  
  async function savePreset() {
  try {
    const row: SymbolConfigRow = {
      symbol,
      interval,
      entry_band: entryBandUI,
      sma_offset: smaOffsetUI,
      min_kink: minKinkUI,
      peak_lookback: peakUI,
      sma_fast: smaFastUI,
      sma_slow: smaSlowUI,
      sma_middle: smaMiddleUI,
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
      sma_offset: old?.sma_offset ?? null,
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
        sma_offset: old?.sma_offset ?? null,
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
        const minKinkVal = Number(cfg?.min_kink ?? MIN_KINK_MOVE_BY_SYMBOL[s] ?? 1);
        const smaFastVal = Number(cfg?.sma_fast ?? 10);
        const smaSlowVal = Number(cfg?.sma_slow ?? 100);
        const smaMiddleVal = Number(cfg?.sma_middle ?? 100);
        const smaOffsetVal = Number(cfg?.sma_offset ?? 150);
        const adaptiveBandVal = Boolean(cfg?.adaptive_band ?? false);
        const adaptiveBandMultVal = Number(cfg?.adaptive_band_mult ?? 1);

        const candles = await fetchCandles(s, tf);
        if (!candles.length) throw new Error("no candles");

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

        const coreCheck = computeQTrendCore(candles, {
  smaFast: smaFastUI,
  smaSlow: smaSlowUI,
  smaOffset: smaOffsetUI,
  entryBand: entryBandUI,
  kinkLookbackMinutes: kinkConfirmBarsUI,
  minKinkHeight: minKinkUI,        
});

console.log("QTREND CORE CHECK 2", {
  symbol,
  interval,
  lastZone: coreCheck.debug.lastZone,
  lastLongKink: coreCheck.kinks.longKinks.at(-1) ?? null,
  lastShortKink: coreCheck.kinks.shortKinks.at(-1) ?? null,
  longKinksCount: coreCheck.kinks.longKinks.length,
  shortKinksCount: coreCheck.kinks.shortKinks.length,
  zoneStats: coreCheck.debug,
  kinkDebug: coreCheck.kinks.debug,
});

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

              if (armed && d - extreme >= minKinkVal) {
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

              if (armed && extreme - d >= minKinkVal) {
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

                if (d - extreme >= minKinkVal) {
                  const c = candleByTime(dist[i].time);
                  if (c) out.push({ time: c.time, value: c.low });
                  break;
                }
              } else {
                if (d > extreme) extreme = d;

                if (extreme - d >= minKinkVal) {
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
          smaLower,
          cfg?.use_slow_exit == null
  ? true
  : Boolean(cfg.use_slow_exit)
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
   

    const candidateLongSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#22c55e",
      lineVisible: false,
      pointMarkersVisible: true,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const candidateShortSeries = priceChart.addSeries(LineSeries, {
      priceScaleId: "",
      color: "#ef4444",
      lineVisible: false,
      pointMarkersVisible: true,
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

        const [candles, liveBrokerState, aggRows, backendStrategyState, workerEvents] = await Promise.all([
  fetchCandles(symbol, interval),
  fetchBrokerPositionState(symbol),
  fetchAggTrades(symbol),
  fetchStrategyState(symbol),
  fetchUiStrategyEvents(symbol),
]);
        if (cancelled || mySeq !== loadSeqRef.current) return;
       

        if (cancelled) return;
        if (!candles.length) throw new Error("No valid candles returned");

        const smaFast = sanitizeLinePoints(calcSMA(candles, smaFastUI));
        const smaSlow = sanitizeLinePoints(calcSMA(candles, smaSlowUI));

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
    outlierLongPoints.push({
      time: curr.time,
      value: curr.low,
    });

    lastALIndex = i;
  }

  if (
    i - lastASIndex >= outlierCooldownBars &&
    prev.high <= prevUpper.value &&
    curr.high > currUpper.value
  ) {
    outlierShortPoints.push({
      time: curr.time,
      value: curr.high,
    });

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

        const coreCheck = computeQTrendCore(candles, {
  smaFast: smaFastUI,
  smaSlow: smaSlowUI,
  smaOffset: smaOffsetUI,
  entryBand: entryBandUI,
  kinkLookbackMinutes: kinkConfirmBarsUI,
});

console.log("QTREND CORE CHECK 2", {
  symbol,
  interval,
  lastZone: coreCheck.debug.lastZone,
  lastLongKink: coreCheck.kinks.longKinks.at(-1) ?? null,
  lastShortKink: coreCheck.kinks.shortKinks.at(-1) ?? null,
  longKinksCount: coreCheck.kinks.longKinks.length,
  shortKinksCount: coreCheck.kinks.shortKinks.length,
  zoneStats: coreCheck.debug,
kinkDebug: coreCheck.kinks.debug,
});

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

        const chartCandles = chartifyCandles(candles);
        const chartSmaFast = chartifyLinePoints(smaFast);
        const chartSmaSlow = chartifyLinePoints(smaSlow);
        
        const chartSmaUpper = chartifyLinePoints(smaUpper);
        const chartSmaLower = chartifyLinePoints(smaLower);
        
        const chartDist = chartifyLinePoints(dist);
        const chartDistMiddle = chartifyLinePoints(distMiddle);

        

      

       


        const real = buildRealTradeMarkers(candles, aggRows);
        const worker = buildWorkerEventMarkers(workerEvents);
        const realEvents = await fetchRealEvents(symbol);
        const realServer = buildRealMarkersFromServer(realEvents);
        

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

        smaFastSeries.setData(chartSmaFast as any);
        smaSlowSeries.setData(chartSmaSlow as any);
        
        smaUpperSeries.setData(chartSmaUpper as any);
        smaLowerSeries.setData(chartSmaLower as any);

        const candleTimes = new Set(chartCandles.map((c) => c.time));

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

createSeriesMarkers(smaSlowSeries, smaTurnMarkers as any);

        
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
  smaLower,
  useSlowExitUI
);

const validLongCandidates = sim.acceptedLongEntryPoints;
const validShortCandidates = sim.acceptedShortEntryPoints;

const strategyLongPoints = rawLongCandidates;
const strategyShortPoints = rawShortCandidates;

        console.log("UI LAST MARKERS", {
  symbol,
  interval,
  lastLong: strategyLongPoints.at(-1) ?? null,
  lastShort: strategyShortPoints.at(-1) ?? null,
  lastLongExit: sim.longExitPoints.at(-1) ?? null,
  lastShortExit: sim.shortExitPoints.at(-1) ?? null,
  lastCandle: candles.at(-1) ?? null,
});

        const newestEntryTime = Math.max(
  strategyLongPoints.at(-1)?.time ?? 0,
  strategyShortPoints.at(-1)?.time ?? 0
);

console.log("UI ENTRY FRESHNESS", {
  newestEntryTime,
  lastCandleTime: candles.at(-1)?.time ?? null,
  ageSec: candles.at(-1)?.time ? candles.at(-1)!.time - newestEntryTime : null,
  isFreshOnLastCandle:
    newestEntryTime === (candles.at(-1)?.time ?? -1),
});

        const lastDist = dist.at(-1);
const lastDynBand = dynamicBand.at(-1);
const lastTrend = lastDist ? trendAt(lastDist.time) : null;

let recentLongExtreme = Number.POSITIVE_INFINITY;

for (let j = Math.max(0, dist.length - 30); j < dist.length; j++) {
  recentLongExtreme = Math.min(recentLongExtreme, dist[j].value);
}

console.log("LONG SETUP CHECK", {
  symbol,
  interval,
  lastCandle: candles.at(-1),
  lastDist,
  lastTrend,
  entryBandUI,
  minKinkUI,
  recentLongExtreme,
  reboundNow: lastDist ? lastDist.value - recentLongExtreme : null,
  kinkReady: lastDist ? lastDist.value - recentLongExtreme >= minKinkUI : false,
  belowLowerBand: lastDist ? lastDist.value <= -entryBandUI : false,
  dynamicBandLast: lastDynBand,
});

        coreCheck.kinks.longKinks.map((p: MarkerPoint) => ({
  ...p,
  value: 1,
}))

coreCheck.kinks.shortKinks.map((p: MarkerPoint) => ({
  ...p,
  value: 1,
}))

        const coreLongProjected = projectMarkerPointsToCandles(
  coreCheck.kinks.longKinks.map((p: MarkerPoint) => ({
    ...p,
    value: 1,
  })),
  candles,
  "below-mid"
);

const coreShortProjected = projectMarkerPointsToCandles(
  coreCheck.kinks.shortKinks.map((p: MarkerPoint) => ({
    ...p,
    value: 1,
  })),
  candles,
  "above-mid"
);

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


        



        
        console.log(
  "VALID OUTLIER CANDIDATES",
  validLongCandidates.length,
  validShortCandidates.length
);
        
        const longExitProjected = projectMarkerPointsToCandles(sim.longExitPoints, candles, "below-near");
        const shortExitProjected = projectMarkerPointsToCandles(sim.shortExitPoints, candles, "above-near");
        const blockedLongProjected = projectMarkerPointsToCandles(real.blockedLongPoints, candles, "below-mid");
        const blockedShortProjected = projectMarkerPointsToCandles(real.blockedShortPoints, candles, "above-mid");
        const workerLongProjected = projectMarkerPointsToCandles(worker.longPoints, candles, "below-near");
        const workerShortProjected = projectMarkerPointsToCandles(worker.shortPoints, candles, "above-near");
        const workerFlatProjected = projectMarkerPointsToCandles(worker.flatPoints, candles, "inside-mid");
        
        

        candidateLongSeries.setData([]);
        candidateShortSeries.setData([]);
        strategyLongSeries.setData([]);
        strategyShortSeries.setData([]);
        strategyLongExitSeries.setData(longExitProjected as any);
        strategyShortExitSeries.setData(shortExitProjected as any);
        outlierLongSeries.setData(outlierLongProjected as any);
        outlierShortSeries.setData(outlierShortProjected as any);
       
       




        blockedLongSeries.setData(blockedLongProjected as any);
        blockedShortSeries.setData(blockedShortProjected as any);
        realBuySeries.setData([]);
        realSellSeries.setData([]);
        realCloseSeries.setData([]);

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

        candidateLongSeries.setData(coreLongProjected as any);
        candidateShortSeries.setData(coreShortProjected as any);


        createSeriesMarkers(
  candidateLongSeries,
  buildTextMarkers(
    coreLongProjected.map((p: MarkerPoint) => ({
      ...p,
      text: "C_AL",
color: "#ffffff",
    })),
    "aboveBar"
  )
);

createSeriesMarkers(
  candidateShortSeries,
  buildTextMarkers(
    coreShortProjected.map((p: MarkerPoint) => ({
      ...p,
      text: "C_AS",
color: "#ffff00",
    })),
    "aboveBar"
  )
);

   /*     createSeriesMarkers(
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
*/
       

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

        priceChart.removeSeries(smaUpperSeries);
        priceChart.removeSeries(smaLowerSeries);
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
        priceChart.removeSeries(outlierLongSeries);
        priceChart.removeSeries(outlierShortSeries);
        

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
  kinkConfirmBarsUI,  
  smaFastUI,
  smaSlowUI,
  smaOffsetUI,
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
              {availableSymbols.map((s) => (
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

    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
  <input
    value={newSymbolInput}
    onChange={(e) => setNewSymbolInput(e.target.value)}
    placeholder="Neues Symbol z.B. EURUSD"
    style={{ flex: 1 }}
  />
  <button onClick={addNewSymbol}>
    Add
  </button>
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
      gridTemplateColumns: "1.2fr 1fr auto",
      gap: 6,
      alignItems: "center",
      fontSize: 12,
    }}
  >
    <div style={{ color: "#94a3b8" }}>Symbol</div>
    <div style={{ color: "#94a3b8" }}>Size</div>
    <div></div>

    {availableSymbols.map((s) => (
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
  min={0}
  max={symbol.endsWith("USD") && symbol.length === 6 ? 0.02 : 500}
  step={symbol.endsWith("USD") && symbol.length === 6 ? 0.0001 : 0.01}
  value={entryBandUI}
  onChange={(e) => setEntryBandUI(Number(e.target.value))}
  style={{ width: "100%" }}
/>

          <div style={{ marginTop: 6 }}>Min Kink: {minKinkUI}</div>
          <input
            type="range"
            min={0}
            max={symbol.endsWith("USD") && symbol.length === 6 ? 0.005 : Math.max(minKinkMove * 3, minKinkMove + 1)}
            step={symbol.endsWith("USD") && symbol.length === 6 ? 0.0001 : minKinkMove < 1 ? 0.001 : 0.1}
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
    max="60"
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

    <label
  style={{
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    fontSize: 13,
  }}
>
  <input
    type="checkbox"
    checked={useSlowExitUI}
    onChange={(e) => setUseSlowExitUI(e.target.checked)}
  />
  Use SMA Slow Exit
</label>

        <div style={{ marginTop: 10, borderTop: "1px solid #334155", paddingTop: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>SMA Test</div>
          

    <div style={{ marginTop: 6 }}>
  <div>Fast SMA: {smaFastUI}</div>

  <input
    type="range"
    min="1"
    max="40"
    step="1"
    value={smaFastUI}
    onChange={(e) => setSmaFastUI(Number(e.target.value))}
    style={{ width: "100%" }}
  />
</div>

<div style={{ marginTop: 10 }}>
  <div>Slow SMA: {smaSlowUI}</div>

  <input
    type="range"
    min="1"
    max="200"
    step="1"
    value={smaSlowUI}
    onChange={(e) => setSmaSlowUI(Number(e.target.value))}
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

function alignLineToCandles(candles: Candle[], line: LinePoint[]): WhitespaceLinePoint[] {
  const map = new Map<number, number>();
  for (const p of line) map.set(p.time, p.value);

  return candles.map((c) => {
    const value = map.get(c.time);
    if (value == null || !Number.isFinite(value)) return { time: c.time };
    return { time: c.time, value };
  });
}

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
  _distMiddle: LinePoint[],
  longEntries: MarkerPoint[],
  shortEntries: MarkerPoint[],
  _bandLine: LinePoint[],
  assumedSpread: number,
  assumedSlippage: number,
  smaFast: LinePoint[],
  smaUpper: LinePoint[],
  smaSlow: LinePoint[],
  smaLower: LinePoint[],
  useSlowExit: boolean
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
    useSlowExit &&
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
    useSlowExit &&
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

function chartifyLinePoints(points: any[]): any[] {
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
