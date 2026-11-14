const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {document,fixture}=require('./helpers');
const S=require('../src/skeleton');
const grammar=/^(?:  )*(?:#shadow|[a-z][a-z0-9-]{0,40}(?:\.[A-Za-z_-][A-Za-z0-9_-]{0,63})*(?:\[(?:(?:aria|data)-[a-z0-9-]{1,40}|role=[a-z]{1,30})\])*)(?: (?:TIME|TRAIN|PRICE|DUR|TEXT))*$/;
function valid(s) {
  assert.ok(s.length<=100000);assert.ok(s.split('\n').length<=2000);assert.ok(!s.endsWith('\n'));
  for(const line of s.split('\n')) { assert.match(line,grammar); assert.ok(line.match(/^ */)[0].length<=120); }
  for(const word of ['München','Hamburg','Frankfurt','143,99','05:29','Weiter','Umstieg'])assert.ok(!s.includes(word),word);
}
test('every synthetic and real fixture produces only the skeleton grammar',()=>{
  const names=fs.readdirSync(path.join(__dirname,'../fixtures')).filter(n=>n.endsWith('.html'));
  names.push(...fs.readdirSync(path.join(__dirname,'../fixtures/real')).filter(n=>n.endsWith('.html')).map(n=>'real/'+n));
  for(const name of names)valid(S.build(fixture(name)));
  assert.ok(S.build(fixture('shadow.html')).includes('#shadow'));
});
test('skeleton hashes ignore text values and extra repeated result cards',async()=>{
  function page(n,station='Hamburg',time='05:29',price='143,99') {
    return document('<html><body><nav>Account</nav><main class="results" data-route="secret"><ul>'+Array.from({length:n},()=>'<li class="card"><div><time>'+time+'</time><time>12:05</time><span>ICE 573</span><span>'+station+'</span><span>'+price+' €</span></div></li>').join('')+'</ul></main></body></html>');
  }
  const a=S.build(page(4)),b=S.build(page(9,'München','06:30','45,00'));
  assert.equal(a,b);assert.equal(await S.hash(a),await S.hash(b));assert.match(await S.hash(a),/^[0-9a-f]{64}$/);
  assert.equal(await S.hash('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.ok(a.startsWith('html\n  body\n    main.results[data-route]\n      ul\n'));
  assert.ok(!a.includes('nav'));
});
test('large pages, unsafe names, skipped subtrees and direct content tokens',()=>{
  const doc=document('<main><section><p>05:29 ICE 573 143,99 € 45 min Hamburg</p><script>secret</script><style>secret</style><div hidden>secret</div><spk-badge>23:00 ICE 900</spk-badge><svg><text>secret</text></svg>'+Array.from({length:2300},(_,i)=>'<div class="row'+i+'" data-sensitive="secret">hello</div>').join('')+'<time>12:00</time></section></main>');
  const s=S.build(doc);valid(s);assert.ok(!s.includes('secret'));assert.ok(!s.includes('spk-'));assert.ok(!s.includes('script'));assert.equal(s.split('\n').length,2000);
  assert.deepEqual(S.classify('12:31 h'),['DUR']);
  assert.deepEqual(S.classify('05:29 ICE 573 143,99 € 45 min Hamburg'),['TIME','TRAIN','PRICE','DUR','TEXT']);
  const deep=document('<main>'+ '<div>'.repeat(90)+'05:29 ICE 1 06:00'+'</div>'.repeat(90)+'</main>');valid(S.build(deep));
});
