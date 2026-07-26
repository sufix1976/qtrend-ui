import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type Time,
} from "lightweight-charts";
import { useSharedMarket } from "./useSharedMarket";

const BACKEND_BASE =
  import.meta.env.VITE_BACKEND_BASE ||
  "https://qtrend-trading-engine.onrender.com";

type FamilyKey =
  |"current"
  |"macd"
  |"rsi"
  |"chaikin"
  |"ad"
  |"combo";

type ExitMetrics={
  trades:number;
  wins:number;
  losses:number;
  win_rate_pct:number;
  gross_profit:number;
  gross_loss:number;
  net:number;
  profit_factor:number;
  max_drawdown:number;
  exit_efficiency_pct:number;
  left_on_table:number;
  avg_hold_bars:number;
};

type ExitTrade={
  trade_no:number;
  direction:"long"|"short";
  entry_time:number;
  entry_price:number;
  exit_time:number;
  exit_price:number;
  pnl:number;
  mfe:number;
  capture_pct:number|null;
  left_on_table:number;
  hold_bars:number;
  reason:string;
  family:FamilyKey;
};

type FamilyResult={
  family:FamilyKey;
  trades:ExitTrade[];
  metrics:ExitMetrics;
};

const FAMILY_LABELS:Record<FamilyKey,string>={
  current:"AKTUELL",
  macd:"MACD",
  rsi:"RSI",
  chaikin:"CHAIKIN",
  ad:"AD",
  combo:"KOMBI 2/4",
};

async function fetchJson(url:string,init?:RequestInit){
  const response=await fetch(url,{cache:"no-store",...init});
  const text=await response.text();
  let data:any;
  try{data=JSON.parse(text);}catch{
    throw new Error(`Keine JSON-Antwort (${response.status})`);
  }
  if(!response.ok||data?.ok===false){
    throw new Error(data?.error||`HTTP ${response.status}`);
  }
  return data;
}

