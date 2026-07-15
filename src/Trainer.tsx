import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type Time,
} from "lightweight-charts";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["BTCUSD","ETHUSD","XRPUSD","DE40","US100","US500","US30","J225","UK100","GOLD","SILVER","OIL_CRUDE","CORN","SOLUSD","TSLA","TY","EURUSD"];
const INTERVALS = ["1m","5m","15m","30m","1h"];

type Candle={time:number;open:number;high:number;low:number;close:number};
type Candidate={candidate_id:string;symbol:string;interval:string;time:number;price:number;side:"long"|"short";strength:number;scanner_version:string;macd:number;macd_signal:number;macd_histogram:number;index:number};
type Annotation={id:number;symbol:string;interval:string;time:number;price:number;side:string;label:string;rating:number|null;source:string;note:string|null};
type MlJob={job_id?:string|null;state?:"idle"|"queued"|"running"|"succeeded"|"failed";phase?:string;progress_pct?:number;message?:string;started_at?:string|null;finished_at?:string|null;error?:string|null};
type MlStatus={annotations?:{total:number;good:number;bad:number};trained_rows?:number;new_examples?:number;model_current?:boolean;ml?:{training?:{trained_at?:string;walk_forward_summary?:{auc?:number;precision_good?:number;recall_good?:number;balanced_accuracy?:number}};model_exists?:boolean;job?:MlJob};ml_error?:string};


function ema(values:number[],length:number){if(!values.length)return[];const a=2/(length+1);const out=[values[0]];for(let i=1;i<values.length;i++)out.push(a*values[i]+(1-a)*out[i-1]);return out;}
function macd(candles:Candle[]){const closes=candles.map(c=>c.close),fast=ema(closes,10),slow=ema(closes,24),m=closes.map((_,i)=>fast[i]-slow[i]),sig=ema(m,3);return candles.map((c,i)=>({time:c.time as Time,macd:m[i],signal:sig[i],hist:m[i]-sig[i]}));}
function dt(t:number){return new Date(t*1000).toLocaleString("de-DE");}

