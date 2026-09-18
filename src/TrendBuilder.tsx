import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, LineSeries, createChart, type IChartApi, type Time } from "lightweight-charts";

const BACKEND="https://qtrend-trading-engine.onrender.com";
const SYMBOLS=["DE40","US30","US100","UK100","J225","CN50","BTCUSD","ETHUSD","GOLD","SILVER","OIL_CRUDE","US500","CORN"];
type C={time:number;open:number;high:number;low:number;close:number};
type V={id:string;family:string;speed:string;trend:number[];changes:number;params:string};

function ema(a:number[],n:number){if(!a.length)return[];const k=2/(n+1),o=[a[0]];for(let i=1;i<a.length;i++)o.push(k*a[i]+(1-k)*o[i-1]);return o}
function regression(a:number[],n:number){return a.map((_,i)=>{if(i<n-1)return 0;let sx=0,sy=0,sxx=0,sxy=0;for(let j=0;j<n;j++){const y=a[i-n+1+j];sx+=j;sy+=y;sxx+=j*j;sxy+=j*y}const d=n*sxx-sx*sx;return d?(n*sxy-sx*sy)/d:0})}
function flips(t:number[]){let n=0,p=0;for(const x of t){if(x&&p&&x!==p)n++;if(x)p=x}return n}
function carry(raw:number[]){let p=1;return raw.map(x=>{if(x)p=x;return p})}
function resample(c:C[],mins:number){const sec=mins*60,o:C[]=[];let cur:C|null=null,b=-1;for(const x of c){const k=Math.floor(x.time/sec)*sec;if(k!==b){if(cur)o.push(cur);b=k;cur={time:k,open:x.open,high:x.high,low:x.low,close:x.close}}else if(cur){cur.high=Math.max(cur.high,x.high);cur.low=Math.min(cur.low,x.low);cur.close=x.close}}if(cur)o.push(cur);return o}
function expand(base:C[],slow:C[],trend:number[]){let j=0,dir=trend[0]||1;return base.map(c=>{while(j+1<slow.length&&slow[j+1].time<=c.time){j++;dir=trend[j]||dir}return dir})}
function build(c:C[]):V[]{const out:V[]=[];const defs=[
 ["REGRESSION","4H","SEHR LANGSAM",240,10],["REGRESSION","2H","LANGSAM",120,14],["REGRESSION","1H","MITTEL",60,18],
 ["MA STRUCTURE","4H","SEHR LANGSAM",240,5],["MA STRUCTURE","2H","LANGSAM",120,8],["MA STRUCTURE","1H","MITTEL",60,12],
 ["BREAKOUT","4H","SEHR LANGSAM",240,5],["BREAKOUT","2H","LANGSAM",120,8],["BREAKOUT","1H","MITTEL",60,12],
 ["EFFICIENCY","4H","SEHR LANGSAM",240,5],["EFFICIENCY","2H","LANGSAM",120,8],["EFFICIENCY","30M","MITTEL",30,16]
 ] as const;
 for(const [family,tf,speed,mins,n] of defs){const r=resample(c,mins),x=r.map(z=>z.close);let t:number[]=[];
  if(family==="REGRESSION"){const sl=regression(x,n);t=carry(sl.map(v=>v>=0?1:-1))}
  else if(family==="MA STRUCTURE"){const a=ema(x,n),b=ema(x,n*2);t=carry(x.map((_,i)=>a[i]>=b[i]?1:-1))}
  else if(family==="BREAKOUT"){let d=1;t=x.map((v,i)=>{if(i>=n){let hi=-Infinity,lo=Infinity;for(let j=i-n;j<i;j++){hi=Math.max(hi,r[j].high);lo=Math.min(lo,r[j].low)}if(v>hi)d=1;else if(v<lo)d=-1}return d})}
  else {let d=1;t=x.map((v,i)=>{if(i<n)return d;let path=0;for(let j=i-n+1;j<=i;j++)path+=Math.abs(x[j]-x[j-1]);const net=v-x[i-n],er=path?Math.abs(net)/path:0;if(er>=0.30&&net!==0)d=net>0?1:-1;return d})}
  const full=expand(c,r,t);out.push({id:"T"+String(out.length+1).padStart(2,"0"),family,speed,trend:full,changes:flips(full),params:`${tf} intern · ${family==="MA STRUCTURE"?"EMA "+n+"/"+n*2:family==="EFFICIENCY"?"ER "+n+" · 0.30":family==="BREAKOUT"?"Structure "+n:"Slope "+n}`})
 }return out}
