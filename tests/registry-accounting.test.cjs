'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const accounting=require('../assets/core/registry-accounting.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function register(id,options={}){
  const amount=options.sum??100.01,invoiceId=options.invoiceId??String(id)+':invoice:0',parts=options.parts||[amount];
  return {id,kind:'payment-registry',registryVersion:1,number:options.number??String(id),date:'2026-10-20',workspace:options.workspace||'registries',title:'Synthetic '+id,source:{sha256:'synthetic-'+id,table:'Sheet',name:String(id)+'.pdf'},rowCount:1,totalSum:amount,declaredTotal:amount,...(options.buyerOrganization?{buyerOrganization:options.buyerOrganization}:{}),rows:parts.map((sum,index)=>({id:String(id)+':'+index,registryInvoiceId:invoiceId,registryInvoiceSum:amount,registryAllocationKind:'other',registryExpenseType:'other',sum,supplier:options.supplier??'ООО «Synthetic»',invoiceNo:options.invoiceNo??'0007/1',date:options.invoiceDate??'2026-10-01',description:options.description??'Synthetic source facts',osn:options.osn??'',org:options.org??'Synthetic recipient',allocationLabel:'Synthetic recipient '+index,...(options.invoiceBuyer?{buyerOrganization:options.invoiceBuyer}:{})}))};
}
const database=(...entries)=>({savedReestrs:entries,vehicles:[],generators:[],drivers:[]});
function decide(db,group,keys=[group.members[0].key],separate=false,reason='Synthetic checked original'){
  return {...db,savedReestrs:accounting.resolve(db,{groupId:group.id,basis:group.basis,includedKeys:keys,separate,reason})};
}
function withoutMetadata(entries){return entries.map(({registryAccounting,...entry})=>entry);}

test('split allocations are one invoice and a singleton is included without changing any fact',()=>{
  const entry=register('A',{parts:[40,60.01]}),db=database(entry),before=clone(db),report=accounting.project(db);
  assert.deepEqual(report.summary,{included:{invoices:1,sum:100.01},excluded:{invoices:0,sum:0},review:{invoices:0,sum:0}});
  assert.equal(report.invoices.length,1);assert.equal(report.groups.length,0);assert.deepEqual(db,before);
  assert.ok(entry.rows.every(row=>accounting.included(db,entry,row,report)));
});

test('the same invoice across workspaces holds every copy until explicit single selection',()=>{
  const first=register('A',{parts:[40,60.01]}),second=register('B',{workspace:'logistics'}),db=database(first,second),report=accounting.project(db),group=report.groups[0];
  assert.equal(group.kind,'invoice');assert.equal(group.resolved,false);assert.equal(report.summary.included.sum,0);assert.equal(report.summary.review.sum,200.02);
  const next=decide(db,group,[accounting.invoiceKey('A','A:invoice:0')]),resolved=accounting.project(next);
  assert.deepEqual(resolved.summary,{included:{invoices:1,sum:100.01},excluded:{invoices:1,sum:100.01},review:{invoices:0,sum:0}});
  assert.equal(resolved.groups[0].resolved,true);assert.deepEqual(withoutMetadata(next.savedReestrs),db.savedReestrs);
  assert.ok(next.savedReestrs[0].rows.every(row=>accounting.included(next,next.savedReestrs[0],row,resolved)));
  assert.ok(next.savedReestrs[1].rows.every(row=>!accounting.included(next,next.savedReestrs[1],row,resolved)));
  assert.doesNotThrow(()=>accounting.validateChanges(db,next));
});

test('a corrected amount still conflicts with the original invoice and does not become a new expense',()=>{
  const db=database(register('A',{sum:100.01}),register('B',{sum:101.02})),report=accounting.project(db);
  assert.equal(report.groups.length,1);assert.equal(report.summary.review.sum,201.03);
  const next=decide(db,report.groups[0],[accounting.invoiceKey('B','B:invoice:0')]);
  assert.equal(accounting.project(next).summary.included.sum,101.02);
});

