'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {createCommandOutbox}=require('../electron/command-outbox.cjs');
const scope=crypto.createHash('sha256').update('synthetic database/account/access').digest('hex');
const foreignScope=crypto.createHash('sha256').update('different synthetic account').digest('hex');
const now=()=> '2026-10-21T12:00:00.000Z';
const support={supportsOperations:true};
function fixture(t,configuration={}){
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-command-outbox-')),rootDir=path.join(parent,'client','outbox');
  t.after(()=>{const resolved=path.resolve(parent);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('tvs-command-outbox-'));fs.rmSync(resolved,{recursive:true,force:true});});
  return {parent,rootDir,configuration:{rootDir,now,...configuration},box:createCommandOutbox({rootDir,now,...configuration})};
}
function payload(id='operation-1',patch={}){
  return {databaseToken:'synthetic-database-token',base:{records:12},sections:{records:[{id:'r',vehicleId:7,date:'2026-09-01',fuelActual:923.537,note:'Private synthetic financial details',...patch}]},operation:{id}};
}
const entryFiles=root=>fs.readdirSync(root).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
function commit(box,id){const entry=box.getForRetry(scope,id);return box.updateOutcome(scope,id,{status:'committed',receipt:{id,status:'committed',digest:entry.requestDigest}});}

test('durable stage keeps exact canonical body, base, operation ID and fractional typed values across restart',t=>{
  const f=fixture(t),original=payload(),before=JSON.stringify(original),meta=f.box.stage(scope,original,support),first=f.box.getForRetry(scope,original.operation.id);
  original.sections.records[0].fuelActual=0;assert.equal(meta.status,'pending');assert.equal(meta.attempts,1);
  assert.equal(first.payload.sections.records[0].fuelActual,923.537);assert.equal(typeof first.payload.sections.records[0].vehicleId,'number');
  assert.equal(first.payload.base.records,12);assert.equal(first.payload.operation.id,'operation-1');assert.equal(JSON.stringify(first.payload),JSON.stringify(JSON.parse(first.json)));
  const restarted=createCommandOutbox(f.configuration);assert.deepEqual(restarted.getForRetry(scope,'operation-1'),first);
  assert.notEqual(JSON.stringify(original),before);assert.equal(entryFiles(f.rootDir).length,1);
});

test('typed command survives restart with exact dependency versions, numeric IDs, fractional quantity and write footprint',t=>{
  const commands=require('../assets/core/platform-commands.js'),kernel=require('../assets/core/platform-kernel.js'),f=fixture(t);
  const command={type:'IssueFuel',version:1,input:{tankId:7,target:{section:'generators',id:'7'},date:'2026-09-01',qty:923.537,reason:'Synthetic command'}};
  const body={protocolVersion:1,databaseToken:'synthetic-database-token',base:Object.fromEntries(commands.dependencies(command).map(name=>[name,12])),command,operation:{id:'semantic-command'}};
  body.operation.digest=kernel.requestDigest(body);
  const exact=JSON.stringify(body),meta=f.box.stage(scope,exact,support);
  assert.deepEqual(meta.sections,['fuelMovements','genRecords']);
  const saved=createCommandOutbox(f.configuration).getForRetry(scope,body.operation.id);
  assert.equal(saved.json,exact);assert.deepEqual(saved.payload,body);assert.equal(saved.requestDigest,body.operation.digest);
  assert.equal(typeof saved.payload.command.input.tankId,'number');assert.equal(typeof saved.payload.command.input.target.id,'string');
  assert.equal(saved.payload.command.input.qty,923.537);
  assert.throws(()=>f.box.stage(scope,{...body,sections:{records:[]}},support),{code:'OUTBOX_PAYLOAD'});
  assert.throws(()=>f.box.stage(scope,{...body,protocolVersion:2},support),{code:'OUTBOX_PAYLOAD'});
});

