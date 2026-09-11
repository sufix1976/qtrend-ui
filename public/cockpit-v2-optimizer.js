(() => {
  const BACKEND="https://qtrend-trading-engine.onrender.com";
  const TFS=["1m","2m","3m","5m","8m","10m","15m","18m","30m","1h"];
  let cancelled=false,running=false,lastResults=[],baseProfile=null,baseStats=null,currentSymbol="GOLD";

  const css=`
  #qv2-opt-btn{position:fixed;right:142px;bottom:14px;z-index:9997;background:#4c1d95;color:#f5f3ff;border:1px solid #8b5cf6;border-radius:9px;padding:10px 14px;font:900 12px system-ui;box-shadow:0 8px 28px #0008;cursor:pointer;display:none}
  #qv2-opt-overlay{position:fixed;inset:0;z-index:10020;background:#020617e8;display:none;align-items:center;justify-content:center;padding:18px;font-family:Inter,system-ui;color:#dbeafe}
  #qv2-opt-modal{width:min(1500px,98vw);height:min(920px,95vh);background:#08111f;border:1px solid #475569;border-radius:12px;display:grid;grid-template-rows:auto auto 1fr;overflow:hidden;box-shadow:0 20px 80px #000d}
  #qv2-opt-head{display:flex;align-items:center;gap:9px;padding:11px 13px;border-bottom:1px solid #334155;background:#0b1424;flex-wrap:wrap}
  #qv2-opt-head b{color:#c4b5fd;font-size:15px}.qv2-grow{flex:1}.qv2-btn{background:#111827;color:#e5eefc;border:1px solid #475569;border-radius:7px;padding:8px 11px;font-weight:900;cursor:pointer}.qv2-btn:disabled{opacity:.45;cursor:wait}.qv2-start{background:#166534}.qv2-stop{background:#92400e}.qv2-close{background:#991b1b}
  #qv2-opt-summary{padding:10px 13px;border-bottom:1px solid #334155;display:grid;gap:7px;background:#091321}.qv2-note{color:#a5b4fc;font-weight:800}.qv2-status{border:1px solid #155e75;background:#082f49;color:#cffafe;border-radius:7px;padding:8px 10px;font-weight:800}.qv2-progress{height:8px;background:#172033;border-radius:999px;overflow:hidden}.qv2-progress>i{display:block;height:100%;width:0;background:#8b5cf6;transition:width .2s}
  #qv2-opt-body{overflow:auto;padding:10px}.qv2-table{border-collapse:collapse;width:100%;min-width:1150px;font-size:12px}.qv2-table th,.qv2-table td{border:1px solid #26364d;padding:7px 8px;text-align:left;white-space:nowrap}.qv2-table th{position:sticky;top:0;background:#102033;color:#c4b5fd;z-index:2}.qv2-pos{color:#86efac;font-weight:900}.qv2-neg{color:#fca5a5;font-weight:900}.qv2-muted{color:#94a3b8}.qv2-rank{font-weight:900;color:#f8fafc}.qv2-changes{max-width:520px;white-space:normal!important;line-height:1.35}.qv2-mini{font-size:11px;padding:5px 7px}.qv2-select{background:#0a1020;color:#e5eefc;border:1px solid #475569;border-radius:7px;padding:7px 8px;font-weight:800}
  @media(max-width:800px){#qv2-opt-overlay{padding:4px}#qv2-opt-modal{width:99vw;height:97vh}#qv2-opt-btn{right:14px;bottom:58px}}
  `;
  const style=document.createElement("style");style.textContent=css;document.head.appendChild(style);
  const btn=document.createElement("button");btn.id="qv2-opt-btn";btn.textContent="OPTIMIZER";document.body.appendChild(btn);
  const overlay=document.createElement("div");overlay.id="qv2-opt-overlay";overlay.innerHTML=`<div id="qv2-opt-modal"><div id="qv2-opt-head"><b>COCKPIT V2 · OPTIMIZER</b><span class="qv2-note">START = aktuell gespeichertes LIVE-Profil · KEIN automatisches LIVE-Schreiben</span><span class="qv2-grow"></span><label>Suche <select id="qv2-opt-depth" class="qv2-select"><option value="3">Standard</option><option value="5">Tief</option></select></label><button class="qv2-btn qv2-start" id="qv2-opt-start">START</button><button class="qv2-btn qv2-stop" id="qv2-opt-stop" disabled>STOP</button><button class="qv2-btn qv2-close" id="qv2-opt-close">SCHLIESSEN</button></div><div id="qv2-opt-summary"><div id="qv2-opt-base" class="qv2-muted">Noch nicht gestartet.</div><div id="qv2-opt-status" class="qv2-status">Bereit.</div><div class="qv2-progress"><i id="qv2-opt-progress"></i></div></div><div id="qv2-opt-body"><div class="qv2-muted">Der Optimizer rechnet jede getestete Variante vollständig über die vorhandenen 30.000×1m-Daten. Reihenfolge: ENTRY → TREND/HOLD → E1 → E2 → E3 → E4 → TX → Controller. Nach jeder Stufe bleiben nur die besten vollständigen Profile im Beam.</div></div></div>`;document.body.appendChild(overlay);

  const el=id=>overlay.querySelector(`#${id}`),body=el("qv2-opt-body"),statusEl=el("qv2-opt-status"),baseEl=el("qv2-opt-base"),progressEl=el("qv2-opt-progress"),startBtn=el("qv2-opt-start"),stopBtn=el("qv2-opt-stop"),depthEl=el("qv2-opt-depth");
  const fmt=(v,d=3)=>Number.isFinite(Number(v))?Number(v).toFixed(d):"—";
  const signed=(v,d=2)=>{const n=Number(v);return Number.isFinite(n)?`${n>=0?"+":""}${n.toFixed(d)}`:"—"};
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function json(url,init={}){const r=await fetch(url,{cache:"no-store",...init});const text=await r.text();let j;try{j=JSON.parse(text);}catch{throw new Error(`Keine JSON-Antwort (${r.status})`)}if(!r.ok||j?.ok===false)throw new Error(j?.info||j?.reason||j?.error||`HTTP ${r.status}`);return j;}
  function symbolSelect(){return [...document.querySelectorAll("select")].find(s=>{const vals=[...s.options].map(o=>o.value||o.textContent);return vals.includes("GOLD")&&vals.includes("US100")&&vals.includes("CORN");})||null;}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function getPath(o,path){return path.split(".").reduce((a,k)=>a?.[k],o);}
  function setPath(o,path,value){const c=clone(o),keys=path.split(".");let p=c;for(let i=0;i<keys.length-1;i++){p[keys[i]]??={};p=p[keys[i]];}p[keys.at(-1)]=value;return c;}
  function uniq(arr){return [...new Set(arr.map(v=>typeof v==="number"?Number(v.toFixed(6)):v))];}
  function aroundInt(v,min,max){v=Math.round(Number(v)||min);return uniq([v,Math.round(v*.75),Math.round(v*.9),Math.round(v*1.1),Math.round(v*1.25),v-2,v+2].map(x=>Math.max(min,Math.min(max,x))));}
  function aroundFloat(v,min,max,step=.1){v=Number(v)||min;const vals=[v,v*.75,v*.9,v*1.1,v*1.25,v-step*2,v+step*2].map(x=>Math.max(min,Math.min(max,Math.round(x/step)*step)));return uniq(vals);}
  function boolVals(v){return [Boolean(v),!Boolean(v)];}
  function validProfile(p){const e=p?.modules?.entry||{},x=p?.modules?.exit||{},c=p?.modules?.channel||{};if(Number(e.fastSma)>=Number(e.slowSma))return false;if(Number(e.macdFast)>=Number(e.macdSlow))return false;if(Number(x.rsiLower)>=Number(x.rsiUpper))return false;if(Number(c.multiplier)<=0)return false;return true;}
  function statOf(j){const s=j?.research?.backtest||{};return{pf:s.profitFactor==null?(Number(s.grossLoss||0)===0&&Number(s.grossProfit||0)>0?9:null):Number(s.profitFactor),net:Number(s.net||0),trades:Number(s.trades||0),wins:Number(s.wins||0),losses:Number(s.losses||0),winRate:Number(s.winRate||0)};}
  function score(st,base){const pf=Number.isFinite(st.pf)?Math.max(0,Math.min(5,st.pf)):0,baseNet=Math.max(1,Math.abs(Number(base?.net||0))),netNorm=(Math.tanh(Number(st.net||0)/baseNet)+1)/2,baseTrades=Math.max(1,Number(base?.trades||1)),tradeRatio=Math.min(1.5,Number(st.trades||0)/baseTrades)/1.5;let value=.52*(pf/5)+.33*netNorm+.15*tradeRatio;const minTrades=Math.max(6,Math.round(baseTrades*.35));if(st.trades<minTrades)value-=.25*(1-st.trades/minTrades);if(st.net<=0)value-=.08;return value;}
  function diffProfile(base,p){const items=[];const paths=["modules.entry.tf","modules.entry.fastSma","modules.entry.slowSma","modules.entry.atrLen","modules.entry.rsiLen","modules.entry.macdFast","modules.entry.macdSlow","modules.entry.macdSignal","modules.channel.tf","modules.channel.atrPeriod","modules.channel.multiplier","modules.channel.useRmaAtr","modules.exit.trendExitEnabled","modules.exit.exit1Enabled","modules.exit.exit1Tf","modules.exit.length","modules.exit.mult","modules.exit.lengthKC","modules.exit.multKC","modules.exit.useTrueRange","modules.exit.exit2Enabled","modules.exit.exit2Tf","modules.exit.lrcLength","modules.exit.exit3Enabled","modules.exit.exit3Tf","modules.exit.fisherLength","modules.exit.fisherThreshold","modules.exit.exit4Enabled","modules.exit.exit4Tf","modules.exit.rsiLength","modules.exit.rsiUpper","modules.exit.rsiLower","modules.controller.allowFlip"];
    for(const path of paths){const a=getPath(base,path),b=getPath(p,path);if(JSON.stringify(a)!==JSON.stringify(b))items.push(`${path.replace("modules.","")}: ${a}→${b}`);}return items;
  }
  function makeStages(p){const e=p.modules.entry,x=p.modules.exit,c=p.modules.channel,k=p.modules.controller;return[
    {group:"ENTRY",path:"modules.entry.tf",values:TFS},
    {group:"ENTRY",path:"modules.entry.fastSma",values:aroundInt(e.fastSma,2,80)},
    {group:"ENTRY",path:"modules.entry.slowSma",values:aroundInt(e.slowSma,5,150)},
    {group:"ENTRY",path:"modules.entry.atrLen",values:aroundInt(e.atrLen,2,60)},
    {group:"ENTRY",path:"modules.entry.rsiLen",values:aroundInt(e.rsiLen,2,60)},
    {group:"ENTRY",path:"modules.entry.macdFast",values:aroundInt(e.macdFast,1,40)},
    {group:"ENTRY",path:"modules.entry.macdSlow",values:aroundInt(e.macdSlow,2,80)},
    {group:"ENTRY",path:"modules.entry.macdSignal",values:aroundInt(e.macdSignal,1,40)},
    {group:"TREND/HOLD",path:"modules.channel.tf",values:TFS},
    {group:"TREND/HOLD",path:"modules.channel.atrPeriod",values:aroundInt(c.atrPeriod,2,60)},
    {group:"TREND/HOLD",path:"modules.channel.multiplier",values:aroundFloat(c.multiplier,.5,10,.1)},
    {group:"TREND/HOLD",path:"modules.channel.useRmaAtr",values:boolVals(c.useRmaAtr)},
    {group:"E1",path:"modules.exit.exit1Enabled",values:boolVals(x.exit1Enabled)},
    {group:"E1",path:"modules.exit.exit1Tf",values:TFS},
    {group:"E1",path:"modules.exit.length",values:aroundInt(x.length,3,60)},
    {group:"E1",path:"modules.exit.mult",values:aroundFloat(x.mult,.5,8,.1)},
    {group:"E1",path:"modules.exit.lengthKC",values:aroundInt(x.lengthKC,3,60)},
    {group:"E1",path:"modules.exit.multKC",values:aroundFloat(x.multKC,.5,5,.1)},
    {group:"E1",path:"modules.exit.useTrueRange",values:boolVals(x.useTrueRange)},
    {group:"E2",path:"modules.exit.exit2Enabled",values:boolVals(x.exit2Enabled)},
    {group:"E2",path:"modules.exit.exit2Tf",values:TFS},
    {group:"E2",path:"modules.exit.lrcLength",values:aroundInt(x.lrcLength,3,80)},
    {group:"E3",path:"modules.exit.exit3Enabled",values:boolVals(x.exit3Enabled)},
    {group:"E3",path:"modules.exit.exit3Tf",values:TFS},
    {group:"E3",path:"modules.exit.fisherLength",values:aroundInt(x.fisherLength,2,40)},
    {group:"E3",path:"modules.exit.fisherThreshold",values:aroundFloat(x.fisherThreshold,.2,4,.1)},
    {group:"E4",path:"modules.exit.exit4Enabled",values:boolVals(x.exit4Enabled)},
    {group:"E4",path:"modules.exit.exit4Tf",values:TFS},
    {group:"E4",path:"modules.exit.rsiLength",values:aroundInt(x.rsiLength,2,50)},
    {group:"E4",path:"modules.exit.rsiUpper",values:aroundInt(x.rsiUpper,55,90)},
    {group:"E4",path:"modules.exit.rsiLower",values:aroundInt(x.rsiLower,10,45)},
    {group:"TX",path:"modules.exit.trendExitEnabled",values:boolVals(x.trendExitEnabled)},
    {group:"CONTROLLER",path:"modules.controller.allowFlip",values:boolVals(k.allowFlip)},
  ];}
  async function loadSavedProfile(symbol){const j=await json(`${BACKEND}/ui/strategy-events?symbol=${encodeURIComponent(`${symbol}__V2_PROFILE`)}&_ts=${Date.now()}`),rows=(Array.isArray(j?.rows)?j.rows:[]).filter(r=>String(r?.source||"")==="cockpit_v2_profile").sort((a,b)=>Number(a.id||0)-Number(b.id||0)),last=rows.at(-1);if(!last)throw new Error(`Kein gespeichertes LIVE-Profil für ${symbol}`);let profile;try{profile=JSON.parse(String(last.reason||"{}"));}catch{throw new Error("LIVE-Profil ist kein gültiges JSON");}return{profile,id:Number(last.id||0),createdAt:last.created_at||""};}
  async function evaluate(symbol,profile){const j=await json(`${BACKEND}/cockpit-v2/research`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,view_tf:"1h",profile:{...profile,symbol}})});return statOf(j);}
  function renderResults(){if(!lastResults.length){body.innerHTML=`<div class="qv2-muted">Noch keine Ergebnisse.</div>`;return;}body.innerHTML=`<table class="qv2-table"><thead><tr><th>#</th><th>Score</th><th>PF</th><th>NET</th><th>Trades</th><th>Winrate</th><th>Änderungen zum LIVE-Profil</th><th>Profil</th></tr></thead><tbody>${lastResults.map((r,i)=>`<tr><td class="qv2-rank">${i+1}</td><td>${fmt(r.score,4)}</td><td class="${Number(r.stats.pf)>=Number(baseStats?.pf||0)?"qv2-pos":""}">${r.stats.pf==null?"—":fmt(r.stats.pf,3)}</td><td class="${r.stats.net>=0?"qv2-pos":"qv2-neg"}">${signed(r.stats.net)}</td><td>${r.stats.trades}</td><td>${fmt(r.stats.winRate,1)}%</td><td class="qv2-changes">${esc(r.diff.join(" · ")||"unverändert")}</td><td><button class="qv2-btn qv2-mini" data-copy="${i}">JSON KOPIEREN</button></td></tr>`).join("")}</tbody></table>`;for(const b of body.querySelectorAll("button[data-copy]")){b.onclick=async()=>{const r=lastResults[Number(b.dataset.copy)];try{await navigator.clipboard.writeText(JSON.stringify(r.profile,null,2));b.textContent="KOPIERT";setTimeout(()=>b.textContent="JSON KOPIEREN",1600);}catch{b.textContent="FEHLER";}};}}

  async function run(){if(running)return;running=true;cancelled=false;lastResults=[];startBtn.disabled=true;stopBtn.disabled=false;depthEl.disabled=true;progressEl.style.width="0%";try{
    currentSymbol=String(symbolSelect()?.value||"GOLD").toUpperCase();statusEl.textContent=`${currentSymbol}: gespeichertes LIVE-Profil wird geladen …`;
    const saved=await loadSavedProfile(currentSymbol);baseProfile=clone(saved.profile);statusEl.textContent=`${currentSymbol}: Baseline wird vollständig gerechnet …`;baseStats=await evaluate(currentSymbol,baseProfile);const baseScore=score(baseStats,baseStats);baseEl.innerHTML=`<b>${esc(currentSymbol)}</b> · LIVE Profil-ID ${saved.id} · Baseline PF <b>${baseStats.pf==null?"—":fmt(baseStats.pf,3)}</b> · NET <b>${signed(baseStats.net)}</b> · ${baseStats.trades} Trades · ${fmt(baseStats.winRate,1)}% Winrate`;
    let beam=[{profile:baseProfile,stats:baseStats,score:baseScore,diff:[]}],tested=1;const width=Math.max(2,Number(depthEl.value)||3),stages=makeStages(baseProfile),cache=new Map();cache.set(JSON.stringify(baseProfile),beam[0]);
    for(let si=0;si<stages.length;si++){
      if(cancelled)break;const st=stages[si],pool=[];statusEl.textContent=`${currentSymbol} · ${st.group} · ${st.path.replace("modules.","")} · Stufe ${si+1}/${stages.length} · ${tested} Varianten gerechnet`;
      for(const parent of beam){for(const value of st.values){if(cancelled)break;const candidate=setPath(parent.profile,st.path,value);if(!validProfile(candidate))continue;const key=JSON.stringify(candidate);let row=cache.get(key);if(!row){const stats=await evaluate(currentSymbol,candidate);tested+=1;row={profile:candidate,stats,score:score(stats,baseStats),diff:diffProfile(baseProfile,candidate)};cache.set(key,row);}pool.push(row);}}
      const dedup=new Map();for(const r of [...beam,...pool]){const k=JSON.stringify(r.profile);if(!dedup.has(k)||dedup.get(k).score<r.score)dedup.set(k,r);}beam=[...dedup.values()].sort((a,b)=>b.score-a.score||b.stats.net-a.stats.net||b.stats.trades-a.stats.trades).slice(0,width);lastResults=[...new Map([...lastResults,...beam].map(r=>[JSON.stringify(r.profile),r])).values()].sort((a,b)=>b.score-a.score||b.stats.net-a.stats.net).slice(0,12);progressEl.style.width=`${Math.round((si+1)/stages.length*100)}%`;renderResults();await new Promise(r=>setTimeout(r,0));
    }
    lastResults=[...new Map([...lastResults,...beam].map(r=>[JSON.stringify(r.profile),r])).values()].sort((a,b)=>b.score-a.score||b.stats.net-a.stats.net||b.stats.trades-a.stats.trades).slice(0,12);renderResults();statusEl.textContent=cancelled?`${currentSymbol}: gestoppt · ${tested} vollständige Varianten gerechnet`:`${currentSymbol}: FERTIG · ${tested} vollständige Varianten gerechnet · Top ${lastResults.length} angezeigt`;if(!cancelled)progressEl.style.width="100%";
  }catch(e){statusEl.textContent=`FEHLER: ${e?.message||e}`;}finally{running=false;startBtn.disabled=false;stopBtn.disabled=true;depthEl.disabled=false;}}

  startBtn.onclick=()=>void run();stopBtn.onclick=()=>{cancelled=true;statusEl.textContent="STOP angefordert · laufende Berechnung wird noch beendet …";};el("qv2-opt-close").onclick=()=>{overlay.style.display="none";};overlay.addEventListener("click",e=>{if(e.target===overlay&&!running)overlay.style.display="none";});btn.onclick=()=>{overlay.style.display="flex";};
  function toggle(){btn.style.display=document.body.innerText.includes("COCKPIT V2 · RENDER RESEARCH")?"block":"none";}
  new MutationObserver(toggle).observe(document.body,{subtree:true,childList:true,characterData:true});toggle();
})();
