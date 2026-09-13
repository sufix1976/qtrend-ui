(()=>{
  const nativeFetch=window.fetch.bind(window);
  const ENGINE_HOST="qtrend-trading-engine.onrender.com";

  window.fetch=(input,init)=>{
    try{
      const raw=typeof input==="string"?input:(input&&input.url)||String(input);
      const url=new URL(raw,window.location.href);
      if(url.hostname===ENGINE_HOST&&url.pathname==="/v5/candles"){
        url.searchParams.set("refreshLatest","true");
        url.searchParams.set("_ts",String(Date.now()));
        if(typeof input==="string") return nativeFetch(url.toString(),init);
        if(input instanceof Request) return nativeFetch(new Request(url.toString(),input),init);
      }
    }catch{}
    return nativeFetch(input,init);
  };

  console.log("[COCKPIT-V2] direct live candle refresh enabled");
})();
