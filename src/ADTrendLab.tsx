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

type Candle = { time:number; open:number; high:number; low:number; close:number };
type Side = "long" | "short";
type SourceEvent = { type:"entry"|"exit"; direction?:Side; time:number; price:number; reason?:string };
type Trade = { side:Side; entryTime:number; entryPrice:number; exitTime:number; exitPrice:number; pnl:number; entryReason:string; exitReason:string };
type Marker = { time:number; side:Side; kind:"entry"|"exit"; text:string; color:string };
type Metrics = { trades:number; wins:number; losses:number; net:number; grossWin:number; grossLoss:number; profitFactor:number; winRate:number; maxDrawdown:number };
type Simulation = { trades:Trade[]; markers:Marker[]; metrics:Metrics };

type LiveReplay = { events?:SourceEvent[] };

async function fetchJson(url:string) {
  const response = await fetch(url, { cache:"no-store" });
  const text = await response.text();
  let json:any;
  try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0,160)}`); }
  if (!response.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${response.status}`);
  return json;
}

function ema(values:number[], length:number):number[] {
  if (!values.length) return [];
  const alpha = 2 / (Math.max(1,length) + 1);
  const out = new Array<number>(values.length);
  out[0] = values[0];
  for (let i=1;i<values.length;i+=1) out[i] = alpha * values[i] + (1-alpha) * out[i-1];
  return out;
}

function rsi(values:number[], length:number):number[] {
  const out = new Array<number>(values.length).fill(50);
  if (values.length < 2) return out;
  const n = Math.max(1,length);
  let avgGain = 0; let avgLoss = 0;
  for (let i=1;i<=Math.min(n,values.length-1);i+=1) {
    const d = values[i]-values[i-1]; avgGain += Math.max(0,d); avgLoss += Math.max(0,-d);
  }
  avgGain /= n; avgLoss /= n;
  for (let i=1;i<values.length;i+=1) {
    if (i>n) {
      const d=values[i]-values[i-1];
      avgGain=((avgGain*(n-1))+Math.max(0,d))/n;
      avgLoss=((avgLoss*(n-1))+Math.max(0,-d))/n;
    }
    out[i]=avgLoss===0?100:100-(100/(1+avgGain/avgLoss));
  }
  return out;
}

function adRatio(candles:Candle[], length:number):number[] {
  const n=Math.max(1,Math.round(length));
  const out=new Array<number>(candles.length).fill(1);
  let up=0; let down=0;
  const flags=candles.map(c=>c.close-c.open>=0?1:-1);
  for(let i=0;i<candles.length;i+=1){
    if(flags[i]>0)up+=1;else down+=1;
    if(i>=n){if(flags[i-n]>0)up-=1;else down-=1;}
    out[i]=down===0?up:up/down;
  }
  return out;
}

function computeMetrics(trades:Trade[]):Metrics {
  let grossWin=0,grossLoss=0,net=0,equity=0,peak=0,maxDrawdown=0,wins=0;
  for(const t of trades){
    net+=t.pnl; equity+=t.pnl; peak=Math.max(peak,equity); maxDrawdown=Math.max(maxDrawdown,peak-equity);
    if(t.pnl>0){grossWin+=t.pnl;wins+=1;}else grossLoss+=Math.abs(t.pnl);
  }
  return {trades:trades.length,wins,losses:trades.length-wins,net,grossWin,grossLoss,profitFactor:grossLoss>0?grossWin/grossLoss:grossWin>0?999:0,winRate:trades.length?wins/trades.length*100:0,maxDrawdown};
}

function closeTrade(position:{side:Side;entryTime:number;entryPrice:number;entryReason:string}, candle:Candle, reason:string):Trade {
  const pnl=position.side==="long"?candle.close-position.entryPrice:position.entryPrice-candle.close;
  return {side:position.side,entryTime:position.entryTime,entryPrice:position.entryPrice,exitTime:candle.time,exitPrice:candle.close,pnl,entryReason:position.entryReason,exitReason:reason};
}

