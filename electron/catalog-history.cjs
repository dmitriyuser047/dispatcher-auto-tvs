'use strict';
// Private full-history input for an explicit global catalog review. It never
// replaces the public hot array or changes the canonical append source.
const schema=require('../assets/core/platform-schema.js');
function denied(){throw Object.assign(Error('Полная проверка истории объединения доступна администратору без ограничений чтения'),{code:'ACCESS_DENIED',status:403});}
function assertReader(principal){
 if(require('./operation-evidence.cjs').isGloballyUnrestricted(principal)!==true)denied();
}
function reviewDatabase(dataDir,database,principal){
 assertReader(principal);if(require('./storage-format.cjs').isCurrent(require('./storage').schemaVersion(dataDir))){
  const store=require('./operation-store.cjs'),platform=require('./platform-service.cjs'),rows=store.readLogicalHistory(dataDir);platform.bindHistory({auditLog:rows},dataDir);
  const projected=platform.visibleAudit(rows,principal,{...database,auditLog:rows});if(projected.length!==rows.length)throw Object.assign(Error('Часть исходной истории недоступна; полная проверка объединения остановлена'),{code:'HISTORY_REVIEW_INCOMPLETE',status:403});if(Buffer.byteLength(JSON.stringify(projected))>64*1024*1024)throw Object.assign(Error('Полная история превышает предел одной проверки объединения'),{code:'HISTORY_REVIEW_LIMIT',status:409});
  return {...database,auditLog:projected};
 }
 return database;
}
module.exports=Object.freeze({assertReader,reviewDatabase});
