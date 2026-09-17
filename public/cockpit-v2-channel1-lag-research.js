(()=>{
  const CARD_ID='qv2-channel1-lag-research-card';
  const LEVELS=[0.25,0.50,0.75,1.00,1.50,2.00];
  let latest=null;
  const fmt=(v,d=3)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
  const signed=v=>Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${Number(v).toFixed(2)}`:'—';
  function findHost(){
    const trail=document.getElementById('qv2-trail-research-card');
    if(trail?.parentElement)return {host:trail.parentElement,after:trail};
    const buttons=[...document.querySelectorAll('button')];
    const exit=buttons.find(b=>String(b.textContent||'').trim()==='EXIT');
    const host=exit?.closest('section')||exit?.parentElement?.parentElement||null;
    return host?{host,after:null}:null;
  }
  function rows(){return latest?.buckets||[];}
  function render(){
    const target=findHost();if(!target)return false;
    let card=document.getElementById(CARD_ID);
    if(!card){card=document.createElement('div');card.id=CARD_ID;card.style.cssText='margin-top:10px;border:1px solid #334155;border-radius:8px;padding:9px;background:#08111e;color:#dbe4ff;font:12px system-ui;';if(target.after?.nextSibling)target.host.insertBefore(card,target.after.nextSibling);else target.host.appendChild(card);}
    if(latest?.active===false){card.innerHTML='<div style="font-weight:900;color:#67e8f9">CHANNEL 1 LAG RESEARCH · Channel 1 nicht aktiv</div>';return true;}
    const data=rows();const byLevel=p=>data.find(r=>Math.abs(Number(r.threshold_pct)-p)<0.0001)||{};
    card.innerHTML=`<div style="font-weight:900;color:#67e8f9;margin-bottom:7px">CHANNEL 1 LAG RESEARCH · nur Diagnose, NICHT LIVE</div><div style="display:grid;grid-template-columns:70px 1fr 1fr 1fr 1fr 1fr;gap:4px;font-size:11px"><b>Gegenlauf</b><b>PF</b><b>NET</b><b>Trades</b><b>Wins</b><b>Losses</b>${LEVELS.map(p=>{const r=byLevel(p);return `<span>${p.toFixed(2)}%</span><span>${fmt(r.profitFactor??r.profit_factor)}</span><span>${signed(r.net)}</span><span>${r.trades??'—'}</span><span>${r.wins??'—'}</span><span>${r.losses??'—'}</span>`}).join('')}</div><div style="margin-top:7px;color:#94a3b8;font-size:10px">Misst Entries, wenn Channel 1 noch UP/DOWN zeigt, der Markt aber seit dem Extrem bereits deutlich dagegen gelaufen ist. Keine Änderung an Controller oder LIVE.</div>`;
    return true;
  }
  function renderWhenReady(attempt=0){if(render()||attempt>=20)return;setTimeout(()=>renderWhenReady(attempt+1),250);}
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{
    const res=await nativeFetch(...args);
    try{const url=typeof args[0]==='string'?args[0]:args[0]?.url||'';if(url.includes('/cockpit-v2/research')){const j=await res.clone().json();latest=j?.research?.channel1_lag_research||j?.research?.channel1LagResearch||null;queueMicrotask(()=>renderWhenReady());}}catch{}
    return res;
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>renderWhenReady(),{once:true});else renderWhenReady();
})();