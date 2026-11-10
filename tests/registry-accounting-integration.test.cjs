'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const core=require('../assets/core/registry-import.js'),accounting=require('../assets/core/registry-accounting.js'),stats=require('../assets/core/registry-statistics.js'),parties=require('../assets/core/registry-counterparties.js');
const storage=require('../electron/storage.js'),sqlite=require('../electron/sqlite-storage.cjs');
function fixture(){
  const data={vehicles:[{id:0,plate:'SYNTHETIC'}],generators:[{id:'des',name:'SYNTHETIC DES'}],drivers:[{id:'driver',name:'SYNTHETIC DRIVER'}],contragents:[{id:'supplier',name:'Synthetic supplier'}],repairs:[{id:'repair',vehicleId:0,date:'2026-09-01',description:'Synthetic repair'}],vehicleTo:[],savedReestrs:[],payments:[]};
  const originals=[];
  for(const [id,number]of [['first','1'],['second','2']]){
    const bytes=Buffer.from('%PDF-SYNTHETIC-'+id),sha256=crypto.createHash('sha256').update(bytes).digest('hex'),source={id:sha256+'.pdf',sha256,size:bytes.length,name:id+'.pdf'};originals.push({source,bytes});
    data.savedReestrs.push(core.buildRegister({id,number,date:'2026-09-01',reason:'Synthetic reviewed source',duplicateReason:'Synthetic repeated invoice pending review',source,invoices:[{registryInvoiceId:id+'-invoice',supplier:'Synthetic supplier',contragentId:'supplier',invoiceNo:'INV-001',date:'2026-08-31',sum:100.01,category:'20.01.01',allocations:[{kind:'vehicle',assetId:0,sum:30.01,serviceRef:{section:'repairs',id:'repair'}},{kind:'generator',assetId:'des',sum:30},{kind:'driver',assetId:'driver',sum:40}]}]},data));
  }
  return {data,originals};
}
function choose(data){const group=accounting.project(data).groups.find(group=>group.kind==='invoice');assert.ok(group);return accounting.resolve(data,{groupId:group.id,basis:group.basis,includedKeys:[group.members[0].key],separate:false,reason:'Synthetic source comparison: one obligation'});}
test('finance, BDDS, supplier, driver and repair all exclude unreviewed repeats and use one chosen invoice with exact split cents',()=>{
  const {data}=fixture(),before=JSON.stringify(data);
  assert.equal(stats.project(data).totals.sum,0);assert.equal(stats.project(data).accounting.review.invoices,2);assert.equal(stats.project(data).accounting.review.sum,200.02);
  assert.equal(core.driverInvoices(data,'driver').length,0);assert.equal(core.serviceInvoices(data,{section:'repairs',id:'repair'}).length,0);assert.equal(parties.statistics(data).size,0);
  const next={...data,savedReestrs:choose(data)};core.validateChanges(data,next);
  const report=stats.project(next);assert.equal(report.totals.sum,100.01);assert.equal(report.totals.invoices,1);assert.equal(report.accounting.excluded.sum,100.01);assert.equal(report.accounting.review.invoices,0);
  assert.equal(core.driverInvoices(next,'driver')[0].sum,40);assert.equal(core.serviceInvoices(next,{section:'repairs',id:'repair'})[0].sum,30.01);assert.deepEqual(parties.statistics(next).get('supplier'),{count:1,sum:100.01});
  assert.equal(stats.expenseBudget(next).actual.sum,100.01);assert.deepEqual(next.payments,[]);assert.equal(JSON.stringify(data),before);
  for(let i=0;i<data.savedReestrs.length;i++){const {registryAccounting,...actual}=next.savedReestrs[i];assert.deepEqual(actual,data.savedReestrs[i]);assert.ok(registryAccounting);}
});
test('budget comparison stays incomplete while repeats for the selected period/article await review',()=>{
  const {data}=fixture();assert.deepEqual(stats.expenseBudget(data).options.years,['2026']);data.budget=[{year:2026,month:8,category:'20.01.01',sum:100}];const pending=stats.expenseBudget(data,{year:'2026',month:'8'});assert.equal(pending.actual.sum,0);assert.equal(pending.accounting.complete,false);assert.equal(pending.difference,null);
  const next={...data,savedReestrs:choose(data)},confirmed=stats.expenseBudget(next,{year:'2026',month:'8'});assert.equal(confirmed.actual.sum,100.01);assert.equal(confirmed.difference,.01);
});

