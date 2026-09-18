import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, LineSeries, createChart, type IChartApi, type Time } from "lightweight-charts";

const BACKEND="https://qtrend-trading-engine.onrender.com";
const SYMBOLS=["DE40","US30","US100","UK100","J225","CN50","BTCUSD","ETHUSD","GOLD","SILVER","OIL_CRUDE","US500","CORN"];
const TREND_LOCKS:Record<string,string>={DE40:"T37",US30:"T40",US100:"T44",UK100:"T42",J225:"T43",BTCUSD:"T41",ETHUSD:"T43",GOLD:"T44",SILVER:"T43",OIL_CRUDE:"T43",US500:"T41",CORN:"T41"};
type C={time:number;open:number;high:number;low:number;close:number};
type V={id:string;family:string;speed:string;trend:number[];changes:number;params:string};
function linregLast(a:number[],n:number,i:number){if(i<n-1)return a[i]??0;let sx=0,sy=0,sxx=0,sxy=0;for(let j=0;j<n;j++){const y=a[i-n+1+j];sx+=j;sy+=y;sxx+=j*j;sxy+=j*y}const d=n*sxx-sx*sx,m=d?(n*sxy-sx*sy)/d:0,b=(sy-m*sx)/n;return b+m*(n-1)}
function lrcControl(c:C[],mins:number,n:number){
 const r=resample(c,mins),op=r.map(z=>z.open),cl=r.map(z=>z.close),sec=mins*60;
 let dir=1,j=-1;
 const decided=r.map((_,i)=>{if(i<n-1)return dir;const lo=linregLast(op,n,i),lc=linregLast(cl,n,i);dir=lc>=lo?1:-1;return dir});
 dir=1;
 return c.map(x=>{while(j+1<r.length&&Number(r[j+1].time)+sec<=Number(x.time)){j++;dir=decided[j]||dir}return dir});
}