test('versions first require selecting the current whole registry, then overlapping invoices are checked',()=>{
  const first=register('A',{number:'33/1'}),second=register('B',{number:'33-1',sum:101.02}),third=register('C'),db=database(first,second,third),initial=accounting.project(db);
  assert.equal(initial.groups.length,1);assert.equal(initial.groups[0].kind,'version');assert.equal(initial.summary.review.invoices,2);assert.equal(initial.summary.included.invoices,1);
  const afterVersion=decide(db,initial.groups[0],[accounting.registerKey('B')]),report=accounting.project(afterVersion);
  assert.equal(report.invoices.find(row=>row.registerId==='A').state,'excluded');assert.equal(report.invoices.find(row=>row.registerId==='B').state,'review');assert.equal(report.invoices.find(row=>row.registerId==='C').state,'review');
  const invoiceGroup=report.groups.find(group=>group.kind==='invoice'),afterInvoice=decide(afterVersion,invoiceGroup,[accounting.invoiceKey('B','B:invoice:0')]);
  assert.equal(accounting.project(afterInvoice).summary.included.sum,101.02);assert.equal(accounting.project(afterInvoice).summary.excluded.sum,200.02);
});

test('explicit separate obligations are possible only with a reason and distinct selection',()=>{
  const db=database(register('A'),register('B')),group=accounting.project(db).groups[0],keys=group.members.map(member=>member.key);
  assert.throws(()=>accounting.resolve(db,{groupId:group.id,includedKeys:keys,separate:false,reason:'Checked'}),error=>error.code==='REGISTRY_DOUBLE_COUNT');
  assert.throws(()=>accounting.resolve(db,{groupId:group.id,includedKeys:keys,separate:true,reason:' '}),/основание/);
  const next=decide(db,group,keys,true,'Different independently confirmed obligations'),report=accounting.project(next);
  assert.equal(report.summary.included.sum,200.02);assert.equal(report.summary.review.invoices,0);assert.equal(report.groups[0].separate,true);
  assert.throws(()=>accounting.resolve(db,{groupId:group.id,includedKeys:[keys[0],keys[0]],separate:true,reason:'Checked'}));
});

test('an explicit buyer distinguishes obligations; recipient organizations cannot bypass duplicates',()=>{
  const twoBuyers=database(register('A',{buyerOrganization:'ООО А',number:'12'}),register('B',{buyerOrganization:'ООО Б',number:'12'}));
  assert.equal(accounting.project(twoBuyers).groups.length,0);assert.equal(accounting.project(twoBuyers).summary.included.invoices,2);
  const invoiceBuyers=database(register('A',{invoiceBuyer:'ООО А',number:'12'}),register('B',{invoiceBuyer:'ООО Б',number:'12'}));
  assert.equal(accounting.project(invoiceBuyers).groups.length,0);
  const recipients=database(register('A',{org:'ООО А'}),register('B',{org:'ООО Б'}));
  assert.equal(accounting.project(recipients).groups.length,1);assert.equal(accounting.project(recipients).summary.review.invoices,2);
  recipients.savedReestrs[0].org='A';recipients.savedReestrs[1].org='B';
  assert.equal(accounting.project(recipients).summary.review.invoices,2);
});

test('buyer formatting is normalized conservatively and an unknown buyer does not hide a possible copy',()=>{
  const db=database(register('A',{buyerOrganization:'ООО «ИКГ»'}),register('B',{buyerOrganization:'ООО ИКГ'}));
  assert.equal(accounting.project(db).summary.review.invoices,2);
  delete db.savedReestrs[1].buyerOrganization;
  assert.equal(accounting.project(db).summary.review.invoices,2);
});

