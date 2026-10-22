'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const identity=require('../assets/core/entity-identity.js');
const source=name=>fs.readFileSync(path.join(__dirname,'../assets/js',name),'utf8');
function workflows(database){
 const messages=[],dialogs=[];const context=vm.createContext({console,data:structuredClone(database),EntityIdentity:identity,BusinessCalendar:require('../assets/core/business-calendar.js'),htmlEsc:value=>String(value??''),showToast:message=>messages.push(message),document:{},localStorage:{getItem:()=>null}});
 vm.runInContext(source('30-workflows.js'),context);context.wfShowDialog=(title,html)=>dialogs.push({title,html});return {context,messages,dialogs};
}
test('loading workflow catalogues keeps numeric zero and textual zero IDs and their existing links unchanged',()=>{
 const database={drivers:[{id:0,name:'Numeric zero'},{id:'0',name:'Text zero'}],assetAssignments:[{id:0,driverId:0,assetRef:'v:7'}]},original=JSON.stringify(database.drivers),app=workflows(database);
 app.context.wfInitData(app.context.data);assert.equal(JSON.stringify(app.context.data.drivers),original);assert.equal(app.context.data.assetAssignments[0].driverId,0);assert.equal(app.context.data.assetAssignments[0].id,0);
});
test('a numeric vehicle timeline uses its exact typed journal identity, including zero',()=>{
 const app=workflows({vehicles:[{id:0,plate:'NUMERIC'}],generators:[],tanks:[],records:[{id:'numeric-record',vehicleId:0,date:'2026-09-01',note:'NUMERIC-JOURNAL'},{id:'orphan-text-record',vehicleId:'0',date:'2026-09-01',note:'OTHER-TYPED-JOURNAL'}]});
 assert.equal(app.context.wfAsset('v:0').id,0);assert.equal(app.context.wfCommandTarget('v:0').id,0);app.context.wfTimeline('v:0');assert.match(app.dialogs[0].html,/NUMERIC-JOURNAL/);assert.doesNotMatch(app.dialogs[0].html,/OTHER-TYPED-JOURNAL/);
});
test('ambiguous legacy asset references cannot choose the first card, a context or another card journal',()=>{
 const app=workflows({vehicles:[{id:0,plate:'NUMERIC'},{id:'0',plate:'TEXT'}],generators:[],tanks:[],records:[{id:'a',vehicleId:0,note:'NUMERIC-JOURNAL'},{id:'b',vehicleId:'0',note:'TEXT-JOURNAL'}],assetAssignments:[{id:'assignment',assetRef:'v:0',from:'2026-01-01',org:'AMBIGUOUS-OWNER'}]});
 assert.equal(app.context.wfAsset('v:0'),null);assert.equal(app.context.wfAssets().length,0);assert.equal(Object.keys(app.context.wfContext('v:0')).length,0);assert.throws(()=>app.context.wfCommandTarget('v:0'),/однозначно/);app.context.wfTimeline('v:0');assert.equal(app.dialogs.length,0);assert.match(app.messages[0],/неоднозначна/);
});
test('a tank timeline does not show a generator journal with the same numeric ID',()=>{
 const app=workflows({vehicles:[],generators:[{id:0,name:'Generator'}],tanks:[{id:0,name:'Tank'}],genRecords:[{id:'g',generatorId:0,date:'2026-09-01',note:'GENERATOR-ONLY'}],tankIncomes:[{id:'t',tankId:0,date:'2026-09-01',note:'TANK-RECEIPT'}]});
 app.context.wfTimeline('t:0');assert.match(app.dialogs[0].html,/TANK-RECEIPT/);assert.doesNotMatch(app.dialogs[0].html,/GENERATOR-ONLY/);
});
test('archive additions preserve numeric and textual IDs without replacing current rows with older snapshots',async()=>{
 const data={vehicles:[{id:0,plate:'Current zero'},{id:7,plate:'Current seven'}]},context=vm.createContext({console,data,document:{getElementById:()=>({checked:true})},saveData:async()=>false});
 vm.runInContext(source('11-import.js'),context);context.__archive={main:{vehicles:[{id:0,plate:'Older zero'},{id:'0',plate:'Text zero'},{id:'7',plate:'Text seven'},{id:'toString',plate:'Valid named ID'}]},backupExtra:{vehicles:[{id:7,plate:'Older seven'},{id:'0',plate:'Older text zero'}]}};vm.runInContext('_rarImport=__archive',context);await context.doRarMerge();
 assert.deepEqual(data.vehicles.map(row=>row.id),[0,7,'0','7','toString']);assert.equal(data.vehicles[0].plate,'Current zero');assert.equal(data.vehicles[1].plate,'Current seven');assert.equal(data.vehicles[2].plate,'Text zero');
});
test('financial counterparty resolution and grouping preserve typed zero while an explicit missing ID does not fall back by name',()=>{
 const data={contragents:[{id:0,name:'Numeric party'},{id:'0',name:'Text party'},{id:'other',name:'Unknown legacy name'}],vehicles:[]},context=vm.createContext({console,data});vm.runInContext(source('21-finances.js'),context);
 assert.equal(context.finResolveContragent({contragentId:0}).name,'Numeric party');assert.equal(context.finResolveContragent({contragentId:'0'}).name,'Text party');assert.notEqual(context.finPartyKey({contragentId:0}),context.finPartyKey({contragentId:'0'}));assert.equal(context.finResolveContragent({contragentId:'missing',contragent:'Unknown legacy name'}),null);assert.equal(context.finContragentName({contragentId:'missing',contragent:'Unknown legacy name'}),'Unknown legacy name');
});

