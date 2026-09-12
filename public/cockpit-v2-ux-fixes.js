(() => {
  const css=`
    #qv2-manual{position:fixed!important;top:78px!important;right:18px!important;left:auto!important;z-index:10005!important;display:flex!important;gap:8px!important;padding:9px 10px!important;background:#07101df5!important;border:2px solid #475569!important;border-radius:10px!important;box-shadow:0 10px 32px #000b!important;font-size:12px!important}
    #qv2-manual button{min-width:96px!important;padding:10px 14px!important;font-size:12px!important;border-width:2px!important;box-shadow:0 4px 14px #0007!important}
    #qv2-ml{background:#166534!important;border-color:#22c55e!important} #qv2-ms{background:#991b1b!important;border-color:#ef4444!important} #qv2-me{background:#334155!important;border-color:#cbd5e1!important}
    #qv2-manual-status{max-width:180px!important;font-size:11px!important}
    @media(max-width:900px){#qv2-manual{top:106px!important;left:8px!important;right:8px!important;max-width:none!important;justify-content:center!important;flex-wrap:wrap!important}#qv2-manual button{min-width:82px!important;padding:8px 10px!important}}
  `;
  const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);

  function widenCockpit(){
    if(!document.body.innerText.includes('COCKPIT V2 · RENDER RESEARCH'))return;
    for(const el of document.querySelectorAll('div')){
      if(getComputedStyle(el).display!=='grid'||el.children.length!==2)continue;
      const second=el.children[1];
      if(!(second instanceof HTMLElement))continue;
      const txt=String(second.innerText||'');
      if(txt.includes('INSPECTOR · RESEARCH')&&(txt.includes('EXIT')||txt.includes('ENTRY')||txt.includes('CHANNEL')||txt.includes('CONTROLLER'))){
        if(window.innerWidth>=1050)el.style.gridTemplateColumns='minmax(0,1fr) 455px';
        else if(window.innerWidth>=850)el.style.gridTemplateColumns='minmax(0,1fr) 420px';
        second.style.minWidth='0';
        break;
      }
    }
  }
  function apply(){widenCockpit()}
  const obs=new MutationObserver(apply);obs.observe(document.body,{subtree:true,childList:true,characterData:true});window.addEventListener('resize',apply);setTimeout(apply,0);setTimeout(apply,1000);
})();