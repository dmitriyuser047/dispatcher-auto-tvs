'use strict';
// Trusted role ceilings and factual ownership are assembled here. The pure
// policy never reads settings or receives a caller-provided resolver.
const registry=()=>require('../assets/core/platform-schema.js');
const policy=()=>require('../assets/core/access-policy.js');
const scopes=()=>require('../assets/core/access-scope.js');
const roles=()=>require('./access-control');
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function fail(message){throw Object.assign(new Error(message),{code:'ACCESS_CONTEXT_INVALID',status:403});}
function data(value){const contracts=require('../assets/core/platform-contracts.js');return contracts.validateSections({appMeta:[value]},['appMeta']).appMeta[0];}
function normalizePrincipal(value){
 if(value===undefined||value===null)value={id:'local-profile',name:'Локальный пользователь',role:'admin'};
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Не подтверждена учётная запись');
 const selected={};for(const key of Reflect.ownKeys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||descriptor?.get||descriptor?.set)fail('Исполняемые поля учётной записи запрещены');if(descriptor?.enumerable&&descriptor.value!==undefined)selected[key]=descriptor.value;}
 const input=data(selected);if(typeof input.id!=='string'||!input.id||typeof input.role!=='string'||!own(roles().ROLES,input.role))fail('Не подтверждена роль учётной записи');
 const result={...input,name:typeof input.name==='string'&&input.name?input.name:input.id};delete result.policyStamp;
 for(const field of ['readable','writable']){if(result[field]===null)delete result[field];if(own(result,field)&&(!Array.isArray(result[field])||result[field].some(name=>typeof name!=='string'||name!=='*'&&!registry().sections.includes(name))))fail('Некорректное ограничение разделов учётной записи');}
 if(own(result,'accessPolicy'))result.accessPolicy=policy().normalize(result.accessPolicy);
 result.policyStamp=policy().policyStamp(result.accessPolicy,ceiling(result));return Object.freeze(result);
}
function hasPolicy(value){if(!value||typeof value!=='object')return false;const descriptor=Object.getOwnPropertyDescriptor(value,'accessPolicy');if(descriptor?.get||descriptor?.set)fail('Исполняемые правила доступа запрещены');return descriptor?.value!==undefined&&descriptor?.value!==null;}
function hasNarrowing(value){if(hasPolicy(value))return true;if(!value||typeof value!=='object')return false;return ['actions','readFields','writeFields'].some(field=>{const descriptor=Object.getOwnPropertyDescriptor(value,field);if(descriptor?.get||descriptor?.set)fail('Исполняемые ограничения роли запрещены');return descriptor?.value!==undefined&&descriptor?.value!==null;});}
function ceiling(principal,options={}){
 const authorize=roles().authorizeRole||roles().authorize,all=registry().sections,narrow=(action,name)=>{const list=principal[action==='read'?'readable':'writable'];return authorize(principal,action,name)&&(!Array.isArray(list)||list.includes('*')||list.includes(name));};
 const result={readable:all.filter(name=>narrow('read',name)),writable:all.filter(name=>narrow('write',name))};
 if(Array.isArray(options.writableOverrides))for(const name of options.writableOverrides)if(all.includes(name)&&(!Array.isArray(principal.writable)||principal.writable.includes('*')||principal.writable.includes(name))&&!result.writable.includes(name))result.writable.push(name);
 const fields=roles().fieldPermissions(principal);if(Object.keys(fields).length)result.writeFields=fields;
 for(const field of ['actions','readFields'])if(principal[field]!==undefined)result[field]=data({value:principal[field]}).value;
 if(principal.writeFields!==undefined){const narrowed=data({value:principal.writeFields}).value;if(!narrowed||typeof narrowed!=='object'||Array.isArray(narrowed))fail('Некорректная область полей записи');const combined={...(result.writeFields||{})};for(const[name,allowed]of Object.entries(narrowed)){if(!Array.isArray(allowed)||allowed.some(field=>typeof field!=='string'))fail('Некорректная область полей записи');const roleFields=combined[name];combined[name]=roleFields?allowed.includes('*')?roleFields:roleFields.filter(field=>allowed.includes(field)):allowed;}result.writeFields=combined;}
 if(options.writeFields)result.writeFields={...(result.writeFields||{}),...data({value:options.writeFields}).value};
 return result;
}
function policyStamp(value){const principal=normalizePrincipal(value);return principal.policyStamp;}
function sectionAllowed(value,action,name){
 if(typeof name!=='string'||!registry().sections.includes(name))return false;
 const principal=normalizePrincipal(value),read=['read','print','export','print:capture','print:export'].includes(action),base=ceiling(principal);if(!(read?base.readable:base.writable).includes(name))return false;
 const selected=principal.accessPolicy;if(!selected)return true;if(!selected.grants.length)return false;
 const accepts=(list,candidate)=>!list||list.includes('*')||list.includes(candidate),rule=selected.sections?.[name],contextActions=base.actions?.[name],candidates=action==='write'||action==='append'?['create','update','delete','write']:[action];
 return candidates.some(candidate=>accepts(rule?.actions,candidate)&&accepts(contextActions,candidate)&&selected.grants.some(grant=>accepts(grant.actions,candidate)));
}
function create(previous,next,value,options={}){
 const principal=normalizePrincipal(value),selected=principal.accessPolicy??null,base=ceiling(principal,options),before=scopes().createResolver(previous),after=scopes().createResolver(next||previous),context={...base,resolve:(name,row,phase='before')=>(phase==='after'?after:before).resolve(name,row)};
 const api=policy(),actor=Object.freeze({id:principal.id,name:principal.name,role:principal.role});
 return Object.freeze({policy:selected,context,actor,principal,
  permits:(name,action,row,phase='before')=>api.permits(selected,name,action,row,context,phase),
  canRead:(name,row,phase='before')=>api.permits(selected,name,'read',row,context,phase),
  projectRows:(name,rows,phase='before')=>api.projectRows(selected,name,rows,phase==='before'?context:{...context,resolve:(section,row)=>after.resolve(section,row)}),
  mergeVisibleChanges:(name,rows)=>api.mergeVisibleChanges(selected,name,previous[name]||[],rows,context),
  validateChanges:(name,rows)=>api.validateChanges(selected,name,previous[name]||[],rows,context),
  resolveArchive:(snapshot,phase='before')=>(phase==='after'?after:before).resolveArchive(snapshot),
  resolveSource:(source,phase='before')=>(phase==='after'?after:before).resolveSource(source),
  readDependencies:(phase='before')=>(phase==='after'?after:before).readDependencies()
 });
}
module.exports=Object.freeze({apiVersion:1,normalizePrincipal,principal:normalizePrincipal,create,hasPolicy,hasNarrowing,policyStamp,sectionAllowed,actionAvailable:sectionAllowed});
