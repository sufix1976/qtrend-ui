import type { PriceCandle } from './priceBreakTrend';
import { visualEntries } from './priceBreakVisual';
export type VisualSignal={time:number;direction:number;kind:'W2'|'PB'|'EXIT'};
/** Visual candidates only. Directions on EXIT denote the position being closed. */
export function linePullbackSignals(c:PriceCandle[],main:number[],micro:number[],line:(number|null)[],knownThrough:number,distance:number,confirmNext=true){
 const out:VisualSignal[]=visualEntries(c,main,micro,line,knownThrough,false).filter(e=>e.kind==='W2');
 let episode=false,fired=false,near=false,extreme=0;
 const maximum=Math.max(0,Number.isFinite(distance)?distance:0);
 for(let i=1;i<c.length;i++){
  const bar=c[i],prev=c[i-1],dir=main[i],level=line[i],next=c[i+1];
  if(dir!==main[i-1]||prev.time+60!==bar.time){episode=false;fired=false;near=false;}
  if(bar.time+60>knownThrough||!next||next.time!==bar.time+60||level==null||main[i+1]!==dir||micro[i]!==-dir){
   episode=false;fired=false;near=false;continue;
  }
  // Distance from the candle's complete price interval to the known main line.
  // A touch or crossing is distance zero, including the wick.
  const gap=Math.max(bar.low-level,level-bar.high,0);
  if(!episode){episode=true;fired=false;near=gap<=maximum;extreme=dir<0?bar.high:bar.low;continue;}
  near=near||gap<=maximum;
  const turns=dir<0?prev.high>=extreme&&bar.high<prev.high&&bar.close<prev.close:prev.low<=extreme&&bar.low>prev.low&&bar.close>prev.close;
  if(!fired&&near&&turns){
   let target=i+1;
   if(confirmNext){
    const confirmation=c[target],after=c[target+1];
    if(confirmation.time+60>knownThrough||!after||after.time!==confirmation.time+60)continue;
    if(main[target]!==dir||main[target+1]!==dir||dir*(confirmation.close-confirmation.open)<=0){
     extreme=dir<0?Math.max(extreme,bar.high):Math.min(extreme,bar.low);continue;
    }
    target++;
   }
   out.push({time:c[target].time,direction:dir,kind:'PB'});fired=true;
  }
  extreme=dir<0?Math.max(extreme,bar.high):Math.min(extreme,bar.low);
 }
 // Mirror the existing small-TF turn logic: a Long leg turning down is a Long exit.
 const exits=visualEntries(c,main.map(d=>-d),micro,line,knownThrough,confirmNext)
  .filter(e=>e.kind==='PB').map(e=>({time:e.time,direction:-e.direction,kind:'EXIT' as const}));
 return [...out,...exits].sort((a,b)=>a.time-b.time);
}
