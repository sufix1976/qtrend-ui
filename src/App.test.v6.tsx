import {
  useEffect,
  useMemo,
  useRef,
  useState,
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

import type {
  Candle,
  ChartMode,
  ConfigMap,
  Side,
  V5Config,
  V5Snapshot,
} from "./types";

import {
  BACKEND_BASE,
  DEFAULT_CONFIG,
  INTERVALS,
  SYMBOLS,
  buildHeikinAshi,
  calculateMacd,
  calculateSma,
  fetchJson,
  normalizeConfig,
} from "./utils";

import { styles } from "./styles";

import { PositionCard } from "./components/PositionCard";
import { ParameterCard } from "./components/ParameterCard";
import { DecisionCard } from "./components/DecisionCard";
import { ReasonsCard } from "./components/ReasonsCard";
import { DnaCard } from "./components/DnaCard";
import { ScoresCard } from "./components/ScoresCard";
import { SizeTable } from "./components/SizeTable";

export default function AppTESTv6() {
  const priceHostRef =
    useRef<HTMLDivElement | null>(
      null
    );

  const macdHostRef =
    useRef<HTMLDivElement | null>(
      null
    );

  const priceChartRef =
    useRef<IChartApi | null>(
      null
    );

  const macdChartRef =
    useRef<IChartApi | null>(
      null
    );

  const candleSeriesRef =
    useRef<
      ISeriesApi<"Candlestick"> | null
    >(null);

  const slowSeriesRef =
    useRef<
      ISeriesApi<"Line"> | null
    >(null);

  const histogramSeriesRef =
    useRef<
      ISeriesApi<"Histogram"> | null
    >(null);

  const macdSeriesRef =
    useRef<
      ISeriesApi<"Line"> | null
    >(null);

  const signalSeriesRef =
    useRef<
      ISeriesApi<"Line"> | null
    >(null);

  const zeroSeriesRef =
    useRef<
      ISeriesApi<"Line"> | null
    >(null);

  const lastFitKeyRef =
    useRef("");

  const [symbol, setSymbol] =
    useState("BTCUSD");

  const [interval, setInterval] =
    useState("15m");

  const [
    chartMode,
    setChartMode,
  ] = useState<ChartMode>(
    "heikin"
  );

  const [candles, setCandles] =
    useState<Candle[]>([]);

  const [configs, setConfigs] =
    useState<ConfigMap>({});

  const [config, setConfig] =
    useState<V5Config>(
      DEFAULT_CONFIG
    );

  const [
    snapshot,
    setSnapshot,
  ] =
    useState<V5Snapshot | null>(
      null
    );

  const [status, setStatus] =
    useState("Start");

  const [busy, setBusy] =
    useState(false);

  const visibleCandles =
    useMemo(
      () =>
        chartMode === "heikin"
          ? buildHeikinAshi(
              candles
            )
          : candles,
      [candles, chartMode]
    );

  useEffect(() => {
    document.body.style.margin =
      "0";

    document.body.style.background =
      "#050914";

    document.body.style.color =
      "#eef2ff";
  }, []);

  useEffect(() => {
    const current =
      configs[symbol];

    if (current) {
      setConfig(current);
      setInterval(
        current.interval
      );
      return;
    }

    const fallback = {
      ...DEFAULT_CONFIG,
      symbol,
    };

    setConfig(fallback);
    setInterval(
      fallback.interval
    );
  }, [symbol]);

  useEffect(() => {
    if (
      !priceHostRef.current ||
      !macdHostRef.current
    ) {
      return;
    }

    const priceChart =
      createChart(
        priceHostRef.current,
        {
          layout: {
            background: {
              color: "#070b16",
            },
            textColor:
              "#dbe4ff",
          },

          grid: {
            vertLines: {
              color: "#172033",
            },
            horzLines: {
              color: "#172033",
            },
          },

          crosshair: {
            mode:
              CrosshairMode.Normal,
          },

          rightPriceScale: {
            borderColor:
              "#334155",
            minimumWidth: 78,
          },

          timeScale: {
            borderColor:
              "#334155",
            timeVisible: true,
          },

          autoSize: true,
        }
      );

    const candleSeries =
      priceChart.addSeries(
        CandlestickSeries,
        {
          upColor: "#22c55e",
          downColor: "#ef4444",
          wickUpColor:
            "#22c55e",
          wickDownColor:
            "#ef4444",
          borderVisible: false,
        }
      );

    const slowSeries =
      priceChart.addSeries(
        LineSeries,
        {
          lineWidth: 2,
          color: "#3b82f6",
        }
      );

    const macdChart =
      createChart(
        macdHostRef.current,
        {
          layout: {
            background: {
              color: "#070b16",
            },
            textColor:
              "#dbe4ff",
          },

          grid: {
            vertLines: {
              color: "#172033",
            },
            horzLines: {
              color: "#172033",
            },
          },

          crosshair: {
            mode:
              CrosshairMode.Normal,
          },

          rightPriceScale: {
            borderColor:
              "#334155",
            minimumWidth: 78,
          },

          timeScale: {
            borderColor:
              "#334155",
            timeVisible: true,
          },

          localization: {
            priceFormatter: (
              value: number
            ) =>
              value.toFixed(2),
          },

          autoSize: true,
        }
      );

    const histogramSeries =
      macdChart.addSeries(
        HistogramSeries,
        {
          priceFormat: {
            type: "price",
            precision: 2,
            minMove: 0.01,
          },
        }
      );

    const macdSeries =
      macdChart.addSeries(
        LineSeries,
        {
          lineWidth: 2,
          color: "#60a5fa",
          priceFormat: {
            type: "price",
            precision: 2,
            minMove: 0.01,
          },
        }
      );

    const signalSeries =
      macdChart.addSeries(
        LineSeries,
        {
          lineWidth: 2,
          color: "#f59e0b",
          priceFormat: {
            type: "price",
            precision: 2,
            minMove: 0.01,
          },
        }
      );

    const zeroSeries =
      macdChart.addSeries(
        LineSeries,
        {
          lineWidth: 1,
          color: "#64748b",
          priceFormat: {
            type: "price",
            precision: 2,
            minMove: 0.01,
          },
        }
      );

    let rangeSyncing = false;

    priceChart
      .timeScale()
      .subscribeVisibleLogicalRangeChange(
        (range) => {
          if (
            !range ||
            rangeSyncing
          ) {
            return;
          }

          rangeSyncing = true;

          macdChart
            .timeScale()
            .setVisibleLogicalRange(
              range
            );

          rangeSyncing = false;
        }
      );

    macdChart
      .timeScale()
      .subscribeVisibleLogicalRangeChange(
        (range) => {
          if (
            !range ||
            rangeSyncing
          ) {
            return;
          }

          rangeSyncing = true;

          priceChart
            .timeScale()
            .setVisibleLogicalRange(
              range
            );

          rangeSyncing = false;
        }
      );

    let crosshairSyncing =
      false;

    priceChart.subscribeCrosshairMove(
      (param) => {
        if (
          crosshairSyncing
        ) {
          return;
        }

        crosshairSyncing = true;

        if (
          param.time == null
        ) {
          macdChart.clearCrosshairPosition();
        } else {
          const point =
            param.seriesData.get(
              candleSeries
            ) as
              | {
                  close?: number;
                }
              | undefined;

          macdChart.setCrosshairPosition(
            Number(
              point?.close ?? 0
            ),
            param.time,
            macdSeries
          );
        }

        crosshairSyncing = false;
      }
    );

    macdChart.subscribeCrosshairMove(
      (param) => {
        if (
          crosshairSyncing
        ) {
          return;
        }

        crosshairSyncing = true;

        if (
          param.time == null
        ) {
          priceChart.clearCrosshairPosition();
        } else {
          const point =
            param.seriesData.get(
              macdSeries
            ) as
              | {
                  value?: number;
                }
              | undefined;

          priceChart.setCrosshairPosition(
            Number(
              point?.value ?? 0
            ),
            param.time,
            candleSeries
          );
        }

        crosshairSyncing = false;
      }
    );

    priceChartRef.current =
      priceChart;

    macdChartRef.current =
      macdChart;

    candleSeriesRef.current =
      candleSeries;

    slowSeriesRef.current =
      slowSeries;

    histogramSeriesRef.current =
      histogramSeries;

    macdSeriesRef.current =
      macdSeries;

    signalSeriesRef.current =
      signalSeries;

    zeroSeriesRef.current =
      zeroSeries;

    return () => {
      priceChart.remove();
      macdChart.remove();

      priceChartRef.current =
        null;

      macdChartRef.current =
        null;

      candleSeriesRef.current =
        null;

      slowSeriesRef.current =
        null;

      histogramSeriesRef.current =
        null;

      macdSeriesRef.current =
        null;

      signalSeriesRef.current =
        null;

      zeroSeriesRef.current =
        null;
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
      visibleCandles.map(
        (candle) => ({
          ...candle,
          time:
            candle.time as Time,
        })
      )
    );

    slowSeriesRef.current.setData(
      calculateSma(
        candles,
        config.sma_slow
      ).map((point) => ({
        ...point,
        time:
          point.time as Time,
      }))
    );

    const macd =
      calculateMacd(
        candles,
        Math.max(
          1,
          config.macd_fast
        ),
        Math.max(
          1,
          config.macd_slow
        ),
        Math.max(
          1,
          config.macd_signal
        )
      );

    histogramSeriesRef.current.setData(
      macd.histogram.map(
        (point) => ({
          time:
            point.time as Time,
          value: point.value,
          color:
            point.value >= 0
              ? "#22c55e"
              : "#ef4444",
        })
      )
    );

    macdSeriesRef.current.setData(
      macd.macd.map(
        (point) => ({
          time:
            point.time as Time,
          value: point.value,
        })
      )
    );

    signalSeriesRef.current.setData(
      macd.signal.map(
        (point) => ({
          time:
            point.time as Time,
          value: point.value,
        })
      )
    );

    zeroSeriesRef.current.setData(
      candles.map(
        (candle) => ({
          time:
            candle.time as Time,
          value: 0,
        })
      )
    );

    const fitKey =
      `${symbol}_${interval}`;

    if (
      candles.length > 0 &&
      lastFitKeyRef.current !==
        fitKey
    ) {
      priceChartRef.current
        ?.timeScale()
        .fitContent();

      macdChartRef.current
        ?.timeScale()
        .fitContent();

      lastFitKeyRef.current =
        fitKey;
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
      const [
        configJson,
        candleJson,
        stateJson,
      ] = await Promise.all([
        fetchJson(
          `${BACKEND_BASE}/v5/config?_ts=${Date.now()}`
        ),

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

      const map: ConfigMap =
        {};

      for (
        const row of
        configJson.rows || []
      ) {
        const normalized =
          normalizeConfig(row);

        map[
          normalized.symbol
        ] = normalized;
      }

      setConfigs(map);

      setCandles(
        Array.isArray(
          candleJson.candles
        )
          ? candleJson.candles
          : []
      );

      setSnapshot(
        stateJson.state || null
      );

      setStatus(
        "V5 verbunden"
      );
    } catch (error) {
      setStatus(
        `Fehler: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadAll();

    const timer =
      window.setInterval(
        async () => {
          try {
            const [
              candleJson,
              stateJson,
            ] =
              await Promise.all([
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
              Array.isArray(
                candleJson.candles
              )
                ? candleJson.candles
                : []
            );

            setSnapshot(
              stateJson.state ||
                null
            );
          } catch {
            // Letzten funktionierenden Stand behalten.
          }
        },
        5000
      );

    return () =>
      window.clearInterval(
        timer
      );
  }, [symbol, interval]);

  async function saveConfig(
    next: V5Config = config
  ) {
    setBusy(true);

    try {
      const json =
        await fetchJson(
          `${BACKEND_BASE}/v5/config`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify(
              next
            ),
          }
        );

      const saved =
        normalizeConfig(
          json.row
        );

      setConfig(saved);

      setConfigs(
        (previous) => ({
          ...previous,
          [saved.symbol]:
            saved,
        })
      );

      setStatus(
        `${saved.symbol} gespeichert`
      );
    } catch (error) {
      setStatus(
        `Speichern fehlgeschlagen: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  async function manual(
    side: Side
  ) {
    setBusy(true);

    try {
      await fetchJson(
        `${BACKEND_BASE}/v5/manual`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            symbol,
            side,
          }),
        }
      );

      setStatus(
        `${symbol}: ${side.toUpperCase()} gesendet`
      );
    } catch (error) {
      setStatus(
        `Manuell fehlgeschlagen: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  function patchConfig<
    K extends keyof V5Config
  >(
    key: K,
    value: V5Config[K]
  ) {
    setConfig(
      (previous) => ({
        ...previous,
        [key]: value,
      })
    );
  }

  function updateTableConfig(
    rowSymbol: string,
    next: V5Config
  ) {
    setConfigs(
      (previous) => ({
        ...previous,
        [rowSymbol]: next,
      })
    );

    if (
      rowSymbol === symbol
    ) {
      setConfig(next);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <strong>
            QTrend V5.2
          </strong>

          <span
            style={styles.muted}
          >
            Büro / Engine Cockpit
          </span>
        </div>

        <div
          style={
            styles.headerControls
          }
        >
          <select
            value={symbol}
            onChange={(event) =>
              setSymbol(
                event.target.value
              )
            }
            style={styles.input}
          >
            {SYMBOLS.map(
              (item) => (
                <option key={item}>
                  {item}
                </option>
              )
            )}
          </select>

          <select
            value={interval}
            onChange={(event) => {
              const next =
                event.target.value;

              const nextConfig = {
                ...config,
                interval: next,
              };

              setInterval(next);
              setConfig(nextConfig);

              setConfigs(
                (previous) => ({
                  ...previous,
                  [symbol]:
                    nextConfig,
                })
              );
            }}
            style={styles.input}
          >
            {INTERVALS.map(
              (timeframe) => (
                <option
                  key={timeframe}
                >
                  {timeframe}
                </option>
              )
            )}
          </select>

          <button
            style={
              chartMode ===
              "heikin"
                ? styles.activeButton
                : styles.button
            }
            onClick={() =>
              setChartMode(
                "heikin"
              )
            }
          >
            Heikin
          </button>

          <button
            style={
              chartMode ===
              "candles"
                ? styles.activeButton
                : styles.button
            }
            onClick={() =>
              setChartMode(
                "candles"
              )
            }
          >
            Kerzen
          </button>

          <span
            style={styles.status}
          >
            {busy
              ? "Bitte warten..."
              : status}
          </span>
        </div>
      </header>

      <main style={styles.layout}>
        <section
          style={
            styles.chartColumn
          }
        >
          <div
            ref={priceHostRef}
            style={
              styles.priceChart
            }
          />

          <div
            ref={macdHostRef}
            style={
              styles.macdChart
            }
          />
        </section>

        <aside
          style={styles.sidePanel}
        >
          <PositionCard
            config={config}
            snapshot={snapshot}
            onPatch={patchConfig}
            onSave={saveConfig}
            onManual={manual}
          />

          <DecisionCard
            snapshot={snapshot}
          />

          <ReasonsCard
            snapshot={snapshot}
          />

          <DnaCard
            snapshot={snapshot}
          />

          <ScoresCard
            snapshot={snapshot}
          />

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
        onChange={
          updateTableConfig
        }
        onSave={saveConfig}
      />
    </div>
  );
}
