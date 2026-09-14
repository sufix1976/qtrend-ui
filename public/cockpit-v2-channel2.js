(()=>{
  const SYMBOLS=new Set(["GOLD","US100","US30","DE40","J225","UK100","US500","BTCUSD","ETHUSD","SILVER","OIL_CRUDE","CORN"]);
  const TFS=["1m","2m","3m","5m","8m","10m","15m","18m","30m","1h"];
  const MAS=["EMA","ALMA","HMA","SMA","VWMA","WMA","ZLEMA"];
  const defaults={channel2Enabled:false,channel2Tf:"30m",channel2MaType:"EMA",channel2MaPeriod:9};
  const key=s=>`qtrend:cockpit-v2:channel2:${s}`;
  function symbol(){for(const el of document.querySelectorAll('select')){const v=String(el.value||'').toUpperCase();if(SYMBOLS.has(v))return v;}return 'GOLD';}
  function load(s=symbol()){try{return{...defaults,...JSON.parse(localStorage.getItem(key(s))||'{}')}}catch{return{...defaults}}}
  function save(cfg,s=symbol()){localStorage.setItem(key(s),JSON.stringify(cfg));}
  function patchProfile(profile,s){if(!profile||typeof profile!=="object")return profile;const cfg=load(s);profile.modules=profile.modules||{};profile.modules.channel={...(profile.modules.channel||{}),...cfg};return profile;}
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init={}){
    try{
      const url=typeof input==='string'?input:String(input?.url||'');
      if(init?.body&&typeof init.body==='string'&&url.includes('/cockpit-v2/research')){
        const body=JSON.parse(init.body),s=String(body.symbol||body.profile?.symbol||symbol()).toUpperCase();
        if(body.profile?.__optimizerChannel2Passthrough){delete body.profile.__optimizerChannel2Passthrough;}else{body.profile=patchProfile(body.profile,s);}
        init={...init,body:JSON.stringify(body)};
      }else if(init?.body&&typeof init.body==='string'&&url.includes('/ui/strategy-event')){
        const body=JSON.parse(init.body);if(body?.source==='cockpit_v2_profile'&&String(body?.symbol||'').endsWith('__V2_PROFILE')){const s=String(body.symbol).replace(/__V2_PROFILE$/,'').toUpperCase();const profile=JSON.parse(String(body.reason||'{}'));body.reason=JSON.stringify(patchProfile(profile,s));init={...init,body:JSON.stringify(body)};}
      }
    }catch{}
    return nativeFetch(input,init);
  };
  function triggerResearch(){const labels=[...document.querySelectorAll('label')];const l=labels.find(x=>String(x.textContent||'').trim().startsWith('TREND TF'));const sel=l?.querySelector('select');if(sel)sel.dispatchEvent(new Event('change',{bubbles:true}));}
  function styleInput(el){Object.assign(el.style,{background:'#0a1020',border:'1px solid #334155',color:'#e5eefc',borderRadius:'7px',padding:'7px 9px',fontWeight:'700'});}
  function render(){
    const hard=[...document.querySelectorAll('div')].find(x=>String(x.textContent||'').startsWith('HART: Trend LONG')&&x.children.length===0);
    if(!hard)return;
    const host=hard.parentElement;if(!host||host.querySelector('[data-qv2-channel2]'))return;
    const cfg=load(),box=document.createElement('div');box.dataset.qv2Channel2='1';Object.assign(box.style,{border:'1px solid #0e7490',borderRadius:'8px',padding:'9px',display:'grid',gap:'7px',background:'#08334455'});
    const title=document.createElement('b');title.textContent='CHANNEL 2 · TREND INDICATOR A';title.style.color='#67e8f9';box.appendChild(title);
    const enabled=document.createElement('label');enabled.textContent='Channel 2 verwenden ';const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!cfg.channel2Enabled;enabled.appendChild(cb);box.appendChild(enabled);
    const tfLabel=document.createElement('label');tfLabel.textContent='TF ';const tf=document.createElement('select');for(const x of TFS){const o=document.createElement('option');o.value=o.textContent=x;tf.appendChild(o)}tf.value=cfg.channel2Tf;styleInput(tf);tfLabel.appendChild(tf);box.appendChild(tfLabel);
    const maLabel=document.createElement('label');maLabel.textContent='MA Typ ';const ma=document.createElement('select');for(const x of MAS){const o=document.createElement('option');o.value=o.textContent=x;ma.appendChild(o)}ma.value=cfg.channel2MaType;styleInput(ma);maLabel.appendChild(ma);box.appendChild(maLabel);
    const lenLabel=document.createElement('label');lenLabel.textContent='MA Länge ';const len=document.createElement('input');len.type='number';len.min='1';len.step='1';len.value=String(cfg.channel2MaPeriod);styleInput(len);lenLabel.appendChild(len);box.appendChild(lenLabel);
    const note=document.createElement('small');note.textContent='OFF = bisheriger Channel 1. ON = Trend Indicator A (Heikin-Ashi intern) ersetzt Channel 1 als Trendfilter. Eigener TF, kausal, kein Offset.';note.style.color='#a5f3fc';box.appendChild(note);
    const commit=()=>{const next={channel2Enabled:cb.checked,channel2Tf:tf.value,channel2MaType:ma.value,channel2MaPeriod:Math.max(1,Number(len.value)||9)};save(next);triggerResearch();};
    cb.addEventListener('change',commit);tf.addEventListener('change',commit);ma.addEventListener('change',commit);len.addEventListener('change',commit);
    host.insertBefore(box,hard.nextSibling);
  }
  new MutationObserver(render).observe(document.documentElement,{subtree:true,childList:true});
  setInterval(render,1000);render();
})();