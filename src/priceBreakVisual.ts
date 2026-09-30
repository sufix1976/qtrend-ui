import type { PriceCandle } from './priceBreakTrend';
export type VisualEntry={time:number;direction:number;kind:'W2'|'PB'};
// Visual candidates only: no position state, exits, fills or performance.
export function visualEntries(c:PriceCandle[],main:number[],micro:number[],line:(number|null)[],knownThrough:number){
 const out:VisualEntry[]=[];let flipAt=-1,episode=false,fired=false,extreme=0;
 for(let i=1;i<c.length;i++){
  const dir=main[i],bar=c[i],prev=c[i-1];
  if(main[i]!==main[i-1]){flipAt=i;episode=false;fired=false;}
  if(bar.time+60>knownThrough||!c[i+1]||c[i+1].time!==bar.time+60||prev.time+60!==bar.time||line[i]==null){episode=false;continue;}
  if(main[i+1]!==dir)continue;
  // Second 1m candle AFTER the main trend change must have a body in its direction.
  if(flipAt>=0&&i===flipAt+1&&dir*(bar.close-bar.open)>0)out.push({time:bar.time+60,direction:dir,kind:'W2'});
  if(micro[i]!==-dir){episode=false;fired=false;continue;}
  if(!episode){episode=true;fired=false;extreme=dir<0?bar.high:bar.low;continue;}
  const turns=dir<0?prev.high>=extreme&&bar.high<prev.high&&bar.close<prev.close:prev.low<=extreme&&bar.low>prev.low&&bar.close>prev.close;
  if(!fired&&turns){out.push({time:bar.time+60,direction:dir,kind:'PB'});fired=true;}
  extreme=dir<0?Math.max(extreme,bar.high):Math.min(extreme,bar.low);
 }
 return out;
}
export function parallelLine(line:(number|null)[],trend:number[],distance:number){return line.map((x,i)=>x==null?null:x+trend[i]*distance);}
