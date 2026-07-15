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

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = [
  "DE40",
  "US30",
  "US100",
  "UK100",
  "J225",
  "CN50",
  "BTCUSD",
  "ETHUSD",
  "GOLD",
];
const INTERVALS = ["1m", "5m", "15m", "30m", "1h"];

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
type Candidate = {
  candidate_id: string;
  symbol: string;
  interval: string;
  time: number;
  price: number;
  side: "long" | "short";
  strength: number;
  scanner_version: string;
  macd: number;
  macd_signal: number;
  macd_histogram: number;
  index: number;
};
type Annotation = {
  id: number;
  symbol: string;
  interval: string;
  time: number;
  price: number;
  side: string;
  label: string;
  rating: number | null;
  source: string;
  note: string | null;
};
type MlJob = {
  job_id?: string | null;
  state?: "idle" | "queued" | "running" | "succeeded" | "failed";
  phase?: string;
  progress_pct?: number;
  message?: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
};
type TrajectoryPoint = {
  lag: number;
  feature: string;
  good_mean: number;
  bad_mean: number;
  good_median: number;
  bad_median: number;
  standardized_effect: number;
  good_count: number;
  bad_count: number;
};

type TrajectoryProfile = {
  family: string;
  maximum_lag: number;
  point_count: number;
  fold_votes: number;
  league_importance_sum: number;
  good_start: number;
  good_end: number;
  good_change: number;
  good_slope: number;
  good_direction: string;
  bad_start: number;
  bad_end: number;
  bad_change: number;
  bad_slope: number;
  bad_direction: string;
  separation_start: number;
  separation_end: number;
  separation_change: number;
  separation_points: Array<{
    lag: number;
    signed_difference: number;
    absolute_difference: number;
    standardized_effect: number;
    absolute_effect: number;
  }>;
  separation_threshold: number;
  separation_begin_lag: number | null;
  separation_begin_index: number | null;
  maximum_separation_lag: number;
  maximum_separation_effect: number;
  strongest_change_from_lag: number | null;
  strongest_change_to_lag: number | null;
  strongest_change_effect: number;
  separation_stars: number;
  points: TrajectoryPoint[];
};

type TrajectorySummary = {
  family_count: number;
  average_stars: number;
  rounded_stars: number;
  stability_pct: number;
  stable_family_count: number;
  median_separation_begin_lag: number | null;
  earliest_separation_begin_lag: number | null;
  latest_separation_begin_lag: number | null;
  quality: string;
};

type TrainingHistoryItem = {
  job_id: string;
  trained_at: string;
  selection?: { source?: string; symbol?: string; interval?: string; order?: string; limit?: number; signature?: string };
  trained_rows: number;
  labels?: { good?: number; bad?: number };
  auc?: number | null;
  precision_good?: number | null;
  precision_lift?: number | null;
  fold_stability_pct?: number | null;
  typical_separation_begin_lag?: number | null;
  quality?: string;
};

type MlStatus = {
  annotations?: { total: number; good: number; bad: number };
  selected_annotations?: { total: number; good: number; bad: number; source: string; symbol: string; interval: string };
  catalog?: { rows: Array<{symbol:string;interval:string;total:number;good:number;bad:number}>; symbols:string[]; intervals:string[]; archives:Array<{archive_key:string;display_name:string;symbol:string;created_at:string;row_count:number}> };
  trained_rows?: number;
  new_examples?: number;
  model_current?: boolean;
  ml?: {
    training?: {
      trained_at?: string;
      selection?: { source?: string; symbol?: string; interval?: string; order?: string; limit?: number; signature?: string };
      walk_forward_summary?: {
        auc?: number;
        precision_good?: number;
        recall_good?: number;
        balanced_accuracy?: number;
        pr_auc?: number;
        recall_bad?: number;
        base_good_rate?: number;
        precision_lift?: number;
        true_good?: number;
        missed_good?: number;
        true_bad?: number;
        false_good?: number;
      };
      feature_league?: Array<{
        feature: string;
        fold_votes: number;
        average_rank: number;
        average_importance: number;
        profile?: {
          good_count: number;
          bad_count: number;
          good_mean: number;
          bad_mean: number;
          good_median: number;
          bad_median: number;
          good_q25: number;
          good_q75: number;
          bad_q25: number;
          bad_q75: number;
          good_positive_pct: number;
          bad_positive_pct: number;
          difference: number;
          standardized_effect: number;
          direction: string;
          strength: string;
        } | null;
      }>;
      trajectory_profiles?: TrajectoryProfile[];
      trajectory_summary?: TrajectorySummary;
    };
    model_exists?: boolean;
    job?: MlJob;
    history?: TrainingHistoryItem[];
  };
  ml_error?: string;
};

function ema(values: number[], length: number) {
  if (!values.length) return [];
  const a = 2 / (length + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++)
    out.push(a * values[i] + (1 - a) * out[i - 1]);
  return out;
}
function macd(candles: Candle[]) {
  const closes = candles.map((c) => c.close),
    fast = ema(closes, 10),
    slow = ema(closes, 24),
    m = closes.map((_, i) => fast[i] - slow[i]),
    sig = ema(m, 3);
  return candles.map((c, i) => ({
    time: c.time as Time,
    macd: m[i],
    signal: sig[i],
    hist: m[i] - sig[i],
  }));
}
function dt(t: number) {
  return new Date(t * 1000).toLocaleString("de-DE");
}