test('cost calculations reject ambiguous legacy asset identities without mixing quantities, while an unrelated explicit selection stays available',()=>{
 const costs=require('../assets/js/45-cost-engine.js'),database={vehicles:[{id:0,plate:'Numeric'},{id:'0',plate:'Text'},{id:'healthy',plate:'Healthy'}],records:[{id:'n',vehicleId:0,date:'2026-09-01',km:100},{id:'s',vehicleId:'0',date:'2026-09-01',km:200},{id:'h',vehicleId:'healthy',date:'2026-09-01',km:3}]},before=JSON.stringify(database);
 assert.throws(()=>costs.buildReport(database),{code:'AMBIGUOUS_ASSET'});assert.throws(()=>costs.buildReport(database,{assetRef:'v:0'}),{code:'AMBIGUOUS_ASSET'});const report=costs.buildReport(database,{assetRef:'v:healthy'});assert.equal(report.rows.length,1);assert.equal(report.rows[0].quantity,3);assert.equal(JSON.stringify(database),before);
});

test('renderer journal indexes and inline IDs retain zero and textual identity without prototype-key collisions',()=>{
 const context=vm.createContext({console,window:{},document:{addEventListener(){},documentElement:{removeAttribute(){}}},localStorage:{getItem(){}}});vm.runInContext(source('01-core.js'),context);
 context.__database={records:[{id:'numeric',vehicleId:0},{id:'text',vehicleId:'0'},{id:'old-special',vehicleId:'__proto__'}],genRecords:[{id:'g-numeric',generatorId:0},{id:'g-text',generatorId:'0'}],vehicleTo:[{id:'to-numeric',vehicleId:0},{id:'to-text',vehicleId:'0'}],repairs:[{id:'repair-numeric',vehicleId:0},{id:'repair-text',vehicleId:'0'}]};vm.runInContext('data=__database;rebuildIndex()',context);
 for(const [name,numeric,text]of [['recsFor','numeric','text'],['genRecsFor','g-numeric','g-text'],['vehicleToFor','to-numeric','to-text'],['repairsFor','repair-numeric','repair-text']]){assert.deepEqual(Array.from(context[name](0),row=>row.id),[numeric]);assert.deepEqual(Array.from(context[name]('0'),row=>row.id),[text]);}
 assert.deepEqual(Array.from(context.recsFor('__proto__'),row=>row.id),['old-special']);assert.equal(context.htmlJs(0),'0');assert.equal(JSON.parse(context.htmlJs('0').replace(/&quot;/g,'"')),'0');
});

