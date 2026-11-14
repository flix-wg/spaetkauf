const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const P=require('../src/parse');
const {document,fixture}=require('./helpers');
const expected=require('../fixtures/expected.json');
const clean=cards=>cards.map(({dep,arr,trains})=>({dep,arr,trains}));
test('synthetic layouts and selector recovery preserve scheduled connections',()=>{
  for(const [name,e] of Object.entries(expected)) {
    const doc=fixture(name), result=P.parseCards(doc);
    assert.equal(result.looksLikeResults,true,name);
    assert.deepEqual(clean(result.cards),e.heuristic||e.cards,name);
    const cards=e.spec?P.applySpec(doc,e.spec):result.cards;
    assert.deepEqual(clean(cards),e.cards,name+' spec');
    if(name==='shadow.html') assert.deepEqual(clean(P.applySpec(doc,{card:'li',train:'.trains',dep:':scope .clock time',arr:':scope .clock time'})),e.cards);
    P.assignDates(cards,'2020-01-01');
    assert.deepEqual(cards.map(c=>c.date),e.dates||cards.map(()=>e.date),name+' dates');
    for(const c of cards) { const badge=doc.createElement('spk-badge'); badge.textContent='ICE 999 23:59'; c.core.append(badge); }
    assert.deepEqual(clean(P.parseCards(doc).cards),e.heuristic||e.cards,name+' badge');
  }
});
test('real captured results and URL use the same public entry points',()=>{
  const dir=path.join(__dirname,'../fixtures/real');
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.html'))) {
    const html=fs.readFileSync(path.join(dir,name),'utf8'),doc=document(html),cards=P.parseCards(doc).cards;
    assert.ok(cards.length>=1,name);
    assert.ok(cards.every(c=>c.dep && c.arr && c.trains.length));
    if(name==='bahn-results-2026-11-14.html') {
      const url=html.match(/Live URL of this page: (\S+)/)[1],ctx=P.pageContext(url,doc);
      assert.deepEqual(ctx,{from:'Hamburg Hbf',to:'München Hbf',toEva:'8000261',date:'2026-11-14',time:'02:53'});
      assert.deepEqual(clean(cards),[{dep:'05:29',arr:'12:05',trains:['ICE 573','ICE 783']},{dep:'05:34',arr:'12:20',trains:['RJ 171','ICE 1503']}]);
      P.assignDates(cards,ctx.date);assert.ok(cards.every(c=>c.date==='2026-11-14'));
      assert.ok(cards.every(c=>!c.core.closest('aside') && !c.core.textContent.includes('Weiter')));
      for(const c of cards) { const badge=doc.createElement('spk-badge'); badge.textContent='ICE 999 23:59'; c.core.append(badge); }
      assert.deepEqual(clean(P.parseCards(doc).cards),clean(cards));
    }
  }
});
test('normalization, authoritative times, fallback dates and invalid specs',()=>{
  assert.equal(P.parseCards(document('<li>08:00 12:00 13:00 14:00 RE 4 Hanau</li>')).cards[0].arr,'13:00');
  assert.equal(P.normTrain('ice00042'),'ICE 42'); assert.equal(P.normTrain('D 4'),null);assert.equal(P.isLongDistance('RE 4'),false);
  const doc=document('<p>To: München Hbf</p><ul><li><time datetime="23:10">23:20</time> <span>01:10</span> ICE 42</li><li>01:00 03:00 RE 4</li></ul>');
  const cards=P.parseCards(doc).cards;P.assignDates(cards,'2026-12-31');assert.deepEqual(cards.map(c=>c.date),['2026-12-31','2027-01-01']);assert.equal(cards[0].dep,'23:10');
  assert.equal(P.pageContext('https://example.org/?zoid=A%401%40L%3D8000261%40',doc).toEva,'8000261');
  assert.equal(P.pageContext('https://example.org/',doc).to,'München Hbf');
  assert.equal(P.applySpec(doc,{card:'[',train:'span',dep:'time',arr:'time'}),null);
  assert.equal(P.applySpec(doc,{card:'ul,li',train:'span',dep:'time',arr:'time'}),null);
});

test('a shared heading allows midnight rollover and a new heading resets the date',()=>{
  const doc=document('<h3>14 November 2026</h3><ul><li>23:00 23:50 ICE 1</li><li>00:30 01:30 ICE 2</li></ul><h3>16 November 2026</h3><ul><li>00:10 01:10 ICE 3</li></ul>');
  const cards=P.assignDates(P.parseCards(doc).cards,'2020-01-01');
  assert.deepEqual(cards.map(c=>c.date),['2026-11-14','2026-11-15','2026-11-16']);
});
