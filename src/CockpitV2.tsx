import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useSharedMarket } from "./useSharedMarket";
import { chartBerlinTime } from "./berlinTime";

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["GOLD","US100","US30","DE40","J225","UK100","US500","BTCUSD","ETHUSD","SILVER","OIL_CRUDE","CORN"];
const INTERVALS = ["1m","2m","3m","5m","8m","10m","15m","18m","30m","1h"];

type Candle = { time:number; open:number; high:number; low:number; close:number; volume?:number };
type ChartMode = "candles" | "heikin";
type ModuleKey = "view" | "entry" | "exit" | "channel" | "poc";

type InstrumentProfile = {
  symbol:string;
  interval:string;
  chartMode:ChartMode;
  activeModule:ModuleKey;
  showPaneA:boolean;
  showPaneB:boolean;
  updatedAt:string;
  modules:{
    entry:Record<string, unknown>;
    exit:Record<string, unknown>;
    channel:Record<string, unknown>;
    poc:Record<string, unknown>;
  };
};

const profileKey = (symbol:string) => `qtrend:cockpit-v2:profile:${symbol}`;

function defaultProfile(symbol:string, interval:string):InstrumentProfile {
  return {
    symbol,
    interval,
    chartMode:"candles",
    activeModule:"view",
    showPaneA:false,
    showPaneB:false,
    updatedAt:new Date().toISOString(),
    modules:{entry:{},exit:{},channel:{},poc:{}},
  };
}

function readProfile(symbol:string, fallbackInterval:string):InstrumentProfile {
  try {
    const raw=localStorage.getItem(profileKey(symbol));
    if(!raw) return defaultProfile(symbol,fallbackInterval);
    const parsed=JSON.parse(raw);
    return {
      ...defaultProfile(symbol,fallbackInterval),
      ...parsed,
      symbol,
      modules:{entry:{},exit:{},channel:{},poc:{},...(parsed?.modules||{})},
    };
  } catch {
    return defaultProfile(symbol,fallbackInterval);
  }
}

function saveProfile(profile:InstrumentProfile) {
  localStorage.setItem(profileKey(profile.symbol),JSON.stringify({...profile,updatedAt:new Date().toISOString()}));
}

function heikin(candles:Candle[]):Candle[] {
  if(!candles.length) return [];
  const out:Candle[]=[];
  let prevOpen=(candles[0].open+candles[0].close)/2;
  let prevClose=(candles[0].open+candles[0].high+candles[0].low+candles[0].close)/4;
  out.push({time:candles[0].time,open:prevOpen,close:prevClose,high:Math.max(candles[0].high,prevOpen,prevClose),low:Math.min(candles[0].low,prevOpen,prevClose),volume:candles[0].volume});
  for(let i=1;i<candles.length;i+=1){
    const c=candles[i];
    const close=(c.open+c.high+c.low+c.close)/4;
    const open=(prevOpen+prevClose)/2;
    out.push({time:c.time,open,close,high:Math.max(c.high,open,close),low:Math.min(c.low,open,close),volume:c.volume});
    prevOpen=open; prevClose=close;
  }
  return out;
}

async function fetchCandles(symbol:string, interval:string):Promise<Candle[]> {
  const url=`${BACKEND_BASE}/v5/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=5000&_ts=${Date.now()}`;
  const r=await fetch(url,{cache:"no-store"});
  const text=await r.text();
  let json:any;
  try{json=JSON.parse(text);}catch{throw new Error(`Keine JSON-Antwort: ${text.slice(0,120)}`);}
  if(!r.ok||json?.ok===false) throw new Error(json?.error||`HTTP ${r.status}`);
  return (Array.isArray(json?.candles)?json.candles:[])
    .map((c:any)=>({time:Number(c.time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close),volume:Number(c.volume||0)}))
    .filter((c:Candle)=>Number.isFinite(c.time)&&Number.isFinite(c.open)&&Number.isFinite(c.high)&&Number.isFinite(c.low)&&Number.isFinite(c.close));
}

const panel:CSSProperties={border:"1px solid #24324a",background:"#0b1220",borderRadius:10};
const inputStyle:CSSProperties={background:"#0a1020",border:"1px solid #334155",color:"#e5eefc",borderRadius:7,padding:"8px 10px",fontWeight:700};
const buttonStyle:CSSProperties={...inputStyle,cursor:"pointer"};

