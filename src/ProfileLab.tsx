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
  macd_tf:string;
  rsi_tf:string;
  chaikin_tf:string;
  ad_tf:string;
};

type OptimizerSnapshot = {
  snapshot_version:string;
  engine_version:string;
  run_id?:string|null;
  parent_run_id?:string|null;
  phase:number;
  symbol:string;
  interval:string;
  requested_limit:number;
  candle_count:number;
  start_time:number;
  end_time:number;
  warmup_bars:number;
  closed_htf:boolean;
  params_fingerprint:string;
  environment_fingerprint:string;
  params:Params;
  expected_metrics?:{
    trades:number;
    profit_factor:number;
    net:number;
    max_drawdown:number;
    win_rate_pct:number;
  }|null;
};

type MultiTfTopRow = {
  params:Params;
  metrics:{
    trades:number;
    profit_factor:number;
    net:number;
    max_drawdown:number;
    win_rate_pct:number;
  };
  score:number;
  snapshot?:OptimizerSnapshot|null;
};

type TfFrequencyRow = {
  tf:string;
  count:number;
  share_pct:number;
  avg_score:number;
  avg_pf:number;
  best_rank:number;
};

type TfFrequency = {
  macd?:TfFrequencyRow[];
  rsi?:TfFrequencyRow[];
  chaikin?:TfFrequencyRow[];
  ad?:TfFrequencyRow[];
};

type MultiTfJob = {
  id:string;
  symbol:string;
  interval:string;
  status:string;
  total:number;
  processed:number;
  progress_pct:number;
  min_trades:number;
  top:MultiTfTopRow[];
  frequency?:TfFrequency;
  snapshot?:OptimizerSnapshot|null;
  error?:string|null;
};

