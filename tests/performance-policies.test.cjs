'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const policies=require('../assets/core/platform-policies.js');

// Preserve the original independent pairwise/original-order algorithms as an
// oracle. Other policy modules remain real production modules in both runs.
function legacyOracle(){
 const file=path.resolve(__dirname,'../assets/core/platform-policies.js');let source=fs.readFileSync(file,'utf8');
 const replacements=[
  ["const jobs = rows(db,'dispatchJobs'), dispatchIndex=dispatchOverlapPeers(jobs);","const jobs = rows(db,'dispatchJobs'); const overlap=(a,b)=>date(a.start,true)&&date(a.end,true)&&date(b.start,true)&&date(b.end,true)&&Date.parse(a.start)<Date.parse(b.end)&&Date.parse(b.start)<Date.parse(a.end);"],
  ['const interval=dispatchIndex.intervals[jobIndex];',''],
  ['if (interval.start===null || interval.end===null || interval.start>=interval.end)',"if (!date(job.start,true) || !date(job.end,true) || Date.parse(job.start) >= Date.parse(job.end))"],
  ['for (const other of dispatchIndex.peers[jobIndex]) {',"for (const other of jobs) { if(other===job||other.id===job.id||other.archived||['cancelled','done','confirmed'].includes(other.status)||!overlap(job,other))continue;"],
  ['const stockAt = partStockIndex(movements);',"const stockAt = (partId, until) => movements.filter(row => row.partId === partId && !row.cancelled && !row.deleted && date(row.date,false) && row.date <= until).reduce((total,row) => total + (['receipt','return'].includes(row.kind) ? 1 : -1) * (Number(row.qty) || 0),0);"]
 ];
 for(const [current,original]of replacements){assert.equal(source.split(current).length,2,'Oracle patch must match exactly once: '+current);source=source.replace(current,original);}
 const module={exports:{}};new Function('require','module','exports',source)(createRequire(file),module,module.exports);return module.exports;
}
const old=legacyOracle(),context={today:'2026-10-21',now:'2026-10-21T12:00:00.000Z'};
function fixture(){return {vehicles:[{id:'a',plate:'Synthetic A'},{id:'b',plate:'Synthetic B'}],generators:[{id:'g',name:'Synthetic generator'}],drivers:[{id:'d',name:'Synthetic driver'},{id:'e',name:'Synthetic dual',personnelRoles:['driver','operator']}],parts:[{id:'p',name:'Synthetic part'},{id:'q',name:'Other part'}],dispatchJobs:[],partMovements:[]};}
function same(db,ctx=context){
 const capture=inspect=>{try{return {report:inspect(db,ctx)};}catch(error){return {error:{name:error.name,code:error.code,message:error.message}};}};
 const actual=capture(policies.inspect);assert.deepEqual(actual,capture(old.inspect));return actual;
}
function job(id,status='assigned',extra={}){return {id,status,assetRef:'v:a',driverId:'d',start:'2026-10-22T08:00:00Z',end:'2026-10-22T17:00:00Z',...extra};}
function rng(seed){return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/0x100000000);}

test('indexed dispatch preserves asymmetric statuses, strict IDs, proofs and original issue order',()=>{
 const db=fixture();db.dispatchJobs=[job(7,'done'),job('7','new'),job('assigned','assigned'),job('confirmed','confirmed',{confirmedBy:'Synthetic approver',result:'Done'}),job('cancelled','cancelled'),job('archived','assigned',{archived:true}),job('other-asset','started',{assetRef:'v:b'}),job(undefined,'assigned'),job(undefined,'started')];
 same(db);const overlaps=policies.inspect(db,context).issues.filter(issue=>/OVERLAP$/.test(issue.code));assert.ok(overlaps.some(issue=>issue.recordId===7&&issue.relatedRecordId==='7'));assert.ok(overlaps.some(issue=>issue.recordId==='assigned'&&issue.relatedRecordId==='7'));assert.equal(overlaps.some(issue=>issue.recordId==='7'),false);assert.equal(overlaps.some(issue=>issue.relatedRecordId===7||issue.relatedRecordId==='confirmed'||issue.relatedRecordId==='cancelled'),false);
});

