'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),journal=require(path.join(root,'electron/migration-journal.cjs'));
const digest=value=>'sha256:'+crypto.createHash('sha256').update(value).digest('hex');
function run(config,checkpoint=()=>{},options){
 const input={sourceDir:config.sourceDir,targetDir:config.targetDir,sourceFingerprint:config.sourceFingerprint,targetFormat:'json',descriptor:config.descriptor,sourceIdentity:config.sourceIdentity,
 verifySource(){if(digest(fs.readFileSync(path.join(config.sourceDir,'data.json')))!==config.sourceFingerprint)throw Object.assign(Error('Source changed'),{code:'SOURCE_CHANGED'});},
 create(stage,metadata){fs.copyFileSync(path.join(config.sourceDir,'data.json'),path.join(stage,'data.json'),fs.constants.COPYFILE_EXCL);fs.writeFileSync(path.join(stage,'database-identity.json'),JSON.stringify(metadata.identity),{flag:'wx'});fs.writeFileSync(path.join(stage,'compatibility.json'),JSON.stringify(metadata.descriptor),{flag:'wx'});},
 verify(stage,metadata){if(digest(fs.readFileSync(path.join(stage,'data.json')))!==config.sourceFingerprint||JSON.stringify(JSON.parse(fs.readFileSync(path.join(stage,'database-identity.json'))))!==JSON.stringify(metadata.identity))throw Error('Parity failed');},
 verifyPublishedIdentity(stage,metadata){if(JSON.stringify(JSON.parse(fs.readFileSync(path.join(stage,'database-identity.json'))))!==JSON.stringify(metadata.identity))throw Object.assign(Error('Target identity changed'),{code:'MIGRATION_TARGET_IDENTITY'});},
 report(stage,metadata){return {ok:true,migrationId:metadata.migrationId,targetIdentity:metadata.identity,sourceIdentity:metadata.sourceIdentity,lifecycleDecision:metadata.lifecycleDecision??null,sourceFingerprint:config.sourceFingerprint};}};
 const authority=options??{lifecyclePlan:config.plan,assertLifecycleCurrent(plan){if(fs.readFileSync(config.authorization,'utf8')!=='allow')throw Object.assign(Error('Authority revoked'),{code:'LIFECYCLE_STALE'});if(plan.predecessor&&digest(fs.readFileSync(path.join(plan.predecessor.physicalKey,'head.json')))!==plan.predecessor.metadataStamp)throw Object.assign(Error('Reviewed head changed'),{code:'LIFECYCLE_STALE'});}};
 return journal.createMigrationJournal({checkpoint})(input,authority);
}
module.exports={run,digest};
