import { useEffect, useState } from "react";

export type SharedMarket = { symbol: string; interval: string };
const KEY = "qtrend:v8:market";
const EVENT = "qtrend:v8:market-change";
const DEFAULT_VALUE: SharedMarket = { symbol: "BTCUSD", interval: "15m" };

function read(): SharedMarket {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
    return {
      symbol: String(parsed?.symbol || DEFAULT_VALUE.symbol),
      interval: String(parsed?.interval || DEFAULT_VALUE.interval),
    };
  } catch {
    return DEFAULT_VALUE;
  }
}

function write(next: SharedMarket) {
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

export function useSharedMarket() {
  const [market, setMarket] = useState<SharedMarket>(() => read());

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<SharedMarket>).detail;
      setMarket(detail || read());
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setSymbol = (symbol: string) => {
    const next = { ...market, symbol };
    setMarket(next);
    write(next);
  };
  const setInterval = (interval: string) => {
    const next = { ...market, interval };
    setMarket(next);
    write(next);
  };

  return { symbol: market.symbol, interval: market.interval, setSymbol, setInterval };
}
