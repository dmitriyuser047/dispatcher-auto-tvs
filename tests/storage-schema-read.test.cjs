'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const storage=require('../electron/storage');

test('one locked JSON read admits the schema once for the section sweep instead of re-reading metadata for every table',t=>{
 const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-schema-read-')),identity=fs.lstatSync(root),dir=path.join(root,'db'),data=Object.fromEntries(storage.SECTIONS.map(name=>[name,[]]));
 t.after(()=>{const actual=fs.lstatSync(root);assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('tvs-schema-read-'));assert.equal(actual.isSymbolicLink(),false);assert.equal(actual.dev,identity.dev);assert.equal(actual.ino,identity.ino);fs.rmSync(root,{recursive:true,force:true});});
 data.parts=[{id:0,name:'SYNTHETIC'}];storage.createJson(dir,{data});let reads=0;const original=fs.readFileSync,filename=path.resolve(storage.revisionsFile(dir));
 fs.readFileSync=function(file,...args){if(typeof file==='string'&&path.resolve(file)===filename)reads++;return original.call(this,file,...args);};
 let result;try{result=storage.readAll(dir);}finally{fs.readFileSync=original;}
 assert.equal(Object.keys(result).length,storage.SECTIONS.length);assert.deepEqual(result.parts,data.parts);assert.ok(reads<=8,'Revision metadata was read '+reads+' times for '+storage.SECTIONS.length+' sections');
});
