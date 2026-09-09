import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
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

type EntryConfig = {
  enabled:boolean;
  tf:string;
  showMarkers:boolean;
  fastSma:number;
  slowSma:number;
  atrLen:number;
  rsiLen:number;
  macdFast:number;
  macdSlow:number;
  macdSignal:number;
  expansionMomentum:number;
  expansionEnergy:number;
  expansionVolatility:number;
  expansionCompressionMax:number;
  compressionMin:number;
  phaseSwitchMargin:number;
};

type InstrumentProfile = {
  symbol:string;
  interval:string;
  chartMode:ChartMode;
  activeModule:ModuleKey;
  showPaneA:boolean;
  showPaneB:boolean;
  updatedAt:string;
  modules:{
    entry:EntryConfig;
    exit:Record<string, unknown>;
    channel:Record<string, unknown>;
    poc:Record<string, unknown>;
  };
};

type EntryRow = {
  time:number;
  dir:number;
  regime:number;
  phase:number;
  trend:number;
  momentum:number;
  energy:number;
  volatility:number;
  compression:number;
  exhaustion:number;
  pullback:number;
  atr:number|null;
  rsi:number|null;
  macd:number|null;
  signal:number|null;
  hist:number|null;
  entry:"LONG"|"SHORT"|"NONE";
};

const profileKey = (symbol:string) => `qtrend:cockpit-v2:profile:${symbol}`;

const DEFAULT_ENTRY:EntryConfig={
  enabled:true,
  tf:"5m",
  showMarkers:true,
  fastSma:20,
  slowSma:50,
  atrLen:14,
  rsiLen:14,
  macdFast:2,
  macdSlow:26,
  macdSignal:9,
  expansionMomentum:65,
  expansionEnergy:45,
  expansionVolatility:55,
  expansionCompressionMax:60,
  compressionMin:62,
  phaseSwitchMargin:8,
};

