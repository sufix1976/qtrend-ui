import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useSharedMarket } from "./useSharedMarket";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["BTCUSD","ETHUSD","DE40","US100","US30","J225","UK100","GOLD","SILVER","OIL_CRUDE","CORN"];
const INTERVALS = ["1m","5m","10m","15m","30m","1h"];

type Candle = { time:number; open:number; high:number; low:number; close:number; volume?:number };
type Mode = "none" | "ad" | "chaikin";
type EventRow = { type:string; direction?:"long"|"short"; time:number; price:number; reason?:string; exit_type?:string };
type Metrics = {
  trades:number; profit_factor:number; net:number; win_rate_pct:number; max_drawdown:number;
  extreme_entry_count?:number; trend_entry_count?:number; chaikin_volume_coverage_pct?:number; events?:EventRow[];
};
type Best = { params:any; metrics:Metrics };
type RunState = { status:"idle"|"running"|"done"|"error"; progress:number; message:string; best?:Best; error?:string };

async function fetchJson(url:string, init?:RequestInit, retries=3) {
  let lastError:unknown;
  for(let attempt=1;attempt<=retries;attempt+=1){
    try{
      const response = await fetch(url, { cache:"no-store", ...init });
      const text = await response.text();
      let json:any;
      try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0,180)}`); }
      if (!response.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${response.status}`);
      return json;
    }catch(error){
      lastError=error;
      if(attempt>=retries)break;
      await new Promise(resolve=>setTimeout(resolve,1000*attempt));
    }
  }
  throw lastError instanceof Error?lastError:new Error(String(lastError));
}

function ema(values:number[], length:number):number[] {
  if (!values.length) return [];
  const alpha = 2/(Math.max(1,length)+1);
  const out = new Array<number>(values.length);
  out[0]=values[0];
  for(let i=1;i<values.length;i+=1) out[i]=alpha*values[i]+(1-alpha)*out[i-1];
  return out;
}

function heikinAshi(candles:Candle[]):Candle[] {
  const out:Candle[]=[];
  for(let i=0;i<candles.length;i+=1){
    const c=candles[i];
    const close=(c.open+c.high+c.low+c.close)/4;
    const open=i===0?(c.open+c.close)/2:((out[i-1].open+out[i-1].close)/2);
    out.push({time:c.time,open,high:Math.max(c.high,open,close),low:Math.min(c.low,open,close),close,volume:c.volume||0});
  }
  return out;
}

function adRatio(candles:Candle[], length:number):number[] {
  const ha=heikinAshi(candles);
  const n=Math.max(2,Math.floor(length));
  const out=new Array<number>(candles.length).fill(1);
  const flags=ha.map(c=>c.close>=c.open?1:-1);
  let up=0,down=0;
  for(let i=0;i<flags.length;i+=1){
    if(flags[i]>0)up+=1;else down+=1;
    if(i>=n){if(flags[i-n]>0)up-=1;else down-=1;}
    out[i]=down===0?up:up/down;
  }
  return out;
}

function chaikinOscillator(candles:Candle[], fastLength:number, slowLength:number){
  const adl:number[]=[];
  let cumulative=0,realVolume=0;
  for(const c of candles){
    const range=c.high-c.low;
    const multiplier=range===0?0:(((c.close-c.low)-(c.high-c.close))/range);
    const raw=Number(c.volume||0);
    if(raw>0)realVolume+=1;
    cumulative += multiplier*(raw>0?raw:1);
    adl.push(cumulative);
  }
  const fast=ema(adl,fastLength),slow=ema(adl,slowLength);
  return { values:adl.map((_,i)=>(fast[i]||0)-(slow[i]||0)), coverage:candles.length?realVolume/candles.length*100:0 };
}

const emptyRun=():RunState=>({status:"idle",progress:0,message:"Noch nicht gerechnet"});

