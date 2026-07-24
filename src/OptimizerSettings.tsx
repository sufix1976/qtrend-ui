import { useEffect, useMemo, useState, type CSSProperties } from "react";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["US30","US100","DE40","UK100","J225","CN50","BTCUSD","ETHUSD","GOLD","SILVER","OIL_CRUDE","CORN"];
const INTERVALS = ["5m","15m","30m"];
const STRATEGIES = [
  { id:"basis", label:"Basis V8.5" },
  { id:"basis_ad", label:"Basis + HA-AD" },
  { id:"basis_chaikin", label:"Basis + Chaikin" },
];

type Job = { id:number; batch_id?:string; symbol:string; interval:string; strategy:string; status:string; progress:number; processed:number; total:number; scheduled_at?:string; started_at?:string; finished_at?:string; error?:string; attempts:number; result_json?:string };

async function api(path:string, init?:RequestInit){
  const r=await fetch(`${BACKEND_BASE}${path}`,{cache:"no-store",...init});
  const t=await r.text(); let j:any; try{j=JSON.parse(t)}catch{throw new Error(t.slice(0,200))}
  if(!r.ok||j?.ok===false)throw new Error(j?.error||`HTTP ${r.status}`); return j;
}
const post=(path:string,body:any={})=>api(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const fmt=(v?:string)=>v?new Date(v).toLocaleString("de-DE"):"–";
const strategyLabel=(id:string)=>STRATEGIES.find(x=>x.id===id)?.label||id;

export default function OptimizerSettings(){
  const [symbols,setSymbols]=useState<string[]>(["US30","US100"]);
  const [intervals,setIntervals]=useState<string[]>(["5m","15m","30m"]);
  const [strategies,setStrategies]=useState<string[]>(["basis_chaikin"]);
  const [startMode,setStartMode]=useState<"now"|"time">("time");
  const defaultStart=useMemo(()=>{const d=new Date();d.setHours(22,0,0,0);if(d.getTime()<Date.now())d.setDate(d.getDate()+1);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)},[]);
  const [startAt,setStartAt]=useState(defaultStart);
  const [jobs,setJobs]=useState<Job[]>([]); const [current,setCurrent]=useState<Job|null>(null);
  const [history,setHistory]=useState<any[]>([]); const [message,setMessage]=useState("Bereit"); const [busy,setBusy]=useState(false);

  async function load(){
    try{
      const [s,j,h]=await Promise.all([api(`/optimizer/status?_=${Date.now()}`),api(`/optimizer/jobs?_=${Date.now()}`),api(`/optimizer/history?_=${Date.now()}`)]);
      setCurrent(s.current||null);setJobs(j.jobs||[]);setHistory(h.history||[]);setMessage("Queue verbunden");
    }catch(e:any){setMessage(`Fehler: ${e.message}`)}
  }
  useEffect(()=>{void load();const id=setInterval(()=>void load(),5000);return()=>clearInterval(id)},[]);
  const toggle=(value:string,list:string[],set:(v:string[])=>void)=>set(list.includes(value)?list.filter(x=>x!==value):[...list,value]);

  async function enqueue(){
    if(!symbols.length||!intervals.length||!strategies.length){setMessage("Bitte Markt, TF und Strategie auswählen");return}
    setBusy(true);
    try{
      const scheduled_at=startMode==="now"?new Date().toISOString():new Date(startAt).toISOString();
      const r=await post("/optimizer/enqueue",{symbols,intervals,strategies,scheduled_at,limit:5000,min_trades:20,exit_htf_minutes:240,exit_timing_minutes:15,exit_rsi_lower:30,exit_rsi_upper:70,ad_length:11,chaikin_fast:3,chaikin_slow:10});
      setMessage(`${r.created} Jobs eingeplant · Start ${fmt(r.scheduled_at)}`);await load();
    }catch(e:any){setMessage(`Startfehler: ${e.message}`)}finally{setBusy(false)}
  }
  async function action(id:number,kind:"pause"|"resume"|"cancel"){try{await post(`/optimizer/${kind}`,{id});await load()}catch(e:any){setMessage(e.message)}}
  const counts=jobs.reduce<Record<string,number>>((a,j)=>(a[j.status]=(a[j.status]||0)+1,a),{});

  return <div style={{minHeight:"100vh",background:"#070b16",color:"#e5edff",padding:18,fontFamily:"system-ui"}}>
    <h1 style={{margin:"0 0 4px"}}>QOptimizer V2</h1><div style={{color:"#94a3b8",marginBottom:18}}>Serverseitige Queue · Browser kann geschlossen werden · immer nur ein Job gleichzeitig</div>
    <div style={grid}>
      <section style={card}><h3>Märkte</h3><div style={checks}>{SYMBOLS.map(x=><label key={x} style={check}><input type="checkbox" checked={symbols.includes(x)} onChange={()=>toggle(x,symbols,setSymbols)}/>{x}</label>)}</div></section>
      <section style={card}><h3>Timeframes</h3><div style={checks}>{INTERVALS.map(x=><label key={x} style={check}><input type="checkbox" checked={intervals.includes(x)} onChange={()=>toggle(x,intervals,setIntervals)}/>{x}</label>)}</div><h3>Strategien</h3><div style={{display:"grid",gap:8}}>{STRATEGIES.map(x=><label key={x.id} style={check}><input type="checkbox" checked={strategies.includes(x.id)} onChange={()=>toggle(x.id,strategies,setStrategies)}/>{x.label}</label>)}</div></section>
      <section style={card}><h3>Start</h3><label style={check}><input type="radio" checked={startMode==="now"} onChange={()=>setStartMode("now")}/>Sofort</label><label style={check}><input type="radio" checked={startMode==="time"} onChange={()=>setStartMode("time")}/>Geplant</label><input type="datetime-local" value={startAt} onChange={e=>setStartAt(e.target.value)} disabled={startMode!=="time"} style={input}/><button onClick={()=>void enqueue()} disabled={busy} style={primary}>{busy?"WIRD EINGEPLANT …":`${symbols.length*intervals.length*strategies.length} JOBS EINPLANEN`}</button><div style={{marginTop:12,color:"#93c5fd"}}>{message}</div></section>
    </div>

    <section style={{...card,marginTop:16}}><h2>Aktuell</h2>{current?<><div style={{fontSize:22,fontWeight:900}}>{current.symbol} · {current.interval} · {strategyLabel(current.strategy)}</div><div style={{height:18,background:"#111827",borderRadius:10,overflow:"hidden",margin:"12px 0"}}><div style={{height:"100%",width:`${current.progress||0}%`,background:"linear-gradient(90deg,#2563eb,#22c55e)"}}/></div><div>{Number(current.progress||0).toFixed(1)} % · {current.processed}/{current.total} · Versuch {current.attempts}</div><button style={small} onClick={()=>void action(current.id,"pause")}>PAUSE</button><button style={danger} onClick={()=>void action(current.id,"cancel")}>ABBRECHEN</button></>:<div style={{color:"#94a3b8"}}>Kein Job läuft. WAITING {counts.WAITING||0} · PAUSED {counts.PAUSED||0} · FINISHED {counts.FINISHED||0}</div>}</section>

    <section style={{...card,marginTop:16}}><h2>Queue</h2><div style={{overflowX:"auto"}}><table style={table}><thead><tr><th>ID</th><th>Markt</th><th>TF</th><th>Strategie</th><th>Status</th><th>Fortschritt</th><th>Start</th><th>Aktion</th></tr></thead><tbody>{jobs.map(j=><tr key={j.id}><td>{j.id}</td><td>{j.symbol}</td><td>{j.interval}</td><td>{strategyLabel(j.strategy)}</td><td><b>{j.status}</b>{j.error&&<div style={{color:"#fca5a5",maxWidth:280}}>{j.error}</div>}</td><td>{Number(j.progress||0).toFixed(1)} %</td><td>{fmt(j.scheduled_at)}</td><td>{j.status==="PAUSED"&&<button style={small} onClick={()=>void action(j.id,"resume")}>FORTSETZEN</button>}{["WAITING","PAUSED"].includes(j.status)&&<button style={danger} onClick={()=>void action(j.id,"cancel")}>LÖSCHEN</button>}</td></tr>)}</tbody></table></div></section>

    <section style={{...card,marginTop:16}}><h2>Letzte Ergebnisse</h2><div style={{overflowX:"auto"}}><table style={table}><thead><tr><th>Zeit</th><th>Markt</th><th>TF</th><th>Strategie</th><th>PF</th><th>Netto</th><th>DD</th><th>Effizienz</th><th>Trades</th></tr></thead><tbody>{history.slice(0,50).map(h=><tr key={h.id}><td>{fmt(h.completed_at)}</td><td>{h.symbol}</td><td>{h.interval}</td><td>{strategyLabel(h.strategy)}</td><td>{Number(h.profit_factor||0).toFixed(2)}</td><td>{Number(h.net||0).toFixed(1)}</td><td>{Number(h.max_drawdown||0).toFixed(1)}</td><td>{Number(h.efficiency||0).toFixed(2)}</td><td>{h.trades}</td></tr>)}</tbody></table></div></section>
  </div>
}

const card:CSSProperties={background:"#0b1220",border:"1px solid #24324a",borderRadius:14,padding:16};
const grid:CSSProperties={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14};
const checks:CSSProperties={display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8};
const check:CSSProperties={display:"flex",gap:7,alignItems:"center",padding:"7px 8px",background:"#0f172a",borderRadius:8};
const input:CSSProperties={width:"100%",boxSizing:"border-box",padding:10,margin:"12px 0",background:"#111827",border:"1px solid #334155",borderRadius:8,color:"white"};
const primary:CSSProperties={width:"100%",padding:12,border:0,borderRadius:9,background:"#2563eb",color:"white",fontWeight:900,cursor:"pointer"};
const small:CSSProperties={padding:"7px 10px",margin:"8px 6px 0 0",border:"1px solid #3b82f6",borderRadius:7,background:"#172554",color:"#bfdbfe",fontWeight:800};
const danger:CSSProperties={...small,border:"1px solid #ef4444",background:"#450a0a",color:"#fecaca"};
const table:CSSProperties={width:"100%",borderCollapse:"collapse",fontSize:13};
