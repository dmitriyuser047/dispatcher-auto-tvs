'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const api=require('../electron/product-profile.cjs');
const metadata=()=>({name:'dispatcher-des-object',tvsProductProfile:'des-object',build:{appId:'com.tvs.dispatcher-des-object'}}),object=()=>api.describeProduct(metadata()),dispatcher=()=>api.describeProduct({name:'dispatcher-auto-tvs'}),fingerprint='sha256:'+'1'.repeat(64),reason='Synthetic explicit basis';
const envelope=(type,input)=>({protocolVersion:1,databaseToken:'synthetic-database',operation:{id:'synthetic-operation'},base:{},command:{type,version:1,input}});
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'des-object-product-'));t.after(()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('des-object-product-'));fs.rmSync(resolved,{recursive:true,force:true});});return root;}
const code=expected=>error=>error.code===expected;

test('packaged metadata selects an immutable independent identity and never inherits central updates',()=>{
 const supplied=metadata(),profile=api.describeProduct(supplied);supplied.name='changed';supplied.tvsProductProfile='dispatcher';supplied.build.appId='changed';
 assert.equal(profile.kind,'des-object');assert.equal(profile.appId,'com.tvs.dispatcher-des-object');assert.equal(profile.userDataName,'dispatcher-des-object');assert.equal(profile.standardUpdates,false);assert.equal(Object.isFrozen(profile),true);assert.equal(Object.isFrozen(profile.sections),true);assert.throws(()=>profile.sections.push('vehicles'),TypeError);assert.equal(profile.sections.includes('vehicles'),false);
 const stripped=api.describeProduct({name:'dispatcher-des-object',tvsProductProfile:'des-object'});assert.equal(stripped.kind,'des-object','electron-builder may remove build configuration from app package');
 const standard=dispatcher();assert.equal(standard.standardUpdates,true);assert.equal(standard.appId,'com.tvs.dispetcherizaciya-avto');
 for(const invalid of [{name:'dispatcher-des-object'},{...metadata(),name:'other'},{...metadata(),build:{appId:'com.tvs.dispetcherizaciya-avto'}},{...metadata(),build:{appId:''}},{tvsProductProfile:'unknown'}])assert.throws(()=>api.describeProduct(invalid),code('PRODUCT_PROFILE_INVALID'));
 let called=0;const getter={name:'dispatcher-des-object'};Object.defineProperty(getter,'tvsProductProfile',{get(){called++;return 'dispatcher';}});assert.throws(()=>api.describeProduct(getter),code('PRODUCT_PROFILE_INVALID'));assert.equal(called,0);
});

test('object IPC whitelist denies update, central settings, server management and unknown channels',()=>{
 const profile=object();for(const name of ['get-product-profile','des-object','execute-command','read-section','query-rows','get-pending-operations'])assert.equal(api.permitsChannel(profile,name),true,name);
 for(const name of ['check-for-updates','install-update','download-update','save-settings','start-server','set-data-path','save-access-policy','unknown-channel'])assert.equal(api.permitsChannel(profile,name),false,name);
 assert.equal(api.permitsChannel(dispatcher(),'check-for-updates'),true);
});

test('installer build metadata and trusted main profile use the same distinct identity without changing root metadata',()=>{
 const build=require('../scripts/des-object-build-profile.cjs'),source=require('../package.json'),before=JSON.stringify(source),packaged=build.metadata(source),profile=api.describeProduct(packaged),central=api.describeProduct(source);
 assert.equal(JSON.stringify(source),before);assert.equal(packaged.version,build.VERSION);assert.equal(packaged.coreVersion,source.version);assert.equal(profile.appId,packaged.build.appId);assert.equal(profile.kind,packaged.tvsProductProfile);assert.notEqual(profile.appId,central.appId);assert.notEqual(profile.userDataName,central.userDataName);assert.equal(profile.standardUpdates,false);assert.notEqual(packaged.build.nsis.guid,source.build.nsis.guid);assert.equal(packaged.build.executableName,'DES Object');assert.equal(packaged.build.artifactName,'Des-Object-Setup-${version}.${ext}');assert.equal(packaged.build.nsis.deleteAppDataOnUninstall,false);
});

