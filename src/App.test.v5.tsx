import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Side = "flat" | "long" | "short";
type ChartMode = "heikin" | "candles";

type V5Config = {
  symbol: string;
  interval: string;
  size: number;
  auto_enabled: boolean;
  sma_fast: number;
  sma_slow: number;
  atr_len: number;
  rsi_len: number;
  macd_fast: number;
  macd_slow: number;
  macd_signal: number;
};

type V5Snapshot = {
  symbol: string;
  interval: string;
  broker_side: Side;
  strategy_side: Side;
  dna: string;
  action: string;
  regime: string;
  regime_confidence: number;
  phase: string;
  phase_confidence: number;
  direction: string;
  trend: number;
  momentum: number;
  energy: number;
  volatility: number;
  compression: number;
  structure: number;
  balance: number;
  trend_age: number;
  pullback: number;
  exhaustion: number;
  dna_quality?: number;
};

type ConfigMap = Record<string, V5Config>;

type PositionCardProps = {
  config: V5Config;
  snapshot: V5Snapshot | null;
  onPatch: <K extends keyof V5Config>(key: K, value: V5Config[K]) => void;
  onSave: (config?: V5Config) => Promise<void>;
  onManual: (side: Side) => Promise<void>;
};

type ParameterCardProps = {
  config: V5Config;
  onPatch: <K extends keyof V5Config>(key: K, value: V5Config[K]) => void;
  onSave: (config?: V5Config) => Promise<void>;
};

type EngineCardProps = {
  snapshot: V5Snapshot | null;
};

type SizeTableProps = {
  configs: ConfigMap;
  activeSymbol: string;
  onChange: (symbol: string, next: V5Config) => void;
  onSave: (config?: V5Config) => Promise<void>;
};

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";

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

const INTERVALS = ["1m", "3m", "5m", "10m", "15m", "30m", "1h"];

const DEFAULT_CONFIG: V5Config = {
  symbol: "BTCUSD",
  interval: "15m",
  size: 1,
  auto_enabled: false,
  sma_fast: 20,
  sma_slow: 50,
  atr_len: 14,
  rsi_len: 14,
  macd_fast: 2,
  macd_slow: 26,
  macd_signal: 9,
};

function buildHeikinAshi(candles: Candle[]): Candle[] {
  if (!candles.length) return [];

  const output: Candle[] = [];
  let haOpen = (candles[0].open + candles[0].close) / 2;
  let haClose =
    (candles[0].open +
      candles[0].high +
      candles[0].low +
      candles[0].close) /
    4;

  output.push({
    time: candles[0].time,
    open: haOpen,
    high: Math.max(candles[0].high, haOpen, haClose),
    low: Math.min(candles[0].low, haOpen, haClose),
    close: haClose,
  });

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    haClose = (candle.open + candle.high + candle.low + candle.close) / 4;
    haOpen = (output[index - 1].open + output[index - 1].close) / 2;

    output.push({
      time: candle.time,
      open: haOpen,
      high: Math.max(candle.high, haOpen, haClose),
      low: Math.min(candle.low, haOpen, haClose),
      close: haClose,
    });
  }

  return output;
}

function ema(values: { time: number; value: number }[], length: number) {
  if (!values.length || length <= 0) return [];

  const factor = 2 / (length + 1);
  let current = values[0].value;

  return values.map((point) => {
    current = point.value * factor + current * (1 - factor);
    return { time: point.time, value: current };
  });
}

function calculateMacd(
  candles: Candle[],
  fast: number,
  slow: number,
  signal: number
) {
  const closeLine = candles.map((candle) => ({
    time: candle.time,
    value: candle.close,
  }));

  const fastLine = ema(closeLine, fast);
  const slowLine = ema(closeLine, slow);
  const slowMap = new Map(slowLine.map((point) => [point.time, point.value]));

  const macd = fastLine.map((point) => ({
    time: point.time,
    value: point.value - Number(slowMap.get(point.time) ?? point.value),
  }));

  const signalLine = ema(macd, signal);
  const signalMap = new Map(
    signalLine.map((point) => [point.time, point.value])
  );

  const histogram = macd.map((point) => ({
    time: point.time,
    value: point.value - Number(signalMap.get(point.time) ?? point.value),
  }));

  return { macd, signal: signalLine, histogram };
}

