import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, createChart, createSeriesMarkers, type IChartApi, type Time } from "lightweight-charts";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["DE40","US30","US100","UK100","J225","CN50","BTCUSD","ETHUSD","GOLD"];
const INTERVALS = ["1m","5m","15m","30m","1h"];

type Candle={time:number;open:number;high:number;low:number;close:number};
type Candidate={candidate_id:string;symbol:string;interval:string;time:number;price:number;side:"long"|"short";scanner_version?:string};
type Reason={feature:string;value:number|null;importance:number};
type Score={candidate_id:string;symbol:string;interval:string;time:number;price:number;side:"long"|"short";probability_good:number;threshold:number;allowed:boolean;decision:string;reasons:Reason[]};
type ModelInfo={trained_at?:string;trained_rows?:number;selection?:{symbol?:string;interval?:string;source?:string};threshold?:number;feature_count?:number};

function featureName(name:string){return name.replace(/^dir_/,"").replace(/_lag_/g," · Kerze -").replace(/_window_/g," · Fenster ").replace(/_/g," ");}
function when(time:number){return new Date(time*1000).toLocaleString("de-DE");}

export default function KiEntries(){
 const [symbol,setSymbol]=useState("US30"),[interval,setInterval]=useState("15m");
 const [candles,setCandles]=useState<Candle[]>([]),[scores,setScores]=useState<Score[]>([]);
 const [model,setModel]=useState<ModelInfo|null>(null),[selected,setSelected]=useState<Score|null>(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState("");
 const chartHost=useRef<HTMLDivElement>(null),chartRef=useRef<IChartApi|null>(null);
 const allowed=useMemo(()=>scores.filter(x=>x.allowed),[scores]);

 async function load(){
  setLoading(true);setError("");
  try{
   const u=new URL("/trainer/candidates",BACKEND_BASE);u.searchParams.set("symbol",symbol);u.searchParams.set("interval",interval);u.searchParams.set("limit","1500");
   const r=await fetch(u,{cache:"no-store"});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
   const candidates=(j.candidates||[]) as Candidate[];setCandles(j.candles||[]);
   const recent=candidates.slice(-500);
   const s=await fetch(`${BACKEND_BASE}/trainer/ml/score-candidates`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,interval,candidates:recent})});
   const text=await s.text();let p:any;try{p=JSON.parse(text)}catch{throw new Error(text||`HTTP ${s.status}`)}
   if(!s.ok||!p.ok)throw new Error(p.error||`HTTP ${s.status}`);
   const next=(p.results||[]).sort((a:Score,b:Score)=>a.time-b.time);setScores(next);setModel(p.model||null);setSelected(next[next.length-1]||null);
  }catch(e:any){setScores([]);setModel(null);setSelected(null);setError(e.message||String(e));}finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[symbol,interval]);
 useEffect(()=>{const t=window.setInterval(()=>void load(),30000);return()=>clearInterval(t)},[symbol,interval]);
 useEffect(()=>{
  if(!chartHost.current)return;chartHost.current.innerHTML="";
  const chart=createChart(chartHost.current,{height:590,layout:{background:{color:"#07111f"},textColor:"#a9b8ca"},grid:{vertLines:{color:"#142235"},horzLines:{color:"#142235"}},rightPriceScale:{borderColor:"#26364b"},timeScale:{borderColor:"#26364b",timeVisible:true}});
  const series=chart.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",wickUpColor:"#22c55e",wickDownColor:"#ef4444",borderVisible:false});
  series.setData(candles.map(c=>({...c,time:c.time as Time})));
  createSeriesMarkers(series,(scores.map(x=>({time:x.time as Time,position:x.side==="short"?"aboveBar":"belowBar",shape:x.side==="short"?"arrowDown":"arrowUp",color:x.allowed?"#22c55e":"#ef4444",text:`${Math.round(x.probability_good*100)}% ${x.allowed?"OK":"BLOCK"}`})).sort((a,b)=>Number(a.time)-Number(b.time)) as any));
  chart.timeScale().fitContent();chartRef.current=chart;return()=>{chart.remove();chartRef.current=null};
 },[candles,scores]);
 function choose(item:Score){setSelected(item);const i=candles.findIndex(c=>c.time===item.time);if(i>=0)chartRef.current?.timeScale().setVisibleLogicalRange({from:Math.max(0,i-45),to:Math.min(candles.length-1,i+15)});}
 return <div className="ki-entry-page">
  <header className="ki-entry-header"><div><b>QTrend KI-Entrys</b><span>Beobachtung · keine automatischen Trades</span></div><div className="ki-entry-controls"><select value={symbol} onChange={e=>setSymbol(e.target.value)}>{SYMBOLS.map(x=><option key={x}>{x}</option>)}</select><select value={interval} onChange={e=>setInterval(e.target.value)}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select><button onClick={()=>void load()} disabled={loading}>{loading?"LÄDT …":"AKTUALISIEREN"}</button></div></header>
  {error&&<div className="ki-entry-error">{error}</div>}
  <main className="ki-entry-layout"><section className="ki-entry-chart"><div ref={chartHost}/></section><aside className="ki-entry-sidebar">
   <div className="ki-model-card"><strong>KI-Modell</strong>{model?<><span>{model.selection?.symbol||"ALL"} · {model.selection?.interval||"ALL"}</span><small>{model.trained_rows||0} Beispiele · Threshold {Math.round(Number(model.threshold||0)*100)}%</small></>:<span>Kein passendes Modell</span>}</div>
   {selected&&<div className={`ki-decision-card ${selected.allowed?"allowed":"blocked"}`}><div className="ki-decision-top"><span>{selected.side.toUpperCase()} · {when(selected.time)}</span><b>{Math.round(selected.probability_good*100)}%</b></div><div className="ki-probability"><i style={{width:`${Math.round(selected.probability_good*100)}%`}}/></div><strong>{selected.allowed?"TRADE ERLAUBT":"TRADE BLOCKIERT"}</strong><div className="ki-reasons"><span>Wichtigste Modellmerkmale</span>{selected.reasons?.map(r=><div key={r.feature}><em>{featureName(r.feature)}</em><b>{r.value==null?"–":Number(r.value).toFixed(3)}</b></div>)}</div></div>}
   <div className="ki-entry-summary"><span>Bewertet <b>{scores.length}</b></span><span>Erlaubt <b>{allowed.length}</b></span><span>Blockiert <b>{scores.length-allowed.length}</b></span></div>
   <div className="ki-entry-list">{[...scores].reverse().map(item=><button key={`${item.candidate_id}-${item.time}`} className={`${item.allowed?"allowed":"blocked"} ${selected?.time===item.time&&selected?.side===item.side?"active":""}`} onClick={()=>choose(item)}><span><b>{item.symbol} · {item.side.toUpperCase()}</b><small>{when(item.time)}</small></span><strong>{Math.round(item.probability_good*100)}%</strong></button>)}</div>
  </aside></main>
 </div>
}
