const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
function document(html) {
  const doc=new JSDOM(html).window.document;
  function upgrade(root) { for(const t of root.querySelectorAll('template[shadowrootmode="open"]')) { const host=t.parentElement;if(!host)continue;const shadow=host.attachShadow({mode:'open'});shadow.append(t.content);t.remove();upgrade(shadow); } }
  upgrade(doc);return doc;
}
function fixture(name) {return document(fs.readFileSync(path.join(__dirname,'../fixtures',name),'utf8'));}
module.exports={document,fixture};
