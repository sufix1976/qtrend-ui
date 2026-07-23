import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSharedMarket } from "./useSharedMarket";
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["BTCUSD","ETHUSD","DE40","US100","US30","J225","UK100","GOLD","SILVER","OIL_CRUDE","CORN"];
const INTERVALS = ["1m","3m","5m","10m","15m","30m","1h"];

type Candle = { time:number; open:number; high:number; low:number; close:number };
type Profile = {
  macd_fast:number; macd_slow:number; macd_signal:number;
  rsi_length:number; rsi_signal:number;
  long_zone_sigma:number; short_zone_sigma:number; z_window:number;
  protect_min_hold_bars:number; exit_htf_minutes:number; exit_timing_minutes:number;
  exit_rsi_lower:number; exit_rsi_upper:number;
};
type LiveEvent = { type:"entry"|"exit"; direction?:"long"|"short"; time:number; price:number; reason?:string; exit_type?:string };
type LiveState = {
  mode:string; params:Profile; events:LiveEvent[];
  indicators:Array<{time:number;macd:number;signal:number;histogram:number;rsi:number;rsi_signal:number;htf_rsi:number;exit_timing_rsi:number;z_score:number}>;
  current?:{macd:number;signal:number;histogram:number;rsi:number;rsi_signal:number;htf_rsi:number;exit_timing_rsi:number;z_score:number};
  final_state?:{position:string;long_armed:boolean;short_armed:boolean;exit_armed:boolean;long_extreme_active:boolean;short_extreme_active:boolean};
  metrics?:{trades:number;profit_factor:number;net:number;max_drawdown:number};
};

const DEFAULT_PROFILE: Profile = {
  macd_fast:10, macd_slow:20, macd_signal:9,
  rsi_length:14, rsi_signal:9,
  long_zone_sigma:-1.5, short_zone_sigma:1.5, z_window:200,
  protect_min_hold_bars:3, exit_htf_minutes:60, exit_timing_minutes:15,
  exit_rsi_lower:30, exit_rsi_upper:70,
};

async function fetchJson(url:string, init?:RequestInit) {
  const response = await fetch(url, { cache:"no-store", ...init });
  const text = await response.text();
  let json:any;
  try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0,180)}`); }
  if (!response.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${response.status}`);
  return json;
}

async function fetchOptional(url:string) {
  try { return await fetchJson(url); } catch { return null; }
}

function ha(candles:Candle[]) {
  if (!candles.length) return [];
  const out:Candle[]=[];
  let prevOpen=(candles[0].open+candles[0].close)/2;
  let prevClose=(candles[0].open+candles[0].high+candles[0].low+candles[0].close)/4;
  out.push({time:candles[0].time,open:prevOpen,close:prevClose,high:Math.max(candles[0].high,prevOpen,prevClose),low:Math.min(candles[0].low,prevOpen,prevClose)});
  for(let i=1;i<candles.length;i++){
    const c=candles[i]; const close=(c.open+c.high+c.low+c.close)/4; const open=(prevOpen+prevClose)/2;
    out.push({time:c.time,open,close,high:Math.max(c.high,open,close),low:Math.min(c.low,open,close)});
    prevOpen=open; prevClose=close;
  }
  return out;
}

function color(side?:string){ const s=String(side||"").toLowerCase(); return s==="long"?"#22c55e":s==="short"?"#ef4444":"#cbd5e1"; }
function badge(active:boolean, activeColor="#22c55e"):CSSProperties { return {padding:"7px 10px",borderRadius:8,border:`1px solid ${active?activeColor:"#334155"}`,background:active?`${activeColor}22`:"#0d1423",color:active?activeColor:"#94a3b8",fontWeight:800,fontSize:12}; }

