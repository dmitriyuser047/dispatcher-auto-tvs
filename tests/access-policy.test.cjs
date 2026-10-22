'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const ts=require('typescript');
const contracts=require('../assets/core/platform-contracts.js');
const schema=require('../assets/core/platform-schema.js');
const identity=require('../assets/core/entity-identity.js');
// Exercise the owned TypeScript source before/after artifact generation without
// writing a temporary bundle or depending on the host application's settings.
const filename=path.resolve(__dirname,'../src/core/access-policy.ts');
const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}});
const sourceModule=new Module(filename,module);sourceModule.filename=filename;sourceModule.paths=module.paths;sourceModule._compile(compiled.outputText,filename);
const create=sourceModule.exports.createAccessPolicy;
const getHash=()=>({sha256:value=>crypto.createHash('sha256').update(value).digest('hex')});
const api=create(contracts,schema,identity,getHash);
const any={any:true};
const policy=(org='А',site='Север',extra={})=>({version:1,grants:[{org,site}],...extra});
const known=value=>({state:'known',value});
const unknown={state:'unknown'};
const owner=(org='А',site='Север')=>({org:typeof org==='string'?known(org):org,site:typeof site==='string'?known(site):site});
const resolve=(section,row)=>({kind:'owned',owners:[{org:api.fact([row],['org','organization']),site:api.fact([row],['site','object'])}]});
const context=(extra={})=>({readable:['*'],writable:['*'],resolve,...extra});
const row=(id,org='А',site='Север',extra={})=>({id,org,site,...extra});
const deny=fn=>assert.throws(fn,error=>error.code==='ACCESS_DENIED'&&error.status===403&&!error.message.includes('private'));
const invalid=fn=>assert.throws(fn,error=>error.code==='ACCESS_POLICY_INVALID');
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('the source compiles with the repository strict TypeScript settings',()=>{
 const config=ts.readConfigFile(path.resolve(__dirname,'../tsconfig.core.json'),ts.sys.readFile);
 assert.equal(config.error,undefined);const options={...ts.parseJsonConfigFileContent(config.config,ts.sys,path.resolve(__dirname,'..')).options,noEmit:true};
 const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([filename],options));
 assert.deepEqual(diagnostics.map(item=>ts.flattenDiagnosticMessageText(item.messageText,'\n')),[]);
});

test('legacy absence preserves the trusted role ceiling, while configured empty grants deny',()=>{
 const source=[row(1),row(2,'Б','Юг')];
 assert.equal(api.normalize(undefined),null);assert.equal(api.normalize(null),null);
 assert.deepEqual(api.projectRows(null,'vehicles',source,context()),source);
 assert.deepEqual(api.projectRows(undefined,'vehicles',source,context({readable:['records']})),[]);
 assert.deepEqual(api.projectRows({version:1,grants:[]},'vehicles',source,context()),[]);
 assert.equal(api.permits(null,'vehicles','update',source[0],context({writable:[]})),false);
 assert.equal(api.permits(null,'madeUpSection','read',source[0],context()),false);
 assert.equal(api.permits(null,'vehicles','read',source[0],context({readable:[]})),false);
});