test('legacy zero/reversed/date-invalid intervals retain the original pair formula and interval errors',()=>{
 const db=fixture();db.dispatchJobs=[job('normal'),job('point','assigned',{start:'2026-10-22T12:00:00Z',end:'2026-10-22T12:00:00Z'}),job('reversed','started',{start:'2026-10-22T14:00:00Z',end:'2026-10-22T10:00:00Z'}),job('invalid','assigned',{start:'2026-02-30T12:00:00Z'}),job('touching','assigned',{start:'2026-10-22T17:00:00Z',end:'2026-10-22T18:00:00Z'}),job('timezone','assigned',{start:'2026-10-22T11:00:00+03:00',end:'2026-10-22T20:00:00+03:00'})];
 same(db);const issues=policies.inspect(db,context).issues;assert.ok(issues.some(issue=>issue.recordId==='point'&&issue.code==='DISPATCH_ASSET_OVERLAP'));assert.ok(issues.some(issue=>issue.recordId==='reversed'&&issue.code==='DISPATCH_ASSET_OVERLAP'));assert.equal(issues.some(issue=>issue.recordId==='invalid'&&/OVERLAP/.test(issue.code)),false);assert.equal(issues.some(issue=>issue.recordId==='normal'&&issue.relatedRecordId==='touching'),false);
});

test('stock prefix retains integer legacy signs and fallback retains exact decimal/unsafe addition order',()=>{
 const db=fixture();db.partMovements=[
  {id:'large-late',partId:'p',date:'2026-10-03',kind:'receipt',qty:1e16},
  {id:'large-early',partId:'p',date:'2026-10-01',kind:'issue',qty:1e16},
  {id:'small-middle',partId:'p',date:'2026-10-02',kind:'receipt',qty:1},
  {id:'decimal-late',partId:'q',date:'2026-10-03',kind:'issue',qty:0.3},
  {id:'decimal-early',partId:'q',date:'2026-10-01',kind:'receipt',qty:0.1},
  {id:'decimal-middle',partId:'q',date:'2026-10-02',kind:'issue',qty:0.2},
  {id:'numeric-string',partId:'q',date:'2026-10-04',kind:'receipt',qty:'0.1'},
  {id:'invalid-kind',partId:'q',date:'2026-10-01',kind:'legacy-kind',qty:'2'},
  {id:'negative-legacy',partId:'q',date:'2026-10-01',kind:'return',qty:-1},
  {id:'deleted',partId:'q',date:'2026-10-01',kind:'receipt',qty:200,deleted:true},
  {id:'invalid-date',partId:'q',date:'2026-02-30',kind:'receipt',qty:200}
 ];same(db);same(db,{...context,today:'2026-10-02'});same(db,{now:'invalid-clock'});
 const special=fixture();special.partMovements=[{id:'inf',partId:undefined,date:'2026-10-01',kind:'receipt',qty:Infinity},{id:'minus-inf',partId:undefined,date:'2026-10-01',kind:'issue',qty:Infinity},{id:'nan',partId:NaN,date:'2026-10-01',kind:'issue',qty:1},{id:'finite',partId:null,date:'2026-10-02',kind:'issue',qty:'4'}];same(special);
});

