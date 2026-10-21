const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const schema=require('../assets/core/platform-schema.js');
let pw;try{pw=require('playwright');}catch{pw=createRequire(path.join(process.env.TVS_PLAYWRIGHT_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'package.json'))('playwright');}
let browser,page,errors;
function fixture(){
 const db=Object.fromEntries(schema.sections.map(name=>[name,[]]));
 db.vehicles=[{id:'v',plate:'SYNTHETIC-V',make:'Synthetic vehicle',driver:'Synthetic driver',org:'Synthetic organization',fuel:'diesel',fuelGrade:'ДТ',fuelBalance:923.537,norm:0.1234567,normCity:0,normHighway:0,normIdle:0,odometer:0}];
 db.generators=[{id:'g',name:'Synthetic DES',location:'Synthetic site',fuel:'diesel',fuelBalance:20,norm:0,norm100:0,norm50:0,normIdle:0,cost:0,tankId:'t'}];
 db.tanks=[{id:'t',name:'Synthetic tank',fuel:'diesel',balanceInit:923.537,reserveLevel:0},{id:'other',name:'Other tank',fuel:'diesel',balanceInit:100}];
 db.records=[{id:'r',vehicleId:'v',date:'2026-09-10',km:0,fuelIssued:1,fuelSum:10,fuelActual:0,fuelUsed:1,fuelIdle:1},{id:'r-legacy',vehicleId:'v',date:'2026-09-11',km:0,fuelIssued:1.23456,fuelSum:1.005,fuelActual:0}];
 db.genRecords=[{id:'gr',generatorId:'g',tankId:'t',date:'2026-09-10',hours:1,fuelIssued:0,fuelActual:0}];
 db.fuelPurchases=[{id:'p',vehicleId:'v',date:'2026-09-10',qty:1,sum:1,price:1,grade:'ДТ',cardNo:'',sourceOrg:'Synthetic organization'}];
 db.tankIncomes=[{id:'tax',tankId:'other',date:'2026-09-10',amount:1,sum:10,vatRate:1.05,vatAmount:0.105,grossSum:10.105,source:'Synthetic tax document'}];
 db.payments=[{id:'pay',date:'2026-09-10',sum:1.005,paidAmount:0,paid:false,description:'Synthetic legacy payment'},{id:'pay-full',date:'2026-09-10',sum:0.105,paid:true,description:'Legacy full paid without an explicit amount'}];
 db.monthlyFuel=[{id:'mf',vehicleId:'v',month:'2026-09',liters:1,sum:10}];
 db.costEntries=[{id:'cost',assetRef:'v:v',date:'2026-09-10',kind:'expense',amount:0.105,title:'Legacy precision',independent:true}];
 db.costProfiles=[{id:'profile',assetRef:'v:v',salaryRate:0.1234567,fuelPrice:1.123456,note:'Legacy precision'}];
 db.fuelCards=[{id:'fc_cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}];db.appMeta=[{id:'meta',toPlanInit:'synthetic'}];return db;
}
before(async()=>{const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await pw.chromium.launch({headless:true,executablePath:process.env.TVS_TEST_BROWSER||(!process.env.CI&&fs.existsSync(edge)?edge:undefined)});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:1280,height:900}});errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(({database,sections})=>{
  window.__token='synthetic-fuel-accounting-A';window.__disks={[window.__token]:JSON.stringify(database)};window.__revisions={};window.__writes=[];window.__hold=false;window.__mode='ok';window.__canonicalBasis=null;window.__closeReplies=[];
  window.__snapshot=token=>{const db=JSON.parse(window.__disks[token]),revs=window.__revisions[token]??={};for(const name of sections){db[name]??=[];revs[name]??=1;}return{data:db,revisions:{...revs},databaseToken:token,platform:{apiVersion:1,operations:1,outbox:1,commands:1}};};
  window.electronAPI={
   readSnapshot:async()=>JSON.stringify(window.__snapshot(window.__token)),
   writeSections:async raw=>{
    const request=JSON.parse(raw);window.__writes.push(request);if(window.__hold)await new Promise(resolve=>window.__release=resolve);
    if(window.__mode==='reject')return{ok:false,error:'Synthetic boundary save rejected'};
    if(window.__mode==='conflict')return{ok:false,conflicts:Object.keys(request.sections),error:'Synthetic dependency conflict',databaseToken:request.databaseToken};
    const db=JSON.parse(window.__disks[request.databaseToken]),revs=window.__revisions[request.databaseToken],canonical=structuredClone(request.sections);
    if(window.__canonicalBasis)for(const section of ['vehicles','generators','tanks'])for(const row of canonical[section]||[])if(row.fuelAccounting)row.fuelAccounting.basis=window.__canonicalBasis;
    for(const[name,rows]of Object.entries(canonical)){db[name]=rows;revs[name]++;}window.__disks[request.databaseToken]=JSON.stringify(db);
    return{ok:true,databaseToken:request.databaseToken,revisions:{...revs},...(window.__mode==='missingCanonical'?{}:{canonicalSections:canonical}),operationReceipt:{id:request.operation.id,digest:PlatformKernel.requestDigest(request),status:'committed'}};
   },onPrepareClose:callback=>{window.__prepareClose=callback;},finishClose:async response=>{window.__closeReplies.push(response);return true;}
  };
 },{database:fixture(),sections:schema.sections});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>typeof fuelAccountingOpen==='function'&&typeof data!=='undefined'&&data.vehicles.some(row=>row.id==='v'),{timeout:10000});
});
afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
async function open(section='vehicles',id=712){await page.evaluate(({section,id})=>fuelAccountingOpen(section,id),{section,id});const form=page.locator('#fuelAccountingForm');assert.equal(await form.count(),1,await page.evaluate(()=>document.querySelector('#globalToast')?.textContent||'Accounting form did not open'));return form;}
async function fill(form,opening='923,537'){await form.locator('[name="from"]').fill('2026-09-01');await form.locator('[name="opening"]').fill(opening);await form.locator('[name="basis"]').fill('Synthetic measured balance on 31 August 2026');}
async function review(form){await form.locator('[data-fa-review]').click();await page.waitForFunction(()=>!!document.querySelector('[data-fa-preview]')&&!document.querySelector('[data-fa-preview]').hidden);await form.locator('[name="confirm"]').check();}
async function submit(form){await form.locator('[data-fa-save]').click();}
async function closed(){await page.waitForFunction(()=>!document.querySelector('#wfModal.open'));}
async function error(){await page.waitForFunction(()=>!!document.querySelector('[data-fa-error]')?.textContent.trim());}

