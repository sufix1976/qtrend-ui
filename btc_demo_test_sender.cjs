#!/usr/bin/env node
/**
 * Simple BTCUSD demo test sender for qtrend-trading-engine
 *
 * Usage:
 *   node btc_demo_test_sender.cjs buy
 *   node btc_demo_test_sender.cjs sell
 *
 * Optional env:
 *   BACKEND_BASE=https://qtrend-trading-engine.onrender.com
 *   SIZE=1
 *   WEBHOOK_SECRET=...
 *   TF=15m
 */

const BACKEND_BASE = process.env.BACKEND_BASE || "https://qtrend-trading-engine.onrender.com";
const SIZE = Number(process.env.SIZE || 1);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const TF = process.env.TF || "15m";

const action = (process.argv[2] || "buy").toLowerCase();

if (!["buy", "sell", "close_buy", "close_sell"].includes(action)) {
  console.error("Invalid action. Use: buy | sell | close_buy | close_sell");
  process.exit(1);
}

async function main() {
  const url = `${BACKEND_BASE}/webhook`;
  const signalId = `BTC_TEST_${action.toUpperCase()}_${Date.now()}`;

  const body = {
    symbol: "BTCUSD",
    action,
    size: SIZE,
    tf: TF,
    signal_id: signalId,
    source: "manual_btc_test",
    strategy: "MANUAL_BTC_TEST"
  };

  const headers = {
    "Content-Type": "application/json"
  };

  if (WEBHOOK_SECRET) {
    headers["x-webhook-secret"] = WEBHOOK_SECRET;
  }

  console.log("POST", url);
  console.log("BODY", JSON.stringify(body, null, 2));

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const text = await res.text();
  console.log("STATUS", res.status);

  try {
    console.log("RESPONSE", JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log("RESPONSE", text);
  }
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
