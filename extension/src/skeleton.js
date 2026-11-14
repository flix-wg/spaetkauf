(function (root) {
  const P=root.SpkParse || (typeof require!=='undefined' ? require('./parse') : null);
  function classify(text) {
    const pattern=new RegExp('(\\d+:\\d{2}\\s*h)|('+P.timeSource+')|('+P.trainSource+')|(\\d+(?:[.,]\\d{2})?\\s*(?:€|EUR))|(\\d+\\s*(?:h|Stunden?|hours?)\\s*(?:\\d+\\s*(?:min|m|Minuten?|minutes?))?|\\d+:\\d{2}\\s*h|\\d+\\s*(?:min|Minuten?|minutes?))','gi');
    const out=[]; let end=0;
    function add(t) { if(out[out.length-1]!==t)out.push(t); }
    for(const m of text.matchAll(pattern)) { if(text.slice(end,m.index).trim())add('TEXT'); const v=m[0]; add(new RegExp('^'+P.timeSource+'$').test(v)?'TIME':P.normTrain(v)?'TRAIN':/€|EUR/i.test(v)?'PRICE':'DUR'); end=m.index+v.length; }
    if(text.slice(end).trim())add('TEXT'); return out;
  }
  function signature(n) { return n.nodeType===11?'#shadow':n.localName+'.'+[...n.classList].join('.'); }
  function build(rootNode, {words = []} = {}) {
    const privateWords=words.map(w=>w.toLowerCase()).filter(w=>w.length>=3);
    const safeName=name=>!/[0-9]{3}/.test(name) && !privateWords.some(w=>name.toLowerCase().includes(w));
    const times=P.scan(rootNode).times;
    let start=times[0]?.el || (rootNode.nodeType===9?rootNode.documentElement:rootNode);
    while(start && !times.every(t=>P.contains(start,t.el)))start=P.parent(start);
    if(!start)return '';
    const chain=[]; for(let n=P.parent(start);n;n=P.parent(n)) if(n.nodeType===1 || n.host)chain.unshift(n);
    const lines=[]; let length=0;
    function line(n,depth) {
      if(depth>60 || lines.length>=2000 || P.skip(n))return false;
      let name=n.nodeType===11?'#shadow':n.localName;
      if(!name || !/^(?:#shadow|[a-z][a-z0-9-]{0,40})$/.test(name))return false;
      if(n.nodeType===1) {
        for(const c of n.classList)if(/^[A-Za-z_-][A-Za-z0-9_-]{0,63}$/.test(c) && safeName(c))name+='.'+c;
        for(const a of n.attributes)if(/^(?:aria|data)-[a-z0-9-]{1,40}$/.test(a.name) && safeName(a.name))name+='['+a.name+']'; else if(a.name==='role' && /^[a-z]{1,30}$/.test(a.value))name+='[role='+a.value+']';
      }
      if(n.localName==='svg')name='svg';
      const tokens=n.localName==='svg'?[]:classify([...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent).join(''));
      const value='  '.repeat(depth)+name+(tokens.length?' '+tokens.join(' '):'');
      if(length+value.length+(lines.length?1:0)>100000)return false;
      lines.push(value); length+=value.length+(lines.length>1?1:0); return true;
    }
    function walk(n,depth) {
      if(!line(n,depth) || n.localName==='svg')return;
      let last='', count=0;
      for(const c of P.children(n).filter(c=>c.nodeType===1 || c.nodeType===11)) { if(P.skip(c))continue; const sig=signature(c); count=sig===last?count+1:1;last=sig;if(count<=3)walk(c,depth+1); }
    }
    let depth=0; for(const n of chain) { if(depth>=60)break; line(n,depth++); } walk(start,depth); return lines.join('\n');
  }
  async function hash(str) { const crypto=root.crypto || globalThis.crypto; const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str)); return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
  const SpkSkeleton={build,hash,classify}; root.SpkSkeleton=SpkSkeleton;if(typeof module!=='undefined')module.exports=SpkSkeleton;
})(typeof globalThis!=='undefined'?globalThis:this);
