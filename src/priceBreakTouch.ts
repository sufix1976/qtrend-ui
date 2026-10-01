import type { PriceCandle } from './priceBreakTrend';
export type VisualTouchExit={time:number;direction:number;lines:string[]};
/** Completed 1m OHLC only; candidate available on the following open, no extra confirmation. */
export function lineTouchExits(c:PriceCandle[],trend:number[],main:(number|null)[],parallel:(number|null)[],knownThrough:number,micro:number[]){
 const out:VisualTouchExit[]=[];
 for(let i=1;i<c.length-1;i++){
  const bar=c[i],prev=c[i-1],next=c[i+1],dir=trend[i];
  if((dir!==1&&dir!==-1)||trend[i-1]!==dir||prev.time+60!==bar.time||next.time!==bar.time+60||bar.time+60>knownThrough)continue;
  // Use the confirmed micro direction known at this candle's open, not the next one.
  if(micro[i]!==-dir)continue;
  const lines:string[]=[];
  for(const [level,name] of [[main[i],'H'],[parallel[i],'P']] as const){
   if(level==null||!Number.isFinite(level))continue;
   // Approach from the trend side. A gap across the known level also qualifies.
   const fromSide=dir>0?bar.open>level||prev.close>level:bar.open<level||prev.close<level;
   const touched=dir>0?bar.low<=level:bar.high>=level;
   if(fromSide&&touched)lines.push(name);
  }
  if(lines.length)out.push({time:next.time,direction:dir,lines});
 }
 return out;
}