export default function ExtremeLiveCockpit({ chartOnly = false }: { chartOnly?: boolean }){
  const { symbol, interval, setSymbol, setInterval } = useSharedMarket();
  const [chartMode,setChartMode]=useState<"heikin"|"candles">("heikin");
  const [candles,setCandles]=useState<Candle[]>([]); const [live,setLive]=useState<LiveState|null>(null);
  const [profile,setProfile]=useState<Profile>(DEFAULT_PROFILE); const [snapshot,setSnapshot]=useState<any>(null);
  const [profiles,setProfiles]=useState<any[]>([]); const [activeProfileId,setActiveProfileId]=useState("");
  const [mirror,setMirror]=useState<any>(null); const [mirrorBusy,setMirrorBusy]=useState(false);
  const [risk,setRisk]=useState<any>(null); const [riskInput,setRiskInput]=useState("0");
  const [dbInfo,setDbInfo]=useState<any>(null); const [brokerLog,setBrokerLog]=useState<any[]>([]);
  const [size,setSize]=useState(1); const [auto,setAuto]=useState(false); const [status,setStatus]=useState("Verbinden …");
  const priceHost=useRef<HTMLDivElement>(null); const macdHost=useRef<HTMLDivElement>(null); const rsiHost=useRef<HTMLDivElement>(null);
  const priceChart=useRef<IChartApi|null>(null); const macdChart=useRef<IChartApi|null>(null); const rsiChart=useRef<IChartApi|null>(null);
  const candleSeries=useRef<ISeriesApi<"Candlestick">|null>(null); const markerApi=useRef<any>(null);
  const macdLine=useRef<ISeriesApi<"Line">|null>(null); const signalLine=useRef<ISeriesApi<"Line">|null>(null); const hist=useRef<ISeriesApi<"Histogram">|null>(null);
  const rsiLine=useRef<ISeriesApi<"Line">|null>(null); const rsiSignalLine=useRef<ISeriesApi<"Line">|null>(null); const htfLine=useRef<ISeriesApi<"Line">|null>(null); const timingLine=useRef<ISeriesApi<"Line">|null>(null);
  const shownCandles=useMemo(()=>chartMode==="heikin"?ha(candles):candles,[candles,chartMode]);

  useEffect(()=>{
    if(!priceHost.current||!macdHost.current||!rsiHost.current) return;
    const common={layout:{background:{color:"#070b16"},textColor:"#dbe4ff"},grid:{vertLines:{color:"#172033"},horzLines:{color:"#172033"}},crosshair:{mode:CrosshairMode.Normal},rightPriceScale:{borderColor:"#334155",minimumWidth:72},timeScale:{borderColor:"#334155",timeVisible:true},autoSize:true} as const;
    const pc=createChart(priceHost.current,common); const mc=createChart(macdHost.current,common); const rc=createChart(rsiHost.current,common);
    const cs=pc.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",wickUpColor:"#22c55e",wickDownColor:"#ef4444",borderVisible:false});
    const ml=mc.addSeries(LineSeries,{color:"#60a5fa",lineWidth:2}); const sl=mc.addSeries(LineSeries,{color:"#facc15",lineWidth:2}); const hg=mc.addSeries(HistogramSeries,{});
    const rl=rc.addSeries(LineSeries,{color:"#a855f7",lineWidth:2}); const rsl=rc.addSeries(LineSeries,{color:"#facc15",lineWidth:2}); const hl=rc.addSeries(LineSeries,{color:"#38bdf8",lineWidth:3}); const tl=rc.addSeries(LineSeries,{color:"#e879f9",lineWidth:2});
    markerApi.current=createSeriesMarkers(cs,[]); priceChart.current=pc;macdChart.current=mc;rsiChart.current=rc;candleSeries.current=cs;macdLine.current=ml;signalLine.current=sl;hist.current=hg;rsiLine.current=rl;rsiSignalLine.current=rsl;htfLine.current=hl;timingLine.current=tl;
    let syncing=false; const sync=(source:IChartApi, a:IChartApi,b:IChartApi)=>source.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(!range||syncing)return;syncing=true;a.timeScale().setVisibleLogicalRange(range);b.timeScale().setVisibleLogicalRange(range);syncing=false;});
    sync(pc,mc,rc);sync(mc,pc,rc);sync(rc,pc,mc);
    return()=>{pc.remove();mc.remove();rc.remove();};
  },[]);

  useEffect(()=>{
    candleSeries.current?.setData(shownCandles.map(c=>({...c,time:c.time as Time})));
    if(!live) return;
    const rows=live.indicators||[];
    macdLine.current?.setData(rows.map(x=>({time:x.time as Time,value:x.macd})));
    signalLine.current?.setData(rows.map(x=>({time:x.time as Time,value:x.signal})));
    hist.current?.setData(rows.map(x=>({time:x.time as Time,value:x.histogram,color:x.histogram>=0?"rgba(34,197,94,.65)":"rgba(239,68,68,.65)"})));
    rsiLine.current?.setData(rows.map(x=>({time:x.time as Time,value:x.rsi})));
    rsiSignalLine.current?.setData(rows.map(x=>({time:x.time as Time,value:x.rsi_signal})));
    htfLine.current?.setData(rows.map(x=>({time:x.time as Time,value:x.htf_rsi})));
    timingLine.current?.setData(rows.map(x=>({time:x.time as Time,value:x.exit_timing_rsi})));
    markerApi.current?.setMarkers((live.events||[]).map(e=>e.type==="entry"?{time:e.time as Time,position:e.direction==="long"?"belowBar":"aboveBar",color:color(e.direction),shape:e.direction==="long"?"arrowUp":"arrowDown",text:e.direction?.toUpperCase()||"ENTRY",size:1.2}:{time:e.time as Time,position:"aboveBar",color:"#facc15",shape:"circle",text:"EXIT",size:0.9}).sort((a:any,b:any)=>Number(a.time)-Number(b.time)));
  },[shownCandles,live]);

  async function load(){
    try{
      const [c,s,p,l,cfg,profileList,riskInfo,dbStatus,execInfo,signalInfo]=await Promise.all([
        fetchJson(`${BACKEND_BASE}/v5/candles?symbol=${symbol}&interval=${interval}&limit=1500&_ts=${Date.now()}`),
        fetchJson(`${BACKEND_BASE}/v5/state?symbol=${symbol}&interval=${interval}&_ts=${Date.now()}`),
        fetchJson(`${BACKEND_BASE}/qmomentum/extreme-live/profile?symbol=${symbol}&interval=${interval}&_ts=${Date.now()}`),
        fetchJson(`${BACKEND_BASE}/qmomentum/extreme-live/state?symbol=${symbol}&interval=${interval}&limit=1500&_ts=${Date.now()}`),
        fetchJson(`${BACKEND_BASE}/v5/config?symbol=${symbol}&interval=${interval}&_ts=${Date.now()}`),
        fetchJson(`${BACKEND_BASE}/qmomentum/extreme-profiles?symbol=${symbol}&interval=${interval}&_ts=${Date.now()}`),
        fetchOptional(`${BACKEND_BASE}/risk/position-loss?_ts=${Date.now()}`),
        fetchOptional(`${BACKEND_BASE}/debug/db?_ts=${Date.now()}`),
        fetchOptional(`${BACKEND_BASE}/db/executions?_ts=${Date.now()}`),
        fetchOptional(`${BACKEND_BASE}/db/signals?_ts=${Date.now()}`),
      ]);
      setCandles(Array.isArray(c.candles)?c.candles:[]);setSnapshot(s.state||null);setProfile({...DEFAULT_PROFILE,...p.params});setLive(l);setProfiles(Array.isArray(profileList.profiles)?profileList.profiles:[]);
      if(riskInfo){setRisk(riskInfo);setRiskInput(String(riskInfo.max_position_loss_eur??0));}
      if(dbStatus)setDbInfo(dbStatus);
      const signals=new Map((Array.isArray(signalInfo?.rows)?signalInfo.rows:[]).map((row:any)=>[row.signal_id,row]));
      const recent=(Array.isArray(execInfo?.rows)?execInfo.rows:[]).filter((row:any)=>String(row.epic||"").toUpperCase()===symbol.toUpperCase()).slice(0,5).map((row:any)=>{
        const sig:any=signals.get(row.signal_id)||null; let payload:any={}; let response:any={};
        try{payload=JSON.parse(sig?.raw_payload||"{}");}catch{} try{response=JSON.parse(row.raw_response||"{}");}catch{}
        const sid=String(row.signal_id||"");
        const reason=sid.startsWith("maxloss_")||payload?.strategy==="max_position_loss"?"MAX LOSS GUARD":sid.startsWith("strategy_sync_")||payload?.source==="strategy-sync"?"POSITION SYNC":payload?.reason||payload?.source||response?.reason||"BROKER ORDER";
        return {...row,reason,signal_time:sig?.received_at||payload?.time_close||payload?.ts||null};
      });
      setBrokerLog(recent);
      const matching=(Array.isArray(profileList.profiles)?profileList.profiles:[]).find((row:any)=>JSON.stringify(row.params)===JSON.stringify(p.params)); if(matching) setActiveProfileId(matching.id);
      if(cfg?.row){setSize(Number(cfg.row.size||1));setAuto(Boolean(cfg.row.auto_enabled));}
      setStatus("SIGNAL MIRROR verbunden · Auto-Orders noch gesperrt");
    }catch(e){setStatus(`Fehler: ${e instanceof Error?e.message:String(e)}`);}
  }
  useEffect(()=>{void load();const t=window.setInterval(()=>void load(),30000);return()=>window.clearInterval(t);},[symbol,interval]);

  async function activateProfile(id:string){try{const x=await fetchJson(`${BACKEND_BASE}/qmomentum/extreme-profiles/activate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});setActiveProfileId(id);setProfile({...DEFAULT_PROFILE,...x.profile.params});setStatus(`Aktives Profil: ${x.profile.name}`);await load();}catch(e){setStatus(`Profil laden fehlgeschlagen: ${e instanceof Error?e.message:String(e)}`);}}
  async function runMirror(){
    if(!activeProfileId){setStatus("Bitte gespeichertes Profil auswählen");return;}
    try{setMirrorBusy(true);setStatus("Mirror-Test läuft …");const x=await fetchJson(`${BACKEND_BASE}/qmomentum/extreme-live/mirror?id=${encodeURIComponent(activeProfileId)}&_ts=${Date.now()}`);setMirror(x);setStatus(x.compare?.identical?"Mirror-Test: IDENTISCH":"Mirror-Test: DIFFERENZ gefunden");}catch(e){setStatus(`Mirror-Test fehlgeschlagen: ${e instanceof Error?e.message:String(e)}`);}finally{setMirrorBusy(false);}
  }
  async function saveProfile(){try{await fetchJson(`${BACKEND_BASE}/qmomentum/extreme-live/profile`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,interval,params:profile})});setStatus("V7.4 Profil gespeichert");await load();}catch(e){setStatus(`Profilfehler: ${e instanceof Error?e.message:String(e)}`);}}
  async function saveExecution(nextAuto=auto){try{await fetchJson(`${BACKEND_BASE}/v5/config`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,interval,size,auto_enabled:nextAuto})});setStatus("Ausführungskonfiguration gespeichert");}catch(e){setStatus(`Speichern fehlgeschlagen: ${e instanceof Error?e.message:String(e)}`);}}
  async function manual(side:"long"|"short"|"flat"){try{await fetchJson(`${BACKEND_BASE}/v5/manual`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,side})});setStatus(`${side.toUpperCase()} gesendet`);await load();}catch(e){setStatus(`Manuell fehlgeschlagen: ${e instanceof Error?e.message:String(e)}`);}}
  async function saveMaxLoss(value:number){
    try{
      const x=await fetchJson(`${BACKEND_BASE}/risk/position-loss`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({max_position_loss_eur:value})});
      setRisk(x);setRiskInput(String(x.max_position_loss_eur??0));setStatus(value>0?`Maximalverlust auf ${value.toFixed(2)} € gesetzt`:"Maximalverlust deaktiviert");
    }catch(e){setStatus(`Maximalverlust konnte nicht gespeichert werden: ${e instanceof Error?e.message:String(e)}`);}
  }
  const fmtTime=(value:any)=>{const n=Number(value||0);if(!n)return "–";const ms=n>1e12?n:n*1000;return new Date(ms).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});};
  const yes=(v:any)=>v?"OK":"DIFFERENZ";
  const fs=live?.final_state; const cur=live?.current; const strategy=String(fs?.position||"flat").toUpperCase(); const broker=String(snapshot?.broker_side||"flat").toUpperCase();
  const field=(key:keyof Profile,label:string,step="1")=><label style={{display:"grid",gap:4,fontSize:11,color:"#94a3b8"}}>{label}<input type="number" step={step} value={profile[key]} onChange={e=>setProfile(p=>({...p,[key]:Number(e.target.value)}))} style={input}/></label>;

  return <div style={{minHeight:"100vh",background:"#050914",color:"#eef2ff",fontFamily:"Inter,Arial,sans-serif",padding:10,boxSizing:"border-box"}}>
    <header style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",padding:"6px 8px 12px"}}>
      <b style={{fontSize:20}}>Extreme MACD V8.5 · Demo Candidate</b>
      <select value={symbol} onChange={e=>setSymbol(e.target.value)} style={input}>{SYMBOLS.map(x=><option key={x}>{x}</option>)}</select>
      <select value={interval} onChange={e=>setInterval(e.target.value)} style={input}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select>
      <button style={button(chartMode==="heikin")} onClick={()=>setChartMode("heikin")}>Heikin</button><button style={button(chartMode==="candles")} onClick={()=>setChartMode("candles")}>Kerzen</button>
      <span style={badge(Boolean(fs?.long_armed))}>LONG ARMED</span><span style={badge(Boolean(fs?.short_armed),"#ef4444")}>SHORT ARMED</span>
      <span style={badge(strategy!=="FLAT","#f59e0b")}>PROTECT {strategy!=="FLAT"?"AKTIV":"AUS"}</span><span style={badge(Boolean(fs?.exit_armed),"#a855f7")}>HTF EXIT</span>
      <span style={{...badge(true,color(strategy)),color:color(strategy)}}>POSITION {strategy}</span><span style={{...badge(true,color(broker)),color:color(broker)}}>BROKER {broker}</span>
      <span style={{fontSize:12,color:"#f59e0b",fontWeight:800}}>SIGNAL MIRROR · KEINE AUTO-ORDERS AUS V8.5</span>
    </header>
    <main style={{display:"grid",gridTemplateColumns:chartOnly?"minmax(0,1fr)":"minmax(0,1fr) 330px",gap:10,minHeight:"calc(100vh - 80px)"}}>
      <section style={{display:"grid",gridTemplateRows:"minmax(430px,58vh) 210px 210px",gap:8,minWidth:0}}>
        <div ref={priceHost} style={chartBox}/><div ref={macdHost} style={chartBox}/><div ref={rsiHost} style={chartBox}/>
      </section>
      {!chartOnly && <aside style={{display:"grid",gap:9,alignContent:"start",maxHeight:"calc(100vh - 90px)",overflowY:"auto",paddingRight:3}}>
        <Card title="POSITION / BROKER"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Hero label="POSITION" value={strategy}/><Hero label="BROKER" value={broker}/></div><div style={{display:"grid",gridTemplateColumns:"70px 1fr auto",gap:7,alignItems:"center",marginTop:10}}><span>Size</span><input type="number" step="any" value={size} onChange={e=>setSize(Number(e.target.value))} style={input}/><button style={button()} onClick={()=>void saveExecution()}>Save</button></div><button style={auto?onButton:offButton} onClick={()=>{const n=!auto;setAuto(n);void saveExecution(n);}}>AUTO {auto?"ON":"OFF"}</button><div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginTop:7}}><button style={flatButton} onClick={()=>void manual("flat")}>FLAT</button><button style={longButton} onClick={()=>void manual("long")}>LONG</button><button style={shortButton} onClick={()=>void manual("short")}>SHORT</button></div></Card>
        <Card title="BROKER INFO">{brokerLog.length?<>{brokerLog.map((row:any,index:number)=><div key={`${row.exec_id||index}`} style={{padding:index?"8px 0 0":"0",marginTop:index?8:0,borderTop:index?"1px solid #26344d":"none"}}><Row k={index===0?"Letzte Aktion":"Aktion"} v={String(row.action||"–").toUpperCase()}/><Row k="Zeit" v={fmtTime(row.executed_at)}/><Row k="Grund" v={String(row.reason||"–").toUpperCase()}/><Row k="Signal" v={String(row.signal_id||"–").slice(0,24)}/><Row k="Status" v={String(row.status??"–")}/></div>)}</>:<div style={{fontSize:12,color:"#94a3b8"}}>Noch keine Brokeraktion für {symbol} gefunden.</div>}</Card>
        <Card title="BROKER RISK"><Row k="Max. Positionsverlust" v={risk?.enabled?`${Number(risk.max_position_loss_eur).toFixed(2)} € · AKTIV`:"DEAKTIVIERT"}/><Row k="Prüfung" v={risk?.poll_ms?`${Math.round(Number(risk.poll_ms)/1000)} Sek.`:"–"}/><div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:7,marginTop:9}}><input type="number" min="0" step="1" value={riskInput} onChange={e=>setRiskInput(e.target.value)} style={input}/><button style={onButton} onClick={()=>void saveMaxLoss(Math.max(0,Number(riskInput)||0))}>SPEICHERN</button></div><button style={{...offButton,background:"#7f1d1d"}} onClick={()=>void saveMaxLoss(0)}>DEAKTIVIEREN</button><div style={{fontSize:11,color:"#94a3b8",marginTop:7}}>Dieser alte Engine-Guard schließt jede Brokerposition automatisch, sobald ihr offener Verlust den eingestellten Eurobetrag erreicht.</div></Card>
        <Card title="ENTRY"><Row k="LONG Armed" v={fs?.long_armed?"JA":"NEIN"}/><Row k="SHORT Armed" v={fs?.short_armed?"JA":"NEIN"}/><Row k="LONG Extrem" v={fs?.long_extreme_active?"AKTIV":"INAKTIV"}/><Row k="SHORT Extrem" v={fs?.short_extreme_active?"AKTIV":"INAKTIV"}/></Card>
        <Card title="PROTECT / EXIT"><Row k="Protect" v={strategy!=="FLAT"?`AKTIV ab ${profile.protect_min_hold_bars} Bars`:"INAKTIV"}/><Row k="HTF Exit" v={fs?.exit_armed?"ARMED":"WAIT"}/><Row k="Armed TF" v={`${profile.exit_htf_minutes}m`}/><Row k="Timing TF" v={`${profile.exit_timing_minutes}m`}/><Row k="Zonen" v={`${profile.exit_rsi_lower} / ${profile.exit_rsi_upper}`}/></Card>
        <Card title="LIVE"><Row k="MACD" v={cur?.macd?.toFixed(3)??"–"}/><Row k="Sigma" v={cur?.z_score?.toFixed(2)??"–"}/><Row k={`RSI ${profile.rsi_length}`} v={cur?.rsi?.toFixed(1)??"–"}/><Row k={`Timing RSI ${profile.exit_timing_minutes}m`} v={cur?.exit_timing_rsi?.toFixed(1)??"–"}/><Row k="HTF RSI" v={cur?.htf_rsi?.toFixed(1)??"–"}/><Row k="Replay PF (aktuell)" v={live?.metrics?.profit_factor?.toFixed(2)??"–"}/><Row k="Replay Trades" v={String(live?.metrics?.trades??"–")}/><Row k="Replay Zeitraum" v={candles.length?`${fmtTime(candles[0]?.time)} – ${fmtTime(candles[candles.length-1]?.time)}`:"–"}/></Card>
        <Card title="AKTIVES PROFIL"><select value={activeProfileId} onChange={e=>{setActiveProfileId(e.target.value);setMirror(null);if(e.target.value)void activateProfile(e.target.value);}} style={{...input,width:"100%"}}><option value="">Aktives Engine-Profil</option>{profiles.map((row:any)=><option key={row.id} value={row.id}>{row.name}</option>)}</select>{(()=>{const p=profiles.find((row:any)=>row.id===activeProfileId);const m=p?.result?.best?.metrics;const meta=p?.result?.mirror_meta;return p?<div style={{marginTop:8}}><Row k="Profil PF" v={m?.profit_factor?.toFixed?.(2)??"–"}/><Row k="Profil Trades" v={String(m?.trades??"–")}/><Row k="Profil Zeitraum" v={meta?`${fmtTime(meta.start_time)} – ${fmtTime(meta.end_time)}`:"älteres Profil ohne Zeitraum"}/></div>:null;})()}<button style={{...onButton,width:"100%",marginTop:9}} disabled={!activeProfileId||mirrorBusy} onClick={()=>void runMirror()}>{mirrorBusy?"MIRROR LÄUFT …":"MIRROR TEST"}</button><div style={{fontSize:11,color:"#94a3b8",marginTop:7}}>{profiles.length} gespeicherte Profile für {symbol} {interval}</div></Card>
        {mirror&&<Card title="MIRROR VALIDATION"><Row k="Gesamt" v={mirror.compare?.identical?"IDENTISCH":"DIFFERENZ"}/><Row k="Kerzen" v={yes(mirror.compare?.candles_match)}/><Row k="PF" v={`${mirror.profile?.metrics?.profit_factor?.toFixed?.(2)??"–"} / ${mirror.replay?.metrics?.profit_factor?.toFixed?.(2)??"–"} · ${yes(mirror.compare?.pf_match)}`}/><Row k="Trades" v={`${mirror.profile?.metrics?.trades??"–"} / ${mirror.replay?.metrics?.trades??"–"} · ${yes(mirror.compare?.trades_match)}`}/><Row k="Netto" v={yes(mirror.compare?.net_match)}/><Row k="Drawdown" v={yes(mirror.compare?.drawdown_match)}/><Row k="Entries" v={`${mirror.compare?.profile_entry_count??0} / ${mirror.compare?.replay_entry_count??0}`}/><Row k="Exits" v={`${mirror.compare?.profile_exit_count??0} / ${mirror.compare?.replay_exit_count??0}`}/><Row k="Marker" v={yes(mirror.compare?.markers_match)}/><Row k="Profilzeitraum" v={`${fmtTime(mirror.profile?.range?.start_time)} – ${fmtTime(mirror.profile?.range?.end_time)}`}/><Row k="Replayzeitraum" v={`${fmtTime(mirror.replay?.range?.start_time)} – ${fmtTime(mirror.replay?.range?.end_time)}`}/></Card>}
        <Card title="SYSTEM / DATENBANK"><Row k="Datenbank" v={dbInfo?.db_exists?"OK":"NICHT GEFUNDEN"}/><Row k="Pfad" v={String(dbInfo?.db_path||"–")}/><Row k="Größe" v={dbInfo?.db_size_bytes!=null?`${(Number(dbInfo.db_size_bytes)/1024/1024).toFixed(1)} MB`:"–"}/><Row k="Profile" v={String(dbInfo?.counts?.extreme_profile_snapshots??"–")}/><Row k="Aktive Profile" v={String(dbInfo?.counts?.extreme_live_profiles??"–")}/><Row k="Kerzen" v={String(dbInfo?.counts?.candles??"–")}/><Row k="Trades" v={String(dbInfo?.counts?.trades??"–")}/><Row k="Speicherort" v={String(dbInfo?.db_path||"").startsWith("/var/data/")?"RENDER /var/data":"PRÜFEN"}/></Card>
        <Card title="V8.5 PROFIL"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>{field("macd_fast","MACD Fast")}{field("macd_slow","MACD Slow")}{field("rsi_length","RSI Länge")}{field("long_zone_sigma","LONG Sigma","0.25")}{field("short_zone_sigma","SHORT Sigma","0.25")}{field("exit_htf_minutes","Exit Armed TF")}{field("exit_timing_minutes","Exit Timing TF")}{field("exit_rsi_lower","RSI unten")}{field("exit_rsi_upper","RSI oben")}</div><button style={{...onButton,width:"100%",marginTop:9}} onClick={()=>void saveProfile()}>PROFIL SPEICHERN</button></Card>
        <div style={{fontSize:11,color:"#94a3b8",padding:6}}>{status}</div>
      </aside>}
    </main>
  </div>;
}

function Card({title,children}:{title:string;children:ReactNode}){return <section style={{background:"linear-gradient(180deg,#111a2b,#0b1220)",border:"1px solid #26344d",borderRadius:10,padding:11,boxShadow:"0 8px 22px rgba(0,0,0,.25)"}}><h3 style={{margin:"0 0 9px",fontSize:13,letterSpacing:.7,color:"#dbeafe"}}>{title}</h3>{children}</section>}
function Hero({label,value}:{label:string;value:string}){return <div style={{background:"#08101d",border:"1px solid #26344d",borderRadius:8,padding:9,textAlign:"center"}}><small style={{color:"#94a3b8"}}>{label}</small><div style={{fontSize:22,fontWeight:900,color:color(value),marginTop:3}}>{value}</div></div>}
function Row({k,v}:{k:string;v:string}){return <div style={{display:"flex",justifyContent:"space-between",gap:8,padding:"5px 0",borderBottom:"1px solid #1e293b",fontSize:12}}><span style={{color:"#94a3b8"}}>{k}</span><b>{v}</b></div>}
const input:CSSProperties={background:"#08101d",color:"#eef2ff",border:"1px solid #334155",borderRadius:7,padding:"7px 8px",minWidth:0};
const chartBox:CSSProperties={background:"#070b16",border:"1px solid #26344d",borderRadius:8,overflow:"hidden",minHeight:0};
const button=(active=false):CSSProperties=>({background:active?"#1d4ed8":"#111827",color:"#eef2ff",border:"1px solid #334155",borderRadius:7,padding:"7px 10px",fontWeight:800,cursor:"pointer"});
const onButton:CSSProperties={...button(true),background:"#0f766e"}; const offButton:CSSProperties={...button(),width:"100%",marginTop:8};
const flatButton:CSSProperties={...button(),background:"#334155"}; const longButton:CSSProperties={...button(),background:"#166534"}; const shortButton:CSSProperties={...button(),background:"#991b1b"};