test('reversal checks the exact numeric asset journal and does not skip a zero tank recipient',()=>{
 const app=workflows({vehicles:[{id:0,plate:'Numeric',fuelBalance:100}],generators:[],tanks:[{id:0,name:'Zero tank'}],fuelMovements:[{id:0,kind:'issue',assetRef:'v:0',fromTankId:0,date:'2026-09-01',qty:10,recordId:0}],records:[{id:0,vehicleId:0,date:'2026-09-01',fuelIssued:10,fuelMovementId:0}]});
 app.context.cmpDateAsc=(a,b)=>a.localeCompare(b);app.context.computeFuelBalances=id=>{assert.equal(id,0);return {0:2};};
 assert.throws(()=>app.context.wfReversalCheck(0),/недостаточно топлива/);
 app.context.computeFuelBalances=id=>{assert.equal(id,0);return {0:20};};assert.equal(app.context.wfReversalCheck(0).linked.id,0);
 app.context.data.vehicles.push({id:'0',plate:'Text'});assert.throws(()=>app.context.wfReversalCheck(0),/неоднозначна/);
 app.context.data.fuelMovements=[{id:'transfer',kind:'transfer',fromTankId:'other',toTankId:0,date:'2026-09-01',qty:10}];app.context.data.tanks.push({id:'other'});app.context.wfTankBalanceAt=id=>{assert.equal(id,0);return 2;};
 assert.throws(()=>app.context.wfReversalCheck('transfer'),/недостаточно топлива/);
});

test('reversal sends the typed zero source to the common review without changing accounting before confirmation',async()=>{
 const app=workflows({vehicles:[],generators:[],tanks:[{id:0,name:'Zero tank'}],fuelMovements:[{id:0,kind:'receipt',toTankId:0,date:'2026-09-01',qty:10}]}),before=JSON.stringify(app.context.data);let reviewed;
 app.context.wfTankBalanceAt=()=>20;app.context.saveData=async()=>{assert.fail('Raw save bypasses lifecycle confirmation');};app.context.lifecycleReverseExisting=(...args)=>{reviewed=args;};
 await app.context.wfReverseFuelMovement(0,'Duplicate receipt');assert.deepEqual(reviewed,['fuelMovements',0,'Duplicate receipt']);assert.equal(JSON.stringify(app.context.data),before);
});

test('workflow validation and history restoration treat zero as an actual tank, person and parent reference',()=>{
 const app=workflows({vehicles:[{id:0}],generators:[{id:0}],tanks:[{id:0},{id:'0'}],drivers:[{id:0}],fuelMovements:[{id:0,reversedBy:0}],records:[],genRecords:[]});app.context.wfTankBalanceAt=()=>20;
 assert.doesNotThrow(()=>app.context.wfValidate('fuelMovements',{id:'transfer',kind:'transfer',fromTankId:0,toTankId:'0',date:'2026-09-01',qty:10,reason:'Synthetic transfer'}));
 assert.doesNotThrow(()=>app.context.wfValidate('assetDocuments',{id:'document',driverId:0}));
 assert.doesNotThrow(()=>app.context.wfRestoreReferences('records',{id:'journal',vehicleId:0,tankId:0}));
 app.context.data.tanks=[];assert.throws(()=>app.context.wfRestoreReferences('records',{id:'journal',vehicleId:0,tankId:0}),/восстановите.*ёмкость/);
 assert.throws(()=>app.context.wfRestoreReferences('records',{id:'journal',vehicleId:0,fuelMovementId:0,fuelIssued:10}),/уже сторнирована/);
});
