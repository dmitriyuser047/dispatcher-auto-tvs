'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const periods=require('../assets/core/period-policy'),policies=require('../assets/core/platform-policies'),documents=require('../assets/core/document-engine'),schema=require('../assets/core/platform-schema'),temporal=require('../assets/core/temporal-policy');
const actor={id:'synthetic',name:'Синтетический проверяющий',role:'admin'},today='2026-10-22',now=today+'T12:00:00.000Z',ctx={id:'period-op',now,today,actor};
const clone=value=>structuredClone(value);
function fixture(extra={}){return {...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYNTHETIC',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:100,norm:10,org:'A'}],tanks:[{id:'t',fuel:'diesel',fuelGrade:'ДТ',balanceInit:100,org:'A'}],parts:[{id:'p',unit:'шт',name:'Синтетическая деталь'}],...extra};}
const action=(scope='fuel',extra={})=>({scope,action:'close',month:'2026-09',reason:'Проверенные исходные факты',...extra});
function close(db,scope='fuel',extra={}){const input=action(scope,extra),review=periods.preview(db,input,{today});assert.equal(review.canApply,true,JSON.stringify(review.issues));input.reviewFingerprint=review.fingerprint;const planCtx={...ctx,id:'period-'+scope+'-'+input.action};const plan=periods.plan(db,input,planCtx);const next={...db,...plan.sections};assert.equal(periods.validateChanges(db,next,{...planCtx,commandIntent:{command:{type:'PeriodAction',version:1,input}}}),true);return next;}
const rejected=(fn,code='PERIOD_CLOSED')=>assert.throws(fn,error=>error.code===code||error.issues?.some(issue=>issue.code===code));

test('three explicit scopes retain legacy fuel-only closure and carry through later months',()=>{
 const db=fixture({fuelPeriods:[{month:'2026-08',closed:true},{month:'2026-09',stockClosed:true},{month:'2026-10',closed:true}]});
 assert.equal(periods.isClosed(db,'fuel','2026-07-01'),true);assert.equal(periods.isClosed(db,'fuel','2026-11'),false);assert.equal(periods.isClosed(db,'finance','2026-09'),false);
 assert.deepEqual(periods.status(db,'fuel','2026-09').protectingMonths,['2026-10']);assert.equal(periods.status(db,'fuel','2026-09').closed,false);assert.equal(periods.status(db,'stock','2026-09').closed,true);
 assert.equal(periods.describe().length,3);assert.ok(!periods.describe('fuel').readSections.includes('payments'));
});

test('canonical close and reopen append trusted history without changing source facts; raw reopen/removal blocked',()=>{
 const db=fixture({records:[{id:'r',date:'2026-09-10',vehicleId:0,km:100,fuelActual:10}],fuelPeriods:[{month:'2026-09',closed:false,recon:{value:17}}]}),original=JSON.stringify(db.records),next=close(db);
 assert.equal(next.fuelPeriods[0].closed,true);assert.equal(next.fuelPeriods[0].closureEvents.events[0].actor.id,actor.id);assert.equal(JSON.stringify(next.records),original);
 assert.equal(JSON.stringify(next.fuelPeriods).includes('Fingerprint'),false);
 for(const rows of [[],[{month:'2026-09',closed:false}],[{...next.fuelPeriods[0],history:[]}]])rejected(()=>periods.validateChanges(next,{...next,fuelPeriods:rows}),'PERIOD_PROOF');
 const reopened=close(next,'fuel',{action:'reopen'});assert.equal(reopened.fuelPeriods[0].closed,false);assert.equal(reopened.fuelPeriods[0].closureEvents.events.length,2);
 assert.equal(periods.validateChanges(db,{...db,fuelPeriods:[...db.fuelPeriods,{month:'2026-10',closed:false,recon:{note:'Только сверка'}}]}),true);
 rejected(()=>periods.validateChanges(db,{...db,fuelPeriods:[...db.fuelPeriods,{month:'2026-10',stockClosed:true}]}),'PERIOD_PROOF');
});

test('close preflight refuses existing real negative fuel and part balances instead of grandfathering them',()=>{
 const db=fixture({records:[{id:'bad',date:'2026-09-01',vehicleId:0,km:0,fuelActual:101}]});assert.equal(policies.validateChanges(db,clone(db),{today,now}),true);
 const review=periods.preview(db,action(),{today});assert.equal(review.canApply,false);assert.ok(review.blockers.some(issue=>/negative|balance|остат|дефиц/i.test(issue.code+' '+issue.message)));
 const stock=fixture({partMovements:[{id:'bad',date:'2026-09-01',partId:'p',kind:'issue',qty:1,reason:'Факт'}]});const check=periods.preview(stock,action('stock'),{today});assert.equal(check.canApply,false);assert.ok(check.blockers.some(issue=>issue.code==='PART_STOCK_DEFICIT'));
});

test('future months and invalid today fail explicitly; review after midnight must be repeated',()=>{
 const db=fixture();rejected(()=>periods.preview(db,action(),{today:'2026-02-30'}),'PERIOD_TODAY');const future=periods.preview(db,action('fuel',{month:'2026-11'}),{today});assert.equal(future.canApply,false);assert.ok(future.blockers.some(issue=>issue.code==='PERIOD_FUTURE'));
 const input=action(),review=periods.preview(db,input,{today});rejected(()=>periods.plan(db,{...input,reviewFingerprint:review.fingerprint},{...ctx,today:'2026-10-23',now:'2026-10-23T12:00:00.000Z'}),'STALE_REVIEW');
});

test('closed fuel retains typed-zero card assignments, old arrays, implicit generator source and all nonzero openings',()=>{
 const db=fixture({fuelPeriods:[{month:'2026-09',closed:true}],fuelCards:[{number:'123',assignments:[{from:'2026-09-01',vehicleId:0,org:'A'}]}],generators:[{id:'g',tankId:'t',fuelBalance:0}],genRecords:[{id:'g1',generatorId:'g',date:'2026-09-10',fuelIssued:5}]});
 for(const patch of [{fuelCards:[{...db.fuelCards[0],assignments:[{from:'2026-09-01',vehicleId:'',org:'A'}]}]},{generators:[{...db.generators[0],tankId:'other'}]},{vehicles:[{...db.vehicles[0],fuelBalance:99}]}])rejected(()=>periods.validateChanges(db,{...db,...patch}));
 assert.equal(periods.validateChanges(db,{...db,vehicles:[{...db.vehicles[0],note:'Примечание'}]}),true);
 const duplicates={...db,vehicles:[...db.vehicles,{...db.vehicles[0],fuelBalance:200}]};assert.equal(periods.validateChanges(duplicates,clone(duplicates)),true);rejected(()=>periods.validateChanges(duplicates,{...duplicates,vehicles:[duplicates.vehicles[1],{...duplicates.vehicles[0],fuelBalance:201}]}));
});

test('closed fuel allows unused/future-only cards and zero assets and effective-equivalent dated bridges',()=>{
 const db=fixture({fuelPeriods:[{month:'2026-09',closed:true}],records:[{id:'r',date:'2026-09-10',vehicleId:0,km:100,fuelActual:10}]});
 const future={...db,vehicles:[...db.vehicles,{id:'future',fuelBalance:0},{id:'future-anchor',fuelBalance:0,fuelAccounting:{version:1,from:'2026-10-01',opening:923.537,basis:'Будущее начало'}}],fuelCards:[{number:'unused',assignments:[{from:'2026-10-01',vehicleId:0,org:'B'}]}]};assert.equal(periods.validateChanges(db,future),true);
 const bridged={...db,vehicles:[{...db.vehicles[0],fuelNorms:{version:1,periods:[{id:'bridge',from:'2026-09-01',basis:'Подтверждённая норма',parameters:{norm:10,normCity:null,normHighway:null,normIdle:null}},{id:'future',from:'2026-10-01',basis:'Изменение',parameters:{norm:20,normCity:null,normHighway:null,normIdle:null}}]},orgHistory:[{from:'',to:'2026-09-30',org:'A'},{from:'2026-10-01',to:'',org:'B',basis:'Будущий владелец'}]}]};assert.equal(periods.validateChanges(db,bridged),true);assert.equal(temporal.validateChanges(db,bridged),true);
});

test('stock scope protects historical movement, part dimensions and deletion while future inventory remains editable',()=>{
 const db=fixture({fuelPeriods:[{month:'2026-09',stockClosed:true}],partMovements:[{id:'in',date:'2026-09-10',partId:'p',kind:'receipt',qty:10}]});
 for(const patch of [{partMovements:[]},{partMovements:[{...db.partMovements[0],qty:11}]},{parts:[{...db.parts[0],unit:'л'}]}])rejected(()=>periods.validateChanges(db,{...db,...patch}));
 assert.equal(periods.validateChanges(db,{...db,partMovements:[...db.partMovements,{id:'future',date:'2026-10-01',partId:'p',kind:'issue',qty:1}],parts:[...db.parts,{id:'unused',unit:'шт'}]}),true);
});

test('finance closes expense and cash dates separately, preserving raw paid facts on a later settlement',()=>{
 const db=fixture({fuelPeriods:[{month:'2026-09',financeClosed:true}],payments:[{id:'p',date:'2026-09-10',sum:100,paidAmount:0,paid:false,vehicleId:0}]});
 const settle={action:'settle',section:'payments',id:'p',amount:20,date:'2026-10-20',reason:'Фактическая оплата позже'},review=documents.preview(db,settle,{today});assert.equal(review.canPost,true,JSON.stringify(review.issues));const plan=documents.plan(db,{...settle,reviewFingerprint:review.fingerprint},{...ctx,id:'settle'}),next={...db,...plan.sections};assert.equal(periods.validateChanges(db,next),true);assert.equal(next.payments[0].paidAmount,0);
 const retro={...settle,date:'2026-09-20'};assert.equal(documents.preview(db,retro,{today}).canPost,false);
 for(const patch of [{sum:90},{date:'2026-10-01'}])rejected(()=>periods.validateChanges(db,{...db,payments:[{...db.payments[0],...patch}]}));
});

test('finance protects root date of future corrections and payment fallback attribution without leaking hidden IDs',()=>{
 const db=fixture({fuelPeriods:[{month:'2026-09',financeClosed:true}],payments:[{id:'PRIVATE-PAYMENT',date:'2026-09-10',sum:100,paidAmount:0,vehicleId:0}],assetAssignments:[{id:'a',assetRef:'v:0',from:'2026-09-01',org:'A',site:'X'}]});
 const draft=documents.plan(db,{action:'saveDraft',section:'payments',payload:{date:'2026-10-10',sum:90},correctionOf:{section:'payments',id:'PRIVATE-PAYMENT'},reason:'Исправление'},{...ctx,id:'draft'});const withDraft={...db,...draft.sections};assert.equal(documents.preview(withDraft,{action:'postDraft',section:'payments',draftId:'draft'},{today}).canPost,false);
 assert.throws(()=>periods.validateChanges(db,{...db,assetAssignments:[{...db.assetAssignments[0],org:'B'}]},{readable:['assetAssignments','fuelPeriods']}),error=>error.code==='PERIOD_CLOSED'&&!JSON.stringify(error.issues).includes('PRIVATE-PAYMENT'));
 assert.equal(periods.validateChanges(db,{...db,assetAssignments:[...db.assetAssignments,{id:'future',assetRef:'v:0',from:'2026-10-01',org:'B'}],costProfiles:[{id:'unused',assetRef:'v:unused',salaryRate:99}]}),true);
});

test('closed costs retain actual denominators and effective dated rates, allowing future additions and unchanged-value bridge',()=>{
 const db=fixture({fuelPeriods:[{month:'2026-09',financeClosed:true}],records:[{id:'r',date:'2026-09-10',vehicleId:0,km:100}],costProfiles:[{id:'profile',assetRef:'v:0',salaryRate:10,depreciationRate:null,fuelRate:null,fuelPrice:null}]});
 rejected(()=>periods.validateChanges(db,{...db,records:[{...db.records[0],km:101}]}));rejected(()=>periods.validateChanges(db,{...db,costProfiles:[{...db.costProfiles[0],salaryRate:11}]}));
 const rates={version:1,periods:[{id:'bridge',from:'2026-09-01',basis:'Прежние ставки',parameters:{salaryRate:10,depreciationRate:null,fuelRate:null,fuelPrice:null}},{id:'future',from:'2026-10-01',basis:'Будущие ставки',parameters:{salaryRate:20,depreciationRate:null,fuelRate:null,fuelPrice:null}}]};assert.equal(periods.validateChanges(db,{...db,costProfiles:[{...db.costProfiles[0],ratePeriods:rates}]}),true);
});

test('selected-scope review is equal with private foreign history omitted and plan preserves its exact position',()=>{
 const event={operationId:'finance',scope:'finance',action:'close',reason:'PRIVATE',at:now,actor};const full=fixture({fuelPeriods:[{month:'2026-09',financeClosed:true,closureEvents:{version:1,events:[event]}}]}),filtered={...full,fuelPeriods:[{...full.fuelPeriods[0],closureEvents:{version:1,events:[]}}]},input=action('stock');
 const a=periods.preview(full,input,{today}),b=periods.preview(filtered,input,{today});assert.equal(a.fingerprint,b.fingerprint);const plan=periods.plan(full,{...input,reviewFingerprint:b.fingerprint},ctx);assert.deepEqual(plan.sections.fuelPeriods[0].closureEvents.events[0],event);assert.equal(JSON.stringify(a.history).includes('PRIVATE'),false);
});

test('readonly diagnostics never clone unrelated malformed values or invoke hidden getters',()=>{
 const db=fixture();db.records=[{km:NaN}];db.payments=[{id:'bad',cycle:null}];db.payments[0].cycle=db.payments;
 assert.deepEqual(periods.inspect(db,{readable:['fuelPeriods']}).issues,[]);let invoked=0;Object.defineProperty(db,'fuelPeriods',{get(){invoked++;throw Error('private');},enumerable:true});assert.deepEqual(periods.inspect(db,{readable:['records']}).issues,[]);assert.equal(invoked,0);assert.equal(periods.inspect(db,{readable:['fuelPeriods']}).issues[0].code,'PERIOD_JSON');assert.equal(invoked,0);
});

test('finance preflight exposes invalid actual source date/amount and preserves readable legacy dot dates',()=>{
 for(const repairs of [[{id:'bad-date',invoiceDate:'bad',cost:100}],[{id:'bad-money',invoiceDate:'2026-09-10',cost:null}]]){const review=periods.preview(fixture({repairs}),action('finance'),{today});assert.equal(review.canApply,false);assert.ok(review.blockers.some(item=>/PERIOD_SOURCE_(DATE|AMOUNT)/.test(item.code)));}
 const legacy=fixture({repairs:[{id:'old',invoiceDate:'10.09.2026',cost:'100'}]});assert.equal(periods.preview(legacy,action('finance'),{today}).canApply,true);
 const future=fixture({fuelPeriods:[{month:'2026-09',financeClosed:true}],repairs:[{id:'future',invoiceDate:'10.10.2026',cost:'100'}]});assert.equal(periods.validateChanges(future,{...future,repairs:[{...future.repairs[0],cost:120}]}),true);
 const planned=fixture({vehicleTo:[{id:'plan',planned:true,cost:25000}]});assert.equal(periods.preview(planned,action('finance'),{today}).canApply,true);
});

test('a source tank deficit blocks fuel close even when vehicles themselves have no negative balance',()=>{
 const db=fixture({generators:[{id:'g',fuel:'diesel',fuelBalance:0,tankId:'t',norm:0}],genRecords:[{id:'r',date:'2026-09-10',generatorId:'g',fuelIssued:101,hours:0}]});
 const review=periods.preview(db,action(),{today});assert.equal(review.canApply,false);assert.ok(review.blockers.some(item=>item.code==='FUEL_STOCK_DEFICIT'&&item.recordId==='t'));
});

test('open reconciliation can materialize absent false flags but never remove protected event history',()=>{
 const db=fixture({fuelPeriods:[{month:'2026-09',reconciliation:{note:'Открытый месяц'}}]});assert.equal(periods.validateChanges(db,{...db,fuelPeriods:[{...db.fuelPeriods[0],closed:false,stockClosed:false,financeClosed:false,reconciliation:{note:'Уточнённая сверка'}}]}),true);
 const damaged=fixture({fuelPeriods:[{month:'2026-09',closureEvents:{version:9,events:[]}}]});assert.equal(periods.status(damaged,'fuel','2026-09').diagnostics[0].code,'PERIOD_HISTORY');const review=periods.preview(damaged,action(),{today});assert.equal(review.canApply,false);
});

test('real browser UMD load order gives the same selected-scope review and pure plan as CommonJS',()=>{
 const context=vm.createContext({}),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),files=[...html.matchAll(/<script src="(assets\/core\/[^\"]+\.js)"><\/script>/g)].map(match=>match[1]);
 for(const file of files){if(file==='assets/core/application-engine.js')continue;vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});}
 const db=fixture({records:[{id:'r',date:'2026-09-10',vehicleId:0,km:100,fuelActual:10}],payments:[{id:0,date:'2026-09-12',sum:100,paidAmount:0}],assetAssignments:[{id:'a',assetRef:'v:0',from:'2026-09-01',org:'A'}]});
 for(const scope of ['fuel','stock','finance']){const input=action(scope),native=periods.preview(db,input,{today}),browser=context.PeriodPolicy.preview(db,input,{today});assert.deepEqual(JSON.parse(JSON.stringify(browser)),native);assert.deepEqual(JSON.parse(JSON.stringify(context.PeriodPolicy.plan(db,{...input,reviewFingerprint:browser.fingerprint},ctx))),periods.plan(db,{...input,reviewFingerprint:native.fingerprint},ctx));}
 assert.equal(Object.isFrozen(context.PeriodPolicy),true);
});