test('profile and business paths stay under their own local data root without creating directories',t=>{
 const root=temporary(t),appData=path.join(root,'appData'),profile=object(),paths=api.profilePaths(profile,{appData});
 assert.equal(paths.userData,path.join(appData,'dispatcher-des-object'));assert.equal(paths.dataRoot,path.join(paths.userData,'databases'));assert.equal(Object.isFrozen(paths),true);assert.equal(fs.existsSync(paths.userData),false);
 assert.equal(api.assertOwnedData(profile,paths,path.join(paths.dataRoot,'primary')),path.join(paths.dataRoot,'primary'));assert.equal(api.assertOwnedData(profile,paths,paths.dataRoot),paths.dataRoot);
 for(const selected of [path.join(root,'outside'),path.join(paths.dataRoot,'..','settings'),path.join(appData,'dispetcherizaciya-avto','database')])assert.throws(()=>api.assertOwnedData(profile,paths,selected),code('PRODUCT_PATH_OWNERSHIP'));
 assert.throws(()=>api.assertOwnedData(profile,{userData:paths.userData,dataRoot:paths.dataRoot},path.join(paths.dataRoot,'primary')),code('PRODUCT_PATH_INVALID'));
 assert.throws(()=>api.profilePaths(profile,{appData,override:'relative-profile'}),code('PRODUCT_PATH_INVALID'));
 const overridden=api.profilePaths(profile,{appData,override:path.join(root,'separate-object-profile')});assert.equal(api.assertOwnedData(profile,overridden,path.join(overridden.dataRoot,'primary')),path.join(root,'separate-object-profile','databases','primary'));
 for(const override of [path.join(appData,'dispetcherizaciya-avto'),path.join(appData,'dispetcherizaciya-avto','object'),appData])assert.throws(()=>api.profilePaths(profile,{appData,override}),code('PRODUCT_PATH_CENTRAL'));
 assert.throws(()=>api.profilePaths(profile,{appData,override:'\\\\synthetic-server\\share\\object'}),code('PRODUCT_PATH_INVALID'));
 const standard=api.profilePaths(dispatcher(),{appData});assert.equal(standard.dataRoot,null);assert.equal(api.assertOwnedData(dispatcher(),standard,path.join(root,'legacy-data')),path.join(root,'legacy-data'));
});

test('junction aliases and replacements cannot redirect object profile or database to the central profile',t=>{
 const root=temporary(t),appData=path.join(root,'appData'),central=path.join(appData,'dispetcherizaciya-avto'),profile=object();fs.mkdirSync(central,{recursive:true});
 const alias=path.join(root,'central-alias');fs.symlinkSync(central,alias,'junction');assert.throws(()=>api.profilePaths(profile,{appData,override:alias}),code('PRODUCT_PATH_LINK'));
 const paths=api.profilePaths(profile,{appData});fs.mkdirSync(paths.userData,{recursive:true});fs.symlinkSync(central,paths.dataRoot,'junction');assert.throws(()=>api.assertOwnedData(profile,paths,path.join(paths.dataRoot,'primary')),code('PRODUCT_PATH_LINK'));
 fs.unlinkSync(paths.dataRoot);fs.mkdirSync(paths.dataRoot);const inner=path.join(paths.dataRoot,'primary');fs.symlinkSync(central,inner,'junction');assert.throws(()=>api.assertOwnedData(profile,paths,inner),code('PRODUCT_PATH_LINK'));
 fs.unlinkSync(inner);fs.rmdirSync(paths.dataRoot);fs.rmdirSync(paths.userData);fs.symlinkSync(central,paths.userData,'junction');assert.throws(()=>api.assertOwnedData(profile,paths,path.join(paths.dataRoot,'primary')),code('PRODUCT_PATH_LINK'));
});

test('physical central alias pointing into the proposed object profile is rejected even when lexical names differ',t=>{
 const root=temporary(t),appData=path.join(root,'appData'),objectDir=path.join(root,'object-profile');fs.mkdirSync(appData);fs.mkdirSync(objectDir);fs.symlinkSync(objectDir,path.join(appData,'dispetcherizaciya-avto'),'junction');
 assert.throws(()=>api.profilePaths(object(),{appData,override:objectDir}),code('PRODUCT_PATH_CENTRAL'));
});

