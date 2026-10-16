'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {asset} = require('./frontend_modules.cjs');
const manifest = require('./fixtures/frontend-manifest.json');
/* Compatibility seam for pre-module, focused regression tests. Declarations are read
 * from the current production modules, never a frozen copy of the old controller.
 * New tests import real feature factories (test_v22_frontend.cjs).
 */
const definitions = new Map();
for (const name of manifest.features) {
  const text = asset('app/' + name + '.js', true);
  const matches = [...text.matchAll(/^    (?:(?:async )?function |const )([\w$]+)[\s\S]*?(?=^    (?:(?:async )?function |const |return \{))/gm)];
  for (const match of matches) definitions.set(match[1], match[0].replace(/^    /gm, '').replace(/\bappState\./g, '').trim());
}
const state = asset('app/state.js', true);
const starts = [...state.matchAll(/^    (\w+): /gm)];
for (let i=0;i<starts.length;i++) {
  const value=state.slice(starts[i].index+starts[i][0].length,i+1<starts.length?starts[i+1].index:state.lastIndexOf('\n  };')).trim().replace(/,$/,'');
  const name=starts[i][1];
  definitions.set(name, (name==='templates'?'const':'let')+' '+name+' = '+value+';');
}
const labels=asset('app/labels.js', true);
for(const match of labels.matchAll(/^export const (\w+)[\s\S]*?(?=^export const |$(?![\s\S]))/gm)) definitions.set(match[1],match[0].replace(/^export /,'').trim());
const order=manifest.declarations.filter(name=>definitions.has(name));
for(const name of definitions.keys()) if(!order.includes(name))order.push(name);
function normalize(text){return String(text).replace(/\s+/g,'').replace(/"/g,"'").replace(/\((\w+)\)=>/g,'$1=>').replace(/\b0\.(\d+)/g,'.$1');}
class Source extends String { includes(needle, position) { return super.includes(needle,position)||normalize(this).includes(normalize(needle)); } }
module.exports = new Source(order.map(name=>definitions.get(name)).join('\n\n').replace(/^(const|let) (\w+)\s*=\s*/gm,'$1 $2='));
