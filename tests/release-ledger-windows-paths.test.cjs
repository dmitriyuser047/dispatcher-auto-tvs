'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../electron/operation-ledger.cjs'),'utf8');

// A deterministic Windows filesystem model reproduces GitHub's RUNNER~1
// alias on every test host without accessing another user's profile.
function fixture(moduleName='operation-ledger.cjs'){
 const P=path.win32,long='C:\\Users\\runneradmin\\AppData\\Local\\Temp\\Synthetic Ledger',short=long.replace('runneradmin','RUNNER~1'),nodes=new Map(),overrides=new Map(),fds=new Map();let ino=1,fd=10,onRealpath=null,onLstat=null;
 const normalize=value=>P.resolve(value),fold=value=>normalize(value).toLowerCase(),expand=value=>normalize(value).replace(/^C:\\Users\\RUNNER~1(?=\\|$)/i,'C:\\Users\\runneradmin');
 function directories(value){let current=normalize(value);while(true){if(!nodes.has(fold(current)))nodes.set(fold(current),{kind:'directory',ino:ino++,dev:1});const parent=P.dirname(current);if(parent===current)break;current=parent;}}
 directories(P.join(long,'sections'));nodes.set(fold(P.join(long,'sections','records.json')),{kind:'file',ino:ino++,dev:1,bytes:Buffer.from('[{"id":0,"note":"synthetic"}]')});nodes.set(fold(P.join(long,'platform.sqlite-journal')),{kind:'file',ino:ino++,dev:1,bytes:Buffer.alloc(28)});
 const missing=()=>{throw Object.assign(Error('Missing synthetic path'),{code:'ENOENT'});};
 function node(value){return overrides.get(fold(value))??nodes.get(fold(expand(value)))??missing();}
 function state(value){const item=typeof value==='string'?node(value):value;return {dev:item.dev,ino:item.ino,size:item.bytes?.length??0,nlink:item.nlink??1,mtimeMs:1,ctimeMs:1,birthtimeMs:1,isDirectory:()=>item.kind==='directory',isFile:()=>item.kind==='file',isSymbolicLink:()=>item.kind==='link'};}
 const fake={constants:fs.constants,lstatSync(value){if(onLstat)onLstat(value);return state(value);},realpathSync:{native(value){if(onRealpath)onRealpath(value);node(value);return expand(value);}},openSync(value){const item=node(value);assert.equal(item.kind,'file');fds.set(++fd,{item,position:0});return fd;},fstatSync(value){return state(fds.get(value).item);},readSync(value,buffer,offset,length,position){const opened=fds.get(value),at=position===null?opened.position:position,count=opened.item.bytes.copy(buffer,offset,at,at+length);if(position===null)opened.position+=count;return count;},closeSync(value){fds.delete(value);}};
 const module={exports:{}};vm.runInNewContext(moduleName==='operation-ledger.cjs'?source:fs.readFileSync(path.join(__dirname,'../electron',moduleName),'utf8'),{module,exports:module.exports,require(name){return name==='node:fs'?fake:name==='node:path'?P:require(name);},Buffer,process:{platform:'win32'}},{filename:'synthetic-'+moduleName});
 return {api:module.exports,long,short,nodes,overrides,fold,setRealpathHook(value){onRealpath=value;},setStatHook(value){onLstat=value;},directory(value){directories(value);},replace(value){const item=node(value);overrides.set(fold(value),{...item,ino:ino++});},link(value){overrides.set(fold(value),{kind:'link',dev:1,ino:ino++});}};
}

test('Windows 8.3 root aliases read the same canonical ledger files and retain confinement',()=>{
 const f=fixture(),files=f.api.createManagedFiles(f.short);assert.equal(files.root,f.long);
 for(const base of [f.short,f.long])assert.equal(files.read(path.win32.join(base,'sections','records.json')).bytes.toString(),'[{"id":0,"note":"synthetic"}]');
 assert.equal(files.verifyDirectory(path.win32.join(f.short,'sections')),true);
 for(const file of ['C:\\foreign\\records.json',path.win32.join(f.short,'..','outside.json'),f.short])assert.throws(()=>files.read(file),{code:'LEDGER_PATH'});
});
for(const at of ['C:\\Users\\RUNNER~1','root'])test('initial 8.3 alias rejects a lexical junction or symlink at '+at,()=>{
 const f=fixture();f.link(at==='root'?f.short:at);assert.throws(()=>f.api.createManagedFiles(f.short),{code:'LEDGER_PATH'});
});
for(const at of ['C:\\Users\\RUNNER~1','root','canonical'])test('8.3 alias rechecks pinned ancestor identity after replacement at '+at,()=>{
 const f=fixture(),files=f.api.createManagedFiles(f.short);f.replace(at==='root'?f.short:at==='canonical'?f.long:at);
 assert.throws(()=>files.read(path.win32.join(f.long,'sections','records.json')),error=>['LEDGER_PATH_CHANGED','LEDGER_PATH'].includes(error.code));
});
test('8.3 alias is rechecked after initialization even when access uses the long root',()=>{
 const f=fixture(),files=f.api.createManagedFiles(f.short);f.link('C:\\Users\\RUNNER~1');assert.throws(()=>files.read(path.win32.join(f.long,'sections','records.json')),{code:'LEDGER_PATH'});
});
test('a lexical ancestor swapped while its canonical name is resolved fails before opening a file',()=>{
 const f=fixture();let fired=false;f.setRealpathHook(value=>{if(!fired&&value==='C:\\Users\\RUNNER~1'){fired=true;f.link(value);}});
 assert.throws(()=>f.api.createManagedFiles(f.short),{code:'LEDGER_PATH'});assert.equal(fired,true);
});