test('fuel close preflight covers every live physical source with missing/bad dates and finite invalid quantities',()=>{
 const definitions={records:{id:'r',vehicleId:0,date:'2026-09-10',km:0,fuelActual:1},genRecords:{id:'g',generatorId:'g',date:'2026-09-10',hours:0,fuelIssued:1,tankId:null},tankIncomes:{id:'in',tankId:'t',date:'2026-09-10',amount:1},fuelPurchases:{id:'purchase',date:'2026-09-10',vehicleId:'valid-vehicle',recordId:'valid-record',sourceOrg:'A',qty:1,sum:10,grade:'ДТ'},monthlyFuel:{id:'month',vehicleId:0,month:'2026-09',liters:1},fuelMovements:{id:'movement',date:'2026-09-10',kind:'receipt',toTankId:'t',qty:1,reason:'Проверенный внешний приход'}};
 const field={records:'fuelActual',genRecords:'fuelIssued',tankIncomes:'amount',fuelPurchases:'qty',monthlyFuel:'liters',fuelMovements:'qty'};
 for(const [section,source]of Object.entries(definitions)){
  const db=fixture({[section]:[source],generators:[{id:'g',fuel:'diesel',fuelBalance:0,norm:0}],...(section==='fuelPurchases'?{vehicles:[{id:'valid-vehicle',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:100,norm:10,org:'A'}],records:[{id:'valid-record',vehicleId:'valid-vehicle',date:'2026-09-10',km:0,fuelActual:0,fuelIssued:1}]}:section==='monthlyFuel'?{records:[{id:'valid-month-record',vehicleId:0,date:'2026-09-10',km:0,fuelActual:0,fuelIssued:1}]}:{})});assert.equal(periods.preview(db,action(),{today}).canApply,true,section+' valid');
  for(const value of [undefined,'bad','2026-02-30']){const row={...source};if(section==='monthlyFuel')value===undefined?delete row.month:row.month=value;else value===undefined?delete row.date:row.date=value;const review=periods.preview({...db,[section]:[row]},action(),{today});assert.equal(review.canApply,false,section+' date '+value);assert.ok(review.blockers.some(issue=>issue.code==='PERIOD_SOURCE_DATE'),section);}
  const invalid={...source,[field[section]]:'unknown'},review=periods.preview({...db,[section]:[invalid]},action(),{today});assert.equal(review.canApply,false,section+' quantity');assert.ok(review.blockers.some(issue=>issue.code==='PERIOD_SOURCE_NUMBER'),section);
 }
});