test('the shared input boundary distinguishes blank and zero and rejects prefixes, malformed grouping and excess precision',async()=>{
 const result=await page.evaluate(()=>{
  const invalid=['923,537 л','1 23,5','1.234,567','0.0001'];
  return {blank:precisionParse('',{scale:3,blank:'null'}),zero:precisionParse('0',{scale:3,blank:'null'}),grouped:precisionParse('1 234,567',{scale:3,blank:'error'}),bad:invalid.map(raw=>{try{precisionParse(raw,{scale:3,blank:'error'});return false;}catch{return true;}}),round:[fpRound('1.005'),fpRound('-1.005')],display:[fpNum(923.537),pcQty(923.537),pcQty(null),costMoney(0.105)]};
 });
 assert.equal(result.blank,null);assert.equal(result.zero,0);assert.equal(result.grouped,1234.567);assert.deepEqual(result.bad,[true,true,true,true]);assert.deepEqual(result.round,[1.01,-1.01]);assert.deepEqual(result.display,['923,537','923,537','—','0,105 ₽']);
});

test('a note-only vehicle edit preserves explicit zeros and untouched legacy precision',async()=>{
 const result=await page.evaluate(async()=>{data.vehicles[0].norm=0.1234567;selectedVehicleId='v';openEditVehicle('v');document.getElementById('vm_note').value='Only a note';await saveVehicle();return{row:data.vehicles[0],writes:window.__writes.length,toast:document.getElementById('globalToast')?.textContent};});
 assert.equal(result.writes,1,JSON.stringify(result));assert.equal(result.row.norm,0.1234567);for(const field of ['normCity','normHighway','normIdle','odometer'])assert.equal(result.row[field],0);assert.equal(result.row.fuelBalance,923.537);
});

