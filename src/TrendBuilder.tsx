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
function turnTrend(c:C[],atrLen:number,mult:number,minBars:number){const out:number[]=[];if(!c.length)return out;let dir=1,extreme=c[0].high,extremeAt=0,prevClose=c[0].close,atr=0,seed:number[]=[];for(let i=0;i<c.length;i++){const x=c[i],tr=i===0?x.high-x.low:Math.max(x.high-x.low,Math.abs(x.high-prevClose),Math.abs(x.low-prevClose));if(i<atrLen){seed.push(tr);atr=seed.reduce((a,b)=>a+b,0)/seed.length}else atr=(atr*(atrLen-1)+tr)/atrLen;prevClose=x.close;if(dir===1){if(x.high>=extreme){extreme=x.high;extremeAt=i}const reversal=extreme-x.close;if(i-extremeAt>=minBars&&reversal>=atr*mult){dir=-1;extreme=x.low;extremeAt=i}}else{if(x.low<=extreme){extreme=x.low;extremeAt=i}const reversal=x.close-extreme;if(i-extremeAt>=minBars&&reversal>=atr*mult){dir=1;extreme=x.high;extremeAt=i}}out.push(dir)}return out}
function hhhlStructure(c:C[],left:number,right:number){const out:number[]=new Array(c.length).fill(1),pivots:{idx:number;type:"H"|"L";price:number}[]=[];let dir=1,lastHigh:number|null=null,lastLow:number|null=null;for(let now=0;now<c.length;now++){const p=now-right;if(p>=left){let isH=true,isL=true;for(let j=p-left;j<=p+right;j++){if(j===p)continue;if(c[j].high>=c[p].high)isH=false;if(c[j].low<=c[p].low)isL=false}if(isH){pivots.push({idx:p,type:"H",price:c[p].high});const prev=lastHigh;lastHigh=c[p].high;if(prev!=null&&lastLow!=null&&lastHigh>prev&&dir<0)dir=1}if(isL){pivots.push({idx:p,type:"L",price:c[p].low});const prev=lastLow;lastLow=c[p].low;if(prev!=null&&lastHigh!=null&&lastLow<prev&&dir>0)dir=-1}}out[now]=dir}return out}
function pathEfficiencyTrend(c:C[],horizon:number,erMin:number,deadband:number){const out:number[]=new Array(c.length).fill(1);let dir=1;for(let i=1;i<c.length;i++){if(i<horizon){out[i]=dir;continue}const start=i-horizon,net=c[i].close-c[start].close;let path=0;for(let j=start+1;j<=i;j++)path+=Math.abs(c[j].close-c[j-1].close);const er=path>0?Math.abs(net)/path:0;const scale=Math.max(1e-9,Math.abs(c[start].close)),move=Math.abs(net)/scale;if(er>=erMin&&move>=deadband){const cand=net>0?1:net<0?-1:dir;if(cand!==dir)dir=cand}out[i]=dir}return out}
function multiHorizonPathTrend(c:C[],shortH:number,longH:number,erMin:number){const out:number[]=new Array(c.length).fill(1);let dir=1;for(let i=1;i<c.length;i++){if(i<longH){out[i]=dir;continue}const calc=(h:number)=>{const st=i-h,net=c[i].close-c[st].close;let path=0;for(let j=st+1;j<=i;j++)path+=Math.abs(c[j].close-c[j-1].close);return{sign:net>0?1:net<0?-1:0,er:path?Math.abs(net)/path:0}};const a=calc(shortH),b=calc(longH);if(a.sign!==0&&a.sign===b.sign&&Math.max(a.er,b.er)>=erMin)dir=a.sign;out[i]=dir}return out}
function bestFitTrend(c:C[],windows:number[],minR2:number,minMove:number){const out:number[]=new Array(c.length).fill(1);let dir=1;for(let i=0;i<c.length;i++){let best:{score:number;dir:number}|null=null;for(const n of windows){if(i<n-1)continue;const first=i-n+1;let sx=0,sy=0,sxx=0,sxy=0;for(let j=0;j<n;j++){const y=c[first+j].close;sx+=j;sy+=y;sxx+=j*j;sxy+=j*y}const den=n*sxx-sx*sx;if(!den)continue;const m=(n*sxy-sx*sy)/den,b=(sy-m*sx)/n,mean=sy/n;let ssTot=0,ssRes=0;for(let j=0;j<n;j++){const y=c[first+j].close,fit=b+m*j;ssTot+=(y-mean)*(y-mean);ssRes+=(y-fit)*(y-fit)}const r2=ssTot>0?Math.max(0,1-ssRes/ssTot):0,move=Math.abs(m*(n-1))/Math.max(1e-9,Math.abs(c[first].close));if(r2<minR2||move<minMove)continue;const score=r2*Math.log1p(n);if(!best||score>best.score)best={score,dir:m>=0?1:-1}}if(best)dir=best.dir;out[i]=dir}return out}
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
 const turnDefs=[[14,1.0,1],[14,1.5,1],[14,2.0,1],[14,2.5,1],[30,1.5,1],[30,2.0,1],[30,2.5,1],[14,1.5,3],[14,2.0,3],[14,2.5,3],[30,2.0,3],[30,2.5,3]] as const;
 for(const [atr,mult,minBars] of turnDefs){const full=turnTrend(c,atr,mult,minBars);out.push({id:"T"+String(out.length+1).padStart(2,"0"),family:"TURN LIVE",speed:`ATR${atr}`,trend:full,changes:flips(full),params:`LIVE Turn · ATR ${atr} × ${mult.toFixed(1)} · min ${minBars} Bar · KEIN BACKPAINT`})}
 const hhhlDefs=[[3,3],[5,5],[8,8],[12,12],[20,20],[30,30],[5,3],[8,5],[12,5],[20,8]] as const;
 for(const [left,right] of hhhlDefs){const full=hhhlStructure(c,left,right);out.push({id:"T"+String(out.length+1).padStart(2,"0"),family:"HH/HL STRUCTURE",speed:`${left}/${right}`,trend:full,changes:flips(full),params:`HH-HL-LH-LL · Pivot L${left}/R${right} · Bestätigung erst nach R Bars · KEIN BACKPAINT`})}
 const pathDefs=[["PATH",240,.12,.001],["PATH",480,.10,.0015],["PATH",720,.08,.002],["PATH",1440,.06,.003],["PATH",2880,.05,.004]] as const;
 for(const [,h,er,db] of pathDefs){const full=pathEfficiencyTrend(c,h,er,db);out.push({id:"T"+String(out.length+1).padStart(2,"0"),family:"PATH EFFICIENCY",speed:`${h}m`,trend:full,changes:flips(full),params:`Preisweg ${h}m · Efficiency ≥ ${er} · Netto-Move ≥ ${(db*100).toFixed(2)}% · KAUSAL`})}
 const multiDefs=[[120,480,.10],[240,720,.08],[240,1440,.07],[480,1440,.06],[720,2880,.05],[1440,4320,.04]] as const;
 for(const [sh,lh,er] of multiDefs){const full=multiHorizonPathTrend(c,sh,lh,er);out.push({id:"T"+String(out.length+1).padStart(2,"0"),family:"MULTI PATH",speed:`${sh}/${lh}m`,trend:full,changes:flips(full),params:`Netto-Richtung ${sh}m + ${lh}m gleich · Efficiency ≥ ${er} · KAUSAL`})}
 const fitDefs=[
  [[120,240,480,720],.35,.001],
  [[240,480,720,1440],.40,.0015],
  [[480,720,1440,2880],.45,.002],
  [[720,1440,2880,4320],.50,.003],
  [[240,480,720,1440,2880],.55,.0015],
  [[480,720,1440,2880,4320],.60,.002]
 ] as const;
 for(const [wins,r2,mv] of fitDefs){const full=bestFitTrend(c,[...wins],r2,mv);out.push({id:"T"+String(out.length+1).padStart(2,"0"),family:"BEST FIT TREND",speed:`R²≥${r2}`,trend:full,changes:flips(full),params:`Bestes vergangenes Fenster ${wins.join("/")}m · R² ≥ ${r2} · Mindestweg ${(mv*100).toFixed(2)}% · KAUSAL`})}
 return out}
