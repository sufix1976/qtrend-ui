// qtrend-v5-core-complete.js
// QTrend V5 – vollständiger Strategie-, Decision- und Entry-State-Core
// Enthält die bisherige MSE-v8-DNA unverändert sowie eine worker-fertige
// Entscheidungsschicht mit Quality Grade, Gründen, Warnungen, Edge-Trigger,
// Signal-ID und BUY/SELL-Kandidat. Noch keine Brokerorder.
// Keine API, keine Datenbank, keine Brokerorders.

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isFiniteNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function positiveInt(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function clamp(value) {
  return Math.max(0, Math.min(100, toNumber(value)));
}

export function scoreAbs(value, scale) {
  const s = Number(scale);
  return Number.isFinite(s) && s !== 0
    ? clamp(Math.abs(toNumber(value)) / s * 100)
    : 0;
}

// Pine-kompatible SMA: Ein Wert entsteht erst, wenn im ganzen Fenster
// ausschließlich gültige Zahlen vorhanden sind.
export function sma(values, length) {
  const len = positiveInt(length, 1);
  const out = new Array(values.length).fill(null);

  for (let i = len - 1; i < values.length; i += 1) {
    let sum = 0;
    let valid = true;

    for (let j = i - len + 1; j <= i; j += 1) {
      if (!isFiniteNumber(values[j])) {
        valid = false;
        break;
      }
      sum += Number(values[j]);
    }

    if (valid) {
      out[i] = sum / len;
    }
  }

  return out;
}

export function ema(values, length) {
  const len = positiveInt(length, 1);
  const out = new Array(values.length).fill(null);
  const alpha = 2 / (len + 1);

  let current = null;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];

    if (!isFiniteNumber(value)) {
      out[i] = current;
      continue;
    }

    if (current === null) {
      current = Number(value);
    } else {
      current = Number(value) * alpha + current * (1 - alpha);
    }

    out[i] = current;
  }

  return out;
}

// Wilder-RMA als Grundlage für ATR und RSI.
export function rma(values, length) {
  const len = positiveInt(length, 1);
  const out = new Array(values.length).fill(null);

  let seedSum = 0;
  let seedCount = 0;
  let current = null;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];

    if (!isFiniteNumber(value)) {
      out[i] = current;
      continue;
    }

    if (current === null) {
      seedSum += Number(value);
      seedCount += 1;

      if (seedCount === len) {
        current = seedSum / len;
        out[i] = current;
      }
      continue;
    }

    current = (current * (len - 1) + Number(value)) / len;
    out[i] = current;
  }

  return out;
}

export function stdev(values, length) {
  const len = positiveInt(length, 1);
  const out = new Array(values.length).fill(null);

  for (let i = len - 1; i < values.length; i += 1) {
    const window = values.slice(i - len + 1, i + 1);

    if (!window.every(isFiniteNumber)) continue;

    const mean =
      window.reduce((sum, value) => sum + Number(value), 0) / len;

    const variance =
      window.reduce(
        (sum, value) => sum + (Number(value) - mean) ** 2,
        0
      ) / len;

    out[i] = Math.sqrt(variance);
  }

  return out;
}

export function atr(candles, length) {
  const trueRange = candles.map((candle, index) => {
    const high = toNumber(candle.high);
    const low = toNumber(candle.low);

    if (index === 0) {
      return high - low;
    }

    const previousClose = toNumber(candles[index - 1].close);

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    );
  });

  return rma(trueRange, length);
}

export function rsi(closes, length) {
  const gains = new Array(closes.length).fill(null);
  const losses = new Array(closes.length).fill(null);

  for (let i = 1; i < closes.length; i += 1) {
    const change = toNumber(closes[i]) - toNumber(closes[i - 1]);
    gains[i] = Math.max(change, 0);
    losses[i] = Math.max(-change, 0);
  }

  const averageGain = rma(gains, length);
  const averageLoss = rma(losses, length);

  return closes.map((_, index) => {
    const gain = averageGain[index];
    const loss = averageLoss[index];

    if (!isFiniteNumber(gain) || !isFiniteNumber(loss)) return null;
    if (Number(loss) === 0) return 100;
    if (Number(gain) === 0) return 0;

    const relativeStrength = Number(gain) / Number(loss);
    return 100 - 100 / (1 + relativeStrength);
  });
}

export function macd(closes, fastLength, slowLength, signalLength) {
  const fast = ema(closes, fastLength);
  const slow = ema(closes, slowLength);

  const macdLine = closes.map((_, index) => {
    if (!isFiniteNumber(fast[index]) || !isFiniteNumber(slow[index])) {
      return null;
    }

    return Number(fast[index]) - Number(slow[index]);
  });

  const signalLine = ema(macdLine, signalLength);

  const histogram = macdLine.map((value, index) => {
    if (!isFiniteNumber(value) || !isFiniteNumber(signalLine[index])) {
      return null;
    }

    return Number(value) - Number(signalLine[index]);
  });

  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
  };
}

function valueAt(values, index, fallback = null) {
  if (index < 0 || index >= values.length) return fallback;
  return isFiniteNumber(values[index]) ? Number(values[index]) : fallback;
}