test('changing a numeric vehicle value validates the complete token and retains rejected input',async()=>{
 await page.evaluate(async()=>{selectedVehicleId='v';openEditVehicle('v');const input=document.getElementById('vm_norm');input.type='text';input.value='12,3456789';await saveVehicle();});
 assert.equal(await page.evaluate(()=>window.__writes.length),0);assert.equal(await page.locator('#vm_norm').inputValue(),'12,3456789');assert.match(await page.locator('#globalToast').innerText(),/знаков/);
 await page.locator('#vm_norm').fill('12,345678');await page.evaluate(()=>saveVehicle());assert.equal(await page.evaluate(()=>data.vehicles[0].norm),12.345678);
});

test('literal zero in the vehicle journal remains zero while a cleared field becomes null',async()=>{
 await page.evaluate(async()=>{selectedVehicleId='v';openEditRecord('r');for(const id of ['rec_fuel_issued','rec_fuel_sum','rec_fuel_idle'])document.getElementById(id).value='0';document.getElementById('rec_fuel_used').value='';await saveRecord();});
 const row=await page.evaluate(()=>data.records[0]);assert.equal(row.fuelIssued,0);assert.equal(row.fuelSum,0);assert.equal(row.fuelIdle,0);assert.equal(row.fuelUsed,null);
});

test('journal note edits preserve submillilitre and subcent legacy facts; changed excessive precision is refused',async()=>{
 await page.evaluate(async()=>{selectedVehicleId='v';openEditRecord('r-legacy');document.getElementById('rec_note').value='Preserve source precision';await saveRecord();});
 assert.deepEqual(await page.evaluate(()=>[data.records[1].fuelIssued,data.records[1].fuelSum]),[1.23456,1.005]);
 await page.evaluate(async()=>{openEditRecord('r-legacy');document.getElementById('rec_fuel_issued').value='1.23457';await saveRecord();});assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.equal(await page.locator('#rec_fuel_issued').inputValue(),'1.23457');
});

test('generator card zeros and an empty optional maintenance meter do not become null or NaN',async()=>{
 await page.evaluate(async()=>{selectedGeneratorId='g';openEditGenerator('g');document.getElementById('gm_note').value='Only a note';await saveGenerator();openAddToRecord('g');document.getElementById('to_date').value='10.09.2026';document.getElementById('to_type').value='Synthetic TO';document.getElementById('to_hours').value='';await saveToRecord();});
 const result=await page.evaluate(()=>({g:data.generators[0],to:data.toRecords[0],writes:window.__writes.length}));assert.equal(result.writes,2);assert.equal(result.g.norm,0);assert.equal(result.g.cost,0);assert.equal(result.to.hours,null);
});

test('fuel purchase line multiplication rounds the exact decimal product once and price keeps six decimals',async()=>{
 await page.evaluate(()=>{fpEdit('p');document.getElementById('fpe_qty').value='1.005';document.getElementById('fpe_price').value='1';fpEditRecalc();});assert.equal(await page.locator('#fpe_sum').inputValue(),'1.01');
 await page.evaluate(async()=>{document.getElementById('fpe_qty').value='1';document.getElementById('fpe_price').value='1.123456';document.getElementById('fpe_sum').value='1.12';await fpEditSave('p');});
 const row=await page.evaluate(()=>data.fuelPurchases[0]);assert.equal(row.price,1.123456);assert.equal(row.sum,1.12);
});

test('monthly fuel and reconciliation use strict comma-aware input and preserve zero',async()=>{
 await page.evaluate(async()=>{const el=document.createElement('input');el.dataset.vid='v';el.dataset.month='2026-09';el.dataset.mfid='mf';el.dataset.field='liters';el.value='0';await mfSaveRow(el);await frcSet('2026-09','Synthetic provider','litres','923,537');});
 assert.equal(await page.evaluate(()=>data.monthlyFuel[0].liters),0);assert.equal(await page.evaluate(()=>data.fuelPeriods[0].recon['Synthetic provider'].litres),923.537);
 const count=await page.evaluate(()=>window.__writes.length);assert.equal(await page.evaluate(()=>frcSet('2026-09','Synthetic provider','sum','10,001')),false);assert.equal(await page.evaluate(()=>window.__writes.length),count);
});

