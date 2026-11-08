'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const source=require('../electron/import-source.cjs'),storage=require('../electron/storage'),sqlite=require('../electron/sqlite-storage.cjs'),commands=require('../assets/core/platform-commands.js'),inventory=require('../assets/core/asset-inventory.js');
const admin={id:'osv-test',name:'Synthetic OSV test',role:'admin'},now='2026-11-08T12:00:00.000Z',sections=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions'];
const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../vendor/xlsx.bundle.js'),'utf8'),context);const X=context.XLSX;
function fixture(t){const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'tvs-osv-import-')),pin=fs.lstatSync(root),dir=path.join(root,'database');sqlite.create(dir,{data:{vehicles:[{id:0,plate:'UNCHANGED FLEET',org:'Synthetic fleet'}]}});t.after(()=>{const s=fs.lstatSync(root);assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^tvs-osv-import-/);assert.equal(s.isSymbolicLink(),false);assert.equal(s.dev,pin.dev);assert.equal(s.ino,pin.ino);fs.rmSync(root,{recursive:true,force:true});});return{dir};}
for(const type of ['xlsx','biff8'])test(type+' OSV preview and one SQLite commit preserve balance boundaries, unknown quantity and literal replay',async t=>{
 const {dir}=fixture(t),before=storage.readSnapshot(dir),book=X.utils.book_new(),rows=[
  ['Счёт','','Показатели','Сальдо на начало периода','','Обороты за период','','Сальдо на конец периода'],
  ['Наименование','Код','','Дебет','Кредит','Дебет','Кредит','Дебет','Кредит'],
  ['МЦ.04','','БУ'],['МОЛ Синтетический','','БУ'],
  ['Known zero','000007','БУ',100,null,null,null,0],['','','Кол.',1,null,null,null,0],
  ['Unknown quantity','000008','БУ',100,null,null,null,90],['Итого','','БУ',200,null,null,null,90],['','','Кол.',2,null,null,null,99]
 ];X.utils.book_append_sheet(book,X.utils.aoa_to_sheet(rows),'OSV');const bytes=Buffer.from(X.write(book,{type:'buffer',bookType:type}));
 const staged=await source.handle(dir,{action:'stage',profile:'asset-inventory',parser:{id:'asset-inventory',version:1},databaseToken:before.databaseToken,sections,source:{name:'Synthetic OSV.'+(type==='biff8'?'xls':'xlsx'),base64:bytes.toString('base64')},mapping:{format:'osv',defaultOrgName:'Synthetic own org',defaultObjectName:'Synthetic own object'}},{principal:admin,now});
 assert.equal(staged.canImport,true,JSON.stringify(staged.issues));assert.deepEqual(storage.readSnapshot(dir),before);
 const review=await source.handle(dir,{action:'preview',profile:'asset-inventory',sourceId:staged.sourceId,databaseToken:before.databaseToken,reason:'Synthetic verified turnover'},{principal:admin,now});assert.equal(review.preview.canApply,true,JSON.stringify(review.preview.issues));assert.deepEqual(storage.readSnapshot(dir),before);
 const command={type:'AssetInventoryAction',version:1,input:{...review.input,reviewFingerprint:review.reviewFingerprint}},envelope={protocolVersion:1,databaseToken:before.databaseToken,operation:{id:'synthetic-osv-'+type},base:Object.fromEntries(commands.dependencies(command).map(n=>[n,before.revisions[n]])),command};
 const result=storage.executeCommand(dir,envelope,{principal:admin,now});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.operationReceipt.status,'committed');const after=storage.readSnapshot(dir);
 assert.deepEqual(after.data.inventoryItems.map(r=>[r.code,r.qty,r.cost]),[['000007',0,0],['000008',null,90]]);assert.equal(after.data.inventorySessions.length,0);assert.deepEqual(after.data.vehicles,before.data.vehicles);
 const quantity=inventory.quantityModel(after.data);assert.equal(quantity.rows.length,2);assert.equal(quantity.summary.unknownAcct,1);assert.deepEqual(quantity.rows.map(r=>r.qtyAcct),[0,null]);assert.ok(quantity.rows.every(r=>r.qtyFact===null&&r.comparisonStatus==='unrecorded'));
 const repeat=storage.executeCommand(dir,envelope,{principal:admin,now});assert.equal(repeat.replayed,true);assert.deepEqual(storage.readSnapshot(dir),after);
});
