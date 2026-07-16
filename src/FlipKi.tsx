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
  position_drawdown_from_mfe_atr: number;
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
  dataset?: { row_count: number };
};

function formatTime(time: number) {
  return new Date(time * 1000).toLocaleString("de-DE");
}

function signed(value: number, digits = 1) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
}

export default function FlipKi() {
  const [symbol, setSymbol] = useState("US30");
  const [interval, setInterval] = useState("15m");
  const [costAtr, setCostAtr] = useState(0.05);
  const [minimumAdvantageAtr, setMinimumAdvantageAtr] = useState(0.15);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [decisions, setDecisions] = useState<FlipDecision[]>([]);
  const [summary, setSummary] = useState<FlipLabResponse | null>(null);
  const [selected, setSelected] = useState<FlipDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const chartHost = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const flipCount = useMemo(
    () => decisions.filter((item) => item.label === "flip").length,
    [decisions],
  );

  async function load() {
    setLoading(true);
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
      const sourceText = await sourceResponse.text();

      let sourcePayload: any;
      try {
        sourcePayload = JSON.parse(sourceText);
      } catch {
        throw new Error(sourceText || `HTTP ${sourceResponse.status}`);
      }

      if (!sourceResponse.ok || !sourcePayload.ok) {
        throw new Error(
          sourcePayload.info ||
          sourcePayload.error ||
          `HTTP ${sourceResponse.status}`,
        );
      }

      const nextCandles = (sourcePayload.candles || []) as Candle[];
      const candidates = (
        (sourcePayload.candidates || []) as Candidate[]
      ).slice(-1200);

      setCandles(nextCandles);

      if (candidates.length < 3) {
        setDecisions([]);
        setSummary(null);
        setSelected(null);
        setError(
          `Nur ${candidates.length} echte QTrend-Entrys gefunden. ` +
          `Für FLIP/HOLD werden mindestens drei Entry-Signale benötigt.`,
        );
        return;
      }

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

      const labText = await labResponse.text();
      let payload: FlipLabResponse & { error?: string; info?: string };

      try {
        payload = JSON.parse(labText);
      } catch {
        throw new Error(labText || `HTTP ${labResponse.status}`);
      }

      if (!labResponse.ok || !payload.ok) {
        throw new Error(
          payload.info ||
          payload.error ||
          `HTTP ${labResponse.status}`,
        );
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
  }, [candles, decisions]);

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
          <button onClick={() => void load()} disabled={loading}>
            {loading ? "BERECHNET …" : "NEU BERECHNEN"}
          </button>
        </div>
      </header>

      {error && <div className="flip-ki-error">{error}</div>}

      <main className="flip-ki-layout">
        <section className="flip-ki-chart">
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

          <div className="flip-decision-list">
            {[...decisions].reverse().map((item) => (
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
