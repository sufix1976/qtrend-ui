import { useEffect,useMemo,useRef,useState,type CSSProperties } from "react";
import { CandlestickSeries,CrosshairMode,createChart,createSeriesMarkers,HistogramSeries,LineSeries,type IChartApi,type ISeriesApi,type Time } from "lightweight-charts";
import { useSharedMarket } from "./useSharedMarket";
import { chartBerlinTime } from "./berlinTime";
import { DEFAULT_ENTRY,DEFAULT_CHANNEL,DEFAULT_CONTROLLER,tfSeconds,type Candle,type EntryConfig,type ChannelConfig,type ControllerConfig,type EntryRow,type BacktestStats } from "./cockpitV2Core";

const BACKEND_BASE="https://qtrend-trading-engine.onrender.com";
const SYMBOLS=["GOLD","US100","US30","DE40","J225","UK100","US500","BTCUSD","ETHUSD","SILVER","OIL_CRUDE","CORN"];
const INTERVALS=["1m","2m","3m","5m","8m","10m","15m","18m","30m","1h"];
type ChartMode="candles"|"heikin";
type ModuleKey="exit"|"entry"|"channel"|"controller";
type ExitModuleConfig={enabled:boolean;showMarkers:boolean;trendExitEnabled:boolean;exit1Enabled:boolean;exit1Tf:string;length:number;mult:number;lengthKC:number;multKC:number;useTrueRange:boolean;exit2Enabled:boolean;exit2Tf:string;lrcLength:number;exit3Enabled:boolean;exit3Tf:string;fisherLength:number;fisherThreshold:number;exit4Enabled:boolean;exit4Tf:string;rsiLength:number;rsiUpper:number;rsiLower:number};
type InstrumentProfile={symbol:string;interval:string;chartMode:ChartMode;activeModule:ModuleKey;updatedAt:string;modules:{entry:EntryConfig;exit:ExitModuleConfig;channel:ChannelConfig;poc:Record<string,unknown>;controller:ControllerConfig}};
type TradingStatus={config:{symbol:string;interval:string;size:number;auto_enabled:number}|null;event?:{status?:string}|null};
type SqueezePoint={time:number;value:number;color:"lime"|"green"|"red"|"maroon"};
type Point={time:number;value:number};
type ResearchResult={version:number;mode:"RESEARCH";symbol:string;generated_at:number;duration_ms:number;view_tf:string;base_candle_count:number;profile:any;chart_candles:Candle[];entry_rows:any[];exit_rows:any[];candidate_exit_rows:any[];channel_rows:any[];controller_rows:any[];channel_line:any[];squeeze_points:SqueezePoint[];lrc_points:Point[];fisher_points:Point[];rsi_exit_points:Point[];backtest:BacktestStats&{closedTrades?:any[]};latest_controller:any};
type SavedProfileRow={symbol:string;profileId:number|null;createdAt:string;profile:InstrumentProfile|null;trading:TradingStatus["config"]};
type ExecutionMark={id:number;time:number;label:string;status:string;action:string;eventId:string};

const DEFAULT_EXIT:ExitModuleConfig={enabled:true,showMarkers:true,trendExitEnabled:false,exit1Enabled:true,exit1Tf:"15m",length:20,mult:2,lengthKC:20,multKC:1.5,useTrueRange:true,exit2Enabled:false,exit2Tf:"15m",lrcLength:20,exit3Enabled:false,exit3Tf:"15m",fisherLength:10,fisherThreshold:1.5,exit4Enabled:false,exit4Tf:"30m",rsiLength:14,rsiUpper:70,rsiLower:30};
const SQZ_COLORS:Record<string,string>={lime:"#00ff00",green:"#008000",red:"#ff0000",maroon:"#800000"};
const profileKey=(symbol:string)=>`qtrend:cockpit-v2:profile:${symbol}`;
const panel:CSSProperties={border:"1px solid #24324a",background:"#0b1220",borderRadius:10};
const inputStyle:CSSProperties={background:"#0a1020",border:"1px solid #334155",color:"#e5eefc",borderRadius:7,padding:"7px 9px",fontWeight:700};
const buttonStyle:CSSProperties={...inputStyle,cursor:"pointer"};
const emptyStats:BacktestStats={trades:0,wins:0,losses:0,grossProfit:0,grossLoss:0,net:0,profitFactor:null,winRate:0};

