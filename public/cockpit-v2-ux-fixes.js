(() => {
  const css=`
    #qv2-manual{position:fixed!important;left:14px!important;bottom:14px!important;top:auto!important;right:auto!important;z-index:10005!important;display:flex!important;gap:8px!important;align-items:center!important;padding:8px 9px!important;background:#07101df5!important;border:2px solid #475569!important;border-radius:10px!important;box-shadow:0 10px 32px #000b!important;font-size:12px!important}
    #qv2-manual button{min-width:92px!important;padding:9px 12px!important;font-size:12px!important;border-width:2px!important;box-shadow:0 4px 14px #0007!important}
    #qv2-ml{background:#166534!important;border-color:#22c55e!important} #qv2-ms{background:#991b1b!important;border-color:#ef4444!important} #qv2-me{background:#334155!important;border-color:#cbd5e1!important}
    #qv2-manual-status{max-width:150px!important;font-size:11px!important}
    @media(max-width:900px){#qv2-manual{left:8px!important;right:8px!important;bottom:8px!important;max-width:none!important;justify-content:center!important;flex-wrap:wrap!important}#qv2-manual button{min-width:78px!important;padding:7px 9px!important}}
  `;
  const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);

  function widenCockpit(){
    if(!document.body.innerText.includes('COCKPIT V2 · RENDER RESEARCH'))return;
    const grids=[...document.querySelectorAll('div')].filter(el=>{
      const raw=String(el.style?.gridTemplateColumns||'').replace(/\s+/g,' ');
      return raw.includes('365px')&&el.children.length===2;
    });
    for(const el of grids){
      const second=el.children[1];
      if(!(second instanceof HTMLElement))continue;
      const txt=String(second.innerText||'');
      if(!txt.includes('INSPECTOR · RESEARCH'))continue;
      if(window.innerWidth>=1200)el.style.gridTemplateColumns='minmax(0,1fr) 430px';
      else if(window.innerWidth>=950)el.style.gridTemplateColumns='minmax(0,1fr) 405px';
      second.style.minWidth='0';
      break;
    }
  }
  function apply(){widenCockpit();}
  const obs=new MutationObserver(apply);obs.observe(document.body,{subtree:true,childList:true});
  window.addEventListener('resize',apply);
  setTimeout(apply,0);setTimeout(apply,800);
})();