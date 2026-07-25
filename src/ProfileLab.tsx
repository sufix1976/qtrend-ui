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

const LAB_HANDOFF_KEY = "qtrend_profile_lab_handoff_v1";

type Params = {
  macd_fast:number;
  macd_slow:number;
  macd_signal:number;
  rsi_length:number;
  rsi_signal:number;
  long_zone_sigma:number;
  short_zone_sigma:number;
  z_window:number;
  protect_min_hold_bars:number;
  exit_htf_minutes:number;
  exit_timing_minutes:number;
  exit_rsi_lower:number;
  exit_rsi_upper:number;
  strategy_mode:"basis"|"basis_ad"|"basis_chaikin";
  trend_filter_mode:"none"|"ad"|"chaikin";
  trend_sigma_abs:number;
  ad_length:number;
  chaikin_fast:number;
  chaikin_slow:number;
};

type Ratings = {
  trend:number;
  entry:number;
  exit:number;
  calm:number;
  sideways:number;
  overall:number;
};

const DEFAULT_PARAMS:Params = {
  macd_fast:10,
  macd_slow:20,
  macd_signal:9,
  rsi_length:14,
  rsi_signal:9,
  long_zone_sigma:-1.5,
  short_zone_sigma:1.5,
  z_window:200,
  protect_min_hold_bars:3,
  exit_htf_minutes:240,
  exit_timing_minutes:15,
  exit_rsi_lower:30,
  exit_rsi_upper:70,
  strategy_mode:"basis",
  trend_filter_mode:"none",
  trend_sigma_abs:0,
  ad_length:11,
  chaikin_fast:3,
  chaikin_slow:10,
};

const DEFAULT_RATINGS:Ratings = {
  trend:3,
  entry:3,
  exit:3,
  calm:3,
  sideways:3,
  overall:3,
};