function calculateSma(candles: Candle[], length: number) {
  const points: { time: Time; value: number }[] = [];
  const safeLength = Math.max(1, Math.floor(length));
  let sum = 0;

  for (let index = 0; index < candles.length; index += 1) {
    sum += candles[index].close;

    if (index >= safeLength) {
      sum -= candles[index - safeLength].close;
    }

    if (index >= safeLength - 1) {
      points.push({
        time: candles[index].time as Time,
        value: sum / safeLength,
      });
    }
  }

  return points;
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
  });

  const text = await response.text();
  let json: any;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 300)}`);
  }

  if (!response.ok || json?.ok === false) {
    throw new Error(json?.error || json?.info || `HTTP ${response.status}`);
  }

  return json;
}

function normalizeConfig(row: any): V5Config {
  return {
    ...DEFAULT_CONFIG,
    ...row,
    symbol: String(row?.symbol || DEFAULT_CONFIG.symbol).toUpperCase(),
    interval: String(row?.interval || DEFAULT_CONFIG.interval),
    size: Number(row?.size ?? DEFAULT_CONFIG.size),
    auto_enabled:
      row?.auto_enabled === true || Number(row?.auto_enabled) === 1,
    sma_fast: Number(row?.sma_fast ?? DEFAULT_CONFIG.sma_fast),
    sma_slow: Number(row?.sma_slow ?? DEFAULT_CONFIG.sma_slow),
    atr_len: Number(row?.atr_len ?? DEFAULT_CONFIG.atr_len),
    rsi_len: Number(row?.rsi_len ?? DEFAULT_CONFIG.rsi_len),
    macd_fast: Number(row?.macd_fast ?? DEFAULT_CONFIG.macd_fast),
    macd_slow: Number(row?.macd_slow ?? DEFAULT_CONFIG.macd_slow),
    macd_signal: Number(row?.macd_signal ?? DEFAULT_CONFIG.macd_signal),
  };
}


function roundScore(value: unknown, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function semanticColor(value: string | null | undefined) {
  const upper = String(value || "").toUpperCase();

  if (
    upper.includes("LONG") ||
    upper === "UP" ||
    upper.includes("EXPANSION") ||
    upper === "TREND"
  ) {
    return "#22c55e";
  }

  if (
    upper.includes("SHORT") ||
    upper === "DOWN" ||
    upper.includes("EXHAUSTION")
  ) {
    return "#ef4444";
  }

  if (
    upper.includes("WATCH") ||
    upper.includes("WAIT") ||
    upper.includes("COMPRESSION")
  ) {
    return "#f59e0b";
  }

  if (upper.includes("PULLBACK")) {
    return "#60a5fa";
  }

  return "#cbd5e1";
}

function splitDna(dna: string | null | undefined) {
  const parts = String(dna || "").split("_");

  return {
    market: parts[0] || "-",
    phase: parts[1] || "-",
    direction: parts[2] || "-",
  };
}

function ScoreBar({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));

  return (
    <div style={styles.scoreBlock}>
      <div style={styles.scoreHeader}>
        <span>{label}</span>
        <strong>{roundScore(safeValue, 1)}</strong>
      </div>

      <div style={styles.scoreTrack}>
        <div
          style={{
            ...styles.scoreFill,
            width: `${safeValue}%`,
          }}
        />
      </div>
    </div>
  );
}


function PositionCard({
  config,
  snapshot,
  onPatch,
  onSave,
  onManual,
}: PositionCardProps) {
  const engineSide = snapshot?.strategy_side?.toUpperCase() ?? "FLAT";
  const brokerSide = snapshot?.broker_side?.toUpperCase() ?? "FLAT";

  return (
    <section
      style={{
        ...styles.card,
        borderLeft: `4px solid ${semanticColor(snapshot?.strategy_side)}`,
      }}
    >
      <h3 style={styles.cardTitle}>Position</h3>

      <div style={styles.positionHeroGrid}>
        <div style={styles.positionHero}>
          <span style={styles.positionLabel}>ENGINE</span>
          <strong
            style={{
              ...styles.positionValue,
              color: semanticColor(snapshot?.strategy_side),
            }}
          >
            {engineSide}
          </strong>
        </div>

        <div style={styles.positionHero}>
          <span style={styles.positionLabel}>BROKER</span>
          <strong
            style={{
              ...styles.positionValue,
              color: semanticColor(snapshot?.broker_side),
            }}
          >
            {brokerSide}
          </strong>
        </div>
      </div>

      <div style={styles.positionGrid}>
        <span>Size</span>
        <div style={styles.inlineControl}>
          <input
            type="number"
            step="any"
            value={config.size}
            onChange={(event) =>
              onPatch("size", Number(event.target.value) || 0)
            }
            style={styles.compactInput}
          />
          <button style={styles.button} onClick={() => void onSave()}>
            Save
          </button>
        </div>

        <span>Auto</span>
        <button
          style={config.auto_enabled ? styles.autoOn : styles.autoOff}
          onClick={() => {
            const next = {
              ...config,
              auto_enabled: !config.auto_enabled,
            };

            onPatch("auto_enabled", next.auto_enabled);
            void onSave(next);
          }}
        >
          AUTO {config.auto_enabled ? "ON" : "OFF"}
        </button>
      </div>

      <button style={styles.flatButton} onClick={() => void onManual("flat")}>
        Set FLAT
      </button>

      <button style={styles.longButton} onClick={() => void onManual("long")}>
        Set LONG
      </button>

      <button style={styles.shortButton} onClick={() => void onManual("short")}>
        Set SHORT
      </button>
    </section>
  );
}

function ParameterCard({ config, onPatch, onSave }: ParameterCardProps) {
  const fields = [
    ["Fast SMA", "sma_fast"],
    ["Slow SMA", "sma_slow"],
    ["ATR-Länge", "atr_len"],
    ["RSI Länge", "rsi_len"],
    ["MACD Fast", "macd_fast"],
    ["MACD Slow", "macd_slow"],
    ["MACD Signal", "macd_signal"],
  ] as const;

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}>Strategieparameter</h3>

      {fields.map(([label, key]) => (
        <label key={key} style={styles.field}>
          <span>{label}</span>
          <input
            type="number"
            min={1}
            value={config[key]}
            onChange={(event) =>
              onPatch(key, Math.max(1, Number(event.target.value) || 1))
            }
            style={styles.numberInput}
          />
        </label>
      ))}

      <button style={styles.saveButton} onClick={() => void onSave()}>
        Parameter speichern
      </button>
    </section>
  );
}


function EngineCard({ snapshot }: EngineCardProps) {
  const dna = splitDna(snapshot?.dna);
  const action = snapshot?.action ?? "-";
  const regime = snapshot?.regime ?? "-";
  const phase = snapshot?.phase ?? "-";
  const direction = snapshot?.direction ?? "-";

  const detailRows = [
    ["Regime Conf", snapshot ? `${Math.round(snapshot.regime_confidence)}%` : "-"],
    ["Phase Conf", snapshot ? `${Math.round(snapshot.phase_confidence)}%` : "-"],
    ["Structure", roundScore(snapshot?.structure, 1)],
    ["Balance", roundScore(snapshot?.balance, 1)],
    ["Trend Age", roundScore(snapshot?.trend_age, 1)],
    ["Pullback", roundScore(snapshot?.pullback, 1)],
    ["Exhaustion", roundScore(snapshot?.exhaustion, 1)],
    ["DNA Quality", roundScore(snapshot?.dna_quality, 1)],
  ];

  return (
    <section
      style={{
        ...styles.card,
        borderLeft: `4px solid ${semanticColor(action)}`,
      }}
    >
      <h3 style={styles.cardTitle}>Engine-Zustand</h3>

      <div style={styles.actionBox}>
        <span style={styles.actionLabel}>ACTION</span>
        <strong
          style={{
            ...styles.actionValue,
            color: semanticColor(action),
          }}
        >
          {action}
        </strong>
      </div>

      <div style={styles.dnaGrid}>
        <div style={styles.dnaCell}>
          <span style={styles.dnaLabel}>MARKT</span>
          <strong style={{ color: semanticColor(regime) }}>{dna.market}</strong>
        </div>

        <div style={styles.dnaCell}>
          <span style={styles.dnaLabel}>PHASE</span>
          <strong style={{ color: semanticColor(phase) }}>{dna.phase}</strong>
        </div>

        <div style={styles.dnaCell}>
          <span style={styles.dnaLabel}>RICHTUNG</span>
          <strong style={{ color: semanticColor(direction) }}>
            {dna.direction}
          </strong>
        </div>
      </div>

      <div style={styles.sectionDivider} />

      <ScoreBar label="Trend" value={snapshot?.trend} />
      <ScoreBar label="Momentum" value={snapshot?.momentum} />
      <ScoreBar label="Energy" value={snapshot?.energy} />
      <ScoreBar label="Volatility" value={snapshot?.volatility} />
      <ScoreBar label="Compression" value={snapshot?.compression} />

      <div style={styles.sectionDivider} />

      <div style={styles.infoTable}>
        {detailRows.map(([name, value]) => (
          <div key={String(name)} style={styles.infoRow}>
            <span>{name}</span>
            <strong>{String(value)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function SizeTable({
  configs,
  activeSymbol,
  onChange,
  onSave,
}: SizeTableProps) {
  return (
    <section style={styles.sizeSection}>
      <h3 style={styles.cardTitle}>Size Tabelle</h3>

      <div style={styles.sizeTable}>
        {SYMBOLS.map((symbol) => {
          const row = configs[symbol] || {
            ...DEFAULT_CONFIG,
            symbol,
          };

          return (
            <div key={symbol} style={styles.sizeRow}>
              <strong>{symbol}</strong>

              <input
                type="number"
                step="any"
                value={row.size}
                onChange={(event) => {
                  const size = Number(event.target.value);
                  onChange(symbol, {
                    ...row,
                    size: Number.isFinite(size) ? size : 0,
                  });
                }}
                style={styles.sizeInput}
              />

              <button style={styles.button} onClick={() => void onSave(row)}>
                Save
              </button>

              <button
                style={row.auto_enabled ? styles.autoOn : styles.autoOff}
                onClick={() => {
                  const next = {
                    ...row,
                    auto_enabled: !row.auto_enabled,
                  };
                  onChange(symbol, next);
                  void onSave(next);
                }}
              >
                AUTO {row.auto_enabled ? "ON" : "OFF"}
              </button>

              {symbol === activeSymbol && (
                <span style={styles.activeSymbolDot}>●</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function AppTESTv5() {
  const priceHostRef = useRef<HTMLDivElement | null>(null);
  const macdHostRef = useRef<HTMLDivElement | null>(null);

  const priceChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);

  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const slowSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const histogramSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const macdSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const signalSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const zeroSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const lastFitKeyRef = useRef("");

  const [symbol, setSymbol] = useState("BTCUSD");
  const [interval, setInterval] = useState("15m");
  const [chartMode, setChartMode] = useState<ChartMode>("heikin");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [config, setConfig] = useState<V5Config>(DEFAULT_CONFIG);
  const [snapshot, setSnapshot] = useState<V5Snapshot | null>(null);
  const [status, setStatus] = useState("Start");
  const [busy, setBusy] = useState(false);

  const visibleCandles = useMemo(
    () => (chartMode === "heikin" ? buildHeikinAshi(candles) : candles),
    [candles, chartMode]
  );

  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.background = "#050914";
    document.body.style.color = "#eef2ff";
  }, []);

  useEffect(() => {
    const current = configs[symbol];

    if (current) {
      setConfig(current);
      setInterval(current.interval);
      return;
    }

    const fallback = {
      ...DEFAULT_CONFIG,
      symbol,
    };

    setConfig(fallback);
    setInterval(fallback.interval);
  }, [symbol]);

  useEffect(() => {
    if (!priceHostRef.current || !macdHostRef.current) return;

    const priceChart = createChart(priceHostRef.current, {
      layout: {
        background: { color: "#070b16" },
        textColor: "#dbe4ff",
      },
      grid: {
        vertLines: { color: "#172033" },
        horzLines: { color: "#172033" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "#334155",
        minimumWidth: 78,
      },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
      },
      autoSize: true,
    });

    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });

    const slowSeries = priceChart.addSeries(LineSeries, {
      lineWidth: 2,
      color: "#3b82f6",
    });

    const macdChart = createChart(macdHostRef.current, {
      layout: {
        background: { color: "#070b16" },
        textColor: "#dbe4ff",
      },
      grid: {
        vertLines: { color: "#172033" },
        horzLines: { color: "#172033" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "#334155",
        minimumWidth: 78,
      },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
      },
      autoSize: true,
    });

    const histogramSeries = macdChart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "price",
        precision: 4,
        minMove: 0.0001,
      },
    });

    const macdSeries = macdChart.addSeries(LineSeries, {
      lineWidth: 2,
      color: "#60a5fa",
    });

    const signalSeries = macdChart.addSeries(LineSeries, {
      lineWidth: 2,
      color: "#f59e0b",
    });

    const zeroSeries = macdChart.addSeries(LineSeries, {
      lineWidth: 1,
      color: "#64748b",
    });

    let rangeSyncing = false;

    priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || rangeSyncing) return;
      rangeSyncing = true;
      macdChart.timeScale().setVisibleLogicalRange(range);
      rangeSyncing = false;
    });

    macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || rangeSyncing) return;
      rangeSyncing = true;
      priceChart.timeScale().setVisibleLogicalRange(range);
      rangeSyncing = false;
    });

    let crosshairSyncing = false;

    priceChart.subscribeCrosshairMove((param) => {
      if (crosshairSyncing) return;
      crosshairSyncing = true;

      if (param.time == null) {
        macdChart.clearCrosshairPosition();
      } else {
        const point = param.seriesData.get(candleSeries) as
          | { close?: number }
          | undefined;

        macdChart.setCrosshairPosition(
          Number(point?.close ?? 0),
          param.time,
          macdSeries
        );
      }

      crosshairSyncing = false;
    });

    macdChart.subscribeCrosshairMove((param) => {
      if (crosshairSyncing) return;
      crosshairSyncing = true;

      if (param.time == null) {
        priceChart.clearCrosshairPosition();
      } else {
        const point = param.seriesData.get(macdSeries) as
          | { value?: number }
          | undefined;

        priceChart.setCrosshairPosition(
          Number(point?.value ?? 0),
          param.time,
          candleSeries
        );
      }

      crosshairSyncing = false;
    });

    priceChartRef.current = priceChart;
    macdChartRef.current = macdChart;

    candleSeriesRef.current = candleSeries;
    slowSeriesRef.current = slowSeries;
    histogramSeriesRef.current = histogramSeries;
    macdSeriesRef.current = macdSeries;
    signalSeriesRef.current = signalSeries;
    zeroSeriesRef.current = zeroSeries;

    return () => {
      priceChart.remove();
      macdChart.remove();

      priceChartRef.current = null;
      macdChartRef.current = null;
      candleSeriesRef.current = null;
      slowSeriesRef.current = null;
      histogramSeriesRef.current = null;
      macdSeriesRef.current = null;
      signalSeriesRef.current = null;
      zeroSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      !candleSeriesRef.current ||
      !slowSeriesRef.current ||
      !histogramSeriesRef.current ||
      !macdSeriesRef.current ||
      !signalSeriesRef.current ||
      !zeroSeriesRef.current
    ) {
      return;
    }

    candleSeriesRef.current.setData(
      visibleCandles.map((candle) => ({
        ...candle,
        time: candle.time as Time,
      }))
    );

    slowSeriesRef.current.setData(calculateSma(candles, config.sma_slow));

    const macd = calculateMacd(
      candles,
      Math.max(1, config.macd_fast),
      Math.max(1, config.macd_slow),
      Math.max(1, config.macd_signal)
    );

    histogramSeriesRef.current.setData(
      macd.histogram.map((point) => ({
        time: point.time as Time,
        value: point.value,
        color: point.value >= 0 ? "#22c55e" : "#ef4444",
      }))
    );

    macdSeriesRef.current.setData(
      macd.macd.map((point) => ({
        time: point.time as Time,
        value: point.value,
      }))
    );

    signalSeriesRef.current.setData(
      macd.signal.map((point) => ({
        time: point.time as Time,
        value: point.value,
      }))
    );

    zeroSeriesRef.current.setData(
      candles.map((candle) => ({
        time: candle.time as Time,
        value: 0,
      }))
    );

    const fitKey = `${symbol}_${interval}`;

    if (candles.length > 0 && lastFitKeyRef.current !== fitKey) {
      priceChartRef.current?.timeScale().fitContent();
      macdChartRef.current?.timeScale().fitContent();
      lastFitKeyRef.current = fitKey;
    }
  }, [
    visibleCandles,
    candles,
    config.sma_slow,
    config.macd_fast,
    config.macd_slow,
    config.macd_signal,
    symbol,
    interval,
  ]);

  async function loadAll() {
    setBusy(true);
    setStatus("Lade V5...");

    try {
      const [configJson, candleJson, stateJson] = await Promise.all([
        fetchJson(`${BACKEND_BASE}/v5/config?_ts=${Date.now()}`),
        fetchJson(
          `${BACKEND_BASE}/v5/candles?symbol=${encodeURIComponent(
            symbol
          )}&interval=${encodeURIComponent(
            interval
          )}&limit=1500&_ts=${Date.now()}`
        ),
        fetchJson(
          `${BACKEND_BASE}/v5/state?symbol=${encodeURIComponent(
            symbol
          )}&_ts=${Date.now()}`
        ),
      ]);

      const map: ConfigMap = {};

      for (const row of configJson.rows || []) {
        const normalized = normalizeConfig(row);
        map[normalized.symbol] = normalized;
      }

      setConfigs(map);
      setCandles(Array.isArray(candleJson.candles) ? candleJson.candles : []);
      setSnapshot(stateJson.state || null);
      setStatus("V5 verbunden");
    } catch (error) {
      setStatus(
        `Fehler: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadAll();

    const timer = window.setInterval(async () => {
      try {
        const [candleJson, stateJson] = await Promise.all([
          fetchJson(
            `${BACKEND_BASE}/v5/candles?symbol=${encodeURIComponent(
              symbol
            )}&interval=${encodeURIComponent(
              interval
            )}&limit=1500&_ts=${Date.now()}`
          ),
          fetchJson(
            `${BACKEND_BASE}/v5/state?symbol=${encodeURIComponent(
              symbol
            )}&_ts=${Date.now()}`
          ),
        ]);

        setCandles(
          Array.isArray(candleJson.candles) ? candleJson.candles : []
        );
        setSnapshot(stateJson.state || null);
      } catch {
        // Letzten funktionierenden Stand behalten.
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [symbol, interval]);

  async function saveConfig(next: V5Config = config) {
    setBusy(true);

    try {
      const json = await fetchJson(`${BACKEND_BASE}/v5/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });

      const saved = normalizeConfig(json.row);

      setConfig(saved);
      setConfigs((previous) => ({
        ...previous,
        [saved.symbol]: saved,
      }));
      setStatus(`${saved.symbol} gespeichert`);
    } catch (error) {
      setStatus(
        `Speichern fehlgeschlagen: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  async function manual(side: Side) {
    setBusy(true);

    try {
      await fetchJson(`${BACKEND_BASE}/v5/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, side }),
      });

      setStatus(`${symbol}: ${side.toUpperCase()} gesendet`);
    } catch (error) {
      setStatus(
        `Manuell fehlgeschlagen: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  function patchConfig<K extends keyof V5Config>(
    key: K,
    value: V5Config[K]
  ) {
    setConfig((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  function updateTableConfig(rowSymbol: string, next: V5Config) {
    setConfigs((previous) => ({
      ...previous,
      [rowSymbol]: next,
    }));

    if (rowSymbol === symbol) {
      setConfig(next);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <strong>QTrend V5</strong>
          <span style={styles.muted}> Büro / Engine Cockpit</span>
        </div>

        <div style={styles.headerControls}>
          <select
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            style={styles.input}
          >
            {SYMBOLS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>

          <select
            value={interval}
            onChange={(event) => {
              const next = event.target.value;
              const nextConfig = {
                ...config,
                interval: next,
              };

              setInterval(next);
              setConfig(nextConfig);
              setConfigs((previous) => ({
                ...previous,
                [symbol]: nextConfig,
              }));
            }}
            style={styles.input}
          >
            {INTERVALS.map((timeframe) => (
              <option key={timeframe}>{timeframe}</option>
            ))}
          </select>

          <button
            style={chartMode === "heikin" ? styles.activeButton : styles.button}
            onClick={() => setChartMode("heikin")}
          >
            Heikin
          </button>

          <button
            style={
              chartMode === "candles" ? styles.activeButton : styles.button
            }
            onClick={() => setChartMode("candles")}
          >
            Kerzen
          </button>

          <span style={styles.status}>
            {busy ? "Bitte warten..." : status}
          </span>
        </div>
      </header>

      <main style={styles.layout}>
        <section style={styles.chartColumn}>
          <div ref={priceHostRef} style={styles.priceChart} />
          <div ref={macdHostRef} style={styles.macdChart} />
        </section>

        <aside style={styles.sidePanel}>
          <PositionCard
            config={config}
            snapshot={snapshot}
            onPatch={patchConfig}
            onSave={saveConfig}
            onManual={manual}
          />

          <ParameterCard
            config={config}
            onPatch={patchConfig}
            onSave={saveConfig}
          />

          <EngineCard snapshot={snapshot} />
        </aside>
      </main>

      <SizeTable
        configs={configs}
        activeSymbol={symbol}
        onChange={updateTableConfig}
        onSave={saveConfig}
      />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#050914",
    color: "#eef2ff",
    fontFamily: "Inter, Arial, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    padding: "10px 14px",
    borderBottom: "1px solid #243047",
    background: "#0a1020",
  },
  headerControls: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  muted: {
    color: "#94a3b8",
    marginLeft: 8,
  },
  status: {
    color: "#93c5fd",
    fontSize: 13,
    marginLeft: 8,
  },
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 360px",
    gap: 10,
    padding: 10,
  },
  chartColumn: {
    minWidth: 0,
    display: "grid",
    gridTemplateRows: "minmax(460px, 65vh) 240px",
    gap: 8,
  },
  priceChart: {
    width: "100%",
    minHeight: 460,
    border: "1px solid #243047",
    borderRadius: 10,
    overflow: "hidden",
  },
  macdChart: {
    width: "100%",
    minHeight: 220,
    border: "1px solid #243047",
    borderRadius: 10,
    overflow: "hidden",
  },
  sidePanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    maxHeight: "calc(100vh - 82px)",
    overflowY: "auto",
    overflowX: "hidden",
    paddingRight: 4,
    position: "sticky",
    top: 72,
  },
  card: {
    background: "#0a1020",
    border: "1px solid #243047",
    borderRadius: 10,
    padding: 12,
  },
  cardTitle: {
    margin: "0 0 10px",
    fontSize: 17,
  },
  positionGrid: {
    display: "grid",
    gridTemplateColumns: "92px minmax(0, 1fr)",
    gap: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  inlineControl: {
    display: "flex",
    gap: 6,
    minWidth: 0,
  },
  compactInput: {
    minWidth: 0,
    width: 88,
    background: "#111a2e",
    color: "#eef2ff",
    border: "1px solid #334155",
    borderRadius: 7,
    padding: "7px 9px",
  },
  input: {
    background: "#111a2e",
    color: "#eef2ff",
    border: "1px solid #334155",
    borderRadius: 7,
    padding: "7px 9px",
  },
  numberInput: {
    width: 90,
    background: "#111a2e",
    color: "#eef2ff",
    border: "1px solid #334155",
    borderRadius: 7,
    padding: "7px 9px",
  },
  button: {
    background: "#334155",
    color: "#fff",
    border: 0,
    borderRadius: 7,
    padding: "8px 12px",
    cursor: "pointer",
  },
  activeButton: {
    background: "#2563eb",
    color: "#fff",
    border: 0,
    borderRadius: 7,
    padding: "8px 12px",
    cursor: "pointer",
  },
  flatButton: {
    width: "100%",
    background: "#991b1b",
    color: "#fff",
    border: "1px solid #ef4444",
    borderRadius: 8,
    padding: 11,
    marginBottom: 8,
    fontWeight: 800,
    cursor: "pointer",
  },
  longButton: {
    width: "100%",
    background: "#166534",
    color: "#fff",
    border: "1px solid #22c55e",
    borderRadius: 8,
    padding: 11,
    marginBottom: 8,
    fontWeight: 800,
    cursor: "pointer",
  },
  shortButton: {
    width: "100%",
    background: "#991b1b",
    color: "#fff",
    border: "1px solid #ef4444",
    borderRadius: 8,
    padding: 11,
    fontWeight: 800,
    cursor: "pointer",
  },
  saveButton: {
    width: "100%",
    background: "#166534",
    color: "#fff",
    border: "1px solid #22c55e",
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    fontWeight: 800,
    cursor: "pointer",
  },
  field: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  infoTable: {
    display: "grid",
    gap: 4,
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "4px 0",
    borderBottom: "1px solid #172033",
  },
  sizeSection: {
    margin: "0 10px 10px",
    background: "#0a1020",
    border: "1px solid #243047",
    borderRadius: 10,
    padding: 12,
  },
  sizeTable: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
    gap: 6,
  },
  sizeRow: {
    display: "grid",
    gridTemplateColumns: "90px 1fr 62px 100px 16px",
    gap: 7,
    alignItems: "center",
    borderBottom: "1px solid #172033",
    padding: "5px 0",
  },
  sizeInput: {
    minWidth: 0,
    background: "#111a2e",
    color: "#eef2ff",
    border: "1px solid #334155",
    borderRadius: 7,
    padding: "7px 9px",
  },
  autoOn: {
    background: "#166534",
    color: "#fff",
    border: "1px solid #22c55e",
    borderRadius: 7,
    padding: "8px 7px",
    cursor: "pointer",
    fontWeight: 800,
  },
  autoOff: {
    background: "#991b1b",
    color: "#fff",
    border: "1px solid #ef4444",
    borderRadius: 7,
    padding: "8px 7px",
    cursor: "pointer",
    fontWeight: 800,
  },

  positionHeroGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginBottom: 12,
  },
  positionHero: {
    background: "#070b16",
    border: "1px solid #243047",
    borderRadius: 9,
    padding: "10px 8px",
    textAlign: "center",
  },
  positionLabel: {
    display: "block",
    color: "#94a3b8",
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 4,
  },
  positionValue: {
    display: "block",
    fontSize: 22,
    lineHeight: 1.1,
  },
  actionBox: {
    background: "#070b16",
    border: "1px solid #243047",
    borderRadius: 9,
    padding: "10px",
    textAlign: "center",
    marginBottom: 10,
  },
  actionLabel: {
    display: "block",
    color: "#94a3b8",
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 4,
  },
  actionValue: {
    fontSize: 20,
    lineHeight: 1.2,
  },
  dnaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 6,
  },
  dnaCell: {
    background: "#070b16",
    border: "1px solid #243047",
    borderRadius: 8,
    padding: "8px 6px",
    textAlign: "center",
    minWidth: 0,
  },
  dnaLabel: {
    display: "block",
    color: "#94a3b8",
    fontSize: 10,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  sectionDivider: {
    height: 1,
    background: "#243047",
    margin: "12px 0",
  },
  scoreBlock: {
    marginBottom: 9,
  },
  scoreHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
    fontSize: 13,
  },
  scoreTrack: {
    height: 7,
    background: "#172033",
    borderRadius: 999,
    overflow: "hidden",
  },
  scoreFill: {
    height: "100%",
    background: "linear-gradient(90deg, #2563eb, #22c55e)",
    borderRadius: 999,
  },

  activeSymbolDot: {
    color: "#22c55e",
    fontSize: 12,
  },
};