export default function TrendBuilder(){
 const [symbol,setSymbol]=useState("J225"),[candles,setCandles]=useState<C[]>([]),[sel,setSel]=useState(0),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 const host=useRef<HTMLDivElement>(null),chart=useRef<IChartApi|null>(null);const vars=useMemo(()=>build(candles),[candles]),v=vars[sel];
 async function load(){setBusy(true);setErr("");try{const r=await fetch(`${BACKEND}/v5/candles?symbol=${encodeURIComponent(symbol)}&interval=1m&limit=50000&refreshLatest=false`,{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);setCandles((j.candles||[]).map((z:any)=>({time:Number(z.time),open:Number(z.open),high:Number(z.high),low:Number(z.low),close:Number(z.close)})));setSel(0)}catch(e:any){setErr(e.message||String(e))}finally{setBusy(false)}}
 useEffect(()=>{void load()},[symbol]);
 useEffect(()=>{if(!host.current||!candles.length||!v)return;chart.current?.remove();const ch=createChart(host.current,{height:620,layout:{background:{color:"#07111d"},textColor:"#a9bdd0"},grid:{vertLines:{color:"#132235"},horzLines:{color:"#132235"}},timeScale:{timeVisible:true,secondsVisible:false}});chart.current=ch;const cs=ch.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",borderVisible:false,wickUpColor:"#22c55e",wickDownColor:"#ef4444"});cs.setData(candles.map(c=>({...c,time:c.time as Time})));const ls=ch.addSeries(LineSeries,{lineWidth:4,priceLineVisible:false,lastValueVisible:false});ls.setData(candles.map((c,i)=>({time:c.time as Time,value:c.close,color:v.trend[i]>0?"#22c55e":"#ef4444"})) as any);ch.timeScale().fitContent();const ro=new ResizeObserver(()=>ch.applyOptions({width:host.current?.clientWidth||800}));ro.observe(host.current);return()=>{ro.disconnect();ch.remove();chart.current=null}},[candles,v]);
 return <div style={{padding:14,color:"#dbeafe",background:"#050b12",minHeight:"100vh",fontFamily:"Inter,system-ui"}}>
  <div style={{display:"flex",gap:10,alignItems:"end",flexWrap:"wrap",marginBottom:12}}><div><div style={{fontSize:11,color:"#7dd3fc",fontWeight:800}}>TREND BUILDER V2 · RESEARCH ONLY</div><h2 style={{margin:"3px 0 0"}}>Große Trendphasen · 1m Chart · interne 30m–4h Entscheidung</h2></div><label style={{marginLeft:"auto"}}><div style={{fontSize:11,color:"#94a3b8"}}>Instrument</div><select value={symbol} onChange={e=>setSymbol(e.target.value)} style={{background:"#0b1624",color:"#fff",border:"1px solid #334155",padding:"8px",borderRadius:6}}>{SYMBOLS.map(s=><option key={s}>{s}</option>)}</select></label><button onClick={load} disabled={busy} style={{padding:"8px 12px",background:"#12304b",color:"#fff",border:"1px solid #2563eb",borderRadius:6,fontWeight:800}}>{busy?"LÄDT …":"NEU LADEN"}</button></div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(12,minmax(55px,1fr))",gap:5,marginBottom:8}}>{vars.map((x,i)=><button key={x.id} onClick={()=>setSel(i)} style={{padding:"7px 3px",background:i===sel?"#164e63":"#0b1624",color:i===sel?"#67e8f9":"#cbd5e1",border:`1px solid ${i===sel?"#0891b2":"#263548"}`,borderRadius:5,fontWeight:800}}>{x.id}</button>)}</div>
  {v&&<div style={{display:"flex",gap:18,alignItems:"center",padding:"8px 10px",background:"#0b1624",border:"1px solid #263548",borderRadius:7,marginBottom:8}}><b style={{color:"#67e8f9"}}>{v.id} · {v.family} · {v.speed}</b><span>{v.params}</span><span><b>{v.changes}</b> Trendwechsel im geladenen Zeitraum</span><span style={{marginLeft:"auto",color:"#94a3b8"}}>Kein PF · kein NET</span></div>}
  {err&&<div style={{color:"#fca5a5",padding:10}}>{err}</div>}<div ref={host} style={{width:"100%",border:"1px solid #263548",borderRadius:8,overflow:"hidden"}} />
  <div style={{marginTop:10,color:"#94a3b8",fontSize:12}}>V2: Trend wird kausal auf 30m/1h/2h/4h gebildet und anschließend auf den 1m-Chart übertragen. Dadurch suchen wir bewusst große Marktphasen statt 1m-Rauschen.</div>
 </div>
}