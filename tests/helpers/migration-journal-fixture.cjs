'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
function load(name){return require(path.join(root,'electron',name));}
const journal=load('migration-journal.cjs');
const digest=bytes=>'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex');
function run(configuration,checkpoint=()=>{}){const source=path.join(configuration.directory,'source'),target=path.join(configuration.directory,'target'),dataFile=path.join(source,'data.json'),identityFile=path.join(source,'database-identity.json');const input={sourceDir:source,targetDir:target,sourceFingerprint:configuration.sourceFingerprint,targetFormat:'json',descriptor:{schemaVersion:3,minReader:3,minWriter:3,features:['controlled-import-v1','document-lifecycle-v1','row-scope-v1','sealed-print-v1']},sourceIdentity:configuration.sourceIdentity,
 verifySource(){if(digest(fs.readFileSync(dataFile))!==configuration.sourceFingerprint)throw Object.assign(Error('source changed'),{code:'SOURCE_CHANGED'});},
 create(stage,metadata){fs.copyFileSync(dataFile,path.join(stage,'data.json'),fs.constants.COPYFILE_EXCL);fs.writeFileSync(path.join(stage,'database-identity.json'),JSON.stringify(metadata.identity),{flag:'wx'});fs.writeFileSync(path.join(stage,'compatibility.json'),JSON.stringify(metadata.descriptor),{flag:'wx'});},
 verify(stage,metadata){if(digest(fs.readFileSync(path.join(stage,'data.json')))!==configuration.sourceFingerprint||JSON.parse(fs.readFileSync(path.join(stage,'database-identity.json'))).uuid!==metadata.identity.uuid)throw Error('parity failed');},
 verifyPublishedIdentity(published,metadata){const identity=JSON.parse(fs.readFileSync(path.join(published,'database-identity.json'))),descriptor=JSON.parse(fs.readFileSync(path.join(published,'compatibility.json')));if(JSON.stringify(identity)!==JSON.stringify(metadata.identity)||JSON.stringify(descriptor)!==JSON.stringify(metadata.descriptor))throw Object.assign(Error('published identity changed'),{code:'MIGRATION_TARGET_IDENTITY'});},
 report(stage,metadata){return {ok:true,migrationId:metadata.migrationId,targetUuid:metadata.identity.uuid,targetGeneration:metadata.identity.generation,descriptor:metadata.descriptor,sourceIdentity:metadata.sourceIdentity,retainedStages:metadata.retainedStages,sourceFingerprint:configuration.sourceFingerprint,sourceIdentitySha256:digest(fs.readFileSync(identityFile)),rowCount:JSON.parse(fs.readFileSync(path.join(stage,'data.json'))).vehicles.length};}};
 return journal.createMigrationJournal({checkpoint})(input);}
module.exports={run,digest,load};