function simulateExtremeFilter(candles:Candle[], ad:number[], sourceEvents:SourceEvent[]):Simulation {
  const entryByTime=new Map<number,SourceEvent[]>();
  for(const event of sourceEvents){
    if(event.type!=="entry"||!event.direction)continue;
    const list=entryByTime.get(Number(event.time))||[];list.push(event);entryByTime.set(Number(event.time),list);
  }
  const trades:Trade[]=[]; const markers:Marker[]=[];
  let position:null|{side:Side;entryTime:number;entryPrice:number;entryReason:string}=null;
  for(let i=1;i<candles.length;i+=1){
    const c=candles[i]; const prev=ad[i-1]; const now=ad[i];
    if(position){
      const exitLong=position.side==="long"&&now<=1;
      const exitShort=position.side==="short"&&now>=1;
      if(exitLong||exitShort){
        trades.push(closeTrade(position,c,"AD zurück an 1"));
        markers.push({time:c.time,side:position.side,kind:"exit",text:"EXIT AD=1",color:"#facc15"});
        position=null;
      }
    }
    if(!position){
      const events=entryByTime.get(c.time)||[];
      for(const e of events){
        const allowed=e.direction==="long"?now>1:now<1;
        if(!allowed)continue;
        position={side:e.direction!,entryTime:c.time,entryPrice:c.close,entryReason:"EXTREM + AD"};
        markers.push({time:c.time,side:e.direction!,kind:"entry",text:e.direction==="long"?"LONG EXTREM":"SHORT EXTREM",color:e.direction==="long"?"#22c55e":"#ef4444"});
        break;
      }
    }
    void prev;
  }
  if(position&&candles.length){const c=candles[candles.length-1];trades.push(closeTrade(position,c,"Datenende"));}
  return {trades,markers,metrics:computeMetrics(trades)};
}

function simulateRegimePullback(candles:Candle[], ad:number[], rsiValues:number[], signal:number[]):Simulation {
  const trades:Trade[]=[]; const markers:Marker[]=[];
  let position:null|{side:Side;entryTime:number;entryPrice:number;entryReason:string}=null;
  for(let i=1;i<candles.length;i+=1){
    const c=candles[i]; const now=ad[i];
    if(position){
      const exitLong=position.side==="long"&&now<=1;
      const exitShort=position.side==="short"&&now>=1;
      if(exitLong||exitShort){
        trades.push(closeTrade(position,c,"AD zurück an 1"));
        markers.push({time:c.time,side:position.side,kind:"exit",text:"EXIT AD=1",color:"#facc15"});
        position=null;
      }
    }
    if(!position){
      const crossUp=rsiValues[i-1]<=signal[i-1]&&rsiValues[i]>signal[i];
      const crossDown=rsiValues[i-1]>=signal[i-1]&&rsiValues[i]<signal[i];
      if(now>1&&crossUp){
        position={side:"long",entryTime:c.time,entryPrice:c.close,entryReason:"AD LONG + RSI Cross"};
        markers.push({time:c.time,side:"long",kind:"entry",text:"LONG PULLBACK",color:"#22c55e"});
      }else if(now<1&&crossDown){
        position={side:"short",entryTime:c.time,entryPrice:c.close,entryReason:"AD SHORT + RSI Cross"};
        markers.push({time:c.time,side:"short",kind:"entry",text:"SHORT PULLBACK",color:"#ef4444"});
      }
    }
  }
  if(position&&candles.length){const c=candles[candles.length-1];trades.push(closeTrade(position,c,"Datenende"));}
  return {trades,markers,metrics:computeMetrics(trades)};
}

