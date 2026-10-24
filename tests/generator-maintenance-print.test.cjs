'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const printing=require('../assets/core/generator-maintenance-print'),maintenance=require('../assets/core/generator-maintenance'),hash=require('../assets/core/request-fingerprint');
function database(){return {generatorMaintenancePlans:[{id:0,org:'Synthetic org',year:2027,title:'Synthetic annual schedule',status:'draft',revision:1,rootId:0,createdAt:'2026-10-24T10:00:00.000Z',updatedAt:'2026-10-24T10:00:00.000Z',rows:[{id:0,generatorId:0,site:'Object B',type:'ТО-1',plannedHours:250,plannedDate:'2027-03-01',work:'Replace filter',note:'',components:[{partId:0,qty:2}]},{id:'0',generatorId:'0',site:'Object A',type:'ТО-2',plannedHours:500,plannedDate:'2027-06-01',work:'Service',note:'',components:[{partId:'0',qty:5}]}],commission:{chairman:{name:'Synthetic chairman',position:'Engineer'},members:[{name:'Synthetic member',position:'Mechanic'}]}}],generators:[{id:0,name:'DES numeric',org:'Synthetic org',site:'Object B',hoursInit:0},{id:'0',name:'DES string',org:'Synthetic org',site:'Object A',hoursInit:0}],genRecords:[],parts:[{id:0,generatorId:0,name:'Filter',article:'FILTER-0',unit:'шт'},{id:'0',generatorId:'0',name:'Oil',article:'OIL-0',unit:'л'}],partMovements:[],appMeta:[]};}
function approved(){const db=database(),input={action:'approve',planId:0,date:'2026-10-24',document:'Synthetic decision № 1',reason:'Synthetic approval'},review=maintenance.preview(db,input,{today:'2026-10-24'});assert.equal(review.canApply,true);return {...db,...maintenance.apply(db,{...input,reviewFingerprint:review.fingerprint},{id:'test-approve',now:'2026-10-24T10:00:00Z',today:'2026-10-24',actor:{id:'test',name:'Test user',role:'admin'}}).sections};}

test('separate schedule and spares appendix retain organization, sites and commission while keeping their own tables',()=>{
 const db=database(),before=JSON.stringify(db),model=printing.prepare(db,0),schedule=printing.render(model),appendix=printing.render(model,{document:'spares'});
 assert.equal(model.templateVersion,2);assert.deepEqual(printing.documents,['schedule','spares']);
 for(const html of [schedule,appendix])for(const text of ['ПРОЕКТ · НЕ УТВЕРЖДЁН','Synthetic org','Object A','Object B','DES numeric','DES string','Synthetic chairman','Synthetic member','Председатель'])assert.ok(html.includes(text),text);
 for(const text of ['250','500','Целевой счётчик','Работы / примечание','Replace filter'])assert.ok(schedule.includes(text),text);
 for(const text of ['FILTER-0','OIL-0','Наименование ЗИП','Итоговая потребность','Приложение № 1']){assert.ok(appendix.includes(text),text);assert.ok(!schedule.includes(text),'Schedule must not embed the parts list: '+text);}
 assert.ok(!appendix.includes('Replace filter'));assert.equal(model.snapshot.rows[0].generator.id,0);assert.equal(model.snapshot.rows[1].generator.id,'0');assert.equal(JSON.stringify(db),before);assert.ok(!schedule.includes('УТВЕРЖДЕНО</b>'));
});

test('approved print is byte-identical after current names, sites and parts are edited',()=>{
 const db=approved(),original=JSON.stringify(db.generatorMaintenancePlans),model=printing.prepare(db,0),first=printing.documents.map(document=>printing.render(model,{document}));for(const html of first){assert.ok(html.includes('УТВЕРЖДЕНО'));assert.ok(html.includes('Synthetic decision № 1'));assert.ok(!html.includes('НЕ УТВЕРЖДЁН'));}db.generators[0].name='CHANGED';db.generators[0].site='OTHER';db.parts[0].name='CHANGED PART';db.parts[0].article='CHANGED ARTICLE';db.genRecords.push({id:'future',generatorId:0,date:'2027-01-01',meterEnd:20000});assert.deepEqual(printing.documents.map(document=>printing.render(printing.prepare(db,0),{document})),first);assert.equal(JSON.stringify(db.generatorMaintenancePlans),original);
});

test('hostile source text is escaped and a corrupted approved snapshot cannot be printed',()=>{
 const db=database(),plan=db.generatorMaintenancePlans[0];plan.title='<img src=x onerror="bad()">';plan.commission.chairman.name='<script>bad()</script>';db.parts[0].name='<iframe src="bad">';for(const document of printing.documents){const html=printing.render(printing.prepare(db,0),{document});assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));if(document==='spares')assert.ok(html.includes('&lt;iframe'));}
 const frozen=structuredClone(approved());frozen.generatorMaintenancePlans[0].snapshot.rows[0].components[0].qty=99;assert.throws(()=>printing.prepare(frozen,0),{code:'MAINTENANCE_PRINT_SNAPSHOT'});
});

