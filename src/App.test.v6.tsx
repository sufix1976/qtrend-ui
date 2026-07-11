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
  createSeriesMarkers,
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
  time?: number;
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

  market_dna?: string;
  quality_grade?: string;
  quality_label?: string;

  decision?: string;
  decision_confidence?: number;
  decision_reasons?: string[];
  decision_warnings?: string[];

  worker_action?: "BUY" | "SELL" | "NONE";
  worker_ready?: boolean;

  entry_signal?: boolean;
  entry_long_signal?: boolean;
  entry_short_signal?: boolean;
  signal_side?: Side | null;
  signal_id?: string | null;

  long_permission?: boolean;
  short_permission?: boolean;
  ready_long?: boolean;
  ready_short?: boolean;

  live_entry_state?: string;
  live_pending_side?: Side | null;
  live_position_side?: Side;
  live_last_signal_id?: string | null;
  live_last_signal_time?: number | null;
  live_last_worker_action?: "BUY" | "SELL" | "NONE";
  live_last_processed_candle_time?: number | null;
  live_signal_is_new?: boolean;
};

type ConfigMap = Record<string, V5Config>;

type V5HistoryPoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;

  stage: "SCAN" | "WATCH" | "READY" | "PERMISSION" | "ENTRY" | "POSITION";
  side: "long" | "short" | null;

  decision?: string | null;
  action?: string | null;
  long_permission: boolean;
  short_permission: boolean;
  ready_long: boolean;
  ready_short: boolean;
  entry_signal: boolean;
  entry_long_signal: boolean;
  entry_short_signal: boolean;
  worker_action: "BUY" | "SELL" | "NONE";
};

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
    upper === "TREND" ||
    upper === "BUY" ||
    upper.includes("READY")
  ) {
    return "#22c55e";
  }

  if (
    upper.includes("SHORT") ||
    upper === "DOWN" ||
    upper.includes("EXHAUSTION") ||
    upper === "SELL"
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
    quality: parts[3] || "-",
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



function DecisionCard({
  snapshot,
}: {
  snapshot: V5Snapshot | null;
}) {
  const decision = readableDecision(snapshot);
  const stage = getUnifiedStage(snapshot);
  const confidence = Math.max(
    0,
    Math.min(100, Number(snapshot?.decision_confidence) || 0)
  );
  const workerAction = snapshot?.worker_action ?? "NONE";
  const workerReady = Boolean(snapshot?.worker_ready);

  return (
    <section
      style={{
        ...styles.card,
        borderLeft: `4px solid ${semanticColor(decision)}`,
      }}
    >
      <h3 style={styles.cardTitle}>Decision</h3>

      <div style={styles.actionBox}>
        <span style={styles.actionLabel}>ENTSCHEIDUNG · {stage}</span>
        <strong
          style={{
            ...styles.actionValue,
            color: semanticColor(decision),
          }}
        >
          {decision}
        </strong>

        <div style={styles.confidenceTrack}>
          <div
            style={{
              ...styles.confidenceFill,
              width: `${confidence}%`,
            }}
          />
        </div>
      </div>

      <div style={styles.decisionMetaGrid}>
        <div style={styles.metaCell}>
          <span style={styles.metaLabel}>CONFIDENCE</span>
          <strong>{roundScore(confidence, 1)}%</strong>
        </div>

        <div style={styles.metaCell}>
          <span style={styles.metaLabel}>GRADE</span>
          <strong>{snapshot?.quality_grade ?? "-"}</strong>
        </div>

        <div style={styles.metaCell}>
          <span style={styles.metaLabel}>WORKER</span>
          <strong
            style={{
              color: workerReady ? "#22c55e" : "#f59e0b",
            }}
          >
            {workerReady ? "READY" : "WAIT"}
          </strong>
        </div>
      </div>

      <div style={styles.sectionDivider} />

      <div style={styles.decisionMetaGrid}>
        <div style={styles.metaCell}>
          <span style={styles.metaLabel}>ACTION</span>
          <strong
            style={{
              color: semanticColor(workerAction),
            }}
          >
            {workerAction}
          </strong>
        </div>

        <div style={styles.metaCell}>
          <span style={styles.metaLabel}>SIGNAL</span>
          <strong>{snapshot?.entry_signal ? "YES" : "NO"}</strong>
        </div>

        <div style={styles.metaCell}>
          <span style={styles.metaLabel}>SIDE</span>
          <strong>{snapshot?.signal_side?.toUpperCase() ?? "-"}</strong>
        </div>
      </div>

      {snapshot?.signal_id && (
        <>
          <div style={styles.sectionDivider} />
          <div style={styles.signalIdText}>
            Signal ID: {snapshot.signal_id}
          </div>
        </>
      )}
    </section>
  );
}


type EntryCheck = {
  label: string;
  passed: boolean;
  value: string;
  points: number;
};

function getEntryDirection(snapshot: V5Snapshot | null) {
  const combined = [
    snapshot?.decision,
    snapshot?.action,
    snapshot?.signal_side,
    snapshot?.direction,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (combined.includes("SHORT") || combined.includes("DOWN")) {
    return "short" as const;
  }

  if (combined.includes("LONG") || combined.includes("UP")) {
    return "long" as const;
  }

  return null;
}

function buildEntryChecks(snapshot: V5Snapshot | null): EntryCheck[] {
  const side = getEntryDirection(snapshot);
  const direction = String(snapshot?.direction || "").toUpperCase();
  const regime = String(snapshot?.regime || "").toUpperCase();
  const phase = String(snapshot?.phase || "").toUpperCase();

  const directionOk =
    side === "long"
      ? direction === "UP"
      : side === "short"
        ? direction === "DOWN"
        : direction === "UP" || direction === "DOWN";

  return [
    {
      label: "Trend",
      passed: Number(snapshot?.trend) >= 55,
      value: roundScore(snapshot?.trend, 1),
      points: 15,
    },
    {
      label: "Regime",
      passed: regime === "TREND",
      value: regime || "-",
      points: 15,
    },
    {
      label: "Phase",
      passed: phase === "EXPANSION",
      value: phase || "-",
      points: 15,
    },
    {
      label: "Direction",
      passed: directionOk,
      value: direction || "-",
      points: 10,
    },
    {
      label: "Momentum",
      passed: Number(snapshot?.momentum) >= 55,
      value: roundScore(snapshot?.momentum, 1),
      points: 15,
    },
    {
      label: "Energy",
      passed: Number(snapshot?.energy) >= 45,
      value: roundScore(snapshot?.energy, 1),
      points: 10,
    },
    {
      label: "Structure",
      passed: Number(snapshot?.structure) >= 60,
      value: roundScore(snapshot?.structure, 1),
      points: 10,
    },
    {
      label: "Compression",
      passed: Number(snapshot?.compression) <= 62,
      value: roundScore(snapshot?.compression, 1),
      points: 10,
    },
  ];
}


type UnifiedStage =
  | "SCAN"
  | "WATCH"
  | "READY"
  | "SIGNAL"
  | "EXECUTING"
  | "POSITION";

function getUnifiedStage(snapshot: V5Snapshot | null): UnifiedStage {
  const strategySide = String(snapshot?.strategy_side || "flat").toLowerCase();
  const brokerSide = String(snapshot?.broker_side || "flat").toLowerCase();
  const workerAction = String(
    snapshot?.live_last_worker_action ??
      snapshot?.worker_action ??
      "NONE"
  ).toUpperCase();

  if (
    strategySide !== "flat" &&
    brokerSide === strategySide
  ) {
    return "POSITION";
  }

  if (
    workerAction === "BUY" ||
    workerAction === "SELL"
  ) {
    return "EXECUTING";
  }

  if (snapshot?.entry_signal) {
    return "SIGNAL";
  }

  if (
    snapshot?.long_permission ||
    snapshot?.short_permission ||
    snapshot?.ready_long ||
    snapshot?.ready_short
  ) {
    return "READY";
  }

  const decision = String(snapshot?.decision || "").toUpperCase();
  const action = String(snapshot?.action || "").toUpperCase();

  if (
    decision.includes("WATCH") ||
    decision.includes("LONG") ||
    decision.includes("SHORT") ||
    action.includes("LONG") ||
    action.includes("SHORT")
  ) {
    return "WATCH";
  }

  return "SCAN";
}

function readableDecision(snapshot: V5Snapshot | null) {
  const stage = getUnifiedStage(snapshot);
  const side = getEntryDirection(snapshot);

  if (stage === "POSITION") {
    return side === "short" ? "SHORT POSITION" : "LONG POSITION";
  }

  if (stage === "EXECUTING") {
    return side === "short" ? "SELL WIRD AUSGEFÜHRT" : "BUY WIRD AUSGEFÜHRT";
  }

  if (stage === "SIGNAL") {
    return side === "short" ? "SHORT SIGNAL" : "LONG SIGNAL";
  }

  if (stage === "READY") {
    return side === "short" ? "SHORT READY" : "LONG READY";
  }

  if (stage === "WATCH") {
    return side === "short" ? "WATCH SHORT" : "WATCH LONG";
  }

  return "SCAN";
}

function getNextStep(snapshot: V5Snapshot | null) {
  const stage = getUnifiedStage(snapshot);
  const side = getEntryDirection(snapshot);

  if (stage === "POSITION") {
    return {
      title: side === "short" ? "SHORT POSITION AKTIV" : "LONG POSITION AKTIV",
      detail: "Auf neues Gegensignal oder manuellen Eingriff warten.",
      status: "OK",
    };
  }

  if (stage === "EXECUTING") {
    return {
      title: "BROKER-BESTÄTIGUNG",
      detail: "Worker hat eine Orderaktion erkannt und wartet auf Synchronität.",
      status: "WAIT",
    };
  }

  if (stage === "SIGNAL") {
    return {
      title: "WORKER-AUSFÜHRUNG",
      detail: "Entry-Signal liegt vor. Worker muss das neue Signal übernehmen.",
      status: "WAIT",
    };
  }

  if (stage === "READY") {
    return {
      title:
        side === "short"
          ? "AUF ROTE TRIGGERKERZE WARTEN"
          : "AUF GRÜNE TRIGGERKERZE WARTEN",
      detail: "Permission ist vorhanden, aber noch kein Entry-Signal.",
      status: "WAIT",
    };
  }

  if (stage === "WATCH") {
    return {
      title:
        side === "short"
          ? "SHORT-PERMISSION ABWARTEN"
          : "LONG-PERMISSION ABWARTEN",
      detail: "Marktrichtung wird beobachtet, die Freigabe ist noch nicht vollständig.",
      status: "WAIT",
    };
  }

  return {
    title: "MARKT SCANNEN",
    detail: "Noch kein LONG- oder SHORT-Kontext aktiv.",
    status: "SCAN",
  };
}

function EntryMonitorCard({
  snapshot,
}: {
  snapshot: V5Snapshot | null;
}) {
  const checks = buildEntryChecks(snapshot);
  const workerAction =
    snapshot?.live_last_worker_action ??
    snapshot?.worker_action ??
    "NONE";

  const executionChecks = [
    {
      label: "Long Permission",
      passed: Boolean(snapshot?.long_permission),
    },
    {
      label: "Short Permission",
      passed: Boolean(snapshot?.short_permission),
    },
    {
      label: "Entry Signal",
      passed: Boolean(snapshot?.entry_signal),
    },
    {
      label: "Neues Live-Signal",
      passed: Boolean(snapshot?.live_signal_is_new),
    },
    {
      label: "Worker Ready",
      passed: Boolean(snapshot?.worker_ready),
    },
  ];

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}>Entry Monitor</h3>

      <div style={styles.checkList}>
        {checks.map((check) => (
          <div key={check.label} style={styles.checkRow}>
            <span
              style={{
                ...styles.checkIcon,
                color: check.passed ? "#22c55e" : "#ef4444",
              }}
            >
              {check.passed ? "✓" : "✗"}
            </span>
            <span style={styles.checkName}>{check.label}</span>
            <strong>{check.value}</strong>
          </div>
        ))}
      </div>

      <div style={styles.sectionDivider} />

      <div style={styles.checkList}>
        {executionChecks.map((check) => (
          <div key={check.label} style={styles.checkRow}>
            <span
              style={{
                ...styles.checkIcon,
                color: check.passed ? "#22c55e" : "#ef4444",
              }}
            >
              {check.passed ? "✓" : "✗"}
            </span>
            <span style={styles.checkName}>{check.label}</span>
            <strong>{check.passed ? "YES" : "NO"}</strong>
          </div>
        ))}

        <div style={styles.checkRow}>
          <span
            style={{
              ...styles.checkIcon,
              color: semanticColor(workerAction),
            }}
          >
            •
          </span>
          <span style={styles.checkName}>Worker Action</span>
          <strong style={{ color: semanticColor(workerAction) }}>
            {workerAction}
          </strong>
        </div>
      </div>
    </section>
  );
}