test('inventory records a one-millilitre difference and keeps exact legacy tank balances',async()=>{
 assert.equal(await page.evaluate(()=>computeTankBalance('t').balance),923.537);assert.equal(await page.evaluate(()=>wfTankBalanceAt('t','2026-09-10')),923.537);
 await page.evaluate(()=>{wfInventory();document.getElementById('wfInvTank').value='t';document.getElementById('wfInvDate').value='2026-09-10';document.getElementById('wfInvQty').value='923.538';document.getElementById('wfInvReason').value='Synthetic measured difference';document.getElementById('wfInventoryForm').requestSubmit();});
 await page.waitForFunction(()=>window.__writes.length===1);const row=await page.evaluate(()=>data.fuelMovements[0]);assert.equal(row.qty,0.001);assert.equal(row.toTankId,'t');assert.equal(row.balanceBefore,923.537);assert.equal(await page.evaluate(()=>computeTankBalance('t').balance),923.538);
});

test('tank decimal additions and cancellation remain exact without binary drift',async()=>{
 const values=await page.evaluate(()=>{data.tanks[0].balanceInit=0.1;data.tankIncomes=[{id:'income',tankId:'t',date:'2026-09-10',amount:0.2}];data.genRecords[0].fuelIssued=0.3;return[computeTankBalance('t').balance,wfTankBalanceAt('t','2026-09-10')];});assert.deepEqual(values,[0,0]);
});

test('cost notes preserve historical fractional cents and invalid new amounts keep the form open',async()=>{
 await page.evaluate(()=>{costEditEntry('cost');document.querySelector('#costEntryForm [name="note"]').value='Only a note';document.getElementById('costEntryForm').requestSubmit();});await page.waitForFunction(()=>window.__writes.length===1&&!costPending);assert.equal(await page.evaluate(()=>data.costEntries[0].amount),0.105);
 await page.evaluate(()=>{costEditEntry('cost');document.querySelector('#costEntryForm [name="amount"]').value='0.106';document.getElementById('costEntryForm').requestSubmit();});assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.match(await page.locator('#costEntryError').innerText(),/знаков/);assert.equal(await page.locator('#costEntryForm [name="amount"]').inputValue(),'0.106');
});

test('cost rates accept six decimals and preserve an untouched older seven-decimal rate',async()=>{
 await page.evaluate(()=>{costAssetRef='v:v';costEditProfile();document.querySelector('#costProfileForm [name="note"]').value='Only a note';document.getElementById('costProfileForm').requestSubmit();});await page.waitForFunction(()=>window.__writes.length===1&&!costPending);assert.equal(await page.evaluate(()=>data.costProfiles[0].salaryRate),0.1234567);
 await page.evaluate(()=>{costEditProfile();document.querySelector('#costProfileForm [name="fuelPrice"]').value='1.654321';document.getElementById('costProfileForm').requestSubmit();});await page.waitForFunction(()=>window.__writes.length===2&&!costPending);assert.equal(await page.evaluate(()=>data.costProfiles[0].fuelPrice),1.654321);
});

test('new accounting boundaries reject excess precision and preserve the entered draft',async()=>{
 const form=await open('vehicles','v');await fill(form,'923,5371');await form.locator('[data-fa-review]').click();await error();assert.equal(await page.evaluate(()=>window.__writes.length),0);assert.equal(await form.locator('[name="opening"]').inputValue(),'923,5371');assert.match(await form.locator('[data-fa-error]').innerText(),/знаков/);
});

test('payment note edits preserve source fractional cents and changed money requires kopecks',async()=>{
 await page.evaluate(async()=>{await openEditPayment('pay');document.getElementById('pay_note').value='Only a note';await savePayment();});assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.equal(await page.evaluate(()=>data.payments[0].sum),1.005);
 await page.evaluate(async()=>{await openEditPayment('pay');document.getElementById('pay_sum').value='1.006';await savePayment();});assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.equal(await page.locator('#pay_sum').inputValue(),'1.006');assert.match(await page.locator('#globalToast').innerText(),/знаков/);
 await page.evaluate(async()=>{document.getElementById('pay_sum').value='1.01';document.getElementById('pay_paid_amount').value='0';await savePayment();});assert.equal(await page.evaluate(()=>data.payments[0].sum),1.01);assert.equal(await page.evaluate(()=>data.payments[0].paidAmount),0);
});