export default function TrendBuilder(){
 const [symbol,setSymbol]=useState("J225"),[candles,setCandles]=useState<C[]>([]),[sel,setSel]=useState(42),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 const host=useRef<HTMLDivElement>(null),chart=useRef<IChartApi|null>(null);const vars=useMemo(()=>build(candles),[candles]),v=vars[sel];
 async function load(){setBusy(true);setErr("");try{const r=await fetch(`${BACKEND}/v5/candles?symbol=${encodeURIComponent(symbol)}&interval=1m&limit=50000&refreshLatest=false`,{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);setCandles((j.candles||[]).map((z:any)=>({time:Number(z.time),open:Number(z.open),high:Number(z.high),low:Number(z.low),close:Number(z.close)})));const locked=TREND_LOCKS[symbol];setSel(locked?Math.max(0,Number(locked.slice(1))-1):0)}catch(e:any){setErr(e.message||String(e))}finally{setBusy(false)}}
 useEffect(()=>{void load()},[symbol]);
 useEffect(()=>{if(!host.current||!candles.length||!v)return;chart.current?.remove();const ch=createChart(host.current,{height:620,layout:{background:{color:"#07111d"},textColor:"#a9bdd0"},grid:{vertLines:{color:"#132235"},horzLines:{color:"#132235"}},timeScale:{timeVisible:true,secondsVisible:false}});chart.current=ch;const cs=ch.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",borderVisible:false,wickUpColor:"#22c55e",wickDownColor:"#ef4444"});cs.setData(candles.map(c=>({...c,time:c.time as Time})));const ls=ch.addSeries(LineSeries,{lineWidth:4,priceLineVisible:false,lastValueVisible:false});ls.setData(candles.map((c,i)=>({time:c.time as Time,value:c.close,color:v.trend[i]>0?"#22c55e":"#ef4444"})) as any);ch.timeScale().fitContent();const ro=new ResizeObserver(()=>ch.applyOptions({width:host.current?.clientWidth||800}));ro.observe(host.current);return()=>{ro.disconnect();ch.remove();chart.current=null}},[candles,v]);
 return <div style={{padding:14,color:"#dbeafe",background:"#050b12",minHeight:"100vh",fontFamily:"Inter,system-ui"}}>
  <div style={{display:"flex",gap:10,alignItems:"end",flexWrap:"wrap",marginBottom:12}}><div><div style={{fontSize:11,color:"#7dd3fc",fontWeight:800}}>TREND BUILDER V9 · BEST FIT TREND</div><h2 style={{margin:"3px 0 0"}}>Große Trendphasen · 1m Chart · interne 30m–4h Entscheidung</h2></div><label style={{marginLeft:"auto"}}><div style={{fontSize:11,color:"#94a3b8"}}>Instrument</div><select value={symbol} onChange={e=>setSymbol(e.target.value)} style={{background:"#0b1624",color:"#fff",border:"1px solid #334155",padding:"8px",borderRadius:6}}>{SYMBOLS.map(s=><option key={s}>{s}</option>)}</select></label><button onClick={load} disabled={busy} style={{padding:"8px 12px",background:"#12304b",color:"#fff",border:"1px solid #2563eb",borderRadius:6,fontWeight:800}}>{busy?"LÄDT …":"NEU LADEN"}</button></div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(12,minmax(58px,1fr))",gap:5,marginBottom:8}}>{vars.map((x,i)=><button key={x.id} onClick={()=>setSel(i)} style={{padding:"7px 3px",background:i===sel?"#164e63":"#0b1624",color:i===sel?"#67e8f9":"#cbd5e1",border:`1px solid ${i===sel?"#0891b2":"#263548"}`,borderRadius:5,fontWeight:800}}>{x.id}</button>)}</div>
  {v&&<div style={{display:"flex",gap:18,alignItems:"center",padding:"8px 10px",background:"#0b1624",border:"1px solid #263548",borderRadius:7,marginBottom:8}}><b style={{color:"#67e8f9"}}>{v.id} · {v.family} · {v.speed}</b><span>{v.params}</span><span><b>{v.changes}</b> Trendwechsel im geladenen Zeitraum</span><span style={{marginLeft:"auto",color:TREND_LOCKS[symbol]===v.id?"#86efac":"#94a3b8",fontWeight:800}}>{TREND_LOCKS[symbol]?`LIVE-LRC LOCK ${TREND_LOCKS[symbol]}${TREND_LOCKS[symbol]===v.id?" ✓":""}`:"NO LOCK"}</span></div>}
  {err&&<div style={{color:"#fca5a5",padding:10}}>{err}</div>}<div ref={host} style={{width:"100%",border:"1px solid #263548",borderRadius:8,overflow:"hidden"}} />
  <div style={{marginTop:10,color:"#94a3b8",fontSize:12}}>V9: T92–T97 = BEST FIT TREND. Pro 1m-Kerze werden mehrere ausschließlich vergangene Fenster verglichen. Gewählt wird die gerichtete Regression mit hoher Anpassungsgüte R² und ausreichendem Netto-Weg; Pullbacks dürfen den Zustand bestehen lassen, solange keine bessere gleichmäßige Gegenbewegung vorliegt. Kein Lookahead/Backpaint. Bestehende LIVE-LRC-Locks unverändert; Research only.</div>
 </div>
}