function LivePipelineCard({
  snapshot,
}: {
  snapshot: V5Snapshot | null;
}) {
  const permission =
    snapshot?.long_permission
      ? "LONG"
      : snapshot?.short_permission
        ? "SHORT"
        : "NO";

  const steps = [
    ["Stage", getUnifiedStage(snapshot)],
    ["Decision", readableDecision(snapshot)],
    ["Permission", permission],
    ["Entry Signal", snapshot?.entry_signal ? "YES" : "NO"],
    [
      "Worker",
      snapshot?.live_last_worker_action ??
        snapshot?.worker_action ??
        "NONE",
    ],
    [
      "Engine Position",
      snapshot?.strategy_side?.toUpperCase() ?? "FLAT",
    ],
    [
      "Broker Position",
      snapshot?.broker_side?.toUpperCase() ?? "FLAT",
    ],
  ];

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}>Live Pipeline</h3>

      <div style={styles.pipeline}>
        {steps.map(([label, value], index) => (
          <div key={label}>
            <div style={styles.pipelineStep}>
              <span style={styles.pipelineLabel}>{label}</span>
              <strong style={{ color: semanticColor(value) }}>
                {value}
              </strong>
            </div>

            {index < steps.length - 1 && (
              <div style={styles.pipelineArrow}>↓</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function NextStepCard({
  snapshot,
}: {
  snapshot: V5Snapshot | null;
}) {
  const next = getNextStep(snapshot);

  return (
    <section
      style={{
        ...styles.card,
        borderLeft: `4px solid ${
          next.status === "OK" ? "#22c55e" : "#f59e0b"
        }`,
      }}
    >
      <h3 style={styles.cardTitle}>Next Step</h3>

      <div style={styles.nextStepBox}>
        <strong
          style={{
            color: next.status === "OK" ? "#22c55e" : "#f59e0b",
          }}
        >
          {next.title}
        </strong>

        <span>{next.detail}</span>
      </div>
    </section>
  );
}

function EntryScoreCard({
  snapshot,
}: {
  snapshot: V5Snapshot | null;
}) {
  const checks = buildEntryChecks(snapshot);

  const engineScore = checks.reduce(
    (sum, check) => sum + (check.passed ? check.points : 0),
    0
  );

  const permissionOk = Boolean(
    snapshot?.long_permission || snapshot?.short_permission
  );
  const entrySignalOk = Boolean(snapshot?.entry_signal);
  const workerReadyOk = Boolean(snapshot?.worker_ready);
  const brokerAligned =
    String(snapshot?.strategy_side || "flat").toLowerCase() ===
    String(snapshot?.broker_side || "flat").toLowerCase();

  const executionItems = [
    {
      label: "Permission",
      passed: permissionOk,
      points: 8,
    },
    {
      label: "Entry Signal",
      passed: entrySignalOk,
      points: 6,
    },
    {
      label: "Worker Ready",
      passed: workerReadyOk,
      points: 4,
    },
    {
      label: "Engine/Broker Sync",
      passed: brokerAligned,
      points: 2,
    },
  ];

  const executionScore = executionItems.reduce(
    (sum, item) => sum + (item.passed ? item.points : 0),
    0
  );

  const totalPoints = engineScore + executionScore;
  const totalPercent = Math.round((totalPoints / 120) * 100);

  const missing = [
    ...checks.filter((check) => !check.passed).map((check) => check.label),
    ...executionItems
      .filter((item) => !item.passed)
      .map((item) => item.label),
  ];

  const uniqueMissing = [...new Set(missing)];

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}>Entry Score</h3>

      <div style={styles.scoreSummaryGrid}>
        <div style={styles.scoreSummaryCell}>
          <span>ENGINE</span>
          <strong>{engineScore} / 100</strong>
        </div>

        <div style={styles.scoreSummaryCell}>
          <span>EXECUTION</span>
          <strong>{executionScore} / 20</strong>
        </div>

        <div style={styles.scoreSummaryCell}>
          <span>TOTAL</span>
          <strong>{totalPercent}%</strong>
        </div>
      </div>

      <div style={styles.confidenceTrack}>
        <div
          style={{
            ...styles.confidenceFill,
            width: `${totalPercent}%`,
          }}
        />
      </div>

      <div style={styles.sectionDivider} />

      <h4 style={styles.scoreSectionTitle}>Engine Score</h4>

      <div style={styles.scoreBreakdown}>
        {checks.map((check) => (
          <div key={check.label} style={styles.scoreBreakdownRow}>
            <span>{check.label}</span>
            <strong
              style={{
                color: check.passed ? "#22c55e" : "#64748b",
              }}
            >
              {check.passed ? `+${check.points}` : "+0"}
            </strong>
          </div>
        ))}
      </div>

      <div style={styles.sectionDivider} />

      <h4 style={styles.scoreSectionTitle}>Execution Score</h4>

      <div style={styles.scoreBreakdown}>
        {executionItems.map((item) => (
          <div key={item.label} style={styles.scoreBreakdownRow}>
            <span>{item.label}</span>
            <strong
              style={{
                color: item.passed ? "#22c55e" : "#64748b",
              }}
            >
              {item.passed ? `+${item.points}` : "+0"}
            </strong>
          </div>
        ))}
      </div>

      <div style={styles.sectionDivider} />

      <div
        style={{
          ...styles.missingBox,
          borderColor:
            uniqueMissing.length === 0 ? "#166534" : "#854d0e",
          background:
            uniqueMissing.length === 0 ? "#07150f" : "#1a1205",
        }}
      >
        <strong>
          {uniqueMissing.length === 0
            ? "ENTRY READY"
            : "NO ENTRY – fehlend:"}
        </strong>

        {uniqueMissing.length > 0 && (
          <ul style={styles.missingList}>
            {uniqueMissing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>

      <div style={styles.uiScoreNote}>
        UI-Transparenzscore – ändert keine Engine-Entscheidung.
      </div>
    </section>
  );
}

function ReasonsCard({
  snapshot,
}: {
  snapshot: V5Snapshot | null;
}) {
  const reasons = snapshot?.decision_reasons ?? [];
  const warnings = snapshot?.decision_warnings ?? [];

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}>Warum JA / Warum NICHT</h3>

      <h4 style={styles.reasonSectionTitle}>Warum JA</h4>

      {reasons.length > 0 ? (
        <ul style={styles.reasonList}>
          {reasons.map((reason, index) => (
            <li
              key={`${reason}-${index}`}
              style={styles.reasonItem}
            >
              ✓ {reason}
            </li>
          ))}
        </ul>
      ) : (
        <div style={styles.emptyNotice}>
          Keine Gründe vorhanden.
        </div>
      )}

      <div style={styles.sectionDivider} />

      <h4 style={styles.reasonSectionTitle}>Warum NICHT</h4>

      {warnings.length > 0 ? (
        <ul style={styles.reasonList}>
          {warnings.map((warning, index) => (
            <li
              key={`${warning}-${index}`}
              style={styles.warningItem}
            >
              ⚠ {warning}
            </li>
          ))}
        </ul>
      ) : (
        <div style={styles.emptyNotice}>
          Keine Warnungen.
        </div>
      )}
    </section>
  );
}

function EngineCard({ snapshot }: EngineCardProps) {
  const dna = splitDna(snapshot?.market_dna || snapshot?.dna);
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
          <strong style={{ color: semanticColor(regime) }}>
            {dna.market}
          </strong>
        </div>

        <div style={styles.dnaCell}>
          <span style={styles.dnaLabel}>PHASE</span>
          <strong style={{ color: semanticColor(phase) }}>
            {dna.phase}
          </strong>
        </div>

        <div style={styles.dnaCell}>
          <span style={styles.dnaLabel}>RICHTUNG</span>
          <strong style={{ color: semanticColor(direction) }}>
            {dna.direction}
          </strong>
        </div>

        <div style={styles.dnaCell}>
          <span style={styles.dnaLabel}>QUALITY</span>
          <strong>
            {snapshot?.quality_label ?? dna.quality ?? "-"}
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
  const watchMarkersApiRef = useRef<any>(null);

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

  const [showWatchMarkers, setShowWatchMarkers] = useState(true);
  const [showReadyMarkers, setShowReadyMarkers] = useState(true);
  const [showPermissionMarkers, setShowPermissionMarkers] = useState(true);
  const [showEntryMarkers, setShowEntryMarkers] = useState(true);
  const [history, setHistory] = useState<V5HistoryPoint[]>([]);

  const markerCounts = useMemo(() => {
    const sorted = [...history].sort(
      (a, b) => Number(a.time) - Number(b.time)
    );

    const counts = {
      WATCH: 0,
      READY: 0,
      PERMISSION: 0,
      ENTRY: 0,
    };

    for (let index = 0; index < sorted.length; index += 1) {
      const point = sorted[index];
      const previous = index > 0 ? sorted[index - 1] : null;

      const decision = String(point.decision || "").toUpperCase();
      const previousDecision = String(previous?.decision || "").toUpperCase();

      const watchLongNow =
        decision === "WATCH_LONG" ||
        decision === "PREP_LONG";

      const watchShortNow =
        decision === "WATCH_SHORT" ||
        decision === "PREP_SHORT";

      const watchLongBefore =
        previousDecision === "WATCH_LONG" ||
        previousDecision === "PREP_LONG";

      const watchShortBefore =
        previousDecision === "WATCH_SHORT" ||
        previousDecision === "PREP_SHORT";

      if (watchLongNow && !watchLongBefore) counts.WATCH += 1;
      if (watchShortNow && !watchShortBefore) counts.WATCH += 1;

      if (
        point.ready_long === true &&
        previous?.ready_long !== true
      ) {
        counts.READY += 1;
      }

      if (
        point.ready_short === true &&
        previous?.ready_short !== true
      ) {
        counts.READY += 1;
      }

      if (
        point.long_permission === true &&
        previous?.long_permission !== true
      ) {
        counts.PERMISSION += 1;
      }

      if (
        point.short_permission === true &&
        previous?.short_permission !== true
      ) {
        counts.PERMISSION += 1;
      }

      if (
        point.entry_long_signal === true &&
        previous?.entry_long_signal !== true
      ) {
        counts.ENTRY += 1;
      }

      if (
        point.entry_short_signal === true &&
        previous?.entry_short_signal !== true
      ) {
        counts.ENTRY += 1;
      }
    }

    return counts;
  }, [history]);

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
  }, [symbol, configs]);


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

    const watchMarkersApi = createSeriesMarkers(candleSeries, []);

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
      localization: {
        priceFormatter: (value: number) => value.toFixed(2),
      },
      autoSize: true,
    });

    const histogramSeries = macdChart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
    });

    const macdSeries = macdChart.addSeries(LineSeries, {
      lineWidth: 2,
      color: "#60a5fa",
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
    });

    const signalSeries = macdChart.addSeries(LineSeries, {
      lineWidth: 2,
      color: "#f59e0b",
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
    });

    const zeroSeries = macdChart.addSeries(LineSeries, {
      lineWidth: 1,
      color: "#64748b",
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
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
    watchMarkersApiRef.current = watchMarkersApi;

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
      watchMarkersApiRef.current = null;
    };
  }, []);


  useEffect(() => {
    if (!watchMarkersApiRef.current) return;

    const sortedHistory = [...history].sort(
      (a, b) => Number(a.time) - Number(b.time)
    );

    type MarkerEvent = {
      time: number;
      kind: "WATCH" | "READY" | "PERMISSION" | "ENTRY";
      side: "long" | "short";
    };

    const events: MarkerEvent[] = [];

    for (let index = 0; index < sortedHistory.length; index += 1) {
      const point = sortedHistory[index];
      const previous = index > 0 ? sortedHistory[index - 1] : null;

      const decision = String(point.decision || "").toUpperCase();
      const previousDecision = String(previous?.decision || "").toUpperCase();

      const watchLongNow =
        decision === "WATCH_LONG" ||
        decision === "PREP_LONG";

      const watchShortNow =
        decision === "WATCH_SHORT" ||
        decision === "PREP_SHORT";

      const watchLongBefore =
        previousDecision === "WATCH_LONG" ||
        previousDecision === "PREP_LONG";

      const watchShortBefore =
        previousDecision === "WATCH_SHORT" ||
        previousDecision === "PREP_SHORT";

      if (watchLongNow && !watchLongBefore) {
        events.push({
          time: point.time,
          kind: "WATCH",
          side: "long",
        });
      }

      if (watchShortNow && !watchShortBefore) {
        events.push({
          time: point.time,
          kind: "WATCH",
          side: "short",
        });
      }

      if (
        point.ready_long === true &&
        previous?.ready_long !== true
      ) {
        events.push({
          time: point.time,
          kind: "READY",
          side: "long",
        });
      }

      if (
        point.ready_short === true &&
        previous?.ready_short !== true
      ) {
        events.push({
          time: point.time,
          kind: "READY",
          side: "short",
        });
      }

      if (
        point.long_permission === true &&
        previous?.long_permission !== true
      ) {
        events.push({
          time: point.time,
          kind: "PERMISSION",
          side: "long",
        });
      }

      if (
        point.short_permission === true &&
        previous?.short_permission !== true
      ) {
        events.push({
          time: point.time,
          kind: "PERMISSION",
          side: "short",
        });
      }

      if (
        point.entry_long_signal === true &&
        previous?.entry_long_signal !== true
      ) {
        events.push({
          time: point.time,
          kind: "ENTRY",
          side: "long",
        });
      }

      if (
        point.entry_short_signal === true &&
        previous?.entry_short_signal !== true
      ) {
        events.push({
          time: point.time,
          kind: "ENTRY",
          side: "short",
        });
      }
    }

    const markers = events
      .filter((event) => {
        if (event.kind === "WATCH") return showWatchMarkers;
        if (event.kind === "READY") return showReadyMarkers;
        if (event.kind === "PERMISSION") return showPermissionMarkers;
        if (event.kind === "ENTRY") return showEntryMarkers;
        return false;
      })
      .map((event) => {
        const isLong = event.side === "long";
        const position = isLong ? "belowBar" : "aboveBar";

        if (event.kind === "ENTRY") {
          return {
            time: event.time as Time,
            position,
            color: isLong ? "#22c55e" : "#ef4444",
            shape: isLong ? "arrowUp" : "arrowDown",
            text: "",
            size: 1.3,
          };
        }

        if (event.kind === "PERMISSION") {
          return {
            time: event.time as Time,
            position,
            color: "#3b82f6",
            shape: "square",
            text: "",
            size: 0.95,
          };
        }

        if (event.kind === "READY") {
          return {
            time: event.time as Time,
            position,
            color: "#f59e0b",
            shape: "circle",
            text: "",
            size: 0.9,
          };
        }

        return {
          time: event.time as Time,
          position,
          color: "rgba(148, 163, 184, 0.9)",
          shape: "circle",
          text: "",
          size: 0.7,
        };
      })
      .sort((a, b) => Number(a.time) - Number(b.time));

    watchMarkersApiRef.current.setMarkers(markers);
  }, [
    history,
    showWatchMarkers,
    showReadyMarkers,
    showPermissionMarkers,
    showEntryMarkers,
  ]);

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
      const [configJson, stateJson] = await Promise.all([
        fetchJson(`${BACKEND_BASE}/v5/config?_ts=${Date.now()}`),
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

      const savedActiveConfig = map[symbol];
      if (savedActiveConfig) {
        setConfig(savedActiveConfig);
        setInterval(savedActiveConfig.interval);
      }

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
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;

    async function refreshMarketData() {
      try {
        const [candleJson, stateJson, historyJson] = await Promise.all([
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
          fetchJson(
            `${BACKEND_BASE}/v5/history?symbol=${encodeURIComponent(
              symbol
            )}&interval=${encodeURIComponent(
              interval
            )}&limit=1500&_ts=${Date.now()}`
          ),
        ]);

        if (cancelled) return;

        setCandles(
          Array.isArray(candleJson.candles) ? candleJson.candles : []
        );
        setSnapshot(stateJson.state || null);
        setHistory(
          Array.isArray(historyJson.history) ? historyJson.history : []
        );
      } catch {
        // Letzten funktionierenden Stand behalten.
      }
    }

    void refreshMarketData();

    const timer = window.setInterval(refreshMarketData, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    symbol,
    interval,
    config.sma_fast,
    config.sma_slow,
    config.atr_len,
    config.rsi_len,
    config.macd_fast,
    config.macd_slow,
    config.macd_signal,
  ]);

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
      setInterval(saved.interval);
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
          <strong>QTrend V5.6.2</strong>
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

          <button
            style={showWatchMarkers ? styles.watchToggleOn : styles.watchToggleOff}
            onClick={() => setShowWatchMarkers((previous) => !previous)}
            title="Historische WATCH-Marker ein- oder ausblenden"
          >
            WATCH ● {markerCounts.WATCH}
          </button>

          <button
            style={showReadyMarkers ? styles.readyToggleOn : styles.watchToggleOff}
            onClick={() => setShowReadyMarkers((previous) => !previous)}
            title="Historische READY-Marker ein- oder ausblenden"
          >
            READY ● {markerCounts.READY}
          </button>

          <button
            style={
              showPermissionMarkers
                ? styles.permissionToggleOn
                : styles.watchToggleOff
            }
            onClick={() =>
              setShowPermissionMarkers((previous) => !previous)
            }
            title="Historische Permission-Marker ein- oder ausblenden"
          >
            PERM ■ {markerCounts.PERMISSION}
          </button>

          <button
            style={showEntryMarkers ? styles.entryToggleOn : styles.watchToggleOff}
            onClick={() => setShowEntryMarkers((previous) => !previous)}
            title="Historische Entry-Marker ein- oder ausblenden"
          >
            ENTRY ▲ {markerCounts.ENTRY}
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

          <div style={styles.validationNote}>
            Historische Ereignis-Edges aus /v5/history:
            grau = WATCH, gelb = READY, blau = PERMISSION,
            grün/rot = ENTRY. READY und PERMISSION können auf derselben Kerze getrennt erscheinen.
          </div>
        </section>

        <aside style={styles.sidePanel}>
          <PositionCard
            config={config}
            snapshot={snapshot}
            onPatch={patchConfig}
            onSave={saveConfig}
            onManual={manual}
          />

          <DecisionCard snapshot={snapshot} />

          <NextStepCard snapshot={snapshot} />

          <EntryMonitorCard snapshot={snapshot} />

          <LivePipelineCard snapshot={snapshot} />

          <EntryScoreCard snapshot={snapshot} />

          <ReasonsCard snapshot={snapshot} />

          <EngineCard snapshot={snapshot} />

          <ParameterCard
            config={config}
            onPatch={patchConfig}
            onSave={saveConfig}
          />
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
    gridTemplateColumns: "minmax(0, 1fr) 380px",
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
    boxSizing: "border-box",
  },
  macdChart: {
    width: "100%",
    minHeight: 220,
    border: "1px solid #243047",
    borderRadius: 10,
    overflow: "hidden",
    boxSizing: "border-box",
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
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
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


  confidenceTrack: {
    height: 8,
    background: "#172033",
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 8,
  },
  confidenceFill: {
    height: "100%",
    background: "linear-gradient(90deg, #2563eb, #22c55e)",
    borderRadius: 999,
  },
  decisionMetaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 6,
  },
  metaCell: {
    background: "#070b16",
    border: "1px solid #243047",
    borderRadius: 8,
    padding: "8px 6px",
    textAlign: "center",
    minWidth: 0,
  },
  metaLabel: {
    display: "block",
    color: "#94a3b8",
    fontSize: 10,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  reasonList: {
    display: "grid",
    gap: 6,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  reasonItem: {
    background: "#07150f",
    border: "1px solid #14532d",
    borderRadius: 7,
    padding: "7px 8px",
    fontSize: 13,
  },
  warningItem: {
    background: "#1a1205",
    border: "1px solid #854d0e",
    borderRadius: 7,
    padding: "7px 8px",
    fontSize: 13,
  },
  emptyNotice: {
    color: "#94a3b8",
    fontSize: 13,
  },
  signalIdText: {
    color: "#94a3b8",
    fontSize: 12,
    wordBreak: "break-all",
  },


  checkList: {
    display: "grid",
    gap: 5,
  },
  checkRow: {
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr) auto",
    gap: 7,
    alignItems: "center",
    padding: "5px 0",
    borderBottom: "1px solid #172033",
    fontSize: 13,
  },
  checkIcon: {
    fontWeight: 900,
    textAlign: "center",
  },
  checkName: {
    minWidth: 0,
  },
  pipeline: {
    display: "grid",
  },
  pipelineStep: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    padding: "8px 10px",
    background: "#070b16",
    border: "1px solid #243047",
    borderRadius: 8,
  },
  pipelineLabel: {
    color: "#94a3b8",
  },
  pipelineArrow: {
    color: "#64748b",
    textAlign: "center",
    lineHeight: 1.2,
    padding: "2px 0",
  },
  entryScoreHero: {
    display: "flex",
    justifyContent: "center",
    alignItems: "baseline",
    gap: 5,
    padding: "5px 0",
    fontSize: 18,
  },
  scoreBreakdown: {
    display: "grid",
    gap: 4,
  },
  scoreBreakdownRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "4px 0",
    borderBottom: "1px solid #172033",
    fontSize: 13,
  },
  missingBox: {
    border: "1px solid",
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
  },
  missingList: {
    margin: "7px 0 0",
    paddingLeft: 18,
    display: "grid",
    gap: 3,
  },
  uiScoreNote: {
    color: "#64748b",
    fontSize: 11,
    marginTop: 8,
    textAlign: "center",
  },


  nextStepBox: {
    display: "grid",
    gap: 6,
    background: "#070b16",
    border: "1px solid #243047",
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
  },
  scoreSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 6,
  },
  scoreSummaryCell: {
    display: "grid",
    gap: 4,
    textAlign: "center",
    background: "#070b16",
    border: "1px solid #243047",
    borderRadius: 8,
    padding: "8px 5px",
    fontSize: 12,
  },
  scoreSectionTitle: {
    margin: "0 0 7px",
    color: "#94a3b8",
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  reasonSectionTitle: {
    margin: "0 0 8px",
    color: "#94a3b8",
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },


  watchToggleOn: {
    background: "#475569",
    color: "#fff",
    border: "1px solid #94a3b8",
    borderRadius: 7,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 800,
  },

  readyToggleOn: {
    background: "#78350f",
    color: "#fbbf24",
    border: "1px solid #f59e0b",
    borderRadius: 7,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 800,
  },
  permissionToggleOn: {
    background: "#1e3a8a",
    color: "#93c5fd",
    border: "1px solid #3b82f6",
    borderRadius: 7,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 800,
  },
  entryToggleOn: {
    background: "#14532d",
    color: "#86efac",
    border: "1px solid #22c55e",
    borderRadius: 7,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 800,
  },

  watchToggleOff: {
    background: "#172033",
    color: "#64748b",
    border: "1px solid #334155",
    borderRadius: 7,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 800,
  },
  validationNote: {
    color: "#64748b",
    fontSize: 11,
    padding: "0 4px 4px",
  },

  activeSymbolDot: {
    color: "#22c55e",
    fontSize: 12,
  },
};