export default function ADTrendLab(){
  const {symbol,interval,setSymbol,setInterval}=useSharedMarket();
  const [candles,setCandles]=useState<Candle[]>([]);
  const [sourceEvents,setSourceEvents]=useState<SourceEvent[]>([]);
  const [adLength,setAdLength]=useState(11);
  const [rsiLength,setRsiLength]=useState(14);
  const [rsiSignalLength,setRsiSignalLength]=useState(9);
  const [view,setView]=useState<"a"|"b">("a");
  const [status,setStatus]=useState("Lade …");
  const priceHost=useRef<HTMLDivElement>(null);const adHost=useRef<HTMLDivElement>(null);const rsiHost=useRef<HTMLDivElement>(null);
  const priceChart=useRef<IChartApi|null>(null);const adChart=useRef<IChartApi|null>(null);const rsiChart=useRef<IChartApi|null>(null);
  const candleSeries=useRef<ISeriesApi<"Candlestick">|null>(null);const markerApi=useRef<any>(null);
  const adLine=useRef<ISeriesApi<"Line">|null>(null);const oneLine=useRef<ISeriesApi<"Line">|null>(null);
  const rsiLine=useRef<ISeriesApi<"Line">|null>(null);const signalLine=useRef<ISeriesApi<"Line">|null>(null);

  const closes=useMemo(()=>candles.map(c=>c.close),[candles]);
  const ad=useMemo(()=>adRatio(candles,adLength),[candles,adLength]);
  const rsiValues=useMemo(()=>rsi(closes,rsiLength),[closes,rsiLength]);
  const rsiSignal=useMemo(()=>ema(rsiValues,rsiSignalLength),[rsiValues,rsiSignalLength]);
  const modeA=useMemo(()=>simulateExtremeFilter(candles,ad,sourceEvents),[candles,ad,sourceEvents]);
  const modeB=useMemo(()=>simulateRegimePullback(candles,ad,rsiValues,rsiSignal),[candles,ad,rsiValues,rsiSignal]);
  const active=view==="a"?modeA:modeB;

  useEffect(()=>{
    if(!priceHost.current||!adHost.current||!rsiHost.current)return;
    const common={layout:{background:{color:"#070b16"},textColor:"#dbe4ff"},grid:{vertLines:{color:"#172033"},horzLines:{color:"#172033"}},rightPriceScale:{borderColor:"#334155",minimumWidth:72},timeScale:{borderColor:"#334155",timeVisible:true},autoSize:true} as const;
    const pc=createChart(priceHost.current,common);const ac=createChart(adHost.current,common);const rc=createChart(rsiHost.current,common);
    const cs=pc.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",wickUpColor:"#22c55e",wickDownColor:"#ef4444",borderVisible:false});
    const al=ac.addSeries(LineSeries,{color:"#38bdf8",lineWidth:2});const ol=ac.addSeries(LineSeries,{color:"#facc15",lineWidth:2,lineStyle:2});
    const rl=rc.addSeries(LineSeries,{color:"#a855f7",lineWidth:2});const sl=rc.addSeries(LineSeries,{color:"#facc15",lineWidth:2});
    markerApi.current=createSeriesMarkers(cs,[]);priceChart.current=pc;adChart.current=ac;rsiChart.current=rc;candleSeries.current=cs;adLine.current=al;oneLine.current=ol;rsiLine.current=rl;signalLine.current=sl;
    let syncing=false;const sync=(source:IChartApi,a:IChartApi,b:IChartApi)=>source.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(!range||syncing)return;syncing=true;a.timeScale().setVisibleLogicalRange(range);b.timeScale().setVisibleLogicalRange(range);syncing=false;});
    sync(pc,ac,rc);sync(ac,pc,rc);sync(rc,pc,ac);
    return()=>{pc.remove();ac.remove();rc.remove();};
  },[]);

  useEffect(()=>{
    candleSeries.current?.setData(candles.map(c=>({...c,time:c.time as Time})));
    adLine.current?.setData(candles.map((c,i)=>({time:c.time as Time,value:ad[i]})));
    oneLine.current?.setData(candles.map(c=>({time:c.time as Time,value:1})));
    rsiLine.current?.setData(candles.map((c,i)=>({time:c.time as Time,value:rsiValues[i]})));
    signalLine.current?.setData(candles.map((c,i)=>({time:c.time as Time,value:rsiSignal[i]})));
    markerApi.current?.setMarkers(active.markers.map(m=>({time:m.time as Time,position:m.kind==="entry"?(m.side==="long"?"belowBar":"aboveBar"):"aboveBar",shape:m.kind==="entry"?(m.side==="long"?"arrowUp":"arrowDown"):"circle",color:m.color,text:m.text,size:m.kind==="entry"?1.2:.8})).sort((a:any,b:any)=>Number(a.time)-Number(b.time)));
  },[candles,ad,rsiValues,rsiSignal,active]);

  async function load(){
    setStatus("Lade Kerzen und V8.5-Entries …");
    try{
      const [data,live]=await Promise.all([
        fetchJson(`${BACKEND_BASE}/qmomentum/data?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=5000&_ts=${Date.now()}`),
        fetchJson(`${BACKEND_BASE}/qmomentum/extreme-live/state?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=5000&_ts=${Date.now()}`),
      ]);
      setCandles(Array.isArray(data.candles)?data.candles:[]);
      setSourceEvents(Array.isArray((live as LiveReplay).events)?(live as LiveReplay).events!:[]);
      setStatus(`${Array.isArray(data.candles)?data.candles.length:0} Kerzen · ${Array.isArray((live as LiveReplay).events)?(live as LiveReplay).events!.filter(e=>e.type==="entry").length:0} Extreme-Entries geladen`);
    }catch(error){setStatus(`Fehler: ${error instanceof Error?error.message:String(error)}`);}
  }
  useEffect(()=>{void load();},[symbol,interval]);

  return <div style={{minHeight:"100vh",background:"#050914",color:"#eef2ff",padding:10,fontFamily:"Inter,Arial,sans-serif",boxSizing:"border-box"}}>
    <header style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap",padding:"6px 8px 12px"}}>
      <div><b style={{fontSize:20}}>AD Trend Lab V1</b><div style={{fontSize:11,color:"#94a3b8"}}>AD-Regime über/unter 1 · Länge 11 · ohne Puffer</div></div>
      <select value={symbol} onChange={e=>setSymbol(e.target.value)} style={input}>{SYMBOLS.map(x=><option key={x}>{x}</option>)}</select>
      <select value={interval} onChange={e=>setInterval(e.target.value)} style={input}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select>
      <label style={label}>AD Länge<input type="number" min="2" max="50" value={adLength} onChange={e=>setAdLength(Math.max(2,Number(e.target.value)||11))} style={smallInput}/></label>
      <label style={label}>RSI<input type="number" min="2" max="50" value={rsiLength} onChange={e=>setRsiLength(Math.max(2,Number(e.target.value)||14))} style={smallInput}/></label>
      <label style={label}>Signal<input type="number" min="1" max="30" value={rsiSignalLength} onChange={e=>setRsiSignalLength(Math.max(1,Number(e.target.value)||9))} style={smallInput}/></label>
      <button onClick={()=>setView("a")} style={tab(view==="a")}>A · EXTREM + AD</button>
      <button onClick={()=>setView("b")} style={tab(view==="b")}>B · AD + PULLBACK</button>
      <span style={{fontSize:12,color:"#22c55e",marginLeft:"auto"}}>{status}</span>
    </header>
    <section style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(260px,1fr))",gap:8,marginBottom:8}}>
      <MetricsCard title="MODUS A · EXTREME-ENTRY + AD-FILTER" metrics={modeA.metrics} active={view==="a"} onClick={()=>setView("a")}/>
      <MetricsCard title="MODUS B · AD-REGIME + RSI-KNICK" metrics={modeB.metrics} active={view==="b"} onClick={()=>setView("b")}/>
    </section>
    <section style={{display:"grid",gridTemplateRows:"minmax(430px,55vh) 190px 190px",gap:8}}>
      <div ref={priceHost} style={chartBox}/><div ref={adHost} style={chartBox}/><div ref={rsiHost} style={chartBox}/>
    </section>
    <section style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
      <Info title="REGELN MODUS A"><p>Bestehender V8.5-Extreme-Entry wird nur akzeptiert, wenn AD die Richtung bestätigt.</p><code>AD &gt; 1 → nur LONG · AD &lt; 1 → nur SHORT · Exit bei Rückkehr an 1</code></Info>
      <Info title="REGELN MODUS B"><p>AD bestimmt das Regime. Der nächste RSI/Signal-Cross in Trendrichtung dient als Pullback-/Knick-Entry.</p><code>AD &gt; 1 + RSI Cross Up → LONG · AD &lt; 1 + RSI Cross Down → SHORT · Exit bei 1</code></Info>
    </section>
  </div>;
}