export default function CockpitV2(){
  const {symbol,interval,setSymbol,setInterval}=useSharedMarket();
  const [profile,setProfile]=useState<InstrumentProfile>(()=>readProfile(symbol,interval));
  const [candles,setCandles]=useState<Candle[]>([]);
  const [selected,setSelected]=useState<Candle|null>(null);
  const [status,setStatus]=useState("Verbinden …");
  const [busy,setBusy]=useState(false);
  const priceHost=useRef<HTMLDivElement>(null);
  const chart=useRef<IChartApi|null>(null);
  const series=useRef<ISeriesApi<"Candlestick">|null>(null);
  const candleMap=useMemo(()=>new Map(candles.map(c=>[Number(c.time),c])),[candles]);
  const shown=useMemo(()=>profile.chartMode==="heikin"?heikin(candles):candles,[candles,profile.chartMode]);

  useEffect(()=>{
    const next=readProfile(symbol,interval);
    setProfile(next);
    if(next.interval!==interval) setInterval(next.interval);
  },[symbol]);

  useEffect(()=>{
    setProfile(p=>p.interval===interval?p:{...p,interval});
  },[interval]);

  useEffect(()=>{
    if(!priceHost.current) return;
    const c=createChart(priceHost.current,{
      autoSize:true,
      layout:{background:{color:"#070b16"},textColor:"#dbe4ff"},
      grid:{vertLines:{color:"#172033"},horzLines:{color:"#172033"}},
      crosshair:{mode:CrosshairMode.Normal},
      rightPriceScale:{borderColor:"#334155",minimumWidth:78},
      timeScale:{borderColor:"#334155",timeVisible:true,secondsVisible:false,tickMarkFormatter:(time:any)=>chartBerlinTime(Number(time))},
      localization:{timeFormatter:(time:any)=>chartBerlinTime(Number(time))},
    });
    const s=c.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",wickUpColor:"#22c55e",wickDownColor:"#ef4444",borderVisible:false});
    chart.current=c; series.current=s;
    c.subscribeCrosshairMove(param=>{
      if(!param.time) return;
      const row=candleMap.get(Number(param.time));
      if(row) setSelected(row);
    });
    return()=>{c.remove();chart.current=null;series.current=null;};
  },[candleMap]);

  useEffect(()=>{
    series.current?.setData(shown.map(c=>({time:c.time as Time,open:c.open,high:c.high,low:c.low,close:c.close})));
    if(shown.length&&!selected) setSelected(candles[candles.length-1]||null);
  },[shown]);

  async function load(){
    try{
      setBusy(true); setStatus(`${symbol} ${interval} wird geladen …`);
      const rows=await fetchCandles(symbol,interval);
      setCandles(rows);
      setSelected(rows[rows.length-1]||null);
      setStatus(`${symbol} ${interval} · ${rows.length} Kerzen`);
      queueMicrotask(()=>chart.current?.timeScale().fitContent());
    }catch(e){setStatus(`Fehler: ${e instanceof Error?e.message:String(e)}`);}finally{setBusy(false);}
  }

  useEffect(()=>{void load(); const t=window.setInterval(()=>void load(),30000); return()=>window.clearInterval(t);},[symbol,interval]);

  function patchProfile(patch:Partial<InstrumentProfile>){setProfile(prev=>({...prev,...patch}));}
  function persist(){saveProfile(profile);setStatus(`Profil ${symbol} gespeichert`);}

  const moduleTabs:ModuleKey[]=["view","entry","exit","channel","poc"];
  const active=profile.activeModule;

  return <div style={{height:"calc(100vh - 84px)",minHeight:720,display:"grid",gridTemplateRows:"auto 1fr",gap:10,padding:8,color:"#dbe4ff",background:"#050914"}}>
    <div style={{...panel,padding:10,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
      <b style={{fontSize:16,color:"#67e8f9",marginRight:6}}>COCKPIT V2</b>
      <select value={symbol} onChange={e=>setSymbol(e.target.value)} style={inputStyle}>{SYMBOLS.map(x=><option key={x}>{x}</option>)}</select>
      <select value={interval} onChange={e=>setInterval(e.target.value)} style={inputStyle}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select>
      <button onClick={()=>patchProfile({chartMode:profile.chartMode==="candles"?"heikin":"candles"})} style={{...buttonStyle,borderColor:profile.chartMode==="heikin"?"#2563eb":"#334155",color:profile.chartMode==="heikin"?"#93c5fd":"#e5eefc"}}>{profile.chartMode==="heikin"?"HEIKIN":"KERZEN"}</button>
      <button disabled={busy} onClick={()=>void load()} style={buttonStyle}>{busy?"LÄDT …":"AKTUALISIEREN"}</button>
      <div style={{flex:1,minWidth:220,padding:"8px 12px",borderRadius:7,border:"1px solid #166534",background:"#052e1a",color:"#86efac",fontWeight:800}}>{status}</div>
      <button onClick={persist} style={{...buttonStyle,borderColor:"#0f766e",background:"#0f766e",color:"white"}}>PROFIL SPEICHERN</button>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 360px",gap:10,minHeight:0}}>
      <div style={{display:"grid",gridTemplateRows:`minmax(430px,1fr) ${profile.showPaneA?"180px":"0px"} ${profile.showPaneB?"180px":"0px"}`,gap:8,minHeight:0}}>
        <div style={{...panel,overflow:"hidden",position:"relative"}}>
          <div ref={priceHost} style={{position:"absolute",inset:0}} />
          <div style={{position:"absolute",top:10,left:12,zIndex:3,padding:"5px 8px",borderRadius:6,background:"#08111ecc",border:"1px solid #23324a",fontSize:12,fontWeight:800}}>{symbol} · {interval} · {profile.chartMode==="heikin"?"Heikin":"Candles"}</div>
        </div>
        {profile.showPaneA&&<div style={{...panel,padding:12,display:"flex",alignItems:"center",justifyContent:"center",color:"#64748b",fontWeight:800}}>INDIKATOR-PANE A · vorbereitet</div>}
        {profile.showPaneB&&<div style={{...panel,padding:12,display:"flex",alignItems:"center",justifyContent:"center",color:"#64748b",fontWeight:800}}>INDIKATOR-PANE B · vorbereitet</div>}
      </div>

      <aside style={{display:"grid",gridTemplateRows:"minmax(300px,auto) minmax(0,1fr)",gap:10,minHeight:0}}>
        <section style={{...panel,padding:12,overflow:"auto"}}>
          <div style={{fontWeight:900,fontSize:14,marginBottom:10}}>MODUL-EINSTELLUNGEN</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,marginBottom:12}}>{moduleTabs.map(k=><button key={k} onClick={()=>patchProfile({activeModule:k})} style={{...buttonStyle,padding:"7px 4px",fontSize:11,borderColor:active===k?"#7c3aed":"#334155",background:active===k?"#4c1d95":"#0a1020"}}>{k.toUpperCase()}</button>)}</div>
          {active==="view"&&<div style={{display:"grid",gap:10}}>
            <label style={{display:"grid",gap:5,fontSize:12,color:"#94a3b8"}}>Chart-TF<select value={interval} onChange={e=>setInterval(e.target.value)} style={inputStyle}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select></label>
            <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>Pane A vorbereiten<input type="checkbox" checked={profile.showPaneA} onChange={e=>patchProfile({showPaneA:e.target.checked})}/></label>
            <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>Pane B vorbereiten<input type="checkbox" checked={profile.showPaneB} onChange={e=>patchProfile({showPaneB:e.target.checked})}/></label>
            <div style={{padding:10,border:"1px dashed #334155",borderRadius:8,color:"#64748b",fontSize:12}}>ENTRY, EXIT, CHANNEL und POC sind absichtlich noch leer. Erst wenn der Chart sitzt, setzen wir Modul für Modul ein.</div>
          </div>}
          {active!=="view"&&<div style={{padding:12,border:"1px dashed #334155",borderRadius:8,color:"#94a3b8"}}><b>{active.toUpperCase()}</b><div style={{marginTop:6,color:"#64748b"}}>Steckplatz vorbereitet. Noch keine Logik, keine Parameter, keine Marker.</div></div>}
        </section>

        <section style={{...panel,padding:12,overflow:"auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><b style={{fontSize:14}}>INSPECTOR</b><span style={{fontSize:11,color:"#64748b"}}>Crosshair über Chart</span></div>
          {selected?<div style={{display:"grid",gap:7}}>
            <InfoRow k="Zeit" v={chartBerlinTime(selected.time)}/>
            <InfoRow k="Open" v={selected.open}/><InfoRow k="High" v={selected.high}/><InfoRow k="Low" v={selected.low}/><InfoRow k="Close" v={selected.close}/>
            <div style={{height:1,background:"#24324a",margin:"5px 0"}}/>
            <InfoRow k="ENTRY" v="—" muted/><InfoRow k="EXIT" v="—" muted/><InfoRow k="CHANNEL" v="—" muted/><InfoRow k="DELTA" v="—" muted/><InfoRow k="POC" v="—" muted/><InfoRow k="CONTROLLER" v="—" muted/>
          </div>:<div style={{color:"#64748b"}}>Noch keine Kerze ausgewählt.</div>}
        </section>
      </aside>
    </div>
  </div>;
}

function InfoRow({k,v,muted=false}:{k:string;v:any;muted?:boolean}){
  return <div style={{display:"grid",gridTemplateColumns:"110px 1fr",gap:8,paddingBottom:6,borderBottom:"1px solid #182236"}}><span style={{color:"#7dd3fc",fontWeight:800}}>{k}</span><span style={{textAlign:"right",fontWeight:800,color:muted?"#64748b":"#e5eefc"}}>{typeof v==="number"?v.toFixed(3):String(v)}</span></div>;
}