test('identical invoice or registry numbers in independent buyer scopes have distinct resolvable groups',()=>{
  for(const kind of ['invoice','version']){
    const entries=['A1','A2','B1','B2'].map(id=>register(id,{buyerOrganization:id[0]==='A'?'ООО А':'ООО Б',...(kind==='version'?{number:'same'}:{})}));
    const db=database(...entries),report=accounting.project(db);
    assert.equal(report.groups.length,2);assert.notEqual(report.groups[0].id,report.groups[1].id);
    let next=decide(db,report.groups[0]);const remaining=accounting.project(next).groups.find(group=>!group.resolved);next=decide(next,remaining);
    assert.equal(accounting.project(next).summary.included.invoices,2);assert.equal(accounting.project(next).summary.excluded.invoices,2);assert.ok(accounting.project(next).groups.every(group=>group.resolved));
  }
});

test('УИН is globally unique across suppliers, buyers and changed amounts; arbitrary account digits are not УИН',()=>{
  const uin='18810416260101000001',other='18810416260101000002';
  const db=database(register('A',{supplier:'Supplier A',invoiceNo:'1',buyerOrganization:'A',description:'Штраф УИН: '+uin}),register('B',{supplier:'Supplier B',invoiceNo:'2',buyerOrganization:'B',sum:200,description:'штраф\nУИН № '+uin}));
  assert.equal(accounting.project(db).summary.review.invoices,2);
  db.savedReestrs[1].rows[0].description='УИН '+other;assert.equal(accounting.project(db).groups.length,0);
  db.savedReestrs[1].rows[0].description='Расчётный счет '+uin;assert.equal(accounting.project(db).groups.length,0);
  db.savedReestrs[1].rows[0].description='УИН '+uin+'12345';db.savedReestrs[0].rows[0].description='УИН '+uin+'12345';assert.equal(accounting.project(db).groups.length,1);
});

test('overlapping invoice and УИН identities form one group, avoiding partial duplicate chain decisions',()=>{
  const uin='18810416260101000001',a=register('A'),b=register('B',{description:'УИН '+uin}),c=register('C',{invoiceNo:'different',description:'УИН '+uin});
  const report=accounting.project(database(a,b,c));assert.equal(report.groups.length,1);assert.equal(report.groups[0].members.length,3);assert.equal(report.summary.review.sum,300.03);
});

test('missing identities and equal amounts alone do not make unrelated invoices duplicates',()=>{
  const db=database(register('A',{supplier:'',invoiceNo:'',invoiceDate:''}),register('B',{supplier:'',invoiceNo:'',invoiceDate:''}));
  assert.equal(accounting.project(db).groups.length,0);assert.equal(accounting.project(db).summary.included.sum,200.02);
  db.savedReestrs[0].rows[0].invoiceNo='0007';db.savedReestrs[1].rows[0].invoiceNo='7';
  for(const entry of db.savedReestrs){entry.rows[0].supplier='Same';entry.rows[0].date='2026-10-01';}
  assert.equal(accounting.project(db).groups.length,0);
});

test('a missing date holds matching supplier/number copies without guessing a source date',()=>{
  for(const secondDate of ['', '2026-10-01']){
    const db=database(register('A',{invoiceDate:''}),register('B',{invoiceDate:secondDate,sum:101.02})),before=clone(db),report=accounting.project(db);
    assert.equal(report.groups.length,1);assert.equal(report.summary.review.invoices,2);assert.equal(report.summary.review.sum,201.03);assert.deepEqual(db,before);
  }
  const knownDates=database(register('A',{invoiceDate:'2026-10-01'}),register('B',{invoiceDate:'2026-10-02'}));assert.equal(accounting.project(knownDates).groups.length,0);assert.equal(accounting.project(knownDates).summary.included.invoices,2);
  const missingNumbers=database(register('A',{invoiceNo:'',invoiceDate:''}),register('B',{invoiceNo:'',invoiceDate:''}));assert.equal(accounting.project(missingNumbers).groups.length,0);
});