test('note-only editing a legacy fully paid payment preserves its absent paidAmount and fractional-cent fact',async()=>{
 await page.evaluate(async()=>{await openEditPayment('pay-full');document.getElementById('pay_note').value='Only a note on historical payment';await savePayment();});
 const result=await page.evaluate(()=>({row:data.payments.find(row=>row.id==='pay-full'),written:window.__writes[0]?.sections.payments.find(row=>row.id==='pay-full'),writes:window.__writes.length}));assert.equal(result.writes,1);assert.equal(result.row.sum,0.105);assert.equal(result.row.paid,true);assert.equal(Object.hasOwn(result.row,'paidAmount'),false);assert.equal(Object.hasOwn(result.written,'paidAmount'),false);assert.equal(result.row.note,'Only a note on historical payment');
});

test('financial totals use exact decimal arithmetic and invalid facts are never silently converted to zero',async()=>{
 const result=await page.evaluate(()=>({total:finSum([0.1,0.2]),debt:finDebt({sum:0.3,paidAmount:0.1}),invalid:[NaN,Infinity,'bad'].map(raw=>{try{finNumber(raw);return false;}catch{return true;}})}));assert.equal(result.total,0.3);assert.equal(result.debt,0.2);assert.deepEqual(result.invalid,[true,true,true]);
});

test('procurement quantities keep thousandths and optional unknown values remain distinct from zero',async()=>{
 await page.evaluate(()=>{pcEditRule('tank','t');const form=document.getElementById('pcRuleForm');form.elements.pcReserve.value='0';form.elements.pcDaily.value='0.001';form.requestSubmit();});await page.waitForFunction(()=>window.__writes.length===1);const row=await page.evaluate(()=>data.procurementRules[0]);assert.equal(row.reserveQty,0);assert.equal(row.expectedDaily,0.001);
 await page.evaluate(()=>{pcEditRule('tank','t');const form=document.getElementById('pcRuleForm');form.elements.pcDaily.value='';form.requestSubmit();});await page.waitForFunction(()=>window.__writes.length===2);assert.equal(await page.evaluate(()=>data.procurementRules[0].expectedDaily),null);
 await page.evaluate(()=>{pcEditRule('tank','t');const form=document.getElementById('pcRuleForm');form.elements.pcReserve.value='0.0001';form.requestSubmit();});assert.equal(await page.evaluate(()=>window.__writes.length),2);assert.match(await page.locator('#pcRuleError').innerText(),/знаков/);
});

test('tank forms retain zero and accept exact millilitres while refusing partial tokens',async()=>{
 await page.evaluate(async()=>{selectedTankId='t';openEditTank('t');document.getElementById('tk_capacity').value='0';await saveTank();openAddTankIncome();const field=document.getElementById('ti_amount');field.type='text';field.value='1,001 л';await saveTankIncome();});assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.equal(await page.evaluate(()=>data.tanks[0].capacity),0);assert.equal(await page.locator('#ti_amount').inputValue(),'1,001 л');
 await page.locator('#ti_amount').fill('1,001');await page.evaluate(()=>saveTankIncome());assert.equal(await page.evaluate(()=>data.tankIncomes.at(-1).amount),1.001);assert.equal(await page.evaluate(()=>data.tankIncomes.at(-1).sum),0);
});

test('generator meter auto-calculation preserves thousandths rather than rounding to tenths',async()=>{
 await page.evaluate(()=>{selectedGeneratorId='g';openAddGenRecord();document.getElementById('gen_rec_meter_start').value='923.537';document.getElementById('gen_rec_hours').value='0.001';calcGenHoursEnd();});assert.equal(await page.locator('#gen_rec_meter_end').inputValue(),'923.538');
 await page.evaluate(()=>{document.getElementById('gen_rec_meter_end').value='923.539';calcGenHoursFromMeter();});assert.equal(await page.locator('#gen_rec_hours').inputValue(),'0.002');
});

test('generator estimated consumption uses the same exact half-millilitre rounding as the trusted policy',async()=>{
 await page.evaluate(()=>{Object.assign(data.generators[0],{power:100,norm100:1.126,norm50:0.563,normIdle:0.14});selectedGeneratorId='g';openAddGenRecord();document.getElementById('gen_rec_hours').value='1';document.getElementById('gen_rec_load').value='75';calcGenActualAuto();});assert.equal(await page.locator('#gen_rec_fuel_actual').inputValue(),'0.845');assert.equal(await page.evaluate(()=>genActualSpent(data.generators[0],{hours:1,load:75})),0.845);
});

