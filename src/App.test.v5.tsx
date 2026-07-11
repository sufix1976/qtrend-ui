import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
} from "lightweight-charts";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type Side = "flat" | "long" | "short";
type ChartMode = "heikin" | "candles";

type V5Config = {
  symbol: string;
  interval: string;
  size: number;
  auto_enabled: boolean;
  sma_fast: number;
  sma_slow: number;
  atr_len: number;
  rsi_len: number;
  macd_fast: number;
  macd_slow: number;
  macd_signal: number;
};

type V5Snapshot = {
  symbol: string;
  interval: string;
  broker_side: Side;
  strategy_side: Side;
  dna: string;
  action: string;
  regime: string;
  regime_confidence: number;
  phase: string;
  phase_confidence: number;
  direction: string;
  trend: number;
  momentum: number;
  energy: number;
  volatility: number;
  compression: number;
  structure: number;
  balance: number;
  trend_age: number;
  pullback: number;
  exhaustion: number;
};

type ConfigMap = Record<string, V5Config>;

const BACKEND_BASE = "https://qtrend-trading-engine.onrender.com";
const SYMBOLS = ["BTCUSD","ETHUSD","XRPUSD","DE40","US100","US500","US30","J225","UK100","GOLD","SILVER","OIL_CRUDE","CORN","SOLUSD","TSLA","TY","EURUSD"];
const INTERVALS = ["1m","3m","5m","10m","15m","30m","1h"];
const DEFAULT_CONFIG: V5Config = { symbol:"BTCUSD", interval:"15m", size:1, auto_enabled:false, sma_fast:20, sma_slow:50, atr_len:14, rsi_len:14, macd_fast:2, macd_slow:26, macd_signal:9 };

function buildHeikinAshi(candles: Candle[]): Candle[] {
  if (!candles.length) return [];
  const out: Candle[] = [];
  let haOpen = (candles[0].open + candles[0].close) / 2;
  let haClose = (candles[0].open + candles[0].high + candles[0].low + candles[0].close) / 4;
  out.push({ time:candles[0].time, open:haOpen, high:Math.max(candles[0].high,haOpen,haClose), low:Math.min(candles[0].low,haOpen,haClose), close:haClose });
  for (let i=1;i<candles.length;i+=1) {
    const c = candles[i];
    haClose = (c.open+c.high+c.low+c.close)/4;
    haOpen = (out[i-1].open+out[i-1].close)/2;
    out.push({ time:c.time, open:haOpen, high:Math.max(c.high,haOpen,haClose), low:Math.min(c.low,haOpen,haClose), close:haClose });
  }
  return out;
}

function ema(values:{time:number;value:number}[], length:number) {
  if (!values.length || length<=0) return [];
  const k = 2/(length+1);
  let current = values[0].value;
  return values.map((p)=>{ current = p.value*k + current*(1-k); return {time:p.time,value:current}; });
}

function calcMacd(candles:Candle[], fast:number, slow:number, signal:number) {
  const closeLine = candles.map((c)=>({time:c.time,value:c.close}));
  const fastLine = ema(closeLine,fast);
  const slowLine = ema(closeLine,slow);
  const slowMap = new Map(slowLine.map((p)=>[p.time,p.value]));
  const macd = fastLine.map((p)=>({time:p.time,value:p.value-Number(slowMap.get(p.time)??p.value)}));
  const signalLine = ema(macd,signal);
  const signalMap = new Map(signalLine.map((p)=>[p.time,p.value]));
  const histogram = macd.map((p)=>({time:p.time,value:p.value-Number(signalMap.get(p.time)??p.value)}));
  return {macd,signal:signalLine,histogram};
}

