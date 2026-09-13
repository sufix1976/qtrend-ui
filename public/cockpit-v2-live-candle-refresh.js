(()=>{
  const nativeFetch=window.fetch.bind(window);
  const ENGINE_HOST="qtrend-trading-engine.onrender.com";
  const quoteCache=new Map();
  const QUOTE_TTL_MS=1500;

  function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
  function marketPrice(json){
    const m=json?.market||json?.data?.market||json||{};
    const inner=m?.market||{};
    const bid=finite(m?.bid??inner?.bid),offer=finite(m?.offer??inner?.offer);
    if(bid!==null&&offer!==null)return(bid+offer)/2;
    return bid??offer??finite(m?.price??inner?.price??m?.close??inner?.close);
  }
  async function livePrice(symbol){
    const now=Date.now(),cached=quoteCache.get(symbol);
    if(cached&&now-cached.at<QUOTE_TTL_MS)return cached.price;
    try{
      const r=await nativeFetch(`https://${ENGINE_HOST}/cap/market?epic=${encodeURIComponent(symbol)}&_ts=${now}`,{cache:"no-store"});
      const j=await r.json();
      const price=marketPrice(j);
      if(price!==null){quoteCache.set(symbol,{price,at:now});return price;}
    }catch{}
    return null;
  }
  function withLiveMinute(json,price){
    if(price===null||!Array.isArray(json?.candles))return json;
    const candles=[...json.candles];
    const bucket=Math.floor(Date.now()/60000)*60;
    const last=candles[candles.length-1];
    if(!last)return json;
    const lastTime=Number(last.time);
    if(!Number.isFinite(lastTime))return json;
    if(lastTime===bucket){
      const open=finite(last.open)??price;
      candles[candles.length-1]={...last,open,high:Math.max(finite(last.high)??open,price),low:Math.min(finite(last.low)??open,price),close:price};
    }else if(lastTime<bucket){
      const open=finite(last.close)??price;
      candles.push({time:bucket,open,high:Math.max(open,price),low:Math.min(open,price),close:price,volume:0});
    }
    return {...json,candles};
  }

  window.fetch=async(input,init)=>{
    try{
      const raw=typeof input==="string"?input:(input&&input.url)||String(input);
      const url=new URL(raw,window.location.href);
      if(url.hostname===ENGINE_HOST&&url.pathname==="/v5/candles"){
        url.searchParams.set("refreshLatest","true");
        url.searchParams.set("_ts",String(Date.now()));
        const request=typeof input==="string"?url.toString():(input instanceof Request?new Request(url.toString(),input):url.toString());
        const response=await nativeFetch(request,init);
        const interval=String(url.searchParams.get("interval")||"").toLowerCase();
        const symbol=String(url.searchParams.get("symbol")||"").toUpperCase();
        if(interval!=="1m"||!symbol||!response.ok)return response;
        try{
          const text=await response.clone().text();
          const json=JSON.parse(text);
          const price=await livePrice(symbol);
          const patched=withLiveMinute(json,price);
          return new Response(JSON.stringify(patched),{status:response.status,statusText:response.statusText,headers:response.headers});
        }catch{return response;}
      }
    }catch{}
    return nativeFetch(input,init);
  };

  console.log("[COCKPIT-V2] live 1m candle synthesized from Capital quote");
})();
