import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
async function moduleAt(path){const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText;return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);}
const {visualEntries,parallelLine}=await moduleAt('../src/priceBreakVisual.ts');
const {priceBreakTrend}=await moduleAt('../src/priceBreakTrend.ts');
const c=[10,11,13,12,11,10].map((close,i)=>({time:i*60,open:close+.2,high:close+1,low:close-1,close}));
const main=c.map(()=>-1),micro=c.map(()=>1),line=c.map(()=>20);
assert.deepEqual(visualEntries(c,main,micro,line,360),[{time:240,direction:-1,kind:'PB'}]);
assert.equal(visualEntries(c,main,micro,line,210).length,0,'no signal before turning candle close');
const mirrored=c.map(x=>({...x,open:30-x.open,close:30-x.close,high:30-x.low,low:30-x.high}));
assert.deepEqual(visualEntries(mirrored,c.map(()=>1),c.map(()=>-1),line,360),[{time:240,direction:1,kind:'PB'}]);
assert.deepEqual(parallelLine([20,20,null],[1,-1,1],3),[23,17,null]);
const flip=[1,-1,-1,-1,-1,-1];
assert.ok(visualEntries(c,flip,micro,line,360).some(e=>e.kind==='W2'&&e.time===180),'second candle after flip, entry only on following open');
const gap=c.map((x,i)=>({...x,time:x.time+(i>=3?60:0)}));
assert.equal(visualEntries(gap,main,micro,line,420).filter(e=>e.kind==='PB').length,0,'no turning signal across gap');
const real=JSON.parse(fs.readFileSync('/tmp/us100-candles.json','utf8')).candles.slice(-2500);
for(const mins of [5,10,15]){
 const all=priceBreakTrend(real,mins,2,1,real.at(-1).time+60),small=priceBreakTrend(real,1,2,1,real.at(-1).time+60);
 const full=visualEntries(real,all.trend,small.trend,all.line,real.at(-1).time+60);
 for(const n of [611,1000,1507,2000]){const p=real.slice(0,n),end=p.at(-1).time+60,a=priceBreakTrend(p,mins,2,1,end),b=priceBreakTrend(p,1,2,1,end);assert.deepEqual(visualEntries(p,a.trend,b.trend,a.line,end),full.filter(e=>e.time<end));}
 console.log(`${mins}m: visual candidate prefix stability passed (${full.length} candidates)`);
}
console.log('PASS: mirrored turns, close timing, parallel sign, W2 timing, gaps, future independence');
