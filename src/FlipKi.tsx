import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
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
  scanner_version?: string;
  features?: Record<string, number>;
};

type StrategyTrade = {
  side: "long" | "short";
  entry_time: number;
  entry_price: number;
  exit_time: number;
  exit_price: number;
  holding_bars: number;
  gross_points: number;
  costs_points: number;
  net_points: number;
  exit_reason: string;
};

type FlipDecision = {
  candidate_id: string;
  symbol: string;
  interval: string;
  time: number;
  price: number;
  candidate_side: "long" | "short";
  current_side: "long" | "short";
  label: "flip" | "hold";
  horizon_time: number;
  horizon_price: number;
  atr: number;
  hold_points: number;
  flip_net_points: number;
  flip_advantage_points: number;
  flip_advantage_atr: number;
  bars_since_flip: number;
  position_open_atr: number;
  position_mfe_atr: number;
  position_mae_atr: number;
  position_drawdown_from_mfe_atr: number;
  feature_core_score?: number;
  feature_snapshot?: Record<string, any>;
};

type FlipFeatureStatistic = {
  feature: string;
  flip_count: number;
  hold_count: number;
  flip_mean: number;
  hold_mean: number;
  flip_median: number;
  hold_median: number;
  difference: number;
  standardized_effect: number;
  absolute_effect: number;
  direction: string;
  strength: string;
};

type FlipFeatureStatistics = {
  architecture: string;
  row_count: number;
  labels: { flip: number; hold: number };
  feature_count: number;
  top_features: FlipFeatureStatistic[];
  features: FlipFeatureStatistic[];
};

type FlipMetrics = {
  trade_count: number;
  completed_trades: number;
  net_points: number;
  gross_profit: number;
  gross_loss: number;
  profit_factor: number | null;
  wins: number;
  losses: number;
  win_rate_pct: number;
  max_drawdown_points: number;
  average_trade_points: number;
  average_holding_bars: number;
  flip_count: number;
  hold_count: number;
};

type MatrixRow = {
  cost_atr: number;
  minimum_advantage_atr: number;
  decision_count: number;
  flip_count: number;
  hold_count: number;
  score: number;
  score_components?: {
    pf: number;
    net: number;
    drawdown: number;
    winrate: number;
  };
  metrics: FlipMetrics;
};

type OptimizerResponse = {
  ok: boolean;
  symbol: string;
  interval: string;
  candidate_count: number;
  best: MatrixRow | null;
  matrix: MatrixRow[];
};

type FlipLabResponse = {
  ok: boolean;
  symbol: string;
  interval: string;
  candidate_count: number;
  decision_count: number;
  labels: { flip: number; hold: number };
  average_absolute_advantage_atr: number;
  settings: {
    cost_atr: number;
    minimum_advantage_atr: number;
    comparison_horizon: string;
    path_mode: string;
  };
  decisions: FlipDecision[];
  metrics?: FlipMetrics;
  strategy_path?: {
    trades: StrategyTrade[];
    metrics: FlipMetrics;
  };
  feature_statistics?: FlipFeatureStatistics;
  feature_dataset?: {
    architecture: string;
    row_count: number;
    labels: { flip: number; hold: number };
  };
  dataset?: { row_count: number };
};

function formatTime(time: number) {
  return new Date(time * 1000).toLocaleString("de-DE");
}

function signed(value: number, digits = 1) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
}


function buildFineValues(
  start: number,
  step: number,
  count: number,
  digits: number,
) {
  return Array.from({ length: count }, (_, index) =>
    Number((start + index * step).toFixed(digits)),
  );
}


function featureLabel(key: string) {
  const labels: Record<string, string> = {
    macd_histogram_atr: "Histogramm ATR",
    macd_slope_atr: "MACD Slope ATR",
    fast_distance_atr: "Fast Distance ATR",
    slow_distance_atr: "Slow Distance ATR",
    return_bps: "Return BPS",
    body_atr: "Body ATR",
    range_atr: "Range ATR",
    trend_credit: "Trend Credit",
    momentum: "Momentum",
    energy: "Energy",
    structure: "Structure",
    macd_histogram_speed: "Histogramm Speed",
  };
  return labels[key] || key;
}


function effectStars(value: number) {
  const effect = Math.abs(Number(value || 0));
  if (effect >= 0.8) return "★★★★★";
  if (effect >= 0.5) return "★★★★☆";
  if (effect >= 0.3) return "★★★☆☆";
  if (effect >= 0.15) return "★★☆☆☆";
  return "★☆☆☆☆";
}