function defaultProfile(symbol:string):InstrumentProfile{return{symbol,interval:"5m",chartMode:"candles",activeModule:"exit",updatedAt:new Date().toISOString(),modules:{entry:{...DEFAULT_ENTRY},exit:{...DEFAULT_EXIT},channel:{...DEFAULT_CHANNEL},poc:{},controller:{...DEFAULT_CONTROLLER,requireTrend:true}}};}
function normalizeProfile(symbol:string,raw:any,ui?:InstrumentProfile):InstrumentProfile{return{...defaultProfile(symbol),...(raw||{}),symbol,chartMode:ui?.chartMode||raw?.chartMode||"candles",activeModule:ui?.activeModule||raw?.activeModule||"exit",modules:{entry:{...DEFAULT_ENTRY,...(raw?.modules?.entry||{})},exit:{...DEFAULT_EXIT,...(raw?.modules?.exit||{})},channel:{...DEFAULT_CHANNEL,...(raw?.modules?.channel||{})},poc:{...(raw?.modules?.poc||{})},controller:{...DEFAULT_CONTROLLER,...(raw?.modules?.controller||{}),requireTrend:true}}};}
function readLocal(symbol:string){try{const raw=localStorage.getItem(profileKey(symbol));return raw?normalizeProfile(symbol,JSON.parse(raw)):defaultProfile(symbol);}catch{return defaultProfile(symbol);}}
function saveLocal(profile:InstrumentProfile){localStorage.setItem(profileKey(profile.symbol),JSON.stringify(profile));}
function heikin(c:Candle[]):Candle[]{if(!c.length)return[];const out:Candle[]=[];let po=(c[0].open+c[0].close)/2,pc=(c[0].open+c[0].high+c[0].low+c[0].close)/4;out.push({time:c[0].time,open:po,close:pc,high:Math.max(c[0].high,po,pc),low:Math.min(c[0].low,po,pc),volume:c[0].volume});for(let i=1;i<c.length;i++){const x=c[i],close=(x.open+x.high+x.low+x.close)/4,open=(po+pc)/2;out.push({time:x.time,open,close,high:Math.max(x.high,open,close),low:Math.min(x.low,open,close),volume:x.volume});po=open;pc=close;}return out;}
async function fetchJson(url:string,init:RequestInit={}){const r=await fetch(url,{cache:"no-store",...init}),text=await r.text();let j:any;try{j=JSON.parse(text);}catch{throw new Error(`Keine JSON-Antwort: ${text.slice(0,120)}`);}if(!r.ok||j?.ok===false)throw new Error(j?.info||j?.reason||j?.error||`HTTP ${r.status}`);return j;}
function normalizeRows(rows:any[]):Candle[]{return(Array.isArray(rows)?rows:[]).map((c:any)=>({time:Number(c.time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close),volume:Number(c.volume||0)})).filter((c:Candle)=>[c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)).sort((a:Candle,b:Candle)=>a.time-b.time);}
function stretchPoints<T extends {time:number;value:number}>(candles:Candle[],points:T[],chartTf:string,sourceTf:string,extra?:(p:T)=>Record<string,unknown>){if(!candles.length||!points.length)return[];const sorted=[...points].sort((a,b)=>a.time-b.time),stride=Math.max(1,Math.round(tfSeconds(sourceTf)/Math.max(1,tfSeconds(chartTf)))),out:any[]=[];let slot=candles.length-1;for(let i=sorted.length-1;i>=0&&slot>=0;i--,slot-=stride){const p=sorted[i];out.push({time:candles[slot].time as Time,value:Number(p.value),...(extra?extra(p):{})});}return out.reverse();}
function exitLabel(reason:string){return reason==="TREND_FLIP_EXIT"?"TX":reason.startsWith("EXIT1_")?"E1":reason.startsWith("EXIT2_")?"E2":reason.startsWith("EXIT3_")?"E3":"E4";}
function exitColor(reason:string){return reason==="TREND_FLIP_EXIT"?"#f8fafc":reason.startsWith("EXIT1_")?"#facc15":reason.startsWith("EXIT2_")?"#38bdf8":reason.startsWith("EXIT3_")?"#d946ef":"#f97316";}
function executionColor(label:string){return label==="LIVE L"?"#22c55e":label==="LIVE S"?"#ef4444":label==="LIVE X"?"#f8fafc":label==="X CLOSED"?"#facc15":label==="X STALE"?"#c084fc":label==="X AUTO"?"#94a3b8":"#fb7185";}