export default function ADTrendLab(){
  const {symbol,interval,setSymbol,setInterval}=useSharedMarket();
  const [candles,setCandles]=useState<Candle[]>([]);
  const [adLength,setAdLength]=useState(11);
  const [chaikinFast,setChaikinFast]=useState(3);
  const [chaikinSlow,setChaikinSlow]=useState(10);
  const [exitHtf,setExitHtf]=useState(240);
  const [exitTiming,setExitTiming]=useState(15);
  const [lower,setLower]=useState(30);
  const [upper,setUpper]=useState(70);
  const [minTrades,setMinTrades]=useState(20);
  const [activeMode,setActiveMode]=useState<Mode>("ad");
  const [runs,setRuns]=useState<Record<Mode,RunState>>({none:emptyRun(),ad:emptyRun(),chaikin:emptyRun()});
  const [status,setStatus]=useState("Lade Kerzen …");
  const [saveBusy,setSaveBusy]=useState(false);
  const [optimizerBusy,setOptimizerBusy]=useState(false);

  const priceHost=useRef<HTMLDivElement>(null), sensorHost=useRef<HTMLDivElement>(null);
  const priceChart=useRef<IChartApi|null>(null), sensorChart=useRef<IChartApi|null>(null);
  const candleSeries=useRef<ISeriesApi<"Candlestick">|null>(null), adSeries=useRef<ISeriesApi<"Line">|null>(null), chaikinSeries=useRef<ISeriesApi<"Line">|null>(null);
  const adOneSeries=useRef<ISeriesApi<"Line">|null>(null), zeroSeries=useRef<ISeriesApi<"Line">|null>(null);
  const markerApi=useRef<any>(null);
  const candlesRef=useRef<Candle[]>([]);
  const adRef=useRef<number[]>([]);
  const chaikinRef=useRef<number[]>([]);
  const activeModeRef=useRef<Mode>("ad");

  const ha=useMemo(()=>heikinAshi(candles),[candles]);
  const ad=useMemo(()=>adRatio(candles,adLength),[candles,adLength]);
  const chaikin=useMemo(()=>chaikinOscillator(candles,chaikinFast,chaikinSlow),[candles,chaikinFast,chaikinSlow]);
  const activeRun=runs[activeMode];
  const activeEvents=activeRun.best?.metrics?.events||[];
  useEffect(()=>{candlesRef.current=candles;adRef.current=ad;chaikinRef.current=chaikin.values;activeModeRef.current=activeMode;},[candles,ad,chaikin,activeMode]);

  useEffect(()=>{
    if(!priceHost.current||!sensorHost.current)return;
    const common={layout:{background:{color:"#070b16"},textColor:"#dbe4ff"},grid:{vertLines:{color:"#172033"},horzLines:{color:"#172033"}},rightPriceScale:{borderColor:"#334155",minimumWidth:72},timeScale:{borderColor:"#334155",timeVisible:true},crosshair:{vertLine:{visible:true,labelVisible:true},horzLine:{visible:true,labelVisible:true}},autoSize:true} as const;
    const pc=createChart(priceHost.current,common),sc=createChart(sensorHost.current,common);
    const cs=pc.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",wickUpColor:"#22c55e",wickDownColor:"#ef4444",borderVisible:false});
    const ads=sc.addSeries(LineSeries,{color:"#38bdf8",lineWidth:2,title:"HA-AD"});
    const chs=sc.addSeries(LineSeries,{color:"#f97316",lineWidth:2,title:"Chaikin"});
    const one=sc.addSeries(LineSeries,{color:"#facc15",lineWidth:1,lineStyle:2,title:"AD 1"});
    const zero=sc.addSeries(LineSeries,{color:"#94a3b8",lineWidth:1,lineStyle:2,title:"Chaikin 0"});
    markerApi.current=createSeriesMarkers(cs,[]);
    priceChart.current=pc;sensorChart.current=sc;candleSeries.current=cs;adSeries.current=ads;chaikinSeries.current=chs;adOneSeries.current=one;zeroSeries.current=zero;

    let rangeSync=false;
    const syncRange=(source:IChartApi,target:IChartApi)=>source.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(!range||rangeSync)return;rangeSync=true;target.timeScale().setVisibleLogicalRange(range);rangeSync=false;});
    syncRange(pc,sc);syncRange(sc,pc);

    let crossSync=false;
    pc.subscribeCrosshairMove(param=>{
      if(crossSync)return;
      crossSync=true;
      if(param.time){
        const point=param.seriesData.get(cs) as any;
        const price=Number(point?.close??point?.value);
        if(Number.isFinite(price)) pc.setCrosshairPosition(price,param.time,cs);
        const idx=candlesRef.current.findIndex(c=>Number(c.time)===Number(param.time));
        if(idx>=0){
          const mode=activeModeRef.current;
          const v=mode==="chaikin"?chaikinRef.current[idx]:adRef.current[idx];
          const series=mode==="chaikin"?chs:ads;
          if(Number.isFinite(v)) sc.setCrosshairPosition(v,param.time,series);
        }
      }else sc.clearCrosshairPosition();
      crossSync=false;
    });
    sc.subscribeCrosshairMove(param=>{
      if(crossSync)return;
      crossSync=true;
      if(param.time){
        const idx=candlesRef.current.findIndex(c=>Number(c.time)===Number(param.time));
        if(idx>=0){
          pc.setCrosshairPosition(candlesRef.current[idx].close,param.time,cs);
          const mode=activeModeRef.current;
          const v=mode==="chaikin"?chaikinRef.current[idx]:adRef.current[idx];
          const series=mode==="chaikin"?chs:ads;
          if(Number.isFinite(v)) sc.setCrosshairPosition(v,param.time,series);
        }
      }else pc.clearCrosshairPosition();
      crossSync=false;
    });
    return()=>{pc.remove();sc.remove();};
  },[]);

  useEffect(()=>{
    candleSeries.current?.setData(ha.map(c=>({...c,time:c.time as Time})));
    adSeries.current?.setData(candles.map((c,i)=>({time:c.time as Time,value:ad[i]})));
    chaikinSeries.current?.setData(candles.map((c,i)=>({time:c.time as Time,value:chaikin.values[i]})));
    adOneSeries.current?.setData(candles.map(c=>({time:c.time as Time,value:1})));
    zeroSeries.current?.setData(candles.map(c=>({time:c.time as Time,value:0})));
    adSeries.current?.applyOptions({visible:activeMode!=="chaikin"});
    adOneSeries.current?.applyOptions({visible:activeMode!=="chaikin"});
    chaikinSeries.current?.applyOptions({visible:activeMode==="chaikin"});
    zeroSeries.current?.applyOptions({visible:activeMode==="chaikin"});
    const markers=activeEvents.filter(e=>e.type==="entry"||e.type==="exit").map(e=>({
      time:Number(e.time) as Time,
      position:e.type==="entry"?(e.direction==="long"?"belowBar":"aboveBar"):"aboveBar",
      shape:e.type==="entry"?(e.direction==="long"?"arrowUp":"arrowDown"):"circle",
      color:e.type==="entry"?(e.direction==="long"?"#22c55e":"#ef4444"):"#facc15",
      text:e.type==="entry"?(String(e.reason||"").startsWith("TREND ")?`${e.direction?.toUpperCase()} TREND`:`${e.direction?.toUpperCase()} EXTREM`):"EXIT",
      size:e.type==="entry"?1.2:.8,
    })).sort((a,b)=>Number(a.time)-Number(b.time));
    markerApi.current?.setMarkers(markers);
  },[candles,ha,ad,chaikin,activeMode,activeEvents]);

  async function load(){
    setStatus("Lade 5000 Kerzen …");
    try{
      const data=await fetchJson(`${BACKEND_BASE}/qmomentum/data?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=5000&_ts=${Date.now()}`);
      const list=Array.isArray(data.candles)?data.candles:[];
      setCandles(list);
      setStatus(`${list.length} Kerzen · Volumenabdeckung ${chaikinOscillator(list,chaikinFast,chaikinSlow).coverage.toFixed(1)}%`);
    }catch(error){setStatus(`Fehler: ${error instanceof Error?error.message:String(error)}`);}
  }
  useEffect(()=>{void load();},[symbol,interval]);

  function setRun(mode:Mode,patch:Partial<RunState>){setRuns(prev=>({...prev,[mode]:{...prev[mode],...patch}}));}

  async function runMode(mode:Mode){
    setRun(mode,{status:"running",progress:0,message:"Optimizer startet …",best:undefined,error:undefined});
    try{
      const start=await fetchJson(`${BACKEND_BASE}/qmomentum/extreme-optimize/start`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        symbol,interval,limit:5000,min_trades:minTrades,z_window:200,
        exit_htf_minutes:exitHtf,exit_timing_minutes:exitTiming,exit_rsi_lower:lower,exit_rsi_upper:upper,
        trend_filter_mode:mode,ad_length:adLength,chaikin_fast:chaikinFast,chaikin_slow:chaikinSlow,
        trend_sigma_values:mode==="none"?[0]:[0,0.25,0.5,0.75,1],
      })});
      const jobId=String(start.job_id);
      while(true){
        const step=await fetchJson(`${BACKEND_BASE}/qmomentum/extreme-optimize/step`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job_id:jobId,batch_size:2})});
        setRun(mode,{status:"running",progress:Number(step.progress_pct||0),message:`${step.processed}/${step.total} · ${Number(step.progress_pct||0).toFixed(1)}%`});
        if(step.done){
          const best=step.result?.best as Best|undefined;
          if(!best)throw new Error("Kein Ergebnis mit Mindest-Trades gefunden");
          setRun(mode,{status:"done",progress:100,message:"Fertig",best});
          return;
        }
        await new Promise(r=>setTimeout(r,250));
      }
    }catch(error){setRun(mode,{status:"error",message:"Fehler",error:error instanceof Error?error.message:String(error)});}
  }

  async function runAll(){
    if(optimizerBusy)return;
    setOptimizerBusy(true);
    try{
      await runMode("none");
      await new Promise(resolve=>setTimeout(resolve,1200));
      await runMode("ad");
      await new Promise(resolve=>setTimeout(resolve,1200));
      await runMode("chaikin");
    }finally{
      setOptimizerBusy(false);
    }
  }

  async function saveAndActivate(){
    const best=runs[activeMode].best;
    if(!best){setStatus("Zuerst die gewünschte Variante optimieren und auswählen");return;}
    try{
      setSaveBusy(true);
      const modeLabel=activeMode==="chaikin"?"BASIS + CHAIKIN":activeMode==="ad"?"BASIS + HA-AD":"BASIS V8.5";
      const params={
        ...best.params,
        strategy_mode:activeMode==="chaikin"?"basis_chaikin":activeMode==="ad"?"basis_ad":"basis",
        trend_filter_mode:activeMode,
        ad_length:adLength,chaikin_fast:chaikinFast,chaikin_slow:chaikinSlow,
        exit_htf_minutes:exitHtf,exit_timing_minutes:exitTiming,exit_rsi_lower:lower,exit_rsi_upper:upper,
        activation_time_ms:Date.now(),
      };
      const now=new Date();
      const name=`${symbol} ${interval} · ${modeLabel} · PF ${best.metrics.profit_factor.toFixed(2)} · ${now.toLocaleString("de-DE")}`;
      const mirrorMeta=candles.length?{start_time:candles[0].time,end_time:candles[candles.length-1].time,candle_count:candles.length}:undefined;
      const result={best:{params,metrics:best.metrics},mirror_meta:mirrorMeta,source:"AD_CHAIKIN_LAB_V1_2",selected_mode:activeMode};
      const saved=await fetchJson(`${BACKEND_BASE}/qmomentum/extreme-profiles`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,interval,name,params,result,activate:true,note:"V8.6 Speichern + Aktivieren"})});
      setStatus(`AKTIV: ${name} · Profil ${saved.id}`);
    }catch(error){setStatus(`Speichern fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`);}finally{setSaveBusy(false);}
  }

  return <div style={{minHeight:"100vh",background:"#050914",color:"#eef2ff",padding:10,fontFamily:"Inter,Arial,sans-serif",boxSizing:"border-box"}}>
    <header style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"6px 8px 12px"}}>
      <div><b style={{fontSize:20}}>AD / Chaikin Trend Lab V1.2</b><div style={{fontSize:11,color:"#94a3b8"}}>V8.5-Basis bleibt unverändert · Extreme ignorieren Trendfilter · zusätzlicher Trendpfad wird optimiert</div></div>
      <select value={symbol} onChange={e=>setSymbol(e.target.value)} style={input}>{SYMBOLS.map(x=><option key={x}>{x}</option>)}</select>
      <select value={interval} onChange={e=>setInterval(e.target.value)} style={input}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select>
      <label style={label}>AD<input type="number" min="2" max="50" value={adLength} onChange={e=>setAdLength(Math.max(2,Number(e.target.value)||11))} style={smallInput}/></label>
      <label style={label}>Chaikin<input type="number" min="1" max="20" value={chaikinFast} onChange={e=>setChaikinFast(Math.max(1,Number(e.target.value)||3))} style={miniInput}/>/<input type="number" min="2" max="60" value={chaikinSlow} onChange={e=>setChaikinSlow(Math.max(2,Number(e.target.value)||10))} style={miniInput}/></label>
      <label style={label}>Armed TF<input type="number" value={exitHtf} onChange={e=>setExitHtf(Math.max(5,Number(e.target.value)||240))} style={smallInput}/></label>
      <label style={label}>Timing TF<input type="number" value={exitTiming} onChange={e=>setExitTiming(Math.max(1,Number(e.target.value)||15))} style={smallInput}/></label>
      <label style={label}>RSI<input type="number" value={lower} onChange={e=>setLower(Number(e.target.value)||30)} style={miniInput}/>/<input type="number" value={upper} onChange={e=>setUpper(Number(e.target.value)||70)} style={miniInput}/></label>
      <label style={label}>Min Trades<input type="number" value={minTrades} onChange={e=>setMinTrades(Math.max(5,Number(e.target.value)||20))} style={smallInput}/></label>
      <button disabled={optimizerBusy} onClick={()=>void runAll()} style={{...primary,opacity:optimizerBusy?0.6:1}}>{optimizerBusy?"OPTIMIERUNG LÄUFT …":"ALLE 3 NACHEINANDER"}</button>
      <button disabled={saveBusy||!runs[activeMode].best} onClick={()=>void saveAndActivate()} style={{...activateButton,opacity:(saveBusy||!runs[activeMode].best)?0.6:1}}>{saveBusy?"SPEICHERT …":"SPEICHERN + AKTIVIEREN"}</button>
      <span style={{fontSize:12,color:"#22c55e",marginLeft:"auto"}}>{status}</span>
    </header>

    <section style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(300px,1fr))",gap:8,marginBottom:8}}>
      <ResultCard title="BASIS V8.5" mode="none" run={runs.none} active={activeMode==="none"} onSelect={()=>setActiveMode("none")} onRun={()=>{if(!optimizerBusy)void runMode("none")}}/>
      <ResultCard title="BASIS + HA-AD TRENDPFAD" mode="ad" run={runs.ad} active={activeMode==="ad"} onSelect={()=>setActiveMode("ad")} onRun={()=>{if(!optimizerBusy)void runMode("ad")}}/>
      <ResultCard title="BASIS + CHAIKIN TRENDPFAD" mode="chaikin" run={runs.chaikin} active={activeMode==="chaikin"} onSelect={()=>setActiveMode("chaikin")} onRun={()=>{if(!optimizerBusy)void runMode("chaikin")}}/>
    </section>
    <div style={{fontSize:12,color:"#c4b5fd",margin:"-2px 2px 8px"}}>Ausgewählt: <b>{activeMode==="chaikin"?"BASIS + CHAIKIN TRENDPFAD":activeMode==="ad"?"BASIS + HA-AD TRENDPFAD":"BASIS V8.5"}</b> · Speichern aktiviert nur neue Signale ab dem Klickzeitpunkt.</div>

    <section style={{display:"grid",gridTemplateRows:"minmax(500px,62vh) 220px",gap:8}}>
      <div ref={priceHost} style={chartBox}/><div ref={sensorHost} style={chartBox}/>
    </section>

    <section style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:8}}>
      <Info title="EXTREM-PFAD"><p>Echte Sigma-Extreme bleiben 1:1 V8.5. Weder AD noch Chaikin dürfen sie blockieren.</p><code>EXTREM → RSI-Cross → Entry · Filter ignoriert</code></Info>
      <Info title="TREND-PFAD"><p>Nur wenn kein Extrem-Entry anliegt: Filter bestätigt Richtung, gelockertes Sigma und RSI/MACD-Knick liefern einen zusätzlichen Entry.</p><code>Regime + Pullback-Z + RSI-Cross + Histogramm-Knick</code></Info>
      <Info title="CHAIKIN-DATEN"><p>Standard-Chaikin 3/10 verwendet Capital-Volumen. Alte Kerzen ohne Volumen laufen transparent mit Ersatzgewicht 1; die Abdeckung steht im Ergebnis.</p><code>EMA3(ADL) − EMA10(ADL), Null-Linie als Regime</code></Info>
    </section>
  </div>;
}