test('real managed atomic files preserve bytes through native Windows short names when available',t=>{
 const os=require('node:os'),{execFileSync}=require('node:child_process'),api=require('../electron/operation-ledger.cjs'),parent=fs.realpathSync.native(os.tmpdir()),directory=fs.mkdtempSync(path.join(parent,'tvs-release-ledger-long-name-')),identity=fs.lstatSync(directory);
 t.after(()=>{const current=fs.lstatSync(directory);assert.equal(path.dirname(directory),parent);assert.match(path.basename(directory),/^tvs-release-ledger-long-name-/);assert.equal(current.isSymbolicLink(),false);assert.equal(current.dev,identity.dev);assert.equal(current.ino,identity.ino);fs.rmSync(directory,{recursive:true,force:true});});
 const alias=process.platform==='win32'?execFileSync('cmd.exe',['/d','/c','for %I in (.) do @echo %~fsI'],{cwd:directory,encoding:'utf8',windowsHide:true}).trim():directory;
 assert.equal(fs.realpathSync.native(alias),directory);t.diagnostic(alias===directory?'Native volume does not expose a different short alias; deterministic RUNNER~1 coverage also ran.':'Native short alias: '+path.basename(alias));
 fs.mkdirSync(path.join(directory,'sections'));const target=path.join(alias,'sections','records.json'),files=api.createManagedFiles(alias),before=Buffer.from('[{"id":0}]'),after=Buffer.from('[{"id":0,"note":"committed"}]');
 files.atomic(target,before,null);assert.equal(files.root,directory);assert.deepEqual(files.read(target).bytes,before);files.atomic(target,after,files.read(target));assert.deepEqual(fs.readFileSync(path.join(directory,'sections','records.json')),after);
});

test('cold SQLite journal accepts a genuine short alias with an unchanged bounded observation',()=>{
 const f=fixture('sqlite-rollback.cjs'),file=path.win32.join(f.short,'platform.sqlite'),before=Buffer.from(f.nodes.get(f.fold(path.win32.join(f.long,'platform.sqlite-journal'))).bytes),token=f.api.assertQuiescent(file);
 assert.equal(token.state,'cold');assert.equal(f.api.assertUnchanged(file,token),token);assert.deepEqual(f.nodes.get(f.fold(path.win32.join(f.long,'platform.sqlite-journal'))).bytes,before);
});
test('cold SQLite observation rejects a lexical junction even when it resolves to the same file',()=>{
 const f=fixture('sqlite-rollback.cjs');f.link('C:\\Users\\RUNNER~1');assert.throws(()=>f.api.assertQuiescent(path.win32.join(f.short,'platform.sqlite')),{code:'SQLITE_ROLLBACK_UNSAFE'});
});
test('cold SQLite observation pins its directory identities as well as unchanged file bytes',()=>{
 const f=fixture('sqlite-rollback.cjs'),file=path.win32.join(f.short,'platform.sqlite'),token=f.api.assertQuiescent(file);f.nodes.get(f.fold(f.long)).ino+=1000;
 assert.throws(()=>f.api.assertUnchanged(file,token),{code:'SQLITE_ROLLBACK_CHANGED'});
});
test('cold SQLite observation rejects an ancestor swapped while resolving an 8.3 alias',()=>{
 const f=fixture('sqlite-rollback.cjs');let fired=false;f.setRealpathHook(value=>{if(!fired&&value==='C:\\Users\\RUNNER~1'){fired=true;f.link(value);}});
 assert.throws(()=>f.api.assertQuiescent(path.win32.join(f.short,'platform.sqlite')),{code:'SQLITE_ROLLBACK_UNSAFE'});assert.equal(fired,true);
});

test('cold SQLite observation rejects a hard link added only at the final alias file stat',()=>{
 const f=fixture('sqlite-rollback.cjs'),journal=f.nodes.get(f.fold(path.win32.join(f.long,'platform.sqlite-journal')));let observations=0;
 f.setStatHook(value=>{if(value.endsWith('platform.sqlite-journal')&&++observations===3)journal.nlink=2;});
 assert.throws(()=>f.api.assertQuiescent(path.win32.join(f.short,'platform.sqlite')),{code:'SQLITE_ROLLBACK_UNSAFE'});assert.equal(observations,3);
});
