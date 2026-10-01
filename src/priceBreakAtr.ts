import type { PriceCandle } from './priceBreakTrend';
export type AtrEntry={time:number;direction:number;kind:string};
export type AtrExit={time:number;direction:number;reason:'ATR'|'NOT'};

/** Wilder ATR on complete UTC-aligned TF candles, exposed only after TF close. */
export function closedAtr(base:PriceCandle[],minutes:number,period:number,knownThrough:number){
 const seconds=minutes*60,buckets=new Map<number,PriceCandle[]>();
 for(const b of base){if(b.time+60>knownThrough)continue;const t=Math.floor(b.time/seconds)*seconds;const rows=buckets.get(t)||[];rows.push(b);buckets.set(t,rows);}
 const bars:PriceCandle[]=[];
 for(const [time,rows] of buckets){if(time+seconds>knownThrough||rows.length!==minutes||rows.some((b,i)=>b.time!==time+i*60))continue;
  bars.push({time,open:rows[0].open,close:rows.at(-1)!.close,high:Math.max(...rows.map(b=>b.high)),low:Math.min(...rows.map(b=>b.low))});}
 const updates:{time:number;value:number}[]=[];let sum=0,value=0;
 for(let i=0;i<bars.length;i++){const b=bars[i],prev=bars[i-1];const tr=prev?Math.max(b.high-b.low,Math.abs(b.high-prev.close),Math.abs(b.low-prev.close)):b.high-b.low;
  if(i<period){sum+=tr;if(i!==period-1)continue;value=sum/period;}else value=(value*(period-1)+tr)/period;
  updates.push({time:b.time+seconds,value});}
 let j=-1;return base.map(b=>{while(j+1<updates.length&&updates[j+1].time<=b.time)j++;return j<0?null:updates[j].value;});
}

/** Visual position state only. X candidates do not close this ATR experiment. */
export function visualAtrTrail(c:PriceCandle[],trend:number[],atr:(number|null)[],entries:AtrEntry[],notExits:{time:number;direction:number}[],knownThrough:number,factor:number){
 const line:(number|null)[]=c.map(()=>null),directions:number[]=c.map(()=>0),accepted:AtrEntry[]=[],exits:AtrExit[]=[];
 const entryMap=new Map<number,AtrEntry[]>();for(const e of entries){const list=entryMap.get(e.time)||[];list.push(e);entryMap.set(e.time,list);}
 const notMap=new Map<number,number[]>();for(const e of notExits){const list=notMap.get(e.time)||[];list.push(e.direction);notMap.set(e.time,list);}
 let position:{direction:number;extreme:number;stop:number}|null=null,pending:AtrExit|null=null;
 for(let i=0;i<c.length;i++){
  const b=c[i];let exited=false;
  if(pending&&pending.time===b.time){exits.push(pending);pending=null;position=null;exited=true;}
  if(position&&notMap.get(b.time)?.includes(position.direction)){exits.push({time:b.time,direction:position.direction,reason:'NOT'});position=null;exited=true;}
  if(!position&&!exited&&atr[i]!=null){const entry:AtrEntry|undefined=entryMap.get(b.time)?.find(e=>e.direction===trend[i]);if(entry){
   position={direction:entry.direction,extreme:b.open,stop:b.open-entry.direction*atr[i]!*factor};accepted.push(entry);}}
  if(!position)continue;
  line[i]=position.stop;directions[i]=position.direction;
  if(b.time+60>knownThrough)continue;
  const hit=position.direction>0?b.low<=position.stop:b.high>=position.stop;
  if(hit){const next=c[i+1];if(next)pending={time:next.time,direction:position.direction,reason:'ATR'};continue;}
  // This candle's extreme/new ATR may tighten only the NEXT candle's stop.
  position.extreme=position.direction>0?Math.max(position.extreme,b.high):Math.min(position.extreme,b.low);
  const nextAtr=atr[i+1]??atr[i];if(nextAtr!=null){const candidate=position.extreme-position.direction*nextAtr*factor;
   position.stop=position.direction>0?Math.max(position.stop,candidate):Math.min(position.stop,candidate);}
 }
 return {line,directions,accepted,exits};
}
