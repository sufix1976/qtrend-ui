(() => {
  const PREFIX='qtrend:v2:avg-spread:';
  const oldFetch=window.fetch.bind(window);
  let lastStats=null,lastSymbol='';

  function symbolSelect(){
    return [...document.querySelectorAll('select')].find(x=>{
      const v=[...x.options].map(o=>o.value||o.textContent);
      return v.includes('GOLD')&&v.includes('US100')&&v.includes('CORN');
    })||null;
  }
  const getSymbol=()=>String(symbolSelect()?.value||'GOLD').toUpperCase();
  const getSpread=s=>Math.max(0,Number(localStorage.getItem(PREFIX+s)||0));
  const setSpread=(s,v)=>localStorage.setItem(PREFIX+s,String(Math.max(0,Number(v)||0)));

  const style=document.createElement('style');
  style.textContent=`
    #qv2-spread-box{display:flex;align-items:center;gap:7px;background:#111827;border:1px solid #475569;border-radius:8px;padding:6px 8px;color:#e5eefc;font:800 11px system-ui;white-space:nowrap}
    #qv2-spread-box input{width:74px;background:#0a1020;color:#fff;border:1px solid #64748b;border-radius:6px;padding:6px;font-weight:900}
    #qv2-spread-stats{color:#a5f3fc;font-weight:900}
    @media(max-width:1000px){#qv2-spread-stats{display:none}}
  `;
  document.head.appendChild(style);

  const box=document.createElement('div');
  box.id='qv2-spread-box';
  box.innerHTML='<span>Ø SPREAD</span><input id="qv2-spread-input" type="number" min="0" step="0.01"><span id="qv2-spread-symbol"></span><span id="qv2-spread-stats">Kosten 0.00 · Brutto 0.00 · Netto 0.00</span>';
  const inp=box.querySelector('#qv2-spread-input');
  const lab=box.querySelector('#qv2-spread-symbol');
  const statsLab=box.querySelector('#qv2-spread-stats');

  function renderStats(){
    const s=getSymbol();
    const spread=getSpread(s);
    lab.textContent=s;
    if(document.activeElement!==inp)inp.value=String(spread);
    const st=lastSymbol===s?lastStats:null;
    if(st){
      const costs=Number(st.spreadCosts||0),raw=Number(st.rawNet||0),net=Number(st.net||0);
      statsLab.textContent=`Kosten ${costs.toFixed(2)} · Brutto ${raw>=0?'+':''}${raw.toFixed(2)} · Netto ${net>=0?'+':''}${net.toFixed(2)}`;
    }else statsLab.textContent='Kosten 0.00 · Brutto — · Netto —';
  }

  function mount(){
    const sel=symbolSelect();
    if(!sel)return;
    const bar=sel.parentElement;
    if(!bar)return;
    if(box.parentElement!==bar){
      const status=[...bar.children].find(el=>String(el.textContent||'').includes('RESEARCH'));
      if(status)bar.insertBefore(box,status); else bar.appendChild(box);
    }
    renderStats();
  }

  inp.addEventListener('change',()=>{
    const s=getSymbol();
    setSpread(s,inp.value);
    lastStats=null; lastSymbol=s;
    renderStats();
    setTimeout(()=>window.dispatchEvent(new Event('qv2-spread-changed')),0);
  });

  window.fetch=async function(input,init={}){
    let isResearch=false,sym='';
    try{
      const url=typeof input==='string'?input:String(input?.url||'');
      isResearch=url.includes('/cockpit-v2/research')&&String(init?.method||'GET').toUpperCase()==='POST'&&typeof init?.body==='string';
      if(isResearch){
        const body=JSON.parse(init.body);
        sym=String(body?.symbol||getSymbol()).toUpperCase();
        body.profile={...(body.profile||{}),avgSpread:getSpread(sym)};
        init={...init,body:JSON.stringify(body)};
      }
    }catch{}
    const r=await oldFetch(input,init);
    if(isResearch){
      try{
        const j=await r.clone().json();
        const st=j?.research?.backtest;
        if(st){lastStats=st;lastSymbol=sym;setTimeout(renderStats,0);}
      }catch{}
    }
    return r;
  };

  const obs=new MutationObserver(()=>mount());
  obs.observe(document.body,{subtree:true,childList:true});
  document.addEventListener('change',e=>{if(e.target instanceof HTMLSelectElement)setTimeout(mount,0)});
  window.addEventListener('qv2-spread-changed',()=>{
    const status=[...document.querySelectorAll('div')].find(el=>String(el.textContent||'').includes('RESEARCH')&&String(el.textContent||'').includes('PF'));
    status?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  });
  mount();
})();
