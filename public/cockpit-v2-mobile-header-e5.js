(()=>{
 const css=document.createElement('style');css.textContent=`
 #qv2-mobile-stats{display:none}
 @media(max-width:1200px){
  html,body,#root{max-width:100vw!important;overflow-x:hidden!important}
  #root *{box-sizing:border-box}
  #root>div{width:100%!important;max-width:100vw!important;min-width:0!important}
  #root button,#root select,#root input{max-width:100%!important}
  #qv2-e5 .qe5-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
 }
 @media(max-width:900px){
  #qv2-e5 .qe5-grid{grid-template-columns:1fr!important}
 }
 @media(max-width:700px){#qv2-mobile-stats{display:block}}
 `;document.head.appendChild(css);
 let latest=null;const nativeFetch=window.fetch.bind(window);
 window.fetch=async function(input,init){const r=await nativeFetch(input,init);try{const url=String(typeof input==='string'?input:input?.url||'');if(url.includes('/cockpit-v2/research')&&!url.includes('oos')&&String(init?.method||'GET').toUpperCase()==='POST'){const j=await r.clone().json();latest=j?.research||j||null;setTimeout(update,20)}}catch{}return r};
 function stats(){const b=latest?.backtest;if(!b)return'';const pf=b.profitFactor==null?'—':Number(b.profitFactor).toFixed(3),net=Number(b.net||0);return`PF ${pf} · NET ${net>=0?'+':''}${net.toFixed(2)} · ${Number(b.trades||0)} Trades${latest?.e5_research?` · E5 ${Number(latest.e5_research.timed_exits||0)} X`:''}`}
 function findResearchPill(){return[...document.querySelectorAll('#root *')].find(x=>x.children.length===0&&/RESEARCH\s+.*PF/i.test(x.textContent||''))}
 function ensureStats(){const pill=findResearchPill();const txt=stats();if(pill&&txt){pill.textContent=`RESEARCH · ${txt}`;pill.style.whiteSpace='normal';pill.style.minWidth='0';pill.style.width='auto'}let x=document.querySelector('#qv2-mobile-stats');if(!x){x=document.createElement('div');x.id='qv2-mobile-stats';x.style.cssText='border:1px solid #155e75;background:#082f49;color:#a5f3fc;border-radius:7px;padding:7px 8px;font:800 12px Inter,system-ui;margin:6px 0';const h=document.querySelector('#root');h?.prepend(x)}x.textContent=txt||'PF / NET werden berechnet …'}
 function fixToolbar(){const all=[...document.querySelectorAll('#root button')];const take=all.find(b=>/ÜBERNEHMEN|LIVE.*PROFIL|PROFIL.*LIVE/i.test(b.textContent||''));if(!take)return;const row=take.parentElement;if(!row)return;row.style.display='flex';row.style.flexWrap='wrap';row.style.gap='6px';row.style.width='100%';row.style.maxWidth='100%';row.style.overflow='visible';[...row.children].forEach(el=>{el.style.minWidth='0';el.style.flex='1 1 110px'});take.style.order='-1';take.style.flex='1 1 160px';take.style.minWidth='140px'}
 function update(){ensureStats();fixToolbar()}
 setInterval(update,400);update();
})();