export default function ExitLab(){
  const market=useSharedMarket();
  const symbol=market.symbol;
  const interval=market.interval;

  const chartEl=useRef<HTMLDivElement|null>(null);
  const macdEl=useRef<HTMLDivElement|null>(null);
  const rsiEl=useRef<HTMLDivElement|null>(null);
  const chartRef=useRef<any>(null);
  const subChartsRef=useRef<any[]>([]);
  const candleSeries=useRef<any>(null);
  const markerApi=useRef<any>(null);
  const macdSeries=useRef<any>(null);
  const macdSignalSeries=useRef<any>(null);
  const macdHistSeries=useRef<any>(null);
  const rsiSeries=useRef<any>(null);
  const rsiSignalSeries=useRef<any>(null);

  const [profile,setProfile]=useState<any>(null);
  const [data,setData]=useState<any>(null);
  const [family,setFamily]=useState<FamilyKey>("current");
  const [limit,setLimit]=useState(5000);
  const [minHoldBars,setMinHoldBars]=useState(3);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("Exit Lab wird geladen …");
  const [selectedTrade,setSelectedTrade]=useState(0);

  useEffect(()=>{
    if(!chartEl.current||!macdEl.current||!rsiEl.current)return;
    const options=(height:number)=>({
      height,
      layout:{background:{color:"#08101d"},textColor:"#cbd5e1"},
      grid:{vertLines:{color:"#172033"},horzLines:{color:"#172033"}},
      timeScale:{timeVisible:true,secondsVisible:false},
      rightPriceScale:{borderColor:"#26344d"},
    });

    const chart=createChart(chartEl.current,options(520));
    const candles=chart.addSeries(CandlestickSeries,{});
    markerApi.current=createSeriesMarkers(candles,[]);

    const macdChart=createChart(macdEl.current,options(180));
    const macd=macdChart.addSeries(LineSeries,{lineWidth:2,title:"MACD"});
    const signal=macdChart.addSeries(LineSeries,{lineWidth:2,title:"Signal"});
    const histogram=macdChart.addSeries(HistogramSeries,{title:"Histogramm"});

    const rsiChart=createChart(rsiEl.current,options(165));
    const rsi=rsiChart.addSeries(LineSeries,{lineWidth:2,title:"RSI"});
    const rsiSignal=rsiChart.addSeries(LineSeries,{lineWidth:2,title:"RSI Signal"});

    chartRef.current=chart;
    subChartsRef.current=[macdChart,rsiChart];
    candleSeries.current=candles;
    macdSeries.current=macd;
    macdSignalSeries.current=signal;
    macdHistSeries.current=histogram;
    rsiSeries.current=rsi;
    rsiSignalSeries.current=rsiSignal;

    const charts=[chart,macdChart,rsiChart];
    let syncing=false;
    charts.forEach(source=>{
      source.timeScale().subscribeVisibleLogicalRangeChange((range:any)=>{
        if(!range||syncing)return;
        syncing=true;
        charts.forEach(target=>{
          if(target!==source)target.timeScale().setVisibleLogicalRange(range);
        });
        syncing=false;
      });
    });

    const resize=()=>{
      chart.applyOptions({width:chartEl.current?.clientWidth||900});
      macdChart.applyOptions({width:macdEl.current?.clientWidth||900});
      rsiChart.applyOptions({width:rsiEl.current?.clientWidth||900});
    };
    resize();
    window.addEventListener("resize",resize);
    return()=>{
      window.removeEventListener("resize",resize);
      charts.forEach(item=>item.remove());
    };
  },[]);

  useEffect(()=>{
    void loadProfileAndPreview();
  },[symbol,interval]);

  useEffect(()=>{
    if(!data)return;
    const candles=Array.isArray(data.candles)?data.candles:[];
    const indicators=data.indicators||{};
    candleSeries.current?.setData(candles.map((c:any)=>({
      time:Number(c.time) as Time,
      open:Number(c.open),
      high:Number(c.high),
      low:Number(c.low),
      close:Number(c.close),
    })));

    const times=candles.map((c:any)=>Number(c.time) as Time);
    const points=(values:any[],fallback=0)=>times.map((time:Time,index:number)=>({
      time,
      value:Number(values?.[index]??fallback),
    }));
    const histogram=(values:any[])=>times.map((time:Time,index:number)=>{
      const value=Number(values?.[index]??0);
      return {
        time,
        value,
        color:value>=0
          ?"rgba(34,197,94,.7)"
          :"rgba(239,68,68,.7)",
      };
    });

    macdSeries.current?.setData(points(indicators.macd||[]));
    macdSignalSeries.current?.setData(points(indicators.signal||[]));
    macdHistSeries.current?.setData(histogram(indicators.histogram||[]));
    rsiSeries.current?.setData(points(indicators.rsi||[],50));
    rsiSignalSeries.current?.setData(points(indicators.rsiSignal||[],50));

    const familyTrades:ExitTrade[]=data.families?.[family]?.trades||[];
    const markers:any[]=[];

    for(const trade of familyTrades){
      markers.push({
        time:trade.entry_time as Time,
        position:trade.direction==="long"?"belowBar":"aboveBar",
        color:trade.direction==="long"?"#22c55e":"#ef4444",
        shape:trade.direction==="long"?"arrowUp":"arrowDown",
        text:trade.direction==="long"?"LONG":"SHORT",
      });
      markers.push({
        time:trade.exit_time as Time,
        position:trade.direction==="long"?"aboveBar":"belowBar",
        color:family==="current"?"#facc15":"#a855f7",
        shape:"circle",
        text:`${FAMILY_LABELS[family]} ${trade.pnl>=0?"+":""}${trade.pnl.toFixed(1)}`,
      });
    }

    if(family!=="current"){
      const currentTrades:ExitTrade[]=data.families?.current?.trades||[];
      for(const trade of currentTrades){
        markers.push({
          time:trade.exit_time as Time,
          position:trade.direction==="long"?"aboveBar":"belowBar",
          color:"#facc15",
          shape:"square",
          text:"AKTUELL",
        });
      }
    }

    markers.sort((a,b)=>Number(a.time)-Number(b.time));
    markerApi.current?.setMarkers(markers);
    chartRef.current?.timeScale().fitContent();
    subChartsRef.current.forEach(chart=>chart.timeScale().fitContent());
  },[data,family]);

  async function loadProfileAndPreview(){
    try{
      setBusy(true);
      setStatus("Aktives Profil und eingefrorene Entries werden geladen …");
      const profiles=await fetchJson(
        `${BACKEND_BASE}/qmomentum/extreme-profiles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&_ts=${Date.now()}`
      );
      const params=profiles.active_params||profiles.profiles?.[0]?.params;
      if(!params)throw new Error("Kein Profil für Symbol/TF vorhanden");
      setProfile(params);
      await runPreview(params);
    }catch(error){
      setStatus(`Exit Lab Fehler: ${error instanceof Error?error.message:String(error)}`);
    }finally{
      setBusy(false);
    }
  }

  async function runPreview(params=profile){
    if(!params)return;
    try{
      setBusy(true);
      setStatus("Exitvarianten werden auf identischen Entries berechnet …");
      const result=await fetchJson(
        `${BACKEND_BASE}/qmomentum/exit-lab/preview`,
        {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            symbol,
            interval,
            params,
            limit,
            min_hold_bars:minHoldBars,
          }),
        }
      );
      setData(result);
      setSelectedTrade(0);
      setStatus(
        `${result.entries?.length||0} Entries eingefroren · ${result.candle_count} Kerzen · kein Liveeinfluss`
      );
    }catch(error){
      setStatus(`Exit-Vorschau fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`);
    }finally{
      setBusy(false);
    }
  }

  const result:FamilyResult|null=data?.families?.[family]||null;
  const current:FamilyResult|null=data?.families?.current||null;
  const trade=result?.trades?.[selectedTrade]||null;

  return <div style={page}>
    <div style={header}>
      <div>
        <div style={{fontSize:25,fontWeight:900}}>EXIT LAB V1</div>
        <div style={{fontSize:12,color:"#94a3b8"}}>
          {symbol} · {interval} · ENTRIES FIX · LAB ONLY
        </div>
      </div>
      <div style={safeBadge}>KEINE ORDERS · KEINE LIVEAKTIVIERUNG</div>
    </div>

    <div style={layout}>
      <main style={chartCard}>
        <div ref={chartEl} style={{width:"100%",height:520}}/>

        <div style={familyBar}>
          {(Object.keys(FAMILY_LABELS) as FamilyKey[]).map(key=>
            <button
              key={key}
              type="button"
              style={{
                ...familyButton,
                background:family===key?"#581c87":"#172033",
                borderColor:family===key?"#c084fc":"#334155",
                color:family===key?"#f3e8ff":"#94a3b8",
              }}
              onClick={()=>setFamily(key)}
            >
              {FAMILY_LABELS[key]}
            </button>
          )}
        </div>

        <Panel title={`MACD · ${profile?.macd_tf||interval}`}>
          <div ref={macdEl} style={{width:"100%",height:180}}/>
        </Panel>
        <Panel title={`RSI · ${profile?.rsi_tf||interval}`}>
          <div ref={rsiEl} style={{width:"100%",height:165}}/>
        </Panel>

        {result?<div style={metricsGrid}>
          <Metric label="PF" value={result.metrics.profit_factor.toFixed(2)}/>
          <Metric label="Netto" value={result.metrics.net.toFixed(1)}/>
          <Metric label="DD" value={result.metrics.max_drawdown.toFixed(1)}/>
          <Metric label="Effizienz" value={`${result.metrics.exit_efficiency_pct.toFixed(1)} %`}/>
          <Metric label="Liegen gelassen" value={result.metrics.left_on_table.toFixed(1)}/>
          <Metric label="Ø Haltedauer" value={`${result.metrics.avg_hold_bars.toFixed(1)} Bars`}/>
          <Metric label="Trades" value={String(result.metrics.trades)}/>
          <Metric label="Winrate" value={`${result.metrics.win_rate_pct.toFixed(1)} %`}/>
        </div>:null}
      </main>

      <aside style={side}>
        <Card title="AUSGANGSLAGE">
          <div style={smallText}>
            Das aktive Profil liefert ausschließlich die Entries. Alle Exitfamilien
            werden danach auf denselben Entry-Zeitpunkten verglichen.
          </div>
          <label style={field}>
            <span>Kerzen</span>
            <select
              style={input}
              value={limit}
              onChange={event=>setLimit(Number(event.target.value))}
            >
              {[1500,3000,5000,7500,10000].map(value=>
                <option key={value} value={value}>{value}</option>
              )}
            </select>
          </label>
          <label style={field}>
            <span>Mindesthaltezeit (Bars)</span>
            <input
              style={input}
              type="number"
              min={1}
              value={minHoldBars}
              onChange={event=>setMinHoldBars(Math.max(1,Number(event.target.value)||1))}
            />
          </label>
          <button
            style={primaryButton}
            disabled={busy}
            onClick={()=>void runPreview()}
          >
            {busy?"BERECHNET …":"EXIT-VARIANTEN NEU BERECHNEN"}
          </button>
        </Card>

        <Card title="EXIT-VERGLEICH">
          {(Object.keys(FAMILY_LABELS) as FamilyKey[]).map(key=>{
            const row:FamilyResult|undefined=data?.families?.[key];
            if(!row)return null;
            const delta=row.metrics.net-Number(current?.metrics.net||0);
            return <button
              key={key}
              type="button"
              style={{
                ...rankButton,
                borderColor:family===key?"#c084fc":"#26344d",
                background:family===key?"#2e1065":"#08101d",
              }}
              onClick={()=>setFamily(key)}
            >
              <div style={{display:"flex",justifyContent:"space-between",fontWeight:900}}>
                <span>{FAMILY_LABELS[key]}</span>
                <span>PF {row.metrics.profit_factor.toFixed(2)}</span>
              </div>
              <div style={{fontSize:10,color:"#94a3b8",marginTop:3}}>
                Netto {row.metrics.net.toFixed(1)} · Eff {row.metrics.exit_efficiency_pct.toFixed(1)} %
              </div>
              <div style={{
                fontSize:10,
                marginTop:2,
                color:delta>=0?"#86efac":"#fca5a5",
              }}>
                Δ zum aktuellen Exit {delta>=0?"+":""}{delta.toFixed(1)}
              </div>
            </button>;
          })}
        </Card>

        <Card title="TRADE-INSPEKTOR">
          <select
            style={input}
            value={selectedTrade}
            onChange={event=>setSelectedTrade(Number(event.target.value))}
          >
            {(result?.trades||[]).map((row,index)=>
              <option key={row.trade_no} value={index}>
                #{row.trade_no} · {row.direction.toUpperCase()} · {row.pnl>=0?"+":""}{row.pnl.toFixed(1)}
              </option>
            )}
          </select>

          {trade?<div style={{display:"grid",gap:6,marginTop:8}}>
            <Inspect label="Entry" value={`${trade.entry_price.toFixed(2)} · ${new Date(trade.entry_time*1000).toLocaleString("de-DE")}`}/>
            <Inspect label="Exit" value={`${trade.exit_price.toFixed(2)} · ${new Date(trade.exit_time*1000).toLocaleString("de-DE")}`}/>
            <Inspect label="P&L" value={`${trade.pnl>=0?"+":""}${trade.pnl.toFixed(2)}`}/>
            <Inspect label="MFE" value={trade.mfe.toFixed(2)}/>
            <Inspect label="Capture" value={trade.capture_pct==null?"–":`${trade.capture_pct.toFixed(1)} %`}/>
            <Inspect label="Liegen gelassen" value={trade.left_on_table.toFixed(2)}/>
            <Inspect label="Haltedauer" value={`${trade.hold_bars} Bars`}/>
            <Inspect label="Grund" value={trade.reason}/>
          </div>:null}
        </Card>

        <Card title="MARKER-LEGENDE">
          <div style={smallText}>
            Gelbes Quadrat = aktueller Exit<br/>
            Lila Kreis = ausgewählter Ghost-Exit<br/>
            Pfeil = eingefrorener Entry
          </div>
        </Card>
      </aside>
    </div>

    <div style={statusBar}>{status}</div>
  </div>;
}

