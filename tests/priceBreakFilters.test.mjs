import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const compile=path=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const visual=url(compile('src/priceBreakVisual.ts'));
const {linePullbackSignals}=await import(url(compile('src/priceBreakSignals.ts').replace("'./priceBreakVisual'",JSON.stringify(visual))));
const {lineTouchExits}=await import(url(compile('src/priceBreakTouch.ts')));
const c=Array.from({length:20},(_,i)=>{
 const high=i<=15?100+i:115-(i-15);
 return {time:i*60,open:high-.5,high,low:high-2,close:high-1};
});
const main=c.map(()=>-1),micro=c.map((_,i)=>i?1:-1),line=c.map(()=>120);
const run=(bars=c,m=main,u=micro,l=line,min=15)=>linePullbackSignals(bars,m,u,l,1200,10,true,true,min);
const pb=results=>results.filter(e=>e.kind==='PB');
assert.deepEqual(pb(run()),[{time:1080,direction:-1,kind:'PB'}],'15 completed opposite-trend candles before the turn');
assert.deepEqual(pb(run(c,main,micro,line,16)),[],'16 bars required rejects exactly 15');
assert.deepEqual(pb(run(c,main,micro,line,0)),pb(run()),'zero disables duration');
const interrupted=micro.slice();interrupted[10]=-1;
assert.deepEqual(pb(run(c,main,interrupted)),[],'interrupted micro phase resets duration');
const gap=c.map((b,i)=>({...b,time:b.time+(i>=10?60:0)}));
assert.deepEqual(pb(run(gap)),[],'data gaps reset duration');
const mirror=c.map(b=>({time:b.time,open:-b.open,high:-b.low,low:-b.high,close:-b.close}));
assert.deepEqual(pb(run(mirror,main.map(d=>-d),micro.map(d=>-d),line.map(x=>-x))),[{time:1080,direction:1,kind:'PB'}]);
for(const n of [10,16,17,18,19,20]){
 const end=c[n-1].time+60;
 const prefix=linePullbackSignals(c.slice(0,n),main.slice(0,n),micro.slice(0,n),line.slice(0,n),end,10,true,true,15);
 assert.deepEqual(prefix,run().filter(e=>e.time<end),'prefix cannot gain signals from future bars');
}
assert.deepEqual(run().filter(e=>e.kind!=='PB'),run(c,main,micro,line,100).filter(e=>e.kind!=='PB'),'duration affects no W2 or normal exit');
const t=[{time:0,open:8,high:9,low:7,close:8},{time:60,open:8,high:10,low:7,close:8},{time:120,open:8,high:9,low:7,close:8}];
const short=[-1,-1,-1],h=[10,10,10],p=[9,9,9];
assert.deepEqual(lineTouchExits(t,short,h,p,180,[-1,1,-1]),[{time:120,direction:-1,lines:['H','P']}],'Short touch only in current micro UT, regardless of next state');
assert.deepEqual(lineTouchExits(t,short,h,p,180,[1,-1,1]),[],'future UT cannot authorize current touch');
assert.deepEqual(lineTouchExits(t,short,h,p,100,[-1,1,1]),[],'forming touch excluded');
const mt=t.map(b=>({time:b.time,open:-b.open,high:-b.low,low:-b.high,close:-b.close}));
assert.deepEqual(lineTouchExits(mt,[1,1,1],h.map(x=>-x),p.map(x=>-x),180,[1,-1,1]),[{time:120,direction:1,lines:['H','P']}],'Long touch in micro DT');
assert.deepEqual(lineTouchExits(mt,[1,1,1],h.map(x=>-x),p.map(x=>-x),180,[-1,1,-1]),[]);
console.log('PASS: exact duration boundary, interrupted phase/gaps, mirrored directions, causal prefixes, unaffected other signals, current micro direction at touches');