test('finance source-date preflight covers actual cash-cost inputs and denominators without recognizing plans',()=>{
 const definitions={costEntries:{id:'manual',date:'2026-09-10',kind:'expense',assetRef:'v:0',title:'Самостоятельный факт',independent:true,amount:1},fuelPurchases:{id:'purchase',date:'2026-09-10',vehicleId:0,qty:1,sum:10},tankIncomes:{id:'income',date:'2026-09-10',tankId:'t',amount:1,sum:10},records:{id:'r',date:'2026-09-10',vehicleId:0,km:1,fuelSum:10},genRecords:{id:'g',date:'2026-09-10',generatorId:'g',hours:1,fuelSum:10}};
 const field={costEntries:'amount',fuelPurchases:'sum',tankIncomes:'sum',records:'km',genRecords:'hours'};
 for(const [section,source]of Object.entries(definitions)){
  const db=fixture({[section]:[source],generators:[{id:'g',fuel:'diesel',fuelBalance:0,norm:0}]});assert.equal(periods.preview(db,action('finance'),{today}).canApply,true,section+' valid');
  for(const value of [undefined,'bad','2026-02-30']){const row={...source};value===undefined?delete row.date:row.date=value;const review=periods.preview({...db,[section]:[row]},action('finance'),{today});assert.equal(review.canApply,false,section+' date '+value);assert.ok(review.blockers.some(issue=>issue.code==='PERIOD_SOURCE_DATE'));}
  const review=periods.preview({...db,[section]:[{...source,[field[section]]:'unknown'}]},action('finance'),{today});assert.equal(review.canApply,false,section+' number');assert.ok(review.blockers.some(issue=>issue.code==='PERIOD_SOURCE_NUMBER'));
 }
 const plans=fixture({costEntries:[{id:'not-actual',date:'bad',amount:25000,independent:false}],vehicleTo:[{id:'planned',date:'bad',cost:25000,planned:true}],workOrders:[{id:'not-accepted',date:'bad',actualCost:25000,status:'repairing'}]});assert.equal(periods.preview(plans,action('finance'),{today}).canApply,true);
});

