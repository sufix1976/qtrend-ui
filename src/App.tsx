import { useEffect, useState } from "react";
import ExtremeLiveCockpit from "./ExtremeLiveCockpit";
import QMomentumLab from "./QMomentumLab";
import ADTrendLab from "./ADTrendLab";
import Trainer from "./Trainer";
import ProfileLab from "./ProfileLab";
import ExitLab from "./ExitLab";
import "./App.css";

type View = "chart" | "lab" | "adlab" | "profilelab" | "exitlab" | "cockpit" | "trainer" | "momentum" | "settings";

function readView(): View {
  const raw = new URLSearchParams(window.location.search).get("view");
  if (raw === "lab" || raw === "adlab" || raw === "profilelab" || raw === "exitlab" || raw === "cockpit" || raw === "trainer" || raw === "momentum" || raw === "settings") return raw;
  return "chart";
}

function navigate(view: View) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", view);
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  const [view, setView] = useState<View>(() => readView());
  useEffect(() => {
    const sync = () => setView(readView());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return (
    <div className="v8-shell">
      <nav className="v8-nav">
        <div className="v8-brand"><b>QTrend V11.0 Dual Exit Research</b><small>Eine Plattform · ein Profil · eine Logik</small></div>
        <div className="v8-tabs">
          {(["chart","lab","adlab","profilelab","exitlab","cockpit","trainer","momentum","settings"] as View[]).map(item => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => navigate(item)}>{item === "adlab" ? "AD LAB" : item === "profilelab" ? "PROFILE LAB" : item === "exitlab" ? "EXIT LAB" : item.toUpperCase()}</button>
          ))}
        </div>
      </nav>
      <section className="v8-content">
        {view === "chart" && <ExtremeLiveCockpit chartOnly />}
        {view === "lab" && <QMomentumLab />}
        {view === "adlab" && <ADTrendLab />}
        {view === "profilelab" && <ProfileLab />}
        {view === "exitlab" && <ExitLab />}
        {view === "cockpit" && <ExtremeLiveCockpit />}
        {view === "trainer" && <Trainer />}
        {view === "momentum" && <Placeholder title="MOMENTUM" text="Momentum AI bleibt als eigenes Forschungsmodul erhalten. V8.0 verbindet zunächst LAB und COCKPIT." />}
        {view === "settings" && <Placeholder title="SETTINGS" text="Profile werden jetzt persistent gespeichert und zwischen LAB, COCKPIT und Engine geteilt. Broker, Telegram und Layout folgen schrittweise." />}
      </section>
    </div>
  );
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return <div className="v8-placeholder"><h1>{title}</h1><p>{text}</p></div>;
}