test('opening and saving an unreviewed UIN-only repeat preserves invoice identity on every split allocation',()=>{
  const {data}=fixture(),uin='12345678901234567890',buyerOrganization='Synthetic purchaser';
  for(const [index,entry]of data.savedReestrs.entries())for(const row of entry.rows){row.invoiceNo='DISTINCT-'+index;row.uin=uin;row.buyerOrganization=buyerOrganization;}
  core.validateRegister(data.savedReestrs[0],data);core.validateRegister(data.savedReestrs[1],data);
  assert.equal(accounting.project(data).summary.review.invoices,2);
  const next={...data,savedReestrs:data.savedReestrs.map(entry=>core.buildRegister({...entry,invoices:core.invoices(entry)},data))};
  core.validateChanges(data,next);
  for(const entry of next.savedReestrs)for(const row of entry.rows){assert.equal(row.uin,uin);assert.equal(row.buyerOrganization,buyerOrganization);}
  assert.equal(accounting.project(next).groups.length,1);assert.equal(accounting.project(next).summary.review.invoices,2);assert.equal(stats.project(next).totals.sum,0);
  for(let i=0;i<data.savedReestrs.length;i++)assert.deepEqual(next.savedReestrs[i],data.savedReestrs[i]);
});

test('opening and saving a resolved UIN-only repeat retains the accounting decision and its original identity',()=>{
  const {data}=fixture(),uin='1234567890123456789012345',buyerOrganization='Synthetic purchaser';
  for(const [index,entry]of data.savedReestrs.entries())for(const row of entry.rows){row.invoiceNo='DISTINCT-'+index;row.uin=uin;row.buyerOrganization=buyerOrganization;}
  const confirmed={...data,savedReestrs:choose(data)},before=accounting.project(confirmed),next={...confirmed,savedReestrs:confirmed.savedReestrs.map(entry=>core.buildRegister({...entry,invoices:core.invoices(entry)},confirmed))};
  core.validateChanges(confirmed,next);
  assert.deepEqual(accounting.project(next),before);assert.equal(stats.project(next).totals.sum,100.01);
  for(let i=0;i<next.savedReestrs.length;i++){assert.deepEqual(next.savedReestrs[i].registryAccounting,confirmed.savedReestrs[i].registryAccounting);for(const row of next.savedReestrs[i].rows){assert.equal(row.uin,uin);assert.equal(row.buyerOrganization,buyerOrganization);}}
});
test('browser and Node agree on duplicate groups and confirmed financial totals with the shipped dependency order',()=>{
  const {data}=fixture(),context=vm.createContext({});for(const name of ['registry-import','request-fingerprint','registry-accounting','registry-statistics'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',name+'.js'),'utf8'),context);
  assert.equal(JSON.stringify(context.RegistryAccounting.project(data)),JSON.stringify(accounting.project(data)));assert.equal(JSON.stringify(context.RegistryStatistics.project(data)),JSON.stringify(stats.project(data)));
  const next={...data,savedReestrs:choose(data)};assert.equal(JSON.stringify(context.RegistryStatistics.project(next)),JSON.stringify(stats.project(next)));
});
for(const mode of ['sqlite','json'])test(mode+': canonical commit, durable receipt and retry preserve originals and do not count the chosen invoice twice',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-registry-accounting-integration-')),owned=fs.lstatSync(directory);t.after(()=>{const target=path.resolve(directory),current=fs.lstatSync(target);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('tvs-registry-accounting-integration-'));assert.equal(current.isSymbolicLink(),false);assert.equal(current.ino,owned.ino);fs.rmSync(target,{recursive:true,force:true});});
  const {data,originals}=fixture();if(mode==='sqlite')sqlite.create(directory,{data});else storage.createJson(directory,{data});
  fs.mkdirSync(path.join(directory,'import-sources'),{recursive:true});for(const original of originals)fs.writeFileSync(path.join(directory,'import-sources',original.source.id),original.bytes);
  const snapshot=storage.readSnapshot(directory),request={databaseToken:snapshot.databaseToken,base:{savedReestrs:snapshot.revisions.savedReestrs},operation:{id:'synthetic-accounting-'+mode},sections:{savedReestrs:choose(snapshot.data)}},options={principal:{id:'test-admin',name:'Synthetic reviewer',role:'admin'},compactAck:true};
  const saved=storage.writeSections(directory,request,options);assert.equal(saved.ok,true,JSON.stringify(saved));const after=storage.readSnapshot(directory);assert.equal(stats.project(after.data).totals.sum,100.01);assert.equal(after.revisions.savedReestrs,snapshot.revisions.savedReestrs+1);
  const replay=storage.writeSections(directory,request,options);assert.equal(replay.ok,true,JSON.stringify(replay));const final=storage.readSnapshot(directory);assert.equal(final.revisions.savedReestrs,after.revisions.savedReestrs);assert.deepEqual(final.data.savedReestrs,after.data.savedReestrs);
  for(const name of Object.keys(snapshot.data))if(!['savedReestrs','auditLog'].includes(name))assert.deepEqual(final.data[name],snapshot.data[name],name);
  for(const original of originals)assert.deepEqual(fs.readFileSync(path.join(directory,'import-sources',original.source.id)),original.bytes);
});