test('fuel source sweep respects explicit pre-start facts and does not invent dates for excluded rows',()=>{
 const db=fixture({vehicles:[{id:0,fuel:'diesel',norm:10,fuelBalance:999,fuelAccounting:{version:1,from:'2026-09-01',opening:923.537,basis:'Замер до начала'}}],records:[{id:'outside',vehicleId:0,date:'2026-08-31',km:0,fuelActual:'unknown'}],tankIncomes:[{id:'cancelled',tankId:'t',date:'bad',amount:10,cancelled:true}]});
 assert.equal(periods.preview(db,action(),{today}).canApply,true);
 const future={...db,records:[{id:'future',vehicleId:0,date:'2026-10-01',fuelActual:'unknown'}]};assert.equal(periods.preview(future,action(),{today}).canApply,true);
});

test('typed numeric and string vehicle payment fallbacks remain separate in a closed financial month',()=>{
 const db=fixture({fuelPeriods:[{month:'2026-09',financeClosed:true}],vehicles:[{id:0,org:'NUMERIC'},{id:'0',org:'TEXT'}],payments:[{id:'p0',date:'2026-09-10',sum:100,vehicleId:0,paidAmount:0},{id:'pt',date:'2026-09-10',sum:100,vehicleId:'0',paidAmount:0}],assetAssignments:[{id:'ambiguous-legacy',assetRef:'v:0',from:'2026-09-01',org:'MUST NOT WIN'}]});
 const context=vm.createContext({data:db,DecimalCore:require('../assets/core/decimal-core'),DocumentEngine:documents});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/21-finances.js'),'utf8'),context);assert.equal(context.finPaymentOrg(db.payments[0]),'NUMERIC');assert.equal(context.finPaymentOrg(db.payments[1]),'TEXT');
 for(const index of [0,1]){const vehicles=db.vehicles.map((row,at)=>at===index?{...row,org:'CHANGED'}:row);rejected(()=>periods.validateChanges(db,{...db,vehicles}));}
 assert.equal(periods.validateChanges(db,{...db,assetAssignments:[{...db.assetAssignments[0],org:'IGNORED SAME AS UI'}]}),true);assert.deepEqual(db.vehicles.map(row=>row.id),[0,'0']);
});

