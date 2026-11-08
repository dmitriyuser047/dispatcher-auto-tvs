'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const compatibility=require('../assets/core/platform-compatibility.js'),format=require('../electron/storage-format.cjs'),print=require('../assets/core/document-print.js'),writeoff=require('../assets/core/writeoff-engine.js'),schema=require('../assets/core/platform-schema.js');
const clone=value=>JSON.parse(JSON.stringify(value)),hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ctx={id:'return-version-print',now:'2026-10-22T12:00:00.000Z',today:'2026-10-22',actor:{id:'synthetic',name:'Synthetic',role:'admin'},timing:'late'},meta={id:'act',number:'SYN',postedAt:'2026-09-30T12:00:00.000Z',postedBy:ctx.actor},scope={month:'2026-09',org:'A',grade:'ДТ',date:'2026-09-30'};
function document(version,refund=false){
 const db={...Object.fromEntries(schema.sections.map(name=>[name,[]])),vehicles:[{id:0,plate:'SYN',org:'A',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:10,norm:0}],records:[{id:0,vehicleId:0,date:'2026-09-01',km:0,fuelActual:0}]},engine=writeoff.forVersion(version),review=engine.prepare(db,scope);
 if(refund){db.fuelPurchases=[{id:'original-return',operationKind:'return',qty:-2,sum:-140,price:70,vehicleId:0,date:'2026-09-01',sourceOrg:'A',grade:'ДТ',provider:'Synthetic'}];const reviewed=engine.prepare(db,scope);assert.equal(reviewed.canPost,true,JSON.stringify(reviewed.issues));db.fuelWriteoffs=[engine.post(db,scope,{...meta,expectedFingerprint:reviewed.sourceFingerprint})];return db;}
 assert.equal(review.canPost,true,JSON.stringify(review.issues));db.fuelWriteoffs=[engine.post(db,scope,{...meta,expectedFingerprint:review.sourceFingerprint})];return db;
}
const request={mode:'document',source:{section:'fuelWriteoffs',id:'act'},revision:'exact',templateId:'fuelWriteoff',templateVersion:1};

test('fuel-return version7 is required for network reads and writes in both directions',()=>{
 const description=compatibility.describe(),descriptor=format.describe(6),current=compatibility.negotiate(description.hello,description.serverProfile,descriptor);
 assert.equal(descriptor.schemaVersion,6);assert.equal(current.mode,'read-write');assert.ok(current.selectedProfile.capabilities.some(item=>item.name==='fuelCalculationsV7'&&item.version===1));
 const oldHello=clone(description.hello);oldHello.capabilities=oldHello.capabilities.filter(item=>item.name!=='fuelCalculationsV7');
 const oldClient=compatibility.negotiate(oldHello,description.serverProfile,descriptor);assert.equal(oldClient.mode,'unsupported');assert.equal(oldClient.readCompatible,false);assert.equal(oldClient.writeCompatible,false);assert.ok(oldClient.reasons.some(item=>item.code==='REQUIRED_READ_CAPABILITY_UNAVAILABLE'&&item.capability==='fuelCalculationsV7'));
 const oldServer=clone(description.serverProfile);oldServer.capabilities=oldServer.capabilities.filter(item=>item.name!=='fuelCalculationsV7');for(const field of ['requiredReadCapabilities','requiredWriteCapabilities'])oldServer[field]=oldServer[field].filter(item=>item.name!=='fuelCalculationsV7');
 const newClient=compatibility.negotiate(description.hello,oldServer,descriptor);assert.equal(newClient.mode,'unsupported');assert.equal(newClient.readCompatible,false);assert.equal(newClient.writeCompatible,false);assert.ok(newClient.reasons.some(item=>item.code==='REQUIRED_READ_CAPABILITY_UNAVAILABLE'&&item.capability==='fuelCalculationsV7'));
 const incompatible=clone(description.hello);incompatible.capabilities.find(item=>item.name==='fuelCalculationsV7').versions=[2];assert.equal(compatibility.negotiate(incompatible,description.serverProfile,descriptor).readCompatible,false);
 const oldRuntime=vm.createContext({PlatformContracts:require('../assets/core/platform-contracts.js'),PlatformSchema:schema});vm.runInContext(fs.readFileSync(path.join(__dirname,'fixtures/schema-v5/platform-compatibility-v5.js'),'utf8'),oldRuntime);const literalOld=oldRuntime.PlatformCompatibility,legacy=literalOld.negotiate(literalOld.describe().hello,description.serverProfile,format.describe(5));assert.equal(legacy.readCompatible,false);assert.ok(legacy.reasons.some(item=>item.code==='REQUIRED_READ_CAPABILITY_UNKNOWN'&&item.capability==='fuelCalculationsV7'));
});

// Captured from committed 3.5.37 before editing calculation admission. These
// cover complete ordered snapshot, rendered HTML and typed workbook bytes.
const golden={1:'e8547e38c79d6f08834adf8bcc48f2dc7bcc151e640c5ffac65aebafd9e3c4e0',2:'c06147e52bec93146a68f4258b2575afecc5262286506e91c2c833938a629ec2',3:'3ec1f7bbd3fd9dcc11cec9201c59acd3524b37a56e3009321b591fb9aa9d7608',4:'0a57dc5c0b70ce27fcc915886beecdafdd876a55e1d65e871b5499b5125987e3',5:'22b322619f58640a5da9e266007e14dc692eb12e685bbbbd2f385b5bb132e27a',6:'c74facf7acae8f7c80c83ddb8763b2446883ee84bf3362ed10f97130a35a9a32'};
test('admitting version7 preserves every historical v1-v6 print snapshot, HTML and workbook byte',()=>{
 for(const version of [1,2,3,4,5,6]){const snapshot=print.capture(document(version),request,ctx);assert.equal(hash([snapshot,print.render(snapshot)]),golden[version],'historical version '+version);}
});

test('new version7 writeoffs print their frozen net receipts while later live changes stay separate',()=>{
 const db=document(7,true),snapshot=print.capture(db,request,ctx),rendered=JSON.stringify(print.render(snapshot));assert.equal(snapshot.calculationVersions.calculationVersion,7);assert.equal(snapshot.sourceRecord.calculationVersion,7);assert.equal(snapshot.sourceRecord.totals.issued,-2);assert.equal(snapshot.sourceRecord.totals.end,8);assert.ok(snapshot.model.tables.some(table=>table.rows.some(row=>row.includes(-2))));
 assert.equal(snapshot.template.digest,'sha256:5df3e87f9cdc0ab9e6684754edaecd10651f45af3b3046bf2294bb45d7eb24ef');
 db.fuelPurchases.push({id:'later-return',operationKind:'return',qty:-5,vehicleId:0,date:'2026-09-02',grade:'ДТ'});db.vehicles[0].plate='Changed live card';assert.equal(JSON.stringify(print.render(snapshot)),rendered);
 const unsupported=clone(db);unsupported.fuelWriteoffs[0].calculationVersion=8;const blocked=print.prepare(unsupported,request,ctx);assert.equal(blocked.canCapture,false);assert.ok(blocked.blockers.some(issue=>issue.code==='PRINT_CALCULATION_VERSION'));assert.throws(()=>print.capture(unsupported,request,ctx),{code:'PRINT_BLOCKED'});
});
