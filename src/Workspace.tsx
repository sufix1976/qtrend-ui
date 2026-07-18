import { useState } from "react";
import NormalChart from "./App.test.v6";
import Trainer from "./Trainer";
import KiEntries from "./KiEntries";
import FlipKi from "./FlipKi";
import QMomentumLab from "./QMomentumLab";

type View = "chart" | "trainer" | "ki" | "flip" | "momentum";

function readInitialView(): View {
  const queryView = new URLSearchParams(window.location.search).get("view");

  if (queryView === "momentum") return "momentum";
  if (queryView === "trainer") return "trainer";
  if (queryView === "ki") return "ki";
  if (queryView === "flip") return "flip";

  const stored = sessionStorage.getItem("qtrend_view") as View | null;

  if (
    stored === "chart" ||
    stored === "trainer" ||
    stored === "ki" ||
    stored === "flip" ||
    stored === "momentum"
  ) {
    return stored;
  }

  return "chart";
}

export default function Workspace() {
  const [view, setView] = useState<View>(() => readInitialView());

  function open(next: View) {
    setView(next);
    sessionStorage.setItem("qtrend_view", next);
  }

  return (
    <div className="qtrend-workspace">
      <nav className="qtrend-window-tabs">
        <button
          className={view === "chart" ? "active" : ""}
          onClick={() => open("chart")}
        >
          CHART
        </button>

        <button
          className={view === "trainer" ? "active" : ""}
          onClick={() => open("trainer")}
        >
          TRAINER
        </button>

        <button
          className={view === "ki" ? "active" : ""}
          onClick={() => open("ki")}
        >
          KI-ENTRYS
        </button>

        <button
          className={view === "flip" ? "active" : ""}
          onClick={() => open("flip")}
        >
          FLIP-KI
        </button>

        <button
          className={view === "momentum" ? "active" : ""}
          onClick={() => open("momentum")}
        >
          MOMENTUM
        </button>
      </nav>

      <div className="qtrend-window-body">
        {view === "chart" ? (
          <NormalChart />
        ) : view === "trainer" ? (
          <Trainer />
        ) : view === "ki" ? (
          <KiEntries />
        ) : view === "flip" ? (
          <FlipKi />
        ) : (
          <QMomentumLab />
        )}
      </div>
    </div>
  );
}
