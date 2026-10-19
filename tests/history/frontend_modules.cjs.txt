'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function asset(name,raw=false){
  const actual=path.join(__dirname,'../static',name);
  let text=fs.readFileSync(fs.existsSync(actual)?actual:path.join(__dirname,'fixtures',name),'utf8');
  if(name.endsWith('.css')) {
    const compact=text.replace(/\s+/g,' ').replace(/\s*([{}:;,>])\s*/g,'$1').replace(/\b0\.(\d+)/g,'.$1');
    return compact;
  }
  if(!raw&&name.endsWith('.js')) text=text.replace(/^import .*?;\n/gm,'').replace(/^export default [\w$]+;\n?/gm,'').replace(/^export \{[^}]+\};\n?/gm,'').replace(/^export (?=(?:let|const|function|async function)\b)/gm,'');
  return text;
}
const routing=vm.runInNewContext(asset('graph-routing.js')+'\nArgusRouting;');
function forms(ui){return vm.runInNewContext(asset('form-sections.js')+'\nArgusForms;',{ArgusUI:ui});}
module.exports={routing,forms,asset};