export default function Trainer(){
 const [symbol,setSymbol]=useState("GOLD"),[interval,setInterval]=useState("15m");
 const [candles,setCandles]=useState<Candle[]>([]),[candidates,setCandidates]=useState<Candidate[]>([]),[annotations,setAnnotations]=useState<Annotation[]>([]);
 const [cursor,setCursor]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const [mode,setMode]=useState<"auto"|"manual">("auto"),[manualSide,setManualSide]=useState<"long"|"short"|"none">("long");
 const [selectedManual,setSelectedManual]=useState<{time:number;price:number}|null>(null),[rating,setRating]=useState(3),[note,setNote]=useState("");
 const [mlStatus,setMlStatus]=useState<MlStatus|null>(null),[training,setTraining]=useState(false),[trainingMessage,setTrainingMessage]=useState("");
 const priceRef=useRef<HTMLDivElement>(null),macdRef=useRef<HTMLDivElement>(null),chartRef=useRef<IChartApi|null>(null);
 const current=candidates[cursor]||null;
 const currentAnnotation=useMemo(()=>current?annotations.find(a=>a.time===current.time&&a.side===current.side&&a.source==="auto_macd"):undefined,[current,annotations]);
 const stats=useMemo(()=>({good:annotations.filter(a=>a.label==="good").length,bad:annotations.filter(a=>a.label==="bad").length,unsure:annotations.filter(a=>a.label==="unsure").length,manual:annotations.filter(a=>a.source!=="auto_macd").length}),[annotations]);

 async function loadMlStatus(){try{const r=await fetch(`${BACKEND_BASE}/trainer/ml/status`,{cache:"no-store"});const j=await r.json();if(r.ok&&j.ok){setMlStatus(j);const job=j?.ml?.job as MlJob|undefined;const active=job?.state==="queued"||job?.state==="running";setTraining(Boolean(active));if(job?.state==="failed")setTrainingMessage(`Training fehlgeschlagen: ${job.error||job.message||"Unbekannter Fehler"}`);else if(active)setTrainingMessage(`${job.message||"Training läuft"} · ${Number(job.progress_pct||0).toFixed(0)} %`);else if(job?.state==="succeeded"){const wf=j?.ml?.training?.walk_forward_summary||{};setTrainingMessage(`Training fertig · AUC ${Number(wf.auc||0).toFixed(3)} · GOOD-Präzision ${(Number(wf.precision_good||0)*100).toFixed(1)} %`);}}else setTrainingMessage(j.error||"KI-Status nicht verfügbar");}catch(e:any){setTrainingMessage(e.message||String(e));}}
 async function retrainMl(){if(training)return;setTraining(true);setTrainingMessage("Datensatz wird synchronisiert und der Trainingsjob gestartet …");try{const r=await fetch(`${BACKEND_BASE}/trainer/ml/retrain`,{method:"POST"});const text=await r.text();let j:any;try{j=JSON.parse(text)}catch{throw new Error(text||`HTTP ${r.status}`)}if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);setTrainingMessage(j.started===false?"Training läuft bereits …":"Training gestartet …");await loadMlStatus();}catch(e:any){setTraining(false);setTrainingMessage(`Training konnte nicht gestartet werden: ${e.message||String(e)}`);}}
 async function load(){setLoading(true);setError("");try{const u=new URL("/trainer/candidates",BACKEND_BASE);u.searchParams.set("symbol",symbol);u.searchParams.set("interval",interval);u.searchParams.set("limit","5000");const r=await fetch(u);const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);setCandles(j.candles||[]);setCandidates(j.candidates||[]);setAnnotations(j.annotations||[]);setCursor(0);setSelectedManual(null);}catch(e:any){setError(e.message||String(e));}finally{setLoading(false)}}
 useEffect(()=>{load();loadMlStatus()},[symbol,interval]);
 useEffect(()=>{const timer=window.setInterval(()=>{loadMlStatus()},training?2500:10000);return()=>window.clearInterval(timer)},[training]);

 useEffect(()=>{if(!priceRef.current||!macdRef.current)return;priceRef.current.innerHTML="";macdRef.current.innerHTML="";
  const common={layout:{background:{color:"#07111f"},textColor:"#a9b8ca"},grid:{vertLines:{color:"#142235"},horzLines:{color:"#142235"}},rightPriceScale:{borderColor:"#26364b"},timeScale:{borderColor:"#26364b",timeVisible:true,secondsVisible:false}} as const;
  const pc=createChart(priceRef.current,{...common,height:520});const cs=pc.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",wickUpColor:"#22c55e",wickDownColor:"#ef4444",borderVisible:false});cs.setData(candles.map(c=>({...c,time:c.time as Time})));
  const mc=createChart(macdRef.current,{...common,height:210});const ml=mc.addSeries(LineSeries,{lineWidth:2});const sl=mc.addSeries(LineSeries,{lineWidth:2});const hh=mc.addSeries(HistogramSeries,{priceFormat:{type:"price",precision:4,minMove:.0001}});const md=macd(candles);ml.setData(md.map(x=>({time:x.time,value:x.macd})));sl.setData(md.map(x=>({time:x.time,value:x.signal})));hh.setData(md.map(x=>({time:x.time,value:x.hist,color:x.hist>=0?"#22c55e88":"#ef444488"})));
  const markers:any[]=[];for(const a of annotations){markers.push({time:a.time as Time,position:a.side==="short"?"aboveBar":"belowBar",shape:a.side==="short"?"arrowDown":"arrowUp",color:a.label==="good"?"#22c55e":a.label==="bad"?"#ef4444":a.label==="no_trade"?"#94a3b8":"#f59e0b",text:a.source==="auto_macd"?a.label.toUpperCase():`M ${a.label.toUpperCase()}`});}
  if(current)markers.push({time:current.time as Time,position:current.side==="short"?"aboveBar":"belowBar",shape:current.side==="short"?"arrowDown":"arrowUp",color:"#eab308",text:"KANDIDAT"});
  if(selectedManual)markers.push({time:selectedManual.time as Time,position:manualSide==="short"?"aboveBar":"belowBar",shape:manualSide==="short"?"arrowDown":"arrowUp",color:"#38bdf8",text:"MANUELL"});
  createSeriesMarkers(cs,markers.sort((a,b)=>Number(a.time)-Number(b.time)));
  pc.timeScale().fitContent();mc.timeScale().fitContent();pc.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(r)mc.timeScale().setVisibleLogicalRange(r)});
  pc.subscribeClick(p=>{if(mode!=="manual"||!p.time)return;const d=p.seriesData.get(cs) as any;if(d&&Number.isFinite(d.close))setSelectedManual({time:Number(p.time),price:Number(d.close)});});
  chartRef.current=pc;
  return()=>{pc.remove();mc.remove();chartRef.current=null};
 },[candles,annotations,current?.time,mode,manualSide,selectedManual?.time]);

 useEffect(()=>{if(!current||!chartRef.current)return;const i=candles.findIndex(c=>c.time===current.time);if(i>=0)chartRef.current.timeScale().setVisibleLogicalRange({from:Math.max(0,i-45),to:Math.min(candles.length-1,i+16)});},[cursor,current?.time,candles]);

 async function save(label:"good"|"bad"|"unsure"|"no_trade"){
  const point=mode==="auto"&&current?{time:current.time,price:current.price,side:current.side,source:"auto_macd",scanner_version:current.scanner_version}:selectedManual?{time:selectedManual.time,price:selectedManual.price,side:manualSide,source:manualSide==="none"?"manual_no_trade":"manual",scanner_version:null}:null;
  if(!point){setError("Bitte zuerst einen Kandidaten oder eine Kerze wählen.");return}
  const r=await fetch(`${BACKEND_BASE}/trainer/annotation`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,interval,...point,label,rating,note})});const j=await r.json();if(!r.ok||!j.ok){setError(j.error||"Speichern fehlgeschlagen");return}setAnnotations(prev=>[...prev.filter(a=>!(a.time===j.annotation.time&&a.side===j.annotation.side&&a.source===j.annotation.source)),j.annotation]);setNote("");loadMlStatus();if(mode==="auto"&&cursor<candidates.length-1)setCursor(x=>x+1);
 }
 function move(d:number){setCursor(x=>Math.max(0,Math.min(candidates.length-1,x+d)))}
 useEffect(()=>{const f=(e:KeyboardEvent)=>{if((e.target as HTMLElement)?.tagName==="INPUT"||(e.target as HTMLElement)?.tagName==="TEXTAREA")return;if(e.key==="ArrowRight")move(1);if(e.key==="ArrowLeft")move(-1);if(e.key.toLowerCase()==="g")save("good");if(e.key.toLowerCase()==="s")save("bad");if(e.key.toLowerCase()==="u")save("unsure");};window.addEventListener("keydown",f);return()=>window.removeEventListener("keydown",f)});

 return <div className="trainer-shell">
  <header className="trainer-header"><div><b>QTrend Trainer</b><span>MACD-Knicke zeigen · bewerten · eigene Entries setzen</span></div><div className="trainer-header-actions"><a href="/">Cockpit</a><a href={`${BACKEND_BASE}/trainer/export?format=json`} target="_blank">JSON</a><a href={`${BACKEND_BASE}/trainer/export?format=csv`} target="_blank">CSV</a></div></header>
  <div className="trainer-toolbar"><label>Instrument<select value={symbol} onChange={e=>setSymbol(e.target.value)}>{SYMBOLS.map(x=><option key={x}>{x}</option>)}</select></label><label>TF<select value={interval} onChange={e=>setInterval(e.target.value)}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select></label><button onClick={load}>Neu laden</button><div className="mode-switch"><button className={mode==="auto"?"active":""} onClick={()=>setMode("auto")}>AUTO-KANDIDAT</button><button className={mode==="manual"?"active":""} onClick={()=>setMode("manual")}>MANUELL SETZEN</button></div><div className="trainer-stats"><span>Gut {stats.good}</span><span>Schlecht {stats.bad}</span><span>Unsicher {stats.unsure}</span><span>Manuell {stats.manual}</span></div></div>
  <main className="trainer-main"><section className="trainer-charts"><div ref={priceRef}/><div ref={macdRef}/>{loading&&<div className="trainer-loading">Lade Kerzen und Kandidaten …</div>}</section>
  <aside className="trainer-panel">{mode==="auto"?<><div className="eyebrow">AUTO MACD-KNICK</div>{current?<><h2 className={current.side}>{current.side.toUpperCase()}</h2><dl><dt>Zeit</dt><dd>{dt(current.time)}</dd><dt>Preis</dt><dd>{current.price}</dd><dt>Kandidat</dt><dd>{cursor+1} / {candidates.length}</dd><dt>Histogramm</dt><dd>{current.macd_histogram.toFixed(5)}</dd></dl>{currentAnnotation&&<div className={`saved ${currentAnnotation.label}`}>Gespeichert: {currentAnnotation.label.toUpperCase()}</div>}</>:<p>Keine Kandidaten vorhanden.</p>}<div className="nav-row"><button onClick={()=>move(-1)}>← Vorheriger</button><button onClick={()=>move(1)}>Nächster →</button></div></>:<><div className="eyebrow">MANUELLER MARKER</div><p>Klicke beziehungsweise bewege das Fadenkreuz auf die gewünschte Kerze.</p><div className="side-row"><button className={manualSide==="long"?"active long":""} onClick={()=>setManualSide("long")}>LONG</button><button className={manualSide==="short"?"active short":""} onClick={()=>setManualSide("short")}>SHORT</button><button className={manualSide==="none"?"active":""} onClick={()=>setManualSide("none")}>NO TRADE</button></div>{selectedManual?<dl><dt>Zeit</dt><dd>{dt(selectedManual.time)}</dd><dt>Preis</dt><dd>{selectedManual.price}</dd></dl>:<div className="manual-empty">Noch keine Kerze gewählt</div>}</>}
  <div className="rating"><span>Stärke</span>{[1,2,3,4,5].map(n=><button className={rating>=n?"on":""} key={n} onClick={()=>setRating(n)}>★</button>)}</div><textarea placeholder="Notiz optional, z. B. sauberer Knick / zu spät / Seitwärts" value={note} onChange={e=>setNote(e.target.value)}/><div className="judge"><button className="good" onClick={()=>save("good")}>G · GUT</button><button className="bad" onClick={()=>save("bad")}>S · SCHLECHT</button><button className="unsure" onClick={()=>save("unsure")}>U · UNSICHER</button>{mode==="manual"&&<button onClick={()=>save("no_trade")}>NO TRADE</button>}</div><div className="ml-training-card"><div className="ml-training-head"><div><strong>Trainer-KI</strong><span>{training?"Training läuft":mlStatus?.model_current?"Modell aktuell":"Modell veraltet"}</span></div><span className={training?"ml-dot running":mlStatus?.model_current?"ml-dot current":"ml-dot stale"}/></div><div className="ml-training-grid"><span>Datensatz</span><b>{mlStatus?.annotations?.total??"–"}</b><span>GOOD / BAD</span><b>{mlStatus?.annotations?.good??"–"} / {mlStatus?.annotations?.bad??"–"}</b><span>Trainiert</span><b>{mlStatus?.trained_rows??0}</b><span>Neu</span><b>{mlStatus?.new_examples??0}</b></div>{training&&<div className="ml-progress"><div style={{width:`${Math.max(2,Number(mlStatus?.ml?.job?.progress_pct||2))}%`}}/><span>{mlStatus?.ml?.job?.phase||"start"}</span></div>}<button className="ml-train-button" disabled={training||!mlStatus?.annotations?.total} onClick={retrainMl}>{training?"KI WIRD TRAINIERT …":"KI NEU TRAINIEREN"}</button>{trainingMessage&&<div className={mlStatus?.ml?.job?.state==="failed"?"ml-training-message failed":"ml-training-message"}>{trainingMessage}</div>}{mlStatus?.ml_error&&<div className="trainer-error">ML-Dienst: {mlStatus.ml_error}</div>}</div>{error&&<div className="trainer-error">{error}</div>}<small>Tastatur: G / S / U · Pfeile für Kandidaten</small></aside></main>
 </div>
}
