(()=>{
  // UI-only adapter for reverse-exit entry research candidates R1-R4.
  // It never writes profiles/events and never touches controller/AUTO/execution.
  const nativeFetch=window.fetch.bind(window);
  const bySymbol=new Map(),statsBySymbol=new Map();
  const symbols=new Set(["GOLD","US100","US30","DE40","J225","UK100","US500","BTCUSD","ETHUSD","SILVER","OIL_CRUDE","CORN"]);
  const currentSymbol=()=>{for(const el of document.querySelectorAll('select')){const v=String(el.value||'').toUpperCase();if(symbols.has(v))return v;}return 'GOLD';};
  const jsonResponse=(json,response)=>new Response(JSON.stringify(json),{status:response.status,statusText:response.statusText,headers:response.headers});
  const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';
  window.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:String(input?.url||'');
    const response=await nativeFetch(input,init);
    try{
      if(response.ok&&url.includes('/cockpit-v2/research')){
        const clone=response.clone(),json=await clone.json(),research=json?.research;
        if(research){
          const symbol=String(research.symbol||currentSymbol()).toUpperCase();
          bySymbol.set(symbol,Array.isArray(research.reverse_entry_research_rows)?research.reverse_entry_research_rows:[]);
          if(research.reverse_entry_forward_stats)statsBySymbol.set(symbol,research.reverse_entry_forward_stats);
          setTimeout(renderStats,0);
        }
        return response;
      }
      if(response.ok&&url.includes('/ui/strategy-events')){
        const symbol=currentSymbol(),rows=bySymbol.get(symbol)||[];
        if(!rows.length)return response;
        const clone=response.clone(),json=await clone.json();
        if(!json||!Array.isArray(json.rows))return response;
        const fake=rows.map((r,i)=>({id:-900000-i,symbol,tf:'research',side:'research',time:Number(r.time)||0,price:0,source:'cockpit_v2_execution_status',reason:JSON.stringify({label:String(r.label||`${r.research_id||'R?'} ${String(r.entry||'').toUpperCase()==='LONG'?'L':'S'}`),status:'research_only',action:String(r.entry||''),event_id:`research:${r.research_id||'R'}:${r.time||0}`})}));
        return jsonResponse({...json,rows:[...json.rows,...fake]},response);
      }
    }catch{}
    return response;
  };
  function renderStats(){
    const s=currentSymbol(),data=statsBySymbol.get(s),old=document.querySelector('[data-qv2-r-stats]');
    if(!data?.summary?.length){if(old)old.remove();return;}
    const inspector=[...document.querySelectorAll('b')].find(x=>String(x.textContent||'').includes('INSPECTOR · RESEARCH'))?.parentElement;
    if(!inspector)return;
    if(old&&old.dataset.qv2Symbol===s){fill(old,data);return;}if(old)old.remove();
    const box=document.createElement('div');box.dataset.qv2RStats='1';box.dataset.qv2Symbol=s;Object.assign(box.style,{marginTop:'12px',borderTop:'1px solid #334155',paddingTop:'9px',fontSize:'10px'});inspector.appendChild(box);fill(box,data);
  }
  function fill(box,data){
    const rows=data.summary||[],hs=data.horizons||[5,10,20];
    let html='<b style="color:#f9a8d4;font-size:11px">R1–R4 · FORWARD TEST</b><div style="color:#94a3b8;margin:3px 0 6px">MFE / MAE / Ende% · reine Research-Messung</div><div style="overflow:auto"><table style="border-collapse:collapse;width:100%;white-space:nowrap"><thead><tr><th style="text-align:left;padding:3px">R</th><th style="padding:3px">n</th>';
    for(const h of hs)html+=`<th style="padding:3px">${h} Bars</th>`;html+='</tr></thead><tbody>';
    for(const r of rows){html+=`<tr><td style="padding:3px;color:#f9a8d4;font-weight:800">${r.label}</td><td style="padding:3px;text-align:center">${r.count}</td>`;for(const h of hs){const x=r.horizons?.[h];html+=`<td style="padding:3px;text-align:right">${x?`${fmt(x.avg_mfe)} / ${fmt(x.avg_mae)} / ${fmt(x.positive_close_pct)}%`:'—'}</td>`;}html+='</tr>';}
    html+='</tbody></table></div>';box.innerHTML=html;
  }
  new MutationObserver(renderStats).observe(document.documentElement,{subtree:true,childList:true});
  setInterval(renderStats,700);renderStats();
})();
