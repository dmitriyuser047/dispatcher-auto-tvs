'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const schema=require('../assets/core/platform-schema.js'),graph=require('../assets/core/reference-graph.js');
function put(row,path,value){
 const tokens=path.split('.');let owner=row;tokens.forEach((token,index)=>{const array=token.endsWith('[]'),key=array?token.slice(0,-2):token,last=index===tokens.length-1;if(last){owner[key]=array?[value]:value;return;}if(array){if(!Array.isArray(owner[key]))owner[key]=[{}];owner=owner[key][0];}else{if(!owner[key]||typeof owner[key]!=='object')owner[key]={};owner=owner[key];}});
}
test('each registered reference resolves a real typed-zero target through its declared path and retains its history classification',()=>{
 const covered=[];
 for(const [index,relation]of schema.relations.entries()){
  const db=Object.fromEntries(schema.sections.map(section=>[section,[]])),source={id:'source-'+index},target={id:0};let section,value=0;
  if(relation.kind==='id')section=relation.target;
  else if(relation.kind==='assetRef'){const[prefix,name]=Object.entries(relation.targets)[0];section=name;value=prefix+':0';}
  else if(relation.kind==='discriminator'){const[selector,name]=Object.entries(relation.targets)[0];section=name;put(source,relation.selector,relation.prefix?selector+':asset':selector);}
  else if(relation.kind==='lookup'){section=relation.target;value='700599991111';target[relation.targetField]=value;}
  else if(relation.kind==='historical'){section='vehicles';put(source,relation.selector,section);}
  else assert.fail('A new reference kind needs an independent contract fixture: '+relation.id);
  put(source,relation.field,value);db[relation.from].push(source);db[section].push(target);
  const before=JSON.stringify(db),report=graph.inspect(db,{today:'2026-10-22'}),refs=report.references.filter(ref=>ref.relationId===relation.id&&ref.rowId===source.id);
  assert.equal(refs.length,1,relation.id);assert.deepEqual(refs[0].target,{section,id:0},relation.id);assert.ok(['mutable','pinned','advisory','historical'].includes(refs[0].classification),relation.id);assert.equal(refs[0].unclassified,undefined,relation.id);if(relation.kind==='historical')assert.equal(refs[0].classification,'historical',relation.id);if(relation.kind==='lookup')assert.equal(refs[0].classification,'advisory',relation.id);assert.equal(JSON.stringify(db),before,relation.id);covered.push(relation.id);
 }
 assert.equal(new Set(covered).size,schema.relations.length);
});
