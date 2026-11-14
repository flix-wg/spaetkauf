(function (root) {
  const LD_TYPES = ['ICE','IC','EC','ECE','EN','NJ','RJ','RJX','FLX','TGV','WB','ES','EST','EUR'];
  const REGIONAL_TYPES = ['RE','RB','IRE','S','MEX','ALX','ERB','NWB','BRB','HLB','VIA','U','STR','BUS'];
  const trainSource = '\\b(' + [...LD_TYPES, ...REGIONAL_TYPES].sort((a,b)=>b.length-a.length).join('|') + ')\\s*([0-9]+)\\b';
  const timeSource = '\\b(?:[01][0-9]|2[0-3]):[0-5][0-9]\\b';
  function skip(el) { return el.nodeType === 1 && (/^(script|style|template|noscript)$/i.test(el.localName) || el.localName.startsWith('spk-') || el.hasAttribute('hidden')); }
  function children(el) { return [...el.childNodes, ...(el.shadowRoot ? [el.shadowRoot] : [])]; }
  function parent(el) { return el.parentNode || el.host || null; }
  function contains(a,b) { for (; b; b=parent(b)) if (a===b) return true; return false; }
  function scan(el) {
    let text=''; const ranges=[];
    function walk(n) {
      if (skip(n)) return;
      if(n.nodeType===3) { text+=n.textContent; return; }
      if(n.nodeType===1 && text && !/[\s:]$/.test(text)) text+=' ';
      const start=text.length;
      if(n.nodeType===1 && n.localName==='time' && new RegExp('^'+timeSource+'$').test(n.getAttribute('datetime')||'')) text+=n.getAttribute('datetime');
      else for(const c of children(n)) walk(c);
      if(n.nodeType===1) { ranges.push({el:n,start,end:text.length}); if(!text.endsWith(':')) text+=' '; }
    }
    walk(el);
    function tokens(source, kind) { return [...text.matchAll(new RegExp(source,'gi'))].map(m=>({value:kind==='train'?normTrain(m[0]):m[0],el:(ranges.find(r=>r.start<=m.index && r.end>=m.index+m[0].length)||{el}).el})); }
    return {text,times:tokens(timeSource,'time'),trains:tokens(trainSource,'train'),ranges};
  }
  function normTrain(s) { const m=String(s).trim().match(new RegExp('^'+trainSource+'$','i')); return m ? m[1].toUpperCase()+' '+String(Number(m[2])) : null; }
  function unique(a) { return [...new Set(a)]; }
  function duration(text) {
    let m=text.match(/\b(\d{1,2}):(\d{2})\s*h\b/i); if(m) return +m[1]*60 + +m[2];
    m=text.match(/\b(\d+)\s*(?:Stunden?|hours?|h)(?=\b|\d)\s*(?:(\d+)\s*(?:Minuten?|minutes?|min|m)(?=\b|\d))?/i);
    if(m) return +m[1]*60 + +(m[2]||0);
    m=text.match(/\b(\d+)\s*(?:Minuten?|minutes?|min)\b/i); return m ? +m[1] : null;
  }
  // A delay or cancellation bahn.de already shows on the card. Seat and occupancy notices don't match.
  const POSTED = /verspät|fällt aus|zugausfall|teilausfall|\bausfall|halt entfällt|\bdelay|\bcancel/i;
  function posted(text) { return POSTED.test(text); }
  function minutes(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
  function common(nodes, limit) { let n=nodes[0]||limit; while(n && !nodes.every(x=>contains(n,x))) n=parent(n); return n && n.nodeType===1 ? n : limit; }
  function card(el, core) {
    const s=scan(core), times=s.times.map(x=>x.value).filter((x,i,a)=>!i||x!==a[i-1]);
    const dep=times[0], d=duration(s.text), target=d===null?null:(minutes(dep||'00:00')+d)%1440;
    const arr=times.find((t,i)=>i>0 && minutes(t)===target) || (times.length===4?times[2]:times[times.length-1]);
    const trains=unique(s.trains.map(x=>x.value)); return {el,core,dep,arr,trains,ldTrains:trains.filter(isLongDistance),date:null,posted:posted(scan(el).text)};
  }
  function isLongDistance(t) { const n=normTrain(t); return !!n && LD_TYPES.includes(n.split(' ')[0]); }
  function parseCards(rootNode) {
    const s=scan(rootNode), candidates=[];
    for(const t of s.trains) {
      let n=t.el;
      while(n && n!==rootNode && unique(scan(n).times.map(x=>x.value)).length<2) n=parent(n);
      if(n && n.nodeType===1 && !candidates.includes(n)) candidates.push(n);
    }
    let cores=candidates.filter(n=>!candidates.some(c=>c!==n && contains(n,c)));
    // A repeated list boundary also groups expanded per-leg summaries.
    const groups=new Map();
    for(const core of cores) { let n=core, boundary=null; while(n && n!==rootNode) { const p=parent(n); if(p && children(p).filter(c=>c.nodeType===1 && s.trains.some(t=>contains(c,t.el))).length>=2) { if(!['body','html'].includes(p.localName)) boundary=n; } if(n.localName==='li') { boundary=n; break; } n=p; } if(boundary) groups.set(boundary, (groups.get(boundary)||[]).concat(core)); }
    let cards=[];
    if(groups.size && [...groups.values()].flat().length===cores.length) for(const [el,cs] of groups) { const core=common(cs,el); cards.push(card(el,core)); }
    else cards=cores.map(core=>{let el=core; while(parent(el) && parent(el)!==rootNode && !cores.some(c=>c!==core && contains(parent(el),c))) el=parent(el); return card(el,core);});
    cards=cards.filter(c=>c.dep && c.arr && (unique(scan(c.core).times.map(x=>x.value)).length<=8 || groups.get(c.el)?.length>1));
    return {cards,looksLikeResults:s.times.length>=4 && s.trains.length>=1,timeCount:s.times.length,trainCount:s.trains.length};
  }
  function query(rootNode, selector) {
    const out = [], matches = new Set(rootNode.querySelectorAll(selector));
    if (rootNode.shadowRoot) for (const el of rootNode.shadowRoot.querySelectorAll(selector)) matches.add(el);
    function visit(n) {
      if (skip(n)) return;
      if (matches.has(n)) out.push(n);
      if (n.shadowRoot) for (const el of n.shadowRoot.querySelectorAll(selector)) matches.add(el);
      for (const child of children(n)) if (child.nodeType !== 3) visit(child);
    }
    for (const child of children(rootNode)) if (child.nodeType !== 3) visit(child);
    return out;
  }
  function applySpec(rootNode,spec) {
    try {
      if(!spec || !['card','train','dep','arr'].every(k=>typeof spec[k]==='string' && spec[k].trim())) return null;
      const els=query(rootNode,spec.card); if(els.length<2 || els.some((a,i)=>els.some((b,j)=>i!==j && contains(a,b)))) return null;
      const cards=els.map(el=>{ const ds=query(el,spec.dep), as=query(el,spec.arr), ts=query(el,spec.train); const de=ds[0], ar=as[spec.dep===spec.arr?as.length-1:0]; const c=card(el,common([de,ar,...ts].filter(Boolean),el)); c.dep=de && scan(de).times[0]?.value; c.arr=ar && scan(ar).times[0]?.value; c.trains=unique(ts.flatMap(t=>scan(t).trains.map(x=>x.value))); c.ldTrains=c.trains.filter(isLongDistance); return c; });
      return cards.every(c=>c.dep && c.arr) && cards.filter(c=>c.trains.length).length/cards.length>=.8 ? cards:null;
    } catch { return null; }
  }
  function pageContext(loc,doc) {
    const url=new URL(typeof loc==='string'?loc:loc.href), p=new URLSearchParams(url.search); for(const [k,v] of new URLSearchParams(url.hash.slice(1))) p.set(k,v);
    const hd=p.get('hd')||'', fallback=scan(doc).ranges.map(r=>r.el.textContent.match(/^\s*(?:Nach|To):\s*([^\n:]+)\s*$/i)).find(Boolean);
    return {from:p.get('so'),to:p.get('zo')||fallback?.[1]?.trim()||null,toEva:p.get('zoei')||p.get('zoid')?.match(/@L=(\d+)/)?.[1]||null,date:hd.match(/^\d{4}-\d\d-\d\d/)?.[0]||null,time:hd.match(/T(\d\d:\d\d)/)?.[1]||null};
  }
  function assignDates(cards,fallbackDate) {
    if(!cards.length) return cards;
    let top=cards[0].el; while(parent(top)) top=parent(top);
    const s=scan(top), months=['jan','feb','mär','apr','mai','jun','jul','aug','sep','okt','nov','dez']; const eng=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const headings=s.ranges.filter(r=>/^h[1-6]$/.test(r.el.localName) || r.el.getAttribute('role')==='heading').map(r=>{ const m=r.el.textContent.match(/\b(\d{1,2})\.?\s+([A-Za-zäÄ]+)\.?\s+(\d{4})/); if(!m)return null; const key=m[2].toLowerCase().slice(0,3), idx=Math.max(months.indexOf(key),eng.indexOf(key)); return idx<0?null:{el:r.el,date:m[3]+'-'+String(idx+1).padStart(2,'0')+'-'+m[1].padStart(2,'0')}; }).filter(Boolean);
    let date=fallbackDate, previous=null, heading=null;
    for(const c of cards) { const pos=s.ranges.find(r=>r.el===c.el)?.start??0; const h=headings.filter(h=>(s.ranges.find(r=>r.el===h.el)?.start??Infinity)<=pos).pop(); if(h && h!==heading) { date=h.date; heading=h; } else if(date && previous && minutes(previous)-minutes(c.dep)>360)date=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10); c.date=date||null; previous=c.dep; } return cards;
  }
  const SpkParse={posted,LD_TYPES,REGIONAL_TYPES,normTrain,isLongDistance,parseCards,applySpec,pageContext,assignDates,scan,skip,children,parent,contains,trainSource,timeSource};
  root.SpkParse=SpkParse; if(typeof module!=='undefined')module.exports=SpkParse;
})(typeof globalThis!=='undefined'?globalThis:this);
