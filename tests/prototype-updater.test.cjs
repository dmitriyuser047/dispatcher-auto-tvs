const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('prototype neither checks the public channel nor downloads or starts an updater',async()=>{
 let requests=0,launches=0;
 const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../electron/updater.js'),'utf8'),{module:mod,exports:mod.exports,console,URL,Buffer,AbortController,setTimeout,clearTimeout,require:name=>{
  if(name==='electron')return{app:{getVersion:()=>require('../package.json').version,quit(){launches++;}}};
  if(name==='../package.json')return require('../package.json');
  if(name==='https')return{get(){requests++;throw Error('Public channel must not be contacted');}};
  return require(name);
 }});
 assert.equal(await mod.exports.checkForUpdate(),null);
 await assert.rejects(mod.exports.downloadFile('https://github.com/example/setup.exe'),/Прототип/);
 await assert.rejects(mod.exports.launchInstaller('anything.exe'),/отключена/);
 assert.equal(requests,0);assert.equal(launches,0);
});
