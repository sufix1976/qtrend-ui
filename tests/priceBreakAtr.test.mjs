import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync('src/priceBreakAtr.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {closedAtr,visualAtrTrail}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const prices=[[100,103,99,102],[102,104,100,103],[103,110,101,108],[107,109,105,106],[106,108,104,107],[107,109,105,108]];
const c=prices.map(([open,high,low,close],i)=>({time:i*60,open,high,low,close}));
const t=c.map(()=>1),atr=c.map(()=>2),entries=[{time:0,direction:1,kind:'PB'},{time:60,direction:1,kind:'W2'},{time:240,direction:1,kind:'PB'}];
const r=visualAtrTrail(c,t,atr,entries,[],360,2);
assert.deepEqual(r.line.slice(0,4),[96,99,100,106],'each candle uses only the prior closed extreme');
assert.deepEqual(r.exits,[{time:240,direction:1,reason:'ATR'}]);
assert.equal(r.accepted.length,1,'entries ignored while open and on exit candle');
const wider=visualAtrTrail(c,t,[2,2,10,2,2,2],entries,[],360,2);
assert.equal(wider.line[2],99,'ATR increase cannot widen an existing stop');
const mirrored=c.map(b=>({time:b.time,open:-b.open,close:-b.close,high:-b.low,low:-b.high}));
const s=visualAtrTrail(mirrored,t.map(()=>-1),atr,entries.map(e=>({...e,direction:-1})),[],360,2);
assert.deepEqual(s.line,r.line.map(x=>x==null?null:-x));
assert.deepEqual(s.exits,[{time:240,direction:-1,reason:'ATR'}]);
const not=visualAtrTrail(c,t,atr,entries,[{time:120,direction:1}],360,2);
assert.equal(not.exits[0].reason,'NOT');assert.equal(not.line[2],null);
assert.deepEqual(visualAtrTrail(c,t,atr,entries,[],200,2).exits,[],'forming candle cannot cause exit');
const base=Array.from({length:16},(_,i)=>({time:i*60,open:100,high:101,low:99,close:100}));
const values=closedAtr(base,5,2,960);
assert.equal(values[9],null,'two full 5m candles required');assert.equal(values[10],2);
const incomplete=base.filter(b=>b.time!==7*60);
assert.equal(closedAtr(incomplete,5,2,960).find(x=>x!=null),2,'missing TF bucket skipped');
assert.equal(closedAtr(incomplete,5,2,960)[13],null,'incomplete second bucket cannot seed ATR early');
for(const n of [3,5,7,10,12,15,16]){
 const p=base.slice(0,n),end=p.at(-1).time+60;
 assert.deepEqual(closedAtr(p,5,2,end),values.slice(0,n),'ATR prefix stability');
}
for(const n of [2,3,4,5,6]){
 const p=c.slice(0,n),end=p.at(-1).time+60;
 const partial=visualAtrTrail(p,t.slice(0,n),atr.slice(0,n),entries,[],end,2);
 assert.deepEqual(partial.line,r.line.slice(0,n),'trail cannot backpaint with future extremes');
 assert.deepEqual(partial.exits,r.exits.filter(e=>e.time<end));
}
console.log('PASS: closed HTF ATR/warmup/gaps, causal prefixes, mirrored stops, ratchet, correct stop timing, position gating and NOT');
// User's example: entry ATR gap 40, main-line gap 80; new gap 90 shrinks by 11.
const dc=[[100,105,90,92],[92,110,91,105],[105,110,80,85],[85,100,82,99],[99,101,95,100]].map(([open,high,low,close],i)=>({time:i*60,open,high,low,close}));
const dt=dc.map(()=>-1),da=[20,50,80,100,200],de=[{time:0,direction:-1,kind:'PB'}];
const opts={mainLine:dc.map(()=>180),shrinkFactor:1.1};
const dr=visualAtrTrail(dc,dt,da,de,[],300,2,opts);
assert.deepEqual(dr.line,[140,119,119,98,null],'40 - (90 - 80) * 1.1 = 29; retracement leaves stop horizontal');
assert.deepEqual(dr.exits,[{time:240,direction:-1,reason:'ATR'}],'touch triggers exit on next available open');
const dm=dc.map(b=>({time:b.time,open:-b.open,close:-b.close,high:-b.low,low:-b.high}));
const dl=visualAtrTrail(dm,dt.map(()=>1),da,de.map(e=>({...e,direction:1})),[],300,2,{mainLine:opts.mainLine.map(x=>-x),shrinkFactor:1.1});
assert.deepEqual(dl.line,dr.line.map(x=>x==null?null:-x),'dynamic long/short symmetry');
assert.deepEqual(dl.exits,dr.exits.map(e=>({...e,direction:1})));
const zero=visualAtrTrail(dc,dt,da,de,[],300,2,{...opts,shrinkFactor:10});
assert.equal(zero.line[1],90,'exhausted distance stays zero, never a stop beyond the favourable extreme');
const constant=visualAtrTrail(dc,dt,da,de,[],300,2,{...opts,shrinkFactor:0});
assert.equal(constant.line[1],130,'factor zero keeps entry ATR gap, even if later ATR increases');
const re=visualAtrTrail(dc,dt,da,[...de,{time:240,direction:-1,kind:'PB'}],[],300,2,opts);
assert.equal(re.accepted.length,1,'no re-entry on the exit candle');
for(const n of [2,3,4,5]){
 const partial=visualAtrTrail(dc.slice(0,n),dt.slice(0,n),da.slice(0,n),de,[],n*60,2,{...opts,mainLine:opts.mainLine.slice(0,n)});
 assert.deepEqual(partial.line,dr.line.slice(0,n),'dynamic trail prefix stability');
 assert.deepEqual(partial.exits,dr.exits.filter(e=>e.time<n*60));
}
console.log('PASS: exact dynamic distance example, frozen entry ATR, horizontal retracement, symmetry, zero boundary and causal prefixes');
