'use strict';
// Host calls this after the trusted kernel/command collector.
// Neither browser facts nor surviving hot audit siblings are an authority.
const path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const load=name=>require(path.join(ROOT,name));
const schema=load('assets/core/platform-schema.js'),scope=load('assets/core/access-scope.js'),policy=load('assets/core/access-policy.js'),access=load('electron/access-context.cjs');
const names=new Set(schema.sections),own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key),object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
const digest=value=>'sha256:'+crypto.createHash('sha256').update(stable(value)).digest('hex');
const identifier=value=>typeof value==='string'||typeof value==='number'&&Number.isFinite(value);
const typed=(section,id)=>section+'|'+typeof id+':'+JSON.stringify(id),same=(a,b)=>stable(a)===stable(b);
const frozen=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(frozen);Object.freeze(value);}return value;};
// Only this validator's owned, deeply frozen results can reuse validation.
// Caller inputs, including frozen objects, never acquire this capability.
const validatedProofs=new WeakSet();
const subjectIndexes=new WeakMap();
const fail=()=>{throw Object.assign(Error('Invalid frozen operation evidence'),{code:'OPERATION_EVIDENCE_INVALID'});};
function safe(value){
 const seen=new Set(),memo=new WeakMap();let count=0;
 function copy(item,depth){
  if(++count>1000000||depth>80)fail();
  if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;
  if(!item||typeof item!=='object'||seen.has(item))fail();
  const array=Array.isArray(item),proto=Object.getPrototypeOf(item);if(!array&&proto!==Object.prototype&&proto!==null)fail();
  // Snapshots and their event rows deliberately share unchanged data. Own each
  // subtree once instead of copying and counting those same bytes repeatedly.
  const cached=memo.get(item);if(cached){if(depth+cached.height>80)fail();return cached.value;}
  seen.add(item);const result=array?[]:{};let height=0;
  for(const key of Reflect.ownKeys(item)){
   if(array&&key==='length')continue;const property=Object.getOwnPropertyDescriptor(item,key);
   if(typeof key!=='string'||!property?.enumerable||property.get||property.set||['__proto__','constructor','prototype','toJSON'].includes(key)||array&&!/^(0|[1-9][0-9]*)$/.test(key))fail();
   const child=property.value;result[key]=copy(child,depth+1);height=Math.max(height,1+(child&&typeof child==='object'?memo.get(child).height:0));
  }
  if(array&&(result.length!==item.length||Object.keys(result).length!==item.length))fail();
  seen.delete(item);memo.set(item,{value:result,height});return result;
 }
 return copy(value,0);
}
function section(value){if(!names.has(value))fail();return value;}
function list(value){if(!Array.isArray(value)||value.length>100||value.some(name=>!names.has(name))||new Set(value).size!==value.length)fail();return value.slice().sort();}
function operation(value){if(!object(value)||typeof value.id!=='string'||!value.id||value.id.length>200||!/^sha256:[a-f0-9]{64}$/.test(value.digest)||typeof value.actorId!=='string'||!value.actorId||typeof value.actorRole!=='string'||!value.actorRole||typeof value.databaseToken!=='string'||!value.databaseToken)fail();return {id:value.id,digest:value.digest,actorId:value.actorId,actorRole:value.actorRole,databaseToken:value.databaseToken};}
const unknown=()=>({kind:'unknown',owners:[],readRequirements:{sections:[],owners:[],complete:false}});
let factsReader;
function validateFacts(value,ownedChecks){if(!object(value))fail();
 // This memo is supplied only after safe() owns the complete proof. Raw resolver
 // facts and caller objects always take the full validation path.
 const key=ownedChecks?stable(value):null;if(key!==null&&ownedChecks.has(key))return value;
 factsReader??=policy.createReader(null,{readable:schema.sections,writable:[],resolve:unknown});factsReader.permits('vehicles','read',{id:'evidence-validation'},()=>value);
 if(key!==null&&key.length<=4096&&ownedChecks.size<256)ownedChecks.add(key);return value;}