function defaultProfile(symbol:string, interval:string):InstrumentProfile {
  return {
    symbol,
    interval,
    chartMode:"candles",
    activeModule:"view",
    showPaneA:false,
    showPaneB:false,
    updatedAt:new Date().toISOString(),
    modules:{entry:{...DEFAULT_ENTRY},exit:{},channel:{},poc:{}},
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
      modules:{
        entry:{...DEFAULT_ENTRY,...(parsed?.modules?.entry||{})},
        exit:{...(parsed?.modules?.exit||{})},
        channel:{...(parsed?.modules?.channel||{})},
        poc:{...(parsed?.modules?.poc||{})},
      },
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

async function fetchCandles(symbol:string, interval:string, limit=5000):Promise<Candle[]> {
  const url=`${BACKEND_BASE}/v5/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}&_ts=${Date.now()}`;
  const r=await fetch(url,{cache:"no-store"});
  const text=await r.text();
  let json:any;
  try{json=JSON.parse(text);}catch{throw new Error(`Keine JSON-Antwort: ${text.slice(0,120)}`);}
  if(!r.ok||json?.ok===false) throw new Error(json?.error||`HTTP ${r.status}`);
  return (Array.isArray(json?.candles)?json.candles:[])
    .map((c:any)=>({time:Number(c.time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close),volume:Number(c.volume||0)}))
    .filter((c:Candle)=>Number.isFinite(c.time)&&Number.isFinite(c.open)&&Number.isFinite(c.high)&&Number.isFinite(c.low)&&Number.isFinite(c.close))
    .sort((a:Candle,b:Candle)=>a.time-b.time);
}

function tfSeconds(tf:string){
  const raw=tf.trim().toLowerCase();
  if(raw.endsWith("h")) return Math.max(1,Number(raw.slice(0,-1)||1))*3600;
  return Math.max(1,Number(raw.replace("m",""))||1)*60;
}

function resample(candles:Candle[],tf:string):Candle[]{
  if(!candles.length) return [];
  const sec=tfSeconds(tf);
  const buckets=new Map<number,Candle>();
  for(const c of candles){
    const t=Math.floor(c.time/sec)*sec;
    const row=buckets.get(t);
    if(!row) buckets.set(t,{time:t,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume||0});
    else { row.high=Math.max(row.high,c.high); row.low=Math.min(row.low,c.low); row.close=c.close; row.volume=(row.volume||0)+(c.volume||0); }
  }
  return [...buckets.values()].sort((a,b)=>a.time-b.time);
}

function sma(values:number[],len:number):(number|null)[]{
  const out:(number|null)[]=Array(values.length).fill(null); let sum=0;
  for(let i=0;i<values.length;i++){sum+=values[i]; if(i>=len)sum-=values[i-len]; if(i>=len-1)out[i]=sum/len;}
  return out;
}
function ema(values:(number|null)[],len:number):(number|null)[]{
  const out:(number|null)[]=Array(values.length).fill(null); const a=2/(len+1); let prev:number|null=null;
  for(let i=0;i<values.length;i++){const v=values[i]; if(v==null)continue; prev=prev==null?v:a*v+(1-a)*prev; out[i]=prev;}
  return out;
}
function rma(values:(number|null)[],len:number):(number|null)[]{
  const out:(number|null)[]=Array(values.length).fill(null); let prev:number|null=null; let seed:number[]=[];
  for(let i=0;i<values.length;i++){
    const v=values[i]; if(v==null)continue;
    if(prev==null){seed.push(v); if(seed.length===len){prev=seed.reduce((a,b)=>a+b,0)/len; out[i]=prev;}}
    else {prev=(prev*(len-1)+v)/len; out[i]=prev;}
  }
  return out;
}
function stdev(values:number[],len:number):(number|null)[]{
  const out:(number|null)[]=Array(values.length).fill(null);
  for(let i=len-1;i<values.length;i++){const s=values.slice(i-len+1,i+1);const m=s.reduce((a,b)=>a+b,0)/len;out[i]=Math.sqrt(s.reduce((a,b)=>a+(b-m)*(b-m),0)/len);}
  return out;
}
function clamp(x:number){return Math.max(0,Math.min(100,x));}
function scoreAbs(x:number,scale:number){return scale!==0?clamp(Math.abs(x)/scale*100):0;}

function calculateEntry(candles:Candle[],cfg:EntryConfig):EntryRow[]{
  const n=candles.length, close=candles.map(c=>c.close), open=candles.map(c=>c.open), high=candles.map(c=>c.high), low=candles.map(c=>c.low);
  const smaFast=sma(close,cfg.fastSma), smaSlow=sma(close,cfg.slowSma);
  const tr:(number|null)[]=close.map((_,i)=>i===0?high[i]-low[i]:Math.max(high[i]-low[i],Math.abs(high[i]-close[i-1]),Math.abs(low[i]-close[i-1])));
  const atr=rma(tr,cfg.atrLen); const atrNum=atr.map(v=>v??0); const atrAvg=sma(atrNum,50);
  const gains:(number|null)[]=Array(n).fill(null), losses:(number|null)[]=Array(n).fill(null);
  for(let i=1;i<n;i++){const d=close[i]-close[i-1];gains[i]=Math.max(d,0);losses[i]=Math.max(-d,0);}
  const avgGain=rma(gains,cfg.rsiLen), avgLoss=rma(losses,cfg.rsiLen);
  const rsi:(number|null)[]=close.map((_,i)=>avgGain[i]==null||avgLoss[i]==null?null:avgLoss[i]===0?100:100-(100/(1+(avgGain[i] as number)/(avgLoss[i] as number))));
  const eFast=ema(close.map(v=>v),cfg.macdFast), eSlow=ema(close.map(v=>v),cfg.macdSlow);
  const macd:(number|null)[]=close.map((_,i)=>eFast[i]==null||eSlow[i]==null?null:(eFast[i] as number)-(eSlow[i] as number));
  const sig=ema(macd,cfg.macdSignal); const hist=macd.map((v,i)=>v==null||sig[i]==null?null:v-(sig[i] as number));
  const sd=stdev(close,20); const sdNum=sd.map(v=>v??0); const sdAvg=sma(sdNum,50);

  const rows:EntryRow[]=[]; let trendAge=0; let phase=4; let prevDir=0; let prevMomentum=0; let prevEnergy=0; let prevVol=0; let prevFlow=0;
  for(let i=0;i<n;i++){
    const sf=smaFast[i], ss=smaSlow[i], a=atr[i], aa=atrAvg[i], rv=rsi[i], m=macd[i], sg=sig[i], h=hist[i], sdv=sd[i], sda=sdAvg[i];
    if(i<Math.max(cfg.slowSma+12,60)||sf==null||ss==null||a==null||aa==null||rv==null||m==null||sg==null||h==null||sdv==null||sda==null){
      rows.push({time:candles[i].time,dir:0,regime:0,phase:4,trend:0,momentum:0,energy:0,volatility:0,compression:0,exhaustion:0,pullback:0,atr:a??null,rsi:rv??null,macd:m??null,signal:sg??null,hist:h??null,entry:"NONE"}); continue;
    }
    const rsiSpeed=i>=3&&rsi[i-3]!=null?rv-(rsi[i-3] as number):0;
    const rsiAccel=i>=6&&rsi[i-3]!=null&&rsi[i-6]!=null?rsiSpeed-((rsi[i-3] as number)-(rsi[i-6] as number)):0;
    const histSpeed=i>=3&&hist[i-3]!=null?h-(hist[i-3] as number):0;
    const body=Math.abs(close[i]-open[i]), range=high[i]-low[i], bodyPct=range>0?body/range:0, wickPct=range>0?1-bodyPct:0;
    const slopeSlow=i>=5&&smaSlow[i-5]!=null?ss-(smaSlow[i-5] as number):0;
    const prevSlopeSlow=i>=10&&smaSlow[i-5]!=null&&smaSlow[i-10]!=null?(smaSlow[i-5] as number)-(smaSlow[i-10] as number):0;
    const curveSlow=slopeSlow-prevSlopeSlow;
    const trendSlope=scoreAbs(slopeSlow,a*0.6), trendCurve=scoreAbs(curveSlow,a*0.4), priceDist=scoreAbs(close[i]-ss,a*2), maAlign=sf!==ss?100:0;
    const trend=clamp(trendSlope*.35+trendCurve*.20+priceDist*.25+maAlign*.20);
    const rsiPower=scoreAbs(rv-50,25), rsiSpeedScore=scoreAbs(rsiSpeed,10), rsiAccelScore=scoreAbs(rsiAccel,8), macdPower=scoreAbs(h,a*.08), macdSpeedScore=scoreAbs(histSpeed,a*.05);
    const momentum=clamp(rsiPower*.20+rsiSpeedScore*.20+rsiAccelScore*.15+macdPower*.25+macdSpeedScore*.20);
    const atrEnergy=aa>0?clamp(a/aa*65):0, rangeEnergy=a>0?clamp(range/a*55):0, bodyEnergy=clamp(bodyPct*100), impulse=i>=5?Math.abs(close[i]-close[i-5]):0, impulseEnergy=a>0?clamp(impulse/a*30):0;
    const energy=clamp((atrEnergy+rangeEnergy+bodyEnergy+impulseEnergy)/4);
    const atrVol=aa>0?clamp(a/aa*100):0, stdevVol=sda>0?clamp(sdv/sda*100):0, rangeVol=a>0?clamp(range/a*70):0;
    const volatility=clamp(atrVol*.45+stdevVol*.35+rangeVol*.20);
    const smallBody=clamp((1-bodyPct)*100), highWicks=clamp(wickPct*100), lowAtr=aa>0?clamp((1.35-a/aa)*100):0, flatSma=clamp(100-trendSlope), tightRange=a>0?clamp((1.2-range/a)*100):0;
    const compression=clamp(smallBody*.20+highWicks*.20+lowAtr*.25+flatSma*.20+tightRange*.15);
    const bull=(close[i]>sf?20:0)+(close[i]>ss?20:0)+(sf>ss?20:0)+(i>=5&&smaSlow[i-5]!=null&&ss>(smaSlow[i-5] as number)?20:0)+(i>=5&&close[i]>close[i-5]?20:0);
    const bear=(close[i]<sf?20:0)+(close[i]<ss?20:0)+(sf<ss?20:0)+(i>=5&&smaSlow[i-5]!=null&&ss<(smaSlow[i-5] as number)?20:0)+(i>=5&&close[i]<close[i-5]?20:0);
    const structure=Math.max(bull,bear); const dir=bull>bear?1:bear>bull?-1:0;
    trendAge=dir!==0&&dir===prevDir?trendAge+1:dir!==0?1:0;
    const trendAgeScore=clamp(trendAge/80*100), balance=clamp(compression*.45+(100-trend)*.20+(100-energy)*.20+(100-volatility)*.15);
    const momentumFalling=momentum<prevMomentum, energyFalling=energy<prevEnergy, volFalling=volatility<prevVol, momentumRising=momentum>prevMomentum, energyRising=energy>prevEnergy;
    const pullback=clamp(compression*.30+(100-energy)*.25+trendAgeScore*.15+(momentumFalling?20:0)+(energyFalling?10:0));
    const exhaustion=clamp(trendAgeScore*.30+pullback*.30+(momentumFalling?20:0)+(energyFalling?15:0)+(volFalling?10:0));
    const trendReg=clamp(trend*.35+structure*.35+trendAgeScore*.15+(100-balance)*.15), rangeReg=clamp(compression*.40+balance*.35+(100-trend)*.15+(100-energy)*.10), regime=trendReg>=rangeReg?1:0;
    const isCompression=compression>=cfg.compressionMin&&energy<=45&&balance>=50;
    const isExpansion=momentum>=cfg.expansionMomentum&&energy>=cfg.expansionEnergy&&volatility>=cfg.expansionVolatility&&compression<=cfg.expansionCompressionMax;
    const isPullback=regime===1&&trend>=55&&structure>=60&&trendAgeScore>=20&&(energy<=45||momentumFalling||energyFalling);
    const isExhaustion=regime===1&&exhaustion>=65&&trendAgeScore>=25&&pullback>=55;
    const compressionPower=clamp((compression+balance+(100-energy))/3), expansionPower=clamp((momentum+energy+volatility+trend)/4), pullbackPower=clamp((pullback+trend+structure+trendAgeScore)/4), exhaustionPower=exhaustion;
    const prevPhase=phase; const currentPower=phase===1?expansionPower:phase===2?pullbackPower:phase===3?exhaustionPower:compressionPower; let candidate=phase; let candidatePower=currentPower;
    if(regime===0){if(isExpansion&&compression<55){candidate=1;candidatePower=expansionPower;}else{candidate=4;candidatePower=compressionPower;}}
    else if(phase===4){if(isExpansion){candidate=1;candidatePower=expansionPower;}}
    else if(phase===1){if(isExhaustion){candidate=3;candidatePower=exhaustionPower;}else if(isPullback){candidate=2;candidatePower=pullbackPower;}}
    else if(phase===2){if(isExhaustion){candidate=3;candidatePower=exhaustionPower;}else if(isExpansion&&energyRising){candidate=1;candidatePower=expansionPower;}}
    else if(phase===3){if(isCompression){candidate=4;candidatePower=compressionPower;}else if(isExpansion&&energyRising&&momentumRising){candidate=1;candidatePower=expansionPower;}}
    const directionChanged=dir!==0&&dir!==prevDir; if(candidate!==phase&&(directionChanged||candidatePower>=currentPower+cfg.phaseSwitchMargin))phase=candidate;
    const dna=regime===1&&phase===1?dir:0; let flow=dna;
    if(prevPhase===4&&phase===1)flow=0; else if(prevPhase===1&&phase===2)flow=0; else if(prevPhase===2&&phase===1)flow=dir; else if(prevPhase===1&&phase===3)flow=0; else if(prevPhase===3&&phase===4)flow=0;
    const longEdge=flow===1&&prevFlow!==1, shortEdge=flow===-1&&prevFlow!==-1;
    const entry:EntryRow["entry"]=longEdge&&close[i]>open[i]?"LONG":shortEdge&&close[i]<open[i]?"SHORT":"NONE";
    rows.push({time:candles[i].time,dir,regime,phase,trend,momentum,energy,volatility,compression,exhaustion,pullback,atr:a,rsi:rv,macd:m,signal:sg,hist:h,entry});
    prevDir=dir; prevMomentum=momentum; prevEnergy=energy; prevVol=volatility; prevFlow=flow;
  }
  return rows;
}

function phaseText(v:number){return v===1?"EXPANSION":v===2?"PULLBACK":v===3?"EXHAUSTION":"COMPRESSION";}
function dirText(v:number){return v===1?"UP":v===-1?"DOWN":"RANGE";}
function fmt(v:number|null|undefined,d=2){return v==null||!Number.isFinite(v)?"—":v.toFixed(d);}

const panel:CSSProperties={border:"1px solid #24324a",background:"#0b1220",borderRadius:10};
const inputStyle:CSSProperties={background:"#0a1020",border:"1px solid #334155",color:"#e5eefc",borderRadius:7,padding:"8px 10px",fontWeight:700};
const buttonStyle:CSSProperties={...inputStyle,cursor:"pointer"};

export default function CockpitV2(){
  const {symbol,interval,setSymbol,setInterval}=useSharedMarket();
  const [profile,setProfile]=useState<InstrumentProfile>(()=>readProfile(symbol,interval));
  const [candles,setCandles]=useState<Candle[]>([]);
  const [entryBase,setEntryBase]=useState<Candle[]>([]);
  const [selected,setSelected]=useState<Candle|null>(null);
  const [status,setStatus]=useState("Verbinden …");
  const [busy,setBusy]=useState(false);
  const priceHost=useRef<HTMLDivElement>(null);
  const chart=useRef<IChartApi|null>(null);
  const series=useRef<ISeriesApi<"Candlestick">|null>(null);
  const markerApi=useRef<any>(null);
  const candleMap=useMemo(()=>new Map(candles.map(c=>[Number(c.time),c])),[candles]);
  const shown=useMemo(()=>profile.chartMode==="heikin"?heikin(candles):candles,[candles,profile.chartMode]);
  const entryCfg=profile.modules.entry;
  const entryCandles=useMemo(()=>resample(entryBase,entryCfg.tf),[entryBase,entryCfg.tf]);
  const entryRows=useMemo(()=>entryCfg.enabled?calculateEntry(entryCandles,entryCfg):[],[entryCandles,entryCfg]);
  const entryByChartTime=useMemo(()=>{
    const map=new Map<number,EntryRow>(); const sec=tfSeconds(interval);
    for(const r of entryRows){map.set(Math.floor(r.time/sec)*sec,r);} return map;
  },[entryRows,interval]);
  const selectedEntry=selected?entryByChartTime.get(selected.time)||null:null;

  useEffect(()=>{
    const next=readProfile(symbol,interval);
    setProfile(next);
    if(next.interval!==interval) setInterval(next.interval);
  },[symbol]);

  useEffect(()=>{setProfile(p=>p.interval===interval?p:{...p,interval});},[interval]);

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
    chart.current=c; series.current=s; markerApi.current=createSeriesMarkers(s,[]);
    c.subscribeCrosshairMove(param=>{if(!param.time)return;const row=candleMap.get(Number(param.time));if(row)setSelected(row);});
    return()=>{c.remove();chart.current=null;series.current=null;markerApi.current=null;};
  },[candleMap]);

  useEffect(()=>{
    series.current?.setData(shown.map(c=>({time:c.time as Time,open:c.open,high:c.high,low:c.low,close:c.close})));
    if(shown.length&&!selected) setSelected(candles[candles.length-1]||null);
  },[shown]);

  useEffect(()=>{
    if(!markerApi.current)return;
    if(!entryCfg.enabled||!entryCfg.showMarkers){markerApi.current.setMarkers([]);return;}
    const sec=tfSeconds(interval); const seen=new Set<number>(); const markers:any[]=[];
    for(const r of entryRows){
      if(r.entry==="NONE")continue;
      const time=Math.floor(r.time/sec)*sec; if(seen.has(time))continue; seen.add(time);
      markers.push({
  time: time as Time,
  position: r.entry === "LONG" ? "belowBar" : "aboveBar",
  color: r.entry === "LONG" ? "#22c55e" : "#ef4444",
  shape: r.entry === "LONG" ? "arrowUp" : "arrowDown",
  text: "",
  size: 2,
});
    }
    markerApi.current.setMarkers(markers.sort((a:any,b:any)=>Number(a.time)-Number(b.time)));
  },[entryRows,entryCfg.enabled,entryCfg.showMarkers,interval]);

  async function load(){
    try{
      setBusy(true); setStatus(`${symbol} ${interval} wird geladen …`);
      const [rows,base]=await Promise.all([fetchCandles(symbol,interval,5000),fetchCandles(symbol,"1m",12000)]);
      setCandles(rows); setEntryBase(base); setSelected(rows[rows.length-1]||null);
      setStatus(`${symbol} ${interval} · ${rows.length} Kerzen · ENTRY-Basis ${base.length}×1m`);
      queueMicrotask(()=>chart.current?.timeScale().fitContent());
    }catch(e){setStatus(`Fehler: ${e instanceof Error?e.message:String(e)}`);}finally{setBusy(false);}
  }

  useEffect(()=>{void load();const t=window.setInterval(()=>void load(),30000);return()=>window.clearInterval(t);},[symbol,interval]);

  function patchProfile(patch:Partial<InstrumentProfile>){setProfile(prev=>({...prev,...patch}));}
  function patchEntry(patch:Partial<EntryConfig>){setProfile(prev=>({...prev,modules:{...prev.modules,entry:{...prev.modules.entry,...patch}}}));}
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

    <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 380px",gap:10,minHeight:0}}>
      <div style={{display:"grid",gridTemplateRows:`minmax(430px,1fr) ${profile.showPaneA?"180px":"0px"} ${profile.showPaneB?"180px":"0px"}`,gap:8,minHeight:0}}>
        <div style={{...panel,overflow:"hidden",position:"relative"}}>
          <div ref={priceHost} style={{position:"absolute",inset:0}} />
          <div style={{position:"absolute",top:10,left:12,zIndex:3,padding:"5px 8px",borderRadius:6,background:"#08111ecc",border:"1px solid #23324a",fontSize:12,fontWeight:800}}>{symbol} · {interval} · {profile.chartMode==="heikin"?"Heikin":"Candles"} · ENTRY {entryCfg.tf}</div>
        </div>
        {profile.showPaneA&&<div style={{...panel,padding:12,display:"flex",alignItems:"center",justifyContent:"center",color:"#64748b",fontWeight:800}}>INDIKATOR-PANE A · vorbereitet</div>}
        {profile.showPaneB&&<div style={{...panel,padding:12,display:"flex",alignItems:"center",justifyContent:"center",color:"#64748b",fontWeight:800}}>INDIKATOR-PANE B · vorbereitet</div>}
      </div>

      <aside style={{display:"grid",gridTemplateRows:"minmax(330px,auto) minmax(0,1fr)",gap:10,minHeight:0}}>
        <section style={{...panel,padding:12,overflow:"auto"}}>
          <div style={{fontWeight:900,fontSize:14,marginBottom:10}}>MODUL-EINSTELLUNGEN</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,marginBottom:12}}>{moduleTabs.map(k=><button key={k} onClick={()=>patchProfile({activeModule:k})} style={{...buttonStyle,padding:"7px 4px",fontSize:11,borderColor:active===k?"#7c3aed":"#334155",background:active===k?"#4c1d95":"#0a1020"}}>{k.toUpperCase()}</button>)}</div>
          {active==="view"&&<div style={{display:"grid",gap:10}}>
            <label style={{display:"grid",gap:5,fontSize:12,color:"#94a3b8"}}>Chart-TF<select value={interval} onChange={e=>setInterval(e.target.value)} style={inputStyle}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select></label>
            <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>Pane A vorbereiten<input type="checkbox" checked={profile.showPaneA} onChange={e=>patchProfile({showPaneA:e.target.checked})}/></label>
            <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>Pane B vorbereiten<input type="checkbox" checked={profile.showPaneB} onChange={e=>patchProfile({showPaneB:e.target.checked})}/></label>
            <div style={{padding:10,border:"1px dashed #334155",borderRadius:8,color:"#64748b",fontSize:12}}>ENTRY ist jetzt das erste echte Modul. EXIT, CHANNEL und POC bleiben noch leer.</div>
          </div>}
          {active==="entry"&&<EntrySettings cfg={entryCfg} patch={patchEntry}/>} 
          {(active==="exit"||active==="channel"||active==="poc")&&<div style={{padding:12,border:"1px dashed #334155",borderRadius:8,color:"#94a3b8"}}><b>{active.toUpperCase()}</b><div style={{marginTop:6,color:"#64748b"}}>Steckplatz vorbereitet. Noch keine Logik, keine Parameter, keine Marker.</div></div>}
        </section>

        <section style={{...panel,padding:12,overflow:"auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><b style={{fontSize:14}}>INSPECTOR</b><span style={{fontSize:11,color:"#64748b"}}>Crosshair über Chart</span></div>
          {selected?<div style={{display:"grid",gap:7}}>
            <InfoRow k="Zeit" v={chartBerlinTime(selected.time)}/>
            <InfoRow k="Open" v={selected.open}/><InfoRow k="High" v={selected.high}/><InfoRow k="Low" v={selected.low}/><InfoRow k="Close" v={selected.close}/>
            <div style={{height:1,background:"#24324a",margin:"5px 0"}}/>
            <InfoRow k="ENTRY" v={selectedEntry?.entry||"NONE"}/>
            <InfoRow k="ENTRY TF" v={entryCfg.tf}/>
            <InfoRow k="DIR / PHASE" v={selectedEntry?`${dirText(selectedEntry.dir)} / ${phaseText(selectedEntry.phase)}`:"—"}/>
            <InfoRow k="Trend" v={fmt(selectedEntry?.trend)}/><InfoRow k="Momentum" v={fmt(selectedEntry?.momentum)}/>
            <InfoRow k="ATR" v={fmt(selectedEntry?.atr,3)}/><InfoRow k="RSI" v={fmt(selectedEntry?.rsi,2)}/>
            <InfoRow k="MACD Hist" v={fmt(selectedEntry?.hist,4)}/>
            <div style={{height:1,background:"#24324a",margin:"5px 0"}}/>
            <InfoRow k="EXIT" v="—" muted/><InfoRow k="CHANNEL" v="—" muted/><InfoRow k="DELTA" v="—" muted/><InfoRow k="POC" v="—" muted/><InfoRow k="CONTROLLER" v="—" muted/>
          </div>:<div style={{color:"#64748b"}}>Noch keine Kerze ausgewählt.</div>}
        </section>
      </aside>
    </div>
  </div>;
}

function EntrySettings({cfg,patch}:{cfg:EntryConfig;patch:(p:Partial<EntryConfig>)=>void}){
  const num=(key:keyof EntryConfig,label:string,step=1)=><label style={{display:"grid",gap:4,fontSize:12,color:"#94a3b8"}}>{label}<input type="number" step={step} value={Number(cfg[key])} onChange={e=>patch({[key]:Number(e.target.value)} as Partial<EntryConfig>)} style={inputStyle}/></label>;
  return <div style={{display:"grid",gap:10}}>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
      <label style={{display:"grid",gap:4,fontSize:12,color:"#94a3b8"}}>ENTRY TF<select value={cfg.tf} onChange={e=>patch({tf:e.target.value})} style={inputStyle}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select></label>
      <label style={{display:"flex",alignItems:"end",justifyContent:"space-between",gap:10,paddingBottom:8}}>Modul aktiv<input type="checkbox" checked={cfg.enabled} onChange={e=>patch({enabled:e.target.checked})}/></label>
      <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,gridColumn:"1 / -1"}}>ENTRY Marker anzeigen<input type="checkbox" checked={cfg.showMarkers} onChange={e=>patch({showMarkers:e.target.checked})}/></label>
    </div>
    <div style={{fontWeight:800,color:"#cbd5e1",fontSize:12}}>QTrend Basis</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>{num("fastSma","Fast SMA")}{num("slowSma","Slow SMA")}{num("atrLen","ATR Länge")}{num("rsiLen","RSI Länge")}{num("macdFast","MACD Fast")}{num("macdSlow","MACD Slow")}{num("macdSignal","MACD Signal")}</div>
    <div style={{fontWeight:800,color:"#cbd5e1",fontSize:12}}>Flow / Expansion</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>{num("expansionMomentum","Momentum min")}{num("expansionEnergy","Energy min")}{num("expansionVolatility","Volatility min")}{num("expansionCompressionMax","Compression max")}{num("compressionMin","Compression min")}{num("phaseSwitchMargin","Phase Margin",0.5)}</div>
    <div style={{padding:9,border:"1px dashed #334155",borderRadius:8,color:"#64748b",fontSize:11}}>Nur ENTRY. Änderungen wirken sofort auf die Marker. Gespeichert werden sie erst mit PROFIL SPEICHERN und gelten dann nur für dieses Instrument.</div>
  </div>;
}

function InfoRow({k,v,muted=false}:{k:string;v:any;muted?:boolean}){
  return <div style={{display:"grid",gridTemplateColumns:"112px 1fr",gap:8,paddingBottom:6,borderBottom:"1px solid #182236"}}><span style={{color:muted?"#64748b":"#67e8f9",fontWeight:800}}>{k}</span><span style={{textAlign:"right",color:muted?"#64748b":"#f8fafc",fontWeight:800}}>{typeof v==="number"?Number(v).toFixed(3):String(v)}</span></div>;
}