test('normalization rejects malformed versions, omitted pairs, executable descriptors and unsafe values',()=>{
 for(const value of [false,[],{}, {version:2,grants:[]},{version:1,grants:[{org:'А'}]}, {version:1,grants:[{org:{},site:any}]},
  {version:1,grants:[],extra:true},{version:1,grants:[],sections:{private:{}}},{version:1,grants:[],sections:{vehicles:{readFields:'id'}}},
  {version:1,grants:[{org:'А',site:any,actions:[' read']}]},{version:1,grants:[],sharedWrite:['private']}, {version:1,grants:[],sections:{vehicles:{actions:['']}}}])invalid(()=>api.normalize(value));
 let invoked=0;const getter={version:1,grants:[]};Object.defineProperty(getter,'sections',{enumerable:true,get(){invoked++;throw Error('must not execute');}});invalid(()=>api.normalize(getter));assert.equal(invoked,0);
 const hidden={version:1,grants:[]};Object.defineProperty(hidden,'secret',{value:true});invalid(()=>api.normalize(hidden));
 const symbol={version:1,grants:[]};symbol[Symbol('private')]=true;invalid(()=>api.normalize(symbol));
 const sparse={version:1,grants:Array(1)};invalid(()=>api.normalize(sparse));
 const cyclic={version:1,grants:[]};cyclic.sections=cyclic;invalid(()=>api.normalize(cyclic));
 invalid(()=>api.normalize(JSON.parse('{"version":1,"grants":[],"__proto__":{}}')));
 invalid(()=>api.normalize(Object.assign(Object.create({}),{version:1,grants:[]})));
 const normalized=api.normalize(policy('А',any,{sharedWrite:['parts','parts'],sections:{vehicles:{actions:['update','read','read']}}}));
 assert.ok(Object.isFrozen(normalized));assert.ok(Object.isFrozen(normalized.grants));assert.deepEqual(normalized.sections.vehicles.actions,['read','update']);assert.deepEqual(normalized.sharedWrite,['parts']);
});

test('paired org/site grants are OR pairs rather than a Cartesian product',()=>{
 const p={version:1,grants:[{org:'А',site:'Север'},{org:'Б',site:'Юг'}]};
 const source=[row(1),row(2,'Б','Юг'),row(3,'А','Юг'),row(4,'Б','Север'),row(5,'а','Север'),row(6,' А','Север')];
 assert.deepEqual(api.projectRows(p,'vehicles',source,context()).map(item=>item.id),[1,2]);
 assert.equal(api.permits(policy('*','Север'),'vehicles','read',row(7,'*'),context()),true);
 assert.equal(api.permits(policy('*','Север'),'vehicles','read',row(7,'А'),context()),false);
});

test('grant, section and role action ceilings only narrow, and reader printing never requires write',()=>{
 const p=policy('А','Север',{grants:[{org:'А',site:'Север',actions:['read','update','repair:approve','print:capture','print:export']}]});
 assert.equal(api.permits(p,'vehicles','read',row(1),context()),true);
 assert.equal(api.permits(p,'vehicles','update',row(1),context()),true);
 assert.equal(api.permits(p,'vehicles','repair:approve',row(1),context()),true);
 assert.equal(api.permits(p,'vehicles','repair:start',row(1),context()),false);
 assert.equal(api.permits(p,'vehicles','delete',row(1),context()),false);
 assert.equal(api.permits(p,'vehicles','update',row(1),context({actions:{vehicles:['read']}})),false);
 assert.equal(api.permits({...p,sections:{vehicles:{actions:['read']}}},'vehicles','update',row(1),context()),false);
 assert.equal(api.permits({...p,sections:{vehicles:{actions:[]}}},'vehicles','read',row(1),context()),false);
 assert.equal(api.permits(p,'vehicles','print:capture',row(1),context({writable:[]})),true);
 assert.equal(api.permits(p,'vehicles','print:export',row(1),context({writable:[]})),true);
 for(const action of [' read','read ',{},0,null,'*'])assert.equal(api.permits(p,'vehicles',action,row(1),context()),false);
});

test('unknown and explicit blank ownership close limited grants; site wildcard and global wildcard are explicit',()=>{
 const blank=row(1,'','Север'),unowned={id:2,site:'Север'},siteUnknown={id:3,org:'А'};
 assert.equal(api.permits(policy(any,'Север'),'vehicles','read',blank,context()),false);
 assert.equal(api.permits(policy(any,'Север'),'vehicles','read',unowned,context()),false);
 assert.equal(api.permits(policy('А',any),'vehicles','read',siteUnknown,context()),true);
 assert.equal(api.permits(policy('А','Север'),'vehicles','read',siteUnknown,context()),false);
 assert.equal(api.permits(policy(any,any),'vehicles','read',unowned,context()),true);
 assert.equal(api.permits(policy('А',any),'vehicles','read',row(4),context({resolve:()=>({kind:'unknown',owners:[]})})),false);
 assert.equal(api.permits(policy(any,any),'vehicles','read',row(4),context({resolve:()=>({kind:'unknown',owners:[]})})),true);
});

