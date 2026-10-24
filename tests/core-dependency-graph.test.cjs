'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {ENTRIES}=require('../scripts/build-typed-core.cjs');
const root=path.resolve(__dirname,'..'),core=path.join(root,'assets/core');
function runtimeGraph(){
 const graph=new Map();
 function load(file){
  if(graph.has(file))return;
  const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),dependencies=new Set();
  function visit(node){
   // Lazy require calls are edges too: delaying a cycle does not remove it.
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='require'&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text.startsWith('.')){
    const target=path.resolve(path.dirname(file),node.arguments[0].text);assert.ok(target.startsWith(path.join(root,'assets')+path.sep),'Unexpected business-core dependency outside bundled assets');assert.ok(fs.existsSync(target),target);dependencies.add(target);
   }
   ts.forEachChild(node,visit);
  }
  visit(ast);graph.set(file,[...dependencies]);for(const dependency of dependencies)load(dependency);
 }
 for(const entry of ENTRIES)load(path.join(root,entry.output));
 // Include handwritten orchestration, calculation catalogs and worker entry
 // points, plus their actual ../js dependencies; typed-only graphs hide cycles.
 for(const file of fs.readdirSync(core).filter(file=>file.endsWith('.js')))load(path.join(core,file));
 return graph;
}
function components(graph){
 let sequence=0;const stack=[],active=new Set(),index=new Map(),low=new Map(),output=[];
 function visit(node){index.set(node,sequence);low.set(node,sequence++);stack.push(node);active.add(node);
  for(const dependency of graph.get(node)||[])if(!index.has(dependency)){visit(dependency);low.set(node,Math.min(low.get(node),low.get(dependency)));}else if(active.has(dependency))low.set(node,Math.min(low.get(node),index.get(dependency)));
  if(low.get(node)===index.get(node)){const group=[];let member;do{member=stack.pop();active.delete(member);group.push(member);}while(member!==node);output.push(group);}
 }
 for(const node of graph.keys())if(!index.has(node))visit(node);return output;
}
function closure(graph,start){const visited=new Set();function visit(node){if(visited.has(node))return;visited.add(node);for(const dependency of graph.get(node)||[])visit(dependency);}visit(start);return visited;}

test('all bundled business modules and worker entry points form an acyclic runtime graph',t=>{
 const graph=runtimeGraph(),cycles=components(graph).filter(group=>group.length>1||graph.get(group[0]).includes(group[0])).map(group=>group.map(file=>path.relative(root,file)).sort());
 assert.deepEqual(cycles,[],'Runtime cycles include lazy adapters and public facades');
 t.diagnostic(JSON.stringify({modules:graph.size,edges:[...graph.values()].reduce((total,dependencies)=>total+dependencies.length,0),cycles:cycles.length}));
});

test('document state has an acyclic runtime dependency closure containing only foundational primitives',()=>{
 const graph=runtimeGraph(),state=path.join(core,'document-state.js'),group=components(graph).find(group=>group.includes(state));
 assert.deepEqual(group,[state]);
 assert.deepEqual([...closure(graph,state)].map(file=>path.basename(file)).sort(),['business-calendar.js','decimal-core.js','document-state.js','entity-identity.js','platform-contracts.js']);
});

test('document projections, stock, valuation and source recognition cannot rejoin command orchestration cycles',()=>{
 const graph=runtimeGraph(),groups=components(graph),engine=path.join(core,'document-engine.js'),engineGroup=groups.find(group=>group.includes(engine));
 for(const name of ['document-state','document-print','financial-recognition','fuel-stock','inventory-stock','cost-valuation','repair-process','personnel-planning','period-policy','fuel-operations','procurement-operations','cost-operations'])assert.ok(!engineGroup.includes(path.join(core,name+'.js')),name+' rejoined document command orchestration');
 const typed=new Set(ENTRIES.map(entry=>path.join(root,entry.output)));
 assert.equal(Math.max(...groups.map(group=>group.filter(file=>typed.has(file)).length)),1);
});

test('personnel role facts and dated planning cannot depend on personnel workflow validation',()=>{
 const graph=runtimeGraph(),kinds=path.join(core,'personnel-kinds.js'),planning=path.join(core,'personnel-planning.js'),workflow=path.join(core,'personnel-engine.js');
 assert.deepEqual([...closure(graph,kinds)],[kinds]);assert.ok(!closure(graph,planning).has(workflow));
 assert.deepEqual(components(graph).find(group=>group.includes(planning)),[planning]);
});

test('period enforcement uses concrete source checks and stable identity without workflow aggregation',()=>{
 const graph=runtimeGraph(),periods=path.join(core,'period-policy.js'),dependencies=closure(graph,periods);
 for(const name of ['platform-policies','platform-integrity','platform-commands','document-engine','import-engine'])assert.ok(!dependencies.has(path.join(core,name+'.js')),name+' became a prerequisite for enforcing a closed period');
 assert.deepEqual(components(graph).find(group=>group.includes(periods)),[periods]);
});