test('central-only approvals and global policy commands cannot enter the object outbox',()=>{
 const profile=object(),reviewFingerprint=fingerprint;
 const protectedCommands=[
  envelope('PeriodAction',{action:'close',scope:'stock',month:'2026-10',reason,reviewFingerprint}),envelope('PeriodAction',{action:'reopen',scope:'fuel',month:'2026-10',reason,reviewFingerprint}),
  envelope('GeneratorMaintenanceAction',{action:'approve',planId:0,date:'2026-11-01',document:'Synthetic commission decision',reason,reviewFingerprint}),envelope('GeneratorMaintenanceAction',{action:'revise',planId:'0',reason,reviewFingerprint}),
  envelope('AssetInventoryAction',{action:'approve',sessionId:0,date:'2026-11-01',document:'Synthetic decision',reason,reviewFingerprint}),envelope('AssetInventoryAction',{action:'revise',sessionId:0,reason,reviewFingerprint}),
  envelope('RepairAction',{action:'approve',orderId:0,reason,reviewFingerprint}),
  envelope('AcceptShift',{shiftId:0,changes:{acceptedBy:'Synthetic central receiver'}}),
  envelope('CalendarAction',{action:'configure',timeZone:'Europe/Moscow',reason,reviewFingerprint}),
  envelope('CostAction',{action:'savePolicy',target:{section:'parts',id:0},payload:{from:'2026-11-01',method:'fifo',taxBasis:'gross',opening:{qty:0,amount:null,basis:reason},basis:reason},reason,reviewFingerprint}),
  envelope('MergeCatalog',{section:'parts',sourceId:0,targetId:'0',mutableRefs:[],reason,reviewFingerprint}),
  ...['workOrders','dispatchJobs','shiftReports'].flatMap(section=>[envelope('DocumentAction',{action:'postDraft',section,draftId:0,reviewFingerprint}),envelope('DocumentAction',{action:'post',section,id:0,reviewFingerprint}),envelope('DocumentAction',{action:'void',section,id:0,reason,reviewFingerprint})])
 ];
 for(const value of protectedCommands){assert.throws(()=>api.assertCommandAllowed(profile,value),code('PRODUCT_CENTRAL_ACTION'),JSON.stringify(value.command));assert.equal(api.assertCommandAllowed(dispatcher(),value),value);}
});

test('ordinary local drafts, parts and fuel posting, consumption and actual TO remain allowed without mutation',()=>{
 const profile=object(),reviewFingerprint=fingerprint;
 const allowed=[
  envelope('DocumentAction',{action:'saveDraft',section:'partMovements',payload:{partId:0,date:'2026-11-01',kind:'receipt',qty:2,reason}}),
  envelope('DocumentAction',{action:'postDraft',section:'partMovements',draftId:0,reviewFingerprint}),
  envelope('DocumentAction',{action:'postDraft',section:'fuelMovements',draftId:'0',reviewFingerprint}),
  envelope('DocumentAction',{action:'postDraft',section:'fuelWriteoffs',draftId:0,reviewFingerprint}),
  envelope('DocumentAction',{action:'postDraft',section:'toRecords',draftId:0,reviewFingerprint}),
  envelope('DocumentAction',{action:'saveDraft',section:'workOrders',payload:{title:'Local draft'}}),
  envelope('DocumentAction',{action:'discardDraft',section:'shiftReports',draftId:0,reason}),
  envelope('GeneratorMaintenanceAction',{action:'saveDraft',payload:{org:'Synthetic organization',year:2026,title:'Local plan draft',rows:[],commission:{chairman:{name:'Synthetic chairman',position:'Synthetic position'},members:[]}},reason,reviewFingerprint}),
  envelope('RepairAction',{action:'saveOrder',payload:{title:'Local repair',target:{section:'generators',id:0}},reason,reviewFingerprint}),
  envelope('RepairAction',{action:'start',orderId:0,reason,reviewFingerprint}),envelope('RepairAction',{action:'cancel',orderId:0,reason,reviewFingerprint}),
  envelope('IssueFuel',{tankId:0,target:{section:'generators',id:0},date:'2026-11-01',qty:1,reason})
 ];
 for(const value of allowed){const before=JSON.stringify(value);assert.equal(api.assertCommandAllowed(profile,value),value);assert.equal(JSON.stringify(value),before);}
 let calls=0;const unsafe={};Object.defineProperty(unsafe,'command',{get(){calls++;return allowed[0].command;}});assert.throws(()=>api.assertCommandAllowed(profile,unsafe),code('PRODUCT_PROFILE_INVALID'));assert.equal(calls,0);
 assert.throws(()=>api.assertCommandAllowed(profile,envelope('UnknownCommand',{})));
});
