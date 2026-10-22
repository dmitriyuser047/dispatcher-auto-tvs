'use strict';
// A mixed draft section never grants access to its financial payloads merely
// because another document adapter is available to the same role.
const access=require('./access-control');
const sections=Object.freeze(['shiftReports','workOrders','dispatchJobs','fuelMovements','partMovements','fuelWriteoffs','payments','repairs','vehicleTo','toRecords','tankIncomes']);
const kernel=()=>require('../assets/core/platform-kernel.js');
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function permitted(principal,action,section){
 const names=principal?.[action==='read'?'readable':'writable'];
 return access.authorize(principal,action,section)&&(!names||names.includes('*')||names.includes(section));
}
function draftAccess(principal,action,row){return !!row&&sections.includes(row.section)&&permitted(principal,action,row.section)&&permitted(principal,action,'documentDrafts');}
function auditAccess(principal,row){
 if(row.section==='documentDrafts'){
  const origins=[row.before,row.after].filter(Boolean).map(value=>value.section);
  if(!origins.length||origins.some(section=>!sections.includes(section)||!permitted(principal,'read',section)))return false;
 }
 if(row.type==='transaction'&&row.changedSections?.includes('documentDrafts')){
  if(!Array.isArray(row.changedDocumentSections)||!row.changedDocumentSections.length||row.changedDocumentSections.some(section=>!sections.includes(section)||!permitted(principal,'read',section)))return false;
 }
 return true;
}
function visibleRows(name,rows,principal){return name==='documentDrafts'?(rows||[]).filter(row=>draftAccess(principal,'read',row)):rows||[];}
function fail(message){const error=new Error(message);error.code='DOCUMENT_DRAFT_ACCESS';error.status=403;throw error;}
function mergeDrafts(previous,sections,principal){
 if(!own(sections,'documentDrafts'))return sections;
 const before=previous.documentDrafts||[],after=sections.documentDrafts.slice(),key=value=>typeof value+':'+JSON.stringify(value),old=new Map();
 for(const row of before){const id=key(row.id);if(!old.has(id))old.set(id,[]);old.get(id).push(row);}
 const ids=new Set();
 for(const row of after){const id=key(row.id);ids.add(id);const candidates=old.get(id)||[],same=candidates.find(value=>kernel().stableSerialize(value)===kernel().stableSerialize(row));
  if(same)continue;
  if(!draftAccess(principal,'write',row)||candidates.some(value=>!draftAccess(principal,'write',value)||value.section!==row.section))fail('Недостаточно прав для изменения исходного вида документа');
 }
 let hidden=false;
 for(const row of before)if(!ids.has(key(row.id))){if(!draftAccess(principal,'read',row)){hidden=true;continue;}if(!draftAccess(principal,'write',row))fail('Нет права удалить этот черновик');}
 // Hidden records keep their exact positions among existing records. Appending
 // them would itself be an unrequested mutation of the immutable draft state.
 const merged=hidden?[...before.filter(row=>ids.has(key(row.id))||!draftAccess(principal,'read',row)).map(row=>after.find(value=>key(value.id)===key(row.id))||row),...after.filter(row=>!old.has(key(row.id)))]:after;
 return {...sections,documentDrafts:merged};
}
function changedOrigins(previous,after){
 const rows=[...(previous||[]),...(after||[])],origins=new Set(),old=new Map((previous||[]).map(row=>[typeof row.id+':'+JSON.stringify(row.id),kernel().stableSerialize(row)])),next=new Map((after||[]).map(row=>[typeof row.id+':'+JSON.stringify(row.id),kernel().stableSerialize(row)]));
 for(const row of rows){const key=typeof row.id+':'+JSON.stringify(row.id);if(old.get(key)!==next.get(key)&&sections.includes(row.section))origins.add(row.section);}
 return [...origins].sort();
}
module.exports=Object.freeze({sections,permitted,draftAccess,auditAccess,visibleRows,mergeDrafts,changedOrigins});
