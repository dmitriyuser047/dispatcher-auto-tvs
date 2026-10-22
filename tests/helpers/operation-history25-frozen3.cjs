'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const ROOT=path.resolve(__dirname,'../..'),directory=path.join(ROOT,'tests/fixtures/schema-v3'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'source-sha256.json'),'utf8'));
function load(name,overrides={}){
 const entry=manifest.find(value=>value.name===name),filename=path.join(directory,name),bytes=fs.readFileSync(filename);if(!entry||crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Frozen actual schema3 source hash mismatch: '+name);
 const mod=new Module(filename,module),base=Module.createRequire(path.join(ROOT,entry.source));mod.filename=filename;mod.paths=Module._nodeModulePaths(ROOT);mod.require=request=>Object.hasOwn(overrides,request)?overrides[request]:base(request);mod._compile(bytes.toString('utf8'),filename);return mod.exports;
}
function frozen3({DatabaseSync}={}){
 const format=load('storage-format-v3.cjs'),sqlite=load('sqlite-storage-v3.cjs',{'./storage-format.cjs':format,...(DatabaseSync?{'node:sqlite':{DatabaseSync}}:{})}),storage=load('storage-v3.cjs',{'./storage-format.cjs':format,'./sqlite-storage.cjs':sqlite});return {format,sqlite,storage};
}
module.exports={ROOT,manifest,frozen3};
