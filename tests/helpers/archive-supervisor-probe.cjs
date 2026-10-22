'use strict';
// Only the synthetic test replaces the codec thread. The production supervisor
// still owns its real timeout/disconnect handlers and terminates actual WASM.
const Module=require('node:module'),original=Module._load,threads=require('node:worker_threads');
const wasm=Buffer.from('0061736d01000000010401600000030201000707010372756e00000a0901070003400c000b0b','hex');
Module._load=function(request,parent,isMain){if(request==='node:worker_threads')return {...threads,Worker:class extends threads.Worker{constructor(_filename,options){super('const bytes=Buffer.from('+JSON.stringify(wasm.toString('hex'))+',"hex");new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.run();',{eval:true,resourceLimits:options.resourceLimits});this.once('online',()=>setTimeout(()=>process.send?.({kind:'synthetic-inner-running'}),50));}}};return original.apply(this,arguments);};
require('../../electron/archive-decoder-worker.cjs');
