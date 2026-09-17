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
  function render(){
    const host=findHost(); if(!host)return;
    let card=document.getElementById(CARD_ID);
    if(!card){
      card=document.createElement('div'); card.id=CARD_ID;
      card.style.cssText='margin-top:10px;border:1px solid #334155;border-radius:8px;padding:9px;background:#08111e;color:#dbe4ff;font:12px system-ui;';
      host.appendChild(card);
    }
    const rows=latest?.variants||latest?.results||[];
    const byPct=p=>rows.find(r=>Math.abs(Number(r.trail_pct??r.percent??r.pct)-p)<0.0001)||null;
    card.innerHTML=`<div style="font-weight:900;color:#67e8f9;margin-bottom:7px">TRAIL RESEARCH · nur Vergleich, NICHT LIVE</div>
      <div style="display:grid;grid-template-columns:58px 1fr 1fr 1fr 1fr;gap:4px;font-size:11px">
       <b>Trail</b><b>PF</b><b>NET</b><b>Trades</b><b>Trail X</b>
       ${TRAILS.map(p=>{const r=byPct(p)||{};return `<span>${p.toFixed(2)}%</span><span>${fmt(r.profitFactor??r.profit_factor,3)}</span><span>${signed(r.net)}</span><span>${r.trades??'—'}</span><span>${r.trail_exits??r.trailExits??'—'}</span>`}).join('')}
      </div><div style="margin-top:7px;color:#94a3b8;font-size:10px">Feste Varianten 0,25 / 0,35 / 0,50 / 0,75 / 1,00 %. Optimizer verändert sie nicht.</div>`;
  }
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{
    const res=await nativeFetch(...args);
    try{
      const url=typeof args[0]==='string'?args[0]:args[0]?.url||'';
      if(url.includes('/cockpit-v2/research')){
        const clone=res.clone(),j=await clone.json();
        latest=j?.research?.trail_research||j?.research?.trailResearch||null;
        queueMicrotask(render);
      }
    }catch{}
    return res;
  };
  new MutationObserver(()=>render()).observe(document.documentElement,{childList:true,subtree:true});
})();