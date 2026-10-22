'use strict';
// Synthetic browser transport. Real built-in file decoder and shared planner;
// no settings, working profile, filesystem database or renderer apply loop.
const crypto=require('node:crypto'),schema=require('../../assets/core/platform-schema.js'),engine=require('../../assets/core/import-engine.js'),commands=require('../../assets/core/platform-commands.js'),decoder=require('../../electron/import-decoder.cjs');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex'),now='2026-10-22T12:00:00.000Z',actor={id:'synthetic-import-review',name:'Synthetic reviewer',role:'admin'},token='reviewed-import-regression';
async function install(page){
 const sources=new Map(),receipts=new Map();
 await page.exposeFunction('__reviewedSourceNode',async({request,db})=>{try{
  if(request.action==='stage'){
   const files=(request.source.files||[request.source]).map(file=>({name:file.name,base64:file.base64||Buffer.from(file.bytes).toString('base64')})),decoded=await decoder.decode({files,profile:request.profile,sections:request.sections,mapping:request.mapping||{}}),bytes=Buffer.concat(files.map(file=>Buffer.from(file.base64,'base64'))),sourceId=sha(JSON.stringify([sha(bytes),request.profile,request.sections,request.mapping||{}])),source=engine.normalize(request.profile,{version:1,sourceId,profile:request.profile,sections:request.sections,sourceArchive:{id:sourceId,sha256:sha(bytes),size:bytes.length,name:files.map(file=>file.name).join(', ')},parser:request.parser,mapping:request.mapping||{},decodedFingerprint:'sha256:'+sha(JSON.stringify(decoded.rows)),sourceScopes:decoded.scopes,rows:decoded.rows});sources.set(sourceId,source);return{ok:true,sourceId,source,databaseToken:token};
  }
  const source=sources.get(request.sourceId);if(!source)throw Error('Synthetic source is missing');
  if(request.action==='read')return{ok:true,sourceId:source.sourceId,source,databaseToken:token};
  const preview=engine.preview(db,{sourceId:request.sourceId,profile:request.profile,sections:request.sections,decisions:request.decisions||[],reason:request.reason},{id:'preview',now,today:now.slice(0,10),actor,importSource:source});return{ok:true,preview,reviewFingerprint:preview.fingerprint,databaseToken:token};
 }catch(error){return{ok:false,code:error.code,error:error.message,issues:error.issues};}});
 await page.exposeFunction('__reviewedCommandNode',({request,db})=>{try{if(receipts.has(request.operation.id))return{...receipts.get(request.operation.id),replayed:true};const source=sources.get(request.command.input.sourceId),plan=commands.plan(db,request.command,{id:request.operation.id,now,today:now.slice(0,10),actor,importSource:source}),next={...db,...plan.sections},canonicalSections=Object.fromEntries([...new Set([...commands.footprint(request.command),'auditLog'])].map(name=>[name,next[name]||[]])),result={ok:true,canonicalSections};receipts.set(request.operation.id,result);return result;}catch(error){return{ok:false,code:error.code,error:error.message,issues:error.issues};}});
 await page.evaluate(({names,token})=>{
  for(const name of names)if(!Array.isArray(data[name]))data[name]=[];
  __disk=JSON.stringify(data);_lastPersisted=__disk;_sync.enabled=true;_sync.databaseToken=token;_sync.platform={..._sync.platform,apiVersion:1,operations:1,commands:1,outbox:1,controlledImports:1};_sync.revs=Object.fromEntries(names.map(name=>[name,1]));_sync.synced=Object.fromEntries(names.map(name=>[name,JSON.stringify(data[name])]));window.__controlledRequests=[];
  electronAPI.importSource=async request=>{const result=await __reviewedSourceNode({request,db:JSON.parse(__disk)});window.__controlledLast=result;return result;};
  electronAPI.executeCommand=async raw=>{__controlledRequests.push(raw);if(window.__rejectImport)return{ok:false,code:'SYNTHETIC_REJECTED',error:'Not persisted'};const request=JSON.parse(raw),result=await __reviewedCommandNode({request,db:JSON.parse(__disk)});if(!result.ok)return result;const disk=JSON.parse(__disk);for(const[name,rows]of Object.entries(result.canonicalSections)){disk[name]=rows;}__disk=JSON.stringify(disk);const revisions={..._sync.revs};for(const name of Object.keys(result.canonicalSections))if(!result.replayed)revisions[name]++;return{...result,databaseToken:token,revisions,operationReceipt:{id:request.operation.id,digest:request.operation.digest,status:result.replayed?'replayed':'committed'}};};
 },{names:schema.sections,token});
}
module.exports={install};