test('unknown acknowledgement survives a separate process and replays the same immutable request',t=>{
  const f=fixture(t),body=payload('process-restart'),code="const {createCommandOutbox}=require(process.argv[1]);const b=createCommandOutbox({rootDir:process.argv[2]});b.stage(process.argv[3],JSON.parse(process.argv[4]),{supportsOperations:true});b.updateOutcome(process.argv[3],'process-restart',{status:'unknown',code:'TRANSPORT_TIMEOUT'});";
  const child=spawnSync(process.execPath,['-e',code,require.resolve('../electron/command-outbox.cjs'),f.rootDir,scope,JSON.stringify(body)],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(child.status,0,child.stderr);const fresh=createCommandOutbox(f.configuration),entry=fresh.getForRetry(scope,'process-restart');
  assert.deepEqual(entry.payload,body);assert.equal(entry.metadata.status,'unknown');assert.equal(entry.metadata.code,'TRANSPORT_TIMEOUT');
  const json=entry.json;fresh.stage(scope,entry.payload,support);assert.equal(fresh.getForRetry(scope,'process-restart').json,json);
});

test('equivalent object key ordering does not change a staged request or its hash',t=>{
  const {box}=fixture(t),body=payload();box.stage(scope,body,support);const first=box.getForRetry(scope,'operation-1');
  box.stage(scope,{operation:body.operation,sections:body.sections,base:body.base,databaseToken:body.databaseToken},support);
  const second=box.getForRetry(scope,'operation-1');assert.equal(second.json,first.json);assert.equal(second.bodyHash,first.bodyHash);assert.equal(second.metadata.attempts,2);
});

test('durable JSON preserves original nested and audit row property order through restart and equivalent restaging',t=>{
  const f=fixture(t),body=payload('audit-property-order');
  body.sections.auditLog=[{at:'2026-09-01T10:00:00.000Z',type:'update',section:'records',actorId:'synthetic',
    before:{vehicleId:7,id:'r',fuelActual:1,details:{z:'Last key first',a:923.537}},after:{note:'Review',id:'r'}}];
  body.base.auditLog=5;const expected=JSON.stringify(body);assert.notEqual(expected,require('../assets/core/platform-kernel.js').stableSerialize(body));
  f.box.stage(scope,body,support);assert.equal(f.box.getForRetry(scope,body.operation.id).json,expected);
  const fresh=createCommandOutbox(f.configuration);assert.equal(fresh.getForRetry(scope,body.operation.id).json,expected);
  const reordered=JSON.parse(require('../assets/core/platform-kernel.js').stableSerialize(body));fresh.stage(scope,reordered,support);
  assert.equal(fresh.getForRetry(scope,body.operation.id).json,expected);assert.equal(JSON.stringify(fresh.getForRetry(scope,body.operation.id).payload.sections.auditLog),JSON.stringify(body.sections.auditLog));
  fresh.updateOutcome(scope,body.operation.id,{status:'unknown',code:'TIMEOUT'});fresh.stage(scope,reordered,support);
  assert.equal(createCommandOutbox(f.configuration).getForRetry(scope,body.operation.id).json,expected);
});

for(const status of ['conflict','rejected'])test('an explicit '+status+' permits correcting only property order while retaining canonical request identity',t=>{
  const f=fixture(t),body=payload('reviewed-property-order'),canonical=require('../assets/core/platform-kernel.js').stableSerialize(body);
  assert.notEqual(JSON.stringify(body),canonical);f.box.stage(scope,canonical,support);const before=f.box.getForRetry(scope,body.operation.id);
  f.box.updateOutcome(scope,body.operation.id,{status,code:'PROVEN_NO_COMMIT'});f.box.stage(scope,body,support);
  const after=createCommandOutbox(f.configuration).getForRetry(scope,body.operation.id);assert.equal(after.json,JSON.stringify(body));assert.notEqual(after.json,before.json);
  assert.equal(after.bodyHash,before.bodyHash);assert.equal(after.requestDigest,before.requestDigest);assert.equal(after.metadata.status,'pending');assert.equal(after.metadata.attempts,2);
});

test('unsorted multiple sections survive stage, read, reopen and a matching ACK with canonical metadata',t=>{
  const f=fixture(t),body=payload('multiple-sections');
  body.sections={records:body.sections.records,appMeta:[{id:'synthetic-metadata',value:'Unsorted caller keys'}],vehicles:[{id:7,fuelBalance:923.537}]};
  body.base={records:12,appMeta:2,vehicles:3};
  const meta=f.box.stage(scope,body,support);assert.deepEqual(meta.sections,['appMeta','records','vehicles']);
  const first=f.box.getForRetry(scope,body.operation.id);assert.deepEqual(first.payload,body);assert.deepEqual(first.metadata.sections,meta.sections);
  const fresh=createCommandOutbox(f.configuration),reopened=fresh.getForRetry(scope,body.operation.id);assert.equal(reopened.json,first.json);assert.equal(reopened.bodyHash,first.bodyHash);
  assert.equal(fresh.updateOutcome(scope,body.operation.id,{status:'committed',receipt:{id:body.operation.id,status:'committed',digest:first.requestDigest}}).status,'committed');
  const committed=createCommandOutbox(f.configuration).getForRetry(scope,body.operation.id);assert.equal(committed.metadata.status,'committed');assert.deepEqual(committed.metadata.sections,meta.sections);assert.equal(committed.json,null);
});

test('existing valid records with unsorted section metadata remain readable without changing their request or file',t=>{
  const f=fixture(t),body=payload('legacy-section-order');body.sections={records:body.sections.records,appMeta:[]};body.base.appMeta=2;
  f.box.stage(scope,body,support);const first=f.box.getForRetry(scope,body.operation.id),file=path.join(f.rootDir,entryFiles(f.rootDir)[0]),row=JSON.parse(fs.readFileSync(file,'utf8'));
  row.sections=['records','appMeta'];delete row.checksum;
  row.checksum=crypto.createHash('sha256').update(require('../assets/core/platform-kernel.js').stableSerialize(row)).digest('hex');fs.writeFileSync(file,JSON.stringify(row));
  const bytes=fs.readFileSync(file),fresh=createCommandOutbox(f.configuration),read=fresh.getForRetry(scope,body.operation.id);
  assert.equal(read.json,first.json);assert.equal(read.bodyHash,first.bodyHash);assert.deepEqual(read.metadata.sections,['appMeta','records']);assert.deepEqual(fs.readFileSync(file),bytes);
  assert.equal(fresh.updateOutcome(scope,body.operation.id,{status:'committed',receipt:{id:body.operation.id,status:'replayed',digest:first.requestDigest}}).status,'committed');
});

for(const status of ['pending','unknown','committed']){
  test(status+' operations cannot acquire a different body under the same ID',t=>{
    const {box}=fixture(t);box.stage(scope,payload(),support);
    if(status==='unknown')box.updateOutcome(scope,'operation-1',{status:'unknown',code:'TIMEOUT'});
    if(status==='committed')commit(box,'operation-1');const before=box.getForRetry(scope,'operation-1');
    assert.throws(()=>box.stage(scope,payload('operation-1',{fuelActual:1}),support),error=>error.code==='OUTBOX_OPERATION_REUSED');
    assert.deepEqual(box.getForRetry(scope,'operation-1'),before);
  });
}

for(const status of ['conflict','rejected']){
  test('only an explicit '+status+' outcome allows a same-ID rebase with retained prior hash',t=>{
    const {box}=fixture(t);box.stage(scope,payload(),support);const first=box.getForRetry(scope,'operation-1');
    box.updateOutcome(scope,'operation-1',{status,code:status==='conflict'?'CAS_CONFLICT':'POLICY_REJECTED'});
    const changed=payload('operation-1',{note:'Reviewed new version'});changed.base.records=13;box.stage(scope,changed,support);
    const rebased=box.getForRetry(scope,'operation-1');assert.equal(rebased.metadata.status,'pending');assert.equal(rebased.metadata.attempts,2);
    assert.equal(rebased.priorBodyHash,first.bodyHash);assert.notEqual(rebased.bodyHash,first.bodyHash);assert.deepEqual(rebased.payload,changed);
  });
}

test('public listing contains only scoped metadata and never exposes original records or full failures',t=>{
  const {box}=fixture(t);box.stage(scope,payload(),support);box.stage(foreignScope,payload('foreign'),support);
  const result=box.list(scope);assert.equal(result.length,1);assert.deepEqual(Object.keys(result[0]).sort(),['id','status','sections','createdAt','updatedAt','attempts'].sort());
  assert.ok(!JSON.stringify(result).includes('Private synthetic'));assert.equal(box.getForRetry(foreignScope,'operation-1'),null);
  assert.equal(box.updateOutcome(foreignScope,'operation-1',{status:'unknown',code:'TIMEOUT'}),null);assert.equal(box.discard(foreignScope,'operation-1'),false);
  assert.equal(box.list(scope).length,1);assert.equal(box.list(foreignScope)[0].id,'foreign');
  assert.throws(()=>box.updateOutcome(scope,'operation-1',{status:'unknown',error:'Full private error text'}),error=>error.code==='OUTBOX_OUTCOME');
});

test('legacy stores and requests without modern operation identity cannot enter the queue',t=>{
  const {box}=fixture(t);for(const options of [{},{supportsOperations:false}])assert.throws(()=>box.stage(scope,payload(),options),error=>error.code==='OUTBOX_LEGACY');
  for(const alter of [body=>delete body.operation,body=>delete body.databaseToken,body=>{body.base={};}]){const body=payload();alter(body);assert.throws(()=>box.stage(scope,body,support));}
  assert.deepEqual(box.list(scope),[]);
});

test('safe JSON boundary rejects getters, unsafe keys, cycles and lossy values without invoking executable data',t=>{
  const {box}=fixture(t);let invoked=false;const getter=payload();Object.defineProperty(getter.sections.records[0],'secret',{enumerable:true,get(){invoked=true;return 'unsafe';}});
  const cycle=payload();cycle.sections.records[0].self=cycle;
  const unsafe=payload();unsafe.sections.records[0]=JSON.parse('{"id":"r","__proto__":{"polluted":true}}');
  for(const body of [getter,cycle,unsafe,payload('bad-number',{fuelActual:Infinity}),payload('bad-undefined',{note:undefined})])
    assert.throws(()=>box.stage(scope,body,support),error=>error.code==='OUTBOX_INVALID_JSON');
  assert.equal(invoked,false);assert.equal({}.polluted,undefined);assert.deepEqual(box.list(scope),[]);
});

test('invalid scope, operation IDs, digest and unexpected transport fields are rejected before staging',t=>{
  const {box}=fixture(t);for(const value of [null,'','../outside','a'.repeat(63),'G'.repeat(64)])assert.throws(()=>box.stage(value,payload(),support),error=>error.code==='OUTBOX_SCOPE');
  for(const id of ['../escape','space inside',1]){const body=payload();body.operation.id=id;assert.throws(()=>box.stage(scope,body,support));}
  const digest=payload();digest.operation.digest='sha256:'+'0'.repeat(64);assert.throws(()=>box.stage(scope,digest,support),error=>error.code==='OUTBOX_DIGEST');
  assert.throws(()=>box.stage(scope,{...payload(),password:'must not be stored'},support),error=>error.code==='OUTBOX_PAYLOAD');assert.deepEqual(box.list(scope),[]);
});

test('wrong or incomplete operation receipt stays unknown and preserves request for reconciliation',t=>{
  const {box}=fixture(t);box.stage(scope,payload(),support);const original=box.getForRetry(scope,'operation-1');
  for(const receipt of [undefined,{id:'other',status:'committed'},{id:'operation-1',status:'pending'},{id:'operation-1',status:'committed',digest:'sha256:'+'0'.repeat(64)}]){
    const outcome={status:'committed'};if(receipt)outcome.receipt=receipt;
    const result=box.updateOutcome(scope,'operation-1',outcome);assert.equal(result.status,'unknown');assert.equal(result.code,'ACK_MISMATCH');assert.equal(box.getForRetry(scope,'operation-1').json,original.json);
  }
});

test('confirmed commitment retains only compact proof and can never be downgraded by a late timeout',t=>{
  const f=fixture(t);f.box.stage(scope,payload(),support);const meta=commit(f.box,'operation-1'),entry=f.box.getForRetry(scope,'operation-1');
  assert.equal(meta.status,'committed');assert.equal(entry.payload,null);assert.equal(entry.json,null);assert.equal(entry.receipt.id,'operation-1');
  const text=fs.readFileSync(path.join(f.rootDir,entryFiles(f.rootDir)[0]),'utf8');assert.ok(!text.includes('Private synthetic financial details'));
  assert.equal(f.box.updateOutcome(scope,'operation-1',{status:'unknown',code:'TIMEOUT'}).status,'committed');
  assert.deepEqual(createCommandOutbox(f.configuration).getForRetry(scope,'operation-1'),entry);
});

test('entry limits prune compact committed receipts but preserve all pending and unresolved operations',t=>{
  const {box}=fixture(t,{maxEntries:2});box.stage(scope,payload('pending'),support);box.stage(scope,payload('done'),support);commit(box,'done');
  const staged=box.stage(scope,payload('next'),support);assert.equal(staged.prunedCommitted,1);assert.equal(box.getForRetry(scope,'done'),null);
  assert.ok(box.getForRetry(scope,'pending'));assert.ok(box.getForRetry(scope,'next'));
  assert.throws(()=>box.stage(scope,payload('overflow'),support),error=>error.code==='OUTBOX_FULL');assert.equal(box.list(scope).length,2);
});

test('repeated normal successful saves do not permanently fill the queue',t=>{
  const {box}=fixture(t,{maxEntries:1});for(let index=0;index<8;index++){const id='success-'+index;box.stage(scope,payload(id),support);commit(box,id);}
  assert.equal(box.list(scope).length,1);assert.equal(box.list(scope)[0].status,'committed');
});

test('payload and total byte quotas fail explicitly without silently dropping protected records',t=>{
  const f=fixture(t);f.box.stage(scope,payload(),support);const file=path.join(f.rootDir,entryFiles(f.rootDir)[0]),bytes=fs.statSync(file).size;
  const limited=createCommandOutbox({...f.configuration,maxTotalBytes:bytes+50}),before=limited.getForRetry(scope,'operation-1');
  assert.throws(()=>limited.stage(scope,payload('new'),support),error=>error.code==='OUTBOX_FULL');assert.deepEqual(limited.getForRetry(scope,'operation-1'),before);
  const small=createCommandOutbox({...f.configuration,maxPayloadBytes:1024});assert.throws(()=>small.stage(scope,payload('large',{note:'X'.repeat(1500)}),support),error=>error.code==='OUTBOX_PAYLOAD_LIMIT');
  assert.equal(entryFiles(f.rootDir).length,1);
});

test('unknown, conflicted and rejected operations are never auto-pruned to make room',t=>{
  const {box}=fixture(t,{maxEntries:3});for(const status of ['unknown','conflict','rejected']){box.stage(scope,payload(status),support);box.updateOutcome(scope,status,{status,code:'TEST_OUTCOME'});}
  const before=box.list(scope);assert.throws(()=>box.stage(scope,payload('new'),support),error=>error.code==='OUTBOX_FULL');assert.deepEqual(box.list(scope),before);
});

test('complete fsynced part is recovered after rename failure before IPC acknowledgement',t=>{
  const f=fixture(t);let fail=true;
  const fileSystem={...fs,renameSync(from,to){if(fail&&from.endsWith('.part'))throw Object.assign(Error('Synthetic rename failure'),{code:'EIO'});return fs.renameSync(from,to);}};
  const interrupted=createCommandOutbox({...f.configuration,fileSystem});assert.throws(()=>interrupted.stage(scope,payload(),support),/Synthetic rename failure/);
  assert.equal(fs.readdirSync(f.rootDir).filter(name=>name.endsWith('.part')).length,1);fail=false;
  const recovered=createCommandOutbox(f.configuration);assert.equal(recovered.recovery.promoted,1);assert.deepEqual(recovered.getForRetry(scope,'operation-1').payload,payload());
  assert.equal(fs.readdirSync(f.rootDir).filter(name=>name.endsWith('.part')).length,0);
});

test('the durable stage acknowledgement follows file fsync and atomic rename; fsync failure is never acknowledged',t=>{
  const f=fixture(t),parts=new Set(),events=[];let failSync=false;
  const fileSystem={...fs,
    openSync(file,...rest){const fd=fs.openSync(file,...rest);if(String(file).endsWith('.part'))parts.add(fd);return fd;},
    fsyncSync(fd){if(parts.has(fd)){events.push('fsync');if(failSync)throw Object.assign(Error('Synthetic fsync failure'),{code:'EIO'});}return fs.fsyncSync(fd);},
    closeSync(fd){parts.delete(fd);return fs.closeSync(fd);},
    renameSync(from,to){if(from.endsWith('.part'))events.push('rename');return fs.renameSync(from,to);}};
  const box=createCommandOutbox({...f.configuration,fileSystem});box.stage(scope,payload(),support);events.push('ack');
  assert.deepEqual(events,['fsync','rename','ack']);failSync=true;
  assert.throws(()=>box.stage(scope,payload('not-acknowledged'),support),/Synthetic fsync failure/);
  assert.equal(entryFiles(f.rootDir).length,1);assert.deepEqual(events,['fsync','rename','ack','fsync']);
});

test('a recovered outcome part replaces its matching prior revision instead of reviving an uncertain body',t=>{
  const f=fixture(t);f.box.stage(scope,payload(),support);let fail=false;
  const fileSystem={...fs,renameSync(from,to){if(fail&&from.endsWith('.part'))throw Object.assign(Error('Synthetic receipt rename failure'),{code:'EIO'});return fs.renameSync(from,to);}};
  const box=createCommandOutbox({...f.configuration,fileSystem}),entry=box.getForRetry(scope,'operation-1');fail=true;
  assert.throws(()=>box.updateOutcome(scope,'operation-1',{status:'committed',receipt:{id:'operation-1',status:'committed',digest:entry.requestDigest}}),/Synthetic receipt rename failure/);
  const recovered=createCommandOutbox(f.configuration);assert.equal(recovered.getForRetry(scope,'operation-1').metadata.status,'committed');assert.equal(recovered.getForRetry(scope,'operation-1').payload,null);
});

test('truncated owned part is cleaned while an unrelated part file is never deleted',t=>{
  const f=fixture(t);let partFd;
  const fileSystem={...fs,openSync(file,...rest){const fd=fs.openSync(file,...rest);if(String(file).endsWith('.part'))partFd=fd;return fd;},
    writeFileSync(fd,text,...rest){if(fd===partFd){fs.writeFileSync(fd,String(text).slice(0,20),...rest);throw Object.assign(Error('Synthetic short write'),{code:'EIO'});}return fs.writeFileSync(fd,text,...rest);}};
  const box=createCommandOutbox({...f.configuration,fileSystem});assert.throws(()=>box.stage(scope,payload(),support),/Synthetic short write/);
  const recovered=createCommandOutbox(f.configuration);assert.equal(recovered.recovery.cleaned,1);assert.deepEqual(recovered.list(scope),[]);
  const foreign=path.join(f.rootDir,'unrelated.part');fs.writeFileSync(foreign,'Do not remove');assert.throws(()=>createCommandOutbox(f.configuration),error=>error.code==='OUTBOX_FILE');assert.equal(fs.readFileSync(foreign,'utf8'),'Do not remove');
});

test('tampered final records fail closed without deleting the stored command',t=>{
  const f=fixture(t);f.box.stage(scope,payload(),support);const file=path.join(f.rootDir,entryFiles(f.rootDir)[0]),row=JSON.parse(fs.readFileSync(file,'utf8'));row.payloadJson=row.payloadJson.replace('923.537','1.000');fs.writeFileSync(file,JSON.stringify(row));
  const before=fs.readFileSync(file,'utf8');assert.throws(()=>createCommandOutbox(f.configuration),error=>error.code==='OUTBOX_CORRUPT');assert.equal(fs.readFileSync(file,'utf8'),before);
});

test('unowned directories, ancestor junctions and hard-linked record files are rejected',t=>{
  const f=fixture(t),foreign=path.join(f.parent,'unowned');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'keep'),'Untouched');
  assert.throws(()=>createCommandOutbox({rootDir:foreign}),error=>error.code==='OUTBOX_OWNER');assert.equal(fs.readFileSync(path.join(foreign,'keep'),'utf8'),'Untouched');
  const target=path.join(f.parent,'target'),junction=path.join(f.parent,'junction');fs.mkdirSync(target);fs.symlinkSync(target,junction,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>createCommandOutbox({rootDir:path.join(junction,'outbox')}),error=>error.code==='OUTBOX_PATH');assert.equal(fs.readdirSync(target).length,0);
  f.box.stage(scope,payload(),support);const record=path.join(f.rootDir,entryFiles(f.rootDir)[0]),linked=path.join(f.parent,'record-hardlink');fs.linkSync(record,linked);
  assert.throws(()=>f.box.getForRetry(scope,'operation-1'),error=>error.code==='OUTBOX_FILE');assert.ok(fs.existsSync(linked));
});

