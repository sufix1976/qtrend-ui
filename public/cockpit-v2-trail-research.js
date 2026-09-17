(()=>{
  const CARD_ID='qv2-trail-research-card';
  const TRAILS=[0.25,0.35,0.50,0.75,1.00];
  let latest=null;
  const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
  const signed=v=>Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${Number(v).toFixed(2)}`:'—';
  function findHost(){
    const buttons=[...document.querySelectorAll('button')];
    const exit=buttons.find(b=>String(b.textContent||'').trim()==='EXIT');
    if(!exit)return null;
    return exit.closest('section')||exit.parentElement?.parentElement||null;
  }
  function rows(){return latest?.trails||latest?.variants||latest?.results||[];}
  function render(){
    const host=findHost(); if(!host)return false;
    let card=document.getElementById(CARD_ID);
    if(!card){card=document.createElement('div');card.id=CARD_ID;card.style.cssText='margin-top:10px;border:1px solid #334155;border-radius:8px;padding:9px;background:#08111e;color:#dbe4ff;font:12px system-ui;';host.appendChild(card);}
    const data=rows();const byPct=p=>data.find(r=>Math.abs(Number(r.pct??r.trail_pct??r.percent)-p)<0.0001)||null;
    card.innerHTML=`<div style="font-weight:900;color:#67e8f9;margin-bottom:7px">TRAIL RESEARCH · nur Vergleich, NICHT LIVE</div><div style="display:grid;grid-template-columns:58px 1fr 1fr 1fr 1fr;gap:4px;font-size:11px"><b>Trail</b><b>PF</b><b>NET</b><b>Trades</b><b>Trail X</b>${TRAILS.map(p=>{const r=byPct(p)||{};return `<span>${p.toFixed(2)}%</span><span>${fmt(r.profitFactor??r.profit_factor,3)}</span><span>${signed(r.net)}</span><span>${r.trades??'—'}</span><span>${r.trail_exits??r.trailExits??'—'}</span>`}).join('')}</div><div style="margin-top:7px;color:#94a3b8;font-size:10px">Feste Varianten 0,25 / 0,35 / 0,50 / 0,75 / 1,00 %. Optimizer verändert sie nicht.</div>`;
    return true;
  }
  function dispatchMarkers(){
    const variants=rows();
    const markers=[];
    for(const v of variants){const pct=Number(v.pct??v.trail_pct??v.percent);for(const t of v.closedTrades||v.closed_trades||[]){if(String(t.exit_reason)!=='TRAIL_PERCENT')continue;markers.push({time:Number(t.exit_time),price:Number(t.exit_price),side:String(t.side||''),pct,label:`T${pct}%`});}}
    window.dispatchEvent(new CustomEvent('qtrend:cockpit-v2:trail-research',{detail:{variants,markers}}));
  }
  function renderWhenReady(attempt=0){if(render()||attempt>=20)return;setTimeout(()=>renderWhenReady(attempt+1),250);}
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{
    const res=await nativeFetch(...args);
    try{const url=typeof args[0]==='string'?args[0]:args[0]?.url||'';if(url.includes('/cockpit-v2/research')){const j=await res.clone().json();latest=j?.research?.trail_research||j?.research?.trailResearch||null;queueMicrotask(()=>{renderWhenReady();dispatchMarkers();});}}catch{}
    return res;
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>renderWhenReady(),{once:true});else renderWhenReady();
})();