test('budget detail, total footer and exported difference agree exactly for 0.3 minus 0.1',async()=>{
 const result=await page.evaluate(()=>{budgetYear=2026;budgetCompareMonth='all';budgetGroupBy='category';Object.assign(budgetScope,{org:'',object:'',category:''});data.budget=[{id:'synthetic-budget',year:2026,month:9,category:'Synthetic category',sum:0.1}];data.payments=[{id:'synthetic-payment',date:'2026-09-10',category:'Synthetic category',sum:0.3,paidAmount:0}];const host=document.createElement('div');host.innerHTML=renderBudgetPlanFactHtml();const detail=host.querySelector('tbody tr').children[5].textContent,total=host.querySelector('tfoot tr').children[5].textContent;let workbook;const original=XLSX.writeFile;try{XLSX.writeFile=wb=>{workbook=wb;};exportBudgetToXlsx();}finally{XLSX.writeFile=original;}return{detail,total,exported:workbook.Sheets['План-факт'].F2.v};});assert.deepEqual(result,{detail:'0,20',total:'0,20',exported:0.2});
});

test('manual daily fuel plans parse complete localized decimals without changing source data',async()=>{
 const result=await page.evaluate(()=>{const before=JSON.stringify(data),draft={org:'Synthetic organization',month:'2026-09',rows:[{date:'2026-09-12',vehicleId:'v',cardNo:'',grade:'ДТ',qty:'1,005',sum:'10,01'}]},plan=gsmManualPlan(data,draft);draft.rows[0].qty='1,005 л';let invalid=false;try{gsmManualPlan(data,draft);}catch{invalid=true;}return{qty:plan.entries[0].qty,sum:plan.entries[0].sum,invalid,unchanged:before===JSON.stringify(data)};});assert.deepEqual(result,{qty:1.005,sum:10.01,invalid:true,unchanged:true});
});

test('a rejected reconciliation value remains visible after blur and prevents close flush',async()=>{
 await page.evaluate(async()=>{frcMonth='2026-09';openGenericModal('Synthetic reconciliation',frcHtml());const input=document.querySelector('[data-frc-field="litres"]');input.value='0.0001';input.focus();await frcInputChanged(input);input.blur();});
 assert.equal(await page.locator('[data-frc-field="litres"]').inputValue(),'0.0001');assert.equal(await page.evaluate(()=>frcHasPendingEdits()),true);assert.equal(await page.evaluate(()=>frcFlush()),false);assert.equal(await page.evaluate(()=>platformFlushForClose()),false);assert.equal(await page.evaluate(()=>window.__writes.length),0);
});

test('document tax forms preserve legacy VAT and gross precision, reject new fractional cents and accept explicit zero',async()=>{
 await page.evaluate(()=>{fuelRepYear='2026';frEditDocumentTax();document.getElementById('frTaxKind').value='purchase';document.getElementById('frTaxForm').requestSubmit();});await page.waitForFunction(()=>window.__writes.length===1);assert.deepEqual(await page.evaluate(()=>[data.tankIncomes[0].vatAmount,data.tankIncomes[0].grossSum]),[0.105,10.105]);
 await page.evaluate(()=>{frEditDocumentTax();document.getElementById('frTaxAmount').value='0.106';document.getElementById('frTaxForm').requestSubmit();});assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.equal(await page.locator('#frTaxAmount').inputValue(),'0.106');assert.match(await page.locator('#frTaxError').innerText(),/знаков/);
 await page.evaluate(()=>{document.getElementById('frTaxAmount').value='0';document.getElementById('frTaxRate').value='0';document.getElementById('frTaxGross').value='10';document.getElementById('frTaxForm').requestSubmit();});await page.waitForFunction(()=>window.__writes.length===2);assert.deepEqual(await page.evaluate(()=>[data.tankIncomes[0].vatRate,data.tankIncomes[0].vatAmount,data.tankIncomes[0].grossSum]),[0,0,10]);
});

