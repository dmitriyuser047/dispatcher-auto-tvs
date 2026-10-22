'use strict';
// Physical synthetic seeds model databases written by an earlier program. They
// deliberately avoid granting raw-write callers a closing/approval bypass.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs');
function assertSynthetic(dir){const relative=path.relative(fs.realpathSync(os.tmpdir()),fs.realpathSync(dir));if(!relative||path.isAbsolute(relative)||relative.startsWith('..')||!relative.split(path.sep)[0].startsWith('tvs-'))throw Error('Synthetic fixture path required');}
function seedDatabase(dir,data){
 fs.mkdirSync(dir,{recursive:true});assertSynthetic(dir);
 if(sqlite.exists(dir))throw Error('Use seedSections for an existing SQLite fixture');
 fs.mkdirSync(storage.sectionsDir(dir),{recursive:true});
 for(const name of storage.SECTIONS)fs.writeFileSync(storage.sectionFile(dir,name),JSON.stringify(data[name]||[]));
 fs.writeFileSync(storage.revisionsFile(dir),JSON.stringify(storage.encodeRevisions(Object.fromEntries(storage.SECTIONS.map(name=>[name,1])))));
}
function seedSections(dir,sections){
 assertSynthetic(dir);const revisions=storage.readRevisions(dir);
 for(const name of Object.keys(sections)){if(!storage.SECTIONS.includes(name)||!Array.isArray(sections[name]))throw Error('Synthetic sections required');revisions[name]++;}
 if(sqlite.exists(dir))sqlite.commitSections(dir,sections,revisions);
 else{for(const [name,rows]of Object.entries(sections))fs.writeFileSync(storage.sectionFile(dir,name),JSON.stringify(rows));fs.writeFileSync(storage.revisionsFile(dir),JSON.stringify(storage.encodeRevisions(revisions)));}
}
module.exports={seedDatabase,seedSections};
