(()=>{
  const BACKEND='https://qtrend-trading-engine.onrender.com';
  const ID='qtrend-oos-test-button';
  function currentSymbol(){
    const selects=[...document.querySelectorAll('select')];
    const s=selects.find(x=>['GOLD','US100','US30','DE40','J225','UK100','US500','BTCUSD','ETHUSD','SILVER','OIL_CRUDE','CORN'].includes(String(x.value).toUpperCase()));
    return String(s?.value||'SILVER').toUpperCase();
  }
  function fmt(v,d=3){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):'—';}
  async function run(btn){
    const symbol=currentSymbol();
    const old=btn.textContent; btn.disabled=true; btn.textContent='OOS RECHNET …';
    try{
      const r=await fetch(`${BACKEND}/cockpit-v2/research-oos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,use_saved_profile:true})});
      const j=await r.json(); if(!r.ok||j?.ok===false)throw new Error(j?.error||j?.reason||`HTTP ${r.status}`);
      const x=j?.oos||j?.result||j; const bt=x?.backtest||x?.summary||x;
      const pf=bt?.profitFactor??bt?.profit_factor??bt?.pf;
      const net=bt?.net; const trades=bt?.trades??bt?.closed_trades;
      const wins=bt?.wins, losses=bt?.losses; const wr=bt?.winRate??bt?.winrate;
      const count=x?.candle_count??x?.base_candle_count??j?.older_candle_count;
      const from=x?.from||x?.start||j?.from, to=x?.to||x?.end||j?.to;
      const range=from&&to?` · ${new Date(from).toLocaleDateString('de-DE')}–${new Date(to).toLocaleDateString('de-DE')}`:'';
      alert(`${symbol} OOS${range}\nKerzen: ${count??'—'}\nTrades: ${trades??'—'} · Wins: ${wins??'—'} · Losses: ${losses??'—'}\nPF: ${fmt(pf)} · NET: ${Number(net)>=0?'+':''}${fmt(net,2)} · Winrate: ${fmt(wr,1)} %`);
    }catch(e){alert(`OOS-Fehler: ${e?.message||e}`);}finally{btn.disabled=false;btn.textContent=old;}
  }
  function install(){
    if(document.getElementById(ID))return;
    const title=[...document.querySelectorAll('b')].find(x=>String(x.textContent||'').includes('COCKPIT V2'));
    const bar=title?.parentElement;if(!bar)return;
    const btn=document.createElement('button');btn.id=ID;btn.textContent='OOS TEST';btn.title='Gespeichertes Profil unverändert auf älteren Kerzen testen';
    btn.style.cssText='background:#3b0764;border:1px solid #7e22ce;color:#f5d0fe;border-radius:7px;padding:7px 10px;font-weight:800;cursor:pointer';
    btn.onclick=()=>run(btn);bar.appendChild(btn);
  }
  install();new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
})();
