'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCommandOutbox}=require('../electron/command-outbox.cjs');
const {createOperationRecovery}=require('../electron/operation-recovery.cjs');
const commands=require('../assets/core/platform-commands.js'),kernel=require('../assets/core/platform-kernel.js');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-semantic-recovery-'));
  t.after(()=>{const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('tvs-semantic-recovery-'));fs.rmSync(target,{recursive:true,force:true});});
  const config={rootDir:path.join(root,'outbox')},box=createCommandOutbox(config),ctx={scope:'a'.repeat(64),databaseToken:'synthetic-command-db',supportsOperations:true,supportsCommands:true};
  return {config,box,ctx};
}
function envelope(id='synthetic-issue'){
  const command={type:'IssueFuel',version:1,input:{tankId:7,target:{section:'vehicles',id:'synthetic-v'},date:'2026-09-01',qty:80.537,reason:'Synthetic issue'}};
  const payload={protocolVersion:1,databaseToken:'synthetic-command-db',base:Object.fromEntries(commands.dependencies(command).map(name=>[name,3])),operation:{id},command};
  payload.operation.digest=kernel.requestDigest(payload);return payload;
}
function proof(payload){return {id:payload.operation.id,digest:kernel.requestDigest(payload),status:'committed'};}
test('commands refuse unsupported capability before staging or transport, including retry of a saved intent',async t=>{
  const f=fixture(t),payload=envelope();let sends=0;
  const service=createOperationRecovery({outbox:f.box,send:async()=>{sends++;},lookup:async()=>({ok:true,databaseToken:f.ctx.databaseToken,operationReceipt:null})});
  for(const patch of [{supportsCommands:false},{supportsOperations:false}]){
    const result=await service.execute({...f.ctx,...patch},payload);assert.equal(result.code,'UNSUPPORTED_COMMANDS');assert.equal(sends,0);assert.deepEqual(f.box.list(f.ctx.scope),[]);
  }
  f.box.stage(f.ctx.scope,payload,{supportsOperations:true});
  assert.equal((await service.retry({...f.ctx,supportsCommands:false},payload.operation.id)).code,'UNSUPPORTED_COMMANDS');assert.equal(sends,0);
});
test('lost command ACK restarts and retries the exact intent without adopting caller changes or regenerating timestamps',async t=>{
  const f=fixture(t),payload=envelope(),exact=JSON.stringify(payload),sent=[];let receipt=null;
  const first=createOperationRecovery({outbox:f.box,send:async(ctx,json)=>{sent.push(json);throw Object.assign(Error('Synthetic loss before delivery'),{code:'ETIMEDOUT'});},lookup:async()=>({ok:true,databaseToken:f.ctx.databaseToken,operationReceipt:receipt})});
  assert.equal((await first.execute(f.ctx,payload)).queued,true);payload.command.input.qty=1;payload.base.tanks=999;
  const freshBox=createCommandOutbox(f.config),fresh=createOperationRecovery({outbox:freshBox,send:async(ctx,json)=>{sent.push(json);const stored=JSON.parse(json);receipt=proof(stored);return {ok:true,databaseToken:ctx.databaseToken,operationReceipt:receipt};},lookup:async()=>({ok:true,databaseToken:f.ctx.databaseToken,operationReceipt:receipt})});
  assert.equal((await fresh.retry(f.ctx,'synthetic-issue')).ok,true);assert.deepEqual(sent,[exact,exact]);
  assert.equal(freshBox.list(f.ctx.scope)[0].status,'committed');assert.equal(freshBox.getForRetry(f.ctx.scope,'synthetic-issue').payload,null);
  assert.equal((await fresh.retry(f.ctx,'synthetic-issue')).committed,true);assert.equal(sent.length,2);
});
test('an unknown fuel command blocks an overlapping raw journal and command while allowing unrelated work',async t=>{
  const f=fixture(t),payload=envelope(),sent=[];
  const service=createOperationRecovery({outbox:f.box,send:async(ctx,json)=>{const body=JSON.parse(json);sent.push(body);if(body.command)throw Object.assign(Error('Synthetic lost reply'),{code:'ETIMEDOUT'});return {ok:true,databaseToken:ctx.databaseToken,operationReceipt:proof(body)};},lookup:async()=>({ok:true,databaseToken:f.ctx.databaseToken,operationReceipt:null})});
  await service.execute(f.ctx,payload);
  const raw={databaseToken:f.ctx.databaseToken,base:{records:3},sections:{records:[]},operation:{id:'raw-overlap'}};
  assert.equal((await service.execute(f.ctx,raw)).code,'PENDING_OPERATION');
  assert.equal((await service.execute(f.ctx,envelope('second-issue'))).code,'PENDING_OPERATION');
  const unrelated={databaseToken:f.ctx.databaseToken,base:{parts:3},sections:{parts:[]},operation:{id:'unrelated-parts'}};
  assert.equal((await service.execute(f.ctx,unrelated)).ok,true);assert.equal(sent.length,2);
});
test('a pending raw read dependency blocks a new semantic command before it can be sent',async t=>{
  const f=fixture(t),raw={databaseToken:f.ctx.databaseToken,base:{tanks:3},sections:{tanks:[]},operation:{id:'pending-tank'}};f.box.stage(f.ctx.scope,raw,{supportsOperations:true});
  let sends=0;const service=createOperationRecovery({outbox:f.box,send:async()=>{sends++;},lookup:async()=>null});
  assert.equal((await service.execute(f.ctx,envelope())).code,'PENDING_OPERATION');assert.equal(sends,0);
});
