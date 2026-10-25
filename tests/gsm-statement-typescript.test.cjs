'use strict';
// Differential migration checks use the released renderer and synthetic memory
// only; they never start Electron or open a database/profile.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ts=require('typescript'),fuel=require('../assets/core/fuel-engine.js'),decimal=require('../assets/core/decimal-core.js');
const {compileGsmUI}=require('../scripts/build-gsm-ui.cjs');
const root=path.resolve(__dirname,'..'),normalize=text=>text.replace(/\r\n?/g,'\n');
const released=fs.readFileSync(path.join(__dirname,'fixtures/gsm-statement-v3.5.8.js'),'utf8');
const current=fs.readFileSync(path.join(root,'assets/js/25p-gsm-statement.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){return {vehicles:[
 {id:0,plate:'<NUMBER ZERO & "vehicle">',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:50,norm:10,fuelBalanceSources:[{org:'A',grade:'ДТ',qty:30},{org:'B',grade:'ДТ',qty:20}]},
 {id:'0',plate:'STRING ZERO',org:'B',fuel:'gasoline',fuelGrade:'АИ-92',fuelBalance:30,norm:8},
 {id:'unknown',plate:'UNKNOWN',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:null},
 {id:'negative',plate:'NEGATIVE',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:2,norm:10}
 ],records:[
 {id:0,vehicleId:0,date:'2026-08-31',km:0,fuelActual:0,tankMeasured:45,fuelGrade:'ДТ'},
 {id:'0',vehicleId:'0',date:'2026-09-02',km:10,fuelActual:0,fuelGrade:'АИ-92'},
 {id:'norm',vehicleId:0,date:'2026-09-03',km:10,fuelActual:null,fuelIdle:.3,fuelGrade:'ДТ'},
 {id:'missing',vehicleId:'unknown',date:'2026-09-04',km:20,fuelActual:null,fuelGrade:'ДТ'},
 {id:'negative',vehicleId:'negative',date:'2026-09-05',km:10,fuelActual:5,fuelGrade:'ДТ'},
 {id:'measured',vehicleId:0,date:'2026-09-30',km:10,fuelActual:1,tankMeasured:40,fuelGrade:'ДТ'},
 {id:'bad-date',vehicleId:'0',date:'bad-date',km:1,fuelActual:1,fuelGrade:'АИ-92'}
 ],fuelPurchases:[{id:0,vehicleId:0,date:'2026-09-01',grade:'ДТ',qty:3.333,sourceOrg:'A',provider:'<provider>',manual:true}],fuelCards:[],monthlyFuel:[]};}