test('filling a previously missing invoice date keeps the review identity and requires a new basis',()=>{
  const db=database(register('A',{invoiceDate:''}),register('B')),group=accounting.project(db).groups[0],resolved=decide(db,group),filled=clone(resolved);
  filled.savedReestrs[0].rows[0].date='2026-10-01';
  const report=accounting.project(filled);assert.equal(report.groups.length,1);assert.equal(report.groups[0].id,group.id);assert.notEqual(report.groups[0].basis,group.basis);assert.equal(report.summary.review.invoices,2);
  const checked=decide(filled,report.groups[0]);assert.equal(accounting.project(checked).summary.included.invoices,1);assert.equal(accounting.project(checked).summary.review.invoices,0);
});

test('adding a new duplicate invalidates the group basis and all prior decisions without guessing a winner',()=>{
  const db=database(register('A'),register('B')),initial=accounting.project(db).groups[0],resolved=decide(db,initial),added={...resolved,savedReestrs:[...resolved.savedReestrs,register('C')]},report=accounting.project(added);
  assert.equal(report.groups[0].id,initial.id);assert.notEqual(report.groups[0].basis,initial.basis);assert.equal(report.summary.review.invoices,3);assert.equal(report.summary.included.sum,0);
  assert.doesNotThrow(()=>accounting.validateChanges(resolved,added));
  assert.throws(()=>accounting.resolve(added,{groupId:initial.id,basis:initial.basis,includedKeys:initial.members.map(member=>member.key).slice(0,1),separate:false,reason:'Old stale form'}),/изменились/);
});

test('correcting sum or source facts requires rereview, while merely editing allocations does not',()=>{
  const db=database(register('A'),register('B')),resolved=decide(db,accounting.project(db).groups[0]),changed=clone(resolved);
  changed.savedReestrs[0].rows[0].allocationLabel='Another recipient';changed.savedReestrs[0].rows[0].org='Other recipient';
  assert.equal(accounting.project(changed).summary.included.invoices,1);
  changed.savedReestrs[0].rows[0].registryInvoiceSum=100.02;changed.savedReestrs[0].rows[0].sum=100.02;
  assert.equal(accounting.project(changed).summary.review.invoices,2);
  const changedSource=clone(resolved);changedSource.savedReestrs[0].source.sha256='Different original';assert.equal(accounting.project(changedSource).summary.review.invoices,2);
});

test('changed invoice identity invalidates a decision even when it removes the old duplicate group',()=>{
  const db=database(register('A'),register('B')),resolved=decide(db,accounting.project(db).groups[0]),changed=clone(resolved);
  changed.savedReestrs[0].rows[0].invoiceNo='Another invoice';
  const report=accounting.project(changed);assert.equal(report.groups.length,1);assert.equal(report.summary.review.invoices,2);assert.equal(report.groups[0].stale,true);
  const checked=decide(changed,report.groups[0],report.groups[0].members.map(member=>member.key),true,'Corrected source identities confirm separate obligations');
  assert.equal(accounting.project(checked).summary.included.invoices,2);assert.equal(accounting.project(checked).groups[0].resolved,true);
});

test('removing a former group member leaves a resolvable stale review rather than resurrecting a rejected copy',()=>{
  const db=database(register('A'),register('B')),resolved=decide(db,accounting.project(db).groups[0],[accounting.invoiceKey('A','A:invoice:0')]);
  const remaining={...resolved,savedReestrs:resolved.savedReestrs.filter(entry=>entry.id==='B')},report=accounting.project(remaining);
  assert.equal(report.summary.review.invoices,1);assert.equal(report.groups[0].members.length,1);assert.equal(report.groups[0].stale,true);
  assert.equal(accounting.project(decide(remaining,report.groups[0])).summary.included.invoices,1);
});