function formatFeatureValue(value?: number) {
  if (value == null || !Number.isFinite(Number(value))) return "–";
  const number = Number(value);
  const absolute = Math.abs(number);
  if (absolute > 0 && absolute < 0.001) return number.toExponential(2);
  if (absolute >= 1000) return number.toFixed(1);
  if (absolute >= 10) return number.toFixed(2);
  return number.toFixed(3);
}

function shortFeatureName(name: string) {
  return name
    .replace(/^dir_/, "")
    .replace(/_lag_/g, " · Kerze -")
    .replace(/_window_/g, " · Fenster ")
    .replace(/_/g, " ");
}


function TrajectoryChart({
  profile,
}: {
  profile: TrajectoryProfile;
}) {
  const width = 250;
  const height = 104;
  const paddingX = 12;
  const paddingY = 12;

  const values = profile.points.flatMap((point) => [
    Number(point.good_mean),
    Number(point.bad_mean),
  ]);
  const finiteValues = values.filter(Number.isFinite);
  const minimum = finiteValues.length
    ? Math.min(...finiteValues)
    : -1;
  const maximum = finiteValues.length
    ? Math.max(...finiteValues)
    : 1;
  const span = Math.max(maximum - minimum, 1e-9);

  const xFor = (index: number) =>
    paddingX +
    (index / Math.max(1, profile.points.length - 1)) *
      (width - paddingX * 2);

  const yFor = (value: number) =>
    paddingY +
    ((maximum - value) / span) *
      (height - paddingY * 2);

  const line = (
    selector: (point: TrajectoryPoint) => number,
  ) =>
    profile.points
      .map(
        (point, index) =>
          `${xFor(index)},${yFor(selector(point))}`,
      )
      .join(" ");

  const zeroVisible = minimum <= 0 && maximum >= 0;
  const zeroY = yFor(0);

  return (
    <div className="ml-trajectory-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${shortFeatureName(
          profile.family,
        )} Verlauf GOOD gegen BAD`}
      >
        {zeroVisible && (
          <line
            className="ml-trajectory-zero"
            x1={paddingX}
            x2={width - paddingX}
            y1={zeroY}
            y2={zeroY}
          />
        )}
        <polyline
          className="ml-trajectory-good-line"
          points={line((point) => point.good_mean)}
        />
        <polyline
          className="ml-trajectory-bad-line"
          points={line((point) => point.bad_mean)}
        />
        {profile.points.map((point, index) => (
          <g key={point.lag}>
            <circle
              className="ml-trajectory-good-dot"
              cx={xFor(index)}
              cy={yFor(point.good_mean)}
              r="2.3"
            />
            <circle
              className="ml-trajectory-bad-dot"
              cx={xFor(index)}
              cy={yFor(point.bad_mean)}
              r="2.3"
            />
          </g>
        ))}
      </svg>
      <div className="ml-trajectory-axis">
        <span>Kerze −{profile.maximum_lag}</span>
        <span>Entry 0</span>
      </div>
    </div>
  );
}


function SeparationStars({ value }: { value: number }) {
  const safe = Math.max(1, Math.min(5, Math.round(value || 1)));
  return (
    <span
      className="ml-separation-stars"
      aria-label={`${safe} von 5 Sternen`}
      title={`${safe} von 5 Sternen`}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span
          className={index < safe ? "on" : ""}
          key={index}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function SeparationChart({
  profile,
}: {
  profile: TrajectoryProfile;
}) {
  const width = 250;
  const height = 72;
  const paddingX = 12;
  const paddingY = 10;
  const points = profile.separation_points || [];
  const maximum = Math.max(
    profile.separation_threshold || 0,
    ...points.map((point) => Number(point.absolute_effect) || 0),
    0.01,
  );

  const xFor = (index: number) =>
    paddingX +
    (index / Math.max(1, points.length - 1)) *
      (width - paddingX * 2);

  const yFor = (value: number) =>
    paddingY +
    ((maximum - value) / maximum) *
      (height - paddingY * 2);

  const line = points
    .map(
      (point, index) =>
        `${xFor(index)},${yFor(point.absolute_effect)}`,
    )
    .join(" ");

  const thresholdY = yFor(profile.separation_threshold || 0);

  return (
    <div className="ml-separation-chart">
      <div className="ml-separation-chart-title">
        Trennung GOOD/BAD
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${shortFeatureName(
          profile.family,
        )} Trennungsverlauf`}
      >
        <line
          className="ml-separation-threshold"
          x1={paddingX}
          x2={width - paddingX}
          y1={thresholdY}
          y2={thresholdY}
        />
        <polyline
          className="ml-separation-line"
          points={line}
        />
        {points.map((point, index) => (
          <circle
            className={
              point.lag === profile.maximum_separation_lag
                ? "ml-separation-dot maximum"
                : "ml-separation-dot"
            }
            cx={xFor(index)}
            cy={yFor(point.absolute_effect)}
            r={
              point.lag === profile.maximum_separation_lag
                ? "3.1"
                : "2.1"
            }
            key={point.lag}
          />
        ))}
      </svg>
      <div className="ml-trajectory-axis">
        <span>Kerze −{profile.maximum_lag}</span>
        <span>Entry 0</span>
      </div>
    </div>
  );
}

