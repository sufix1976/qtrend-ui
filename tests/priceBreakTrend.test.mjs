import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/priceBreakTrend.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText;
const {priceBreakTrend}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const bars=[
 {time:0,open:10,high:12,low:9,close:10},
 {time:60,open:10,high:11,low:9,close:10},
 {time:120,open:10,high:11,low:7,close:8},
 {time:180,open:8,high:100,low:7,close:11}, // upper wick alone cannot flip
 {time:240,open:11,high:100,low:7,close:100}, // equality cannot flip
 {time:300,open:100,high:102,low:99,close:101},
 {time:360,open:101,high:102,low:100,close:101},
];
const r=priceBreakTrend(bars,1,2,1,420);
assert.deepEqual(r.events.map(e=>[e.time,e.direction]),[[180,-1],[360,1]]);
assert.equal(r.trend[2],1,'breaking candle must keep the state known at its open');
assert.equal(r.trend[3],-1,'new state applies at the next candle open');
assert.equal(r.line[2],9,'tested boundary excludes the breaking candle');
assert.equal(r.trend[5],-1,'wick and equality must retain Short');
const prefix=priceBreakTrend(bars.slice(0,3),1,2,1,150);
assert.equal(prefix.events.length,0,'developing candle cannot create a decision');
const firstBucket=Array.from({length:5},(_,i)=>({time:i*60,open:10,high:11,low:9,close:10}));
const developing=[...firstBucket,{time:300,open:10,high:99,low:0,close:0}];
assert.equal(priceBreakTrend(developing,5,1,1,360).completeBars,1);
assert.equal(priceBreakTrend(developing.filter(c=>c.time!==120),5,1,1,360).completeBars,0,'missing minute must invalidate the TF bucket');
assert.equal(priceBreakTrend(firstBucket.slice(1),5,1,1,300).completeBars,0,'partial leading TF candle is not used');
const real=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8')).candles.slice(-2500):Array.from({length:2500},(_,i)=>{const close=100+10*Math.sin(i/37)+3*Math.cos(i/11);return {time:i*60,open:close-.1,high:close+1,low:close-1,close};});
for(const minutes of [1,5,10,15,30,60]) {
 const full=priceBreakTrend(real,minutes,10,1,real.at(-1).time+60);
 for(const n of [300,611,1000,1507,2000]) {
  const input=real.slice(0,n),cutoff=input.at(-1).time+60;
  const part=priceBreakTrend(input,minutes,10,1,cutoff);
  for(const key of ['trend','line','upper','lower']) assert.deepEqual(part[key],full[key].slice(0,n),`${minutes}m ${key}: future candles changed historical output`);
  assert.deepEqual(part.events,full.events.filter(e=>e.time<=cutoff));
 }
 assert.ok(full.trend.every(t=>t===1||t===-1),'no neutral regime');
 console.log(`${minutes}m: prefix stability passed, ${full.events.length} switches`);
}
console.log('PASS: close timing, previous-window bounds, wicks/equality, incomplete TFs, six-TF prefix stability');
