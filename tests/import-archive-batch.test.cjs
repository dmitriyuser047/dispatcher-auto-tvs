'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {rarStored}=require('./helpers/archive-fixture.cjs'),decoder=require('../electron/import-decoder.cjs'),source=require('../electron/import-source.cjs'),storage=require('../electron/storage'),{seedDatabase}=require('./period-test-support.cjs');
function archive(count){const one=rarStored('template.json',Buffer.from('{}'));return Buffer.concat([one.subarray(0,20),...Array.from({length:count},(_,index)=>rarStored('row-'+index+'.json',Buffer.from('{}')).subarray(20,-7)),one.subarray(-7)]);}
const files=[600,401].map((count,index)=>({name:'synthetic-'+index+'.rar',base64:archive(count).toString('base64')}));
test('source decoder applies one entry budget to all selected RAR originals',async()=>{
 await assert.rejects(decoder.decode({profile:'vehicles',sections:['vehicles'],scopesOnly:true,files}),error=>/^ARCHIVE_/.test(error.code));
});
test('human interpretation cannot reset the archive budget between original files or publish a partial source',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-import-archive-batch-')),dir=path.join(root,'synthetic-db');
 t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^tvs-import-archive-batch-/);fs.rmSync(root,{recursive:true,force:true});});
 seedDatabase(dir,{});const before=storage.readSnapshot(dir);
 await assert.rejects(source.handle(dir,{action:'stage',databaseToken:before.databaseToken,profile:'vehicles',sections:['vehicles'],parser:{id:'vehicles',version:1},source:{files},interpretation:{rows:[],attestation:{mode:'human-transcription',basis:'Synthetic checked interpretation'}}},{principal:{id:'synthetic-admin',name:'Synthetic',role:'admin'}}),error=>/^ARCHIVE_/.test(error.code));
 assert.equal(fs.existsSync(path.join(dir,'import-sources')),false);assert.deepEqual(storage.readSnapshot(dir),before);
});