const complete=facts=>facts!==null&&facts.kind!=='unknown'&&facts.readRequirements?.complete!==false;
function changed(before,after){return [...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(key=>key!=='id'&&(!own(before||{},key)||!own(after||{},key)||!same(before[key],after[key]))).sort();}
function fragment(row,fields,sectionName){if(row===null)return null;const result={},identity=schema.descriptors[sectionName]?.identity,identityFields=[identity?.field,identity?.natural?.field,...(identity?.composite||[]),...(sectionName==='documentDrafts'?['section']:[])].filter(Boolean);if(own(row,'id'))result.id=row.id;for(const field of [...identityFields,...fields])if(own(row,field))result[field]=row[field];return result;}
function makeSubject(sectionName,before,after,beforeFacts,afterFacts,fields=changed(before,after)){
 const id=identifier(after?.id)?after.id:identifier(before?.id)?before.id:undefined;
 return {section:sectionName,...(id===undefined?{}:{id}),before:fragment(before,fields,sectionName),after:fragment(after,fields,sectionName),beforeFacts,afterFacts,beforeHash:before===null?null:digest(before),afterHash:after===null?null:digest(after),changedFields:fields,action:before===null?'create':after===null?'delete':'update'};
}
function compactSelectedFacts(facts,row){
 if(facts===null)return null;
 // Check the complete original facts first: an unused malformed guard must
 // never become acceptable merely because its field is outside the fragment.
 validateFacts(facts);
 if(!Array.isArray(facts.fieldGuards))return facts;
 const guards=facts.fieldGuards.filter(guard=>{
  let value=row;for(const token of guard.path){if(value===null||typeof value!=='object'||!own(value,token))return false;value=value[token];}return true;
 });
 return guards.length===facts.fieldGuards.length?facts:{...facts,fieldGuards:guards};
}
function grouped(sectionName,rows){const groups=new Map();for(const [index,row]of rows.entries()){const key=load('assets/core/platform-integrity.js').rowIdentity(sectionName,row,index),list=groups.get(key)||[];list.push(row);groups.set(key,list);}return {groups};}
function ownedDatabase(value){if(!object(value))fail();const result={};for(const name of schema.sections){const rows=value[name]??[];if(!Array.isArray(rows)||rows.some(row=>!object(row)))fail();result[name]=rows;}return result;}
function archiveCapture(selected,bound){
 const value=selected.value;if(!object(value)||value.type!=='document-print-seal')return null;
 if(value.version!==1||value.previous!==null&&!/^[a-f0-9]{64}$/.test(value.previous)||!object(value.snapshot)||!object(value.accessScope)||value.accessScope.version!==1||!Array.isArray(value.accessScope.rows))fail();
 load('assets/core/document-print.js').verify(value.snapshot);const declared=list(value.snapshot.requiredReadSections),database=ownedDatabase({});
 for(const item of value.accessScope.rows){if(!object(item)||!names.has(item.section)||!object(item.row))fail();database[item.section].push(item.row);}
 const resolver=scope.createResolver(database),sourceRows=value.accessScope.rows.map(item=>{const facts=resolver.resolve(item.section,item.row),subject=makeSubject(item.section,item.row,null,facts,null,Object.keys(item.row).sort());subject.kind='archive-source';subject.fullReadRequired=true;return subject;}),sourceFacts=sourceRows.map(item=>item.beforeFacts),owners=sourceFacts.flatMap(facts=>facts.owners),requiredSections=[...new Set([...declared,...sourceFacts.flatMap(facts=>facts.readRequirements?.sections||[])])].sort();
 const facts={kind:sourceFacts.length&&sourceFacts.every(facts=>facts.kind==='shared')?'shared':'owned',owners,readRequirements:{sections:requiredSections,owners:[...owners,...sourceFacts.flatMap(facts=>facts.readRequirements?.owners||[])],complete:sourceFacts.length>0&&sourceFacts.every(complete)}};
 let record=value;if(own(selected,'record')){record=selected.record;if(!object(record)||record.version!==1||record.type!=='document-print-artifact'||record.previous!==null&&!/^[a-f0-9]{64}$/.test(record.previous)||!object(record.artifact)||record.artifact.archiveId!==digest(value).slice(7)||!['pdf','xlsx'].includes(record.artifact.format)||!/^[a-f0-9]{64}$/.test(record.artifact.sha256)||!Number.isSafeInteger(record.artifact.size)||record.artifact.size<=0||record.capture?.operationId!==bound.id)fail();}
 return {facts,sourceRows,record,hash:digest(record).slice(7)};
}
function archiveHead(row){return object(row)&&Object.keys(row).length===4&&row.id==='document-archive-head'&&row.kind==='documentArchive'&&row.version===1&&typeof row.head==='string'&&/^[a-f0-9]{64}$/.test(row.head);}
function provenArchiveHead(previous,next,captures){
 const select=database=>database.appMeta.filter(row=>row.id==='document-archive-head'||row.kind==='documentArchive'),before=select(previous),after=select(next);if(before.length>1||after.length!==1||before.length&&!archiveHead(before[0])||!archiveHead(after[0]))return false;
 const expected=before[0]?.head??null,records=new Map([...captures.values()].map(item=>[item.hash,item.record])),seen=new Set();let cursor=after[0].head;while(cursor!==expected){if(seen.has(cursor)||!records.has(cursor))return false;seen.add(cursor);cursor=records.get(cursor).previous;}return seen.size>0;
}

function createProof(input){
 const source=safe(input),previous=ownedDatabase(source.previous),next=ownedDatabase(source.next),beforeResolver=scope.createResolver(previous),afterResolver=scope.createResolver(next),receipt=source.receipt;
 const indexes={before:new Map(),after:new Map()};
 const byId=(phase,name,id)=>{let index=indexes[phase].get(name);if(!index){index=new Map();for(const row of (phase==='before'?previous:next)[name])if(identifier(row.id)){const group=index.get(row.id)||[];group.push(row);index.set(row.id,group);}indexes[phase].set(name,index);}return index.get(id)||[];};
 if(!object(source.principal)||typeof source.principal.id!=='string'||!source.principal.id||typeof source.principal.role!=='string'||!source.principal.role)fail();
 const bound=operation(receipt?.operation),principal=access.normalizePrincipal(source.principal);if(principal.id!==bound.actorId||principal.role!==bound.actorRole)fail();
 const issues=[],descriptor=object(source.sections)?source.sections:null;
 const writes=descriptor?list(descriptor.writeSections):Array.isArray(source.sections)?list(source.sections):list(receipt.changedSections||[]);
 const reads=descriptor?list(descriptor.readSections):writes.slice();
 const requested=descriptor&&Array.isArray(descriptor.selectedTargets)?descriptor.selectedTargets:[];
 const archives=new Map();for(const selected of requested)if(object(selected)&&selected.kind==='archive'){const capture=archiveCapture(selected,bound);if(capture)archives.set(selected,capture);}
 const trustedArchiveHead=provenArchiveHead(previous,next,archives),headFacts={kind:'shared',owners:[]};
 let verified=source.mode==='transaction'&&descriptor?.complete===true&&Array.isArray(descriptor.selectedTargets)&&Array.isArray(source.events);
 if(!verified)issues.push('historical-or-incomplete-collector');
 if(source.commandIntent){try{const command=source.commandIntent.command||source.commandIntent,required=load('assets/core/platform-commands.js').dependencies(command);if(required.some(name=>!reads.includes(name)))verified=false;}catch{verified=false;}if(!verified)issues.push('unconfirmed-command-closure');}
 const subjects=[];
 for(const name of writes){if(name==='auditLog')continue;const left=grouped(name,previous[name]),right=grouped(name,next[name]);
  for(const key of new Set([...left.groups.keys(),...right.groups.keys()])){const a=left.groups.get(key)||[],b=right.groups.get(key)||[];if(same(a,b))continue;for(let index=0;index<Math.max(a.length,b.length);index++){const before=a[index]||null,after=b[index]||null;if(same(before,after))continue;const technical=name==='appMeta'&&trustedArchiveHead&&(before===null||archiveHead(before))&&(after===null||archiveHead(after)),beforeFacts=before===null?null:technical?headFacts:beforeResolver.resolve(name,before),afterFacts=after===null?null:technical?headFacts:afterResolver.resolve(name,after);subjects.push(makeSubject(name,before,after,beforeFacts,afterFacts));}}
 }
 // Explicit selected rows are the collector's actual read closure, including
 // no-op targets. There is no independent command-to-target guess here.
 const selectedTargets=[];
 for(const selected of requested){if(!object(selected))fail();const name=section(selected.section),kind=selected.kind||'row';let before=null,after=null,beforeFacts=null,afterFacts=null;
  if(kind==='archive'||kind==='source'){if(!object(selected.value))fail();before=selected.value;after=selected.value;const declared=kind==='source'?before.sourceScopes:before.snapshot?.requiredReadSections??before.requiredReadSections;if(!Array.isArray(declared)||declared.some(name=>!names.has(name))){verified=false;issues.push('unclassified-composite-source');}const captured=archives.get(selected);beforeFacts=captured?captured.facts:kind==='archive'?beforeResolver.resolveArchive(before):beforeResolver.resolveSource(before);afterFacts=captured?captured.facts:kind==='archive'?afterResolver.resolveArchive(after):afterResolver.resolveSource(after);if(captured)selectedTargets.push(...captured.sourceRows);}
  else if(kind==='row'){
   if(own(selected,'id')){if(!identifier(selected.id))fail();const a=byId('before',name,selected.id),b=byId('after',name,selected.id);if(a.length>1||b.length>1||!a.length&&!b.length){verified=false;issues.push('selected-target-missing-or-ambiguous');}before=a.length===1?a[0]:null;after=b.length===1?b[0]:null;}
   else {for(const phase of ['before','after'])if(selected[phase]!==null&&selected[phase]!==undefined){const row=selected[phase];if(!object(row))fail();const rows=(phase==='before'?previous:next)[name],position=selected[phase+'Index'];let matched;if(position!==undefined){if(!Number.isSafeInteger(position)||position<0||position>=rows.length||!same(rows[position],row))fail();matched=rows[position];}else{const matches=rows.filter(value=>same(value,row));if(matches.length!==1){verified=false;issues.push('idless-target-not-unique');}else matched=matches[0];}if(matched){if(phase==='before')before=matched;else after=matched;}}}
   beforeFacts=before===null?null:beforeResolver.resolve(name,before);afterFacts=after===null?null:afterResolver.resolve(name,after);
  }else fail();
  if(before===null&&after===null){verified=false;issues.push('unverified-selected-target');}
  const item=makeSubject(name,before,after,beforeFacts,afterFacts,[]);
  // A row dependency already retains its exact typed identity in both phase
  // fragments. Avoid repeating that identity and the default discriminator in
  // every selected row of a large reviewed source closure.
  if(kind==='row'){
   delete item.id;
   // These guards are used only to project this exact read fragment. Changed
   // subjects and full archive/source captures keep their complete facts.
   if(item.fullReadRequired!==true){item.beforeFacts=compactSelectedFacts(item.beforeFacts,item.before);item.afterFacts=compactSelectedFacts(item.afterFacts,item.after);}
  }else item.kind=kind;
  selectedTargets.push(item);
 }
 const actual=[...new Set(subjects.map(row=>row.section))].sort(),declared=list(receipt.changedSections||[]).filter(name=>name!=='auditLog');if(!same(actual,declared)){verified=false;issues.push('changed-section-coverage-mismatch');}
 const requiredSections=[...new Set([...reads,...writes,...selectedTargets.map(row=>row.section),...subjects.flatMap(row=>[...(row.beforeFacts?.readRequirements?.sections||[]),...(row.afterFacts?.readRequirements?.sections||[])]),...selectedTargets.flatMap(row=>[...(row.beforeFacts?.readRequirements?.sections||[]),...(row.afterFacts?.readRequirements?.sections||[])])])].sort();
 if(!requiredSections.length){verified=false;issues.push('missing-request-section');}
 const eventGuards=(source.events||[]).map(event=>({hash:digest(event),fieldGuards:[...(beforeResolver.resolve('auditLog',event).fieldGuards||[]),...(afterResolver.resolve('auditLog',event).fieldGuards||[])]}));
 const request={version:1,globalReadRequired:source.commandIntent?.command?.type==='MergeCatalog',actor:{id:principal.id,role:principal.role,policyStamp:principal.policyStamp},operation:bound,mode:source.mode||'legacy',dependencies:reads.map(section=>({section,action:'read'})),selectedTargets,eventHashes:(source.events||[]).map(digest),eventGuards,issues:[...new Set(issues)].sort()};
 return frozen({version:1,status:verified?'verified':'legacy-unverified',requiredSections,subjects,request});
}
function createLegacyProof(receiptValue,{requiredSections}={}){
 const receipt=safe(receiptValue),bound=operation(receipt.operation);if(!own(load('electron/access-control').ROLES,bound.actorRole)||typeof receipt.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(receipt.at)||!Number.isFinite(Date.parse(receipt.at)))fail();
 const sections=list(requiredSections??receipt.changedSections??[]);return frozen({version:1,status:'legacy-unverified',requiredSections:sections,subjects:[],request:{version:1,mode:'legacy',actor:{id:bound.actorId,role:bound.actorRole,policyStamp:null},operation:bound,originalAt:receipt.at,dependencies:sections.map(section=>({section,action:'read'})),selectedTargets:[],eventHashes:[],eventGuards:[],issues:['original-access-proof-unverified']}});
}

function validateSubject(subject,ownedChecks){
 if(!object(subject)||!names.has(subject.section)||!Array.isArray(subject.changedFields)||subject.changedFields.length>1000||new Set(subject.changedFields).size!==subject.changedFields.length||subject.changedFields.some(field=>typeof field!=='string'||!field)||!['create','update','delete'].includes(subject.action)||own(subject,'id')&&!identifier(subject.id))fail();
 for(const phase of ['before','after']){const row=subject[phase],facts=subject[phase+'Facts'],hash=subject[phase+'Hash'];if(row===null){if(facts!==null||hash!==null)fail();}else {if(!object(row)||!/^sha256:[a-f0-9]{64}$/.test(hash))fail();validateFacts(facts,ownedChecks);if(own(subject,'id')&&row.id!==subject.id)fail();}}
 if(subject.before===null&&subject.after===null||subject.action!==(subject.before===null?'create':subject.after===null?'delete':'update'))fail();
 if(own(subject,'fullReadRequired')&&(subject.fullReadRequired!==true||subject.kind!=='archive-source'||subject.before===null||subject.after!==null||!same(subject.changedFields,Object.keys(subject.before).sort())))fail();
 return subject;
}
function validateProof(input){
 if(validatedProofs.has(input))return input;
 // Only the ledger's own decoded, deeply frozen JSON can avoid the defensive
 // copy. Its decoder enforces the same node/depth/key/type limits. Proof shape
 // and every access fact are still validated below before acquiring this mark.
 const proof=load('electron/operation-ledger.cjs').isOwnedStrictJSON(input)?input:safe(input);if(!object(proof)||proof.version!==1||!['verified','legacy-unverified'].includes(proof.status)||!Array.isArray(proof.subjects)||proof.subjects.length>5000||!object(proof.request)||proof.request.version!==1)fail();list(proof.requiredSections);
 const request=proof.request,bound=operation(request.operation),ownedChecks=new Set();if(own(request,'globalReadRequired')&&typeof request.globalReadRequired!=='boolean')fail();if(!object(request.actor)||request.actor.id!==bound.actorId||request.actor.role!==bound.actorRole||!(/^sha256:[a-f0-9]{64}$/.test(request.actor.policyStamp)||proof.status==='legacy-unverified'&&request.actor.policyStamp===null)||!Array.isArray(request.dependencies)||!Array.isArray(request.selectedTargets)||!Array.isArray(request.eventHashes)||request.eventHashes.some(value=>!/^sha256:[a-f0-9]{64}$/.test(value))||!Array.isArray(request.eventGuards)||request.eventGuards.length!==request.eventHashes.length)fail();
 for(const [index,event]of request.eventGuards.entries()){if(!object(event)||event.hash!==request.eventHashes[index]||!Array.isArray(event.fieldGuards))fail();validateFacts({...unknown(),fieldGuards:event.fieldGuards},ownedChecks);}
 for(const dependency of request.dependencies)if(!object(dependency)||!names.has(dependency.section)||dependency.action!=='read')fail();
 for(const subject of [...proof.subjects,...request.selectedTargets])validateSubject(subject,ownedChecks);
 if(proof.status==='verified'&&(request.mode!=='transaction'||!proof.requiredSections.length||request.dependencies.some(row=>!proof.requiredSections.includes(row.section))||[...proof.subjects,...request.selectedTargets].some(row=>!proof.requiredSections.includes(row.section))))fail();
 const checked=frozen(proof);validatedProofs.add(checked);return checked;
}
function environment(principal){if(!object(principal)||typeof principal.id!=='string'||!principal.id||typeof principal.role!=='string'||!principal.role)fail();const empty=Object.fromEntries(schema.sections.map(name=>[name,[]])),base=access.create(empty,empty,principal);return {...base,current:base.principal,reader:policy.createReader(base.policy,base.context)};}
function subjectContext(env,subject,phase=null){return {...env.context,resolve:(name,row,requested='before')=>{const selected=phase||requested;if(name!==subject.section||subject[selected]===null||!same(row,subject[selected]))return unknown();return subject[selected+'Facts'];}};}
function projectSubject(env,subject,phase){if(subject[phase]===null)return null;const row=env.reader.projectRows(subject.section,[subject[phase]],subjectContext(env,subject,phase).resolve)[0]||null;return row&&subject.section==='fuelPeriods'?load('electron/period-access.cjs').visibleRow(row,env.current):row;}
function subjectAllowed(env,subject,{changedFields=false}={}){if(!load('electron/document-access.cjs').auditAccess(env.current,subject)||!load('electron/period-access.cjs').auditAccess(env.current,subject))return false;if(subject.section!=='fuelPeriods'&&legacyEnvironmentAllowed(env))return true;for(const phase of ['before','after'])if(subject[phase]!==null){const row=projectSubject(env,subject,phase);if(!row)return false;if(changedFields)for(const field of subject.changedFields)if(own(subject[phase],field)&&(!own(row,field)||!(subject.section==='fuelPeriods'&&field==='closureEvents')&&!same(row[field],subject[phase][field])))return false;}return true;}
const legacyReadEnvironments=new WeakMap();
function legacyEnvironmentAllowed(env){
 if(legacyReadEnvironments.has(env))return legacyReadEnvironments.get(env);
 const allowed=legacyEnvironmentCheck(env);legacyReadEnvironments.set(env,allowed);return allowed;
}
function legacyEnvironmentCheck(env){
 if(env.current.role!=='admin'||env.context.readFields&&Object.values(env.context.readFields).some(fields=>!fields.includes('*'))||env.context.writeFields&&Object.values(env.context.writeFields).some(fields=>!fields.includes('*')))return false;
 for(const rule of Object.values(env.policy?.sections||{}))if(rule.readFields&&!rule.readFields.includes('*')||rule.writeFields&&!rule.writeFields.includes('*'))return false;
 const actions=[...Object.values(env.context.actions||{}),...Object.values(env.policy?.sections||{}).map(rule=>rule.actions).filter(Boolean),...(env.policy?.grants||[]).map(grant=>grant.actions).filter(Boolean)];if(actions.some(value=>!value.includes('*')))return false;
 return schema.sections.every(name=>env.reader.permits(name,'read',{id:'unverified-history'},unknown));
}
function canReadSection(env,name){return legacyEnvironmentAllowed(env)?names.has(name):access.sectionAllowed(env.current,'read',name);}
function legacyAllowed(env,proof){return legacyEnvironmentAllowed(env)&&proof.requiredSections.every(name=>names.has(name));}
function isGloballyUnrestricted(principal){try{return legacyAllowed(environment(principal),{requiredSections:schema.sections});}catch{return false;}}
function permitted(env,proof,bindActor){
 if(proof.request.globalReadRequired===true&&!legacyAllowed(env,{requiredSections:schema.sections}))return false;
 if(bindActor&&(env.current.id!==proof.request.actor.id||env.current.role!==proof.request.actor.role))return false;
 if(!proof.requiredSections.length||proof.requiredSections.some(name=>!canReadSection(env,name)))return false;
 if(proof.status!=='verified')return legacyAllowed(env,proof);
 return proof.subjects.every(row=>subjectAllowed(env,row,{changedFields:true}))&&proof.request.selectedTargets.every(row=>subjectAllowed(env,row,{changedFields:row.fullReadRequired===true}));
}
function authorizeProof(proof,principal,receipt){try{const checked=validateProof(proof);if(receipt!==undefined&&!same(operation(receipt.operation||receipt),checked.request.operation))return false;return permitted(environment(principal),checked,true);}catch{return false;}}
function eventSubject(event,proof){
 const fields=changed(event.before||null,event.after||null),hashes={before:(event.before??null)===null?null:digest(event.before),after:(event.after??null)===null?null:digest(event.after)};
 const trusted=validatedProofs.has(proof);let index=trusted?subjectIndexes.get(proof):undefined;
 if(!index){index=new Map();for(const row of proof.subjects){const key=stable([row.section,row.changedFields,row.beforeHash,row.afterHash]),candidates=index.get(key)||[];candidates.push(row);index.set(key,candidates);}if(trusted)subjectIndexes.set(proof,index);}
 const candidates=index.get(stable([event.section,fields,hashes.before,hashes.after]))||[];
 return candidates.find(row=>row.section===event.section&&same(row.changedFields,fields)&&['before','after'].every(phase=>(event[phase]??null)===null?row[phase]===null:hashes[phase]===row[phase+'Hash']&&same(fragment(event[phase],row.changedFields,event.section),row[phase])));
}
function projectEvent(eventValue,proofValue,principal){try{return projectEventInEnvironment(eventValue,proofValue,environment(principal));}catch{return null;}}
function projectEventInEnvironment(eventValue,proofValue,env){try{
 const event=safe(eventValue),proof=validateProof(proofValue),eventHash=digest(event);if(!names.has(event.section)||!canReadSection(env,'auditLog')||!proof.request.eventHashes.includes(eventHash)||event.operationId!==undefined&&event.operationId!==proof.request.operation.id)return null;
 if(!load('electron/document-access.cjs').auditAccess(env.current,event)||!load('electron/period-access.cjs').auditAccess(env.current,event))return null;
 const {archiveScope,...publicEvent}=event;let projected={...publicEvent},facts=[];
 if(event.before||event.after){const subject=eventSubject(event,proof);if(!subject||proof.status!=='verified'&&!legacyAllowed(env,proof))return null;
  for(const phase of ['before','after'])if(event[phase]){const row=event[phase],phaseFacts=subject[phase+'Facts'],resolve=(section,value)=>section===event.section&&digest(value)===subject[phase+'Hash']?phaseFacts:unknown(),value=env.reader.projectRows(event.section,[row],resolve)[0];if(!value)return null;projected[phase]=value;facts.push(phaseFacts);}
  if(Array.isArray(event.fields))projected.fields=event.fields.filter(field=>own(projected.before||{},field)||own(projected.after||{},field));
 }else {if(!permitted(env,proof,false))return null;facts=[...proof.subjects,...proof.request.selectedTargets].flatMap(row=>[row.beforeFacts,row.afterFacts].filter(Boolean));}
 const eventFacts={kind:facts.every(row=>row.kind==='shared')&&proof.status==='verified'?'shared':facts.length?'owned':'unknown',owners:facts.flatMap(row=>row.owners),readRequirements:{sections:[event.section],owners:facts.flatMap(row=>row.readRequirements?.owners||[]),complete:proof.status==='verified'&&facts.every(complete)},fieldGuards:proof.request.eventGuards.find(value=>value.hash===eventHash).fieldGuards};
 projected=load('electron/period-access.cjs').visibleAuditRow(projected,env.current);
 return env.reader.projectRows('auditLog',[projected],()=>eventFacts)[0]||null;
 }catch{return null;}}
function projectLegacyEvent(eventValue,principal){try{return projectLegacyEventInEnvironment(eventValue,environment(principal));}catch{return null;}}
function projectLegacyEventInEnvironment(eventValue,env){try{
 const event=safe(eventValue);if(!object(event)||!names.has(event.section))return null;
 const actionLists=[...Object.values(env.context.actions||{}),...Object.values(env.policy?.sections||{}).map(rule=>rule.actions).filter(Boolean),...(env.policy?.grants||[]).map(grant=>grant.actions).filter(Boolean)];if(actionLists.some(actions=>!actions.includes('*')))return null;
 const required=new Set(['auditLog',event.section]);for(const field of ['changedSections','archiveReadSections','importReadSections'])if(own(event,field)){if(!Array.isArray(event[field])||event[field].some(name=>!names.has(name)))return null;event[field].forEach(name=>required.add(name));}
 if(!legacyAllowed(env,{requiredSections:[...required]})||!load('electron/document-access.cjs').auditAccess(env.current,event)||!load('electron/period-access.cjs').auditAccess(env.current,event))return null;
 const {archiveScope,...projected}=event;return frozen(load('electron/period-access.cjs').visibleAuditRow(projected,env.current));
 }catch{return null;}}
// One owned permission snapshot per synchronous response; never shared across
// requests or keyed by a mutable caller principal.
function createEventProjector(principal){try{const env=environment(principal);return Object.freeze({projectEvent:(event,proof)=>projectEventInEnvironment(event,proof,env),projectLegacyEvent:event=>projectLegacyEventInEnvironment(event,env)});}catch{return Object.freeze({projectEvent:()=>null,projectLegacyEvent:()=>null});}}
module.exports=Object.freeze({apiVersion:1,createProof,createLegacyProof,authorizeProof,projectEvent,projectLegacyEvent,createEventProjector,validateProof,isGloballyUnrestricted});