function renderer(source,db,{legacy=false}={}){
 const events=[],context=vm.createContext({data:structuredClone(db),__stamp:'session-a',
  ...(legacy?{}:{TvsFuelEngine:fuel,DecimalCore:decimal,gsmOrgKey:fuel.gsmOrgKey,gsmFamily:fuel.gsmFamily}),
  fmtDate:value=>'DATE:'+value,dispatcherAnalysisStamp:()=>context.__stamp,
  showToast:message=>events.push(['toast',message]),renderFuelPurchases:()=>events.push(['render']),
  switchSection:section=>events.push(['section',section]),selectVehicle:id=>events.push(['vehicle',typeof id,id]),
  fuelAccountingOpen:(section,id)=>events.push(['opening',section,typeof id,id]),fpEdit:id=>events.push(['purchase',typeof id,id]),gsmEditRecord:id=>events.push(['record',typeof id,id])});
 vm.runInContext(source,context);return {context,events,render:(ledger,options)=>context.gsmVehicleStatementHtml(structuredClone(ledger),options),state:()=>plain(vm.runInContext('({token:gsmStatementSelectedToken,context:gsmStatementContext})',context))};
}
test('strict GSM TypeScript is the deterministic source and retains the released baseline',()=>{
 assert.equal(crypto.createHash('sha256').update(normalize(released)).digest('hex'),'769accd76b0577551a34de29e7aa88ee0ffbf24e7995625d928f7d2eb03cfe20');
 assert.equal(normalize(current),compileGsmUI().artifact);
 const config=JSON.parse(fs.readFileSync(path.join(root,'tsconfig.gsm-ui.json'),'utf8'));
 for(const option of ['strict','noUncheckedIndexedAccess','exactOptionalPropertyTypes','noImplicitReturns','noEmitOnError'])assert.equal(config.compilerOptions[option],true,option);
 assert.deepEqual(config.files,['src/ui/gsm-statement-host.d.ts','src/ui/gsm-statement.ts']);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'src/ui/gsm-statement.ts'),'utf8'),/@ts-(?:no)?check|\bany\b/);
});
test('GSM host contracts reject wrong identifiers, date values, fields and movement values',()=>{
 const filename=path.join(root,'__gsm_contract_probe__.ts'),text=`
 const valid:GsmStatement.Ledger={rows:[{vehicleId:0,start:0,end:null},{vehicleId:'0'}]};
 const facts:GsmStatement.Fields={opening:null,issued:0,spent:1,correction:0,end:-1};
 // @ts-expect-error identifiers must preserve the numeric/string domain
 const badId:GsmStatement.LedgerRow={vehicleId:false};
 // @ts-expect-error accounting dates are calendar strings
 const badDate:GsmStatement.Accounting={from:20260901};
 // @ts-expect-error all five calculated fields are explicit, including unknown null
 const incomplete:GsmStatement.Fields={opening:0};
 // @ts-expect-error source kinds cannot name arbitrary application editors
 const badSource:GsmStatement.SourceKind='finance';
 void valid;void facts;void badId;void badDate;void incomplete;void badSource;
 `;
 const config=ts.readConfigFile(path.join(root,'tsconfig.gsm-ui.json'),ts.sys.readFile),options={...ts.parseJsonConfigFileContent(config.config,ts.sys,root).options,noEmit:true},host=ts.createCompilerHost(options),readFile=host.readFile.bind(host),fileExists=host.fileExists.bind(host),getSourceFile=host.getSourceFile.bind(host);
 host.fileExists=file=>path.resolve(file)===filename||fileExists(file);host.readFile=file=>path.resolve(file)===filename?text:readFile(file);host.getSourceFile=(file,version,onError,fresh)=>path.resolve(file)===filename?ts.createSourceFile(file,text,version,true):getSourceFile(file,version,onError,fresh);
 const program=ts.createProgram([path.join(root,'src/ui/gsm-statement-host.d.ts'),filename],options,host);
 assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[]);
});
for(const legacy of [false,true])test('released and typed rendering/navigation agree for all stages, typed zero, evidence, missing and negative values; legacy='+legacy,()=>{
 const db=fixture(),before=JSON.stringify(db),ledger=fuel.buildLedger(db,{from:'2026-09-01',to:'2026-09-30'}),a=renderer(released,db,{legacy}),b=renderer(current,db,{legacy});
 for(const stage of ['statement','opening','measurements']){
  assert.equal(b.render(ledger,{stage}),a.render(ledger,{stage}));
  const tokens=a.state().context.rows.map(row=>row.token);assert.equal(tokens.length,5);
  for(const token of tokens){
   assert.equal(b.context.gsmStatementSelect(token),a.context.gsmStatementSelect(token));
   assert.equal(b.render(ledger,{stage}),a.render(ledger,{stage}));
   assert.deepEqual(b.state(),a.state());
   for(const [index]of a.state().context.refs.entries())assert.equal(b.context.gsmStatementOpenSource(index),a.context.gsmStatementOpenSource(index));
   assert.equal(b.context.gsmStatementSelect(token),a.context.gsmStatementSelect(token));
  }
 }
 assert.deepEqual(b.events,a.events);assert.equal(JSON.stringify(db),before);
 assert.equal(JSON.stringify(a.context.data),before);assert.equal(JSON.stringify(b.context.data),before);
 assert.ok(b.events.some(event=>event[0]==='vehicle'&&event[1]==='number'&&event[2]===0));
 assert.ok(b.events.some(event=>event[0]==='vehicle'&&event[1]==='string'&&event[2]==='0'));
});
test('released and typed stale-session, duplicate-source, selection and empty-ledger guards agree',()=>{
 const db=fixture(),ledger=fuel.buildLedger(db,{from:'2026-09-01',to:'2026-09-30'}),a=renderer(released,db),b=renderer(current,db);
 const both=(method,...args)=>assert.equal(b.context[method](...args),a.context[method](...args));
 assert.equal(b.render(ledger),a.render(ledger));
 for(const value of [0,1,-1,500,'missing'])both('gsmStatementSelect',value);
 assert.equal(b.render(ledger),a.render(ledger));
 a.context.__stamp=b.context.__stamp='session-b';both('gsmStatementSelect',0);both('gsmStatementOpenSource',0);
 assert.equal(b.render(ledger),a.render(ledger));both('gsmStatementSelect',0);assert.equal(b.render(ledger),a.render(ledger));
 const firstVehicle=a.state().context.refs.findIndex(ref=>ref.kind==='vehicle');
 a.context.data.vehicles.push(structuredClone(a.context.data.vehicles[0]));b.context.data.vehicles.push(structuredClone(b.context.data.vehicles[0]));both('gsmStatementOpenSource',firstVehicle);
 a.context.data=structuredClone(db);b.context.data=structuredClone(db);both('gsmStatementOpenSource',firstVehicle);
 for(const value of [null,undefined,{rows:null},{rows:[]}])assert.equal(b.render(value),a.render(value));
 assert.deepEqual(b.state(),a.state());assert.deepEqual(b.events,a.events);
});