export function calculateQTrendIndicators(candles, input = {}) {
  if (!Array.isArray(candles)) {
    throw new TypeError("candles must be an array");
  }

  const config = {
    sma_fast: positiveInt(input.sma_fast, 20),
    sma_slow: positiveInt(input.sma_slow, 50),
    atr_len: positiveInt(input.atr_len, 14),
    rsi_len: positiveInt(input.rsi_len, 14),
    macd_fast: positiveInt(input.macd_fast, 2),
    macd_slow: positiveInt(input.macd_slow, 26),
    macd_signal: positiveInt(input.macd_signal, 9),
  };

  if (config.sma_fast >= config.sma_slow) {
    throw new RangeError("sma_fast must be smaller than sma_slow");
  }

  if (config.macd_fast >= config.macd_slow) {
    throw new RangeError("macd_fast must be smaller than macd_slow");
  }

  const opens = candles.map((candle) => toNumber(candle.open));
  const highs = candles.map((candle) => toNumber(candle.high));
  const lows = candles.map((candle) => toNumber(candle.low));
  const closes = candles.map((candle) => toNumber(candle.close));

  const smaFast = sma(closes, config.sma_fast);
  const smaSlow = sma(closes, config.sma_slow);

  const atrLine = atr(candles, config.atr_len);
  const atrAverage = sma(atrLine, 50);

  const rsiLine = rsi(closes, config.rsi_len);

  const macdResult = macd(
    closes,
    config.macd_fast,
    config.macd_slow,
    config.macd_signal
  );

  const stdevLine = stdev(closes, 20);
  const stdevAverage = sma(stdevLine, 50);

  let previousDirectionValue = 0;
  let trendAgeBars = 0;
  let previousMomentumScore = null;
  let previousEnergyScore = null;
  let previousVolatilityScore = null;

  // Pine: var string phase = "COMPRESSION"
  let phase = "COMPRESSION";

  // Historischer Action-Zustand für echte FLOW-Edges.
  let previousFlowAction = "WAIT";

  //━━━━━━━━━━━━━━━━━━━
  // ENTRY STATE MANAGER
  //━━━━━━━━━━━━━━━━━━━
  // 0 = flat, 1 = long, -1 = short.
  // Dieser Zustand wird über die komplette Kerzenhistorie deterministisch
  // rekonstruiert. Eine echte Brokerposition wird später im Worker/DB geführt.
  let virtualPosition = 0;
  let pendingSide = null;
  let previousEntryState = "WATCH";

  const rows = candles.map((candle, index) => {
    const open = opens[index];
    const high = highs[index];
    const low = lows[index];
    const close = closes[index];

    const atrNow = valueAt(atrLine, index);
    const atrAvgNow = valueAt(atrAverage, index);
    const rsiNow = valueAt(rsiLine, index);
    const macdNow = valueAt(macdResult.macd, index);
    const macdSignalNow = valueAt(macdResult.signal, index);
    const histogramNow = valueAt(macdResult.histogram, index);
    const smaFastNow = valueAt(smaFast, index);
    const smaSlowNow = valueAt(smaSlow, index);
    const stdevNow = valueAt(stdevLine, index);
    const stdevAvgNow = valueAt(stdevAverage, index);

    const barRange = high - low;
    const body = Math.abs(close - open);
    const bodyPct = barRange > 0 ? body / barRange : 0;
    const wickPct = barRange > 0 ? 1 - bodyPct : 0;

    //━━━━━━━━━━━━━━━━━━━
    // Trend Sensor
    //━━━━━━━━━━━━━━━━━━━
    const smaSlow5 = valueAt(smaSlow, index - 5);
    const smaSlow10 = valueAt(smaSlow, index - 10);

    const slopeSlow =
      smaSlowNow !== null && smaSlow5 !== null
        ? smaSlowNow - smaSlow5
        : null;

    const prevSlopeSlow =
      smaSlow5 !== null && smaSlow10 !== null
        ? smaSlow5 - smaSlow10
        : null;

    const curveSlow =
      slopeSlow !== null && prevSlopeSlow !== null
        ? slopeSlow - prevSlopeSlow
        : null;

    const trendSlope =
      slopeSlow !== null && atrNow !== null
        ? scoreAbs(slopeSlow, atrNow * 0.6)
        : null;

    const trendCurve =
      curveSlow !== null && atrNow !== null
        ? scoreAbs(curveSlow, atrNow * 0.4)
        : null;

    const priceDist =
      smaSlowNow !== null && atrNow !== null
        ? scoreAbs(close - smaSlowNow, atrNow * 2)
        : null;

    const maAlign =
      smaFastNow !== null && smaSlowNow !== null
        ? (smaFastNow !== smaSlowNow ? 100 : 0)
        : null;

    const trendScore =
      [trendSlope, trendCurve, priceDist, maAlign].every(isFiniteNumber)
        ? clamp(
            Number(trendSlope) * 0.35 +
            Number(trendCurve) * 0.20 +
            Number(priceDist) * 0.25 +
            Number(maAlign) * 0.20
          )
        : null;

    //━━━━━━━━━━━━━━━━━━━
    // Momentum Sensor
    //━━━━━━━━━━━━━━━━━━━
    const rsi3 = valueAt(rsiLine, index - 3);
    const rsi6 = valueAt(rsiLine, index - 6);
    const histogram3 = valueAt(macdResult.histogram, index - 3);

    const rsiSpeed =
      rsiNow !== null && rsi3 !== null
        ? rsiNow - rsi3
        : null;

    const previousRsiSpeed =
      rsi3 !== null && rsi6 !== null
        ? rsi3 - rsi6
        : null;

    const rsiAccel =
      rsiSpeed !== null && previousRsiSpeed !== null
        ? rsiSpeed - previousRsiSpeed
        : null;

    const histogramSpeed =
      histogramNow !== null && histogram3 !== null
        ? histogramNow - histogram3
        : null;

    const rsiPower =
      rsiNow !== null ? scoreAbs(rsiNow - 50, 25) : null;

    const rsiSpeedScore =
      rsiSpeed !== null ? scoreAbs(rsiSpeed, 10) : null;

    const rsiAccelScore =
      rsiAccel !== null ? scoreAbs(rsiAccel, 8) : null;

    const macdPower =
      histogramNow !== null && atrNow !== null
        ? scoreAbs(histogramNow, atrNow * 0.08)
        : null;

    const macdSpeedScore =
      histogramSpeed !== null && atrNow !== null
        ? scoreAbs(histogramSpeed, atrNow * 0.05)
        : null;

    const momentumScore =
      [
        rsiPower,
        rsiSpeedScore,
        rsiAccelScore,
        macdPower,
        macdSpeedScore,
      ].every(isFiniteNumber)
        ? clamp(
            Number(rsiPower) * 0.20 +
            Number(rsiSpeedScore) * 0.20 +
            Number(rsiAccelScore) * 0.15 +
            Number(macdPower) * 0.25 +
            Number(macdSpeedScore) * 0.20
          )
        : null;

    //━━━━━━━━━━━━━━━━━━━
    // Energy Sensor
    //━━━━━━━━━━━━━━━━━━━
    const close5 = valueAt(closes, index - 5);

    const atrEnergy =
      atrNow !== null && atrAvgNow !== null && atrAvgNow > 0
        ? clamp(atrNow / atrAvgNow * 65)
        : null;

    const rangeEnergy =
      atrNow !== null && atrNow > 0
        ? clamp(barRange / atrNow * 55)
        : null;

    const bodyEnergy = clamp(bodyPct * 100);

    const impulse =
      close5 !== null ? Math.abs(close - close5) : null;

    const impulseEnergy =
      impulse !== null && atrNow !== null && atrNow > 0
        ? clamp(impulse / atrNow * 30)
        : null;

    const energyScore =
      [atrEnergy, rangeEnergy, bodyEnergy, impulseEnergy].every(isFiniteNumber)
        ? clamp(
            Number(atrEnergy) * 0.25 +
            Number(rangeEnergy) * 0.25 +
            Number(bodyEnergy) * 0.25 +
            Number(impulseEnergy) * 0.25
          )
        : null;

    //━━━━━━━━━━━━━━━━━━━
    // Volatility Sensor
    //━━━━━━━━━━━━━━━━━━━
    const atrVol =
      atrNow !== null && atrAvgNow !== null && atrAvgNow > 0
        ? clamp(atrNow / atrAvgNow * 100)
        : null;

    const stdevVol =
      stdevNow !== null && stdevAvgNow !== null && stdevAvgNow > 0
        ? clamp(stdevNow / stdevAvgNow * 100)
        : null;

    const rangeVol =
      atrNow !== null && atrNow > 0
        ? clamp(barRange / atrNow * 70)
        : null;

    const volatilityScore =
      [atrVol, stdevVol, rangeVol].every(isFiniteNumber)
        ? clamp(
            Number(atrVol) * 0.45 +
            Number(stdevVol) * 0.35 +
            Number(rangeVol) * 0.20
          )
        : null;

    //━━━━━━━━━━━━━━━━━━━
    // Compression Sensor
    //━━━━━━━━━━━━━━━━━━━
    const smallBody = clamp((1 - bodyPct) * 100);
    const highWicks = clamp(wickPct * 100);

    const lowAtr =
      atrNow !== null && atrAvgNow !== null && atrAvgNow > 0
        ? clamp((1.35 - atrNow / atrAvgNow) * 100)
        : null;

    const flatSma =
      trendSlope !== null ? clamp(100 - trendSlope) : null;

    const tightRange =
      atrNow !== null && atrNow > 0
        ? clamp((1.2 - barRange / atrNow) * 100)
        : null;

    const compressionScore =
      [smallBody, highWicks, lowAtr, flatSma, tightRange].every(isFiniteNumber)
        ? clamp(
            Number(smallBody) * 0.20 +
            Number(highWicks) * 0.20 +
            Number(lowAtr) * 0.25 +
            Number(flatSma) * 0.20 +
            Number(tightRange) * 0.15
          )
        : null;

    //━━━━━━━━━━━━━━━━━━━
    // Structure / Direction Sensor
    //━━━━━━━━━━━━━━━━━━━
    const close5ForStructure = valueAt(closes, index - 5);
    const smaSlow5ForStructure = valueAt(smaSlow, index - 5);

    const structureReady =
      smaFastNow !== null &&
      smaSlowNow !== null &&
      smaSlow5ForStructure !== null &&
      close5ForStructure !== null;

    const structureBull = structureReady
      ? (close > smaFastNow ? 20 : 0) +
        (close > smaSlowNow ? 20 : 0) +
        (smaFastNow > smaSlowNow ? 20 : 0) +
        (smaSlowNow > smaSlow5ForStructure ? 20 : 0) +
        (close > close5ForStructure ? 20 : 0)
      : null;

    const structureBear = structureReady
      ? (close < smaFastNow ? 20 : 0) +
        (close < smaSlowNow ? 20 : 0) +
        (smaFastNow < smaSlowNow ? 20 : 0) +
        (smaSlowNow < smaSlow5ForStructure ? 20 : 0) +
        (close < close5ForStructure ? 20 : 0)
      : null;

    const structureScore =
      structureBull !== null && structureBear !== null
        ? Math.max(structureBull, structureBear)
        : null;

    const direction =
      structureBull === null || structureBear === null
        ? null
        : structureBull > structureBear
          ? "UP"
          : structureBear > structureBull
            ? "DOWN"
            : "RANGE";

    const directionValue =
      direction === "UP" ? 1 :
      direction === "DOWN" ? -1 :
      direction === "RANGE" ? 0 :
      null;

    //━━━━━━━━━━━━━━━━━━━
    // Balance / Age / Pullback / Exhaustion
    //━━━━━━━━━━━━━━━━━━━
    const balanceScore =
      [compressionScore, trendScore, energyScore, volatilityScore].every(isFiniteNumber)
        ? clamp(
            Number(compressionScore) * 0.45 +
            (100 - Number(trendScore)) * 0.20 +
            (100 - Number(energyScore)) * 0.20 +
            (100 - Number(volatilityScore)) * 0.15
          )
        : null;

    if (directionValue === null) {
      trendAgeBars = 0;
    } else if (directionValue !== 0 && directionValue === previousDirectionValue) {
      trendAgeBars += 1;
    } else if (directionValue !== 0) {
      trendAgeBars = 1;
    } else {
      trendAgeBars = 0;
    }

    const trendAgeScore =
      directionValue === null
        ? null
        : clamp(trendAgeBars / 80 * 100);

    const momentumFalling =
      momentumScore !== null && previousMomentumScore !== null
        ? momentumScore < previousMomentumScore
        : false;

    const energyFalling =
      energyScore !== null && previousEnergyScore !== null
        ? energyScore < previousEnergyScore
        : false;

    const volatilityFalling =
      volatilityScore !== null && previousVolatilityScore !== null
        ? volatilityScore < previousVolatilityScore
        : false;

    const momentumRising =
      momentumScore !== null && previousMomentumScore !== null
        ? momentumScore > previousMomentumScore
        : false;

    const energyRising =
      energyScore !== null && previousEnergyScore !== null
        ? energyScore > previousEnergyScore
        : false;

    const volatilityRising =
      volatilityScore !== null && previousVolatilityScore !== null
        ? volatilityScore > previousVolatilityScore
        : false;

    const pullbackScore =
      [compressionScore, energyScore, trendAgeScore].every(isFiniteNumber)
        ? clamp(
            Number(compressionScore) * 0.30 +
            (100 - Number(energyScore)) * 0.25 +
            Number(trendAgeScore) * 0.15 +
            (momentumFalling ? 20 : 0) +
            (energyFalling ? 10 : 0)
          )
        : null;

    const exhaustionScore =
      [trendAgeScore, pullbackScore].every(isFiniteNumber)
        ? clamp(
            Number(trendAgeScore) * 0.30 +
            Number(pullbackScore) * 0.30 +
            (momentumFalling ? 20 : 0) +
            (energyFalling ? 15 : 0) +
            (volatilityFalling ? 10 : 0)
          )
        : null;

    //━━━━━━━━━━━━━━━━━━━
    // Regime Engine
    //━━━━━━━━━━━━━━━━━━━
    const trendRegimeScore =
      [trendScore, structureScore, trendAgeScore, balanceScore].every(isFiniteNumber)
        ? clamp(
            Number(trendScore) * 0.35 +
            Number(structureScore) * 0.35 +
            Number(trendAgeScore) * 0.15 +
            (100 - Number(balanceScore)) * 0.15
          )
        : null;

    const rangeRegimeScore =
      [compressionScore, balanceScore, trendScore, energyScore].every(isFiniteNumber)
        ? clamp(
            Number(compressionScore) * 0.40 +
            Number(balanceScore) * 0.35 +
            (100 - Number(trendScore)) * 0.15 +
            (100 - Number(energyScore)) * 0.10
          )
        : null;

    const regime =
      trendRegimeScore === null || rangeRegimeScore === null
        ? null
        : trendRegimeScore >= rangeRegimeScore
          ? "TREND"
          : "RANGE";

    const regimeConfidence =
      regime === "TREND"
        ? trendRegimeScore
        : regime === "RANGE"
          ? rangeRegimeScore
          : null;

    //━━━━━━━━━━━━━━━━━━━
    // Phase Conditions
    //━━━━━━━━━━━━━━━━━━━
    const isCompression =
      compressionScore !== null &&
      energyScore !== null &&
      balanceScore !== null &&
      compressionScore >= 62 &&
      energyScore <= 45 &&
      balanceScore >= 50;

    const isExpansion =
      momentumScore !== null &&
      energyScore !== null &&
      volatilityScore !== null &&
      compressionScore !== null &&
      momentumScore >= 65 &&
      energyScore >= 45 &&
      volatilityScore >= 55 &&
      compressionScore <= 60;

    const isPullback =
      regime === "TREND" &&
      trendScore !== null &&
      structureScore !== null &&
      trendAgeScore !== null &&
      energyScore !== null &&
      trendScore >= 55 &&
      structureScore >= 60 &&
      trendAgeScore >= 20 &&
      (energyScore <= 45 || momentumFalling || energyFalling);

    const isExhaustion =
      regime === "TREND" &&
      exhaustionScore !== null &&
      trendAgeScore !== null &&
      pullbackScore !== null &&
      exhaustionScore >= 65 &&
      trendAgeScore >= 25 &&
      pullbackScore >= 55;

    //━━━━━━━━━━━━━━━━━━━
    // Phase State Machine V9 Stable
    //━━━━━━━━━━━━━━━━━━━
    const phaseSwitchMargin = 8.0;

    const compressionPower =
      [compressionScore, balanceScore, energyScore].every(isFiniteNumber)
        ? clamp(
            (
              Number(compressionScore) +
              Number(balanceScore) +
              (100 - Number(energyScore))
            ) / 3
          )
        : null;

    const expansionPower =
      [momentumScore, energyScore, volatilityScore, trendScore].every(isFiniteNumber)
        ? clamp(
            (
              Number(momentumScore) +
              Number(energyScore) +
              Number(volatilityScore) +
              Number(trendScore)
            ) / 4
          )
        : null;

    const pullbackPower =
      [pullbackScore, trendScore, structureScore, trendAgeScore].every(isFiniteNumber)
        ? clamp(
            (
              Number(pullbackScore) +
              Number(trendScore) +
              Number(structureScore) +
              Number(trendAgeScore)
            ) / 4
          )
        : null;

    const exhaustionPower = exhaustionScore;

    const previousPhase = phase;

    const currentPower =
      phase === "EXPANSION" ? expansionPower :
      phase === "PULLBACK" ? pullbackPower :
      phase === "EXHAUSTION" ? exhaustionPower :
      compressionPower;

    let candidatePhase = phase;
    let candidatePower = currentPower;

    if (regime === "RANGE") {
      if (isExpansion && Number(compressionScore) < 55) {
        candidatePhase = "EXPANSION";
        candidatePower = expansionPower;
      } else {
        candidatePhase = "COMPRESSION";
        candidatePower = compressionPower;
      }
    } else if (regime === "TREND") {
      if (phase === "COMPRESSION") {
        if (isExpansion) {
          candidatePhase = "EXPANSION";
          candidatePower = expansionPower;
        }
      } else if (phase === "EXPANSION") {
        if (isExhaustion) {
          candidatePhase = "EXHAUSTION";
          candidatePower = exhaustionPower;
        } else if (isPullback) {
          candidatePhase = "PULLBACK";
          candidatePower = pullbackPower;
        }
      } else if (phase === "PULLBACK") {
        if (isExhaustion) {
          candidatePhase = "EXHAUSTION";
          candidatePower = exhaustionPower;
        } else if (isExpansion && energyRising) {
          candidatePhase = "EXPANSION";
          candidatePower = expansionPower;
        }
      } else if (phase === "EXHAUSTION") {
        if (isCompression || regime === "RANGE") {
          candidatePhase = "COMPRESSION";
          candidatePower = compressionPower;
        } else if (isExpansion && energyRising && momentumRising) {
          candidatePhase = "EXPANSION";
          candidatePower = expansionPower;
        }
      }
    }

    const directionChanged =
      directionValue !== null &&
      directionValue !== 0 &&
      directionValue !== previousDirectionValue;

    const canSwitch =
      candidatePhase !== phase &&
      candidatePower !== null &&
      currentPower !== null &&
      (
        directionChanged ||
        Number(candidatePower) >= Number(currentPower) + phaseSwitchMargin
      );

    if (canSwitch) {
      phase = candidatePhase;
    }

    //━━━━━━━━━━━━━━━━━━━
    // Phase Confidence
    //━━━━━━━━━━━━━━━━━━━
    const phaseConfidence =
      phase === "EXPANSION" ? expansionPower :
      phase === "PULLBACK" ? pullbackPower :
      phase === "EXHAUSTION" ? exhaustionPower :
      compressionPower;

    //━━━━━━━━━━━━━━━━━━━
    // DNA Engine
    //━━━━━━━━━━━━━━━━━━━
    const dna =
      regime === "RANGE" && phase === "COMPRESSION" ? "RANGE_COMPRESSION" :
      regime === "RANGE" && phase === "EXPANSION" ? "RANGE_RELEASE" :
      regime === "TREND" && phase === "EXPANSION" && direction === "UP" ? "TREND_EXPANSION_UP" :
      regime === "TREND" && phase === "PULLBACK" && direction === "UP" ? "TREND_PULLBACK_UP" :
      regime === "TREND" && phase === "EXHAUSTION" && direction === "UP" ? "TREND_EXHAUSTION_UP" :
      regime === "TREND" && phase === "COMPRESSION" && direction === "UP" ? "TREND_COMPRESSION_UP" :
      regime === "TREND" && phase === "EXPANSION" && direction === "DOWN" ? "TREND_EXPANSION_DOWN" :
      regime === "TREND" && phase === "PULLBACK" && direction === "DOWN" ? "TREND_PULLBACK_DOWN" :
      regime === "TREND" && phase === "EXHAUSTION" && direction === "DOWN" ? "TREND_EXHAUSTION_DOWN" :
      regime === "TREND" && phase === "COMPRESSION" && direction === "DOWN" ? "TREND_COMPRESSION_DOWN" :
      "UNDEFINED";

    //━━━━━━━━━━━━━━━━━━━
    // DNA Meaning
    //━━━━━━━━━━━━━━━━━━━
    const dnaAction =
      dna === "TREND_EXPANSION_UP" ? "LONG OK" :
      dna === "TREND_PULLBACK_UP" ? "LONG PREP" :
      dna === "TREND_EXHAUSTION_UP" ? "NO NEW LONG" :
      dna === "TREND_COMPRESSION_UP" ? "WAIT LONG" :
      dna === "TREND_EXPANSION_DOWN" ? "SHORT OK" :
      dna === "TREND_PULLBACK_DOWN" ? "SHORT PREP" :
      dna === "TREND_EXHAUSTION_DOWN" ? "NO NEW SHORT" :
      dna === "TREND_COMPRESSION_DOWN" ? "WAIT SHORT" :
      dna === "RANGE_COMPRESSION" ? "NO TRADE" :
      dna === "RANGE_RELEASE" ? "WATCH BREAKOUT" :
      "WAIT";

    //━━━━━━━━━━━━━━━━━━━
    // DNA Quality
    //━━━━━━━━━━━━━━━━━━━
    const dnaQuality =
      phase === "EXPANSION" &&
      [trendScore, momentumScore, energyScore, volatilityScore].every(isFiniteNumber)
        ? (
            Number(trendScore) +
            Number(momentumScore) +
            Number(energyScore) +
            Number(volatilityScore)
          ) / 4
        : phase === "PULLBACK" &&
          [pullbackScore, structureScore, trendScore, balanceScore].every(isFiniteNumber)
          ? (
              Number(pullbackScore) +
              Number(structureScore) +
              Number(trendScore) +
              Number(balanceScore)
            ) / 4
          : phase === "EXHAUSTION" &&
            [exhaustionScore, trendAgeScore, momentumScore].every(isFiniteNumber)
            ? (
                Number(exhaustionScore) +
                Number(trendAgeScore) +
                (100 - Number(momentumScore))
              ) / 3
            : phase === "COMPRESSION" &&
              [compressionScore, balanceScore, energyScore].every(isFiniteNumber)
              ? (
                  Number(compressionScore) +
                  Number(balanceScore) +
                  (100 - Number(energyScore))
                ) / 3
              : 50;

    //━━━━━━━━━━━━━━━━━━━
    // DNA Flow
    //━━━━━━━━━━━━━━━━━━━
    let dnaFlow = "";

    if (phase === "COMPRESSION") {
      dnaFlow =
        previousPhase === "EXHAUSTION"
          ? "EXHAUSTION → COMPRESSION"
          : "COMPRESSION";
    } else if (phase === "EXPANSION") {
      dnaFlow =
        previousPhase === "COMPRESSION"
          ? "COMPRESSION → EXPANSION"
          : previousPhase === "PULLBACK"
            ? "PULLBACK → EXPANSION"
            : "EXPANSION";
    } else if (phase === "PULLBACK") {
      dnaFlow =
        previousPhase === "EXPANSION"
          ? "EXPANSION → PULLBACK"
          : "PULLBACK";
    } else if (phase === "EXHAUSTION") {
      dnaFlow =
        previousPhase === "EXPANSION"
          ? "EXPANSION → EXHAUSTION"
          : "EXHAUSTION";
    }

    //━━━━━━━━━━━━━━━━━━━
    // Flow Action
    //━━━━━━━━━━━━━━━━━━━
    let flowAction = dnaAction;

    if (dnaFlow === "COMPRESSION → EXPANSION") {
      flowAction = direction === "UP" ? "WATCH LONG" : "WATCH SHORT";
    } else if (dnaFlow === "EXPANSION → PULLBACK") {
      flowAction = direction === "UP" ? "HOLD LONG" : "HOLD SHORT";
    } else if (dnaFlow === "PULLBACK → EXPANSION") {
      flowAction = direction === "UP" ? "LONG OK" : "SHORT OK";
    } else if (dnaFlow === "EXPANSION → EXHAUSTION") {
      flowAction = direction === "UP" ? "NO NEW LONG" : "NO NEW SHORT";
    } else if (dnaFlow === "EXHAUSTION → COMPRESSION") {
      flowAction = "NO TRADE";
    }

    //━━━━━━━━━━━━━━━━━━━
    // DECISION ENGINE – WORKER READY
    //━━━━━━━━━━━━━━━━━━━
    // Die bestehende Pine-kompatible Action bleibt unverändert in `action`.
    // Dieser Zusatz übersetzt sie in eindeutige, maschinenlesbare Felder.

    const qualityGrade =
      dnaQuality >= 90 ? "A+" :
      dnaQuality >= 80 ? "A" :
      dnaQuality >= 70 ? "B" :
      dnaQuality >= 60 ? "C" :
      dnaQuality >= 50 ? "D" :
      "E";

    const qualityLabel =
      dnaQuality >= 80 ? "STRONG" :
      dnaQuality >= 65 ? "GOOD" :
      dnaQuality >= 50 ? "MEDIUM" :
      "WEAK";

    const marketDna =
      dna === "TREND_EXPANSION_UP"
        ? `TREND_EXPANSION_UP_${qualityLabel}`
        : dna === "TREND_EXPANSION_DOWN"
          ? `TREND_EXPANSION_DOWN_${qualityLabel}`
          : dna === "RANGE_RELEASE"
            ? `RANGE_RELEASE_${qualityLabel}`
            : dna;

    let decision = "NO_TRADE";

    if (flowAction === "LONG OK") {
      decision = "ENTRY_LONG_READY";
    } else if (flowAction === "SHORT OK") {
      decision = "ENTRY_SHORT_READY";
    } else if (flowAction === "WATCH LONG") {
      decision = "WATCH_LONG";
    } else if (flowAction === "WATCH SHORT") {
      decision = "WATCH_SHORT";
    } else if (flowAction === "HOLD LONG") {
      decision = "HOLD_LONG";
    } else if (flowAction === "HOLD SHORT") {
      decision = "HOLD_SHORT";
    } else if (flowAction === "NO NEW LONG") {
      decision = "BLOCK_NEW_LONG";
    } else if (flowAction === "NO NEW SHORT") {
      decision = "BLOCK_NEW_SHORT";
    } else if (flowAction === "LONG PREP" || flowAction === "WAIT LONG") {
      decision = "PREP_LONG";
    } else if (flowAction === "SHORT PREP" || flowAction === "WAIT SHORT") {
      decision = "PREP_SHORT";
    }

    const greenCandle = close > open;
    const redCandle = close < open;

    const longPermission = flowAction === "LONG OK";
    const shortPermission = flowAction === "SHORT OK";

    const longOkEdge =
      longPermission &&
      previousFlowAction !== "LONG OK";

    const shortOkEdge =
      shortPermission &&
      previousFlowAction !== "SHORT OK";

    // READY bleibt erhalten, bis die passende Kerze kommt.
    // Damit geht ein LONG-/SHORT-Edge nicht verloren, nur weil die Edge-Kerze
    // selbst noch die falsche Farbe hatte.
    if (longPermission) {
      pendingSide = "long";
    } else if (shortPermission) {
      pendingSide = "short";
    }

    // Eine klare Gegenrichtung verwirft ein noch nicht ausgelöstes Setup.
    const clearLongContext =
      flowAction === "LONG OK" ||
      flowAction === "WATCH LONG" ||
      flowAction === "LONG PREP" ||
      flowAction === "WAIT LONG" ||
      flowAction === "HOLD LONG";

    const clearShortContext =
      flowAction === "SHORT OK" ||
      flowAction === "WATCH SHORT" ||
      flowAction === "SHORT PREP" ||
      flowAction === "WAIT SHORT" ||
      flowAction === "HOLD SHORT";

    if (pendingSide === "long" && clearShortContext) {
      pendingSide = shortPermission ? "short" : null;
    }

    if (pendingSide === "short" && clearLongContext) {
      pendingSide = longPermission ? "long" : null;
    }

    const readyLong =
      pendingSide === "long" &&
      virtualPosition !== 1;

    const readyShort =
      pendingSide === "short" &&
      virtualPosition !== -1;

    const entryLongSignal =
      readyLong &&
      greenCandle;

    const entryShortSignal =
      readyShort &&
      redCandle;

    const entrySignal =
      entryLongSignal ||
      entryShortSignal;

    const signalSide =
      entryLongSignal ? "long" :
      entryShortSignal ? "short" :
      null;

    const workerAction =
      entryLongSignal ? "BUY" :
      entryShortSignal ? "SELL" :
      "NONE";

    const signalId =
      entrySignal
        ? `v5_${String(candle.time)}_${signalSide}`
        : null;

    let entryState = "WATCH";

    if (entryLongSignal) {
      entryState = "TRIGGER_LONG";
      virtualPosition = 1;
      pendingSide = null;
    } else if (entryShortSignal) {
      entryState = "TRIGGER_SHORT";
      virtualPosition = -1;
      pendingSide = null;
    } else if (readyLong) {
      entryState = "READY_LONG";
    } else if (readyShort) {
      entryState = "READY_SHORT";
    } else if (virtualPosition === 1) {
      entryState = "POSITION_LONG";
    } else if (virtualPosition === -1) {
      entryState = "POSITION_SHORT";
    } else if (
      flowAction === "WATCH LONG" ||
      flowAction === "LONG PREP" ||
      flowAction === "WAIT LONG"
    ) {
      entryState = "WATCH_LONG";
    } else if (
      flowAction === "WATCH SHORT" ||
      flowAction === "SHORT PREP" ||
      flowAction === "WAIT SHORT"
    ) {
      entryState = "WATCH_SHORT";
    }

    const entryStateChanged =
      entryState !== previousEntryState;

    const positionSide =
      virtualPosition === 1 ? "long" :
      virtualPosition === -1 ? "short" :
      "flat";

    const decisionReasons = [];
    const decisionWarnings = [];

    if (regime === "TREND") {
      decisionReasons.push("Regime ist TREND");
    } else if (regime === "RANGE") {
      decisionWarnings.push("Regime ist RANGE");
    }

    if (phase === "EXPANSION") {
      decisionReasons.push("Phase ist EXPANSION");
    } else if (phase === "COMPRESSION") {
      decisionWarnings.push("Markt ist in COMPRESSION");
    } else if (phase === "PULLBACK") {
      decisionWarnings.push("Markt ist im PULLBACK");
    } else if (phase === "EXHAUSTION") {
      decisionWarnings.push("Trend zeigt EXHAUSTION");
    }

    if (direction === "UP") {
      decisionReasons.push("Richtung ist UP");
    } else if (direction === "DOWN") {
      decisionReasons.push("Richtung ist DOWN");
    } else {
      decisionWarnings.push("Richtung ist RANGE");
    }

    if (trendScore !== null && trendScore >= 65) {
      decisionReasons.push("Trend ist stark");
    } else if (trendScore !== null && trendScore < 45) {
      decisionWarnings.push("Trend ist schwach");
    }

    if (momentumScore !== null && momentumScore >= 65) {
      decisionReasons.push("Momentum ist stark");
    } else if (momentumScore !== null && momentumScore < 45) {
      decisionWarnings.push("Momentum ist schwach");
    }

    if (energyScore !== null && energyScore >= 45) {
      decisionReasons.push("Energy ist ausreichend");
    } else if (energyScore !== null) {
      decisionWarnings.push("Energy ist niedrig");
    }

    if (structureScore !== null && structureScore >= 80) {
      decisionReasons.push("Structure ist klar");
    } else if (structureScore !== null && structureScore < 60) {
      decisionWarnings.push("Structure ist unklar");
    }

    if (compressionScore !== null && compressionScore >= 62) {
      decisionWarnings.push("Compression ist hoch");
    }

    if (exhaustionScore !== null && exhaustionScore >= 65) {
      decisionWarnings.push("Exhaustion ist hoch");
    }

    if (momentumRising) {
      decisionReasons.push("Momentum steigt");
    } else if (momentumFalling) {
      decisionWarnings.push("Momentum fällt");
    }

    if (energyRising) {
      decisionReasons.push("Energy steigt");
    } else if (energyFalling) {
      decisionWarnings.push("Energy fällt");
    }

    if (entryLongSignal) {
      decisionReasons.push("READY LONG + grüne Kerze = BUY");
    }

    if (entryShortSignal) {
      decisionReasons.push("READY SHORT + rote Kerze = SELL");
    }

    if (readyLong && !greenCandle) {
      decisionWarnings.push("READY LONG wartet auf grüne Kerze");
    }

    if (readyShort && !redCandle) {
      decisionWarnings.push("READY SHORT wartet auf rote Kerze");
    }

    if (longOkEdge && !greenCandle) {
      decisionReasons.push("LONG-Setup wurde als READY gespeichert");
    }

    if (shortOkEdge && !redCandle) {
      decisionReasons.push("SHORT-Setup wurde als READY gespeichert");
    }

    const decisionConfidence = clamp(
      Number(dnaQuality) * 0.55 +
      Number(regimeConfidence || 0) * 0.20 +
      Number(phaseConfidence || 0) * 0.25
    );

    const workerReady =
      entrySignal &&
      decisionConfidence >= 50 &&
      signalId !== null;

    previousFlowAction = flowAction;
    previousEntryState = entryState;

    if (directionValue !== null) previousDirectionValue = directionValue;
    if (momentumScore !== null) previousMomentumScore = momentumScore;
    if (energyScore !== null) previousEnergyScore = energyScore;
    if (volatilityScore !== null) previousVolatilityScore = volatilityScore;

    return {
      time: Number(candle.time),
      open,
      high,
      low,
      close,

      sma_fast: smaFastNow,
      sma_slow: smaSlowNow,
      atr: atrNow,
      atr_avg: atrAvgNow,
      rsi: rsiNow,
      macd: macdNow,
      macd_signal: macdSignalNow,
      macd_histogram: histogramNow,
      stdev: stdevNow,
      stdev_avg: stdevAvgNow,

      trend: trendScore,
      momentum: momentumScore,
      energy: energyScore,
      volatility: volatilityScore,
      compression: compressionScore,
      structure: structureScore,
      structure_bull: structureBull,
      structure_bear: structureBear,
      direction,
      direction_value: directionValue,
      balance: balanceScore,
      trend_age_bars: trendAgeBars,
      trend_age: trendAgeScore,
      pullback: pullbackScore,
      exhaustion: exhaustionScore,

      trend_regime_score: trendRegimeScore,
      range_regime_score: rangeRegimeScore,
      regime,
      regime_confidence: regimeConfidence,

      is_compression: isCompression,
      is_expansion: isExpansion,
      is_pullback: isPullback,
      is_exhaustion: isExhaustion,

      phase_previous: previousPhase,
      phase,
      phase_candidate: candidatePhase,
      phase_switched: canSwitch,
      phase_confidence: phaseConfidence,
      compression_power: compressionPower,
      expansion_power: expansionPower,
      pullback_power: pullbackPower,
      exhaustion_power: exhaustionPower,

      dna,
      market_dna: marketDna,
      dna_action: dnaAction,
      dna_flow: dnaFlow,
      action: flowAction,
      dna_quality: dnaQuality,
      quality_grade: qualityGrade,
      quality_label: qualityLabel,

      decision,
      decision_confidence: decisionConfidence,
      decision_reasons: decisionReasons,
      decision_warnings: decisionWarnings,

      long_permission: longPermission,
      short_permission: shortPermission,
      long_ok_edge: longOkEdge,
      short_ok_edge: shortOkEdge,
      green_candle: greenCandle,
      red_candle: redCandle,

      entry_long_signal: entryLongSignal,
      entry_short_signal: entryShortSignal,
      entry_signal: entrySignal,
      signal_side: signalSide,
      signal_id: signalId,

      entry_state: entryState,
      entry_state_changed: entryStateChanged,
      pending_side: pendingSide,
      position_side: positionSide,
      virtual_position: virtualPosition,
      ready_long: readyLong,
      ready_short: readyShort,

      worker_action: workerAction,
      worker_ready: workerReady,

      momentum_falling: momentumFalling,
      energy_falling: energyFalling,
      volatility_falling: volatilityFalling,
      momentum_rising: momentumRising,
      energy_rising: energyRising,
      volatility_rising: volatilityRising,

      // Zusätzliche Diagnosewerte für den 1:1-Abgleich mit Pine.
      trend_slope_component: trendSlope,
      trend_curve_component: trendCurve,
      price_distance_component: priceDist,
      ma_alignment_component: maAlign,
      rsi_speed: rsiSpeed,
      rsi_acceleration: rsiAccel,
      histogram_speed: histogramSpeed,
      body_pct: bodyPct,
      wick_pct: wickPct,
    };
  });

  const latest = rows.length ? rows[rows.length - 1] : null;

  return {
    config,
    rows,
    latest,

    // Kompakter Worker-Vertrag.
    worker: latest
      ? {
          time: latest.time,
          action: latest.worker_action,
          ready: latest.worker_ready,
          side: latest.signal_side,
          entry_state: latest.entry_state,
          pending_side: latest.pending_side,
          position_side: latest.position_side,
          signal_id: latest.signal_id,
          decision: latest.decision,
          confidence: latest.decision_confidence,
          source_action: latest.action,
          dna: latest.dna,
          quality: latest.dna_quality,
          quality_grade: latest.quality_grade,
          reasons: latest.decision_reasons,
          warnings: latest.decision_warnings,
        }
      : null,
  };
}