function phaseVisual(trade: StrategyTrade) {
  const result = Number(trade.net_points || 0);
  const magnitude = Math.min(1, Math.abs(result) / 250);
  const alpha = 0.30 + magnitude * 0.62;

  if (result > 1) {
    return {
      background: `rgba(22, 163, 74, ${alpha})`,
      borderColor: "rgba(74, 222, 128, .85)",
    };
  }

  if (result < -1) {
    return {
      background: `rgba(220, 38, 38, ${alpha})`,
      borderColor: "rgba(248, 113, 113, .85)",
    };
  }

  return {
    background: "rgba(245, 158, 11, .55)",
    borderColor: "rgba(251, 191, 36, .85)",
  };
}

export default function FlipKi() {
  const [symbol, setSymbol] = useState("US30");
  const [interval, setInterval] = useState("15m");
  const [costAtr, setCostAtr] = useState(0.05);
  const [minimumAdvantageAtr, setMinimumAdvantageAtr] = useState(0.15);
  const [showHold, setShowHold] = useState(true);
  const [showPhases, setShowPhases] = useState(true);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [decisions, setDecisions] = useState<FlipDecision[]>([]);
  const [summary, setSummary] = useState<FlipLabResponse | null>(null);
  const [optimizer, setOptimizer] = useState<OptimizerResponse | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [selected, setSelected] = useState<FlipDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const chartHost = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const flipCount = useMemo(
    () => decisions.filter((item) => item.label === "flip").length,
    [decisions],
  );

  const positionPhases = useMemo(() => {
    const trades = summary?.strategy_path?.trades || [];
    if (!trades.length) return [];

    const startTime = trades[0].entry_time;
    const endTime = trades[trades.length - 1].exit_time;
    const total = Math.max(1, endTime - startTime);

    return trades.map((trade, index) => {
      const left = ((trade.entry_time - startTime) / total) * 100;
      const width = Math.max(
        0.35,
        ((trade.exit_time - trade.entry_time) / total) * 100,
      );

      return {
        ...trade,
        index,
        left,
        width,
      };
    });
  }, [summary]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const candidateUrl = new URL("/trainer/candidates", BACKEND_BASE);
      candidateUrl.searchParams.set("symbol", symbol);
      candidateUrl.searchParams.set("interval", interval);
      candidateUrl.searchParams.set("limit", "2500");
      const candidateResponse = await fetch(candidateUrl, {
        cache: "no-store",
      });
      const candidatePayload = await candidateResponse.json();
      if (!candidateResponse.ok || !candidatePayload.ok) {
        throw new Error(
          candidatePayload.error || `HTTP ${candidateResponse.status}`,
        );
      }

      const nextCandles = (candidatePayload.candles || []) as Candle[];
      const candidates = (
        (candidatePayload.candidates || []) as Candidate[]
      ).slice(-1200);
      setCandles(nextCandles);

      const labResponse = await fetch(
        `${BACKEND_BASE}/trainer/flip-lab/evaluate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            interval,
            candidates,
            cost_atr: costAtr,
            minimum_advantage_atr: minimumAdvantageAtr,
          }),
        },
      );
      const text = await labResponse.text();
      let payload: FlipLabResponse & { error?: string };
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(text || `HTTP ${labResponse.status}`);
      }
      if (!labResponse.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${labResponse.status}`);
      }

      const nextDecisions = [...(payload.decisions || [])].sort(
        (left, right) => left.time - right.time,
      );
      setDecisions(nextDecisions);
      setSummary(payload);
      setSelected(nextDecisions[nextDecisions.length - 1] || null);
    } catch (exception: any) {
      setDecisions([]);
      setSummary(null);
      setSelected(null);
      setError(exception.message || String(exception));
    } finally {
      setLoading(false);
    }
  }

  async function optimize() {
    setOptimizing(true);
    setError("");
    try {
      const sourceUrl = new URL(
        "/trainer/flip-lab/strategy-entries",
        BACKEND_BASE,
      );
      sourceUrl.searchParams.set("symbol", symbol);
      sourceUrl.searchParams.set("interval", interval);
      sourceUrl.searchParams.set("limit", "2500");

      const sourceResponse = await fetch(sourceUrl, {
        cache: "no-store",
      });
      const sourcePayload = await sourceResponse.json();

      if (!sourceResponse.ok || !sourcePayload.ok) {
        throw new Error(
          sourcePayload.info ||
          sourcePayload.error ||
          `HTTP ${sourceResponse.status}`,
        );
      }

      const candidates = (
        (sourcePayload.candidates || []) as Candidate[]
      ).slice(-1200);

      const response = await fetch(
        `${BACKEND_BASE}/trainer/flip-lab/optimize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            interval,
            candidates,
            cost_values: buildFineValues(0.02, 0.015, 20, 3),
            minimum_advantage_values: buildFineValues(
              0.05,
              0.05,
              20,
              2,
            ),
          }),
        },
      );

      const payload = (await response.json()) as OptimizerResponse & {
        error?: string;
        info?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.info ||
          payload.error ||
          `HTTP ${response.status}`,
        );
      }

      setOptimizer(payload);
    } catch (exception: any) {
      setOptimizer(null);
      setError(exception.message || String(exception));
    } finally {
      setOptimizing(false);
    }
  }

  useEffect(() => {
    void load();
  }, [symbol, interval]);

  useEffect(() => {
    if (!chartHost.current) return;
    chartHost.current.innerHTML = "";
    const chart = createChart(chartHost.current, {
      height: 590,
      layout: {
        background: { color: "#07111f" },
        textColor: "#a9b8ca",
      },
      grid: {
        vertLines: { color: "#142235" },
        horzLines: { color: "#142235" },
      },
      rightPriceScale: { borderColor: "#26364b" },
      timeScale: {
        borderColor: "#26364b",
        timeVisible: true,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    series.setData(
      candles.map((candle) => ({
        ...candle,
        time: candle.time as Time,
      })),
    );
    createSeriesMarkers(
      series,
      decisions
        .filter((item) => showHold || item.label === "flip")
        .map((item) => ({
          time: item.time as Time,
          position:
            item.candidate_side === "short" ? "aboveBar" : "belowBar",
          shape:
            item.candidate_side === "short" ? "arrowDown" : "arrowUp",
          color: item.label === "flip" ? "#22c55e" : "#f59e0b",
          text:
            item.label === "flip"
              ? `FLIP ${signed(item.flip_advantage_atr, 2)} ATR`
              : `HOLD ${signed(-item.flip_advantage_atr, 2)} ATR`,
        }))
        .sort((left, right) => Number(left.time) - Number(right.time)) as any,
    );
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, decisions, showHold]);

  function choose(item: FlipDecision) {
    setSelected(item);
    const index = candles.findIndex((candle) => candle.time === item.time);
    if (index >= 0) {
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(0, index - 45),
        to: Math.min(candles.length - 1, index + 20),
      });
    }
  }

  return (
    <div className="flip-ki-page">
      <header className="flip-ki-header">
        <div>
          <b>QTrend Flip-KI Lab</b>
          <span>
            Automatische FLIP/HOLD-Labels · keine Orders
          </span>
        </div>
        <div className="flip-ki-controls">
          <select
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
          >
            {SYMBOLS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select
            value={interval}
            onChange={(event) => setInterval(event.target.value)}
          >
            {INTERVALS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <label>
            <span>Kosten ATR</span>
            <input
              type="number"
              min="0"
              max="2"
              step="0.01"
              value={costAtr}
              onChange={(event) =>
                setCostAtr(Number(event.target.value))
              }
            />
          </label>
          <label>
            <span>Min. Vorteil ATR</span>
            <input
              type="number"
              min="0"
              max="5"
              step="0.05"
              value={minimumAdvantageAtr}
              onChange={(event) =>
                setMinimumAdvantageAtr(Number(event.target.value))
              }
            />
          </label>
          <label className="flip-hold-toggle">
            <input
              type="checkbox"
              checked={showHold}
              onChange={(event) =>
                setShowHold(event.target.checked)
              }
            />
            <span>HOLD anzeigen</span>
          </label>
          <label className="flip-hold-toggle">
            <input
              type="checkbox"
              checked={showPhases}
              onChange={(event) =>
                setShowPhases(event.target.checked)
              }
            />
            <span>Positionen anzeigen</span>
          </label>
          <button onClick={() => void load()} disabled={loading}>
            {loading ? "BERECHNET …" : "NEU BERECHNEN"}
          </button>
          <button
            onClick={() => void optimize()}
            disabled={optimizing}
          >
            {optimizing ? "400 TESTS …" : "FEINSUCHE 20×20"}
          </button>
        </div>
      </header>

      {error && <div className="flip-ki-error">{error}</div>}

      <main className="flip-ki-layout">
        <section className="flip-ki-chart">
          {showPhases && positionPhases.length > 0 && (
            <div className="flip-position-ribbon">
              <div className="flip-position-ribbon-label">
                POSITIONSVERLAUF
              </div>
              <div className="flip-position-ribbon-track">
                {positionPhases.map((phase) => (
                  <button
                    key={`${phase.entry_time}-${phase.side}-${phase.index}`}
                    className={`flip-position-segment ${phase.side}`}
                    style={{
                      left: `${phase.left}%`,
                      width: `${phase.width}%`,
                      ...phaseVisual(phase),
                    }}
                    title={`${phase.side.toUpperCase()} · ${phase.holding_bars} Kerzen · ${signed(phase.net_points)} Punkte`}
                    onClick={() => {
                      const index = candles.findIndex(
                        (candle) =>
                          candle.time >= phase.entry_time,
                      );
                      if (index >= 0) {
                        chartRef.current?.timeScale().setVisibleLogicalRange({
                          from: Math.max(0, index - 15),
                          to: Math.min(
                            candles.length - 1,
                            index + phase.holding_bars + 15,
                          ),
                        });
                      }
                    }}
                  >
                    {phase.width >= 4 && (
                      <span>
                        {phase.side.toUpperCase()} ·{" "}
                        {phase.holding_bars} ·{" "}
                        {signed(phase.net_points, 0)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flip-position-ribbon-legend">
                <span className="winner">GEWINNER</span>
                <span className="neutral">NEUTRAL</span>
                <span className="loser">VERLIERER</span>
                <small>
                  Intensität zeigt die Größe des Trade-Ergebnisses.
                </small>
              </div>
            </div>
          )}
          <div ref={chartHost} />
        </section>
        <aside className="flip-ki-sidebar">
          <div className="flip-ki-summary">
            <strong>Automatische Lernbasis</strong>
            <span>
              Entscheidungen <b>{decisions.length}</b>
            </span>
            <span>
              FLIP <b>{flipCount}</b>
            </span>
            <span>
              HOLD <b>{decisions.length - flipCount}</b>
            </span>
            <span>
              Ø Entscheidungsabstand{" "}
              <b>
                {Number(
                  summary?.average_absolute_advantage_atr || 0,
                ).toFixed(2)}{" "}
                ATR
              </b>
            </span>
            <small>
              Vergleich endet beim nächsten Strategiekandidaten.
              FLIP enthält Kosten; HOLD hat keinen neuen Entry.
            </small>
          </div>

          {summary?.metrics && (
            <div className="flip-result-card">
              <strong>VOLLSTÄNDIGER POSITIONSVERLAUF</strong>
              <span>Abgeschlossene Trades</span>
              <b>{summary.metrics.trade_count}</b>
              <span>Netto</span>
              <b>{signed(summary.metrics.net_points)}</b>
              <span>Profit Factor</span>
              <b>
                {summary.metrics.profit_factor == null
                  ? "∞"
                  : summary.metrics.profit_factor.toFixed(2)}
              </b>
              <span>Winrate</span>
              <b>{summary.metrics.win_rate_pct.toFixed(1)} %</b>
              <span>Max Drawdown</span>
              <b>
                -{summary.metrics.max_drawdown_points.toFixed(1)}
              </b>
              <span>Ø Trade</span>
              <b>
                {signed(summary.metrics.average_trade_points)}
              </b>
              <span>Ø Haltedauer</span>
              <b>
                {summary.metrics.average_holding_bars.toFixed(1)}
                {" "}Kerzen
              </b>
              <span>Ausgeführte FLIPs</span>
              <b>{summary.metrics.flip_count}</b>
              <span>Geblockte FLIPs</span>
              <b>{summary.metrics.hold_count}</b>
            </div>
          )}

          {optimizer && (
            <div className="flip-optimizer-card">
              <div className="flip-optimizer-title">
                <strong>FEINOPTIMIERUNG · 400 TESTS</strong>
                <span>
                  {optimizer.matrix.length} Kombinationen
                </span>
              </div>

              {optimizer.best && (
                <div className="flip-best-card">
                  <div>
                    <small>BESTE KOMBINATION</small>
                    <strong>
                      Kosten {optimizer.best.cost_atr.toFixed(3)} ATR
                      · Vorteil{" "}
                      {optimizer.best.minimum_advantage_atr.toFixed(2)} ATR
                    </strong>
                  </div>
                  <div className="flip-best-score">
                    <span>SCORE</span>
                    <b>{optimizer.best.score.toFixed(1)}</b>
                  </div>
                  <div className="flip-best-grid">
                    <span>Netto</span>
                    <b>
                      {signed(optimizer.best.metrics.net_points)}
                    </b>
                    <span>PF</span>
                    <b>
                      {optimizer.best.metrics.profit_factor == null
                        ? "∞"
                        : optimizer.best.metrics.profit_factor.toFixed(
                            2,
                          )}
                    </b>
                    <span>Drawdown</span>
                    <b>
                      -
                      {optimizer.best.metrics.max_drawdown_points.toFixed(
                        1,
                      )}
                    </b>
                    <span>Winrate</span>
                    <b>
                      {optimizer.best.metrics.win_rate_pct.toFixed(1)} %
                    </b>
                    <span>Trades</span>
                    <b>{optimizer.best.metrics.trade_count}</b>
                    <span>Ø Haltedauer</span>
                    <b>
                      {optimizer.best.metrics.average_holding_bars.toFixed(
                        1,
                      )}{" "}
                      Kerzen
                    </b>
                    <span>FLIP / HOLD</span>
                    <b>
                      {optimizer.best.flip_count} /{" "}
                      {optimizer.best.hold_count}
                    </b>
                  </div>
                  <button
                    onClick={() => {
                      setCostAtr(optimizer.best!.cost_atr);
                      setMinimumAdvantageAtr(
                        optimizer.best!
                          .minimum_advantage_atr,
                      );
                    }}
                  >
                    BESTE WERTE ÜBERNEHMEN
                  </button>
                </div>
              )}

              <div className="flip-top-label">
                TOP 12 NACH GESAMTSCORE
              </div>
              <div className="flip-matrix">
                {optimizer.matrix.slice(0, 12).map((row, index) => (
                  <button
                    key={`${row.cost_atr}-${row.minimum_advantage_atr}`}
                    className={index === 0 ? "best" : ""}
                    onClick={() => {
                      setCostAtr(row.cost_atr);
                      setMinimumAdvantageAtr(
                        row.minimum_advantage_atr,
                      );
                    }}
                  >
                    <span>
                      K {row.cost_atr.toFixed(3)} · V{" "}
                      {row.minimum_advantage_atr.toFixed(2)}
                    </span>
                    <b>Score {row.score.toFixed(1)}</b>
                    <small>
                      PF{" "}
                      {row.metrics.profit_factor == null
                        ? "∞"
                        : row.metrics.profit_factor.toFixed(2)}
                      {" · "}Netto{" "}
                      {signed(row.metrics.net_points)}
                      {" · "}DD -
                      {row.metrics.max_drawdown_points.toFixed(1)}
                    </small>
                  </button>
                ))}
              </div>

              <div className="flip-score-info">
                Score: 40 % PF · 30 % Netto · 20 % Drawdown ·
                10 % Winrate. PF wird bei 10 gekappt und
                logarithmisch gewichtet.
              </div>
              <small>
                Klick auf eine Kombination übernimmt die Werte.
                Danach „Neu berechnen“ drücken.
              </small>
            </div>
          )}

          {summary?.feature_statistics && (
            <div className="flip-statistics-card">
              <div className="flip-statistics-title">
                <div>
                  <strong>V5 · FLIP GEGEN HOLD</strong>
                  <small>
                    Standardisierte Trennschärfe aller Kernmerkmale
                  </small>
                </div>
                <span>
                  {summary.feature_statistics.row_count} Zeilen
                </span>
              </div>

              <div className="flip-statistics-head">
                <span>Merkmal</span>
                <span>FLIP</span>
                <span>HOLD</span>
                <span>Effekt</span>
              </div>

              <div className="flip-statistics-list">
                {summary.feature_statistics.features.map(
                  (item, index) => (
                    <div
                      key={item.feature}
                      className={index < 3 ? "top" : ""}
                    >
                      <span>
                        <b>{index + 1}. {featureLabel(item.feature)}</b>
                        <small>
                          {item.direction} · {item.strength}
                        </small>
                      </span>
                      <strong>{item.flip_mean.toFixed(3)}</strong>
                      <strong>{item.hold_mean.toFixed(3)}</strong>
                      <span className="flip-effect">
                        <b>
                          {signed(item.standardized_effect, 2)}
                        </b>
                        <small>
                          {effectStars(item.standardized_effect)}
                        </small>
                      </span>
                    </div>
                  ),
                )}
              </div>

              <div className="flip-statistics-note">
                Effekt ist die Differenz FLIP minus HOLD geteilt
                durch die gemeinsame Streuung. Ab etwa 0,50 ist die
                Trennung stark; das Vorzeichen zeigt die Richtung.
              </div>
            </div>
          )}

          {selected && (
            <div
              className={`flip-decision-card ${selected.label}`}
            >
              <div className="flip-decision-head">
                <span>
                  {selected.current_side.toUpperCase()} →{" "}
                  {selected.candidate_side.toUpperCase()}
                </span>
                <b>{selected.label.toUpperCase()}</b>
              </div>
              <small>{formatTime(selected.time)}</small>

              <div className="flip-comparison">
                <div>
                  <span>FLIP netto</span>
                  <b>{signed(selected.flip_net_points)}</b>
                </div>
                <div>
                  <span>HOLD</span>
                  <b>{signed(selected.hold_points)}</b>
                </div>
                <div>
                  <span>Vorteil FLIP</span>
                  <b>
                    {signed(selected.flip_advantage_points)} ·{" "}
                    {signed(selected.flip_advantage_atr, 2)} ATR
                  </b>
                </div>
              </div>

              <div className="flip-context">
                <span>Position seit</span>
                <b>{selected.bars_since_flip} Kerzen</b>
                <span>Offener PnL</span>
                <b>{signed(selected.position_open_atr, 2)} ATR</b>
                <span>Maximaler Gewinn</span>
                <b>{signed(selected.position_mfe_atr, 2)} ATR</b>
                <span>Rücklauf vom Maximum</span>
                <b>
                  {Number(
                    selected.position_drawdown_from_mfe_atr || 0,
                  ).toFixed(2)}{" "}
                  ATR
                </b>
              </div>
            </div>
          )}

          {selected && (
            <div className="flip-feature-card">
              <div className="flip-feature-title">
                <strong>FLIP-KI FEATURE-SNAPSHOT</strong>
                <span>
                  Kernscore{" "}
                  {Number(selected.feature_core_score || 0).toFixed(3)}
                </span>
              </div>
              <small>
                Marktwerte am echten QTrend-Gegensignal. Diese
                Merkmale bilden die Lernbasis für FLIP oder HOLD.
              </small>
              <div className="flip-feature-grid">
                {[
                  "macd_histogram_atr",
                  "macd_slope_atr",
                  "fast_distance_atr",
                  "slow_distance_atr",
                  "return_bps",
                  "body_atr",
                  "range_atr",
                  "trend_credit",
                  "momentum",
                  "energy",
                  "structure",
                  "macd_histogram_speed",
                ].map((key) => (
                  <div key={key}>
                    <span>{featureLabel(key)}</span>
                    <b>
                      {Number(
                        selected.feature_snapshot?.[key] || 0,
                      ).toFixed(3)}
                    </b>
                  </div>
                ))}
              </div>
              <div className="flip-feature-context">
                <span>Position offen</span>
                <b>{signed(selected.position_open_atr, 2)} ATR</b>
                <span>MFE</span>
                <b>{signed(selected.position_mfe_atr, 2)} ATR</b>
                <span>MAE</span>
                <b>{signed(selected.position_mae_atr, 2)} ATR</b>
                <span>Rücklauf</span>
                <b>
                  {Number(
                    selected.position_drawdown_from_mfe_atr || 0,
                  ).toFixed(2)}{" "}
                  ATR
                </b>
              </div>
              {summary?.feature_dataset && (
                <div className="flip-dataset-status">
                  Lernzeilen{" "}
                  <b>{summary.feature_dataset.row_count}</b>
                  <span>
                    FLIP {summary.feature_dataset.labels.flip} ·
                    HOLD {summary.feature_dataset.labels.hold}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flip-decision-list">
            {[...decisions]
              .filter((item) => showHold || item.label === "flip")
              .reverse()
              .map((item) => (
              <button
                key={`${item.candidate_id}-${item.time}`}
                className={`${item.label} ${
                  selected?.candidate_id === item.candidate_id
                    ? "active"
                    : ""
                }`}
                onClick={() => choose(item)}
              >
                <span>
                  <b>
                    {item.current_side.toUpperCase()} →{" "}
                    {item.candidate_side.toUpperCase()}
                  </b>
                  <small>{formatTime(item.time)}</small>
                </span>
                <strong>{item.label.toUpperCase()}</strong>
              </button>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}
