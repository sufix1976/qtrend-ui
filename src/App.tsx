import { useEffect, useState } from "react";
import Cockpit from "./ExtremeLiveCockpit";
import "./App.css";
import Trainer from "./Trainer";
import QMomentumLab from "./QMomentumLab";

type ViewMode = "cockpit" | "trainer" | "momentum";

function readView(): ViewMode {
  const view = new URLSearchParams(window.location.search).get("view");

  if (view === "trainer") return "trainer";
  if (view === "momentum") return "momentum";

  return "cockpit";
}

export default function App() {
  const [view, setView] = useState<ViewMode>(() => readView());

  useEffect(() => {
    const handleNavigation = () => setView(readView());

    window.addEventListener("popstate", handleNavigation);

    return () => {
      window.removeEventListener("popstate", handleNavigation);
    };
  }, []);

  if (view === "trainer") {
    return <Trainer />;
  }

  if (view === "momentum") {
    return <QMomentumLab />;
  }

  return (
    <>
      <Cockpit />

      <a className="trainer-fab" href="/?view=trainer">
        TRAINER
      </a>

      <a className="momentum-fab" href="/?view=momentum">
        MOMENTUM LAB
      </a>
    </>
  );
}