test('every actual financial adapter protects typed binding resolution without freezing unrelated catalogs or labels',()=>{
 const cost=require('../assets/js/45-cost-engine'),range={from:'2026-09-01',to:'2026-09-30'},definitions={repairs:{id:'document',invoiceDate:'2026-09-10',vehicleId:0,cost:100},vehicleTo:{id:'document',date:'2026-09-10',vehicleId:0,cost:100,planned:false},toRecords:{id:'document',date:'2026-09-10',generatorId:0,cost:100,planned:false},workOrders:{id:'document',status:'accepted',downtimeTo:'2026-09-10T12:00',actualCost:100,assetRef:'v:0'},payments:{id:'document',date:'2026-09-10',sum:100,vehicleId:0,paidAmount:0},costEntries:{id:'document',date:'2026-09-10',kind:'expense',amount:100,independent:true,assetRef:'v:0',title:'Факт'}};
 for(const [section,document]of Object.entries(definitions)){
  const catalog=section==='toRecords'?'generators':'vehicles',db=fixture({vehicles:[],generators:[],fuelPeriods:[{month:'2026-09',financeClosed:true}],[section]:[document]}),fact=JSON.stringify(db[section]),missing=cost.buildReport(db,range);assert.equal(missing.unassigned.reduce((sum,row)=>sum+row.amount,0),100,section+' unassigned');
  const resolved={...db,[catalog]:[{id:0,plate:'KNOWN',name:'KNOWN'}]},known=cost.buildReport(resolved,range);assert.equal(known.rows.flatMap(row=>row.entries).reduce((sum,row)=>sum+row.amount,0),100,section+' assigned');rejected(()=>periods.validateChanges(db,resolved));
  const ambiguous={...resolved,[catalog]:[...resolved[catalog],{id:'0',name:'AMBIGUOUS'}]};assert.throws(()=>cost.buildReport(ambiguous,range),{code:'AMBIGUOUS_ASSET'});rejected(()=>periods.validateChanges(resolved,ambiguous));
  const replaced={...resolved,[catalog]:[{id:'0',name:'OTHER TYPED ID'}]};assert.equal(cost.buildReport(replaced,range).rows.flatMap(row=>row.entries).reduce((sum,row)=>sum+row.amount,0),100);rejected(()=>periods.validateChanges(resolved,replaced));
  const unrelated={...resolved,[catalog]:[{...resolved[catalog][0],plate:'Display rename',name:'Display rename'},{id:'unused',name:'UNUSED'}]};assert.equal(periods.validateChanges(resolved,unrelated),true,section+' unrelated');assert.equal(JSON.stringify(db[section]),fact);
 }
});