test('deterministic randomized valid and damaged legacy snapshots produce identical complete reports',()=>{
 const random=rng(0x5a17),pick=list=>list[Math.floor(random()*list.length)];
 const stamps=['2026-10-22T08:00:00Z','2026-10-22T12:00:00Z','2026-10-22T17:00:00Z','2026-10-23T08:00:00+03:00','2026-02-30T12:00:00Z','2026-10-22T24:00:00Z','bad',null,712];
 let reports=0;for(let run=0;run<300;run++){
  const db=fixture(),count=Math.floor(random()*24);
  for(let index=0;index<count;index++)db.dispatchJobs.push(job(pick([index,'job-'+index,7,'7',undefined]),pick(['new','assigned','started','done','confirmed','cancelled','legacy']),{assetRef:pick(['v:a','v:b','g:g','',null,7,'7',NaN]),driverId:pick(['d','e','',null,undefined,NaN,7,'7']),start:pick(stamps),end:pick(stamps),archived:random()<0.1,confirmedBy:random()<0.5?'Synthetic approver':'',result:random()<0.5?'Synthetic result':''}));
  for(let index=0;index<Math.floor(random()*70);index++)db.partMovements.push({id:'m-'+index,partId:pick(['p','q',undefined,null,NaN,7,'7']),date:pick(['2026-10-01','2026-10-02','2026-10-03','2026-10-21','2026-10-22','2026-02-30','bad',null]),kind:pick(['receipt','return','issue','writeoff','legacy']),qty:pick([0,1,2,7,-1,0.1,0.2,0.3,'2','0.1','bad','',null,NaN,Infinity,1e16]),deleted:random()<0.1,cancelled:random()<0.1});
  try{if(same(db,run%7===0?{today:'2026-10-02'}:context).report)reports++;}catch(error){error.message='Synthetic seed 0x5a17, fixture '+run+': '+error.message;throw error;}
 }
 assert.ok(reports>100,'The oracle must compare complete reports as well as identical legacy failures');
});

test('inspection leaves source arrays and rows unchanged',()=>{
 const db=fixture();db.dispatchJobs=[job('later','assigned',{start:'2026-10-22T12:00:00Z'}),job('earlier')];db.partMovements=[{id:'late',partId:'p',date:'2026-10-03',qty:3,kind:'issue'},{id:'early',partId:'p',date:'2026-10-01',qty:10,kind:'receipt'}];
 const original=JSON.stringify(db);function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}freeze(db);same(db);assert.equal(JSON.stringify(db),original);
});

test('unique dispatch groups and same-part integer stock avoid quadratic field reads',()=>{
 const db=fixture(),count=1200;let startReads=0,quantityReads=0;
 for(let index=0;index<count;index++){
  const row=job('j-'+index,'assigned',{assetRef:'v:unique-'+index,driverId:'unique-'+index});Object.defineProperty(row,'start',{enumerable:true,get(){startReads++;return '2026-10-22T08:00:00Z';}});db.dispatchJobs.push(row);
  const movement={id:'m-'+index,partId:'p',date:'2026-10-'+String(index%20+1).padStart(2,'0'),kind:index%2?'issue':'receipt'};Object.defineProperty(movement,'qty',{enumerable:true,get(){quantityReads++;return 1;}});db.partMovements.push(movement);
 }
 policies.inspect(db,context);assert.ok(startReads<count*40,'dispatch reads must stay linear for distinct groups: '+startReads);assert.ok(quantityReads<count*8,'integer stock quantities must not be reread for each issue: '+quantityReads);
});

test('many new counterparts do not trigger comparisons against one another during the sweep',()=>{
 const db=fixture(),count=800;let idReads=0;
 for(let index=0;index<count;index++){
  const row=job('new-'+index,'new');Object.defineProperty(row,'id',{enumerable:true,get(){idReads++;return 'new-'+index;}});db.dispatchJobs.push(row);
 }
 db.dispatchJobs.push(job('assigned'));
 const result=policies.inspect(db,context),overlaps=result.issues.filter(issue=>/OVERLAP$/.test(issue.code));assert.equal(overlaps.length,count*2);assert.ok(overlaps.every(issue=>issue.recordId==='assigned'));assert.ok(idReads<count*35,'inner-only rows must not be pairwise compared: '+idReads);
});

test('integer stock at adjacent date boundaries and the supplied today exactly matches the original fold',()=>{
 const db=fixture();db.partMovements=[{id:'early-receipt',partId:'p',date:'2026-10-01',kind:'receipt',qty:'5'},{id:'same-day-issue',partId:'p',date:'2026-10-01',kind:'issue',qty:7},{id:'later-receipt',partId:'p',date:'2026-10-02',kind:'receipt',qty:10},{id:'future-issue',partId:'p',date:'2026-10-22',kind:'writeoff',qty:20}];
 for(const today of ['2026-09-30','2026-10-01','2026-10-02','2026-10-21','2026-10-22'])same(db,{today});
});