test('fact preserves exact own blanks, false/zero do not become strings, snapshots precede live cards',()=>{
 assert.deepEqual(api.fact([{org:''},{org:'А'}],['org','organization']),known(''));
 assert.deepEqual(api.fact([{org:null},{org:'А'}],['org']),unknown);
 assert.deepEqual(api.fact([{org:undefined},{org:'А'}],['org']),unknown);
 assert.deepEqual(api.fact([{org:0},{org:'А'}],['org']),unknown);
 assert.deepEqual(api.fact([{organization:'Б'},{org:'А'}],['org','organization']),known('Б'));
 assert.deepEqual(api.fact([{}, {org:' А '}],['org']),known(' А '));
 assert.deepEqual(api.fact([Object.create({org:'Б'}), {org:'А'}],['org']),known('А'));
 let invoked=0;const input={};Object.defineProperty(input,'org',{enumerable:true,get(){invoked++;return 'А';}});
 assert.throws(()=>api.fact([input],['org']),{code:'ACCESS_CONTEXT_INVALID'});assert.equal(invoked,0);
 const dated=context({resolve:(section,item)=>({kind:'owned',owners:[{org:api.fact([item.snapshot||{},item,{org:'Б'}],['org']),site:api.fact([item.snapshot||{},item,{site:'Юг'}],['site'])}]})});
 assert.equal(api.permits(policy(),'records','read',{id:1,snapshot:{org:'А',site:'Север'}},dated),true);
 assert.equal(api.permits(policy(),'records','read',{id:1,snapshot:{org:'',site:'Север'}},dated),false);
});

test('configured shared catalogs are read-only unless explicitly granted sharedWrite',()=>{
 const shared=context({resolve:()=>({kind:'shared',owners:[]})});
 assert.equal(api.permits(policy(),'parts','read',{id:1,name:'Bolt'},shared),true);
 assert.equal(api.permits(policy(),'parts','update',{id:1,name:'Bolt'},shared),false);
 assert.equal(api.permits(policy('А','Север',{sharedWrite:['parts']}),'parts','update',{id:1},shared),true);
 assert.equal(api.permits(policy('А','Север',{sharedWrite:['parts']}),'parts','update',{id:1},context({resolve:shared.resolve,writable:[]})),false);
 assert.equal(api.permits({version:1,grants:[],sharedWrite:['*']},'parts','read',{id:1},shared),false);
 assert.equal(api.permits(policy('А','Север',{grants:[{org:'А',site:any,actions:[]}],sharedWrite:['parts']}),'parts','read',{id:1},shared),false);
 assert.equal(api.permits(null,'parts','update',{id:1},shared),true);
});

test('field projections intersect both ceilings and retain structural typed IDs',()=>{
 const p=policy('А','Север',{sections:{vehicles:{readFields:['id','name','note'],writeFields:['name','note']}}});
 const source=[row(0,'А','Север',{name:'Truck',note:'Visible',salary:1200})];
 assert.deepEqual(api.projectRows(p,'vehicles',source,context({readFields:{vehicles:['name','salary']}})),[{id:0,name:'Truck'}]);
 assert.deepEqual(api.projectRows(policy('А','Север',{sections:{vehicles:{readFields:[]}}}),'vehicles',source,context()),[{id:0}]);
 const before=freeze(source),submitted=[{id:0,name:'New'}];
 const merged=api.mergeVisibleChanges(p,'vehicles',before,submitted,context({writeFields:{vehicles:['name']}}));
 assert.deepEqual(merged,[{...source[0],name:'New'}]);
 deny(()=>api.mergeVisibleChanges(p,'vehicles',before,[{id:0,name:'New',note:'changed'}],context({writeFields:{vehicles:['name']}})));
});