function MetricsCard({title,metrics,active,onClick}:{title:string;metrics:Metrics;active:boolean;onClick:()=>void}){
  return <button onClick={onClick} style={{textAlign:"left",background:active?"#17213a":"#0c1322",border:`1px solid ${active?"#a855f7":"#26344d"}`,borderRadius:10,padding:14,color:"#eef2ff",cursor:"pointer"}}><div style={{fontSize:12,color:"#94a3b8",marginBottom:9}}>{title}</div><div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}><Stat k="PF" v={metrics.profitFactor>=999?"∞":metrics.profitFactor.toFixed(2)}/><Stat k="Trades" v={String(metrics.trades)}/><Stat k="Netto" v={metrics.net.toFixed(1)}/><Stat k="Winrate" v={`${metrics.winRate.toFixed(1)}%`}/><Stat k="Drawdown" v={metrics.maxDrawdown.toFixed(1)}/></div></button>;
}
function Stat({k,v}:{k:string;v:string}){return <div><div style={{fontSize:10,color:"#94a3b8"}}>{k}</div><b style={{fontSize:18}}>{v}</b></div>}
function Info({title,children}:{title:string;children:ReactNode}){return <div style={{background:"#0c1322",border:"1px solid #26344d",borderRadius:10,padding:13}}><b>{title}</b><div style={{fontSize:12,color:"#cbd5e1",lineHeight:1.55}}>{children}</div></div>}
const input:CSSProperties={background:"#0b1322",border:"1px solid #334155",borderRadius:7,color:"#fff",padding:"8px 10px"};
const smallInput:CSSProperties={...input,width:66,padding:"6px 8px"};
const label:CSSProperties={display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#94a3b8"};
const tab=(active:boolean):CSSProperties=>({background:active?"#6d28d9":"#111827",border:`1px solid ${active?"#a855f7":"#334155"}`,borderRadius:8,color:"#fff",padding:"8px 11px",fontWeight:800,cursor:"pointer"});
const chartBox:CSSProperties={background:"#070b16",border:"1px solid #26344d",borderRadius:9,minHeight:0,overflow:"hidden"};
