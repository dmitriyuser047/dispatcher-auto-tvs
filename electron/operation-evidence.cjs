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
const fail=()=>{throw Object.assign(Error('Invalid frozen operation evidence'),{code:'OPERATION_EVIDENCE_INVALID'});};
function safe(value){const seen=new Set();let count=0;function copy(item,depth){if(++count>1000000||depth>80)fail();if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;if(!item||typeof item!=='object'||seen.has(item))fail();const array=Array.isArray(item),proto=Object.getPrototypeOf(item);if(!array&&proto!==Object.prototype&&proto!==null)fail();seen.add(item);const result=array?[]:{};for(const key of Reflect.ownKeys(item)){if(array&&key==='length')continue;const property=Object.getOwnPropertyDescriptor(item,key);if(typeof key!=='string'||!property?.enumerable||property.get||property.set||['__proto__','constructor','prototype','toJSON'].includes(key)||array&&!/^(0|[1-9][0-9]*)$/.test(key))fail();result[key]=copy(property.value,depth+1);}if(array&&(result.length!==item.length||Object.keys(result).length!==item.length))fail();seen.delete(item);return result;}return copy(value,0);}
function section(value){if(!names.has(value))fail();return value;}
function list(value){if(!Array.isArray(value)||value.length>100||value.some(name=>!names.has(name))||new Set(value).size!==value.length)fail();return value.slice().sort();}
function operation(value){if(!object(value)||typeof value.id!=='string'||!value.id||value.id.length>200||!/^sha256:[a-f0-9]{64}$/.test(value.digest)||typeof value.actorId!=='string'||!value.actorId||typeof value.actorRole!=='string'||!value.actorRole||typeof value.databaseToken!=='string'||!value.databaseToken)fail();return {id:value.id,digest:value.digest,actorId:value.actorId,actorRole:value.actorRole,databaseToken:value.databaseToken};}
const unknown=()=>({kind:'unknown',owners:[],readRequirements:{sections:[],owners:[],complete:false}});
function validateFacts(value){if(!object(value))fail();policy.permits(null,'vehicles','read',{id:'evidence-validation'},{readable:schema.sections,writable:[],resolve:()=>value});return value;}
const complete=facts=>facts!==null&&facts.kind!=='unknown'&&facts.readRequirements?.complete!==false;
function changed(before,after){return [...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(key=>key!=='id'&&(!own(before||{},key)||!own(after||{},key)||!same(before[key],after[key]))).sort();}
function fragment(row,fields,sectionName){if(row===null)return null;const result={},identity=schema.descriptors[sectionName]?.identity,identityFields=[identity?.field,identity?.natural?.field,...(identity?.composite||[]),...(sectionName==='documentDrafts'?['section']:[])].filter(Boolean);if(own(row,'id'))result.id=row.id;for(const field of [...identityFields,...fields])if(own(row,field))result[field]=row[field];return result;}
function makeSubject(sectionName,before,after,beforeFacts,afterFacts,fields=changed(before,after)){
 const id=identifier(after?.id)?after.id:identifier(before?.id)?before.id:undefined;
 return {section:sectionName,...(id===undefined?{}:{id}),before:fragment(before,fields,sectionName),after:fragment(after,fields,sectionName),beforeFacts,afterFacts,beforeHash:before===null?null:digest(before),afterHash:after===null?null:digest(after),changedFields:fields,action:before===null?'create':after===null?'delete':'update'};
}
function grouped(sectionName,rows){const groups=new Map();for(const [index,row]of rows.entries()){const key=load('assets/core/platform-integrity.js').rowIdentity(sectionName,row,index),list=groups.get(key)||[];list.push(row);groups.set(key,list);}return {groups};}
function ownedDatabase(value){if(!object(value))fail();const result={};for(const name of schema.sections){const rows=value[name]??[];if(!Array.isArray(rows)||rows.some(row=>!object(row)))fail();result[name]=rows;}return result;}

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
 let verified=source.mode==='transaction'&&descriptor?.complete===true&&Array.isArray(descriptor.selectedTargets)&&Array.isArray(source.events);
 if(!verified)issues.push('historical-or-incomplete-collector');
 if(source.commandIntent){try{const command=source.commandIntent.command||source.commandIntent,required=load('assets/core/platform-commands.js').dependencies(command);if(required.some(name=>!reads.includes(name)))verified=false;}catch{verified=false;}if(!verified)issues.push('unconfirmed-command-closure');}
 const subjects=[];
 for(const name of writes){if(name==='auditLog')continue;const left=grouped(name,previous[name]),right=grouped(name,next[name]);
  for(const key of new Set([...left.groups.keys(),...right.groups.keys()])){const a=left.groups.get(key)||[],b=right.groups.get(key)||[];if(same(a,b))continue;for(let index=0;index<Math.max(a.length,b.length);index++){const before=a[index]||null,after=b[index]||null;if(same(before,after))continue;const beforeFacts=before===null?null:beforeResolver.resolve(name,before),afterFacts=after===null?null:afterResolver.resolve(name,after);subjects.push(makeSubject(name,before,after,beforeFacts,afterFacts));}}
 }
 // Explicit selected rows are the collector's actual read closure, including
 // no-op targets. There is no independent command-to-target guess here.
 const selectedTargets=[];
 for(const selected of requested){if(!object(selected))fail();const name=section(selected.section),kind=selected.kind||'row';let before=null,after=null,beforeFacts=null,afterFacts=null;
  if(kind==='archive'||kind==='source'){if(!object(selected.value))fail();before=selected.value;after=selected.value;const declared=kind==='source'?before.sourceScopes:before.snapshot?.requiredReadSections??before.requiredReadSections;if(!Array.isArray(declared)||declared.some(name=>!names.has(name))){verified=false;issues.push('unclassified-composite-source');}beforeFacts=kind==='archive'?beforeResolver.resolveArchive(before):beforeResolver.resolveSource(before);afterFacts=kind==='archive'?afterResolver.resolveArchive(after):afterResolver.resolveSource(after);}
  else if(kind==='row'){
   if(own(selected,'id')){if(!identifier(selected.id))fail();const a=byId('before',name,selected.id),b=byId('after',name,selected.id);if(a.length>1||b.length>1||!a.length&&!b.length){verified=false;issues.push('selected-target-missing-or-ambiguous');}before=a.length===1?a[0]:null;after=b.length===1?b[0]:null;}
   else {for(const phase of ['before','after'])if(selected[phase]!==null&&selected[phase]!==undefined){const row=selected[phase];if(!object(row))fail();const rows=(phase==='before'?previous:next)[name],position=selected[phase+'Index'];let matched;if(position!==undefined){if(!Number.isSafeInteger(position)||position<0||position>=rows.length||!same(rows[position],row))fail();matched=rows[position];}else{const matches=rows.filter(value=>same(value,row));if(matches.length!==1){verified=false;issues.push('idless-target-not-unique');}else matched=matches[0];}if(matched){if(phase==='before')before=matched;else after=matched;}}}
   beforeFacts=before===null?null:beforeResolver.resolve(name,before);afterFacts=after===null?null:afterResolver.resolve(name,after);
  }else fail();
  if(before===null&&after===null){verified=false;issues.push('unverified-selected-target');}
  const item=makeSubject(name,before,after,beforeFacts,afterFacts,[]);item.kind=kind;selectedTargets.push(item);
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

function validateSubject(subject){
 if(!object(subject)||!names.has(subject.section)||!Array.isArray(subject.changedFields)||subject.changedFields.length>1000||new Set(subject.changedFields).size!==subject.changedFields.length||subject.changedFields.some(field=>typeof field!=='string'||!field)||!['create','update','delete'].includes(subject.action)||own(subject,'id')&&!identifier(subject.id))fail();
 for(const phase of ['before','after']){const row=subject[phase],facts=subject[phase+'Facts'],hash=subject[phase+'Hash'];if(row===null){if(facts!==null||hash!==null)fail();}else {if(!object(row)||!/^sha256:[a-f0-9]{64}$/.test(hash))fail();validateFacts(facts);if(own(subject,'id')&&row.id!==subject.id)fail();}}
 if(subject.before===null&&subject.after===null||subject.action!==(subject.before===null?'create':subject.after===null?'delete':'update'))fail();
 return subject;
}
function validateProof(input){
 const proof=safe(input);if(!object(proof)||proof.version!==1||!['verified','legacy-unverified'].includes(proof.status)||!Array.isArray(proof.subjects)||proof.subjects.length>5000||!object(proof.request)||proof.request.version!==1)fail();list(proof.requiredSections);
 const request=proof.request,bound=operation(request.operation);if(own(request,'globalReadRequired')&&typeof request.globalReadRequired!=='boolean')fail();if(!object(request.actor)||request.actor.id!==bound.actorId||request.actor.role!==bound.actorRole||!(/^sha256:[a-f0-9]{64}$/.test(request.actor.policyStamp)||proof.status==='legacy-unverified'&&request.actor.policyStamp===null)||!Array.isArray(request.dependencies)||!Array.isArray(request.selectedTargets)||!Array.isArray(request.eventHashes)||request.eventHashes.some(value=>!/^sha256:[a-f0-9]{64}$/.test(value))||!Array.isArray(request.eventGuards)||request.eventGuards.length!==request.eventHashes.length)fail();
 for(const [index,event]of request.eventGuards.entries()){if(!object(event)||event.hash!==request.eventHashes[index]||!Array.isArray(event.fieldGuards))fail();validateFacts({...unknown(),fieldGuards:event.fieldGuards});}
 for(const dependency of request.dependencies)if(!object(dependency)||!names.has(dependency.section)||dependency.action!=='read')fail();
 for(const subject of [...proof.subjects,...request.selectedTargets])validateSubject(subject);
 if(proof.status==='verified'&&(request.mode!=='transaction'||!proof.requiredSections.length||request.dependencies.some(row=>!proof.requiredSections.includes(row.section))||[...proof.subjects,...request.selectedTargets].some(row=>!proof.requiredSections.includes(row.section))))fail();
 return frozen(proof);
}
function environment(principal){if(!object(principal)||typeof principal.id!=='string'||!principal.id||typeof principal.role!=='string'||!principal.role)fail();const empty=Object.fromEntries(schema.sections.map(name=>[name,[]])),base=access.create(empty,empty,principal);return {...base,current:base.principal};}
function subjectContext(env,subject,phase=null){return {...env.context,resolve:(name,row,requested='before')=>{const selected=phase||requested;if(name!==subject.section||subject[selected]===null||!same(row,subject[selected]))return unknown();return subject[selected+'Facts'];}};}
function projectSubject(env,subject,phase){if(subject[phase]===null)return null;const row=policy.projectRows(env.policy,subject.section,[subject[phase]],subjectContext(env,subject,phase))[0]||null;return row&&subject.section==='fuelPeriods'?load('electron/period-access.cjs').visibleRow(row,env.current):row;}
function subjectAllowed(env,subject,{changedFields=false}={}){if(!load('electron/document-access.cjs').auditAccess(env.current,subject)||!load('electron/period-access.cjs').auditAccess(env.current,subject))return false;for(const phase of ['before','after'])if(subject[phase]!==null){const row=projectSubject(env,subject,phase);if(!row)return false;if(changedFields)for(const field of subject.changedFields)if(own(subject[phase],field)&&(!own(row,field)||!(subject.section==='fuelPeriods'&&field==='closureEvents')&&!same(row[field],subject[phase][field])))return false;}return true;}
function legacyAllowed(env,proof){
 if(env.current.role!=='admin'||env.context.readFields&&Object.values(env.context.readFields).some(fields=>!fields.includes('*'))||env.context.writeFields&&Object.values(env.context.writeFields).some(fields=>!fields.includes('*')))return false;
 for(const rule of Object.values(env.policy?.sections||{}))if(rule.readFields&&!rule.readFields.includes('*')||rule.writeFields&&!rule.writeFields.includes('*'))return false;
 const actions=[...Object.values(env.context.actions||{}),...Object.values(env.policy?.sections||{}).map(rule=>rule.actions).filter(Boolean),...(env.policy?.grants||[]).map(grant=>grant.actions).filter(Boolean)];if(actions.some(value=>!value.includes('*')))return false;
 return schema.sections.every(name=>policy.permits(env.policy,name,'read',{id:'unverified-history'},{...env.context,resolve:unknown}))&&proof.requiredSections.every(name=>access.sectionAllowed(env.current,'read',name));
}
function isGloballyUnrestricted(principal){try{return legacyAllowed(environment(principal),{requiredSections:schema.sections});}catch{return false;}}
function permitted(env,proof,bindActor){
 if(proof.request.globalReadRequired===true&&!legacyAllowed(env,{requiredSections:schema.sections}))return false;
 if(bindActor&&(env.current.id!==proof.request.actor.id||env.current.role!==proof.request.actor.role))return false;
 if(!proof.requiredSections.length||proof.requiredSections.some(name=>!access.sectionAllowed(env.current,'read',name)))return false;
 if(proof.status!=='verified')return legacyAllowed(env,proof);
 return proof.subjects.every(row=>subjectAllowed(env,row,{changedFields:true}))&&proof.request.selectedTargets.every(row=>subjectAllowed(env,row));
}
function authorizeProof(proof,principal,receipt){try{const checked=validateProof(proof);if(receipt!==undefined&&!same(operation(receipt.operation||receipt),checked.request.operation))return false;return permitted(environment(principal),checked,true);}catch{return false;}}
function eventSubject(event,proof){const fields=changed(event.before||null,event.after||null);return proof.subjects.find(row=>row.section===event.section&&same(row.changedFields,fields)&&['before','after'].every(phase=>(event[phase]??null)===null?row[phase]===null:digest(event[phase])===row[phase+'Hash']&&same(fragment(event[phase],row.changedFields,event.section),row[phase])));}
function projectEvent(eventValue,proofValue,principal){try{
 const event=safe(eventValue),proof=validateProof(proofValue),env=environment(principal);if(!names.has(event.section)||!access.sectionAllowed(env.current,'read','auditLog')||!proof.request.eventHashes.includes(digest(event))||event.operationId!==undefined&&event.operationId!==proof.request.operation.id)return null;
 if(!load('electron/document-access.cjs').auditAccess(env.current,event)||!load('electron/period-access.cjs').auditAccess(env.current,event))return null;
 const {archiveScope,...publicEvent}=event;let projected={...publicEvent},facts=[];
 if(event.before||event.after){const subject=eventSubject(event,proof);if(!subject||proof.status!=='verified'&&!legacyAllowed(env,proof))return null;
  for(const phase of ['before','after'])if(event[phase]){const row=event[phase],phaseFacts=subject[phase+'Facts'],ctx={...env.context,resolve:(section,value)=>section===event.section&&digest(value)===subject[phase+'Hash']?phaseFacts:unknown()},value=policy.projectRows(env.policy,event.section,[row],ctx)[0];if(!value)return null;projected[phase]=value;facts.push(phaseFacts);}
  if(Array.isArray(event.fields))projected.fields=event.fields.filter(field=>own(projected.before||{},field)||own(projected.after||{},field));
 }else {if(!permitted(env,proof,false))return null;facts=[...proof.subjects,...proof.request.selectedTargets].flatMap(row=>[row.beforeFacts,row.afterFacts].filter(Boolean));}
 const eventFacts={kind:facts.every(row=>row.kind==='shared')&&proof.status==='verified'?'shared':facts.length?'owned':'unknown',owners:facts.flatMap(row=>row.owners),readRequirements:{sections:[event.section],owners:facts.flatMap(row=>row.readRequirements?.owners||[]),complete:proof.status==='verified'&&facts.every(complete)},fieldGuards:proof.request.eventGuards.find(value=>value.hash===digest(event)).fieldGuards};
 projected=load('electron/period-access.cjs').visibleAuditRow(projected,env.current);
 return policy.projectRows(env.policy,'auditLog',[projected],{...env.context,resolve:()=>eventFacts})[0]||null;
 }catch{return null;}}
function projectLegacyEvent(eventValue,principal){try{
 const event=safe(eventValue),env=environment(principal);if(!object(event)||!names.has(event.section))return null;
 const actionLists=[...Object.values(env.context.actions||{}),...Object.values(env.policy?.sections||{}).map(rule=>rule.actions).filter(Boolean),...(env.policy?.grants||[]).map(grant=>grant.actions).filter(Boolean)];if(actionLists.some(actions=>!actions.includes('*')))return null;
 const required=new Set(['auditLog',event.section]);for(const field of ['changedSections','archiveReadSections','importReadSections'])if(own(event,field)){if(!Array.isArray(event[field])||event[field].some(name=>!names.has(name)))return null;event[field].forEach(name=>required.add(name));}
 if(!legacyAllowed(env,{requiredSections:[...required]})||!load('electron/document-access.cjs').auditAccess(env.current,event)||!load('electron/period-access.cjs').auditAccess(env.current,event))return null;
 const {archiveScope,...projected}=event;return frozen(load('electron/period-access.cjs').visibleAuditRow(projected,env.current));
 }catch{return null;}}
module.exports=Object.freeze({apiVersion:1,createProof,createLegacyProof,authorizeProof,projectEvent,projectLegacyEvent,validateProof,isGloballyUnrestricted});