test('saving a filtered projection preserves hidden rows in their original interleaving and leaves inputs untouched',()=>{
 const before=freeze([row('a'),row('private','Б','Юг',{note:'private filename.xlsx',zero:0,blank:'',no:false,nil:null}),row('b')]);
 const submitted=freeze([{...before[2],note:'new'},before[0],row('new')]);
 const snapshot=JSON.stringify(before),incoming=JSON.stringify(submitted);
 const result=api.mergeVisibleChanges(policy(),'vehicles',before,submitted,context());
 assert.deepEqual(result.map(item=>item.id),['a','private','b','new']);
 assert.deepEqual(result[1],before[1]);assert.equal(result[2].note,'new');
 assert.equal(JSON.stringify(before),snapshot);assert.equal(JSON.stringify(submitted),incoming);
 assert.notEqual(result[1],before[1]);
 assert.deepEqual(api.mergeVisibleChanges({version:1,grants:[]},'vehicles',before,[],context()),before);
});

test('delete is explicit and hidden rows cannot be edited, replaced or seized by an ID collision',()=>{
 const before=[row('a'),row('private','Б','Юг'),row('b')];
 const noDelete=policy('А','Север',{sections:{vehicles:{actions:['read','update','create']}}});
 deny(()=>api.mergeVisibleChanges(noDelete,'vehicles',before,[before[0]],context()));
 const result=api.mergeVisibleChanges(policy(),'vehicles',before,[before[2]],context());
 assert.deepEqual(result.map(item=>item.id),['private','b']);
 deny(()=>api.mergeVisibleChanges(policy(),'vehicles',before,[before[0],row('private'),before[2]],context()));
 deny(()=>api.mergeVisibleChanges(policy(),'vehicles',before,[before[0],{...before[1],note:'tampered'},before[2]],context()));
 assert.deepEqual(api.mergeVisibleChanges(policy(),'vehicles',before,before,context()),before);
 deny(()=>api.validateChanges(policy(),'vehicles',before,[before[0],before[2]],context()));
});

test('changes require both old and new scopes and cannot alter readonly fields through raw canonical diffs',()=>{
 const before=[row('a','А','Север',{name:'old',salary:10})];
 deny(()=>api.mergeVisibleChanges(policy(),'vehicles',before,[{...before[0],org:'Б'}],context()));
 deny(()=>api.mergeVisibleChanges(policy(),'vehicles',before,[{...before[0],site:'Юг'}],context()));
 const p=policy('А','Север',{sections:{vehicles:{writeFields:['name']}}});
 deny(()=>api.validateChanges(p,'vehicles',before,[{...before[0],salary:11}],context()));
 assert.deepEqual(api.mergeVisibleChanges(p,'vehicles',before,[{id:'a',name:'new'}],context()),[{...before[0],name:'new'}]);
 deny(()=>api.mergeVisibleChanges(p,'vehicles',before,[{id:'a',name:'new',salary:11}],context()));
 deny(()=>api.mergeVisibleChanges(policy(),'vehicles',before,[row('new','Б','Юг')],context()));
});

test('numeric zero and string zero remain independent identities, including hidden collisions',()=>{
 const before=[row(0,'А','Север',{note:'numeric'}),row('0','Б','Юг',{note:'private'})];
 const result=api.mergeVisibleChanges(policy(),'vehicles',before,[{...before[0],note:'changed'}],context());
 assert.equal(result[0].id,0);assert.equal(result[0].note,'changed');assert.equal(result[1].id,'0');assert.equal(result[1].note,'private');
 deny(()=>api.mergeVisibleChanges(policy(),'vehicles',before,[row('0')],context()));
});

