const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../dist/odds.js'),'utf8'));
const {extensionOdds,createTransitous,httpOddsSource}=globalThis.KurtOdds;
const golden=require('./golden.json');
const data=path.join(__dirname,'../../frontend/public/data/odds');
const read=file=>JSON.parse(fs.readFileSync(path.join(data,file),'utf8'));
const odds={
  index:async()=>read('index.json'),
  train:async(type,number)=>fs.existsSync(path.join(data,`trains/${type}-${number}.json`))?read(`trains/${type}-${number}.json`):null,
};
const transitous={
  route:async url=>{
    const u=new URL(url);
    return Response.json(u.pathname==='/api/v1/geocode'?golden.geocode[u.searchParams.get('text')]||[]:golden.plan);
  },
  down:async()=>new Response('',{status:404}),
  none:async()=>{throw new Error('Transitous must not be called without a start station');},
};
for(const c of golden.cases) test(`matches POST /api/ext/odds with Transitous ${c.transitous}`,async()=>{
  const tr=createTransitous({fetch:transitous[c.transitous],storage:null,cacheStorage:null});
  assert.deepEqual(await extensionOdds(c.body,{odds,tr}),c.expected);
});
test('an unreachable site gives no odds and does not throw',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{throw new TypeError('fetch failed');};
  try {
    const tr=createTransitous({storage:null,cacheStorage:null});
    const body=golden.cases[0].body;
    const response=await extensionOdds(body,{odds:httpOddsSource('https://kurt.invalid/data'),tr});
    assert.equal(response.results.length,body.connections.length);
    assert.ok(response.results.every(r=>r.p20===null && r.basis==='none' && !r.kurt));
    assert.equal(response.kurt,null);
  } finally { globalThis.fetch=original; }
});

test('default site is Pages and localhost permissions remain available',()=>{
  const origin='https://kurt-34y.pages.dev';
  const manifest=require('../manifest.json');
  for(const host of [origin+'/*','http://127.0.0.1/*','http://localhost/*']) assert.ok(manifest.host_permissions.includes(host));
  for(const name of ['sw.js','content.js','options.js','popup.js','options.html']) {
    assert.ok(fs.readFileSync(path.join(__dirname,'../src',name),'utf8').includes(origin),name);
  }
});