export default function CockpitV2(){
 const {symbol,interval,setSymbol,setInterval}=useSharedMarket();
 const [profile,setProfile]=useState<InstrumentProfile>(()=>readLocal(symbol));
 const [research,setResearch]=useState<ResearchResult|null>(null);
 const [viewCandles,setViewCandles]=useState<Candle[]>([]);
 const [selected,setSelected]=useState<Candle|null>(null);
 const [activeModule,setActiveModule]=useState<ModuleKey>("exit");
 const [status,setStatus]=useState("RESEARCH wird vorbereitet …");
 const [researching,setResearching]=useState(false);
 const [liveDirty,setLiveDirty]=useState(false);
 const [liveProfileId,setLiveProfileId]=useState<number|null>(null);
 const [tradingStatus,setTradingStatus]=useState<TradingStatus|null>(null);
 const [executionMarks,setExecutionMarks]=useState<ExecutionMark[]>([]);
 const [booted,setBooted]=useState(false);
 const [showProfiles,setShowProfiles]=useState(false);
 const [profilesLoading,setProfilesLoading]=useState(false);
 const [profilesError,setProfilesError]=useState("");
 const [savedProfiles,setSavedProfiles]=useState<SavedProfileRow[]>([]);
 const chartHost=useRef<HTMLDivElement>(null),chart=useRef<IChartApi|null>(null),priceSeries=useRef<ISeriesApi<"Candlestick">|null>(null),trendSeries=useRef<ISeriesApi<"Line">|null>(null),sqzSeries=useRef<ISeriesApi<"Histogram">|null>(null),lrcSeries=useRef<ISeriesApi<"Line">|null>(null),fisherSeries=useRef<ISeriesApi<"Line">|null>(null),rsiSeries=useRef<ISeriesApi<"Line">|null>(null),markerApi=useRef<any>(null),candleMapRef=useRef(new Map<number,Candle>()),researchSeq=useRef(0),researchBusy=useRef(false),researchQueued=useRef(false),queuedProfile=useRef<InstrumentProfile|null>(null),queuedViewTf=useRef<string|null>(null),queuedSupersede=useRef(false),symbolRef=useRef(symbol),viewLastTime=useRef(0),tickBusy=useRef(false),profileRef=useRef(profile),intervalRef=useRef(interval);
 profileRef.current=profile;intervalRef.current=interval;symbolRef.current=symbol;
 const candles=viewCandles.length?viewCandles:(research?.chart_candles||[]);
 const shown=useMemo(()=>profile.chartMode==="heikin"?heikin(candles):candles,[candles,profile.chartMode]);
 const stats=research?.backtest||emptyStats;
 const exitCfg=profile.modules.exit,entryCfg=profile.modules.entry,channelCfg=profile.modules.channel,controllerCfg=profile.modules.controller;
 const sqzData=useMemo(()=>stretchPoints(candles,research?.squeeze_points||[],interval,exitCfg.exit1Tf,(p:any)=>({color:SQZ_COLORS[p.color]||"#64748b"})),[candles,research?.squeeze_points,interval,exitCfg.exit1Tf]);
 const lrcData=useMemo(()=>stretchPoints(candles,research?.lrc_points||[],interval,exitCfg.exit2Tf),[candles,research?.lrc_points,interval,exitCfg.exit2Tf]);
 const fisherData=useMemo(()=>stretchPoints(candles,research?.fisher_points||[],interval,exitCfg.exit3Tf),[candles,research?.fisher_points,interval,exitCfg.exit3Tf]);
 const rsiData=useMemo(()=>stretchPoints(candles,research?.rsi_exit_points||[],interval,exitCfg.exit4Tf),[candles,research?.rsi_exit_points,interval,exitCfg.exit4Tf]);
 const entryByChart=useMemo(()=>{const map=new Map<number,EntryRow>(),sec=tfSeconds(interval);for(const r of research?.entry_rows||[])map.set(Math.floor(Number(r.time)/sec)*sec,r);return map;},[research?.entry_rows,interval]);
 const selectedEntry=selected?entryByChart.get(selected.time)||null:null;
 const selectedExit=selected?(research?.exit_rows||[]).find((r:any)=>Math.floor((Number(r.time)-1)/tfSeconds(interval))*tfSeconds(interval)===selected.time)||null:null;
 const selectedTrend=selected?[...(research?.channel_rows||[])].reverse().find((r:any)=>Number(r.time)<=selected.time+tfSeconds(interval))||null:null;
 const selectedController=selected?[...(research?.controller_rows||[])].reverse().find((r:any)=>Number(r.time)<=selected.time+tfSeconds(interval))||null:null;

 async function refreshTradingStatus(){try{const currentSymbol=symbolRef.current,j=await fetchJson(`${BACKEND_BASE}/cockpit-v2/trading-status?symbol=${encodeURIComponent(currentSymbol)}&_ts=${Date.now()}`);if(currentSymbol===symbolRef.current)setTradingStatus(j);}catch{}}
 async function refreshExecutionMarks(){try{const currentSymbol=symbolRef.current,j=await fetchJson(`${BACKEND_BASE}/ui/strategy-events?symbol=${encodeURIComponent(currentSymbol)}&_ts=${Date.now()}`);if(currentSymbol!==symbolRef.current)return;const rows=(Array.isArray(j?.rows)?j.rows:[]).filter((r:any)=>String(r?.source||"")==="cockpit_v2_execution_status");const marks:ExecutionMark[]=[];for(const row of rows){let x:any=null;try{x=JSON.parse(String(row?.reason||"{}"));}catch{continue;}const label=String(x?.label||"").trim();if(!label)continue;marks.push({id:Number(row?.id||0),time:Number(row?.time||0),label,status:String(x?.status||""),action:String(x?.action||""),eventId:String(x?.event_id||"")});}setExecutionMarks(marks.sort((a,b)=>a.time-b.time||a.id-b.id).slice(-300));}catch{}}
 async function loadAllProfiles(){
  setShowProfiles(true);setProfilesLoading(true);setProfilesError("");
  try{
   const rows=await Promise.all(SYMBOLS.map(async s=>{
    const [profilesJson,tradingJson]=await Promise.all([
     fetchJson(`${BACKEND_BASE}/ui/strategy-events?symbol=${encodeURIComponent(`${s}__V2_PROFILE`)}&_ts=${Date.now()}`).catch(()=>({rows:[]})),
     fetchJson(`${BACKEND_BASE}/cockpit-v2/trading-status?symbol=${encodeURIComponent(s)}&_ts=${Date.now()}`).catch(()=>({config:null}))
    ]);
    const profileRows=(Array.isArray(profilesJson?.rows)?profilesJson.rows:[]).filter((r:any)=>String(r?.source||"")==="cockpit_v2_profile").sort((a:any,b:any)=>Number(a?.id||0)-Number(b?.id||0));
    const last=profileRows.at(-1)||null;let parsed:InstrumentProfile|null=null;
    if(last){try{parsed=normalizeProfile(s,JSON.parse(String(last.reason||"{}")));}catch{parsed=null;}}
    return{symbol:s,profileId:last?Number(last.id||0)||null:null,createdAt:String(last?.created_at||""),profile:parsed,trading:tradingJson?.config||null} as SavedProfileRow;
   }));
   setSavedProfiles(rows);
  }catch(e){setProfilesError(e instanceof Error?e.message:String(e));}
  finally{setProfilesLoading(false);}
 }
 async function bootstrap(){researchSeq.current+=1;researchQueued.current=false;queuedProfile.current=null;queuedViewTf.current=null;queuedSupersede.current=false;setBooted(false);setResearch(null);setViewCandles([]);setExecutionMarks([]);setSelected(null);setStatus("LIVE-Profil wird geladen …");const currentSymbol=symbolRef.current;let next=readLocal(currentSymbol),pid:null|number=null;try{const j=await fetchJson(`${BACKEND_BASE}/cockpit-v2/snapshot?symbol=${encodeURIComponent(currentSymbol)}&_ts=${Date.now()}`);if(currentSymbol===symbolRef.current&&j?.snapshot?.profile){next=normalizeProfile(currentSymbol,j.snapshot.profile,next);pid=Number(j.snapshot.profile_id||0)||null;}}catch{}if(currentSymbol!==symbolRef.current)return;setProfile(next);profileRef.current=next;setLiveProfileId(pid);setLiveDirty(false);setBooted(true);void refreshTradingStatus();void refreshExecutionMarks();}
 async function runResearch(p:InstrumentProfile=profileRef.current,viewTf:string=intervalRef.current,supersede=false){
  if(researchBusy.current){researchQueued.current=true;queuedProfile.current=p;queuedViewTf.current=viewTf;queuedSupersede.current=queuedSupersede.current||supersede;if(supersede)researchSeq.current+=1;return;}
  researchBusy.current=true;
  const requestSymbol=symbolRef.current,seq=++researchSeq.current;
  setResearching(true);
  try{
   const j=await fetchJson(`${BACKEND_BASE}/cockpit-v2/research`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:requestSymbol,view_tf:viewTf,profile:{...p,symbol:requestSymbol}})});
   if(seq!==researchSeq.current||requestSymbol!==symbolRef.current)return;
   const r=j.research as ResearchResult;setResearch(r);const rows=normalizeRows(r.chart_candles);setViewCandles(rows);viewLastTime.current=Number(rows.at(-1)?.time||0);if(rows.length&&!selected)setSelected(rows.at(-1)||null);const net=Number(r.backtest?.net||0);setStatus(`RESEARCH ${r.duration_ms} ms · ${r.base_candle_count}×1m · PF ${r.backtest?.profitFactor==null?"—":Number(r.backtest.profitFactor).toFixed(3)} · NET ${net>=0?"+":""}${net.toFixed(2)} · ${r.backtest?.trades||0} Trades`);
  }catch(e){if(seq===researchSeq.current&&requestSymbol===symbolRef.current)setStatus(`RESEARCH-Fehler: ${e instanceof Error?e.message:String(e)}`);}
  finally{
   researchBusy.current=false;
   if(researchQueued.current){const qp=queuedProfile.current||profileRef.current,qtf=queuedViewTf.current||intervalRef.current,qs=queuedSupersede.current;researchQueued.current=false;queuedProfile.current=null;queuedViewTf.current=null;queuedSupersede.current=false;queueMicrotask(()=>void runResearch(qp,qtf,qs));}
   else if(requestSymbol===symbolRef.current)setResearching(false);
  }
 }
 function change(mutator:(p:InstrumentProfile)=>InstrumentProfile){setProfile(prev=>{const next=mutator(prev);profileRef.current=next;return next;});setLiveDirty(true);}
 async function applyLive(){try{setStatus("LIVE-Profil wird übernommen …");const saved={...profileRef.current,symbol,modules:{...profileRef.current.modules,controller:{...profileRef.current.modules.controller,requireTrend:true}},updatedAt:new Date().toISOString()};saveLocal(saved);const j=await fetchJson(`${BACKEND_BASE}/ui/strategy-event`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:`${symbol}__V2_PROFILE`,tf:saved.interval,side:"profile",time:Math.floor(Date.now()/1000),price:0,source:"cockpit_v2_profile",reason:JSON.stringify(saved)})});setLiveProfileId(Number(j?.id||j?.row?.id||0)||liveProfileId);setLiveDirty(false);setStatus("LIVE-Profil übernommen · Research bleibt identisch");}catch(e){setStatus(`LIVE-Fehler: ${e instanceof Error?e.message:String(e)}`);}}
 async function changeAuto(enabled:boolean){try{await fetchJson(`${BACKEND_BASE}/cockpit-v2/auto`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,enabled})});await refreshTradingStatus();}catch(e){setStatus(`AUTO-Fehler: ${e instanceof Error?e.message:String(e)}`);}}
 async function tickView(){if(tickBusy.current||!booted)return;tickBusy.current=true;try{const currentSymbol=symbolRef.current,tf=intervalRef.current,j=await fetchJson(`${BACKEND_BASE}/v5/candles?symbol=${encodeURIComponent(currentSymbol)}&interval=${encodeURIComponent(tf)}&limit=2&_ts=${Date.now()}`),rows=normalizeRows(j?.candles);if(currentSymbol!==symbolRef.current||!rows.length)return;const last=rows.at(-1)!;if(Number(last.time)>viewLastTime.current){viewLastTime.current=Number(last.time);setViewCandles(prev=>{const map=new Map(prev.map(c=>[c.time,c]));for(const row of rows)map.set(row.time,row);return[...map.values()].sort((a,b)=>a.time-b.time).slice(-1500);});}else if(profileRef.current.chartMode==="candles"){candleMapRef.current.set(last.time,last);priceSeries.current?.update({time:last.time as Time,open:last.open,high:last.high,low:last.low,close:last.close});}}catch{}finally{tickBusy.current=false;}}

 useEffect(()=>{void bootstrap();},[symbol]);
 useEffect(()=>{if(!booted)return;const t=window.setTimeout(()=>void runResearch(profileRef.current,interval,true),180);return()=>window.clearTimeout(t);},[booted,profile,interval,symbol]);
 useEffect(()=>{if(!booted)return;const t=window.setInterval(()=>void tickView(),1000),r=window.setInterval(()=>void runResearch(profileRef.current,intervalRef.current,false),15000),s=window.setInterval(()=>void refreshTradingStatus(),5000),x=window.setInterval(()=>void refreshExecutionMarks(),2000);return()=>{window.clearInterval(t);window.clearInterval(r);window.clearInterval(s);window.clearInterval(x);};},[booted,symbol]);
 useEffect(()=>{candleMapRef.current=new Map(candles.map(c=>[c.time,c]));},[candles]);
 useEffect(()=>{
  const onOptimizerProfile=(event:Event)=>{
   const detail=(event as CustomEvent<{symbol?:string;profile?:any}>).detail;
   if(!detail?.profile)return;
   const targetSymbol=String(detail.symbol||symbolRef.current).toUpperCase();
   if(targetSymbol!==symbolRef.current)return;
   const next=normalizeProfile(targetSymbol,detail.profile,profileRef.current);
   next.updatedAt=new Date().toISOString();
   setProfile(next);profileRef.current=next;setLiveDirty(true);setStatus("OPTIMIZER-Kandidat direkt in RESEARCH geladen …");
  };
  window.addEventListener("qtrend:cockpit-v2:load-research-profile",onOptimizerProfile as EventListener);
  return()=>window.removeEventListener("qtrend:cockpit-v2:load-research-profile",onOptimizerProfile as EventListener);
 },[]);

 useEffect(()=>{if(!chartHost.current)return;const c=createChart(chartHost.current,{autoSize:true,layout:{background:{color:"#070b16"},textColor:"#dbe4ff",panes:{separatorColor:"#334155",separatorHoverColor:"#475569",enableResize:true}},grid:{vertLines:{color:"#172033"},horzLines:{color:"#172033"}},crosshair:{mode:CrosshairMode.Normal},rightPriceScale:{borderColor:"#334155",minimumWidth:90},timeScale:{borderColor:"#334155",timeVisible:true,secondsVisible:false,tickMarkFormatter:(t:any)=>chartBerlinTime(Number(t))},localization:{timeFormatter:(t:any)=>chartBerlinTime(Number(t))}});const ps=c.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",wickUpColor:"#22c55e",wickDownColor:"#ef4444",borderVisible:false},0);trendSeries.current=c.addSeries(LineSeries,{lineWidth:3,priceLineVisible:false,lastValueVisible:false},0);sqzSeries.current=c.addSeries(HistogramSeries,{base:0,priceLineVisible:false,lastValueVisible:true},1);lrcSeries.current=c.addSeries(LineSeries,{lineWidth:2,priceLineVisible:false,lastValueVisible:true},2);fisherSeries.current=c.addSeries(LineSeries,{lineWidth:2,priceLineVisible:false,lastValueVisible:true},3);rsiSeries.current=c.addSeries(LineSeries,{lineWidth:2,priceLineVisible:false,lastValueVisible:true},4);chart.current=c;priceSeries.current=ps;markerApi.current=createSeriesMarkers(ps,[]);c.subscribeCrosshairMove(p=>{if(!p.time)return;const row=candleMapRef.current.get(Number(p.time));if(row)setSelected(row);});return()=>{c.remove();chart.current=null;priceSeries.current=null;trendSeries.current=null;sqzSeries.current=null;lrcSeries.current=null;fisherSeries.current=null;rsiSeries.current=null;markerApi.current=null;};},[]);
 useEffect(()=>{priceSeries.current?.setData(shown.map(c=>({time:c.time as Time,open:c.open,high:c.high,low:c.low,close:c.close})));},[shown]);
 useEffect(()=>{trendSeries.current?.applyOptions({visible:channelCfg.enabled&&channelCfg.showLines});trendSeries.current?.setData((research?.channel_line||[]).map((p:any)=>({time:Number(p.time) as Time,value:Number(p.value),color:Number(p.trend)===1?"#22c55e":"#ef4444"})) as any);},[research?.channel_line,channelCfg.enabled,channelCfg.showLines]);
 useEffect(()=>{sqzSeries.current?.applyOptions({visible:exitCfg.exit1Enabled});lrcSeries.current?.applyOptions({visible:exitCfg.exit2Enabled});fisherSeries.current?.applyOptions({visible:exitCfg.exit3Enabled});rsiSeries.current?.applyOptions({visible:exitCfg.exit4Enabled});sqzSeries.current?.setData(sqzData as any);lrcSeries.current?.setData(lrcData as any);fisherSeries.current?.setData(fisherData as any);rsiSeries.current?.setData(rsiData as any);const panes=chart.current?.panes()||[];[[1,exitCfg.exit1Enabled],[2,exitCfg.exit2Enabled],[3,exitCfg.exit3Enabled],[4,exitCfg.exit4Enabled]].forEach(([i,on]:any)=>{if(panes[i])panes[i].setHeight(on?120:24);});},[sqzData,lrcData,fisherData,rsiData,exitCfg.exit1Enabled,exitCfg.exit2Enabled,exitCfg.exit3Enabled,exitCfg.exit4Enabled]);
 useEffect(()=>{if(!markerApi.current)return;const sec=tfSeconds(interval),chartTimes=new Set(candles.map(c=>c.time)),markers:any[]=[];for(const r of research?.exit_rows||[]){if(!exitCfg.showMarkers)break;const time=Math.floor((Number(r.time)-1)/sec)*sec;if(!chartTimes.has(time))continue;const reason=String(r.reason||"");markers.push({time:time as Time,position:r.exit==="LONG"?"aboveBar":"belowBar",color:exitColor(reason),shape:"square",text:exitLabel(reason),size:1.25});}if(controllerCfg.showMarkers)for(const r of research?.controller_rows||[]){const time=Math.floor((Number(r.time)-1)/sec)*sec;if(!chartTimes.has(time))continue;const ol=r.action==="OPEN_LONG"||r.action==="FLIP_LONG",os=r.action==="OPEN_SHORT"||r.action==="FLIP_SHORT",el=r.action==="EXIT_LONG";markers.push({time:time as Time,position:ol?"belowBar":os?"aboveBar":el?"aboveBar":"belowBar",color:ol?"#38bdf8":os?"#fb923c":"#f8fafc",shape:ol?"arrowUp":os?"arrowDown":"circle",text:ol?"C LONG":os?"C SHORT":el?"C EXIT L":"C EXIT S",size:2});}for(const m of executionMarks){const time=Math.floor(Number(m.time)/sec)*sec;if(!chartTimes.has(time))continue;const isLong=m.label==="LIVE L",isShort=m.label==="LIVE S",isExit=m.label==="LIVE X";markers.push({time:time as Time,position:isLong?"belowBar":isShort?"aboveBar":isExit?"aboveBar":"aboveBar",color:executionColor(m.label),shape:isLong?"arrowUp":isShort?"arrowDown":"square",text:m.label,size:2.8});}markerApi.current.setMarkers(markers.sort((a:any,b:any)=>Number(a.time)-Number(b.time)));},[research?.exit_rows,research?.controller_rows,executionMarks,candles,interval,exitCfg.showMarkers,controllerCfg.showMarkers]);

 const patchEntry=(p:Partial<EntryConfig>)=>change(v=>({...v,modules:{...v.modules,entry:{...v.modules.entry,...p}}}));
 const patchExit=(p:Partial<ExitModuleConfig>)=>change(v=>({...v,modules:{...v.modules,exit:{...v.modules.exit,...p}}}));
 const patchChannel=(p:Partial<ChannelConfig>)=>change(v=>({...v,modules:{...v.modules,channel:{...v.modules.channel,...p}}}));
 const patchController=(p:Partial<ControllerConfig>)=>change(v=>({...v,modules:{...v.modules,controller:{...v.modules.controller,...p,requireTrend:true}}}));

 return <div style={{height:"calc(100vh - 84px)",minHeight:720,display:"grid",gridTemplateRows:"auto 1fr",gap:8,padding:8,color:"#dbe4ff",background:"#050914"}}>
  <div style={{...panel,padding:9,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
   <b style={{fontSize:16,color:"#67e8f9"}}>COCKPIT V2 · RENDER RESEARCH</b>
   <select value={symbol} onChange={e=>setSymbol(e.target.value)} style={inputStyle}>{SYMBOLS.map(x=><option key={x}>{x}</option>)}</select>
   <select value={interval} onChange={e=>setInterval(e.target.value)} style={inputStyle}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select>
   <button onClick={()=>setProfile(v=>({...v,chartMode:v.chartMode==="candles"?"heikin":"candles"}))} style={buttonStyle}>{profile.chartMode==="heikin"?"HEIKIN":"KERZEN"}</button>
   <div style={{flex:1,minWidth:260,padding:"8px 12px",borderRadius:7,border:"1px solid #155e75",background:"#082f49",color:"#a5f3fc",fontWeight:800}}>{researching?"RESEARCH rechnet …":status}</div>
   <button onClick={()=>void loadAllProfiles()} style={{...buttonStyle,background:"#0f3f5f",color:"#cffafe"}}>ALLE PROFILE</button>
   <button onClick={()=>void applyLive()} disabled={!liveDirty} style={{...buttonStyle,background:liveDirty?"#9a3412":"#334155",color:"white",opacity:liveDirty?1:.6}}>LIVE ÜBERNEHMEN</button>
  </div>
  {showProfiles&&<ProfilesModal rows={savedProfiles} loading={profilesLoading} error={profilesError} onReload={()=>void loadAllProfiles()} onClose={()=>setShowProfiles(false)}/>} 
  <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 365px",gap:8,minHeight:0}}>
   <div style={{...panel,overflow:"hidden",position:"relative",minHeight:0}}>
    <div ref={chartHost} style={{position:"absolute",inset:0}}/>
    <div style={{position:"absolute",top:8,left:10,zIndex:3,padding:"5px 8px",borderRadius:6,background:"#08111ecc",border:"1px solid #23324a",fontSize:11,fontWeight:800}}>{symbol} · VIEW {interval} · RESEARCH LIVE · TREND {channelCfg.tf} · TX {exitCfg.trendExitEnabled?"ON":"OFF"} · E1 {exitCfg.exit1Tf} · E2 {exitCfg.exit2Tf} · E3 {exitCfg.exit3Tf} · E4 {exitCfg.exit4Tf}</div>
   </div>
   <aside style={{display:"grid",gridTemplateRows:"minmax(0,3fr) minmax(0,2fr)",gap:8,minHeight:0,overflow:"hidden"}}>
    <section style={{...panel,padding:10,overflow:"auto"}}>
     <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:10}}>{(["exit","entry","channel","controller"] as ModuleKey[]).map(k=><button key={k} onClick={()=>setActiveModule(k)} style={{...buttonStyle,padding:"7px 3px",fontSize:10,background:activeModule===k?"#4c1d95":"#0a1020"}}>{k.toUpperCase()}</button>)}</div>
     {activeModule==="exit"&&<ExitSettings cfg={exitCfg} patch={patchExit}/>} 
     {activeModule==="entry"&&<EntrySettings cfg={entryCfg} patch={patchEntry}/>} 
     {activeModule==="channel"&&<ChannelSettings cfg={channelCfg} patch={patchChannel}/>} 
     {activeModule==="controller"&&<ControllerSettings cfg={controllerCfg} patch={patchController} stats={stats} trading={tradingStatus} liveDirty={liveDirty} liveProfileId={liveProfileId} onAuto={changeAuto}/>} 
    </section>
    <section style={{...panel,padding:10,overflow:"auto"}}><b>INSPECTOR · RESEARCH</b>{selected?<div style={{display:"grid",gap:6,marginTop:8}}><InfoRow k="Zeit" v={chartBerlinTime(selected.time)}/><InfoRow k="Close" v={selected.close}/><InfoRow k="ENTRY" v={selectedEntry?.entry||"NONE"}/><InfoRow k="EXIT" v={selectedExit?.exit||"NONE"}/><InfoRow k="EXIT GRUND" v={selectedExit?.reason||"—"}/><InfoRow k="TREND" v={selectedTrend?(selectedTrend.trend===1?"LONG":"SHORT"):"—"}/><InfoRow k="CONTROLLER" v={selectedController?.state||"FLAT"}/><InfoRow k="PF" v={stats.profitFactor==null?"—":Number(stats.profitFactor).toFixed(3)}/></div>:null}</section>
   </aside>
  </div>
 </div>;
}

function ProfilesModal({rows,loading,error,onReload,onClose}:{rows:SavedProfileRow[];loading:boolean;error:string;onReload:()=>void;onClose:()=>void}){
 const cell:CSSProperties={padding:"7px 8px",borderBottom:"1px solid #23324a",borderRight:"1px solid #182236",whiteSpace:"nowrap",fontSize:12};
 const head:CSSProperties={...cell,position:"sticky",top:0,zIndex:2,background:"#111c2d",color:"#67e8f9",fontWeight:900};
 const yn=(v:any)=>v?"ON":"OFF";
 const mod=(enabled:any,tf:any)=>`${yn(enabled)} · ${tf||"—"}`;
 return <div style={{position:"fixed",inset:0,zIndex:1000,background:"#020617dd",display:"grid",placeItems:"center",padding:20}}>
  <div style={{width:"min(98vw,1900px)",height:"min(88vh,900px)",...panel,display:"grid",gridTemplateRows:"auto 1fr",overflow:"hidden",boxShadow:"0 20px 80px #000"}}>
   <div style={{display:"flex",alignItems:"center",gap:10,padding:10,borderBottom:"1px solid #334155"}}><b style={{color:"#67e8f9",fontSize:16}}>GESPEICHERTE ENGINE-PROFILE · READ ONLY</b><span style={{color:"#94a3b8"}}>Quelle: cockpit_v2_profile + Trading-Status</span><div style={{flex:1}}/><button onClick={onReload} style={buttonStyle}>NEU LADEN</button><button onClick={onClose} style={{...buttonStyle,background:"#7f1d1d",color:"white"}}>SCHLIESSEN</button></div>
   <div style={{overflow:"auto",padding:8}}>
    {loading&&<div style={{padding:20,color:"#a5f3fc",fontWeight:900}}>Profile werden direkt aus der Engine geladen …</div>}
    {error&&<div style={{padding:12,color:"#fecaca",background:"#450a0a",borderRadius:7}}>Fehler: {error}</div>}
    {!loading&&!error&&<table style={{borderCollapse:"collapse",minWidth:2700,width:"100%",background:"#070b16"}}>
     <thead><tr>
      {['Instrument','Profil TF','Chart','Entry','Fast SMA','Slow SMA','Entry ATR','RSI','MACD F/S/Sig','Trend','Trend Linie','Trend ATR','Trend Multi','Wilder ATR','EXIT Marker','Trend Exit','E1','E1 BB Len/Mult','E1 KC Len/Mult','E2','E2 Len','E3','E3 Len/Ext','E4','E4 RSI L/U','Controller','C-Marker','Flip','Größe','AUTO','Profil-ID','Gespeichert'].map(h=><th key={h} style={head}>{h}</th>)}
     </tr></thead>
     <tbody>{rows.map(r=>{const p=r.profile,e=p?.modules?.entry,x=p?.modules?.exit,c=p?.modules?.channel,k=p?.modules?.controller;return <tr key={r.symbol} style={{background:r.symbol==="GOLD"?"#0b1626":"transparent"}}>
      <td style={{...cell,fontWeight:900,color:"#f8fafc"}}>{r.symbol}</td><td style={cell}>{p?.interval||'—'}</td><td style={cell}>{p?.chartMode||'—'}</td>
      <td style={cell}>{e?mod(e.enabled,e.tf):'—'}</td><td style={cell}>{e?.fastSma??'—'}</td><td style={cell}>{e?.slowSma??'—'}</td><td style={cell}>{e?.atrLen??'—'}</td><td style={cell}>{e?.rsiLen??'—'}</td><td style={cell}>{e?`${e.macdFast}/${e.macdSlow}/${e.macdSignal}`:'—'}</td>
      <td style={cell}>{c?mod(c.enabled,c.tf):'—'}</td><td style={cell}>{c?yn(c.showLines):'—'}</td><td style={cell}>{c?.atrPeriod??'—'}</td><td style={cell}>{c?.multiplier??'—'}</td><td style={cell}>{c?yn(c.useRmaAtr):'—'}</td>
      <td style={cell}>{x?yn(x.showMarkers):'—'}</td><td style={cell}>{x?yn(x.trendExitEnabled):'—'}</td><td style={cell}>{x?mod(x.exit1Enabled,x.exit1Tf):'—'}</td><td style={cell}>{x?`${x.length}/${x.mult}`:'—'}</td><td style={cell}>{x?`${x.lengthKC}/${x.multKC}`:'—'}</td>
      <td style={cell}>{x?mod(x.exit2Enabled,x.exit2Tf):'—'}</td><td style={cell}>{x?.lrcLength??'—'}</td><td style={cell}>{x?mod(x.exit3Enabled,x.exit3Tf):'—'}</td><td style={cell}>{x?`${x.fisherLength}/${x.fisherThreshold}`:'—'}</td>
      <td style={cell}>{x?mod(x.exit4Enabled,x.exit4Tf):'—'}</td><td style={cell}>{x?`${x.rsiLength} · ${x.rsiLower}/${x.rsiUpper}`:'—'}</td>
      <td style={cell}>{k?yn(k.enabled):'—'}</td><td style={cell}>{k?yn(k.showMarkers):'—'}</td><td style={cell}>{k?yn(k.allowFlip):'—'}</td>
      <td style={cell}>{r.trading?.size??'—'}</td><td style={{...cell,color:r.trading?.auto_enabled?'#86efac':'#fca5a5',fontWeight:900}}>{r.trading?.auto_enabled?'ON':'OFF'}</td><td style={cell}>{r.profileId??'—'}</td><td style={cell}>{r.createdAt||'—'}</td>
     </tr>})}</tbody>
    </table>}
   </div>
  </div>
 </div>;
}

function EntrySettings({cfg,patch}:{cfg:EntryConfig;patch:(p:Partial<EntryConfig>)=>void}){const num=(k:keyof EntryConfig,l:string,s=1)=><label style={{display:"grid",gap:3}}>{l}<input type="number" step={s} value={Number(cfg[k])} onChange={e=>patch({[k]:Number(e.target.value)} as Partial<EntryConfig>)} style={inputStyle}/></label>;return <div style={{display:"grid",gap:9}}><b>ENTRY · jede Änderung sofort RESEARCH</b><label>TF <select value={cfg.tf} onChange={e=>patch({tf:e.target.value})} style={inputStyle}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select></label><label>aktiv <input type="checkbox" checked={cfg.enabled} onChange={e=>patch({enabled:e.target.checked})}/></label><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>{num("fastSma","Fast SMA")}{num("slowSma","Slow SMA")}{num("atrLen","ATR")}{num("rsiLen","RSI")}{num("macdFast","MACD Fast")}{num("macdSlow","MACD Slow")}{num("macdSignal","Signal")}</div></div>}
function ExitSettings({cfg,patch}:{cfg:ExitModuleConfig;patch:(p:Partial<ExitModuleConfig>)=>void}){const tf=(key:keyof ExitModuleConfig)=><select value={String(cfg[key])} onChange={e=>patch({[key]:e.target.value} as Partial<ExitModuleConfig>)} style={inputStyle}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select>;const n=(key:keyof ExitModuleConfig,step=1)=><input type="number" step={step} value={Number(cfg[key])} onChange={e=>patch({[key]:Number(e.target.value)} as Partial<ExitModuleConfig>)} style={inputStyle}/>;const box=(title:string,key:keyof ExitModuleConfig,body:any)=><div style={{border:"1px solid #334155",borderRadius:8,padding:9,display:"grid",gap:7}}><label style={{fontWeight:900}}>{title} <input type="checkbox" checked={Boolean(cfg[key])} onChange={e=>patch({[key]:e.target.checked} as Partial<ExitModuleConfig>)}/></label>{body}</div>;return <div style={{display:"grid",gap:9}}><div style={{padding:8,border:"1px solid #155e75",borderRadius:7,color:"#a5f3fc",fontWeight:800}}>Alles hier ist TEMPORÄR. Marker, Trades und PF werden sofort auf Render neu gerechnet.</div><label>EXIT-Marker <input type="checkbox" checked={cfg.showMarkers} onChange={e=>patch({showMarkers:e.target.checked})}/></label>{box("TX · TRENDWECHSEL EXIT","trendExitEnabled",<small>Nutzt den eingestellten TREND-TF. LONG→SHORT schließt nur LONG · SHORT→LONG schließt nur SHORT. Der Trendwechsel selbst öffnet keine Gegenposition.</small>)}{box("E1 · SQZMOM","exit1Enabled",<><label>TF {tf("exit1Tf")}</label><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}><label>BB Länge {n("length")}</label><label>BB Mult {n("mult",.1)}</label><label>KC Länge {n("lengthKC")}</label><label>KC Mult {n("multKC",.1)}</label></div><small>hellgrün→dunkelgrün LONG EXIT · hellrot→dunkelrot SHORT EXIT</small></>)}{box("E2 · LRC TURN","exit2Enabled",<><label>TF {tf("exit2Tf")}</label><label>Länge {n("lrcLength")}</label></>)}{box("E3 · FISHER EXTREM","exit3Enabled",<><label>TF {tf("exit3Tf")}</label><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}><label>Länge {n("fisherLength")}</label><label>Extrem ± {n("fisherThreshold",.1)}</label></div></>)}{box("E4 · HTF-RSI ARM+TURN","exit4Enabled",<><label>TF {tf("exit4Tf")}</label><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}><label>RSI {n("rsiLength")}</label><label>Upper {n("rsiUpper")}</label><label>Lower {n("rsiLower")}</label></div></>)}</div>}
function ChannelSettings({cfg,patch}:{cfg:ChannelConfig;patch:(p:Partial<ChannelConfig>)=>void}){return <div style={{display:"grid",gap:9}}><div style={{padding:8,border:"1px solid #166534",borderRadius:7,color:"#86efac",fontWeight:900}}>HART: Trend LONG → nur LONG öffnen · Trend SHORT → nur SHORT öffnen. Exit darf schließen.</div><label>TREND TF <select value={cfg.tf} onChange={e=>patch({tf:e.target.value})} style={inputStyle}>{INTERVALS.map(x=><option key={x}>{x}</option>)}</select></label><label>aktiv <input type="checkbox" checked={cfg.enabled} onChange={e=>patch({enabled:e.target.checked})}/></label><label>Linie <input type="checkbox" checked={cfg.showLines} onChange={e=>patch({showLines:e.target.checked})}/></label><label>ATR Periode <input type="number" value={cfg.atrPeriod} onChange={e=>patch({atrPeriod:Number(e.target.value)})} style={inputStyle}/></label><label>Multiplikator <input type="number" step="0.1" value={cfg.multiplier} onChange={e=>patch({multiplier:Number(e.target.value)})} style={inputStyle}/></label><label>Wilder ATR <input type="checkbox" checked={cfg.useRmaAtr} onChange={e=>patch({useRmaAtr:e.target.checked})}/></label></div>}
function ControllerSettings({cfg,patch,stats,trading,liveDirty,liveProfileId,onAuto}:{cfg:ControllerConfig;patch:(p:Partial<ControllerConfig>)=>void;stats:BacktestStats;trading:TradingStatus|null;liveDirty:boolean;liveProfileId:number|null;onAuto:(x:boolean)=>void}){return <div style={{display:"grid",gap:9}}><label>Controller aktiv <input type="checkbox" checked={cfg.enabled} onChange={e=>patch({enabled:e.target.checked})}/></label><label>Controller-Marker <input type="checkbox" checked={cfg.showMarkers} onChange={e=>patch({showMarkers:e.target.checked})}/></label><label>Direkten Flip erlauben <input type="checkbox" checked={cfg.allowFlip} onChange={e=>patch({allowFlip:e.target.checked})}/></label><div style={{padding:8,border:"1px solid #155e75",borderRadius:7}}><InfoRow k="RESEARCH PF" v={stats.profitFactor==null?"—":Number(stats.profitFactor).toFixed(3)}/><InfoRow k="Trades" v={stats.trades}/><InfoRow k="Net" v={Number(stats.net||0).toFixed(2)}/><InfoRow k="Winrate" v={`${Number(stats.winRate||0).toFixed(1)} %`}/></div><InfoRow k="LIVE Profil" v={liveProfileId??"—"}/><InfoRow k="Research≠Live" v={liveDirty?"JA":"NEIN"}/><InfoRow k="AUTO" v={trading?.config?.auto_enabled?"ON":"OFF"}/><InfoRow k="Größe" v={trading?.config?.size??"—"}/><button onClick={()=>onAuto(!Boolean(trading?.config?.auto_enabled))} style={{...buttonStyle,background:trading?.config?.auto_enabled?"#7f1d1d":"#166534",color:"white"}}>{trading?.config?.auto_enabled?"AUTO AUSSCHALTEN":"AUTO EINSCHALTEN"}</button></div>}
function InfoRow({k,v}:{k:string;v:any}){return <div style={{display:"grid",gridTemplateColumns:"105px 1fr",gap:8,paddingBottom:5,borderBottom:"1px solid #182236"}}><span style={{color:"#67e8f9",fontWeight:800}}>{k}</span><span style={{textAlign:"right",color:"#f8fafc",fontWeight:800}}>{typeof v==="number"?Number(v).toFixed(3):String(v)}</span></div>}