test('ambiguous identity groups preserve every occurrence and its position; mutations never choose the first',()=>{
 const before=[row('visible'),row('same','Б','Юг',{n:1}),row('middle'),row('same','Б','Юг',{n:2}),row('last')];
 const result=api.mergeVisibleChanges(policy(),'vehicles',before,[before[0],{...before[2],note:'new'},before[4]],context());
 assert.deepEqual(result.map(item=>[item.id,item.n]),before.map(item=>[item.id,item.n]));assert.equal(result[2].note,'new');
 assert.deepEqual(result.filter(item=>item.id==='same'),[before[1],before[3]]);
 deny(()=>api.mergeVisibleChanges(policy(),'vehicles',before,[before[0],{...before[1],note:'tamper'},before[2],before[3],before[4]],context()));
 deny(()=>api.validateChanges(policy(),'vehicles',before,[before[0],before[1],before[2],{...before[3],n:3},before[4]],context()));
 const visibleDuplicates=[row('x'),row('x')];deny(()=>api.mergeVisibleChanges(policy(),'vehicles',visibleDuplicates,[],context()));
});

test('unchanged projected duplicate groups retain distinct readonly originals instead of persisting projection loss',()=>{
 const before=[row('x','А','Север',{name:'same',private:'first'}),row('middle','Б','Юг'),row('x','А','Север',{name:'same',private:'second'})];
 const p=policy('А','Север',{sections:{vehicles:{readFields:['id','name'],writeFields:['name']}}});
 const projected=api.projectRows(p,'vehicles',before,context());assert.deepEqual(projected,[{id:'x',name:'same'},{id:'x',name:'same'}]);
 assert.deepEqual(api.mergeVisibleChanges(p,'vehicles',before,projected,context()),before);
 deny(()=>api.mergeVisibleChanges(p,'vehicles',before,[projected[0],{...projected[1],name:'changed'}],context()));
});

test('canonical validation protects hidden anchors while allowing authorised deletions before them',()=>{
 const before=[row('a'),row('private','Б','Юг'),row('b')];
 deny(()=>api.validateChanges(policy(),'vehicles',before,[before[1],before[0],before[2]],context()));
 deny(()=>api.validateChanges(policy(),'vehicles',before,[before[0],before[2],before[1]],context()));
 deny(()=>api.validateChanges(policy(),'vehicles',before,[row('new'),...before],context()));
 assert.doesNotThrow(()=>api.validateChanges(policy(),'vehicles',before,[before[1],before[2]],context()));
 assert.doesNotThrow(()=>api.validateChanges(policy(),'vehicles',before,[...before,row('new')],context()));
});

test('composite sources require every organization and readable section before returning a row',()=>{
 const composite=context({resolve:()=>({kind:'owned',owners:[owner()],readRequirements:{sections:['records','payments'],owners:[owner(),owner('Б','Юг')],complete:true}})});
 assert.equal(api.permits(policy(),'records','read',row(1),composite),false);
 const both={version:1,grants:[{org:'А',site:'Север'},{org:'Б',site:'Юг'}]};
 assert.equal(api.permits(both,'records','read',row(1),composite),true);
 assert.equal(api.permits(both,'records','read',row(1),context({...composite,readable:['records']})),false);
 const incomplete=context({resolve:()=>({kind:'owned',owners:[owner()],readRequirements:{sections:['records'],owners:[owner()],complete:false}})});
 assert.equal(api.permits(policy(),'records','read',row(1),incomplete),false);
 assert.equal(api.permits(policy(any,any),'records','read',row(1),incomplete),true);
 assert.equal(api.permits(null,'records','read',row(1),incomplete),true);
});