type ParameterJob = {
  id:string;
  parent_run_id?:string|null;
  symbol:string;
  interval:string;
  status:string;
  total:number;
  processed:number;
  progress_pct:number;
  min_trades:number;
  tf_count:number;
  top:MultiTfTopRow[];
  snapshot?:OptimizerSnapshot|null;
  error?:string|null;
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
  macd_tf:"",
  rsi_tf:"",
  chaikin_tf:"",
  ad_tf:"",
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

function buildHeikinCandles(candles:any[]){
  let previousOpen=0;
  let previousClose=0;

  return candles.map((candle:any,index:number)=>{
    const open=Number(candle.open);
    const high=Number(candle.high);
    const low=Number(candle.low);
    const close=Number(candle.close);

    const heikinClose=(open+high+low+close)/4;
    const heikinOpen=index===0
      ?(open+close)/2
      :(previousOpen+previousClose)/2;
    const heikinHigh=Math.max(high,heikinOpen,heikinClose);
    const heikinLow=Math.min(low,heikinOpen,heikinClose);

    previousOpen=heikinOpen;
    previousClose=heikinClose;

    return {
      time:candle.time,
      open:heikinOpen,
      high:heikinHigh,
      low:heikinLow,
      close:heikinClose,
    };
  });
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
  const crosshairValuesRef=useRef<Array<Map<number,number>>>([
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    new Map(),
  ]);
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
  const [candleMode,setCandleMode]=useState<"heikin"|"normal">("heikin");
  const [compareView,setCompareView]=useState<"multi"|"baseline">("multi");
  const [tfOptimizerJob,setTfOptimizerJob]=useState<MultiTfJob|null>(null);
  const [tfOptimizerBusy,setTfOptimizerBusy]=useState(false);
  const [tfOptimizerMinTrades,setTfOptimizerMinTrades]=useState(20);
  const [tfOptimizerOptions,setTfOptimizerOptions]=useState<number[]>([
    5,10,15,20,30,45,60,90,120,180,
  ]);
  const [parameterJob,setParameterJob]=useState<ParameterJob|null>(null);
  const [parameterTopTfCount,setParameterTopTfCount]=useState(3);
  const [previewLimit,setPreviewLimit]=useState(1500);
  const [loadedSnapshot,setLoadedSnapshot]=useState<OptimizerSnapshot|null>(null);

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

    const primarySeries=[
      candles,
      macdLine,
      rsiLine,
      chaikinLine,
      adLine,
    ];

    let crosshairSyncing=false;

    charts.forEach((sourceChart,sourceIndex)=>{
      sourceChart.subscribeCrosshairMove((param:any)=>{
        if(crosshairSyncing)return;

        crosshairSyncing=true;
        try{
          if(param?.time==null){
            charts.forEach((targetChart,targetIndex)=>{
              if(targetIndex!==sourceIndex){
                targetChart.clearCrosshairPosition();
              }
            });
            return;
          }

          const numericTime=Number(param.time);

          charts.forEach((targetChart,targetIndex)=>{
            if(targetIndex===sourceIndex)return;

            const valueMap=crosshairValuesRef.current[targetIndex];
            const value=valueMap?.get(numericTime);

            if(Number.isFinite(value)){
              targetChart.setCrosshairPosition(
                Number(value),
                param.time,
                primarySeries[targetIndex]
              );
            }else{
              targetChart.clearCrosshairPosition();
            }
          });
        }finally{
          crosshairSyncing=false;
        }
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
    const displayedCandles=candleMode==="heikin"
      ?buildHeikinCandles(candles)
      :candles;
    const selectedPreview=compareView==="baseline"
      ?preview?.comparison?.baseline
      :preview?.comparison?.multi_tf;
    const indicator=selectedPreview?.indicators||preview.indicators||{};
    const times:Time[]=candles.map((candle:any)=>Number(candle.time) as Time);

    candleSeries.current?.setData(displayedCandles.map((c:any)=>({
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

    crosshairValuesRef.current=[
      new Map(
        displayedCandles.map((candle:any)=>[
          Number(candle.time),
          Number(candle.close),
        ])
      ),
      new Map(
        times.map((time:Time,index:number)=>[
          Number(time),
          Number(macdValues?.[index]??0),
        ])
      ),
      new Map(
        times.map((time:Time,index:number)=>[
          Number(time),
          Number(rsiValues?.[index]??50),
        ])
      ),
      new Map(
        times.map((time:Time,index:number)=>[
          Number(time),
          Number(chaikinValues?.[index]??0),
        ])
      ),
      new Map(
        times.map((time:Time,index:number)=>[
          Number(time),
          Number(adValues?.[index]??1),
        ])
      ),
    ];

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

    const markerEvents=selectedPreview?.events||preview.events||[];
    const markers=(Array.isArray(markerEvents)?markerEvents:[])
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
  },[preview,params.ad_length,candleMode,compareView]);
  useEffect(()=>{
    void loadProfiles();
  },[symbol,interval]);

  useEffect(()=>{
    let cancelled=false;

    async function poll(){
      try{
        const query=tfOptimizerJob?.id
          ?`?job_id=${encodeURIComponent(tfOptimizerJob.id)}&_ts=${Date.now()}`
          :`?_ts=${Date.now()}`;
        const data=await fetchJson(
          `${BACKEND_BASE}/qmomentum/multi-tf-optimize/status${query}`
        );
        if(cancelled)return;
        const job=data?.job||null;
        if(
          job &&
          job.symbol===symbol &&
          job.interval===interval
        ){
          setTfOptimizerJob(job);
        }

        const parameterQuery=parameterJob?.id
          ?`?job_id=${encodeURIComponent(parameterJob.id)}&_ts=${Date.now()}`
          :`?_ts=${Date.now()}`;
        const parameterData=await fetchJson(
          `${BACKEND_BASE}/qmomentum/multi-tf-optimize/parameter-status${parameterQuery}`
        );
        if(cancelled)return;
        const parameter=parameterData?.job||null;
        if(
          parameter &&
          parameter.symbol===symbol &&
          parameter.interval===interval
        ){
          setParameterJob(parameter);
        }
      }catch{
        // Der Lab-Optimizer darf die normale Vorschau niemals stören.
      }
    }

    void poll();
    const timer=window.setInterval(()=>void poll(),2500);
    return()=>{
      cancelled=true;
      window.clearInterval(timer);
    };
  },[symbol,interval,tfOptimizerJob?.id,parameterJob?.id]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>void runPreview(false),450);
    return()=>window.clearTimeout(timer);
  },[params,symbol,interval,previewLimit,loadedSnapshot?.environment_fingerprint]);

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
        macd_tf:interval,
        rsi_tf:interval,
        chaikin_tf:interval,
        ad_tf:interval,
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
        body:JSON.stringify({
          symbol,
          interval,
          params,
          limit:previewLimit,
          snapshot:loadedSnapshot,
        }),
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
    const next={...DEFAULT_PARAMS,macd_tf:interval,rsi_tf:interval,chaikin_tf:interval,ad_tf:interval,...profile.params};
    setParams(next);
    setBaseline(next);
    setSelectedId(profile.id);
    setProfileName(`${profile.name} · Kopie`);
    setNote(profile.note||"");
    setDirty(false);
    setLoadedSnapshot(null);
    setPreviewLimit(1500);
    setStatus(`Profil "${profile.name}" temporär geladen`);
  }

  function loadActive(){
    const next={...DEFAULT_PARAMS,macd_tf:interval,rsi_tf:interval,chaikin_tf:interval,ad_tf:interval,...(activeParams||DEFAULT_PARAMS)};
    setParams(next);
    setBaseline(next);
    setSelectedId("");
    setProfileName(`${symbol} ${interval} · Aktiv-Kopie`);
    setDirty(false);
    setLoadedSnapshot(null);
    setPreviewLimit(1500);
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
    const hasMultiTf=[params.macd_tf,params.rsi_tf,params.chaikin_tf,params.ad_tf]
      .some(value=>String(value||interval)!==interval);
    if(activate&&hasMultiTf){
      setStatus("Multi-TF ist in V9.7 Phase 1 nur fürs Profile Lab freigegeben");
      return;
    }
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

  async function startTfOptimizer(){
    try{
      setTfOptimizerBusy(true);
      setStatus("Multi-TF-Optimizer wird gestartet …");

      const allowed=tfOptimizerOptions
        .filter(value=>value>=Number(String(interval).replace(/[^0-9]/g,"")))
        .map(value=>`${value}m`);

      const data=await fetchJson(
        `${BACKEND_BASE}/qmomentum/multi-tf-optimize/start`,
        {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            symbol,
            interval,
            params,
            limit:5000,
            min_trades:tfOptimizerMinTrades,
            macd_tf_options:allowed,
            rsi_tf_options:allowed,
            chaikin_tf_options:allowed,
            ad_tf_options:allowed,
            max_combinations:20000,
          }),
        }
      );

      setTfOptimizerJob(data.job);
      setStatus(
        `Multi-TF-Lauf gestartet: ${data.job.total} Kombinationen · Browser kann geschlossen werden`
      );
    }catch(error){
      setStatus(
        `Multi-TF-Optimizer fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`
      );
    }finally{
      setTfOptimizerBusy(false);
    }
  }

  async function controlTfOptimizer(action:"pause"|"resume"|"cancel"){
    if(!tfOptimizerJob?.id)return;
    try{
      const data=await fetchJson(
        `${BACKEND_BASE}/qmomentum/multi-tf-optimize/${action}`,
        {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({job_id:tfOptimizerJob.id}),
        }
      );
      setTfOptimizerJob(data.job);
      setStatus(`Multi-TF-Optimizer: ${String(data.job.status)}`);
    }catch(error){
      setStatus(
        `Optimizer-Steuerung fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`
      );
    }
  }

  function loadTfOptimizerRow(row:MultiTfTopRow){
    setParams(previous=>({
      ...previous,
      macd_tf:String(row.params.macd_tf||interval),
      rsi_tf:String(row.params.rsi_tf||interval),
      chaikin_tf:String(row.params.chaikin_tf||interval),
      ad_tf:String(row.params.ad_tf||interval),
    }));
    const snapshot=row.snapshot||tfOptimizerJob?.snapshot||null;
    setLoadedSnapshot(snapshot);
    setPreviewLimit(Number(snapshot?.requested_limit||snapshot?.candle_count||5000));
    setCompareView("multi");
    setStatus(
      `TF-Kombination geladen · reproduzierbarer Zeitraum ${Number(snapshot?.candle_count||0)} Kerzen`
    );
  }

  async function startParameterOptimizer(){
    if(!tfOptimizerJob?.id||!(tfOptimizerJob.top||[]).length){
      setStatus("Zuerst einen abgeschlossenen TF-Lauf auswählen");
      return;
    }
    try{
      setTfOptimizerBusy(true);
      setStatus("Phase 2 · Parameteroptimierung wird gestartet …");
      const data=await fetchJson(
        `${BACKEND_BASE}/qmomentum/multi-tf-optimize/parameter-start`,
        {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            parent_run_id:tfOptimizerJob.id,
            symbol,
            interval,
            params,
            top_tf_count:parameterTopTfCount,
            min_trades:tfOptimizerMinTrades,
            limit:5000,
            max_combinations:50000,
            wide_search:false,
          }),
        }
      );
      setParameterJob(data.job);
      setStatus(
        `Phase 2 gestartet: ${data.job.total} Parameterkombinationen auf ${data.job.tf_count} TF-Siegern`
      );
    }catch(error){
      setStatus(
        `Phase 2 fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`
      );
    }finally{
      setTfOptimizerBusy(false);
    }
  }

  async function controlParameterOptimizer(action:"pause"|"resume"|"cancel"){
    if(!parameterJob?.id)return;
    try{
      const data=await fetchJson(
        `${BACKEND_BASE}/qmomentum/multi-tf-optimize/parameter-${action}`,
        {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({job_id:parameterJob.id}),
        }
      );
      setParameterJob(data.job);
      setStatus(`Parameteroptimierung: ${String(data.job.status)}`);
    }catch(error){
      setStatus(
        `Parametersteuerung fehlgeschlagen: ${error instanceof Error?error.message:String(error)}`
      );
    }
  }

  function loadParameterRow(row:MultiTfTopRow){
    setParams(previous=>({
      ...previous,
      ...row.params,
    }));
    const snapshot=row.snapshot||parameterJob?.snapshot||null;
    setLoadedSnapshot(snapshot);
    setPreviewLimit(Number(snapshot?.requested_limit||snapshot?.candle_count||5000));
    setCompareView("multi");
    setStatus(
      `Parameterprofil geladen · ${Number(snapshot?.candle_count||0)} Kerzen · MATCH wird geprüft`
    );
  }

  function setField<K extends keyof Params>(key:K,value:Params[K]){
    setParams(previous=>({...previous,[key]:value}));
  }

  const chosen=profiles.find(row=>row.id===selectedId)||null;
  const baselineMetrics=preview?.comparison?.baseline?.metrics||{};
  const multiMetrics=preview?.comparison?.multi_tf?.metrics||preview?.metrics||{};
  const metrics=compareView==="baseline"?baselineMetrics:multiMetrics;

  const profitFactor=Number(metrics.profit_factor||0);
  const net=Number(metrics.net||0);
  const drawdown=Number(metrics.max_drawdown||0);

  const grossLoss=
    Number.isFinite(profitFactor)&&
    Math.abs(profitFactor-1)>0.0000001
      ?Math.abs(net/(profitFactor-1))
      :0;

  const grossProfit=
    profitFactor>0
      ?grossLoss*profitFactor
      :Math.max(0,net);

  const efficiency=
    drawdown>0
      ?net/drawdown
      :0;

  const reproducedSnapshot=preview?.reproduction_snapshot as OptimizerSnapshot|undefined;
  const expectedMetrics=loadedSnapshot?.expected_metrics||null;

  const metricNear=(a:number,b:number,tolerance=0.0001)=>
    Math.abs(Number(a||0)-Number(b||0))<=tolerance;

  const matchChecks=loadedSnapshot?[
    {
      label:"Symbol",
      ok:String(reproducedSnapshot?.symbol||symbol)===String(loadedSnapshot.symbol),
      detail:`${reproducedSnapshot?.symbol||symbol} / ${loadedSnapshot.symbol}`,
    },
    {
      label:"Chart-TF",
      ok:String(reproducedSnapshot?.interval||interval)===String(loadedSnapshot.interval),
      detail:`${reproducedSnapshot?.interval||interval} / ${loadedSnapshot.interval}`,
    },
    {
      label:"Kerzen",
      ok:Number(reproducedSnapshot?.candle_count||0)===Number(loadedSnapshot.candle_count||0),
      detail:`${Number(reproducedSnapshot?.candle_count||0)} / ${Number(loadedSnapshot.candle_count||0)}`,
    },
    {
      label:"Startzeit",
      ok:Number(reproducedSnapshot?.start_time||0)===Number(loadedSnapshot.start_time||0),
      detail:`${Number(reproducedSnapshot?.start_time||0)} / ${Number(loadedSnapshot.start_time||0)}`,
    },
    {
      label:"Endzeit",
      ok:Number(reproducedSnapshot?.end_time||0)===Number(loadedSnapshot.end_time||0),
      detail:`${Number(reproducedSnapshot?.end_time||0)} / ${Number(loadedSnapshot.end_time||0)}`,
    },
    {
      label:"Warmup",
      ok:Number(reproducedSnapshot?.warmup_bars||0)===Number(loadedSnapshot.warmup_bars||0),
      detail:`${Number(reproducedSnapshot?.warmup_bars||0)} / ${Number(loadedSnapshot.warmup_bars||0)}`,
    },
    {
      label:"Closed HTF",
      ok:Boolean(reproducedSnapshot?.closed_htf)===Boolean(loadedSnapshot.closed_htf),
      detail:`${String(Boolean(reproducedSnapshot?.closed_htf))} / ${String(Boolean(loadedSnapshot.closed_htf))}`,
    },
    {
      label:"Parameter",
      ok:String(reproducedSnapshot?.params_fingerprint||"")===String(loadedSnapshot.params_fingerprint||""),
      detail:`${reproducedSnapshot?.params_fingerprint||"-"} / ${loadedSnapshot.params_fingerprint||"-"}`,
    },
    {
      label:"Trades",
      ok:expectedMetrics
        ?Number(multiMetrics.trades||0)===Number(expectedMetrics.trades||0)
        :false,
      detail:`${Number(multiMetrics.trades||0)} / ${Number(expectedMetrics?.trades||0)}`,
    },
    {
      label:"PF",
      ok:expectedMetrics
        ?metricNear(Number(multiMetrics.profit_factor||0),Number(expectedMetrics.profit_factor||0))
        :false,
      detail:`${Number(multiMetrics.profit_factor||0).toFixed(4)} / ${Number(expectedMetrics?.profit_factor||0).toFixed(4)}`,
    },
    {
      label:"Netto",
      ok:expectedMetrics
        ?metricNear(Number(multiMetrics.net||0),Number(expectedMetrics.net||0),0.001)
        :false,
      detail:`${Number(multiMetrics.net||0).toFixed(3)} / ${Number(expectedMetrics?.net||0).toFixed(3)}`,
    },
    {
      label:"DD",
      ok:expectedMetrics
        ?metricNear(Number(multiMetrics.max_drawdown||0),Number(expectedMetrics.max_drawdown||0),0.001)
        :false,
      detail:`${Number(multiMetrics.max_drawdown||0).toFixed(3)} / ${Number(expectedMetrics?.max_drawdown||0).toFixed(3)}`,
    },
  ]:[];

  const matchPassed=matchChecks.filter(row=>row.ok).length;
  const matchPercent=matchChecks.length
    ?Math.round(matchPassed/matchChecks.length*100)
    :0;

  const strategyLabel=params.strategy_mode==="basis_chaikin"
    ?"Basis + Chaikin"
    :params.strategy_mode==="basis_ad"
    ?"Basis + HA-AD"
    :"Basis V8.5";

  const timeframeOptions=(()=>{
    const baseMinutes=Number(String(interval).replace(/[^0-9]/g,""))||5;
    const candidates=[5,10,15,20,30,45,60,90,120,180,240];
    return candidates.filter(value=>value>=baseMinutes);
  })();

  const tfField=(key:"macd_tf"|"rsi_tf"|"chaikin_tf"|"ad_tf",label:string)=>(
    <label style={fieldStyle}>
      <span>{label}</span>
      <select
        style={selectStyle}
        value={String(params[key]||interval)}
        onChange={event=>setField(key,event.target.value)}
      >
        {timeframeOptions.map(value=><option key={value} value={`${value}m`}>{value}m</option>)}
      </select>
    </label>
  );

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
        <div style={{fontSize:24,fontWeight:900}}>PROFILE LAB V1.7 · REPRODUCIBLE OPTIMIZER</div>
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
          <span style={{fontSize:11,fontWeight:900,color:"#93c5fd"}}>KERZEN</span>
          <button
            type="button"
            style={{
              ...panelToggle,
              background:candleMode==="heikin"?"#1d4ed8":"#172033",
              borderColor:candleMode==="heikin"?"#60a5fa":"#334155",
              color:candleMode==="heikin"?"#eff6ff":"#94a3b8",
            }}
            onClick={()=>setCandleMode("heikin")}
          >
            HEIKIN
          </button>
          <button
            type="button"
            style={{
              ...panelToggle,
              background:candleMode==="normal"?"#334155":"#172033",
              borderColor:candleMode==="normal"?"#cbd5e1":"#334155",
              color:candleMode==="normal"?"#f8fafc":"#94a3b8",
            }}
            onClick={()=>setCandleMode("normal")}
          >
            NORMAL
          </button>

          <span style={{width:1,height:22,background:"#334155",margin:"0 3px"}}/>

          <span style={{fontSize:11,fontWeight:900,color:"#93c5fd"}}>VERGLEICH</span>
          <button
            type="button"
            style={{...panelToggle,background:compareView==="baseline"?"#854d0e":"#172033",borderColor:compareView==="baseline"?"#facc15":"#334155",color:compareView==="baseline"?"#fef9c3":"#94a3b8"}}
            onClick={()=>setCompareView("baseline")}
          >A · CHART-TF</button>
          <button
            type="button"
            style={{...panelToggle,background:compareView==="multi"?"#14532d":"#172033",borderColor:compareView==="multi"?"#22c55e":"#334155",color:compareView==="multi"?"#dcfce7":"#94a3b8"}}
            onClick={()=>setCompareView("multi")}
          >B · MULTI-TF</button>

          <span style={{width:1,height:22,background:"#334155",margin:"0 3px"}}/>

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
          title={`MACD · ${compareView==="baseline"?interval:params.macd_tf||interval} · ${params.macd_fast}/${params.macd_slow}/${params.macd_signal} · CLOSED`}
          visible={panels.macd}
          containerRef={macdEl}
          height={190}
        />
        <IndicatorPanel
          title={`RSI · ${compareView==="baseline"?interval:params.rsi_tf||interval} · Länge ${params.rsi_length} · Signal ${params.rsi_signal} · CLOSED`}
          visible={panels.rsi}
          containerRef={rsiEl}
          height={175}
        />
        <IndicatorPanel
          title={`CHAIKIN · ${compareView==="baseline"?interval:params.chaikin_tf||interval} · ${params.chaikin_fast}/${params.chaikin_slow} · CLOSED`}
          visible={panels.chaikin}
          containerRef={chaikinEl}
          height={175}
        />
        <IndicatorPanel
          title={`AD RATIO · ${compareView==="baseline"?interval:params.ad_tf||interval} · Länge ${params.ad_length} · CLOSED`}
          visible={panels.ad}
          containerRef={adEl}
          height={175}
        />

        <div style={metricsGrid}>
          <Metric label="PF" value={profitFactor.toFixed(2)}/>
          <Metric label="Gewinn" value={grossProfit.toFixed(1)}/>
          <Metric label="Verlust" value={grossLoss.toFixed(1)}/>
          <Metric label="Netto" value={net.toFixed(1)}/>
          <Metric label="DD" value={drawdown.toFixed(1)}/>
          <Metric label="Effizienz" value={efficiency.toFixed(2)}/>
          <Metric label="Trades" value={String(metrics.trades??0)}/>
          <Metric label="Winrate" value={`${Number(metrics.win_rate_pct||0).toFixed(1)} %`}/>
        </div>

        <div style={comparisonStrip}>
          <CompareMetric label="PF" a={Number(baselineMetrics.profit_factor||0)} b={Number(multiMetrics.profit_factor||0)}/>
          <CompareMetric label="Netto" a={Number(baselineMetrics.net||0)} b={Number(multiMetrics.net||0)}/>
          <CompareMetric label="DD" a={Number(baselineMetrics.max_drawdown||0)} b={Number(multiMetrics.max_drawdown||0)} lowerBetter/>
          <CompareMetric label="Trades" a={Number(baselineMetrics.trades||0)} b={Number(multiMetrics.trades||0)}/>
          <CompareMetric label="Winrate" a={Number(baselineMetrics.win_rate_pct||0)} b={Number(multiMetrics.win_rate_pct||0)}/>
        </div>
        <div style={{fontSize:11,color:"#64748b",marginTop:7}}>
          A = alle Indikatoren auf Chart-TF. B = aktuelle Multi-TF-Kombination. Closed-HTF verhindert Look-ahead.
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

        {loadedSnapshot?<Card title="OPTIMIZER MATCH">
          <div style={{
            display:"flex",
            justifyContent:"space-between",
            alignItems:"center",
            gap:8,
            padding:"9px 10px",
            borderRadius:8,
            background:matchPercent===100?"#052e16":"#451a03",
            border:`1px solid ${matchPercent===100?"#22c55e":"#f59e0b"}`,
            color:matchPercent===100?"#bbf7d0":"#fde68a",
            fontWeight:900,
          }}>
            <span>MATCH</span>
            <span style={{fontSize:22}}>{matchPercent} %</span>
          </div>
          <div style={{fontSize:9,color:"#64748b",marginTop:6}}>
            Run {loadedSnapshot.run_id||"-"} · {loadedSnapshot.candle_count} Kerzen · CLOSED HTF
          </div>
          <div style={{display:"grid",gap:4,marginTop:8}}>
            {matchChecks.map(row=><div
              key={row.label}
              style={{
                display:"grid",
                gridTemplateColumns:"18px 90px minmax(0,1fr)",
                gap:5,
                alignItems:"center",
                fontSize:9,
                color:row.ok?"#86efac":"#fca5a5",
              }}
            >
              <b>{row.ok?"✓":"✗"}</b>
              <b>{row.label}</b>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {row.detail}
              </span>
            </div>)}
          </div>
          <div style={{fontSize:9,color:"#94a3b8",marginTop:7}}>
            Optimizer / Profile Lab. Nur 100 % gilt als reproduzierbar.
          </div>
        </Card>:null}

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
            {tfField("ad_tf","AD TF")}
            {tfField("chaikin_tf","Chaikin TF")}
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
            {tfField("macd_tf","MACD TF")}
            {tfField("rsi_tf","RSI TF")}
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

        <Card title="OPTIMIZER V2 · TF-SUCHE">
          <div style={{fontSize:10,color:"#94a3b8",lineHeight:1.45}}>
            Phase 1 hält alle Parameter fest und sucht nur die vier Indikator-TFs.
            Closed-HTF · Lab-only · keine Aktivierung.
          </div>

          <div style={{marginTop:8}}>
            <div style={{fontSize:10,color:"#64748b",marginBottom:5}}>
              ZUGELASSENE TIMEFRAMES
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {[5,10,15,20,30,45,60,90,120,180,240].map(value=>{
                const base=Number(String(interval).replace(/[^0-9]/g,""))||5;
                const disabled=value<base;
                const active=tfOptimizerOptions.includes(value);
                return <button
                  key={value}
                  type="button"
                  disabled={disabled||tfOptimizerJob?.status==="RUNNING"}
                  style={{
                    ...panelToggle,
                    opacity:disabled?0.3:1,
                    background:active?"#164e63":"#172033",
                    borderColor:active?"#22d3ee":"#334155",
                    color:active?"#cffafe":"#94a3b8",
                  }}
                  onClick={()=>setTfOptimizerOptions(previous=>
                    active
                      ?previous.filter(item=>item!==value)
                      :[...previous,value].sort((a,b)=>a-b)
                  )}
                >
                  {value}m
                </button>;
              })}
            </div>
          </div>

          <label style={{...fieldStyle,marginTop:8}}>
            <span>Mindestanzahl Trades</span>
            <input
              style={inputStyle}
              type="number"
              min={5}
              step={1}
              value={tfOptimizerMinTrades}
              disabled={tfOptimizerJob?.status==="RUNNING"}
              onChange={event=>setTfOptimizerMinTrades(
                Math.max(5,Number(event.target.value)||5)
              )}
            />
          </label>

          <button
            style={primaryButton}
            disabled={
              tfOptimizerBusy||
              tfOptimizerJob?.status==="RUNNING"||
              tfOptimizerOptions.length===0
            }
            onClick={()=>void startTfOptimizer()}
          >
            {tfOptimizerBusy?"STARTET …":"TF-SUCHE STARTEN"}
          </button>

          {tfOptimizerJob?<div style={{marginTop:9}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#cbd5e1"}}>
              <b>{tfOptimizerJob.status}</b>
              <span>
                {tfOptimizerJob.processed} / {tfOptimizerJob.total} · {Number(tfOptimizerJob.progress_pct||0).toFixed(1)} %
              </span>
            </div>
            <div style={{height:8,background:"#172033",borderRadius:999,overflow:"hidden",marginTop:5}}>
              <div style={{
                height:"100%",
                width:`${Math.max(0,Math.min(100,Number(tfOptimizerJob.progress_pct||0)))}%`,
                background:"#0ea5e9",
              }}/>
            </div>

            <div style={buttonGrid}>
              <button
                style={secondaryButton}
                disabled={tfOptimizerJob.status!=="RUNNING"}
                onClick={()=>void controlTfOptimizer("pause")}
              >
                PAUSE
              </button>
              <button
                style={secondaryButton}
                disabled={tfOptimizerJob.status!=="PAUSED"}
                onClick={()=>void controlTfOptimizer("resume")}
              >
                FORTSETZEN
              </button>
            </div>

            {tfOptimizerJob.error?<div style={{marginTop:7,color:"#f87171",fontSize:10}}>
              {tfOptimizerJob.error}
            </div>:null}

            <div style={{marginTop:10,fontSize:10,fontWeight:900,color:"#93c5fd"}}>
              TF-HÄUFIGKEIT · TOP 100
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:6}}>
              <TfHeatmap title="MACD" rows={tfOptimizerJob.frequency?.macd||[]}/>
              <TfHeatmap title="RSI" rows={tfOptimizerJob.frequency?.rsi||[]}/>
              <TfHeatmap title="CHAIKIN" rows={tfOptimizerJob.frequency?.chaikin||[]}/>
              <TfHeatmap title="AD" rows={tfOptimizerJob.frequency?.ad||[]}/>
            </div>

            <div style={{marginTop:10,fontSize:10,fontWeight:900,color:"#93c5fd"}}>
              TOP 100 KOMBINATIONEN
            </div>
            <div style={{display:"grid",gap:5,marginTop:5,maxHeight:360,overflowY:"auto"}}>
              {(tfOptimizerJob.top||[]).slice(0,100).map((row,index)=>{
                const dd=Number(row.metrics.max_drawdown||0);
                const netValue=Number(row.metrics.net||0);
                const eff=dd>0?netValue/dd:0;
                return <button
                  key={`${row.params.macd_tf}-${row.params.rsi_tf}-${row.params.chaikin_tf}-${row.params.ad_tf}-${index}`}
                  type="button"
                  style={{
                    textAlign:"left",
                    background:"#08101d",
                    border:"1px solid #26344d",
                    borderRadius:7,
                    padding:"7px 8px",
                    color:"#e2e8f0",
                    cursor:"pointer",
                  }}
                  onClick={()=>loadTfOptimizerRow(row)}
                >
                  <div style={{display:"flex",justifyContent:"space-between",gap:6,fontSize:10,fontWeight:900}}>
                    <span>#{index+1} · Score {Number(row.score||0).toFixed(1)}</span>
                    <span>PF {Number(row.metrics.profit_factor||0).toFixed(2)}</span>
                  </div>
                  <div style={{fontSize:9,color:"#94a3b8",marginTop:3}}>
                    M {row.params.macd_tf} · R {row.params.rsi_tf} · C {row.params.chaikin_tf} · AD {row.params.ad_tf}
                  </div>
                  <div style={{fontSize:9,color:"#64748b",marginTop:2}}>
                    Netto {netValue.toFixed(1)} · DD {dd.toFixed(1)} · Eff {eff.toFixed(2)} · Trades {row.metrics.trades}
                  </div>
                </button>;
              })}
            </div>

            <div style={{
              marginTop:10,
              paddingTop:9,
              borderTop:"1px solid #26344d",
            }}>
              <div style={{fontSize:10,fontWeight:900,color:"#c084fc"}}>
                PHASE 2 · PARAMETER AUF BESTEN TFs
              </div>
              <div style={{fontSize:9,color:"#94a3b8",lineHeight:1.4,marginTop:4}}>
                MACD-, RSI-, Chaikin- und AD-Werte werden um die aktuellen Einstellungen variiert.
              </div>
              <label style={{...fieldStyle,marginTop:7}}>
                <span>Anzahl TF-Sieger</span>
                <select
                  style={selectStyle}
                  value={parameterTopTfCount}
                  disabled={parameterJob?.status==="RUNNING"}
                  onChange={event=>setParameterTopTfCount(Number(event.target.value))}
                >
                  {[1,2,3,5].map(value=>
                    <option key={value} value={value}>{value}</option>
                  )}
                </select>
              </label>
              <button
                style={{...primaryButton,background:"#6b21a8",borderColor:"#c084fc"}}
                disabled={
                  tfOptimizerBusy||
                  tfOptimizerJob.status!=="FINISHED"||
                  parameterJob?.status==="RUNNING"
                }
                onClick={()=>void startParameterOptimizer()}
              >
                PARAMETER-SUCHE STARTEN
              </button>

              {parameterJob?<div style={{marginTop:8}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#cbd5e1"}}>
                  <b>{parameterJob.status}</b>
                  <span>{parameterJob.processed} / {parameterJob.total} · {Number(parameterJob.progress_pct||0).toFixed(1)} %</span>
                </div>
                <div style={{height:8,background:"#172033",borderRadius:999,overflow:"hidden",marginTop:5}}>
                  <div style={{
                    height:"100%",
                    width:`${Math.max(0,Math.min(100,Number(parameterJob.progress_pct||0)))}%`,
                    background:"#a855f7",
                  }}/>
                </div>
                <div style={buttonGrid}>
                  <button
                    style={secondaryButton}
                    disabled={parameterJob.status!=="RUNNING"}
                    onClick={()=>void controlParameterOptimizer("pause")}
                  >
                    PAUSE
                  </button>
                  <button
                    style={secondaryButton}
                    disabled={parameterJob.status!=="PAUSED"}
                    onClick={()=>void controlParameterOptimizer("resume")}
                  >
                    FORTSETZEN
                  </button>
                </div>
                {parameterJob.error?<div style={{marginTop:6,fontSize:9,color:"#f87171"}}>
                  {parameterJob.error}
                </div>:null}
                <div style={{marginTop:8,fontSize:10,fontWeight:900,color:"#c084fc"}}>
                  BESTE PARAMETERPROFILE
                </div>
                <div style={{display:"grid",gap:5,marginTop:5,maxHeight:330,overflowY:"auto"}}>
                  {(parameterJob.top||[]).slice(0,30).map((row,index)=>{
                    const dd=Number(row.metrics.max_drawdown||0);
                    const netValue=Number(row.metrics.net||0);
                    return <button
                      key={`parameter-${index}-${row.params.macd_fast}-${row.params.rsi_length}`}
                      type="button"
                      style={{
                        textAlign:"left",
                        background:"#10091b",
                        border:"1px solid #4c1d95",
                        borderRadius:7,
                        padding:"7px 8px",
                        color:"#f3e8ff",
                        cursor:"pointer",
                      }}
                      onClick={()=>loadParameterRow(row)}
                    >
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontWeight:900}}>
                        <span>#{index+1} · Score {Number(row.score||0).toFixed(1)}</span>
                        <span>PF {Number(row.metrics.profit_factor||0).toFixed(2)}</span>
                      </div>
                      <div style={{fontSize:9,color:"#d8b4fe",marginTop:3}}>
                        TF: M {row.params.macd_tf} · R {row.params.rsi_tf} · C {row.params.chaikin_tf} · AD {row.params.ad_tf}
                      </div>
                      <div style={{fontSize:9,color:"#c4b5fd",marginTop:2}}>
                        MACD {row.params.macd_fast}/{row.params.macd_slow}/{row.params.macd_signal}
                        {" · "}RSI {row.params.rsi_length}/{row.params.rsi_signal}
                        {" · "}C {row.params.chaikin_fast}/{row.params.chaikin_slow}
                        {" · "}AD {row.params.ad_length}
                      </div>
                      <div style={{fontSize:9,color:"#8b5cf6",marginTop:2}}>
                        Netto {netValue.toFixed(1)} · DD {dd.toFixed(1)} · Trades {row.metrics.trades}
                      </div>
                    </button>;
                  })}
                </div>
              </div>:null}
            </div>
          </div>:null}
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

