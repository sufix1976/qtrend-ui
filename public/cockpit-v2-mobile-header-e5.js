(()=>{
 const css=document.createElement('style');css.textContent=`
 @media(max-width:1200px){
  html,body,#root{max-width:100vw!important;overflow-x:hidden!important}
  #root *{box-sizing:border-box}
  #root>div{width:100%!important;max-width:100vw!important;min-width:0!important}
  #root button,#root select,#root input{max-width:100%!important}
  #qv2-e5 .qe5-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
 }
 @media(max-width:900px){#qv2-e5 .qe5-grid{grid-template-columns:1fr!important}}
 `;document.head.appendChild(css);
 function hideResearchButtons(){for(const id of ['qtrend-oos-test-button','qtrend-oos-replay-button']){const b=document.getElementById(id);if(b)b.style.display='none'}}
 function fixToolbar(){
  hideResearchButtons();
  const all=[...document.querySelectorAll('#root button')];
  const take=all.find(b=>/ÜBERNEHMEN|LIVE.*PROFIL|PROFIL.*LIVE/i.test(b.textContent||''));
  if(!take)return;
  const row=take.parentElement;if(!row)return;
  row.style.display='flex';row.style.flexWrap='nowrap';row.style.gap='6px';row.style.width='100%';row.style.maxWidth='100%';row.style.overflow='visible';
  const selects=[...row.querySelectorAll('select')];
  for(const s of selects){s.style.flex='0 0 150px';s.style.width='150px';s.style.minWidth='0'}
  const candle=all.find(b=>b.parentElement===row&&/KERZEN/i.test(b.textContent||''));
  if(candle){candle.style.flex='0 0 145px';candle.style.width='145px';candle.style.minWidth='0'}
  take.style.order='-1';take.style.flex='0 0 180px';take.style.width='180px';take.style.minWidth='0';
  const profiles=all.find(b=>b.parentElement===row&&/ALLE PROFILE/i.test(b.textContent||''));
  if(profiles){profiles.style.flex='0 0 155px';profiles.style.width='155px';profiles.style.minWidth='0'}
  for(const el of [...row.children]){
   if(el===take||el===candle||el===profiles||selects.includes(el))continue;
   const txt=String(el.textContent||'');
   if(/RESEARCH/i.test(txt)){el.style.flex='1 1 auto';el.style.width='auto';el.style.minWidth='260px';el.style.whiteSpace='nowrap';el.style.overflow='hidden'}
   else if(el.tagName!=='SELECT'){el.style.flex='0 0 auto';el.style.minWidth='0'}
  }
 }
 setInterval(fixToolbar,400);fixToolbar();
})();