test('wildcard source requirements still respect specific section denials',()=>{
 const ctx=context({resolve:()=>({kind:'owned',owners:[owner()],readRequirements:{sections:['*'],owners:[],complete:true}})});
 const p=policy('А','Север',{sections:{payments:{actions:[]}}});
 assert.equal(api.permits(p,'vehicles','read',row(1),ctx),false);
 assert.equal(api.permits(policy(),'vehicles','read',row(1),ctx),true);
});

test('unreadable sections and configured empty policies do not consult domain ownership resolvers',()=>{
 let calls=0;const ctx=context({readable:['records'],resolve:()=>{calls++;throw Error('private domain source');}});
 assert.deepEqual(api.projectRows(policy(),'payments',[row(1)],ctx),[]);
 assert.equal(api.permits(policy(),'payments','read',row(1),ctx),false);
 assert.deepEqual(api.projectRows({version:1,grants:[]},'records',[row(1)],ctx),[]);
 assert.equal(calls,0);
});

test('mixed-original names, sizes, hashes and manifests disappear behind one guard while opaque sourceId remains',()=>{
 const original=row('a','А','Север',{note:'old',importProvenance:{sourceId:'opaque-source',sourceArchive:{name:'private-finance.xlsx',size:1450,sha256:'private-hash'},sourceManifest:{id:'private-manifest'},parser:{id:'private-parser'}}});
 const guarded=context({readable:['records'],resolve:(section,item)=>({...resolve(section,item),fieldGuards:[{path:['importProvenance'],requires:{sections:['records','payments'],owners:[owner(),owner('Б','Юг')],complete:true},deniedValue:{sourceId:'opaque-source',originUnavailable:true}}]})});
 const projection=api.projectRows(policy(),'records',[original],guarded);
 assert.deepEqual(projection[0].importProvenance,{sourceId:'opaque-source',originUnavailable:true});
 assert.doesNotMatch(JSON.stringify(projection),/private|1450/);
 const saved=api.mergeVisibleChanges(policy(),'records',[original],[{...projection[0],note:'changed'}],guarded);
 assert.deepEqual(saved[0].importProvenance,original.importProvenance);assert.equal(saved[0].note,'changed');
 const omitted={...projection[0],note:'changed'};delete omitted.importProvenance;
 assert.deepEqual(api.mergeVisibleChanges(policy(),'records',[original],[omitted],guarded)[0].importProvenance,original.importProvenance);
 deny(()=>api.mergeVisibleChanges(policy(),'records',[original],[{...projection[0],importProvenance:{sourceId:'opaque-source',sourceArchive:{name:'forged.xlsx'}}}],guarded));
 const both={version:1,grants:[{org:'А',site:'Север'},{org:'Б',site:'Юг'}]};
 assert.deepEqual(api.projectRows(both,'records',[original],{...guarded,readable:['records','payments']})[0].importProvenance,original.importProvenance);
});

test('nested denied fields are restored while allowed siblings change, including exact zero/false/null values',()=>{
 const original=row('a','А','Север',{details:{note:'old',private:{name:'private.xlsx',size:0},empty:'',no:false,nil:null}});
 const guarded=context({resolve:(section,item)=>({...resolve(section,item),fieldGuards:[{path:['details','private'],requires:{sections:['payments'],owners:[],complete:true}}]}) ,readable:['vehicles']});
 const projected=api.projectRows(policy(),'vehicles',[original],guarded)[0];assert.equal('private' in projected.details,false);
 projected.details.note='new';const saved=api.mergeVisibleChanges(policy(),'vehicles',[original],[projected],guarded)[0];
 assert.deepEqual(saved.details,{...original.details,note:'new'});
 deny(()=>api.mergeVisibleChanges(policy(),'vehicles',[original],[{...projected,details:'replace ancestor'}],guarded));
 deny(()=>api.validateChanges(policy(),'vehicles',[original],[{...original,details:{...original.details,private:{name:'forged'}}}],guarded));
});

