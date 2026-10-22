'use strict';
// Test-only old-producer inputs. Origin is pinned before the real NEW-target
// constructor honestly bootstraps literal audit as legacy-unverified evidence.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),storage=require('../../electron/storage'),sqlite=require('../../electron/sqlite-storage.cjs');
function seedWithLiteralHistory(dir,kind,{data,revisions=Object.fromEntries(storage.SECTIONS.map(name=>[name,1])),prepare=()=>{},identity={format:'tvs-database-identity',version:1,uuid:crypto.randomUUID(),generation:1}}){
 const requested=path.resolve(dir),parent=path.dirname(requested),scope=path.relative(fs.realpathSync(os.tmpdir()),requested);if(!scope||path.isAbsolute(scope)||scope==='..'||scope.startsWith('..'+path.sep)||!scope.split(path.sep)[0].startsWith('tvs-')||fs.realpathSync(parent)!==parent)throw Error('An owned synthetic parent is required before creating the target');
 fs.mkdirSync(dir,{recursive:true});const physical=fs.realpathSync(path.resolve(dir)),relative=path.relative(fs.realpathSync(os.tmpdir()),physical);if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||!relative.split(path.sep)[0].startsWith('tvs-')||fs.readdirSync(physical).length)throw Error('An empty owned synthetic target is required');const key=process.platform==='win32'?physical.toLowerCase():physical,databaseToken=crypto.createHash('sha256').update(JSON.stringify(['tvs-database',key,identity.uuid,identity.generation])).digest('hex'),prepared=prepare({data,revisions,databaseToken,identity});
 if(kind==='sqlite')sqlite.create(physical,{data,revisions,identity});else storage.createJson(physical,{data,revisions,identity});if(storage.databaseToken(physical)!==databaseToken)throw Error('Literal fixture origin must equal the actual authoritative physical context');return{prepared,databaseToken,identity};
}
module.exports={seedWithLiteralHistory};