function Card({title,children}:{title:string;children:any}){
  return <section style={card}>
    <div style={cardTitle}>{title}</div>
    {children}
  </section>;
}
function Panel({title,children}:{title:string;children:any}){
  return <div style={panel}>
    <div style={panelTitle}>{title}</div>
    {children}
  </div>;
}
function Metric({label,value}:{label:string;value:string}){
  return <div style={metric}>
    <div style={{fontSize:9,color:"#64748b"}}>{label}</div>
    <b>{value}</b>
  </div>;
}
function Inspect({label,value}:{label:string;value:string}){
  return <div style={{
    display:"grid",
    gridTemplateColumns:"90px minmax(0,1fr)",
    gap:6,
    fontSize:10,
  }}>
    <b style={{color:"#94a3b8"}}>{label}</b>
    <span style={{color:"#e2e8f0",wordBreak:"break-word"}}>{value}</span>
  </div>;
}

const page:CSSProperties={
  minHeight:"100vh",
  background:"#050914",
  color:"#eef2ff",
  padding:10,
  fontFamily:"Inter,Arial,sans-serif",
  boxSizing:"border-box",
};
const header:CSSProperties={
  display:"flex",
  justifyContent:"space-between",
  alignItems:"center",
  gap:10,
  marginBottom:10,
};
const safeBadge:CSSProperties={
  border:"1px solid #22c55e",
  background:"#052e16",
  color:"#bbf7d0",
  borderRadius:999,
  padding:"8px 11px",
  fontSize:10,
  fontWeight:900,
};
const layout:CSSProperties={
  display:"grid",
  gridTemplateColumns:"minmax(0,1fr) 350px",
  gap:10,
  alignItems:"start",
};
const chartCard:CSSProperties={
  background:"#0b1220",
  border:"1px solid #26344d",
  borderRadius:11,
  padding:8,
  minWidth:0,
};
const side:CSSProperties={display:"grid",gap:9};
const card:CSSProperties={
  background:"#0b1220",
  border:"1px solid #26344d",
  borderRadius:9,
  padding:10,
};
const cardTitle:CSSProperties={
  fontSize:10,
  color:"#c084fc",
  fontWeight:900,
  marginBottom:8,
  letterSpacing:.4,
};
const familyBar:CSSProperties={
  display:"flex",
  gap:5,
  flexWrap:"wrap",
  marginTop:7,
  padding:"7px 8px",
  background:"#08101d",
  border:"1px solid #26344d",
  borderRadius:8,
};
const familyButton:CSSProperties={
  padding:"6px 9px",
  border:"1px solid",
  borderRadius:7,
  fontSize:10,
  fontWeight:900,
  cursor:"pointer",
};
const panel:CSSProperties={
  marginTop:7,
  background:"#08101d",
  border:"1px solid #26344d",
  borderRadius:8,
  overflow:"hidden",
};
const panelTitle:CSSProperties={
  padding:"6px 9px",
  fontSize:10,
  color:"#94a3b8",
  fontWeight:900,
  borderBottom:"1px solid #172033",
};
const metricsGrid:CSSProperties={
  display:"grid",
  gridTemplateColumns:"repeat(8,minmax(85px,1fr))",
  gap:6,
  marginTop:8,
  overflowX:"auto",
};
const metric:CSSProperties={
  background:"#08101d",
  border:"1px solid #26344d",
  borderRadius:7,
  padding:7,
  textAlign:"center",
};
const field:CSSProperties={
  display:"grid",
  gap:4,
  marginTop:8,
  fontSize:10,
  color:"#94a3b8",
};
const input:CSSProperties={
  width:"100%",
  boxSizing:"border-box",
  background:"#08101d",
  color:"#f8fafc",
  border:"1px solid #334155",
  borderRadius:7,
  padding:"7px 8px",
};
const primaryButton:CSSProperties={
  width:"100%",
  marginTop:8,
  padding:"9px 10px",
  borderRadius:8,
  border:"1px solid #c084fc",
  background:"#581c87",
  color:"#f3e8ff",
  fontWeight:900,
  cursor:"pointer",
};
const rankButton:CSSProperties={
  width:"100%",
  textAlign:"left",
  border:"1px solid",
  borderRadius:7,
  padding:"7px 8px",
  color:"#e2e8f0",
  cursor:"pointer",
  marginTop:5,
};
const smallText:CSSProperties={
  fontSize:10,
  color:"#94a3b8",
  lineHeight:1.45,
};
const statusBar:CSSProperties={
  marginTop:10,
  background:"#08101d",
  border:"1px solid #26344d",
  borderRadius:8,
  padding:"9px 10px",
  color:"#cbd5e1",
  fontSize:11,
};
