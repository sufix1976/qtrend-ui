(() => {
  const BACKEND = "https://qtrend-trading-engine.onrender.com";
  const SYMBOLS = ["GOLD","US100","US30","DE40","J225","UK100","US500","BTCUSD","ETHUSD","SILVER","OIL_CRUDE","CORN"];
  const ALIASES = {
    GOLD:["GOLD"], US100:["US100","NASDAQ","NASDAQ 100"], US30:["US30","WALL STREET","DOW"],
    DE40:["DE40","GERMANY 40","DAX"], J225:["J225","JAPAN 225","NIKKEI"], UK100:["UK100","UK 100","FTSE"],
    US500:["US500","S&P 500","SP500"], BTCUSD:["BTCUSD","BITCOIN"], ETHUSD:["ETHUSD","ETHEREUM"],
    SILVER:["SILVER"], OIL_CRUDE:["OIL_CRUDE","CRUDE","US CRUDE","OIL"], CORN:["CORN"]
  };

  const css = `
  #qcap-btn{position:fixed;right:14px;bottom:14px;z-index:9998;background:#0e7490;color:#ecfeff;border:1px solid #22d3ee;border-radius:9px;padding:10px 14px;font:800 12px system-ui;box-shadow:0 8px 28px #0008;cursor:pointer;display:none}
  #qcap-overlay{position:fixed;inset:0;z-index:9999;background:#020617df;display:none;align-items:center;justify-content:center;padding:24px;font-family:Inter,system-ui;color:#dbeafe}
  #qcap-modal{width:min(1500px,96vw);height:min(900px,92vh);background:#08111f;border:1px solid #334155;border-radius:12px;display:grid;grid-template-rows:auto 1fr;overflow:hidden;box-shadow:0 20px 70px #000c}
  #qcap-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #334155;background:#0b1424;flex-wrap:wrap}
  #qcap-head b{color:#67e8f9;font-size:15px} #qcap-head .grow{flex:1} .qcap-btn{background:#111827;color:#e5eefc;border:1px solid #475569;border-radius:7px;padding:8px 11px;font-weight:800;cursor:pointer}.qcap-close{background:#991b1b}
  #qcap-body{overflow:auto;padding:12px;display:grid;gap:12px}.qcap-card{border:1px solid #24324a;border-radius:9px;background:#0a1220;padding:10px}.qcap-title{font-weight:900;color:#67e8f9;margin-bottom:8px}.qcap-cards{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:8px}.qcap-stat{border:1px solid #26364d;border-radius:7px;padding:9px;background:#07101c}.qcap-stat small{display:block;color:#94a3b8}.qcap-stat strong{font-size:18px;color:#f8fafc}
  .qcap-table-wrap{overflow:auto}.qcap-table{border-collapse:collapse;width:100%;min-width:900px;font-size:12px}.qcap-table th,.qcap-table td{border:1px solid #24324a;padding:7px 8px;text-align:left;white-space:nowrap}.qcap-table th{position:sticky;top:0;background:#102033;color:#67e8f9;z-index:1}.qcap-pos{color:#4ade80;font-weight:800}.qcap-neg{color:#fb7185;font-weight:800}.qcap-warn{color:#facc15;font-weight:900}.qcap-muted{color:#94a3b8}.qcap-error{padding:14px;border:1px solid #7f1d1d;background:#450a0a;color:#fecaca;border-radius:8px}.qcap-start{padding:8px 10px;border:1px solid #155e75;background:#082f49;color:#a5f3fc;border-radius:7px;font-weight:800}
  @media(max-width:800px){.qcap-cards{grid-template-columns:1fr 1fr}#qcap-overlay{padding:6px}#qcap-modal{width:99vw;height:96vh}}
  `;

  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  const btn = document.createElement("button"); btn.id="qcap-btn"; btn.textContent="CAPITAL DEMO"; document.body.appendChild(btn);
  const overlay = document.createElement("div"); overlay.id="qcap-overlay"; overlay.innerHTML=`<div id="qcap-modal"><div id="qcap-head"><b>CAPITAL DEMO · READ ONLY</b><span class="qcap-warn">SIZE NUR SIMULATION</span><span class="grow"></span><button class="qcap-btn" id="qcap-refresh">NEU LADEN</button><button class="qcap-btn qcap-close" id="qcap-close">SCHLIESSEN</button></div><div id="qcap-body"><div class="qcap-muted">Lade Capital-Daten …</div></div></div>`; document.body.appendChild(overlay);
  const body = overlay.querySelector("#qcap-body");
  overlay.querySelector("#qcap-close").onclick=()=>overlay.style.display="none";
  overlay.addEventListener("click",e=>{if(e.target===overlay)overlay.style.display="none";});

  const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toFixed(d):"—";
  const signed=(v,d=2)=>{const n=Number(v);return Number.isFinite(n)?`${n>=0?"+":""}${n.toFixed(d)}`:"—"};
  const cls=v=>Number(v)>0?"qcap-pos":Number(v)<0?"qcap-neg":"";
  const esc=v=>String(v??"—").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const deTime=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?String(v||"—"):d.toLocaleString("de-DE",{timeZone:"Europe/Berlin"});};
  async function json(url){const r=await fetch(url,{cache:"no-store"});const t=await r.text();let j;try{j=JSON.parse(t)}catch{throw new Error(`Keine JSON-Antwort (${r.status})`)}if(!r.ok||j?.ok===false)throw new Error(j?.error||j?.reason||`HTTP ${r.status}`);return j;}

  function matchStats(stats,symbol){
    const aliases=ALIASES[symbol]||[symbol];
    return stats.find(s=>aliases.some(a=>String(s.instrument||"").toUpperCase().includes(a)))||null;
  }

  async function load(){
    body.innerHTML=`<div class="qcap-muted">Lade Kontostand, offene Positionen und Trade-Historie …</div>`;
    try{
      const [cap,statuses]=await Promise.all([
        json(`${BACKEND}/cockpit-v2/capital-overview?historySeconds=${7*24*60*60}&_ts=${Date.now()}`),
        Promise.all(SYMBOLS.map(async symbol=>{try{const j=await json(`${BACKEND}/cockpit-v2/trading-status?symbol=${encodeURIComponent(symbol)}&_ts=${Date.now()}`);return{symbol,...j}}catch{return{symbol,config:null}}}))
      ]);
      const o=cap.overview||{},a=o.account||{},positions=o.positions||[],trades=o.closedTrades||[],liveTrades=o.liveClosedTrades||[],stats=o.liveTradeStats||o.tradeStats||[];
      const currency=a.currencySymbol||a.currency||"";
      const cards=`<div class="qcap-card"><div class="qcap-title">DEMOKONTO ${esc(a.accountName||"")}</div><div class="qcap-cards">
        <div class="qcap-stat"><small>Balance</small><strong>${esc(currency)} ${fmt(a.balance)}</strong></div>
        <div class="qcap-stat"><small>Aktuelles P/L</small><strong class="${cls(a.profitLoss)}">${esc(currency)} ${signed(a.profitLoss)}</strong></div>
        <div class="qcap-stat"><small>Verfügbar</small><strong>${esc(currency)} ${fmt(a.available)}</strong></div>
        <div class="qcap-stat"><small>Offene Positionen</small><strong>${positions.length}</strong></div>
        <div class="qcap-stat"><small>Live-Closings</small><strong>${liveTrades.length}</strong></div>
      </div><div class="qcap-muted" style="margin-top:7px">Konto ${esc(a.accountId||"—")} · ${esc(o.mode||"")} · aktualisiert ${esc(o.generatedAt||"")}</div></div>`;

      const startHtml=`<div class="qcap-start">LIVE-PF START · ${esc(deTime(o.liveStartUtc))} · Nur Capital-Trades ab diesem Zeitpunkt zählen für PF, NET und Size-Faktor. Ältere Trades bleiben unten nur zur Kontrolle sichtbar.</div>`;

      const posRows=positions.length?positions.map(p=>`<tr><td><b>${esc(p.epic)}</b></td><td class="${p.direction==='BUY'?'qcap-pos':'qcap-neg'}">${esc(p.direction)}</td><td>${fmt(p.size,3)}</td><td>${fmt(p.entry,4)}</td><td>${fmt(p.currentPrice,4)}</td><td class="${cls(p.upl)}">${signed(p.upl)}</td><td>${esc(p.currency)}</td><td>${esc(p.createdDateUTC)}</td><td>${esc(p.dealId)}</td></tr>`).join(""):`<tr><td colspan="9" class="qcap-muted">Keine offenen Positionen.</td></tr>`;
      const positionsHtml=`<div class="qcap-card"><div class="qcap-title">OFFENE CAPITAL-POSITIONEN</div><div class="qcap-table-wrap"><table class="qcap-table"><thead><tr><th>Instrument</th><th>Richtung</th><th>Size</th><th>Entry</th><th>Aktuell</th><th>UPL</th><th>Währung</th><th>Eröffnet</th><th>Deal-ID</th></tr></thead><tbody>${posRows}</tbody></table></div></div>`;

      const simRows=statuses.map(st=>{const base=Number(st?.config?.size);const s=matchStats(stats,st.symbol);const factor=Number(s?.simulatedSizeFactor||1);const simulated=Number.isFinite(base)?base*factor:null;return`<tr><td><b>${st.symbol}</b></td><td>${fmt(base,3)}</td><td>${s?.trades??0}</td><td>${s?.profitFactor==null?"—":fmt(s.profitFactor,3)}</td><td class="${cls(s?.net)}">${signed(s?.net)}</td><td>${fmt(factor,2)}×</td><td class="qcap-warn">${fmt(simulated,3)}</td><td>${st?.config?.auto_enabled?'<span class="qcap-pos">ON</span>':'OFF'}</td></tr>`}).join("");
      const simHtml=`<div class="qcap-card"><div class="qcap-title">LIVE-PF / SIZE-SIMULATION · NICHT AKTIV</div><div class="qcap-muted" style="margin-bottom:8px">Nur abgeschlossene Capital-Trades seit dem Live-PF-Start zählen. PF&lt;0,9 → 0,50× · 0,9–1,2 → 0,75× · 1,2–1,8 → 1,00× · 1,8–2,5 → 1,10× · ≥2,5 → 1,25×. Unter 6 neuen Trades bleibt jedes Instrument bei 1,00×.</div><div class="qcap-table-wrap"><table class="qcap-table"><thead><tr><th>Instrument</th><th>Basis-Size</th><th>Live Trades</th><th>Live PF</th><th>Live NET</th><th>Faktor</th><th>Sim Size</th><th>AUTO</th></tr></thead><tbody>${simRows}</tbody></table></div></div>`;

      const tradeRows=trades.slice(0,50).map(t=>`<tr><td>${esc(t.dateUtc)}</td><td><b>${esc(t.instrument)}</b></td><td>${esc(t.note)}</td><td class="${cls(t.amount)}">${signed(t.amount)}</td><td>${esc(t.currency)}</td><td>${esc(t.reference)}</td><td>${esc(t.status)}</td></tr>`).join("")||`<tr><td colspan="7" class="qcap-muted">Keine geschlossenen TRADE-Transaktionen im Zeitraum.</td></tr>`;
      const tradesHtml=`<div class="qcap-card"><div class="qcap-title">GESCHLOSSENE TRADES · CAPITAL · LETZTE 7 TAGE · NUR KONTROLLE</div><div class="qcap-table-wrap"><table class="qcap-table"><thead><tr><th>Zeit</th><th>Instrument</th><th>Notiz</th><th>Betrag</th><th>Währung</th><th>Referenz</th><th>Status</th></tr></thead><tbody>${tradeRows}</tbody></table></div></div>`;
      body.innerHTML=cards+startHtml+positionsHtml+simHtml+tradesHtml;
    }catch(e){body.innerHTML=`<div class="qcap-error"><b>Capital konnte nicht geladen werden.</b><br>${esc(e?.message||e)}</div>`;}
  }

  btn.onclick=()=>{overlay.style.display="flex";void load();};
  overlay.querySelector("#qcap-refresh").onclick=()=>void load();
  function toggle(){btn.style.display=document.body.innerText.includes("COCKPIT V2 · RENDER RESEARCH")?"block":"none";}
  const obs=new MutationObserver(()=>toggle());obs.observe(document.body,{subtree:true,childList:true,characterData:true});toggle();
})();
