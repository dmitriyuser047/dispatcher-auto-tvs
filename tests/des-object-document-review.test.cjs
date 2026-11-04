'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const schema=require('../assets/core/platform-schema.js'),engine=require('../assets/core/document-engine.js'),access=require('../electron/access-context.cjs');
const now='2026-11-04T12:00:00.000Z',today=now.slice(0,10),scope={org:'SYNTHETIC OBJECT ORG',site:'SYNTHETIC OBJECT SITE'},actor={id:'synthetic-object-review',name:'Synthetic object operator',role:'admin'},principal={...actor,readable:schema.sections,writable:schema.sections,accessPolicy:{version:1,grants:[scope]}};
const clone=value=>structuredClone(value),input={action:'postDraft',section:'tankIncomes',draftId:'synthetic-draft'},head=()=>({id:'document-archive-head',kind:'documentArchive',version:1,head:'a'.repeat(64)});
function fixture(){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),appMeta:[{id:'business-calendar',kind:'businessCalendar',calendar:{version:1,timeZone:'Europe/Moscow'},history:[{operationId:'synthetic-calendar',reason:'Synthetic explicit calendar',at:now,actor,previousTimeZone:'UTC',timeZone:'Europe/Moscow'}]}],tanks:[{id:'synthetic-tank',name:'Synthetic own tank',org:scope.org,site:scope.site,object:scope.site,orgHistory:[{from:today,to:'',...scope}],fuel:'diesel',balanceInit:100}],documentDrafts:[{id:input.draftId,section:input.section,status:'draft',payload:{tankId:'synthetic-tank',date:today,amount:10}}]};}
function visible(database){const context=access.create(database,database,principal);return Object.fromEntries(schema.sections.map(name=>[name,context.projectRows(name,database[name])]));}
function review(database){return engine.preview(database,input,{today,readable:schema.sections});}
function plan(database,fingerprint){return engine.plan(database,{...input,reviewFingerprint:fingerprint},{id:'synthetic-post',now,today,actor,readable:schema.sections});}

test('a valid internal archive head does not invalidate a receipt reviewed through an exact object scope',()=>{
 const database=fixture();database.appMeta.push(head());const renderer=visible(database),before=JSON.stringify(database),client=review(renderer),host=review(database);
 assert.equal(renderer.appMeta.some(row=>row.id==='document-archive-head'),false);assert.equal(client.canPost,true,JSON.stringify(client.issues));assert.equal(host.canPost,true,JSON.stringify(host.issues));assert.equal(client.fingerprint,host.fingerprint);
 assert.equal(plan(database,client.fingerprint).sections.tankIncomes[0].amount,10);assert.equal(JSON.stringify(database),before);
 const next=clone(database);next.appMeta.find(row=>row.id==='document-archive-head').head='b'.repeat(64);assert.equal(review(next).fingerprint,host.fingerprint);
});

test('only the exact valid internal archive-head shape is excluded from document review',()=>{
 const database=fixture(),fingerprint=review(database).fingerprint;
 for(const malformed of [{...head(),id:'different-head'},{...head(),kind:'businessSetting'},{...head(),version:2},{...head(),head:'invalid'},{...head(),head:'A'.repeat(64)},{...head(),businessValue:'must stay in review'}]){
  const changed=clone(database);changed.appMeta.push(malformed);assert.notEqual(review(changed).fingerprint,fingerprint,JSON.stringify(malformed));assert.throws(()=>plan(changed,fingerprint),{code:'STALE_REVIEW'});
 }
});

test('business calendar, other settings, tank stock and receipt quantity still invalidate review',()=>{
 const database=fixture();database.appMeta.push(head());const fingerprint=review(database).fingerprint;
 const changes=[next=>{next.appMeta[0].calendar.timeZone='UTC';next.appMeta[0].history[0].timeZone='UTC';},next=>{next.appMeta.push({id:'synthetic-business-setting',value:1});},next=>{next.tanks[0].balanceInit=101;},next=>{next.documentDrafts[0].payload.amount=11;}];
 for(const change of changes){const changed=clone(database);change(changed);assert.notEqual(review(changed).fingerprint,fingerprint);assert.throws(()=>plan(changed,fingerprint),{code:'STALE_REVIEW'});}
});

test('two ordinary receipts post in scoped temporary SQLite after the first creates an immutable print seal',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),storage=require('../electron/storage.js'),sqlite=require('../electron/sqlite-storage.cjs'),server=require('../electron/server.js'),compat=require('../assets/core/platform-compatibility.js');
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'des-object-document-review-')),pin=fs.lstatSync(root),dataDir=path.join(root,'synthetic-data');
 t.after(()=>{const current=fs.lstatSync(root);assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^des-object-document-review-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,pin.dev);assert.equal(current.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});
 const database=fixture();database.documentDrafts=[];assert.equal(sqlite.create(dataDir,{data:database}).ok,true);
 function execute(action,id){const raw=storage.readSnapshot(dataDir),scoped=storage.readSnapshot(dataDir,{principal}),command={type:'DocumentAction',version:1,input:{...action}};if(action.action==='postDraft'){const checked=engine.preview(scoped.data,action,{today,readable:schema.sections});assert.equal(checked.canPost,true,JSON.stringify(checked.issues));command.input.reviewFingerprint=checked.fingerprint;}
  const envelope={protocolVersion:1,databaseToken:raw.databaseToken,base:raw.revisions,command,operation:{id}},proof=server.localWriteOptions({hello:compat.describe().hello,databaseToken:raw.databaseToken,principal}),result=storage.executeCommand(dataDir,envelope,{...proof,principal,now});assert.equal(result.ok,true,JSON.stringify(result));return result;
 }
 for(let index=1;index<=2;index++){const draftId='synthetic-receipt-draft-'+index;execute({action:'saveDraft',section:'tankIncomes',payload:{tankId:'synthetic-tank',date:today,amount:10}},draftId);execute({action:'postDraft',section:'tankIncomes',draftId},'synthetic-receipt-post-'+index);const raw=storage.readSnapshot(dataDir),scoped=storage.readSnapshot(dataDir,{principal});assert.equal(raw.data.tankIncomes.length,index);assert.equal(scoped.data.tankIncomes.length,index);assert.equal(raw.data.appMeta.some(row=>row.id==='document-archive-head'),true);assert.equal(scoped.data.appMeta.some(row=>row.id==='document-archive-head'),false);}
 const after=storage.readSnapshot(dataDir);assert.equal(require('../assets/core/fuel-stock.js').balanceAt(after.data,{section:'tanks',id:'synthetic-tank'},today).balance,120);assert.deepEqual(after.data.tanks,database.tanks);assert.equal(after.data.documentDrafts.every(row=>row.status==='posted'),true);
});