test('renaming a registry version cannot silently resurrect a previously excluded complete version',()=>{
  const db=database(register('A',{number:'same'}),register('B',{number:'same'})),resolved=decide(db,accounting.project(db).groups[0],[accounting.registerKey('A')]),changed=clone(resolved);
  changed.savedReestrs[1].number='Different registry';
  const report=accounting.project(changed);assert.equal(report.summary.review.invoices,2);assert.equal(report.groups[0].kind,'version');assert.equal(report.groups[0].stale,true);
  const checked=decide(changed,report.groups[0],[accounting.registerKey('A')]);assert.equal(accounting.project(checked).summary.included.invoices,1);
});

test('a changed former member remains held when a new copy recreates its old natural group identity',()=>{
  const db=database(register('A'),register('B')),resolved=decide(db,accounting.project(db).groups[0],[accounting.invoiceKey('B','B:invoice:0')]),changed=clone(resolved);
  changed.savedReestrs[0].rows[0].invoiceNo='Corrected identity';changed.savedReestrs.push(register('C'));
  const report=accounting.project(changed);assert.equal(report.groups.length,1);assert.equal(report.groups[0].members.length,3);assert.equal(report.summary.review.invoices,3);assert.equal(report.summary.included.sum,0);
  const next=decide(changed,report.groups[0],[accounting.invoiceKey('B','B:invoice:0')]);assert.equal(accounting.project(next).summary.included.invoices,1);assert.equal(accounting.project(next).summary.excluded.invoices,2);
  const versions=database(register('A',{number:'same'}),register('B',{number:'same'})),picked=decide(versions,accounting.project(versions).groups[0],[accounting.registerKey('B')]),renamed=clone(picked);
  renamed.savedReestrs[0].number='Renamed';renamed.savedReestrs.push(register('C',{number:'same'}));
  assert.equal(accounting.project(renamed).summary.review.invoices,3);assert.equal(accounting.project(renamed).groups[0].members.length,3);
});

test('single-copy decisions store each registry member once rather than replicate all peer keys',()=>{
  const db=database(...Array.from({length:12},(_,index)=>register('R'+index))),group=accounting.project(db).groups[0],next=decide(db,group);
  assert.equal(next.savedReestrs.reduce((count,entry)=>count+entry.registryAccounting.decisions[0].memberKeys.length,0),12);
  assert.equal(accounting.project(next).summary.included.invoices,1);
});

test('typed registry and invoice identities do not collide and a zero amount remains known',()=>{
  const first=register(0,{sum:0,invoiceId:'0'}),second=register('0',{sum:0,invoiceId:0,number:'other'});second.source.sha256='Different source';
  const db=database(first,second),report=accounting.project(db);assert.notEqual(accounting.invoiceKey(0,'0'),accounting.invoiceKey('0',0));assert.equal(report.invoices.length,2);assert.equal(report.summary.review.sum,0);
  const next=decide(db,report.groups[0],[accounting.invoiceKey('0',0)]),included=accounting.project(next).invoices.find(row=>row.state==='included');assert.equal(included.registerId,'0');assert.equal(included.invoiceId,0);
});

test('group identity and cryptographic basis are independent of array ordering and hide source facts',()=>{
  const db=database(register('A'),register('B')),report=accounting.project(db),reverse=accounting.project({...db,savedReestrs:[...db.savedReestrs].reverse()});
  assert.equal(report.groups[0].id,reverse.groups[0].id);assert.equal(report.groups[0].basis,reverse.groups[0].basis);
  assert.match(report.groups[0].id,/^invoice:sha256:[0-9a-f]{64}$/);assert.match(report.groups[0].basis,/^sha256:[0-9a-f]{64}$/);assert.doesNotMatch(report.groups[0].basis,/Synthetic|0007/);
});