test('all source rights are needed, numeric zero is retained and ambiguous or cross-owned draft references fail',()=>{
 const db=database();assert.equal(printing.prepare(db,0).planId,0);assert.throws(()=>printing.prepare(db,'0'),{code:'MAINTENANCE_PRINT_SOURCE'});assert.throws(()=>printing.prepare(db,0,{readable:['generatorMaintenancePlans']}),{code:'ACCESS_DENIED'});db.parts[0].generatorId='0';assert.throws(()=>printing.prepare(db,0),{code:'MAINTENANCE_PRINT_OWNER'});db.parts[0].generatorId=0;db.generators.push({...db.generators[0]});assert.throws(()=>printing.prepare(db,0),{code:'MAINTENANCE_PRINT_REFERENCE'});
});

test('browser and CommonJS maintenance print produce identical escaped bytes without a renderer or clock',()=>{
 const ctx=vm.createContext({PlatformContracts:require('../assets/core/platform-contracts'),GeneratorMaintenance:maintenance,GeneratorMaintenanceSpares:require('../assets/core/generator-maintenance-spares'),RequestFingerprint:hash});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core/generator-maintenance-print.js'),'utf8'),ctx);const db=approved();for(const document of printing.documents)assert.equal(ctx.GeneratorMaintenancePrint.render(ctx.GeneratorMaintenancePrint.prepare(db,0),{document}),printing.render(printing.prepare(db,0),{document}));
});

function tableRows(html,className){const match=new RegExp('<table class="'+className+'">([\\s\\S]*?)</table>').exec(html);assert.ok(match,className);return [...match[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row=>[...row[1].matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map(cell=>cell[1].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim())).filter(row=>row.length);}

test('printed appendix sums repeated TO demand per typed DES and sums matching material across the organization exactly',()=>{
 const db=database(),plan=db.generatorMaintenancePlans[0];plan.rows[0].components[0].qty=0.1;
 plan.rows.push({...structuredClone(plan.rows[0]),id:'repeat',plannedDate:'2027-04-01',components:[{partId:0,qty:0.2}]});
 db.parts.push({...db.parts[0],id:'other-filter',generatorId:'0'});plan.rows[1].components.push({partId:'other-filter',qty:0.2});
 const before=JSON.stringify(db),html=printing.render(printing.prepare(db,0),{document:'spares'}),individual=tableRows(html,'generator-spares-table'),organization=tableRows(html,'organization-spares-table');
 assert.equal(individual.find(row=>row[2]==='FILTER-0')[4],'0,3');assert.equal(organization.find(row=>row[2]==='FILTER-0')[4],'0,5');assert.match(organization.find(row=>row[2]==='FILTER-0')[5],/DES numeric — 0,3.*DES string — 0,2/);assert.equal(organization.find(row=>row[2]==='OIL-0')[4],'5');assert.ok(!html.includes('0,30000000000000004'));assert.equal(JSON.stringify(db),before);
});

test('unknown demand stays visibly unknown and different units or incomplete metadata cannot become a misleading organization total',()=>{
 const db=database(),plan=db.generatorMaintenancePlans[0];plan.rows[0].components[0].qty=null;
 db.parts.push({...db.parts[0],id:'liquid',generatorId:'0',unit:'л'},{...db.parts[0],id:'no-article',generatorId:'0',article:''});plan.rows[1].components.push({partId:'liquid',qty:3},{partId:'no-article',qty:2});
 const html=printing.render(printing.prepare(db,0),{document:'spares'}),organization=tableRows(html,'organization-spares-table'),filter=organization.filter(row=>row[2]==='FILTER-0');
 assert.equal(filter.length,2);assert.equal(filter.find(row=>row[3]==='шт')[4],'Не задано');assert.equal(filter.find(row=>row[3]==='л')[4],'3');assert.equal(organization.find(row=>row[2]==='Не указан')[4],'2');assert.ok(html.includes('Требует уточнения'));
});

test('an existing approved snapshot needs no data migration or stock writes to print the two version2 forms',()=>{
 const db=approved(),before=JSON.stringify(db),originalHash=db.generatorMaintenancePlans[0].fingerprint,model=printing.prepare(db,0);for(const document of printing.documents)printing.render(model,{document});assert.equal(model.templateVersion,2);assert.equal(model.snapshot.version,1);assert.equal(model.fingerprint,originalHash);assert.equal(maintenance.snapshotDigest(model.snapshot),originalHash);assert.equal(JSON.stringify(db),before);
});

test('unknown documents and template versions are rejected rather than silently choosing a different form',()=>{
 const model=printing.prepare(database(),0);assert.throws(()=>printing.render(model,{document:'combined'}),{code:'MAINTENANCE_PRINT_DOCUMENT'});assert.throws(()=>printing.render({...model,templateVersion:3}),{code:'MAINTENANCE_PRINT_MODEL'});let calls=0;const options={};Object.defineProperty(options,'document',{enumerable:true,get(){calls++;return 'spares';}});assert.throws(()=>printing.render(model,options),{code:'MAINTENANCE_PRINT_DOCUMENT'});assert.equal(calls,0);
});