function TfHeatmap({
  title,
  rows,
}:{
  title:string;
  rows:TfFrequencyRow[];
}){
  const maximum=Math.max(1,...rows.map(row=>Number(row.count||0)));
  return <div style={{
    background:"#08101d",
    border:"1px solid #26344d",
    borderRadius:7,
    padding:7,
  }}>
    <div style={{fontSize:9,fontWeight:900,color:"#93c5fd",marginBottom:5}}>
      {title}
    </div>
    <div style={{display:"grid",gap:4}}>
      {rows.slice(0,8).map(row=><div key={row.tf}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#cbd5e1"}}>
          <span>{row.tf}</span>
          <span>{row.count}× · {Number(row.share_pct||0).toFixed(0)} % · ØPF {Number(row.avg_pf||0).toFixed(2)}</span>
        </div>
        <div style={{height:7,background:"#172033",borderRadius:999,overflow:"hidden",marginTop:2}}>
          <div style={{
            height:"100%",
            width:`${Math.max(4,(Number(row.count||0)/maximum)*100)}%`,
            background:"#0ea5e9",
          }}/>
        </div>
      </div>)}
    </div>
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

function CompareMetric({
  label,
  a,
  b,
  lowerBetter=false,
}:{
  label:string;
  a:number;
  b:number;
  lowerBetter?:boolean;
}){
  const delta=b-a;
  const improved=lowerBetter?delta<0:delta>0;
  return <div style={compareMetric}>
    <div style={{fontSize:10,color:"#94a3b8"}}>{label}</div>
    <div style={{fontSize:11}}>A {a.toFixed(label==="Trades"?0:2)} · B {b.toFixed(label==="Trades"?0:2)}</div>
    <div style={{fontSize:10,fontWeight:900,color:Math.abs(delta)<0.0001?"#94a3b8":improved?"#22c55e":"#ef4444"}}>
      Δ {delta>=0?"+":""}{delta.toFixed(label==="Trades"?0:2)}
    </div>
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
  overflowX:"auto",
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
const comparisonStrip:CSSProperties={
  display:"grid",
  gridTemplateColumns:"repeat(5,minmax(110px,1fr))",
  gap:6,
  marginTop:8,
  minWidth:620,
};
const compareMetric:CSSProperties={
  background:"#08101d",
  border:"1px solid #26344d",
  borderRadius:8,
  padding:"7px 8px",
  textAlign:"center",
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
  gridTemplateColumns:"repeat(8,minmax(90px,1fr))",
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