test('raw writes cannot invent a decision, drop one, omit a participant, or count copies twice',()=>{
  const db=database(register('A'),register('B')),resolved=decide(db,accounting.project(db).groups[0]);
  const missing=clone(resolved);delete missing.savedReestrs[0].registryAccounting;assert.throws(()=>accounting.validateChanges(db,missing),/всех документов/);
  const dropped=clone(resolved);delete dropped.savedReestrs[0].registryAccounting;assert.throws(()=>accounting.validateChanges(resolved,dropped),/потеряно/);
  const droppedOne=clone(resolved);droppedOne.savedReestrs[0].registryAccounting.decisions=[];assert.throws(()=>accounting.validateChanges(resolved,droppedOne),/нельзя удалять/);
  const fabricated=clone(resolved);for(const entry of fabricated.savedReestrs)entry.registryAccounting.decisions[0].basis='sha256:'+'0'.repeat(64);assert.throws(()=>accounting.validateChanges(resolved,fabricated),/изменились/);
  const both=clone(resolved);for(const entry of both.savedReestrs)entry.registryAccounting.decisions[0].includedKeys=accounting.project(db).groups[0].members.map(member=>member.key);assert.throws(()=>accounting.validateChanges(resolved,both),error=>error.code==='REGISTRY_DOUBLE_COUNT');
  const empty=database(register('only',{invoiceNo:'distinct'}));empty.savedReestrs[0].registryAccounting=clone(resolved.savedReestrs[0].registryAccounting);assert.throws(()=>accounting.validateChanges(database(),empty),/изменились/);
  const fakeGroup=clone(resolved);for(const entry of fakeGroup.savedReestrs)entry.registryAccounting.decisions[0].groupId='invoice:sha256:'+'0'.repeat(64);assert.throws(()=>accounting.validateChanges(db,fakeGroup),/изменились/);
});

test('malformed metadata, foreign members, duplicate keys and missing grounds are rejected',()=>{
  const db=database(register('A'),register('B')),resolved=decide(db,accounting.project(db).groups[0]);
  for(const change of [meta=>meta.version=2,meta=>meta.extra=true,meta=>meta.decisions[0].reason='',meta=>meta.decisions[0].extra='unknown',meta=>meta.decisions.push(clone(meta.decisions[0])),meta=>meta.decisions[0].includedKeys=['not a member']]){
    const next=clone(resolved);for(const entry of next.savedReestrs)change(entry.registryAccounting);assert.throws(()=>accounting.validateChanges(db,next),error=>error.code==='REGISTRY_ACCOUNTING');
  }
});

test('authoritative server states survive hidden peers and missing view members fail closed',()=>{
  const entry=register('visible');entry.registryAccountingView={version:1,restricted:true,invoices:[{invoiceId:'visible:invoice:0',state:'review',reason:'Requires administrator review'}]};
  const db=database(entry);assert.equal(accounting.project(db).summary.review.invoices,1);assert.equal(accounting.included(db,entry,entry.rows[0]),false);
  assert.equal(accounting.project(db,{ignoreView:true}).summary.included.invoices,1);
  entry.registryAccountingView.invoices[0].state='excluded';assert.equal(accounting.project(db).summary.excluded.invoices,1);
  entry.registryAccountingView.invoices=[];assert.equal(accounting.project(db).summary.review.invoices,1);
  entry.registryAccountingView.invoices=[{invoiceId:'visible:invoice:0',state:'invented'}];assert.equal(accounting.project(db).summary.review.invoices,1);
});

test('restricted accounting groups cannot be resolved from a partial browser projection',()=>{
  const db=database(register('A'),register('B'));db.savedReestrs[0].registryAccountingView={version:1,restricted:true,invoices:[{invoiceId:'A:invoice:0',state:'review',reason:'Check with administrator'}]};
  const group=accounting.project(db).groups[0];assert.equal(group.restricted,true);assert.throws(()=>decide(db,group),/доступ ко всем/);
});

test('browser and server compute the same groups, cents and signatures using the shared SHA256',()=>{
  const context=vm.createContext({});for(const file of ['request-fingerprint.js','registry-import.js','registry-accounting.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core',file),'utf8'),context);
  const db=database(register('A'),register('B',{sum:101.02}));
  assert.equal(JSON.stringify(context.RegistryAccounting.project(db)),JSON.stringify(accounting.project(db)));
});
