'use strict';
const {crc32}=require('./archive-fixture.cjs');
process.once('message',message=>{let wasmRejected=false;try{new WebAssembly.Memory({initial:8193,maximum:8193});}catch(error){wasmRejected=error instanceof RangeError;}const bytes=Buffer.from(JSON.stringify({electron:process.versions.electron||null,runAsNode:process.env.ELECTRON_RUN_AS_NODE,wasmRejected,heapLimit:require('node:v8').getHeapStatistics().heap_size_limit}));process.send({id:message.id,ok:true,entries:[{name:'probe.json',isDirectory:false,bytes,crc:crc32(bytes)}]},()=>process.exit(0));});
