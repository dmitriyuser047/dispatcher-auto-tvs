'use strict';
// Explicit manual export may be large. Keep packaging and proof traversal off
// Electron's main thread; the caller still awaits the completed verified copy.
const {workerData,parentPort}=require('node:worker_threads'),path=require('node:path'),safe=require('./safe-file.cjs'),storage=require('./storage.js'),backup=require('./backup-service.cjs'),format=require('./storage-format.cjs');
try{
 const {sourceDir,archivePath,settings,knowledgeDir,sourcePin,parentPin}=workerData;
 safe.assertDirectory(sourcePin);safe.assertDirectory(parentPin);
 if(knowledgeDir&&path.relative(path.join(sourceDir,'reestr-knowledge'),path.resolve(knowledgeDir))!=='')throw Error('База знаний должна принадлежать выбранной базе');
 const result=storage.schemaVersion(sourceDir)===format.SCHEMA_VERSION?backup.createMultipartPackage({sourceDir,archivePath,settings}):backup.createPackage({sourceDir,archivePath,settings,knowledgeDir});
 safe.assertDirectory(sourcePin);safe.assertDirectory(parentPin);parentPort.postMessage({ok:true,result});
}catch(error){parentPort.postMessage({ok:false,error:String(error.message||'Не удалось создать резервную копию'),...(typeof error.code==='string'?{code:error.code}:{})});}