function lrcLive(c:C[],mins:number,n:number){
 const sec=mins*60,out:number[]=[];let closed:C[]=[];let cur:C|null=null,b=-1,dir=1;
 for(const x of c){const k=Math.floor(Number(x.time)/sec)*sec;
  if(k!==b){if(cur)closed.push(cur);b=k;cur={time:k,open:x.open,high:x.high,low:x.low,close:x.close}}
  else if(cur){cur.high=Math.max(cur.high,x.high);cur.low=Math.min(cur.low,x.low);cur.close=x.close}
  if(cur){const w=[...closed,cur],op=w.map(z=>z.open),cl=w.map(z=>z.close),i=w.length-1;
   if(i>=n-1){const lo=linregLast(op,n,i),lc=linregLast(cl,n,i);dir=lc>=lo?1:-1}}
  out.push(dir)
 }return out
}
function ema(a:number[],n:number){if(!a.length)return[];const k=2/(n+1),o=[a[0]];for(let i=1;i<a.length;i++)o.push(k*a[i]+(1-k)*o[i-1]);return o}
function regression(a:number[],n:number){return a.map((_,i)=>{if(i<n-1)return 0;let sx=0,sy=0,sxx=0,sxy=0;for(let j=0;j<n;j++){const y=a[i-n+1+j];sx+=j;sy+=y;sxx+=j*j;sxy+=j*y}const d=n*sxx-sx*sx;return d?(n*sxy-sx*sy)/d:0})}
function flips(t:number[]){let n=0,p=0;for(const x of t){if(x&&p&&x!==p)n++;if(x)p=x}return n}
function carry(raw:number[]){let p=1;return raw.map(x=>{if(x)p=x;return p})}
function resample(c:C[],mins:number){const sec=mins*60,o:C[]=[];let cur:C|null=null,b=-1;for(const x of c){const k=Math.floor(x.time/sec)*sec;if(k!==b){if(cur)o.push(cur);b=k;cur={time:k,open:x.open,high:x.high,low:x.low,close:x.close}}else if(cur){cur.high=Math.max(cur.high,x.high);cur.low=Math.min(cur.low,x.low);cur.close=x.close}}if(cur)o.push(cur);return o}
function expandClosed(base:C[],slow:C[],trend:number[],mins:number){const sec=mins*60;let j=-1,dir=1;return base.map(c=>{while(j+1<slow.length&&Number(slow[j+1].time)+sec<=Number(c.time)){j++;dir=trend[j]||dir}return dir})}
function structureTrend(c:C[],lookback:number,breakPct:number,confirm:number){const out:number[]=[];let dir=1,pending=0,pendingN=0;for(let i=0;i<c.length;i++){if(i<lookback){out.push(dir);continue}let hi=-Infinity,lo=Infinity;for(let j=i-lookback;j<i;j++){hi=Math.max(hi,c[j].high);lo=Math.min(lo,c[j].low)}const range=Math.max(1e-9,hi-lo),up=hi+range*breakPct,dn=lo-range*breakPct;let cand=0;if(c[i].close>up)cand=1;else if(c[i].close<dn)cand=-1;if(cand&&cand!==dir){if(pending===cand)pendingN++;else{pending=cand;pendingN=1}if(pendingN>=confirm){dir=cand;pending=0;pendingN=0}}else if(!cand){pending=0;pendingN=0}out.push(dir)}return out}
function build(c:C[]):V[]{const out:V[]=[];const defs=[
 ["REGRESSION","4H","SEHR LANGSAM",240,10],["REGRESSION","2H","LANGSAM",120,14],["REGRESSION","1H","MITTEL",60,18],
 ["MA STRUCTURE","4H","SEHR LANGSAM",240,5],["MA STRUCTURE","2H","LANGSAM",120,8],["MA STRUCTURE","1H","MITTEL",60,12],
 ["BREAKOUT","4H","SEHR LANGSAM",240,5],["BREAKOUT","2H","LANGSAM",120,8],["BREAKOUT","1H","MITTEL",60,12],
 ["EFFICIENCY","4H","SEHR LANGSAM",240,5],["EFFICIENCY","2H","LANGSAM",120,8],["EFFICIENCY","30M","MITTEL",30,16]
 ] as const;
 const lrcDefs=[["LRC CONTROL","1D","L8",1440,8],["LRC CONTROL","2D","L6",2880,6],["LRC CONTROL","2D","L8",2880,8],["LRC CONTROL","2D","L10",2880,10],["LRC CONTROL","2D","L12",2880,12],["LRC CONTROL","3D","L8",4320,8],["LRC CONTROL FAST","1D","L6",1440,6],["LRC CONTROL FAST","1D","L4",1440,4],["LRC CONTROL FAST","12H","L8",720,8],["LRC CONTROL FAST","12H","L6",720,6],["LRC CONTROL FAST","8H","L8",480,8],["LRC CONTROL FAST","8H","L6",480,6],["LRC T22 FINE","12H","L4",720,4],["LRC T22 FINE","12H","L5",720,5],["LRC T22 FINE","12H","L7",720,7],["LRC T22 FINE","12H","L8",720,8],["LRC T22 FINE","10H","L5",600,5],["LRC T22 FINE","10H","L6",600,6],["LRC T22 FINE","10H","L7",600,7],["LRC T22 FINE","14H","L5",840,5],["LRC T22 FINE","14H","L6",840,6],["LRC T22 FINE","14H","L7",840,7]] as const;
 for(const [family,tf,speed,mins,n] of defs){const r=resample(c,mins),x=r.map(z=>z.close);let t:number[]=[];
  if(family==="REGRESSION"){const sl=regression(x,n);t=carry(sl.map(v=>v>=0?1:-1))}
  else if(family==="MA STRUCTURE"){const a=ema(x,n),b=ema(x,n*2);t=carry(x.map((_,i)=>a[i]>=b[i]?1:-1))}
  else if(family==="BREAKOUT"){let d=1;t=x.map((v,i)=>{if(i>=n){let hi=-Infinity,lo=Infinity;for(let j=i-n;j<i;j++){hi=Math.max(hi,r[j].high);lo=Math.min(lo,r[j].low)}if(v>hi)d=1;else if(v<lo)d=-1}return d})}
  else {let d=1;t=x.map((v,i)=>{if(i<n)return d;let path=0;for(let j=i-n+1;j<=i;j++)path+=Math.abs(x[j]-x[j-1]);const net=v-x[i-n],er=path?Math.abs(net)/path:0;if(er>=0.30&&net!==0)d=net>0?1:-1;return d})}
  const full=expandClosed(c,r,t,mins);out.push({id:"T"+String(out.length+1).padStart(2,"0"),family,speed,trend:full,changes:flips(full),params:`${tf} intern · ${family==="MA STRUCTURE"?"EMA "+n+"/"+n*2:family==="EFFICIENCY"?"ER "+n+" · 0.30":family==="BREAKOUT"?"Structure "+n:"Slope "+n}`})
 }
 for(const [family,tf,speed,mins,n] of lrcDefs){const full=lrcControl(c,mins,n);out.push({id:"T"+String(out.length+1).padStart(2,"0"),family,speed,trend:full,changes:flips(full),params:`${tf} intern · Linear Regression Length ${n} · CLOSED HTF`})}
 const liveDefs=[["14H","L5",840,5],["14H","L6",840,6],["14H","L7",840,7],["12H","L4",720,4],["12H","L5",720,5],["12H","L6",720,6],["10H","L5",600,5],["10H","L6",600,6],["8H","L6",480,6],["1D","L4",1440,4],["1D","L6",1440,6],["2D","L6",2880,6]] as const;
 for(const [tf,speed,mins,n] of liveDefs){const full=lrcLive(c,mins,n);out.push({id:"T"+String(out.length+1).padStart(2,"0"),family:"LRC LIVE",speed,trend:full,changes:flips(full),params:`${tf} laufend · Linear Regression Length ${n} · PARTIAL HTF · KAUSAL`})}
 const structDefs=[[120,0,1],[240,0,1],[480,0,1],[720,0,1],[240,.05,1],[480,.05,1],[720,.05,1],[240,0,2],[480,0,2],[720,0,2],[480,.05,2],[720,.05,2]] as const;
 for(const [lb,pct,confirm] of structDefs){const full=structureTrend(c,lb,pct,confirm);out.push({id:"T"+String(out.length+1).padStart(2,"0"),family:"STRUCTURE",speed:`${lb}m`,trend:full,changes:flips(full),params:`Preisstruktur · Lookback ${lb}m · Break ${Math.round(pct*100)}% Range · Bestätigung ${confirm}x · KAUSAL`})}
 return out}
