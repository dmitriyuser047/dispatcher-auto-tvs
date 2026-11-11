'use strict';
// A genuine ledger with a hot event for every distinct, dense historical
// proof. Synthetic JSON only; no files or actual application databases.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
// The fixture models existing pre-compression history. Disable only compression
// in its isolated WRITER; the tested current readers, hashes and guards remain
// untouched. Raw proof bytes are valid supported ledger objects.
const filename=require.resolve('../../electron/operation-ledger.cjs'),local=Module.createRequire(filename),writer=new Module(filename,module);
writer.filename=filename;writer.paths=Module._nodeModulePaths(path.dirname(filename));writer.require=name=>name==='node:zlib'?{...local(name),deflateRawSync:bytes=>Buffer.alloc(bytes.length)}:local(name);
writer._compile(fs.readFileSync(filename,'utf8'),filename);const ledger=writer.exports;
const currentReader=require(filename);
const createLegacyRawLedger=options=>ledger.createOperationLedger(options);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function makeHotProofFixture({count=48,rows=12000,tag='hot-proof-benchmark'}={}){
 const objects=new Map(),proofHashes=new Set(),hotRows=[],stats={proofReads:0},metadata=Array.from({length:rows},(_,id)=>({id,section:'records',org:'Synthetic organisation',site:'Synthetic object',qty:1.001,note:'Synthetic frozen historical evidence row'}));
 const readObject=id=>{if(proofHashes.has(id))stats.proofReads++;return objects.get(id);};let engine=ledger.createOperationLedger({readObject,cursorKey:Buffer.alloc(32)}),head=engine.genesis(),proofBytes=0;
 for(let index=0;index<count;index++){
  const operation={id:tag+'-'+index,digest:'sha256:'+'a'.repeat(64),actorId:'synthetic',actorRole:'admin',databaseToken:'synthetic-hot-db'},proof={version:1,status:'verified',requiredSections:['vehicles'],subjects:[],request:{operation,selectedTargets:[],tag,index,metadata}},event={section:'vehicles',before:null,after:{id:index,note:'Synthetic historical event '+index}},plan=engine.prepareAppend({head,receipt:{operation,at:'2026-11-08T09:00:00.000Z',changedSections:['vehicles'],revisions:{vehicles:index+1},result:{}},auditEntries:[event],accessProof:proof}),proofJSON=JSON.stringify(proof);
  for(const object of plan.objects)objects.set(object.id,object.json);const proofHash=hash(proofJSON);if(!objects.has(proofHash))throw Error('Synthetic proof canonical bytes differ');proofHashes.add(proofHash);proofBytes+=Buffer.byteLength(proofJSON);head=plan.head;hotRows.push(event);
 }
 // All observations use the current production reader and its own private
 // parsed-proof ownership registry. Only fixture creation uses the raw writer.
 engine=currentReader.createOperationLedger({readObject,cursorKey:Buffer.alloc(32)});
 return{engine,head,hotRows,objects,proofHashes,proofBytes,stats,readObject};
}
module.exports={makeHotProofFixture,createLegacyRawLedger};