async function fetchJson(url:string, init?:RequestInit) {
  const res = await fetch(url,{cache:"no-store",...init});
  const text = await res.text();
  let json:any;
  try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0,300)}`); }
  if (!res.ok || json?.ok===false) throw new Error(json?.error||json?.info||`HTTP ${res.status}`);
  return json;
}

export default function AppTESTv5() {
  const priceHostRef = useRef<HTMLDivElement|null>(null);
  const macdHostRef = useRef<HTMLDivElement|null>(null);
  const priceChartRef = useRef<IChartApi|null>(null);
  const macdChartRef = useRef<IChartApi|null>(null);
  const [symbol,setSymbol] = useState("BTCUSD");
  const [interval,setInterval] = useState("15m");
  const [chartMode,setChartMode] = useState<ChartMode>("heikin");
  const [candles,setCandles] = useState<Candle[]>([]);
  const [configs,setConfigs] = useState<ConfigMap>({});
  const [config,setConfig] = useState<V5Config>(DEFAULT_CONFIG);
  const [snapshot,setSnapshot] = useState<V5Snapshot|null>(null);
  const [status,setStatus] = useState("Start");
  const [busy,setBusy] = useState(false);

  const visibleCandles = useMemo(()=>chartMode==="heikin"?buildHeikinAshi(candles):candles,[candles,chartMode]);

  useEffect(()=>{ document.body.style.margin="0"; document.body.style.background="#050914"; document.body.style.color="#eef2ff"; },[]);
  useEffect(() => {
  const current = configs[symbol];

  if (current) {
    setConfig(current);

    // Gespeicherten TF nur beim Symbolwechsel übernehmen.
    setInterval(current.interval);
  } else {
    const fallback = {
      ...DEFAULT_CONFIG,
      symbol,
    };

    setConfig(fallback);
    setInterval(fallback.interval);
  }
}, [symbol]);

  useEffect(()=>{
    if(!priceHostRef.current||!macdHostRef.current) return;
    const priceChart=createChart(priceHostRef.current,{layout:{background:{color:"#070b16"},textColor:"#dbe4ff"},grid:{vertLines:{color:"#172033"},horzLines:{color:"#172033"}},crosshair:{mode:CrosshairMode.Normal},rightPriceScale:{borderColor:"#334155",minimumWidth:78},timeScale:{borderColor:"#334155",timeVisible:true},autoSize:true});
    const candleSeries=priceChart.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",wickUpColor:"#22c55e",wickDownColor:"#ef4444",borderVisible:false});
    const slowSeries=priceChart.addSeries(LineSeries,{lineWidth:2,color:"#3b82f6"});
    candleSeries.setData(visibleCandles as any);
    const smaPoints:{time:number;value:number}[]=[]; let sum=0; const len=Math.max(1,config.sma_slow);
    for(let i=0;i<candles.length;i+=1){sum+=candles[i].close;if(i>=len)sum-=candles[i-len].close;if(i>=len-1)smaPoints.push({time:candles[i].time,value:sum/len});}
    slowSeries.setData(smaPoints as any); priceChart.timeScale().fitContent();

    const macdChart=createChart(macdHostRef.current,{layout:{background:{color:"#070b16"},textColor:"#dbe4ff"},grid:{vertLines:{color:"#172033"},horzLines:{color:"#172033"}},crosshair:{mode:CrosshairMode.Normal},rightPriceScale:{borderColor:"#334155",minimumWidth:78},timeScale:{borderColor:"#334155",timeVisible:true},autoSize:true});
    const histSeries=macdChart.addSeries(HistogramSeries,{priceFormat:{type:"price",precision:4,minMove:0.0001}});
    const macdSeries=macdChart.addSeries(LineSeries,{lineWidth:2,color:"#60a5fa"});
    const signalSeries=macdChart.addSeries(LineSeries,{lineWidth:2,color:"#f59e0b"});
    const zeroSeries=macdChart.addSeries(LineSeries,{lineWidth:1,color:"#64748b"});
    const macd=calcMacd(candles,Math.max(1,config.macd_fast),Math.max(1,config.macd_slow),Math.max(1,config.macd_signal));
    histSeries.setData(macd.histogram.map((p)=>({...p,color:p.value>=0?"#22c55e":"#ef4444"})) as any);
    macdSeries.setData(macd.macd as any); signalSeries.setData(macd.signal as any); zeroSeries.setData(candles.map((c)=>({time:c.time,value:0})) as any); macdChart.timeScale().fitContent();
    let syncing=false;

priceChart.timeScale().subscribeVisibleLogicalRangeChange((range)=>{
  if(!range||syncing)return;
  syncing=true;
  macdChart.timeScale().setVisibleLogicalRange(range);
  syncing=false;
});

macdChart.timeScale().subscribeVisibleLogicalRangeChange((range)=>{
  if(!range||syncing)return;
  syncing=true;
  priceChart.timeScale().setVisibleLogicalRange(range);
  syncing=false;
});

const priceByTime=new Map(
  visibleCandles.map((c)=>[Number(c.time),Number(c.close)])
);

const macdByTime=new Map(
  macd.macd.map((p)=>[Number(p.time),Number(p.value)])
);

let crosshairSyncing=false;

priceChart.subscribeCrosshairMove((param)=>{
  if(crosshairSyncing)return;

  crosshairSyncing=true;

  if(param.time==null){
    macdChart.clearCrosshairPosition();
  }else{
    const value=macdByTime.get(Number(param.time));

    if(value!=null){
      macdChart.setCrosshairPosition(
        value,
        param.time,
        macdSeries
      );
    }
  }

  crosshairSyncing=false;
});

macdChart.subscribeCrosshairMove((param)=>{
  if(crosshairSyncing)return;

  crosshairSyncing=true;

  if(param.time==null){
    priceChart.clearCrosshairPosition();
  }else{
    const value=priceByTime.get(Number(param.time));

    if(value!=null){
      priceChart.setCrosshairPosition(
        value,
        param.time,
        candleSeries
      );
    }
  }

  crosshairSyncing=false;
});
    priceChartRef.current=priceChart; macdChartRef.current=macdChart;
    return()=>{priceChart.remove();macdChart.remove();priceChartRef.current=null;macdChartRef.current=null;};
  },[visibleCandles,candles,config.sma_slow,config.macd_fast,config.macd_slow,config.macd_signal]);

  async function loadAll(){setBusy(true);setStatus("Lade V5...");try{const[cfgJson,candleJson,stateJson]=await Promise.all([fetchJson(`${BACKEND_BASE}/v5/config?_ts=${Date.now()}`),fetchJson(`${BACKEND_BASE}/v5/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=1500&_ts=${Date.now()}`),fetchJson(`${BACKEND_BASE}/v5/state?symbol=${encodeURIComponent(symbol)}&_ts=${Date.now()}`)]);const map:ConfigMap={};for(const row of cfgJson.rows||[]){map[String(row.symbol).toUpperCase()]={...DEFAULT_CONFIG,...row,symbol:String(row.symbol).toUpperCase(),auto_enabled:Boolean(Number(row.auto_enabled))};}setConfigs(map);setCandles(Array.isArray(candleJson.candles)?candleJson.candles:[]);setSnapshot(stateJson.state||null);setStatus("V5 verbunden");}catch(error){setStatus(`Fehler: ${error instanceof Error?error.message:String(error)}`);}finally{setBusy(false);}}
  useEffect(()=>{loadAll();const timer=window.setInterval(async()=>{try{const[candleJson,stateJson]=await Promise.all([fetchJson(`${BACKEND_BASE}/v5/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=1500&_ts=${Date.now()}`),fetchJson(`${BACKEND_BASE}/v5/state?symbol=${encodeURIComponent(symbol)}&_ts=${Date.now()}`)]);setCandles(Array.isArray(candleJson.candles)?candleJson.candles:[]);setSnapshot(stateJson.state||null);}catch{}},5000);return()=>window.clearInterval(timer);},[symbol,interval]);

  async function saveConfig(next:V5Config=config){setBusy(true);try{const json=await fetchJson(`${BACKEND_BASE}/v5/config`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(next)});const saved={...DEFAULT_CONFIG,...json.row,auto_enabled:Boolean(Number(json.row.auto_enabled))};setConfig(saved);setConfigs((prev)=>({...prev,[saved.symbol]:saved}));setStatus(`${saved.symbol} gespeichert`);}catch(error){setStatus(`Speichern fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`);}finally{setBusy(false);}}
  async function manual(side:Side){setBusy(true);try{await fetchJson(`${BACKEND_BASE}/v5/manual`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,side})});setStatus(`${symbol}: ${side.toUpperCase()} gesendet`);}catch(error){setStatus(`Manuell fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`);}finally{setBusy(false);}}
  function patchConfig<K extends keyof V5Config>(key:K,value:V5Config[K]){setConfig((prev)=>({...prev,[key]:value}));}

  const panelRows=[['DNA',snapshot?.dna??'-'],['Action',snapshot?.action??'-'],['Regime',snapshot?.regime??'-'],['Regime Conf',snapshot?`${Math.round(snapshot.regime_confidence)}%`:'-'],['Phase',snapshot?.phase??'-'],['Phase Conf',snapshot?`${Math.round(snapshot.phase_confidence)}%`:'-'],['Direction',snapshot?.direction??'-'],['Trend',snapshot?.trend??'-'],['Momentum',snapshot?.momentum??'-'],['Energy',snapshot?.energy??'-'],['Volatility',snapshot?.volatility??'-'],['Compression',snapshot?.compression??'-'],['Structure',snapshot?.structure??'-'],['Balance',snapshot?.balance??'-'],['Trend Age',snapshot?.trend_age??'-'],['Pullback',snapshot?.pullback??'-'],['Exhaustion',snapshot?.exhaustion??'-']];

  return <div style={styles.page}>
    <header style={styles.header}><div><strong>QTrend V5</strong><span style={styles.muted}> Büro / Engine Cockpit</span></div><div style={styles.headerControls}>
      <select value={symbol} onChange={(e)=>setSymbol(e.target.value)} style={styles.input}>{SYMBOLS.map((s)=><option key={s}>{s}</option>)}</select>
     <select
  value={interval}
  onChange={(e) => {
    const next = e.target.value;

    const nextConfig = {
      ...config,
      interval: next,
    };

    setInterval(next);
    setConfig(nextConfig);

    setConfigs((previous) => ({
      ...previous,
      [symbol]: nextConfig,
    }));
  }}
  style={styles.input}
>
  {INTERVALS.map((tf) => (
    <option key={tf}>{tf}</option>
  ))}
</select>
      <button style={chartMode==='heikin'?styles.activeButton:styles.button} onClick={()=>setChartMode('heikin')}>Heikin</button>
      <button style={chartMode==='candles'?styles.activeButton:styles.button} onClick={()=>setChartMode('candles')}>Kerzen</button>
      <span style={styles.status}>{busy?'Bitte warten...':status}</span>
    </div></header>
    <main style={styles.layout}>
      <section style={styles.chartColumn}><div ref={priceHostRef} style={styles.priceChart}/><div ref={macdHostRef} style={styles.macdChart}/></section>
      <aside style={styles.sidePanel}>
        <div style={styles.card}><h3 style={styles.cardTitle}>Position</h3><div style={styles.positionGrid}><div>Engine</div><strong>{snapshot?.strategy_side?.toUpperCase()??'FLAT'}</strong><div>Broker</div><strong>{snapshot?.broker_side?.toUpperCase()??'FLAT'}</strong></div><button style={styles.flatButton} onClick={()=>manual('flat')}>Set FLAT</button><button style={styles.longButton} onClick={()=>manual('long')}>Set LONG</button><button style={styles.shortButton} onClick={()=>manual('short')}>Set SHORT</button></div>
        <div style={styles.card}><h3 style={styles.cardTitle}>Strategieparameter</h3>{([['Fast SMA','sma_fast'],['Slow SMA','sma_slow'],['ATR-Länge','atr_len'],['RSI Länge','rsi_len'],['MACD Fast','macd_fast'],['MACD Slow','macd_slow'],['MACD Signal','macd_signal']] as const).map(([label,key])=><label key={key} style={styles.field}><span>{label}</span><input type="number" min={1} value={config[key]} onChange={(e)=>patchConfig(key,Math.max(1,Number(e.target.value)||1))} style={styles.numberInput}/></label>)}<button style={styles.saveButton} onClick={()=>saveConfig()}>Parameter speichern</button></div>
        <div style={styles.card}><h3 style={styles.cardTitle}>Engine-Zustand</h3><div style={styles.infoTable}>{panelRows.map(([name,value])=><div key={String(name)} style={styles.infoRow}><span>{name}</span><strong>{String(value)}</strong></div>)}</div></div>
      </aside>
    </main>
    <section style={styles.sizeSection}><h3 style={styles.cardTitle}>Size Tabelle</h3><div style={styles.sizeTable}>{SYMBOLS.map((rowSymbol)=>{const row=configs[rowSymbol]||{...DEFAULT_CONFIG,symbol:rowSymbol};const enabled=Boolean(row.auto_enabled);return <div key={rowSymbol} style={styles.sizeRow}><strong>{rowSymbol}</strong><input type="number" step="any" value={row.size} onChange={(e)=>{const size=Number(e.target.value);setConfigs((prev)=>({...prev,[rowSymbol]:{...row,size:Number.isFinite(size)?size:0}}));}} style={styles.sizeInput}/><button style={styles.button} onClick={()=>saveConfig(configs[rowSymbol]||row)}>Save</button><button style={enabled?styles.autoOn:styles.autoOff} onClick={()=>{const next={...row,auto_enabled:!enabled};setConfigs((prev)=>({...prev,[rowSymbol]:next}));saveConfig(next);}}>AUTO {enabled?'ON':'OFF'}</button></div>;})}</div></section>
  </div>;
}

const styles:Record<string,React.CSSProperties>={page:{minHeight:'100vh',background:'#050914',color:'#eef2ff',fontFamily:'Inter,Arial,sans-serif'},header:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,padding:'10px 14px',borderBottom:'1px solid #243047',background:'#0a1020'},headerControls:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'},muted:{color:'#94a3b8',marginLeft:8},status:{color:'#93c5fd',fontSize:13,marginLeft:8},layout:{display:'grid',gridTemplateColumns:'minmax(0,1fr) 360px',gap:10,padding:10},chartColumn:{minWidth:0,display:'grid',gridTemplateRows:'minmax(460px,65vh) 240px',gap:8},priceChart:{width:'100%',minHeight:460,border:'1px solid #243047',borderRadius:10,overflow:'hidden'},macdChart:{width:'100%',minHeight:220,border:'1px solid #243047',borderRadius:10,overflow:'hidden'},sidePanel:{display:'flex',flexDirection:'column',gap:10},card:{background:'#0a1020',border:'1px solid #243047',borderRadius:10,padding:12},cardTitle:{margin:'0 0 10px',fontSize:17},positionGrid:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:12},input:{background:'#111a2e',color:'#eef2ff',border:'1px solid #334155',borderRadius:7,padding:'7px 9px'},numberInput:{width:90,background:'#111a2e',color:'#eef2ff',border:'1px solid #334155',borderRadius:7,padding:'7px 9px'},button:{background:'#334155',color:'#fff',border:0,borderRadius:7,padding:'8px 12px',cursor:'pointer'},activeButton:{background:'#2563eb',color:'#fff',border:0,borderRadius:7,padding:'8px 12px',cursor:'pointer'},flatButton:{width:'100%',background:'#991b1b',color:'#fff',border:'1px solid #ef4444',borderRadius:8,padding:11,marginBottom:8,fontWeight:800,cursor:'pointer'},longButton:{width:'100%',background:'#166534',color:'#fff',border:'1px solid #22c55e',borderRadius:8,padding:11,marginBottom:8,fontWeight:800,cursor:'pointer'},shortButton:{width:'100%',background:'#991b1b',color:'#fff',border:'1px solid #ef4444',borderRadius:8,padding:11,fontWeight:800,cursor:'pointer'},saveButton:{width:'100%',background:'#166534',color:'#fff',border:'1px solid #22c55e',borderRadius:8,padding:10,marginTop:10,fontWeight:800,cursor:'pointer'},field:{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',marginBottom:8},infoTable:{display:'grid',gap:4},infoRow:{display:'flex',justifyContent:'space-between',gap:12,padding:'4px 0',borderBottom:'1px solid #172033'},sizeSection:{margin:'0 10px 10px',background:'#0a1020',border:'1px solid #243047',borderRadius:10,padding:12},sizeTable:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(330px,1fr))',gap:6},sizeRow:{display:'grid',gridTemplateColumns:'90px 1fr 62px 100px',gap:7,alignItems:'center',borderBottom:'1px solid #172033',padding:'5px 0'},sizeInput:{minWidth:0,background:'#111a2e',color:'#eef2ff',border:'1px solid #334155',borderRadius:7,padding:'7px 9px'},autoOn:{background:'#166534',color:'#fff',border:'1px solid #22c55e',borderRadius:7,padding:'8px 7px',cursor:'pointer',fontWeight:800},autoOff:{background:'#991b1b',color:'#fff',border:'1px solid #ef4444',borderRadius:7,padding:'8px 7px',cursor:'pointer',fontWeight:800}};
