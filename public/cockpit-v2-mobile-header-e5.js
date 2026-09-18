(()=>{
 const css=document.createElement('style');css.textContent=`
 @media(max-width:1200px){
  html,body,#root{max-width:100vw!important;overflow-x:hidden!important}
  #root *{box-sizing:border-box}
  #root>div{width:100%!important;max-width:100vw!important;min-width:0!important}
  #root button,#root select,#root input{max-width:100%!important}
  #qv2-e5 .qe5-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
 }
 @media(max-width:900px){
  #qv2-e5 .qe5-grid{grid-template-columns:1fr!important}
 }
 `;document.head.appendChild(css);
 function fixToolbar(){const all=[...document.querySelectorAll('#root button')];const take=all.find(b=>/ÜBERNEHMEN|LIVE.*PROFIL|PROFIL.*LIVE/i.test(b.textContent||''));if(!take)return;const row=take.parentElement;if(!row)return;row.style.display='flex';row.style.flexWrap='wrap';row.style.gap='6px';row.style.width='100%';row.style.maxWidth='100%';row.style.overflow='visible';[...row.children].forEach(el=>{el.style.minWidth='0';el.style.flex='1 1 110px'});take.style.order='-1';take.style.flex='1 1 160px';take.style.minWidth='140px'}
 setInterval(fixToolbar,400);fixToolbar();
})();