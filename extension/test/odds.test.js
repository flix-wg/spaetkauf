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
test('on-time chance comes only on request and never beats the late odds',async()=>{
  let shown=0;
  for(const c of golden.cases){
    const tr=createTransitous({fetch:transitous[c.transitous],storage:null,cacheStorage:null});
    const {results}=await extensionOdds({...c.body,on_time:true,on_time_scope:'weekday'},{odds,tr});
    for(const [i,r] of results.entries()){
      const {on_time,on_time_runs,on_time_n,on_time_scope,on_time_late,on_time_late_runs,on_time_late_scope,...rest}=r;
      assert.deepEqual(rest,c.expected.results[i]);
      if(r.p20===null){assert.equal(on_time,undefined);continue;}
      shown++;
      assert.ok(on_time>0&&on_time<=1-r.p20,`${r.train}: ${on_time} vs ${r.p20}`);
      assert.ok(on_time_runs>=0&&on_time_runs<=r.n-r.late);
    }
  }
  assert.ok(shown>0);
  // ICE 785 to München Hbf, checked by hand against trains/ICE-785.json. Saturday: 30 of 45 runs under 5 min late;
  // its 13 late runs (15 minus 2 cancelled) have the median between 20 and 30 min. All days: 187 of 319 on time;
  // 116 late runs (132 minus 16 cancelled), median between 15 and 20. Sunday has 7 late runs, so its band uses all days.
  const c=golden.cases[1];
  const tr=createTransitous({fetch:transitous[c.transitous],storage:null,cacheStorage:null});
  const first=async(extra)=>(await extensionOdds({...c.body,on_time:true,...extra},{odds,tr})).results[0];
  const pick=r=>[r.train,r.on_time,r.on_time_runs,r.on_time_n,r.on_time_scope,r.on_time_late,r.on_time_late_runs,r.on_time_late_scope];
  assert.deepEqual(pick(await first({on_time_scope:'weekday'})),['ICE 785',0.6158,30,45,'weekday',[20,30],13,'weekday']);
  assert.deepEqual(pick(await first({})),['ICE 785',0.57,187,319,'all',[15,20],116,'all']);
  const sunday={connections:[{dep:'10:00',arr:'14:00',trains:['ICE 785'],date:'2026-11-22'}],on_time_scope:'weekday'};
  assert.deepEqual(pick(await first(sunday)).slice(3),[44,'weekday',[15,20],116,'all']);
  await assert.rejects(extensionOdds({...c.body,on_time:true,on_time_scope:'monday'},{odds,tr}));
  const route=await first({on_time_scope:'route'});
  assert.deepEqual([route.on_time_route_fallback,route.on_time_scope,route.on_time],[true,'all',(await first({})).on_time]);
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

test('default site is kurtfaehrt.de and localhost is only an optional permission',()=>{
  const origin='https://kurtfaehrt.de';
  const manifest=require('../manifest.json');
  assert.ok(manifest.host_permissions.includes(origin+'/*'));
  for(const host of ['http://127.0.0.1/*','http://localhost/*']) {
    assert.ok(!manifest.host_permissions.includes(host));
    assert.ok(manifest.optional_host_permissions.includes(host));
  }
  for(const name of ['sw.js','content.js','options.js','popup.js','options.html']) {
    assert.ok(fs.readFileSync(path.join(__dirname,'../src',name),'utf8').includes(origin),name);
  }
});

test('saved legacy default migrates once while custom origins stay unchanged',async()=>{
  for(const legacy of ['https://65-108-33-75.sslip.io','https://kurt-34y.pages.dev']) {
  let server=legacy, writes=0;
  const context=vm.createContext({
    importScripts(){},
    chrome:{
      declarativeNetRequest:{updateSessionRules:async()=>{}},
      runtime:{id:'test',getManifest:()=>({version:'1'}),onMessage:{addListener(){}},onInstalled:{addListener(){}}},
      tabs:{TAB_ID_NONE:-1,onRemoved:{addListener(){}}},
      storage:{sync:{
        get:async defaults=>({...defaults,server}),
        set:async value=>{server=value.server;writes++;},
      }},
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/sw.js'),'utf8'),context);
  assert.equal((await vm.runInContext('settings()',context)).server,'https://kurtfaehrt.de');
  await vm.runInContext('settings()',context);
  assert.equal(writes,1);
  for(const custom of ['https://custom.example','http://localhost:5710',legacy+'/']) {
    server=custom;
    assert.equal((await vm.runInContext('settings()',context)).server,custom);
  }
  assert.equal(writes,1);
  }
});

test('ungranted synced server falls back without changing the saved origin',async()=>{
  let granted=false, requested, listener;
  const saved='http://localhost:5710';
  const context=vm.createContext({URL, setTimeout, clearTimeout, importScripts(){},
    KurtOdds:{httpOddsSource:server=>{requested=server;return {index:async()=>({meta:{}})};}},
    chrome:{
      permissions:{contains:async()=>granted},
      declarativeNetRequest:{updateSessionRules:async()=>{}},
      runtime:{id:'test',getManifest:()=>({version:'1'}),onMessage:{addListener(fn){listener=fn;}},onInstalled:{addListener(){}}},
      tabs:{TAB_ID_NONE:-1,onRemoved:{addListener(){}}},
      storage:{sync:{get:async defaults=>({...defaults,server:saved}),set:async()=>assert.fail('must retain saved origin')}},
    }});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/sw.js'),'utf8'),context);
  const send=()=>new Promise(resolve=>listener({type:'health'},{},resolve));
  assert.equal((await send()).fallback,true);
  assert.equal(requested,'https://kurtfaehrt.de/data');
  granted=true;
  assert.equal((await send()).fallback,false);
  assert.equal(requested,saved+'/data');
});

test('train files load concurrently',{timeout:2000},async()=>{
  const body=golden.cases[0].body;
  const started=new Set();
  let release;
  const barrier=new Promise(resolve=>{release=resolve;});
  const trains=new Set(body.connections.map(c=>c.trains.at(-1).replace(/(?<=[A-Za-z])(?=\d)/g,' ')).filter(t=>/^ICE /.test(t) && read('index.json').numbers[t.split(' ')[1]]?.includes('ICE')));
  assert.ok(trains.size>1);
  const work=extensionOdds({...body,from:null},{tr:{},odds:{...odds,train:async(type,number)=>{
    started.add(type+' '+number);
    if(started.size===trains.size) release();
    await barrier;
    return odds.train(type,number);
  }}});
  const response=await work;
  assert.equal(response.results.length,body.connections.length);
  assert.ok(response.results.some(r=>r.p20!==null));
});

test('a failed train file leaves successful cards usable',async()=>{
  const body={...golden.cases[0].body,from:null};
  const response=await extensionOdds(body,{tr:{},odds:{...odds,train:async(type,number)=>{
    if(number==='599') throw new Error('file timed out');
    return odds.train(type,number);
  }}});
  assert.equal(response.results[0].p20,null);
  assert.ok(response.results.some(r=>r.p20!==null));
});