test('only the same verified scope can discard a pending command; discard never performs a backend operation',t=>{
  const {box}=fixture(t);box.stage(scope,payload(),support);box.updateOutcome(scope,'operation-1',{status:'unknown',code:'TIMEOUT'});
  assert.equal(box.discard(foreignScope,'operation-1'),false);assert.equal(box.list(scope).length,1);assert.equal(box.discard(scope,'operation-1'),true);assert.deepEqual(box.list(scope),[]);
});

test('unknown lock ownership blocks access; a proven dead same-host owner is recovered',t=>{
  const f=fixture(t),lock=path.join(f.rootDir,'.command-outbox.lock'),owner=JSON.parse(fs.readFileSync(path.join(f.rootDir,'.command-outbox-owner.json'),'utf8'));
  fs.writeFileSync(lock,JSON.stringify({ownerId:owner.ownerId,pid:process.pid,host:'foreign-host',nonce:'foreign'}));
  assert.throws(()=>f.box.list(scope),error=>error.code==='OUTBOX_BUSY');assert.ok(fs.existsSync(lock));fs.unlinkSync(lock);
  fs.writeFileSync(lock,JSON.stringify({ownerId:owner.ownerId,pid:2147483647,host:os.hostname(),nonce:'dead-owner'}));
  assert.deepEqual(f.box.list(scope),[]);assert.equal(fs.existsSync(lock),false);assert.equal(fs.existsSync(lock+'.recovery'),false);
});