export default function Trainer() {
  const [symbol, setSymbol] = useState("GOLD"),
    [interval, setInterval] = useState("15m");
  const [candles, setCandles] = useState<Candle[]>([]),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [cursor, setCursor] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [mode, setMode] = useState<"auto" | "manual">("auto"),
    [manualSide, setManualSide] = useState<"long" | "short" | "none">("long");
  const [selectedManual, setSelectedManual] = useState<{
      time: number;
      price: number;
    } | null>(null),
    [rating, setRating] = useState(3),
    [note, setNote] = useState("");
  const [mlStatus, setMlStatus] = useState<MlStatus | null>(null),
    [trainingSymbol, setTrainingSymbol] = useState("GOLD"),
    [trainingInterval, setTrainingInterval] = useState("5m"),
    [trainingOrder, setTrainingOrder] = useState<"latest" | "oldest">("latest"),
    [trainingLimit, setTrainingLimit] = useState<500 | 1000 | 1500 | 0>(500),
    [trainingSource, setTrainingSource] = useState("ACTIVE"),
    [archiveBusy, setArchiveBusy] = useState(false),
    [training, setTraining] = useState(false),
    [trainingMessage, setTrainingMessage] = useState("");
  const priceRef = useRef<HTMLDivElement>(null),
    macdRef = useRef<HTMLDivElement>(null),
    chartRef = useRef<IChartApi | null>(null);
  const current = candidates[cursor] || null;
  const currentAnnotation = useMemo(
    () =>
      current
        ? annotations.find(
            (a) =>
              a.time === current.time &&
              a.side === current.side &&
              a.source === "auto_macd",
          )
        : undefined,
    [current, annotations],
  );
  const stats = useMemo(
    () => ({
      good: annotations.filter((a) => a.label === "good").length,
      bad: annotations.filter((a) => a.label === "bad").length,
      unsure: annotations.filter((a) => a.label === "unsure").length,
      manual: annotations.filter((a) => a.source !== "auto_macd").length,
    }),
    [annotations],
  );

  async function loadMlStatus() {
    try {
      const statusUrl = new URL("/trainer/ml/status", BACKEND_BASE);
      statusUrl.searchParams.set("symbol", trainingSymbol);
      statusUrl.searchParams.set("interval", trainingInterval);
      statusUrl.searchParams.set("source", trainingSource);
      const r = await fetch(statusUrl, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j.ok) {
        setMlStatus(j);
        const job = j?.ml?.job as MlJob | undefined;
        const active = job?.state === "queued" || job?.state === "running";
        setTraining(Boolean(active));
        if (job?.state === "failed")
          setTrainingMessage(
            `Training fehlgeschlagen: ${job.error || job.message || "Unbekannter Fehler"}`,
          );
        else if (active)
          setTrainingMessage(
            `${job.message || "Training läuft"} · ${Number(job.progress_pct || 0).toFixed(0)} %`,
          );
        else if (job?.state === "succeeded") {
          const wf = j?.ml?.training?.walk_forward_summary || {};
          setTrainingMessage(
            `Training fertig · AUC ${Number(wf.auc || 0).toFixed(3)} · GOOD-Präzision ${(Number(wf.precision_good || 0) * 100).toFixed(1)} %`,
          );
        }
      } else setTrainingMessage(j.error || "KI-Status nicht verfügbar");
    } catch (e: any) {
      if (training) {
        setTrainingMessage("Statusverbindung kurz unterbrochen – Training wird weiter geprüft …");
      } else {
        setTrainingMessage(e.message || String(e));
      }
    }
  }
  async function retrainMl() {
    if (training) return;
    setTraining(true);
    setTrainingMessage(
      "Datensatz wird synchronisiert und der Trainingsjob gestartet …",
    );
    try {
      const retrainUrl = new URL("/trainer/ml/retrain", BACKEND_BASE);
      retrainUrl.searchParams.set("symbol", trainingSymbol);
      retrainUrl.searchParams.set("interval", trainingInterval);
      retrainUrl.searchParams.set("order", trainingOrder);
      retrainUrl.searchParams.set("limit", String(trainingLimit));
      retrainUrl.searchParams.set("source", trainingSource);
      const r = await fetch(retrainUrl, { method: "POST" });
      const text = await r.text();
      let j: any;
      try {
        j = JSON.parse(text);
      } catch {
        throw new Error(text || `HTTP ${r.status}`);
      }
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setTrainingMessage(
        j.started === false
          ? "Training läuft bereits …"
          : "Training gestartet …",
      );
      await loadMlStatus();
    } catch (e: any) {
      setTrainingMessage("Startantwort unterbrochen – Serverstatus wird geprüft …");
      window.setTimeout(() => { void loadMlStatus(); }, 1500);
    }
  }
  async function archiveGoldAndRestart() {
    if (archiveBusy || training) return;
    const available = Number(mlStatus?.selected_annotations?.total || 0);
    if (!available) {
      setTrainingMessage("Im aktiven GOLD-Bestand gibt es nichts zu archivieren.");
      return;
    }
    const confirmed = window.confirm(
      `Alle bisherigen GOLD-Markierungen (${available}) archivieren und GOLD leer neu starten?\n\nDas Archiv bleibt trainierbar und wird nicht gelöscht.`,
    );
    if (!confirmed) return;

    setArchiveBusy(true);
    setTrainingMessage("GOLD wird archiviert …");
    try {
      const archiveUrl = new URL("/trainer/ml/archive-symbol", BACKEND_BASE);
      archiveUrl.searchParams.set("symbol", "GOLD");
      archiveUrl.searchParams.set("name", "GOLD_ARCHIV_2026_07");
      const response = await fetch(archiveUrl, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setTrainingSource("ACTIVE");
      setTrainingSymbol("GOLD");
      setTrainingMessage(
        `${payload.archive?.display_name || "GOLD-Archiv"} erstellt · ${payload.archive?.row_count || 0} Markierungen gesichert · aktives GOLD ist jetzt leer.`,
      );
      await load();
      await loadMlStatus();
    } catch (error: any) {
      setTrainingMessage(`Archivieren fehlgeschlagen: ${error.message || String(error)}`);
    } finally {
      setArchiveBusy(false);
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const u = new URL("/trainer/candidates", BACKEND_BASE);
      u.searchParams.set("symbol", symbol);
      u.searchParams.set("interval", interval);
      u.searchParams.set("limit", "5000");
      const r = await fetch(u);
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setCandles(j.candles || []);
      setCandidates(j.candidates || []);
      setAnnotations(j.annotations || []);
      setCursor(0);
      setSelectedManual(null);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [symbol, interval]);
  useEffect(() => {
    loadMlStatus();
  }, [trainingSource, trainingSymbol, trainingInterval, trainingOrder, trainingLimit]);
  useEffect(() => {
    const timer = window.setInterval(
      () => {
        loadMlStatus();
      },
      training ? 2500 : 10000,
    );
    return () => window.clearInterval(timer);
  }, [training]);

  useEffect(() => {
    if (!priceRef.current || !macdRef.current) return;
    priceRef.current.innerHTML = "";
    macdRef.current.innerHTML = "";
    const common = {
      layout: { background: { color: "#07111f" }, textColor: "#a9b8ca" },
      grid: {
        vertLines: { color: "#142235" },
        horzLines: { color: "#142235" },
      },
      rightPriceScale: { borderColor: "#26364b" },
      timeScale: {
        borderColor: "#26364b",
        timeVisible: true,
        secondsVisible: false,
      },
    } as const;
    const pc = createChart(priceRef.current, { ...common, height: 520 });
    const cs = pc.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    cs.setData(candles.map((c) => ({ ...c, time: c.time as Time })));
    const mc = createChart(macdRef.current, { ...common, height: 210 });
    const ml = mc.addSeries(LineSeries, { lineWidth: 2 });
    const sl = mc.addSeries(LineSeries, { lineWidth: 2 });
    const hh = mc.addSeries(HistogramSeries, {
      priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
    });
    const md = macd(candles);
    ml.setData(md.map((x) => ({ time: x.time, value: x.macd })));
    sl.setData(md.map((x) => ({ time: x.time, value: x.signal })));
    hh.setData(
      md.map((x) => ({
        time: x.time,
        value: x.hist,
        color: x.hist >= 0 ? "#22c55e88" : "#ef444488",
      })),
    );
    const markers: any[] = [];
    for (const a of annotations) {
      markers.push({
        time: a.time as Time,
        position: a.side === "short" ? "aboveBar" : "belowBar",
        shape: a.side === "short" ? "arrowDown" : "arrowUp",
        color:
          a.label === "good"
            ? "#22c55e"
            : a.label === "bad"
              ? "#ef4444"
              : a.label === "no_trade"
                ? "#94a3b8"
                : "#f59e0b",
        text:
          a.source === "auto_macd"
            ? a.label.toUpperCase()
            : `M ${a.label.toUpperCase()}`,
      });
    }
    if (current)
      markers.push({
        time: current.time as Time,
        position: current.side === "short" ? "aboveBar" : "belowBar",
        shape: current.side === "short" ? "arrowDown" : "arrowUp",
        color: "#eab308",
        text: "KANDIDAT",
      });
    if (selectedManual)
      markers.push({
        time: selectedManual.time as Time,
        position: manualSide === "short" ? "aboveBar" : "belowBar",
        shape: manualSide === "short" ? "arrowDown" : "arrowUp",
        color: "#38bdf8",
        text: "MANUELL",
      });
    createSeriesMarkers(
      cs,
      markers.sort((a, b) => Number(a.time) - Number(b.time)),
    );
    pc.timeScale().fitContent();
    mc.timeScale().fitContent();
    pc.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r) mc.timeScale().setVisibleLogicalRange(r);
    });
    pc.subscribeClick((p) => {
      if (mode !== "manual" || !p.time) return;
      const d = p.seriesData.get(cs) as any;
      if (d && Number.isFinite(d.close))
        setSelectedManual({ time: Number(p.time), price: Number(d.close) });
    });
    chartRef.current = pc;
    return () => {
      pc.remove();
      mc.remove();
      chartRef.current = null;
    };
  }, [
    candles,
    annotations,
    current?.time,
    mode,
    manualSide,
    selectedManual?.time,
  ]);

  useEffect(() => {
    if (!current || !chartRef.current) return;
    const i = candles.findIndex((c) => c.time === current.time);
    if (i >= 0)
      chartRef.current
        .timeScale()
        .setVisibleLogicalRange({
          from: Math.max(0, i - 45),
          to: Math.min(candles.length - 1, i + 16),
        });
  }, [cursor, current?.time, candles]);

  async function save(label: "good" | "bad" | "unsure" | "no_trade") {
    const point =
      mode === "auto" && current
        ? {
            time: current.time,
            price: current.price,
            side: current.side,
            source: "auto_macd",
            scanner_version: current.scanner_version,
          }
        : selectedManual
          ? {
              time: selectedManual.time,
              price: selectedManual.price,
              side: manualSide,
              source: manualSide === "none" ? "manual_no_trade" : "manual",
              scanner_version: null,
            }
          : null;
    if (!point) {
      setError("Bitte zuerst einen Kandidaten oder eine Kerze wählen.");
      return;
    }
    const r = await fetch(`${BACKEND_BASE}/trainer/annotation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, interval, ...point, label, rating, note }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      setError(j.error || "Speichern fehlgeschlagen");
      return;
    }
    setAnnotations((prev) => [
      ...prev.filter(
        (a) =>
          !(
            a.time === j.annotation.time &&
            a.side === j.annotation.side &&
            a.source === j.annotation.source
          ),
      ),
      j.annotation,
    ]);
    setNote("");
    loadMlStatus();
    if (mode === "auto" && cursor < candidates.length - 1)
      setCursor((x) => x + 1);
  }
  function move(d: number) {
    setCursor((x) => Math.max(0, Math.min(candidates.length - 1, x + d)));
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.tagName === "INPUT" ||
        (e.target as HTMLElement)?.tagName === "TEXTAREA"
      )
        return;
      if (e.key === "ArrowRight") move(1);
      if (e.key === "ArrowLeft") move(-1);
      if (e.key.toLowerCase() === "g") save("good");
      if (e.key.toLowerCase() === "s") save("bad");
      if (e.key.toLowerCase() === "u") save("unsure");
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  });

  return (
    <div className="trainer-shell">
      <header className="trainer-header">
        <div>
          <b>QTrend Trainer</b>
          <span>MACD-Knicke zeigen · bewerten · eigene Entries setzen</span>
        </div>
        <div className="trainer-header-actions">
          <a href="/">Cockpit</a>
          <a
            href={`${BACKEND_BASE}/trainer/export?format=json`}
            target="_blank"
          >
            JSON
          </a>
          <a href={`${BACKEND_BASE}/trainer/export?format=csv`} target="_blank">
            CSV
          </a>
        </div>
      </header>
      <div className="trainer-toolbar">
        <label>
          Instrument
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {SYMBOLS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          TF
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          >
            {INTERVALS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <button onClick={load}>Neu laden</button>
        <div className="mode-switch">
          <button
            className={mode === "auto" ? "active" : ""}
            onClick={() => setMode("auto")}
          >
            AUTO-KANDIDAT
          </button>
          <button
            className={mode === "manual" ? "active" : ""}
            onClick={() => setMode("manual")}
          >
            MANUELL SETZEN
          </button>
        </div>
        <div className="trainer-stats">
          <span>Gut {stats.good}</span>
          <span>Schlecht {stats.bad}</span>
          <span>Unsicher {stats.unsure}</span>
          <span>Manuell {stats.manual}</span>
        </div>
      </div>
      <main className="trainer-main">
        <section className="trainer-charts">
          <div ref={priceRef} />
          <div ref={macdRef} />
          {loading && (
            <div className="trainer-loading">Lade Kerzen und Kandidaten …</div>
          )}
        </section>
        <aside className="trainer-panel">
          {mode === "auto" ? (
            <>
              <div className="eyebrow">AUTO MACD-KNICK</div>
              {current ? (
                <>
                  <h2 className={current.side}>{current.side.toUpperCase()}</h2>
                  <dl>
                    <dt>Zeit</dt>
                    <dd>{dt(current.time)}</dd>
                    <dt>Preis</dt>
                    <dd>{current.price}</dd>
                    <dt>Kandidat</dt>
                    <dd>
                      {cursor + 1} / {candidates.length}
                    </dd>
                    <dt>Histogramm</dt>
                    <dd>{current.macd_histogram.toFixed(5)}</dd>
                  </dl>
                  {currentAnnotation && (
                    <div className={`saved ${currentAnnotation.label}`}>
                      Gespeichert: {currentAnnotation.label.toUpperCase()}
                    </div>
                  )}
                </>
              ) : (
                <p>Keine Kandidaten vorhanden.</p>
              )}
              <div className="nav-row">
                <button onClick={() => move(-1)}>← Vorheriger</button>
                <button onClick={() => move(1)}>Nächster →</button>
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow">MANUELLER MARKER</div>
              <p>
                Klicke beziehungsweise bewege das Fadenkreuz auf die gewünschte
                Kerze.
              </p>
              <div className="side-row">
                <button
                  className={manualSide === "long" ? "active long" : ""}
                  onClick={() => setManualSide("long")}
                >
                  LONG
                </button>
                <button
                  className={manualSide === "short" ? "active short" : ""}
                  onClick={() => setManualSide("short")}
                >
                  SHORT
                </button>
                <button
                  className={manualSide === "none" ? "active" : ""}
                  onClick={() => setManualSide("none")}
                >
                  NO TRADE
                </button>
              </div>
              {selectedManual ? (
                <dl>
                  <dt>Zeit</dt>
                  <dd>{dt(selectedManual.time)}</dd>
                  <dt>Preis</dt>
                  <dd>{selectedManual.price}</dd>
                </dl>
              ) : (
                <div className="manual-empty">Noch keine Kerze gewählt</div>
              )}
            </>
          )}
          <div className="rating">
            <span>Stärke</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                className={rating >= n ? "on" : ""}
                key={n}
                onClick={() => setRating(n)}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            placeholder="Notiz optional, z. B. sauberer Knick / zu spät / Seitwärts"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="judge">
            <button className="good" onClick={() => save("good")}>
              G · GUT
            </button>
            <button className="bad" onClick={() => save("bad")}>
              S · SCHLECHT
            </button>
            <button className="unsure" onClick={() => save("unsure")}>
              U · UNSICHER
            </button>
            {mode === "manual" && (
              <button onClick={() => save("no_trade")}>NO TRADE</button>
            )}
          </div>
          <div className="ml-training-card">
            <div className="ml-training-head">
              <div>
                <strong>Trainer-KI</strong>
                <span>
                  {training
                    ? "Training läuft"
                    : mlStatus?.model_current
                      ? "Modell aktuell"
                      : "Modell veraltet"}
                </span>
              </div>
              <span
                className={
                  training
                    ? "ml-dot running"
                    : mlStatus?.model_current
                      ? "ml-dot current"
                      : "ml-dot stale"
                }
              />
            </div>
            <div className="ml-training-grid">
              <span>Datensatz</span>
              <b>{mlStatus?.annotations?.total ?? "–"}</b>
              <span>GOOD / BAD</span>
              <b>
                {mlStatus?.annotations?.good ?? "–"} /{" "}
                {mlStatus?.annotations?.bad ?? "–"}
              </b>
              <span>Trainiert</span>
              <b>{mlStatus?.trained_rows ?? 0}</b>
              <span>Neu</span>
              <b>{mlStatus?.new_examples ?? 0}</b>
              <span>Quelle</span>
              <b>{trainingSource === "ACTIVE" ? "AKTIV" : trainingSource}</b>
              <span>Auswahl</span>
              <b>{trainingSymbol} · {trainingInterval}</b>
              <span>Verfügbar</span>
              <b>{mlStatus?.selected_annotations?.total ?? "–"}</b>
              <span>GOOD / BAD Auswahl</span>
              <b>{mlStatus?.selected_annotations?.good ?? "–"} / {mlStatus?.selected_annotations?.bad ?? "–"}</b>
              <span>Trainingsblock</span>
              <b>{trainingLimit === 0 ? "ALLE" : trainingLimit}</b>
            </div>
            {!training && (
              <>
              <div className="ml-source-controls">
                <label>
                  <span>Datenbestand</span>
                  <select
                    value={trainingSource}
                    onChange={(e) => {
                      const value = e.target.value;
                      setTrainingSource(value);
                      if (value !== "ACTIVE") {
                        const archive = (mlStatus?.catalog?.archives || []).find(
                          (item) => item.archive_key === value,
                        );
                        if (archive?.symbol) setTrainingSymbol(archive.symbol);
                      }
                    }}
                  >
                    <option value="ACTIVE">AKTIV</option>
                    {(mlStatus?.catalog?.archives || []).map((item) => (
                      <option value={item.archive_key} key={item.archive_key}>
                        {item.display_name} ({item.row_count})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Instrument</span>
                  <select value={trainingSymbol} onChange={(e) => setTrainingSymbol(e.target.value)}>
                    <option value="ALL">ALLE</option>
                    {SYMBOLS.map((item) => (
                      <option value={item} key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Timeframe</span>
                  <select value={trainingInterval} onChange={(e) => setTrainingInterval(e.target.value)}>
                    <option value="ALL">ALLE</option>
                    {(mlStatus?.catalog?.intervals || INTERVALS).map((item) => <option value={item} key={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  <span>Zeitraum</span>
                  <select value={trainingOrder} onChange={(e) => setTrainingOrder(e.target.value as "latest" | "oldest")}>
                    <option value="latest">neueste zuerst</option>
                    <option value="oldest">älteste zuerst</option>
                  </select>
                </label>
                <label>
                  <span>Beispiele</span>
                  <select value={trainingLimit} onChange={(e) => setTrainingLimit(Number(e.target.value) as 500 | 1000 | 1500 | 0)}>
                    <option value={500}>500</option>
                    <option value={1000}>1000</option>
                    <option value={1500}>1500</option>
                    <option value={0}>ALLE</option>
                  </select>
                </label>
              </div>
              {trainingSource === "ACTIVE" &&
                trainingSymbol === "GOLD" &&
                Number(mlStatus?.selected_annotations?.total || 0) > 0 && (
                  <button
                    className="ml-archive-button"
                    disabled={archiveBusy}
                    onClick={archiveGoldAndRestart}
                  >
                    {archiveBusy
                      ? "GOLD WIRD ARCHIVIERT …"
                      : "GOLD ALT ARCHIVIEREN · GOLD LEER NEU STARTEN"}
                  </button>
                )}
              </>
            )}
            {training ? (
              <div className="ml-progress">
                <div
                  style={{
                    width: `${Math.max(2, Number(mlStatus?.ml?.job?.progress_pct || 2))}%`,
                  }}
                />
                <span>
                  {mlStatus?.ml?.job?.phase || "KI wird trainiert..."}
                </span>
              </div>
            ) : (
              <button
                className="ml-train-button"
                disabled={!mlStatus?.selected_annotations?.total}
                onClick={retrainMl}
              >
                KI NEU TRAINIEREN
              </button>
            )}
            {!training && trainingMessage && (
              <div
                className={
                  mlStatus?.ml?.job?.state === "failed"
                    ? "ml-training-message failed"
                    : "ml-training-message"
                }
              >
                {trainingMessage}
              </div>
            )}
            {!training && mlStatus?.ml?.training?.walk_forward_summary && (
              <div className="ml-analysis">
                <div className="ml-analysis-title">
                  KI-Auswertung · {mlStatus.ml?.training?.selection?.source || "ACTIVE"} · {mlStatus.ml?.training?.selection?.symbol || "ALLE"} · {mlStatus.ml?.training?.selection?.interval || "ALLE"}
                </div>
                {(() => {
                  const wf = mlStatus.ml?.training?.walk_forward_summary || {};
                  const features = mlStatus.ml?.training?.feature_league || [];
                  const pct = (value?: number) =>
                    value == null ? "–" : `${(Number(value) * 100).toFixed(1)} %`;
                  return (
                    <>
                      <div className="ml-analysis-grid">
                        <span>AUC</span>
                        <b>{wf.auc == null ? "–" : Number(wf.auc).toFixed(3)}</b>
                        <span>PR-AUC</span>
                        <b>{wf.pr_auc == null ? "–" : Number(wf.pr_auc).toFixed(3)}</b>
                        <span>GOOD-Präzision</span>
                        <b>{pct(wf.precision_good)}</b>
                        <span>GOOD erkannt</span>
                        <b>{pct(wf.recall_good)}</b>
                        <span>BAD erkannt</span>
                        <b>{pct(wf.recall_bad)}</b>
                        <span>Treffer-Lift</span>
                        <b>
                          {wf.precision_lift == null
                            ? "–"
                            : `${Number(wf.precision_lift).toFixed(2)}×`}
                        </b>
                      </div>
                      <div className="ml-confusion">
                        <span>GOOD richtig <b>{wf.true_good ?? "–"}</b></span>
                        <span>GOOD verpasst <b>{wf.missed_good ?? "–"}</b></span>
                        <span>BAD richtig <b>{wf.true_bad ?? "–"}</b></span>
                        <span>BAD erlaubt <b>{wf.false_good ?? "–"}</b></span>
                      </div>
                      {(mlStatus.ml?.training?.trajectory_profiles || []).length > 0 && (
                        <details className="ml-trajectories" open>
                          <summary>GOOD/BAD-Verläufe</summary>
                          {(mlStatus.ml?.training?.trajectory_profiles || [])
                            .slice(0, 6)
                            .map((profile) => (
                              <details
                                className="ml-trajectory-item"
                                key={profile.family}
                              >
                                <summary>
                                  <span>
                                    {shortFeatureName(profile.family)}
                                  </span>
                                  <b>{profile.fold_votes} / 3</b>
                                </summary>
                                <div className="ml-trajectory-body">
                                  <div className="ml-trajectory-legend">
                                    <span className="good">GOOD</span>
                                    <span className="bad">BAD</span>
                                  </div>
                                  <TrajectoryChart profile={profile} />
                                  <SeparationChart profile={profile} />
                                  <div className="ml-separation-summary">
                                    <div>
                                      <span>Trennstärke</span>
                                      <SeparationStars
                                        value={profile.separation_stars}
                                      />
                                    </div>
                                    <div>
                                      <span>Trennung beginnt</span>
                                      <b>
                                        {profile.separation_begin_lag == null
                                          ? "nicht eindeutig"
                                          : `Kerze −${profile.separation_begin_lag}`}
                                      </b>
                                    </div>
                                    <div>
                                      <span>Größte Trennung</span>
                                      <b>
                                        Kerze −{profile.maximum_separation_lag}
                                      </b>
                                    </div>
                                    <div>
                                      <span>Stärkste Zunahme</span>
                                      <b>
                                        {profile.strongest_change_from_lag == null
                                          ? "–"
                                          : `−${profile.strongest_change_from_lag} → −${profile.strongest_change_to_lag}`}
                                      </b>
                                    </div>
                                  </div>
                                  <div className="ml-trajectory-grid">
                                    <span></span>
                                    <b>GOOD</b>
                                    <b>BAD</b>
                                    <span>
                                      Kerze −{profile.maximum_lag}
                                    </span>
                                    <b>
                                      {formatFeatureValue(
                                        profile.good_start,
                                      )}
                                    </b>
                                    <b>
                                      {formatFeatureValue(
                                        profile.bad_start,
                                      )}
                                    </b>
                                    <span>Entry 0</span>
                                    <b>
                                      {formatFeatureValue(
                                        profile.good_end,
                                      )}
                                    </b>
                                    <b>
                                      {formatFeatureValue(
                                        profile.bad_end,
                                      )}
                                    </b>
                                    <span>Veränderung</span>
                                    <b>
                                      {formatFeatureValue(
                                        profile.good_change,
                                      )}
                                    </b>
                                    <b>
                                      {formatFeatureValue(
                                        profile.bad_change,
                                      )}
                                    </b>
                                    <span>Richtung</span>
                                    <b>{profile.good_direction}</b>
                                    <b>{profile.bad_direction}</b>
                                  </div>
                                  <div className="ml-trajectory-note">
                                    Abstand GOOD/BAD am Entry:{" "}
                                    <b>
                                      {formatFeatureValue(
                                        profile.separation_end,
                                      )}
                                    </b>
                                    {profile.separation_change > 0
                                      ? " · Trennung wird größer"
                                      : profile.separation_change < 0
                                        ? " · Trennung wird kleiner"
                                        : " · Trennung bleibt ähnlich"}
                                  </div>
                                </div>
                              </details>
                            ))}
                        </details>
                      )}
                      {mlStatus.ml?.training?.trajectory_summary && (
                        <div className="ml-analysis-final">
                          {(() => {
                            const trajectory =
                              mlStatus.ml?.training?.trajectory_summary;
                            if (!trajectory) {
                              return null;
                            }
                            const begin =
                              trajectory.median_separation_begin_lag;
                            return (
                              <>
                                <div className="ml-analysis-final-head">
                                  <span>Analyse-Abschluss</span>
                                  <SeparationStars
                                    value={trajectory.average_stars}
                                  />
                                </div>
                                <div className="ml-analysis-final-grid">
                                  <span>Qualität</span>
                                  <b>{trajectory.quality}</b>
                                  <span>Stabile Merkmale</span>
                                  <b>
                                    {trajectory.stable_family_count} /{" "}
                                    {trajectory.family_count}
                                  </b>
                                  <span>Fold-Stabilität</span>
                                  <b>
                                    {Number(
                                      trajectory.stability_pct || 0,
                                    ).toFixed(0)} %
                                  </b>
                                  <span>Typischer Trennungsbeginn</span>
                                  <b>
                                    {begin == null
                                      ? "nicht eindeutig"
                                      : `Kerze −${Number(begin).toFixed(
                                          begin % 1 === 0 ? 0 : 1,
                                        )}`}
                                  </b>
                                </div>
                                <div className="ml-analysis-final-note">
                                  GOOD und BAD beginnen sich bei den
                                  wichtigsten Merkmalen typischerweise{" "}
                                  {begin == null
                                    ? "noch nicht eindeutig"
                                    : `etwa ${Math.abs(
                                        Number(begin),
                                      )} Kerzen vor dem Entry`}{" "}
                                  zu unterscheiden.
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}
                      {features.length > 0 && (
                        <details className="ml-features">
                          <summary>Wichtigste Merkmale</summary>
                          {features.slice(0, 8).map((item) => {
                            const profile = item.profile;
                            return (
                              <details className="ml-feature-item" key={item.feature}>
                                <summary>
                                  <span>{shortFeatureName(item.feature)}</span>
                                  <b>{item.fold_votes} / 3</b>
                                </summary>
                                {profile ? (
                                  <div className="ml-feature-profile">
                                    <div className="ml-profile-direction">
                                      <strong>{profile.direction}</strong>
                                      <span>
                                        Trennung {profile.strength} · Effekt {Math.abs(profile.standardized_effect).toFixed(2)}
                                      </span>
                                    </div>
                                    <div className="ml-profile-table">
                                      <span></span><b>GOOD</b><b>BAD</b>
                                      <span>Ø Wert</span>
                                      <b>{formatFeatureValue(profile.good_mean)}</b>
                                      <b>{formatFeatureValue(profile.bad_mean)}</b>
                                      <span>Median</span>
                                      <b>{formatFeatureValue(profile.good_median)}</b>
                                      <b>{formatFeatureValue(profile.bad_median)}</b>
                                      <span>Mittlere 50 %</span>
                                      <b>{formatFeatureValue(profile.good_q25)} – {formatFeatureValue(profile.good_q75)}</b>
                                      <b>{formatFeatureValue(profile.bad_q25)} – {formatFeatureValue(profile.bad_q75)}</b>
                                      <span>Positiv</span>
                                      <b>{(profile.good_positive_pct * 100).toFixed(1)} %</b>
                                      <b>{(profile.bad_positive_pct * 100).toFixed(1)} %</b>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="ml-profile-empty">Für dieses Merkmal fehlen Vergleichswerte.</div>
                                )}
                              </details>
                            );
                          })}
                        </details>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
            {!training && (mlStatus?.ml?.history || []).length > 0 && (
              <details className="ml-history">
                <summary>Trainingshistorie</summary>
                {(mlStatus?.ml?.history || []).slice(0, 10).map((item) => (
                  <div className="ml-history-row" key={item.job_id}>
                    <div>
                      <b>{item.selection?.source && item.selection.source !== "ACTIVE" ? `${item.selection.source} · ` : ""}{item.selection?.symbol || "ALL"} · {item.selection?.interval || "ALL"}</b>
                      <span>{item.selection?.order === "oldest" ? "älteste" : "neueste"} {item.trained_rows} · {new Date(item.trained_at).toLocaleString("de-DE")}</span>
                    </div>
                    <div>
                      <b>AUC {item.auc == null ? "–" : Number(item.auc).toFixed(3)}</b>
                      <span>Lift {item.precision_lift == null ? "–" : `${Number(item.precision_lift).toFixed(2)}×`}</span>
                    </div>
                  </div>
                ))}
              </details>
            )}
            {mlStatus?.ml_error && (
              <div className="trainer-error">ML-Dienst: {mlStatus.ml_error}</div>
            )}
          </div>
          {error && <div className="trainer-error">{error}</div>}
          <small>Tastatur: G / S / U · Pfeile für Kandidaten</small>
        </aside>
      </main>
    </div>
  );
}
