(() => {
  const BACKEND = "https://qtrend-trading-engine.onrender.com";
  const MANUAL_QUEUE = "__V2_MANUAL__";
  const SYMBOLS = ["GOLD","US100","US30","DE40","J225","UK100","US500","BTCUSD","ETHUSD","SILVER","OIL_CRUDE","CORN"];
  let busy = false;
  let pollTimer = null;

  const css = `
    #qv2-manual{position:absolute;top:42px;right:10px;z-index:20;display:none;gap:6px;align-items:center;background:#07101ddd;border:1px solid #334155;border-radius:9px;padding:6px;box-shadow:0 8px 24px #0008;font:800 11px system-ui;color:#e5eefc}
    #qv2-manual button{border:1px solid #475569;border-radius:7px;padding:7px 10px;font:900 11px system-ui;color:white;cursor:pointer;min-width:72px}
    #qv2-ml{background:#166534} #qv2-ms{background:#991b1b} #qv2-me{background:#475569}
    #qv2-manual button:disabled{opacity:.45;cursor:wait}
    #qv2-manual-status{max-width:260px;color:#a5f3fc;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #qv2-manual-events{position:absolute;left:10px;bottom:8px;z-index:18;display:none;gap:5px;align-items:center;max-width:calc(100% - 20px);overflow:hidden;pointer-events:none;font:900 10px system-ui}
    .qv2-mbadge{padding:4px 7px;border-radius:999px;border:1px solid #475569;background:#07101ddd;white-space:nowrap}.qv2-ml{color:#86efac;border-color:#166534}.qv2-ms{color:#fca5a5;border-color:#991b1b}.qv2-me{color:#f8fafc;border-color:#64748b}
  `;
  const style=document.createElement("style");style.textContent=css;document.head.appendChild(style);

  const box=document.createElement("div");box.id="qv2-manual";box.innerHTML=`<button id="qv2-ml">ML · LONG</button><button id="qv2-ms">MS · SHORT</button><button id="qv2-me">ME · EXIT</button><span id="qv2-manual-status">MANUELL</span>`;
  const events=document.createElement("div");events.id="qv2-manual-events";

  function symbolSelect(){return [...document.querySelectorAll("select")].find(s=>{const values=[...s.options].map(o=>o.value||o.textContent);return values.includes("GOLD")&&values.includes("US100")&&values.includes("DE40");})||null;}
  function intervalSelect(){return [...document.querySelectorAll("select")].find(s=>{const values=[...s.options].map(o=>o.value||o.textContent);return values.includes("1m")&&values.includes("5m")&&values.includes("30m")&&!values.includes("GOLD");})||null;}
  function current(){const s=symbolSelect(),t=intervalSelect();return{symbol:String(s?.value||"GOLD").toUpperCase(),interval:String(t?.value||"5m")};}
  function berlin(ts){try{return new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(Number(ts)*1000));}catch{return"";}}
  async function json(url,init={}){const r=await fetch(url,{cache:"no-store",...init});const text=await r.text();let j;try{j=JSON.parse(text);}catch{throw new Error(`Keine JSON-Antwort (${r.status})`)}if(!r.ok||j?.ok===false)throw new Error(j?.info||j?.reason||j?.error||`HTTP ${r.status}`);return j;}
  function setBusy(on,text){busy=on;for(const b of box.querySelectorAll("button"))b.disabled=on;const s=box.querySelector("#qv2-manual-status");if(s)s.textContent=text||"MANUELL";}
  async function command(action){if(busy)return;const {symbol,interval}=current();const label=action==="MANUAL_LONG"?"ML · LONG":action==="MANUAL_SHORT"?"MS · SHORT":"ME · EXIT";if(!window.confirm(`${label} für ${symbol} wirklich ausführen?`))return;setBusy(true,`${label} wird gesendet …`);try{const now=Math.floor(Date.now()/1000),side=action==="MANUAL_LONG"?"long":action==="MANUAL_SHORT"?"short":"flat";await json(`${BACKEND}/ui/strategy-event`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:MANUAL_QUEUE,tf:interval,side,time:now,price:0,source:"cockpit_v2_manual",reason:JSON.stringify({symbol,interval,action,time:now,requested_at:Date.now()})})});setBusy(false,`${label} · gesendet`);setTimeout(()=>setBusy(false,"MANUELL"),3500);setTimeout(()=>void refreshEvents(),1200);}catch(e){setBusy(false,`FEHLER · ${e?.message||e}`);}}
  box.querySelector("#qv2-ml").onclick=()=>void command("MANUAL_LONG");
  box.querySelector("#qv2-ms").onclick=()=>void command("MANUAL_SHORT");
  box.querySelector("#qv2-me").onclick=()=>void command("MANUAL_EXIT");

  function findChartParent(){const labels=[...document.querySelectorAll("div")].filter(el=>String(el.textContent||"").includes("RESEARCH LIVE · TREND"));for(const label of labels){const p=label.parentElement;if(p&&p.querySelector("canvas"))return p;}const canv=document.querySelector("canvas");return canv?.parentElement?.parentElement||null;}
  function mount(){const cockpit=document.body.innerText.includes("COCKPIT V2 · RENDER RESEARCH"),parent=findChartParent();if(!cockpit||!parent){box.style.display="none";events.style.display="none";return;}if(box.parentElement!==parent)parent.appendChild(box);if(events.parentElement!==parent)parent.appendChild(events);box.style.display="flex";events.style.display="flex";}

  async function refreshEvents(){mount();if(box.style.display==="none")return;const {symbol}=current();try{const j=await json(`${BACKEND}/ui/strategy-events?symbol=${encodeURIComponent(MANUAL_QUEUE)}&_ts=${Date.now()}`),rows=Array.isArray(j?.rows)?j.rows:[],items=[];for(const row of rows){if(String(row?.source||"")!=="cockpit_v2_manual")continue;let c;try{c=JSON.parse(String(row.reason||"{}"));}catch{continue;}if(String(c?.symbol||"").toUpperCase()!==symbol)continue;items.push({id:Number(row.id||0),time:Number(row.time||c.time||0),action:String(c.action||"")});}items.sort((a,b)=>b.id-a.id);events.innerHTML=items.slice(0,8).reverse().map(x=>{const label=x.action==="MANUAL_LONG"?"ML":x.action==="MANUAL_SHORT"?"MS":"ME",cls=label==="ML"?"qv2-ml":label==="MS"?"qv2-ms":"qv2-me";return `<span class="qv2-mbadge ${cls}">${label} · ${berlin(x.time)}</span>`;}).join("");}catch{}
  }

  const obs=new MutationObserver(()=>mount());obs.observe(document.body,{subtree:true,childList:true});mount();void refreshEvents();pollTimer=window.setInterval(()=>void refreshEvents(),5000);
  window.addEventListener("beforeunload",()=>{if(pollTimer)window.clearInterval(pollTimer);});
})();
