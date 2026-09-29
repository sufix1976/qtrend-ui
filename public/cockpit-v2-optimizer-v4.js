(() => {
  const API = 'https://qtrend-trading-engine.onrender.com/cockpit-v2/research';
  const clone = value => JSON.parse(JSON.stringify(value));
  const money = value => value === Infinity ? '∞' : Number.isFinite(value) ? value.toFixed(2) : '—';
  const signed = value => `${value >= 0 ? '+' : ''}${money(value)}`;
  const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const btn = document.createElement('button');
  btn.textContent = 'OPTIMIZER V4';
  btn.id = 'qv4-button';
  const style = document.createElement('style');
  style.textContent = `#qv4-button{position:fixed;right:285px;bottom:14px;z-index:9997;background:#075985;color:white;border:1px solid #38bdf8;border-radius:9px;padding:10px 14px;font:900 12px system-ui;cursor:pointer;display:none}#qv4-overlay{position:fixed;inset:0;z-index:10021;background:#020617ed;display:none;align-items:center;justify-content:center;padding:12px;font:13px system-ui;color:#dbeafe}#qv4-panel{width:min(1550px,99vw);height:min(900px,96vh);display:flex;flex-direction:column;background:#08111f;border:1px solid #475569;border-radius:12px;overflow:hidden}#qv4-head{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px;border-bottom:1px solid #334155}#qv4-head b{color:#67e8f9;font-size:16px}#qv4-head button,.qv4-action{background:#123047;color:white;border:1px solid #38bdf8;padding:7px 10px;border-radius:6px;cursor:pointer;font-weight:bold}#qv4-head button:disabled{opacity:.5}#qv4-head input{width:58px;background:#0f172a;color:white;border:1px solid #64748b;border-radius:5px;padding:5px}#qv4-body{overflow:auto;padding:12px}#qv4-status{padding:9px 12px;background:#082f49;border-bottom:1px solid #155e75}#qv4-body table{width:100%;border-collapse:collapse;min-width:1050px;font-size:12px}#qv4-body th,#qv4-body td{padding:7px;border:1px solid #334155;text-align:left}#qv4-body th{background:#142338;position:sticky;top:0}#qv4-body .bad{color:#fca5a5}#qv4-body .good{color:#86efac}#qv4-body small{color:#94a3b8}`;
  document.head.appendChild(style);
  document.body.appendChild(btn);
  const overlay = document.createElement('div');
  overlay.id = 'qv4-overlay';
  overlay.innerHTML = `<div id="qv4-panel"><div id="qv4-head"><b>OPTIMIZER V4 · TREND MAGIC</b><label>Mind. Training-Trades <input id="qv4-min" type="number" min="15" value="40"></label><label>Breiter suchen <input id="qv4-wide" type="checkbox"></label><button id="qv4-start">START</button><button id="qv4-stop" disabled>STOP</button><button id="qv4-close">SCHLIESSEN</button></div><div id="qv4-status">Research-Prüfung; V3 bleibt separat verfügbar.</div><div id="qv4-body"><p>Einzeländerungen, gezielte Kombinationen und ein späterer Prüfzeitraum. Keine automatische Übernahme ins LIVE-Profil.</p></div></div>`;
  document.body.appendChild(overlay);
  const byId = id => overlay.querySelector(`#${id}`);
  const status = byId('qv4-status');
  const body = byId('qv4-body');
  let stopped = false, running = false, results = [], baseline = null, symbol = '', cut = 0, digest = '';

  function variants(profile, wide) {
    const m = profile.magicStrategy, all = [];
    const add = (group, key, options) => {
      for (const value of options) {
        if (value == null || Object.is(value, m[key])) continue;
        const p = clone(profile); p.magicStrategy[key] = value;
        if (!p.magicStrategy.flipEntryEnabled && !p.magicStrategy.pullbackEntryEnabled) continue;
        if (Number(p.magicStrategy.lockedProfitPct) >= Number(p.magicStrategy.lockTriggerPct)) continue;
        all.push({group, changes: {[key]: value}, profile: p, label: `${key}: ${m[key]} → ${value}`});
      }
    };
    const ints = (n, low, high) => [n-1,n+1,...(wide?[n-2,n+2]:[])].filter(v=>v>=low&&v<=high);
    const steps = (n, low, high) => [n-.5,n+.5,...(wide?[n-1,n+1]:[])].map(v=>Math.round(v*100)/100).filter(v=>v>=low&&v<=high);
    add('Trend','trendMode',['MAGIC','SHADOW','HYBRID']);
    add('Trend','calcTf',['1m','5m','15m']);
    add('Trend','shadowFullCandle',[!m.shadowFullCandle]);
    add('Trend','shadowAtrPeriod',ints(Number(m.shadowAtrPeriod),2,100));
    add('Trend','shadowAtrMultiplier',steps(Number(m.shadowAtrMultiplier),.1,10));
    add('Trend','tf',['1m','5m','15m','30m','1h']);
    add('Trend','cciPeriod',ints(Number(m.cciPeriod),2,100));
    add('Trend','atrPeriod',ints(Number(m.atrPeriod),2,100));
    add('Trend','atrMultiplier',steps(Number(m.atrMultiplier),.1,10));
    add('Trend','cciSource',['close','hlc3']);
    add('Entry','flipEntryEnabled',[!m.flipEntryEnabled]);
    add('Entry','pullbackEntryEnabled',[!m.pullbackEntryEnabled]);
    add('Entry','nearPoints',steps(Number(m.nearPoints),0,100));
    add('Exit','atrTrailEnabled',[!m.atrTrailEnabled]);
    add('Exit','lineTouchExitEnabled',[!m.lineTouchExitEnabled]);
    add('Exit','rsiExitEnabled',[!m.rsiExitEnabled]);
    add('Exit','trailAtrPeriod',ints(Number(m.trailAtrPeriod),2,100));
    add('Exit','trailAtrMultiplier',steps(Number(m.trailAtrMultiplier),.1,10));
    add('Exit','trailActivationAtr',steps(Number(m.trailActivationAtr),0,10));
    if (m.rsiExitEnabled) {
      add('Exit','rsiTf',['1m','5m','15m','30m','1h']);
      add('Exit','rsiLength',ints(Number(m.rsiLength),2,100));
      add('Exit','wmaLength',ints(Number(m.wmaLength),2,100));
    }
    return all;
  }

  function stats(trades, spreadFactor = 1) {
    let net=0, profit=0, loss=0, wins=0, flipLosses=0;
    const reasons={};
    for (const t of trades) {
      const pnl=Number(t.raw_pnl)-spreadFactor*Number(t.spread_cost);
      net+=pnl; if(pnl>=0){profit+=pnl;wins++;}else loss-=pnl;
      const reason=String(t.exit_reason||'ANDERER EXIT');
      const r=reasons[reason]||(reasons[reason]={count:0,net:0});r.count++;r.net+=pnl;
      if(reason==='MAGIC_TREND_FLIP_EXIT'&&pnl<0)flipLosses++;
    }
    return {trades:trades.length,net,pf:loss?profit/loss:(profit?Infinity:null),wins,flipLosses,reasons,perTrade:trades.length?net/trades.length:null};
  }
  function assess(trades, start, end, threshold) {
    const train=trades.filter(t=>Number(t.entry_time)>=start&&Number(t.exit_time)<end);
    const segments=Array.from({length:3},(_,i)=>stats(train.filter(t=>Number(t.entry_time)>=start+(end-start)*i/3&&Number(t.entry_time)<start+(end-start)*(i+1)/3)));
    const total=stats(train), stress=stats(train,1.5), valid=total.trades>=threshold&&segments.every(s=>s.trades>=5);
    const worst=Math.min(...segments.map(s=>s.perTrade??-Infinity));
    const score=valid?total.perTrade-.35*Math.max(0,-worst):-Infinity;
    return {total,segments,stress,valid,score};
  }
  async function evaluate(profile, snapshot) {
    const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,view_tf:'1h',__optimizerDiagnostic:true,profile:{...profile,symbol,__optimizerChannel2Passthrough:true}})});
    if(!response.ok)throw new Error(`Research HTTP ${response.status}`);
    const json=await response.json(),r=json?.research;
    if(r?.profile?.strategyMode!=='MAGIC_PULLBACK'||!r?.backtest||!Array.isArray(r.backtest.closedTrades))throw new Error('Keine gültige Trend-Magic-Research-Antwort.');
    const actual=r.profile.magicStrategy||{};
    for(const key of Object.keys(profile.magicStrategy))if(JSON.stringify(actual[key])!==JSON.stringify(profile.magicStrategy[key]))throw new Error(`Server hat ${key} verändert.`);
    const hash=String(r.base_candle_digest||'');
    if(!hash)throw new Error('Research-Server liefert noch keinen 1m-Daten-Fingerabdruck. V4 wird erst nach dem Server-Update gestartet.');
    if(snapshot&&hash!==digest)throw new Error('1m-Daten haben sich während des Laufs geändert. Ergebnisse verworfen; bitte neu starten.');
    const first=Number(r.chart_candles?.[0]?.time),last=Number(r.chart_candles?.at(-1)?.time);
    if(!Number.isFinite(first)||!Number.isFinite(last)||last<=first)throw new Error('Ungültiges Datenfenster.');
    if(snapshot&&(first!==baseline.first||last!==baseline.last||Number(r.base_candle_count)!==baseline.count))throw new Error('Datenfenster hat sich während des Laufs geändert.');
    return {trades:r.backtest.closedTrades,first,last,count:Number(r.base_candle_count),hash};
  }
  function render() {
    const trainEnd=cut, visible=results.slice().sort((a,b)=>b.train.score-a.train.score);
    body.innerHTML=`<p><b>${esc(symbol)}</b> · ${baseline?.count||0} × 1m · Training: ${new Date(baseline.first*1000).toISOString().slice(0,16)} bis ${new Date(trainEnd*1000).toISOString().slice(0,16)} UTC · Prüfung danach bis ${new Date(baseline.last*1000).toISOString().slice(0,16)} UTC. Trade am Schnitt wird ausgelassen. Trainingsminimum ${Number(byId('qv4-min').value)||40}; je Drittel mindestens 5. Spread-Stress = 1,5 × eingestellter Spread.</p><p><small>Rangfolge nur anhand der ersten 70 %; spätere Daten erscheinen ausschließlich für die vorher festgelegten Finalisten. Unter 20 Trades im Prüfzeitraum ist das Resultat dünn. PF ist Diagnose. Kein automatischer LIVE-Wechsel und keine Simulation des separaten Broker-Schutzstops.</small></p><table><thead><tr><th>#</th><th>Änderung</th><th>Training Trades</th><th>Training Netto</th><th>PF</th><th>Drittel Netto</th><th>Spread ×1,5 Netto</th><th>Trendwechsel-Verluste</th><th>Späterer Prüfzeitraum</th><th>Aktion</th></tr></thead><tbody>${visible.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.label)}</td><td>${r.train.total.trades}${r.train.valid?'':' ⚠'}</td><td class="${r.train.total.net>=0?'good':'bad'}">${signed(r.train.total.net)}</td><td>${money(r.train.total.pf)}</td><td>${r.train.segments.map(s=>`${s.trades}: ${signed(s.net)}`).join(' / ')}</td><td>${signed(r.train.stress.net)}</td><td>${r.train.total.flipLosses}</td><td>${r.final?`${r.holdout.trades} Trades${r.holdout.trades<20?' ⚠ wenig':''} · ${signed(r.holdout.net)} · PF ${money(r.holdout.pf)}`:'gesperrt'}</td><td><button class="qv4-action" data-profile="${results.indexOf(r)}">IN RESEARCH</button></td></tr>`).join('')}</tbody></table><details><summary>Exit-Ursachen der Basis im Training</summary><table><thead><tr><th>Exit</th><th>Trades</th><th>Netto</th></tr></thead><tbody>${Object.entries(results[0]?.train.total.reasons||{}).map(([name,r])=>`<tr><td>${esc(name)}</td><td>${r.count}</td><td>${signed(r.net)}</td></tr>`).join('')}</tbody></table></details>`;
    body.querySelectorAll('[data-profile]').forEach(button=>button.onclick=()=>{const r=results[Number(button.dataset.profile)];overlay.style.display='none';window.dispatchEvent(new CustomEvent('qtrend:cockpit-v2:load-research-profile',{detail:{symbol,profile:clone(r.profile)}}));});
  }
  async function run() {
    if(running)return;
    running=true;stopped=false;results=[];baseline=null;byId('qv4-start').disabled=true;byId('qv4-stop').disabled=false;
    try {
      const p=window.__qtrendCockpitV2ResearchProfile;
      if(p?.strategyMode!=='MAGIC_PULLBACK')throw new Error('Trend Magic im Cockpit auswählen.');
      symbol=String(p.symbol||'').toUpperCase();if(!symbol)throw new Error('Instrument fehlt.');
      const threshold=Math.max(15,Math.round(Number(byId('qv4-min').value)||40));
      const baseProfile=clone(p);status.textContent=`${symbol}: Basis und 1m-Datenstand prüfen …`;
      const base=await evaluate(baseProfile,false);baseline=base;digest=base.hash;
      cut=base.first+Math.floor((base.last-base.first)*.7);
      const trainEnd=cut;
      const put=(variant,data)=>{const train=assess(data.trades,base.first,trainEnd,threshold);results.push({...variant,train,final:false,holdout:null});};
      put({group:'Basis',label:'Aktuelles Research-Profil',profile:baseProfile,changes:{}},base);
      const singles=variants(baseProfile,byId('qv4-wide').checked);
      for(let i=0;i<singles.length&&!stopped;i++){
        status.textContent=`${symbol}: Einzeländerung ${i+1}/${singles.length} · ${singles[i].label}`;
        put(singles[i],await evaluate(singles[i].profile,true));render();
      }
      if(stopped){status.textContent='Gestoppt. Kein Prüfzeitraum freigegeben.';return;}
      const best=group=>results.filter(r=>r.group===group&&r.train.valid&&r.train.score>results[0].train.score).sort((a,b)=>b.train.score-a.train.score).slice(0,2);
      const pairs=[];
      for(const [ga,gb] of [['Trend','Entry'],['Trend','Exit'],['Entry','Exit']])for(const a of best(ga))for(const b of best(gb)){
        const combined=clone(baseProfile);Object.assign(combined.magicStrategy,a.changes,b.changes);
        if(!combined.magicStrategy.flipEntryEnabled&&!combined.magicStrategy.pullbackEntryEnabled)continue;
        pairs.push({group:'Kombination',label:`${a.label} · ${b.label}`,changes:{...a.changes,...b.changes},profile:combined});
      }
      for(let i=0;i<pairs.length&&!stopped;i++){
        status.textContent=`${symbol}: Kombination ${i+1}/${pairs.length}`;
        put(pairs[i],await evaluate(pairs[i].profile,true));render();
      }
      if(stopped){status.textContent='Gestoppt. Kein Prüfzeitraum freigegeben.';return;}
      // Selection is frozen before any holdout result is calculated or rendered.
      const finalists=[results[0],...results.slice(1).filter(r=>r.train.valid).sort((a,b)=>b.train.score-a.train.score).slice(0,3)];
      for(const f of finalists){
        const research=await evaluate(f.profile,true);
        const test=research.trades.filter(t=>Number(t.entry_time)>=cut&&Number(t.exit_time)<=base.last+3600);
        f.holdout=stats(test);f.final=true;
      }
      render();status.textContent=`${symbol}: ${results.length} Profile geprüft · ${finalists.length} vorher ausgewählte Finalisten im späteren Zeitraum angezeigt. V3 und LIVE unverändert.`;
    } catch(error) {status.textContent=`FEHLER: ${error?.message||error}`;}
    finally {running=false;byId('qv4-start').disabled=false;byId('qv4-stop').disabled=true;}
  }
  btn.onclick=()=>{overlay.style.display='flex';};
  byId('qv4-close').onclick=()=>{overlay.style.display='none';};
  byId('qv4-start').onclick=()=>void run();
  byId('qv4-stop').onclick=()=>{stopped=true;};
  function availability(){btn.style.display=window.__qtrendCockpitV2ResearchProfile?.strategyMode==='MAGIC_PULLBACK'?'block':'none';}
  setInterval(availability,1800);availability();
})();