export default function TrendBuilder(){
 const [symbol,setSymbol]=useState("J225"),[candles,setCandles]=useState<C[]>([]),[sel,setSel]=useState(42),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 const host=useRef<HTMLDivElement>(null),chart=useRef<IChartApi|null>(null);const vars=useMemo(()=>build(candles),[candles]),v=vars[sel];
 async function load(){setBusy(true);setErr("");try{const r=await fetch(`${BACKEND}/v5/candles?symbol=${encodeURIComponent(symbol)}&interval=1m&limit=50000&refreshLatest=false`,{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);setCandles((j.candles||[]).map((z:any)=>({time:Number(z.time),open:Number(z.open),high:Number(z.high),low:Number(z.low),close:Number(z.close)})));const locked=TREND_LOCKS[symbol];setSel(locked?Math.max(0,Number(locked.slice(1))-1):0)}catch(e:any){setErr(e.message||String(e))}finally{setBusy(false)}}
 useEffect(()=>{void load()},[symbol]);
 useEffect(()=>{if(!host.current||!candles.length||!v)return;chart.current?.remove();const ch=createChart(host.current,{height:620,layout:{background:{color:"#07111d"},textColor:"#a9bdd0"},grid:{vertLines:{color:"#132235"},horzLines:{color:"#132235"}},timeScale:{timeVisible:true,secondsVisible:false}});chart.current=ch;const cs=ch.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",borderVisible:false,wickUpColor:"#22c55e",wickDownColor:"#ef4444"});cs.setData(candles.map(c=>({...c,time:c.time as Time})));const ls=ch.addSeries(LineSeries,{lineWidth:4,priceLineVisible:false,lastValueVisible:false});ls.setData(candles.map((c,i)=>({time:c.time as Time,value:c.close,color:v.trend[i]>0?"#22c55e":"#ef4444"})) as any);ch.timeScale().fitContent();const ro=new ResizeObserver(()=>ch.applyOptions({width:host.current?.clientWidth||800}));ro.observe(host.current);return()=>{ro.disconnect();ch.remove();chart.current=null}},[candles,v]);
 return <div style={{padding:14,color:"#dbeafe",background:"#050b12",minHeight:"100vh",fontFamily:"Inter,system-ui"}}>
  <div style={{display:"flex",gap:10,alignItems:"end",flexWrap:"wrap",marginBottom:12}}><div><div style={{fontSize:11,color:"#7dd3fc",fontWeight:800}}>TREND BUILDER V5 · LRC + MARKET STRUCTURE</div><h2 style={{margin:"3px 0 0"}}>Große Trendphasen · 1m Chart · interne 30m–4h Entscheidung</h2></div><label style={{marginLeft:"auto"}}><div style={{fontSize:11,color:"#94a3b8"}}>Instrument</div><select value={symbol} onChange={e=>setSymbol(e.target.value)} style={{background:"#0b1624",color:"#fff",border:"1px solid #334155",padding:"8px",borderRadius:6}}>{SYMBOLS.map(s=><option key={s}>{s}</option>)}</select></label><button onClick={load} disabled={busy} style={{padding:"8px 12px",background:"#12304b",color:"#fff",border:"1px solid #2563eb",borderRadius:6,fontWeight:800}}>{busy?"LÄDT …":"NEU LADEN"}</button></div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(12,minmax(58px,1fr))",gap:5,marginBottom:8}}>{vars.map((x,i)=><button key={x.id} onClick={()=>setSel(i)} style={{padding:"7px 3px",background:i===sel?"#164e63":"#0b1624",color:i===sel?"#67e8f9":"#cbd5e1",border:`1px solid ${i===sel?"#0891b2":"#263548"}`,borderRadius:5,fontWeight:800}}>{x.id}</button>)}</div>
  {v&&<div style={{display:"flex",gap:18,alignItems:"center",padding:"8px 10px",background:"#0b1624",border:"1px solid #263548",borderRadius:7,marginBottom:8}}><b style={{color:"#67e8f9"}}>{v.id} · {v.family} · {v.speed}</b><span>{v.params}</span><span><b>{v.changes}</b> Trendwechsel im geladenen Zeitraum</span><span style={{marginLeft:"auto",color:TREND_LOCKS[symbol]===v.id?"#86efac":"#94a3b8",fontWeight:800}}>{TREND_LOCKS[symbol]?`LIVE-LRC LOCK ${TREND_LOCKS[symbol]}${TREND_LOCKS[symbol]===v.id?" ✓":""}`:"NO LOCK"}</span></div>}
  {err&&<div style={{color:"#fca5a5",padding:10}}>{err}</div>}<div ref={host} style={{width:"100%",border:"1px solid #263548",borderRadius:8,overflow:"hidden"}} />
  <div style={{marginTop:10,color:"#94a3b8",fontSize:12}}>V5: T47–T58 = MARKET STRUCTURE. Der Trend dreht nur bei einem kausalen Bruch der vorherigen Preisstruktur; Varianten unterscheiden Lookback, Break-Puffer und Bestätigung. Die bestehenden LIVE-LRC-Locks bleiben unverändert. Erst visuell vergleichen – keinerlei Einfluss auf Live, Controller oder gespeicherte Profile.</div>
 </div>
}