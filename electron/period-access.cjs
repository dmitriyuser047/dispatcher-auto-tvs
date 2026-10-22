'use strict';

// Period rows are shared, while event reasons/authors may belong to a financial
// scope unavailable to the reader. Flags remain public; private events never
// become a prerequisite for an operational reconciliation save.
const access=require('./access-control');
const kernel=()=>require('../assets/core/platform-kernel.js');
const SCOPES=Object.freeze(['fuel','stock','finance']);
const FLAGS=Object.freeze({fuel:'closed',stock:'stockClosed',finance:'financeClosed'});
const ROLES=Object.freeze({fuel:Object.freeze(['admin','dispatcher','accountant']),stock:Object.freeze(['admin','mechanic']),finance:Object.freeze(['admin','accountant'])});
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>kernel().stableSerialize(value);
function permitted(principal,action,section){
 const names=principal?.[action==='read'?'readable':'writable'];
 return access.authorize(principal,action,section)&&(!names||names.includes('*')||names.includes(section));
}
function canRead(principal,scope){
 return SCOPES.includes(scope)&&permitted(principal,'read','fuelPeriods')&&(scope!=='finance'||['payments','costEntries'].every(name=>permitted(principal,'read',name)));
}
function canManage(principal,scope){
 const narrowed=principal?.writable;
 if(!SCOPES.includes(scope)||!ROLES[scope].includes(principal?.role)||!canRead(principal,scope)||narrowed&&!narrowed.includes('*')&&!narrowed.includes('fuelPeriods'))return false;
 const reads=require('../assets/core/period-policy.js').describe(scope).readSections;
 return ['period:close','period:reopen'].some(action=>access.actionAvailable(principal,action,'fuelPeriods'))&&Array.isArray(reads)&&reads.every(name=>permitted(principal,'read',name));
}
function actions(principal){return SCOPES.filter(scope=>canManage(principal,scope));}
function events(row){return Array.isArray(row?.closureEvents?.events)?row.closureEvents.events:[];}
function visibleRow(row,principal){
 if(!plain(row)||!own(row,'closureEvents'))return row;
 const history=row.closureEvents;
 // Unknown legacy containers cannot expose arbitrary nested accounting data.
 return {...row,closureEvents:{version:history?.version??1,events:events(row).filter(event=>canRead(principal,event?.scope))}};
}
function visibleRows(rows,principal){return (rows||[]).map(row=>visibleRow(row,principal));}
function fail(message){throw Object.assign(new Error(message),{code:'PERIOD_SCOPE_ACCESS',status:403});}
function mergeRow(previous,row,principal){
 const hidden=events(previous).filter(event=>!canRead(principal,event?.scope));
 const supplied=events(row),privateSupplied=supplied.filter(event=>!canRead(principal,event?.scope));
 if(privateSupplied.length){
  if(stable(privateSupplied)!==stable(hidden)||privateSupplied.some(event=>supplied.indexOf(event)!==events(previous).findIndex(old=>stable(old)===stable(event))))fail('Историю недоступной области периода нельзя изменять.');
  return row;
 }
 if(!hidden.length)return row;
 if(own(row,'closureEvents')&&(!plain(row.closureEvents)||row.closureEvents.version!==1||!Array.isArray(row.closureEvents.events)))fail('Недопустимая история периода.');
 const visible=supplied.slice(),merged=[];let index=0;
 for(const event of events(previous)){
  if(!canRead(principal,event?.scope))merged.push(event);
  else if(index<visible.length)merged.push(visible[index++]);
 }
 merged.push(...visible.slice(index));
 return {...row,closureEvents:{...(row.closureEvents||previous.closureEvents),events:merged}};
}
function mergePeriods(previous,sections,principal){
 if(!own(sections,'fuelPeriods'))return sections;
 const before=previous.fuelPeriods||[],rows=sections.fuelPeriods.map(row=>{
  const matches=before.filter(old=>old.month===row.month);
  const exact=matches.find(old=>stable(visibleRow(old,principal))===stable(row));
  if(exact)return exact;
  if(matches.length>1)fail('Неоднозначная строка периода. Сначала проверьте её исходные данные.');
  return mergeRow(matches[0],row,principal);
 });
 return {...sections,fuelPeriods:rows};
}
function changedScopes(previous,next){
 const result=new Set(),old=previous||[],after=next||[],months=new Set([...old,...after].map(row=>row.month));
 for(const month of months){
  const left=old.filter(row=>row.month===month),right=after.filter(row=>row.month===month);
  if(stable(left)===stable(right))continue;
  let scoped=false;
  for(const scope of SCOPES){
   const project=rows=>rows.flatMap(row=>{const history=events(row).filter(event=>event?.scope===scope);return row[FLAGS[scope]]||history.length?[{closed:!!row[FLAGS[scope]],events:history}]:[];});
   if(stable(project(left))!==stable(project(right))){result.add(scope);scoped=true;}
  }
  if(!scoped)result.add('fuel');
 }
 return [...result].sort();
}
function auditAccess(principal,row){
 if(row?.section==='fuelPeriods')return changedScopes(row.before?[row.before]:[],row.after?[row.after]:[]).every(scope=>canRead(principal,scope));
 if(row?.type==='transaction'&&row.changedSections?.includes('fuelPeriods')){
  if(Array.isArray(row.changedPeriodScopes))return row.changedPeriodScopes.length>0&&row.changedPeriodScopes.every(scope=>canRead(principal,scope));
  // Historic receipts have no private scope proof. Their accounting payload is
  // absent, but the author may belong to an unavailable financial operation.
  return canRead(principal,'finance');
 }
 return true;
}
function visibleAuditRow(row,principal){
 if(row?.section!=='fuelPeriods')return row;
 return {...row,...(row.before?{before:visibleRow(row.before,principal)}:{}),...(row.after?{after:visibleRow(row.after,principal)}:{})};
}
module.exports=Object.freeze({SCOPES,FLAGS,canRead,canManage,actions,visibleRows,visibleRow,mergePeriods,changedScopes,auditAccess,visibleAuditRow});
