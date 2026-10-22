'use strict';
// Literal receipt metadata only. No inferred actor, time, ownership or origin.
const contracts=require('../assets/core/platform-contracts.js'),schema=require('../assets/core/platform-schema.js'),roles=require('./access-control').ROLES;
const resultFields=['id','actor','changedDocumentSections','changedPeriodScopes','archiveReadSections','importReadSections','archiveSeals','printCapture','printArtifact'];
function fail(){throw Object.assign(Error('Некорректные исходные метаданные подтверждения операции'),{code:'OPERATION_RECEIPT_INVALID',status:409});}
function fromAuditRow(input){
  const row=contracts.validateSections({auditLog:[input]},schema.sections).auditLog[0];
  const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
  if(row.source!=='platform'||row.type!=='transaction'||!text(row.operationId,200)||!/^sha256:[a-f0-9]{64}$/.test(row.requestDigest)||!text(row.databaseToken,500)||!text(row.actorId,500)||!Object.hasOwn(roles,row.actorRole)||!text(row.at,100)||!Number.isFinite(Date.parse(row.at))||!Array.isArray(row.changedSections)||new Set(row.changedSections).size!==row.changedSections.length||row.changedSections.some(name=>!schema.sections.includes(name)||name==='auditLog')||!row.revisions||typeof row.revisions!=='object'||Array.isArray(row.revisions)||Object.entries(row.revisions).some(([name,value])=>!schema.sections.includes(name)||!Number.isSafeInteger(value)||value<0))fail();
  return {operation:{id:row.operationId,digest:row.requestDigest,actorId:row.actorId,actorRole:row.actorRole,databaseToken:row.databaseToken},at:row.at,changedSections:row.changedSections.slice(),revisions:{...row.revisions},result:Object.fromEntries(resultFields.filter(name=>Object.hasOwn(row,name)).map(name=>[name,row[name]]))};
}
module.exports=Object.freeze({fromAuditRow});
