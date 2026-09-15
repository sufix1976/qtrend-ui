(()=>{
  // UI-only adapter for reverse-exit entry research candidates R1-R4.
  // It never writes profiles/events and never touches controller/AUTO/execution.
  const nativeFetch=window.fetch.bind(window);
  const bySymbol=new Map();
  const symbols=new Set(["GOLD","US100","US30","DE40","J225","UK100","US500","BTCUSD","ETHUSD","SILVER","OIL_CRUDE","CORN"]);
  const currentSymbol=()=>{for(const el of document.querySelectorAll('select')){const v=String(el.value||'').toUpperCase();if(symbols.has(v))return v;}return 'GOLD';};
  const jsonResponse=(json,response)=>new Response(JSON.stringify(json),{status:response.status,statusText:response.statusText,headers:response.headers});
  window.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:String(input?.url||'');
    const response=await nativeFetch(input,init);
    try{
      if(response.ok&&url.includes('/cockpit-v2/research')){
        const clone=response.clone(),json=await clone.json(),research=json?.research;
        if(research){
          const symbol=String(research.symbol||currentSymbol()).toUpperCase();
          bySymbol.set(symbol,Array.isArray(research.reverse_entry_research_rows)?research.reverse_entry_research_rows:[]);
        }
        return response;
      }
      if(response.ok&&url.includes('/ui/strategy-events')){
        const symbol=currentSymbol(),rows=bySymbol.get(symbol)||[];
        if(!rows.length)return response;
        const clone=response.clone(),json=await clone.json();
        if(!json||!Array.isArray(json.rows))return response;
        const fake=rows.map((r,i)=>({
          id:-900000-i,
          symbol,
          tf:'research',
          side:'research',
          time:Number(r.time)||0,
          price:0,
          source:'cockpit_v2_execution_status',
          reason:JSON.stringify({label:String(r.label||`${r.research_id||'R?'} ${String(r.entry||'').toUpperCase()==='LONG'?'L':'S'}`),status:'research_only',action:String(r.entry||''),event_id:`research:${r.research_id||'R'}:${r.time||0}`})
        }));
        return jsonResponse({...json,rows:[...json.rows,...fake]},response);
      }
    }catch{}
    return response;
  };
})();