function ResultCard({title,mode,run,active,onSelect,onRun}:{title:string;mode:Mode;run:RunState;active:boolean;onSelect:()=>void;onRun:()=>void}){
  const m=run.best?.metrics,p=run.best?.params;
  return <div onClick={onSelect} style={{background:active?"#17213a":"#0c1322",border:`1px solid ${active?"#a855f7":"#26344d"}`,borderRadius:10,padding:13,cursor:"pointer"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}><b>{title}</b><button onClick={e=>{e.stopPropagation();onRun();}} style={secondary}>{run.status==="running"?`${run.progress.toFixed(0)}%`:"START"}</button></div>
    {run.status==="running"&&<div style={{height:5,background:"#111827",borderRadius:5,margin:"9px 0"}}><div style={{height:"100%",width:`${run.progress}%`,background:"#8b5cf6",borderRadius:5}}/></div>}
    {m?<><div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:6,marginTop:10}}><Stat k="PF" v={m.profit_factor.toFixed(2)}/><Stat k="Trades" v={String(m.trades)}/><Stat k="Netto" v={m.net.toFixed(1)}/><Stat k="Winrate" v={`${m.win_rate_pct.toFixed(1)}%`}/><Stat k="DD" v={m.max_drawdown.toFixed(1)}/><Stat k="Effizienz" v={(m.max_drawdown>0?m.net/m.max_drawdown:0).toFixed(2)}/></div><div style={{fontSize:11,color:"#94a3b8",marginTop:9}}>Extreme {m.extreme_entry_count??"–"} · Trend {m.trend_entry_count??0} · Trend-σ {Number(p?.trend_sigma_abs||0).toFixed(2)}{mode==="chaikin"?` · Volumen ${Number(m.chaikin_volume_coverage_pct||0).toFixed(1)}%`:""}</div></>:<div style={{fontSize:12,color:run.status==="error"?"#f87171":"#94a3b8",marginTop:12}}>{run.error||run.message}</div>}
  </div>;
}
function Stat({k,v}:{k:string;v:string}){return <div><div style={{fontSize:9,color:"#94a3b8"}}>{k}</div><b style={{fontSize:17}}>{v}</b></div>}
function Info({title,children}:{title:string;children:ReactNode}){return <div style={{background:"#0c1322",border:"1px solid #26344d",borderRadius:10,padding:13}}><b>{title}</b><div style={{fontSize:12,color:"#cbd5e1",lineHeight:1.55}}>{children}</div></div>}
const input:CSSProperties={background:"#0b1322",border:"1px solid #334155",borderRadius:7,color:"#fff",padding:"8px 10px"};
const smallInput:CSSProperties={...input,width:62,padding:"6px 7px"};
const miniInput:CSSProperties={...input,width:46,padding:"6px 6px"};
const label:CSSProperties={display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#94a3b8"};
const primary:CSSProperties={background:"#6d28d9",border:"1px solid #a855f7",borderRadius:8,color:"#fff",padding:"9px 13px",fontWeight:900,cursor:"pointer"};
const secondary:CSSProperties={background:"#111827",border:"1px solid #475569",borderRadius:7,color:"#fff",padding:"6px 9px",fontWeight:800,cursor:"pointer"};
const activateButton:CSSProperties={background:"#047857",border:"1px solid #34d399",borderRadius:8,color:"#fff",padding:"9px 13px",fontWeight:900,cursor:"pointer"};
const chartBox:CSSProperties={background:"#070b16",border:"1px solid #26344d",borderRadius:9,minHeight:0,overflow:"hidden"};

