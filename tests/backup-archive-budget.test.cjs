'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),AdmZip=require('adm-zip'),backup=require('../electron/backup-service.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-backup-budget-'));t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^tvs-backup-budget-/);fs.rmSync(root,{recursive:true,force:true});});return {root,archive:path.join(root,'synthetic.zip')};}
test('backup ZIP rejects lying decompressed size inside the bounded inflater before manifest parsing or staging',t=>{
 const f=fixture(t),zip=new AdmZip();zip.addFile('manifest.json',Buffer.alloc(1024*1024,65));const bytes=zip.toBuffer();
 for(let offset=0;offset<bytes.length-46;offset++){const signature=bytes.readUInt32LE(offset);if(signature===0x04034b50)bytes.writeUInt32LE(8,offset+22);if(signature===0x02014b50)bytes.writeUInt32LE(8,offset+24);}
 fs.writeFileSync(f.archive,bytes);const before=crypto.createHash('sha256').update(bytes).digest('hex');
 assert.throws(()=>backup.verifyPackage({archivePath:f.archive}),{code:'BACKUP_LIMIT'});assert.deepEqual(fs.readdirSync(f.root),['synthetic.zip']);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.archive)).digest('hex'),before);
});
test('backup ZIP also rejects unknown empty directories instead of dropping them from verification',t=>{
 const f=fixture(t),zip=new AdmZip();zip.addFile('unmanaged-empty/',Buffer.alloc(0));zip.addFile('manifest.json',Buffer.from('{}'));fs.writeFileSync(f.archive,zip.toBuffer());assert.throws(()=>backup.verifyPackage({archivePath:f.archive}),{code:'BACKUP_PATH'});
});
test('oversized backup original fails through bounded file validation before decompression',t=>{
 const f=fixture(t);fs.writeFileSync(f.archive,'');fs.truncateSync(f.archive,512*1024*1024+1);assert.throws(()=>backup.verifyPackage({archivePath:f.archive}),{code:'SAFE_FILE_TOO_LARGE'});
});