async function fetchJson(url:string, init?:RequestInit){
  const response=await fetch(url,{cache:"no-store",...init});
  const text=await response.text();
  let data:any;
  try{data=JSON.parse(text);}catch{throw new Error(`Keine JSON-Antwort (${response.status})`);}
  if(!response.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${response.status}`);
  return data;
}

function navigate(view:string){
  const url=new URL(window.location.href);
  url.searchParams.set("view",view);
  window.history.pushState({},"",url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function ProfileLab(){
  const market=useSharedMarket();
  const symbol=market.symbol;
  const interval=market.interval;

  const chartEl=useRef<HTMLDivElement|null>(null);
  const macdEl=useRef<HTMLDivElement|null>(null);
  const rsiEl=useRef<HTMLDivElement|null>(null);
  const chaikinEl=useRef<HTMLDivElement|null>(null);
  const adEl=useRef<HTMLDivElement|null>(null);

  const chartRef=useRef<any>(null);
  const indicatorChartsRef=useRef<any[]>([]);
  const candleSeries=useRef<any>(null);
  const markerApi=useRef<any>(null);

  const macdLineSeries=useRef<any>(null);
  const macdSignalSeries=useRef<any>(null);
  const macdHistogramSeries=useRef<any>(null);

  const rsiLineSeries=useRef<any>(null);
  const rsiSignalSeries=useRef<any>(null);
  const rsi30Series=useRef<any>(null);
  const rsi50Series=useRef<any>(null);
  const rsi70Series=useRef<any>(null);

  const chaikinLineSeries=useRef<any>(null);
  const chaikinHistogramSeries=useRef<any>(null);
  const chaikinZeroSeries=useRef<any>(null);

  const adLineSeries=useRef<any>(null);
  const adSignalSeries=useRef<any>(null);
  const adZeroSeries=useRef<any>(null);

  const [params,setParams]=useState<Params>(DEFAULT_PARAMS);
  const [baseline,setBaseline]=useState<Params>(DEFAULT_PARAMS);
  const [preview,setPreview]=useState<any>(null);
  const [profiles,setProfiles]=useState<any[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [activeParams,setActiveParams]=useState<any>(null);
  const [profileName,setProfileName]=useState("");
  const [note,setNote]=useState("");
  const [ratings,setRatings]=useState<Ratings>(DEFAULT_RATINGS);
  const [busy,setBusy]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [status,setStatus]=useState("Profile Lab wird geladen …");
  const [panels,setPanels]=useState({
    macd:true,
    rsi:true,
    chaikin:true,
    ad:true,
  });

  useEffect(()=>{
    if(
      !chartEl.current||
      !macdEl.current||
      !rsiEl.current||
      !chaikinEl.current||
      !adEl.current
    )return;

    const baseOptions=(height:number)=>({
      height,
      layout:{background:{color:"#08101d"},textColor:"#cbd5e1"},
      grid:{vertLines:{color:"#172033"},horzLines:{color:"#172033"}},
      timeScale:{timeVisible:true,secondsVisible:false},
      rightPriceScale:{borderColor:"#26344d"},
    });

    const chart=createChart(chartEl.current,baseOptions(470));
    const candles=chart.addSeries(CandlestickSeries,{});
    markerApi.current=createSeriesMarkers(candles,[]);

    const macdChart=createChart(macdEl.current,baseOptions(190));
    const macdLine=macdChart.addSeries(LineSeries,{lineWidth:2,title:"MACD"});
    const macdSignal=macdChart.addSeries(LineSeries,{lineWidth:2,title:"Signal"});
    const macdHistogram=macdChart.addSeries(HistogramSeries,{title:"Histogramm"});

    const rsiChart=createChart(rsiEl.current,baseOptions(175));
    const rsiLine=rsiChart.addSeries(LineSeries,{lineWidth:2,title:"RSI"});
    const rsiSignal=rsiChart.addSeries(LineSeries,{lineWidth:2,title:"RSI Signal"});
    const rsi30=rsiChart.addSeries(LineSeries,{lineWidth:1,title:"30",lineStyle:2});
    const rsi50=rsiChart.addSeries(LineSeries,{lineWidth:1,title:"50",lineStyle:2});
    const rsi70=rsiChart.addSeries(LineSeries,{lineWidth:1,title:"70",lineStyle:2});

    const chaikinChart=createChart(chaikinEl.current,baseOptions(175));
    const chaikinLine=chaikinChart.addSeries(LineSeries,{lineWidth:2,title:"Chaikin"});
    const chaikinHistogram=chaikinChart.addSeries(HistogramSeries,{title:"Chaikin Histogramm"});
    const chaikinZero=chaikinChart.addSeries(LineSeries,{lineWidth:1,title:"Null",lineStyle:2});

    const adChart=createChart(adEl.current,baseOptions(175));
    const adLine=adChart.addSeries(LineSeries,{lineWidth:2,title:"AD Ratio"});
    const adSignal=adChart.addSeries(LineSeries,{lineWidth:2,title:"AD Glättung"});
    const adZero=adChart.addSeries(LineSeries,{lineWidth:1,title:"Neutral 1.0",lineStyle:2});

    chartRef.current=chart;
    indicatorChartsRef.current=[macdChart,rsiChart,chaikinChart,adChart];
    candleSeries.current=candles;

    macdLineSeries.current=macdLine;
    macdSignalSeries.current=macdSignal;
    macdHistogramSeries.current=macdHistogram;

    rsiLineSeries.current=rsiLine;
    rsiSignalSeries.current=rsiSignal;
    rsi30Series.current=rsi30;
    rsi50Series.current=rsi50;
    rsi70Series.current=rsi70;

    chaikinLineSeries.current=chaikinLine;
    chaikinHistogramSeries.current=chaikinHistogram;
    chaikinZeroSeries.current=chaikinZero;

    adLineSeries.current=adLine;
    adSignalSeries.current=adSignal;
    adZeroSeries.current=adZero;

    const charts=[chart,macdChart,rsiChart,chaikinChart,adChart];
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
      chart.applyOptions({width:chartEl.current?.clientWidth||800});
      macdChart.applyOptions({width:macdEl.current?.clientWidth||800});
      rsiChart.applyOptions({width:rsiEl.current?.clientWidth||800});
      chaikinChart.applyOptions({width:chaikinEl.current?.clientWidth||800});
      adChart.applyOptions({width:adEl.current?.clientWidth||800});
    };
    resize();
    window.addEventListener("resize",resize);

    return()=>{
      window.removeEventListener("resize",resize);
      charts.forEach(item=>item.remove());
      indicatorChartsRef.current=[];
    };
  },[]);
  useEffect(()=>{
    if(!preview)return;

    const candles=Array.isArray(preview.candles)?preview.candles:[];
    const indicator=preview.indicators||{};
    const times:Time[]=candles.map((candle:any)=>Number(candle.time) as Time);

    candleSeries.current?.setData(candles.map((c:any)=>({
      time:c.time as Time,
      open:Number(c.open),
      high:Number(c.high),
      low:Number(c.low),
      close:Number(c.close),
    })));

    const points=(values:any[],fallback=0)=>times.map((time:Time,index:number)=>({
      time,
      value:Number(values?.[index]??fallback),
    }));

    const histogramPoints=(values:any[])=>times.map((time:Time,index:number)=>{
      const value=Number(values?.[index]??0);
      return {
        time,
        value,
        color:value>=0
          ?"rgba(34,197,94,.72)"
          :"rgba(239,68,68,.72)",
      };
    });

    const macdValues=Array.isArray(indicator.macd)?indicator.macd:[];
    const signalValues=Array.isArray(indicator.signal)?indicator.signal:[];
    const histogramValues=Array.isArray(indicator.histogram)?indicator.histogram:[];
    macdLineSeries.current?.setData(points(macdValues));
    macdSignalSeries.current?.setData(points(signalValues));
    macdHistogramSeries.current?.setData(histogramPoints(histogramValues));

    const rsiValues=Array.isArray(indicator.rsi)?indicator.rsi:[];
    const rsiSignalValues=Array.isArray(indicator.rsiSignal)?indicator.rsiSignal:[];
    rsiLineSeries.current?.setData(points(rsiValues,50));
    rsiSignalSeries.current?.setData(points(rsiSignalValues,50));
    rsi30Series.current?.setData(times.map((time:Time)=>({time,value:30})));
    rsi50Series.current?.setData(times.map((time:Time)=>({time,value:50})));
    rsi70Series.current?.setData(times.map((time:Time)=>({time,value:70})));

    const chaikinValues=Array.isArray(indicator.chaikin)?indicator.chaikin:[];
    chaikinLineSeries.current?.setData(points(chaikinValues));
    chaikinHistogramSeries.current?.setData(histogramPoints(chaikinValues));
    chaikinZeroSeries.current?.setData(times.map((time:Time)=>({time,value:0})));

    const adValues=Array.isArray(indicator.adRatio)?indicator.adRatio:[];
    const adSmooth=adValues.map((_:number,index:number)=>{
      const length=Math.max(2,Math.floor(Number(params.ad_length||11)));
      const from=Math.max(0,index-length+1);
      const slice=adValues.slice(from,index+1).map(Number);
      return slice.length
        ?slice.reduce((sum:number,value:number)=>sum+value,0)/slice.length
        :1;
    });
    adLineSeries.current?.setData(points(adValues,1));
    adSignalSeries.current?.setData(points(adSmooth,1));
    adZeroSeries.current?.setData(times.map((time:Time)=>({time,value:1})));

    const markers=(Array.isArray(preview.events)?preview.events:[])
      .filter((event:any)=>event.type==="entry"||event.type==="exit")
      .map((event:any)=>event.type==="entry"?{
        time:event.time as Time,
        position:event.direction==="long"?"belowBar":"aboveBar",
        color:event.direction==="long"?"#22c55e":"#ef4444",
        shape:event.direction==="long"?"arrowUp":"arrowDown",
        text:event.direction==="long"?"LONG":"SHORT",
      }:{
        time:event.time as Time,
        position:"aboveBar",
        color:"#facc15",
        shape:"circle",
        text:"EXIT",
      })
      .sort((a:any,b:any)=>Number(a.time)-Number(b.time));

    markerApi.current?.setMarkers(markers);
    chartRef.current?.timeScale().fitContent();
    indicatorChartsRef.current.forEach(chart=>chart.timeScale().fitContent());
  },[preview,params.ad_length]);
  useEffect(()=>{
    void loadProfiles();
  },[symbol,interval]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>void runPreview(false),450);
    return()=>window.clearTimeout(timer);
  },[params,symbol,interval]);

  async function loadProfiles(){
    try{
      setStatus("Profile werden geladen …");
      const data=await fetchJson(
        `${BACKEND_BASE}/qmomentum/extreme-profiles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&_ts=${Date.now()}`
      );
      const list=Array.isArray(data.profiles)?data.profiles:[];
      setProfiles(list);
      setActiveParams(data.active_params||null);

      const next={
        ...DEFAULT_PARAMS,
        ...(data.active_params||list[0]?.params||{}),
      };

      setParams(next);
      setBaseline(next);
      setDirty(false);
      setSelectedId(list[0]?.id||"");
      setProfileName(`${symbol} ${interval} · Manuell`);
      setStatus(data.active_params
        ?"Aktives Profil geladen"
        :"Kein aktives Profil – Standardwerte geladen"
      );
    }catch(error){
      setStatus(`Laden fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`);
    }
  }

  async function runPreview(showStatus=true){
    try{
      setBusy(true);
      if(showStatus)setStatus("Temporäre Vorschau wird berechnet …");

      const data=await fetchJson(`${BACKEND_BASE}/qmomentum/profile-lab/preview`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({symbol,interval,params,limit:1500}),
      });

      setPreview(data);
      setDirty(JSON.stringify(params)!==JSON.stringify(baseline));

      if(showStatus){
        setStatus("Vorschau aktualisiert · nicht gespeichert · kein Handel");
      }
    }catch(error){
      setStatus(`Vorschau fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`);
    }finally{
      setBusy(false);
    }
  }

  function loadProfile(profile:any){
    const next={...DEFAULT_PARAMS,...profile.params};
    setParams(next);
    setBaseline(next);
    setSelectedId(profile.id);
    setProfileName(`${profile.name} · Kopie`);
    setNote(profile.note||"");
    setDirty(false);
    setStatus(`Profil "${profile.name}" temporär geladen`);
  }

  function loadActive(){
    const next={...DEFAULT_PARAMS,...(activeParams||DEFAULT_PARAMS)};
    setParams(next);
    setBaseline(next);
    setSelectedId("");
    setProfileName(`${symbol} ${interval} · Aktiv-Kopie`);
    setDirty(false);
    setStatus("Aktives Profil als temporäre Arbeitskopie geladen");
  }

  function openInCockpit(){
    const payload={
      version:1,
      symbol,
      interval,
      params,
      created_at:new Date().toISOString(),
      source:"PROFILE_LAB_V1",
    };
    localStorage.setItem(LAB_HANDOFF_KEY,JSON.stringify(payload));
    setStatus("Temporäre Lab-Parameter an Cockpit übergeben");
    navigate("cockpit");
  }

  async function saveManual(activate=false){
    try{
      setBusy(true);
      const name=profileName.trim()||`${symbol} ${interval} · Manuell`;

      const result={
        source:"PROFILE_LAB_V1",
        manual_ratings:ratings,
        best:{
          params,
          metrics:preview?.metrics||{},
        },
        mirror_meta:preview?.mirror_meta||null,
      };

      const saved=await fetchJson(`${BACKEND_BASE}/qmomentum/extreme-profiles`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          symbol,
          interval,
          name,
          params,
          result,
          note,
          activate,
        }),
      });

      setBaseline({...params});
      setDirty(false);
      setStatus(activate
        ?`Profil "${name}" gespeichert und aktiviert · keine sofortige Order`
        :`Profil "${name}" gespeichert · noch nicht aktiv`
      );

      await loadProfiles();
      if(saved?.id)setSelectedId(saved.id);
    }catch(error){
      setStatus(`Speichern fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`);
    }finally{
      setBusy(false);
    }
  }

  async function activateSelected(){
    const profile=profiles.find(row=>row.id===selectedId);
    if(!profile){
      setStatus("Bitte ein gespeichertes Profil auswählen");
      return;
    }

    try{
      setBusy(true);
      const data=await fetchJson(`${BACKEND_BASE}/qmomentum/extreme-profiles/activate`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:profile.id}),
      });

      setActiveParams(data.profile.params);
      setStatus(`"${profile.name}" aktiviert · gilt erst für neue Systemevents`);
      await loadProfiles();
    }catch(error){
      setStatus(`Aktivieren fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`);
    }finally{
      setBusy(false);
    }
  }

  function setField<K extends keyof Params>(key:K,value:Params[K]){
    setParams(previous=>({...previous,[key]:value}));
  }

  const chosen=profiles.find(row=>row.id===selectedId)||null;
  const metrics=preview?.metrics||{};
  const strategyLabel=params.strategy_mode==="basis_chaikin"
    ?"Basis + Chaikin"
    :params.strategy_mode==="basis_ad"
    ?"Basis + HA-AD"
    :"Basis V8.5";

  const inputField=(key:keyof Params,label:string,step="1")=>(
    <label style={fieldStyle}>
      <span>{label}</span>
      <input
        style={inputStyle}
        type="number"
        step={step}
        value={Number(params[key])}
        onChange={event=>setField(key,Number(event.target.value) as any)}
      />
    </label>
  );

  return <div style={page}>
    <div style={topbar}>
      <div>
        <div style={{fontSize:24,fontWeight:900}}>PROFILE LAB V1.1</div>
        <div style={{color:"#94a3b8",fontSize:12}}>
          {symbol} · {interval} · {strategyLabel}
        </div>
      </div>

      <div style={{
        ...badge,
        background:dirty?"#78350f":"#0f3d2e",
        color:dirty?"#fde68a":"#86efac",
        borderColor:dirty?"#d97706":"#16a34a",
      }}>
        {dirty
          ?"TEMPORÄR · NICHT GESPEICHERT"
          :"ARBEITSSTAND GESPEICHERT"
        }
      </div>
    </div>

    <div style={mainGrid}>
      <section style={chartCard}>
        <div ref={chartEl} style={{width:"100%",height:470}}/>

        <div style={panelToolbar}>
          <span style={{fontSize:11,fontWeight:900,color:"#93c5fd"}}>INDIKATOREN</span>
          {([
            ["macd","MACD"],
            ["rsi","RSI"],
            ["chaikin","CHAIKIN"],
            ["ad","AD"],
          ] as const).map(([key,label])=>
            <button
              key={key}
              type="button"
              style={{
                ...panelToggle,
                background:panels[key]?"#164e63":"#172033",
                borderColor:panels[key]?"#22d3ee":"#334155",
                color:panels[key]?"#cffafe":"#94a3b8",
              }}
              onClick={()=>setPanels(previous=>({
                ...previous,
                [key]:!previous[key],
              }))}
            >
              {panels[key]?"✓ ":""}{label}
            </button>
          )}
        </div>

        <IndicatorPanel
          title={`MACD · ${params.macd_fast}/${params.macd_slow}/${params.macd_signal}`}
          visible={panels.macd}
          containerRef={macdEl}
          height={190}
        />
        <IndicatorPanel
          title={`RSI · Länge ${params.rsi_length} · Signal ${params.rsi_signal} · 30 / 50 / 70`}
          visible={panels.rsi}
          containerRef={rsiEl}
          height={175}
        />
        <IndicatorPanel
          title={`CHAIKIN · ${params.chaikin_fast}/${params.chaikin_slow} · Nulllinie`}
          visible={panels.chaikin}
          containerRef={chaikinEl}
          height={175}
        />
        <IndicatorPanel
          title={`AD RATIO · Länge ${params.ad_length} · Linie + Glättung · Neutral 1.0`}
          visible={panels.ad}
          containerRef={adEl}
          height={175}
        />

        <div style={metricsGrid}>
          <Metric label="PF" value={Number(metrics.profit_factor||0).toFixed(2)}/>
          <Metric label="Netto" value={Number(metrics.net||0).toFixed(1)}/>
          <Metric label="DD" value={Number(metrics.max_drawdown||0).toFixed(1)}/>
          <Metric label="Trades" value={String(metrics.trades??0)}/>
          <Metric label="Winrate" value={`${Number(metrics.win_rate_pct||0).toFixed(1)} %`}/>
        </div>

        <div style={{fontSize:11,color:"#64748b",marginTop:7}}>
          Kennzahlen dienen nur als Information. Die Bewertung erfolgt bewusst nach Chartbild.
        </div>
      </section>

      <aside style={side}>
        <Card title="AUSGANGSPUNKT">
          <select
            style={selectStyle}
            value={selectedId}
            onChange={event=>setSelectedId(event.target.value)}
          >
            <option value="">Profil auswählen …</option>
            {profiles.map(row=>
              <option key={row.id} value={row.id}>{row.name}</option>
            )}
          </select>

          <div style={buttonGrid}>
            <button style={secondaryButton} onClick={()=>chosen&&loadProfile(chosen)}>
              PROFIL LADEN
            </button>
            <button style={secondaryButton} onClick={loadActive}>
              AKTIVES LADEN
            </button>
          </div>

          <button
            style={primaryButton}
            disabled={busy}
            onClick={()=>void runPreview(true)}
          >
            {busy?"BERECHNET …":"VORSCHAU NEU BERECHNEN"}
          </button>

          <button
            style={cockpitButton}
            disabled={busy}
            onClick={openInCockpit}
          >
            IM COCKPIT VERGLEICHEN
          </button>

          <div style={{fontSize:10,color:"#64748b",marginTop:6}}>
            Übergibt nur die temporäre Ansicht. Das aktive Handelsprofil bleibt unverändert.
          </div>
        </Card>

        <Card title="STRATEGIE">
          <select
            style={selectStyle}
            value={params.strategy_mode}
            onChange={event=>{
              const mode=event.target.value as Params["strategy_mode"];
              setParams(previous=>({
                ...previous,
                strategy_mode:mode,
                trend_filter_mode:
                  mode==="basis_ad"
                    ?"ad"
                    :mode==="basis_chaikin"
                    ?"chaikin"
                    :"none",
              }));
            }}
          >
            <option value="basis">Basis V8.5</option>
            <option value="basis_ad">Basis + HA-AD</option>
            <option value="basis_chaikin">Basis + Chaikin</option>
          </select>
        </Card>

        <Card title="FLOW · AD + CHAIKIN">
          <div style={twoCols}>
            {inputField("ad_length","AD Länge")}
            {inputField("chaikin_fast","Chaikin Fast")}
            {inputField("chaikin_slow","Chaikin Slow")}
            {inputField("trend_sigma_abs","Trend Sigma","0.05")}
          </div>

          <select
            style={{...selectStyle,marginTop:8}}
            value={params.trend_filter_mode}
            onChange={event=>setField(
              "trend_filter_mode",
              event.target.value as Params["trend_filter_mode"]
            )}
          >
            <option value="none">Kein Flow-Filter</option>
            <option value="ad">AD Trendpfad</option>
            <option value="chaikin">Chaikin Trendpfad</option>
          </select>
        </Card>

        <Card title="MOMENTUM / ENTRY">
          <div style={twoCols}>
            {inputField("macd_fast","MACD Fast")}
            {inputField("macd_slow","MACD Slow")}
            {inputField("macd_signal","MACD Signal")}
            {inputField("rsi_length","RSI Länge")}
            {inputField("rsi_signal","RSI Signal")}
            {inputField("z_window","Z Window")}
            {inputField("long_zone_sigma","Long Sigma","0.1")}
            {inputField("short_zone_sigma","Short Sigma","0.1")}
          </div>
        </Card>

        <Card title="EXIT">
          <div style={twoCols}>
            {inputField("exit_htf_minutes","Armed TF")}
            {inputField("exit_timing_minutes","Timing TF")}
            {inputField("exit_rsi_lower","RSI unten")}
            {inputField("exit_rsi_upper","RSI oben")}
            {inputField("protect_min_hold_bars","Min Hold")}
          </div>
        </Card>

        <Card title="VISUELLE BEWERTUNG">
          <Rating label="Trendqualität" value={ratings.trend} onChange={value=>setRatings(r=>({...r,trend:value}))}/>
          <Rating label="Entry" value={ratings.entry} onChange={value=>setRatings(r=>({...r,entry:value}))}/>
          <Rating label="Exit" value={ratings.exit} onChange={value=>setRatings(r=>({...r,exit:value}))}/>
          <Rating label="Ruhe" value={ratings.calm} onChange={value=>setRatings(r=>({...r,calm:value}))}/>
          <Rating label="Seitwärts" value={ratings.sideways} onChange={value=>setRatings(r=>({...r,sideways:value}))}/>
          <Rating label="Gesamteindruck" value={ratings.overall} onChange={value=>setRatings(r=>({...r,overall:value}))}/>
        </Card>

        <Card title="MANUELLES PROFIL">
          <input
            style={inputStyle}
            value={profileName}
            onChange={event=>setProfileName(event.target.value)}
            placeholder="Profilname"
          />

          <textarea
            style={{...inputStyle,minHeight:76,marginTop:7,resize:"vertical"}}
            value={note}
            onChange={event=>setNote(event.target.value)}
            placeholder="Notiz zum Chartbild"
          />

          <div style={buttonGrid}>
            <button style={secondaryButton} disabled={busy} onClick={()=>void saveManual(false)}>
              NUR SPEICHERN
            </button>
            <button style={activateButton} disabled={busy} onClick={()=>void saveManual(true)}>
              SPEICHERN + AKTIVIEREN
            </button>
          </div>

          <button
            style={activateButton}
            disabled={busy||!selectedId}
            onClick={()=>void activateSelected()}
          >
            AUSGEWÄHLTES PROFIL AKTIVIEREN
          </button>

          <div style={{fontSize:10,color:"#64748b",marginTop:7}}>
            Aktivieren erzeugt keine sofortige Order. Das Profil gilt erst für neue Systemevents.
          </div>
        </Card>
      </aside>
    </div>

    <div style={statusBar}>{status}</div>
  </div>;
}

function IndicatorPanel({
  title,
  visible,
  containerRef,
  height,
}:{
  title:string;
  visible:boolean;
  containerRef:{current:HTMLDivElement|null};
  height:number;
}){
  return <div style={{
    display:visible?"block":"none",
    marginTop:7,
    border:"1px solid #26344d",
    borderRadius:8,
    overflow:"hidden",
    background:"#08101d",
  }}>
    <div style={{
      padding:"6px 9px",
      fontSize:10,
      fontWeight:900,
      color:"#94a3b8",
      borderBottom:"1px solid #172033",
    }}>
      {title}
    </div>
    <div ref={containerRef} style={{width:"100%",height}}/>
  </div>;
}

function Card({title,children}:{title:string;children:any}){
  return <section style={card}>
    <div style={cardTitle}>{title}</div>
    {children}
  </section>;
}

function Metric({label,value}:{label:string;value:string}){
  return <div style={metric}>
    <div style={{fontSize:10,color:"#64748b"}}>{label}</div>
    <b>{value}</b>
  </div>;
}

function Rating({
  label,
  value,
  onChange,
}:{
  label:string;
  value:number;
  onChange:(value:number)=>void;
}){
  return <div style={{
    display:"flex",
    justifyContent:"space-between",
    alignItems:"center",
    gap:8,
    padding:"4px 0",
  }}>
    <span style={{fontSize:11,color:"#cbd5e1"}}>{label}</span>

    <div>
      {[1,2,3,4,5].map(star=>
        <button
          key={star}
          type="button"
          onClick={()=>onChange(star)}
          style={{
            border:0,
            background:"transparent",
            color:star<=value?"#facc15":"#475569",
            fontSize:17,
            cursor:"pointer",
            padding:1,
          }}
        >
          ★
        </button>
      )}
    </div>
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
const topbar:CSSProperties={
  display:"flex",
  justifyContent:"space-between",
  alignItems:"center",
  gap:12,
  marginBottom:10,
};
const badge:CSSProperties={
  border:"1px solid",
  borderRadius:999,
  padding:"8px 12px",
  fontSize:11,
  fontWeight:900,
};
const mainGrid:CSSProperties={
  display:"grid",
  gridTemplateColumns:"minmax(0,1fr) 365px",
  gap:10,
  alignItems:"start",
};
const chartCard:CSSProperties={
  background:"#0b1220",
  border:"1px solid #26344d",
  borderRadius:12,
  padding:8,
  minWidth:0,
};
const side:CSSProperties={
  display:"grid",
  gap:9,
};
const card:CSSProperties={
  background:"#0b1220",
  border:"1px solid #26344d",
  borderRadius:10,
  padding:10,
};
const cardTitle:CSSProperties={
  fontSize:11,
  fontWeight:900,
  color:"#93c5fd",
  marginBottom:8,
  letterSpacing:.4,
};
const twoCols:CSSProperties={
  display:"grid",
  gridTemplateColumns:"1fr 1fr",
  gap:7,
};
const fieldStyle:CSSProperties={
  display:"grid",
  gap:3,
  fontSize:10,
  color:"#94a3b8",
};
const inputStyle:CSSProperties={
  width:"100%",
  boxSizing:"border-box",
  background:"#08101d",
  border:"1px solid #334155",
  borderRadius:7,
  color:"#f8fafc",
  padding:"7px 8px",
};
const selectStyle:CSSProperties={...inputStyle};
const buttonGrid:CSSProperties={
  display:"grid",
  gridTemplateColumns:"1fr 1fr",
  gap:6,
  marginTop:7,
};
const primaryButton:CSSProperties={
  width:"100%",
  marginTop:7,
  padding:"9px 10px",
  borderRadius:8,
  border:"1px solid #38bdf8",
  background:"#075985",
  color:"#e0f2fe",
  fontWeight:900,
  cursor:"pointer",
};
const cockpitButton:CSSProperties={
  width:"100%",
  marginTop:7,
  padding:"9px 10px",
  borderRadius:8,
  border:"1px solid #a855f7",
  background:"#581c87",
  color:"#f3e8ff",
  fontWeight:900,
  cursor:"pointer",
};
const secondaryButton:CSSProperties={
  padding:"8px 7px",
  borderRadius:8,
  border:"1px solid #475569",
  background:"#172033",
  color:"#e2e8f0",
  fontWeight:800,
  cursor:"pointer",
};
const activateButton:CSSProperties={
  width:"100%",
  marginTop:7,
  padding:"9px 8px",
  borderRadius:8,
  border:"1px solid #22c55e",
  background:"#14532d",
  color:"#dcfce7",
  fontWeight:900,
  cursor:"pointer",
};
const panelToolbar:CSSProperties={
  display:"flex",
  alignItems:"center",
  flexWrap:"wrap",
  gap:6,
  marginTop:8,
  padding:"7px 8px",
  background:"#08101d",
  border:"1px solid #26344d",
  borderRadius:8,
};
const panelToggle:CSSProperties={
  padding:"5px 8px",
  border:"1px solid",
  borderRadius:7,
  fontSize:10,
  fontWeight:900,
  cursor:"pointer",
};
const metricsGrid:CSSProperties={
  display:"grid",
  gridTemplateColumns:"repeat(5,1fr)",
  gap:6,
  marginTop:8,
};
const metric:CSSProperties={
  background:"#08101d",
  border:"1px solid #26344d",
  borderRadius:8,
  padding:8,
  textAlign:"center",
};
const statusBar:CSSProperties={
  marginTop:10,
  background:"#08101d",
  border:"1px solid #26344d",
  borderRadius:8,
  padding:"9px 10px",
  fontSize:12,
  color:"#cbd5e1",
};
