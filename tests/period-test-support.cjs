'use strict';
// Synthetic initial facts may contain historical domain states which cannot be
// introduced by a present-day command. Only the real new-target builder creates
// their authoritative service state; existing receipt evidence stays immutable.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),format=require('../electron/storage-format.cjs'),store=require('../electron/operation-store.cjs');
function assertSynthetic(dir){const relative=path.relative(fs.realpathSync(os.tmpdir()),fs.realpathSync(dir));if(!relative||path.isAbsolute(relative)||relative.startsWith('..')||!relative.split(path.sep)[0].startsWith('tvs-'))throw Error('Synthetic fixture path required');}
function seedDatabase(dir,data){
 fs.mkdirSync(dir,{recursive:true});assertSynthetic(dir);
 storage.createJson(dir,{data,revisions:Object.fromEntries(storage.SECTIONS.map(name=>[name,1]))});
}
function seedSections(dir,sections){
 assertSynthetic(dir);const revisions=storage.readRevisions(dir);
 // These test-only mutations model a later concurrent business state. They
 // cannot replace audit facts, publish a receipt, or reset authoritative history.
 for(const name of Object.keys(sections)){if(!storage.SECTIONS.includes(name)||name==='auditLog'||!Array.isArray(sections[name]))throw Error('Synthetic business sections required');revisions[name]++;}
 if(sqlite.exists(dir))sqlite.commitSections(dir,sections,revisions);
 else{const current=store.readState(dir),descriptor=storage.descriptor(dir),next=format.createOperationState(current.head);for(const [name,rows]of Object.entries(sections))fs.writeFileSync(storage.sectionFile(dir,name),JSON.stringify(rows));fs.writeFileSync(storage.revisionsFile(dir),JSON.stringify(storage.encodeRevisions(revisions,descriptor,next)));}
}
module.exports={seedDatabase,seedSections};
