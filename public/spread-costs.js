(() => {
  const PREFIX='qtrend:v2:avg-spread:';
  const oldFetch=window.fetch.bind(window);
  const getSymbol=()=>{
    const s=[...document.querySelectorAll('select')].find(x=>{const v=[...x.options].map(o=>o.value||o.textContent);return v.includes('GOLD')&&v.includes('US100')&&v.includes('CORN')});
    return String(s?.value||'GOLD').toUpperCase();
  };
  const getSpread=s=>Math.max(0,Number(localStorage.getItem(PREFIX+s)||0));
  const setSpread=(s,v)=>localStorage.setItem(PREFIX+s,String(Math.max(0,Number(v)||0)));

  window.fetch=async function(input,init={}){
    try{
      const url=typeof input==='string'?input:String(input?.url||'');
      if(url.includes('/cockpit-v2/research')&&String(init?.method||'GET').toUpperCase()==='POST'&&typeof init?.body==='string'){
        const body=JSON.parse(init.body),sym=String(body?.symbol||getSymbol()).toUpperCase();
        body.profile={...(body.profile||{}),avgSpread:getSpread(sym)};
        init={...init,body:JSON.stringify(body)};
      }
    }catch{}
    return oldFetch(input,init);
  };

  const css=document.createElement('style');
  css.textContent=`#qv2-spread-box{position:fixed;right:265px;bottom:14px;z-index:9997;display:none;align-items:center;gap:6px;background:#0b1220;border:1px solid #334155;border-radius:8px;padding:7px 9px;color:#dbeafe;font:800 11px system-ui;box-shadow:0 8px 24px #0008}#qv2-spread-box input{width:76px;background:#0a1020;color:#fff;border:1px solid #475569;border-radius:6px;padding:6px;font-weight:800}#qv2-spread-box small{color:#94a3b8}@media(max-width:900px){#qv2-spread-box{right:8px;bottom:108px}}`;
  document.head.appendChild(css);

  const box=document.createElement('div');box.id='qv2-spread-box';
  box.innerHTML='<span>Ø SPREAD</span><input id="qv2-spread-input" type="number" min="0" step="0.01"><small id="qv2-spread-symbol"></small>';
  document.body.appendChild(box);
  const inp=box.querySelector('#qv2-spread-input'),lab=box.querySelector('#qv2-spread-symbol');
  let last='';
  function sync(){
    const visible=document.body.innerText.includes('COCKPIT V2 · RENDER RESEARCH');box.style.display=visible?'flex':'none';if(!visible)return;
    const s=getSymbol();if(s!==last){last=s;inp.value=String(getSpread(s));lab.textContent=s;}
  }
  inp.addEventListener('change',()=>{const s=getSymbol();setSpread(s,inp.value);lab.textContent=`${s} · aktiv beim nächsten Research`;});
  new MutationObserver(sync).observe(document.body,{subtree:true,childList:true,characterData:true});
  document.addEventListener('change',e=>{if(e.target instanceof HTMLSelectElement)setTimeout(sync,0)});
  sync();
})();