test('write-only fields are preserved when omitted; readable writable omissions are exact field deletions',()=>{
 const before=[row('a','А','Север',{name:'old',secret:'saved',blank:'',zero:0,no:false,nil:null})];
 const p=policy('А','Север',{sections:{vehicles:{readFields:['id','name','blank','zero','no','nil'],writeFields:['name','secret','blank','zero','no','nil']}}});
 const projected=api.projectRows(p,'vehicles',before,context());delete projected[0].name;
 const result=api.mergeVisibleChanges(p,'vehicles',before,projected,context());assert.equal('name' in result[0],false);assert.equal(result[0].secret,'saved');
 assert.deepEqual([result[0].blank,result[0].zero,result[0].no,result[0].nil],['',0,false,null]);
 const written=api.mergeVisibleChanges(p,'vehicles',before,[{...projected[0],secret:'new'}],context());assert.equal(written[0].secret,'new');
});

test('policy stamps are bounded digests, order independent, and change with every effective ceiling category',()=>{
 const p={version:1,grants:[{org:'А',site:any,actions:['update','read']},{org:'Б',site:'Юг'}],sections:{vehicles:{readFields:['note','id'],writeFields:['note']}},sharedWrite:['parts','tanks']};
 const reordered={version:1,grants:[p.grants[1],{org:'А',site:{any:true},actions:['read','update','read']}],sections:{vehicles:{writeFields:['note'],readFields:['id','note']}},sharedWrite:['tanks','parts']};
 const stamp=api.policyStamp(p,context());assert.match(stamp,/^sha256:[a-f0-9]{64}$/);assert.equal(stamp,api.policyStamp(reordered,context()));assert.doesNotMatch(stamp,/А|vehicles/);
 for(const changed of [context({readable:['records']}),context({writable:[]}),context({actions:{vehicles:['read']}}),context({readFields:{vehicles:['id']}}),context({writeFields:{vehicles:['note']}})])assert.notEqual(stamp,api.policyStamp(p,changed));
 assert.notEqual(api.policyStamp(null,context()),api.policyStamp({version:1,grants:[]},context()));
 assert.throws(()=>create(contracts,schema,identity).policyStamp(p,context()),{code:'MODULE_UNAVAILABLE'});
 assert.throws(()=>create(contracts,schema,identity,()=>({sha256:()=> 'weak'})).policyStamp(p,context()),{code:'MODULE_UNAVAILABLE'});
});

test('untrusted rows, facts and context descriptors fail without evaluating getters',()=>{
 let invoked=0;const badRow=row(1);Object.defineProperty(badRow,'note',{enumerable:true,get(){invoked++;return 'private';}});
 assert.throws(()=>api.projectRows(policy(),'vehicles',[badRow],context()),{code:'ACCESS_ROW_INVALID'});assert.equal(invoked,0);
 const badContext=context();Object.defineProperty(badContext,'readable',{enumerable:true,get(){invoked++;return ['*'];}});
 assert.throws(()=>api.permits(policy(),'vehicles','read',row(1),badContext),{code:'ACCESS_CONTEXT_INVALID'});assert.equal(invoked,0);
 const badResolver=context();Object.defineProperty(badResolver,'resolve',{enumerable:true,get(){invoked++;return resolve;}});
 assert.throws(()=>api.projectRows(policy(),'vehicles',[row(1)],badResolver),{code:'ACCESS_CONTEXT_INVALID'});assert.equal(invoked,0);
 for(const facts of [{kind:'owned',owners:[{org:{state:'known',value:0},site:known('Север')}]},{kind:'owned',owners:[] ,fieldGuards:[{path:['__proto__'],requires:{sections:[],owners:[],complete:true}}]}])assert.throws(()=>api.projectRows(policy(),'vehicles',[row(1)],context({resolve:()=>facts})),{code:'ACCESS_CONTEXT_INVALID'});
 assert.throws(()=>api.projectRows(policy(),'vehicles',[{id:1,x:NaN}],context()),{code:'ACCESS_ROW_INVALID'});
});
