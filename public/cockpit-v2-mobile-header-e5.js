(()=>{
 const css=document.createElement('style');css.textContent=`
 #qv2-mobile-stats{display:none}
 @media(max-width:700px){
  #root>div>div:first-child{display:grid!important;grid-template-columns:1fr 1fr!important;gap:6px!important;align-items:stretch!important}
  #root>div>div:first-child>*{min-width:0!important;max-width:100%!important}
  #root>div>div:first-child>b{grid-column:1/-1;font-size:13px!important}
  #root>div>div:first-child>div{grid-column:1/-1;min-width:0!important;font-size:11px!important;padding:6px 8px!important;white-space:normal!important}
  #root>div>div:first-child>button{width:100%!important;padding:8px 5px!important;font-size:11px!important}
  #qv2-mobile-stats{display:block;grid-column:1/-1;border:1px solid #155e75;background:#082f49;color:#a5f3fc;border-radius:7px;padding:7px 8px;font:800 12px Inter,system-ui}
  #qv2-e5 .qe5-grid{grid-template-columns:1fr!important}
 }
 `;document.head.appendChild(css);
 let latest=null,lastMarkerKey='';const nativeFetch=window.fetch.bind(window);
 window.fetch=async function(input,init){const r=await nativeFetch(input,init);try{const url=String(typeof input==='string'?input:input?.url||'');if(url.includes('/cockpit-v2/research')&&!url.includes('oos')&&String(init?.method||'GET').toUpperCase()==='POST'){const c=r.clone(),j=await c.json();latest=j?.research||null;setTimeout(update,30);}}catch{}return r};
 function header(){return document.querySelector('#root>div>div:first-child')}
 function stats(){if(!latest?.backtest)return'';const b=latest.backtest,pf=b.profitFactor==null?'—':Number(b.profitFactor).toFixed(3),net=Number(b.net||0);return`PF ${pf} · NET ${net>=0?'+':''}${net.toFixed(2)} · ${Number(b.trades||0)} Trades${latest?.e5_research?` · E5 ${Number(latest.e5_research.timed_exits||0)} X`:''}`}
 function ensureStats(){const h=header();if(!h)return;let x=document.querySelector('#qv2-mobile-stats');if(!x){x=document.createElement('div');x.id='qv2-mobile-stats';h.appendChild(x)}x.textContent=stats()||'PF / NET werden berechnet …'}
 function e5Rows(){return(latest?.exit_rows||[]).filter(x=>String(x?.reason||'').startsWith('RESEARCH_')||String(x?.reason||'').startsWith('EXIT5_'))}
 function addMarkers(){const rows=e5Rows();if(!rows.length)return;const key=rows.map(x=>x.time).join(',');if(key===lastMarkerKey)return;lastMarkerKey=key;const host=document.querySelector('#root');if(!host)return;host.querySelectorAll('.qv2-e5-chart-label').forEach(x=>x.remove());const chart=host.querySelector('canvas')?.parentElement?.parentElement;if(!chart)return;/* native marker API is owned by React; labels are injected through its research rows by CockpitV2 in the next render */}
 function update(){ensureStats();addMarkers()}
 setInterval(update,500);
})();