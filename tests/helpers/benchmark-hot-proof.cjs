'use strict';
const {performance}=require('node:perf_hooks'),ledger=require('../../electron/operation-ledger.cjs'),{makeHotProofFixture}=require('./hot-proof-fixture.cjs');
const start=performance.now(),f=makeHotProofFixture(),setupMs=performance.now()-start,rounds=[];
for(let round=0;round<3;round++){
 const parse=JSON.parse;let largeParses=0;const beforeReads=f.stats.proofReads,at=performance.now();JSON.parse=function(text,...args){if(typeof text==='string'&&text.length>512*1024)largeParses++;return parse.call(this,text,...args);};
 try{ledger.withReadScope(()=>f.engine.planArchive({head:f.head,throughSeq:0,hotRows:f.hotRows}));}finally{JSON.parse=parse;}
 rounds.push({round,ms:Number((performance.now()-at).toFixed(2)),largeJSONParses:largeParses,proofReads:f.stats.proofReads-beforeReads});
}
process.stdout.write(JSON.stringify({setupMs:Number(setupMs.toFixed(2)),proofBytes:f.proofBytes,hotEvents:f.head.hot.length,rounds})+'\n');
