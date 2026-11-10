'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {launch}=require('./helpers/fuel-import-ui-harness.cjs'),core=require('../assets/core/registry-import.js');
let harness;before(async()=>{harness=await launch();});after(async()=>{await harness?.browser.close();});
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
function fixture(){
 const db={savedReestrs:[],vehicles:[],generators:[],drivers:[],repairs:[],vehicleTo:[],contragents:[]};
 const entry=(id,number,hash,workspace)=>core.buildRegister({id,number,date:'2026-10-01',title:'Synthetic register '+id,workspace,source:{id:hash.repeat(64)+'.pdf',sha256:hash.repeat(64),name:'Synthetic-'+id+'.pdf',size:42},reason:'Synthetic source review',duplicateReason:'Synthetic versions deliberately retained',invoices:[{invoiceNo:'001',date:'2026-09-25',supplier:'Synthetic supplier',description:'Synthetic invoice',sum:100,allocations:[{kind:'other',label:'Synthetic recipient',sum:100,expenseType:'other'}]}]},db);
 db.savedReestrs=[entry('synthetic-a','1','a','registries'),entry('synthetic-b','2','b','logistics')];
 return db;
}
async function pageFor({data=fixture(),readonly=false}={}){
 const page=await harness.browser.newPage({viewport:{width:1200,height:900}});await page.setContent('<main id="mainContent"></main>');
 await page.evaluate(({data,readonly})=>{
  window.data=data;window._loadWriteBlocked=false;window._sync={access:{readable:['*'],writable:readonly?[]:['savedReestrs','contragents']},platform:{negotiation:{writeCompatible:true}}};
  window.syncSessionStamp=()=> 'synthetic-session';window.htmlEsc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.__writes=[];window.__saved=[];window.__saveResult=true;window.saveData=async(data,options)=>{__writes.push(structuredClone(options));__saved.push(structuredClone(data));return __saveResult;};window.tvsWeb={params:()=>new URLSearchParams(),bddsArticles:()=>[]};
  window.XLSX={utils:{aoa_to_sheet:rows=>{window.__export=rows;return {};},book_new:()=>({}),book_append_sheet:()=>{}},write:()=>new Uint8Array([1])};
 },{data,readonly});
 for(const file of ['assets/core/request-fingerprint.js','assets/core/registry-import.js','assets/core/registry-accounting.js','assets/core/registry-counterparties.js','web/public/registries.js'])await page.addScriptTag({content:read(file)});
 await page.addStyleTag({content:read('web/public/registries.css')});
 await page.evaluate(()=>tvsWeb.registries.render());return page;
}
async function openReview(page){await page.locator('[data-registry-review-toggle]').click();return page.locator('[data-accounting-form]').first();}
async function choose(form,{separate=false,reason='Synthetic originals checked'}={}){
 if(separate)await form.locator('[data-accounting-separate]').check();else await form.locator('[data-accounting-choice]').selectOption('0');
 await form.locator('[data-accounting-reason]').fill(reason);await form.locator('[data-accounting-confirm]').check();
}

test('list totals hold cross-workspace duplicates while preserving source sums and explicit Excel statuses',async()=>{
 const page=await pageFor();try{
  assert.match(await page.locator('[data-accounting-summary="included"]').innerText(),/0,00/);
  assert.match(await page.locator('[data-accounting-summary="review"]').innerText(),/200,00/);
  assert.match(await page.locator('[data-registry-accounting]').innerText(),/Реестров.*Логистики/);
  await page.locator('[data-registry-export]').click();
  const rows=await page.evaluate(()=>__export);assert.equal(rows[0][10],'Исходная сумма');assert.equal(rows[0][11],'Статус учёта');assert.equal(rows[0][12],'Учитывается в итогах');assert.equal(rows[1][10],100);assert.equal(rows[1][11],'Требует сверки');assert.equal(rows[1][12],0);
  assert.equal(await page.evaluate(()=>__writes.length),0);
 }finally{await page.close();}
});

test('choosing one invoice saves both participants atomically and updates included and excluded totals',async()=>{
 const page=await pageFor();try{
  const before=await page.evaluate(()=>structuredClone(data));const form=await openReview(page);
  assert.equal(await form.locator('[data-accounting-choice] option').count(),3);
  await choose(form);await form.locator('[data-accounting-save]').click();await page.waitForFunction(()=>__writes.length===1&&!document.querySelector('[data-accounting-save]').disabled);
  const result=await page.evaluate(()=>({writes:__writes,saved:__saved[0],projection:RegistryAccounting.project(data)}));
  assert.deepEqual(result.writes,[{noMerge:true,requiredCanonicalSections:['savedReestrs']}]);
  assert.equal(result.projection.summary.included.sum,100);assert.equal(result.projection.summary.excluded.sum,100);assert.equal(result.projection.summary.review.invoices,0);
  assert.ok(result.saved.savedReestrs.every(entry=>entry.registryAccounting.decisions.length===1));
  for(let i=0;i<2;i++){const after=structuredClone(result.saved.savedReestrs[i]);delete after.registryAccounting;assert.deepEqual(after,before.savedReestrs[i]);}
  assert.match(await page.locator('[data-registry-status]').innerText(),/Решение сохранено/);
 }finally{await page.close();}
});

test('independent obligations require an explicit choice, reason and confirmation',async()=>{
 const page=await pageFor();try{
  const form=await openReview(page);await form.evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(await page.evaluate(()=>__writes.length),0);assert.match(await page.locator('[data-registry-status]').innerText(),/Подтвердите/);
  const refreshed=page.locator('[data-accounting-form]').first();await choose(refreshed,{separate:true});
  assert.equal(await refreshed.locator('[data-accounting-choice]').isDisabled(),true);assert.match(await refreshed.locator('[data-accounting-exception]').innerText(),/все записи/);
  await refreshed.locator('[data-accounting-save]').click();await page.waitForFunction(()=>__writes.length===1&&!document.querySelector('[data-accounting-save]').disabled);
  const projection=await page.evaluate(()=>RegistryAccounting.project(data));assert.equal(projection.summary.included.sum,200);assert.equal(projection.groups[0].separate,true);
 }finally{await page.close();}
});

test('a changed source blocks a stale decision and preserves the typed basis',async()=>{
 const page=await pageFor();try{
  const form=await openReview(page);await choose(form,{reason:'Synthetic basis must survive'});await page.evaluate(()=>data.savedReestrs[1].title='Synthetic changed source');
  await form.locator('[data-accounting-save]').click();assert.equal(await page.evaluate(()=>__writes.length),0);
  assert.match(await page.locator('[data-registry-status]').innerText(),/реестры изменились/);
  assert.equal(await page.locator('[data-accounting-reason]').inputValue(),'Synthetic basis must survive');
 }finally{await page.close();}
});

test('unconfirmed persistence restores accounting totals and keeps the review form',async()=>{
 const page=await pageFor();try{
  await page.evaluate(()=>__saveResult=false);const form=await openReview(page);await choose(form,{reason:'Synthetic retry basis'});await form.locator('[data-accounting-save]').click();
  await page.waitForFunction(()=>document.querySelector('[data-registry-status]').textContent.includes('ещё не подтверждено'));
  assert.match(await page.locator('[data-accounting-summary="included"]').innerText(),/0,00/);assert.equal(await page.locator('[data-accounting-reason]').inputValue(),'Synthetic retry basis');
  assert.equal(await page.evaluate(()=>data.savedReestrs.some(entry=>entry.registryAccounting)),false);
 }finally{await page.close();}
});

test('a canonical save rollback that replaces the database object keeps the typed review',async()=>{
 const page=await pageFor();try{
  await page.evaluate(()=>{const baseline=structuredClone(data);window.saveData=async()=>{window.data=structuredClone(baseline);return false;};});
  const form=await openReview(page);await choose(form,{reason:'Synthetic rollback preserves this basis'});await form.locator('[data-accounting-save]').click();
  await page.waitForFunction(()=>document.querySelector('[data-registry-status]').textContent.includes('ещё не подтверждено'));
  assert.equal(await page.locator('[data-accounting-reason]').inputValue(),'Synthetic rollback preserves this basis');assert.match(await page.locator('[data-accounting-summary="included"]').innerText(),/0,00/);
 }finally{await page.close();}
});

test('read-only access and restricted authoritative views cannot confirm a duplicate',async()=>{
 for(const restricted of [false,true]){
  const data=fixture();if(restricted)data.savedReestrs[0].registryAccountingView={version:1,restricted:true,invoices:[{invoiceId:data.savedReestrs[0].rows[0].registryInvoiceId,state:'review',reason:'Требует сверки'}]};
  const page=await pageFor({data,readonly:!restricted});try{const form=await openReview(page);assert.equal(await form.locator('[data-accounting-save]').isDisabled(),true);assert.equal(await page.evaluate(()=>__writes.length),0);if(restricted)assert.match(await page.locator('[data-accounting-restricted]').innerText(),/Часть записей недоступна/);}finally{await page.close();}
 }
});

test('an open invoice draft is not replaced by the duplicate review controls',async()=>{
 const page=await pageFor();try{
  await page.evaluate(()=>{tvsWeb.params=()=>new URLSearchParams('register='+encodeURIComponent(JSON.stringify('synthetic-a')));tvsWeb.registries.resetNavigation();tvsWeb.registries.render();});
  await page.locator('[data-invoice-field="description"]').fill('Synthetic unsaved description');
  assert.equal(await page.locator('[data-registry-accounting]').count(),0);assert.equal(await page.locator('[data-registry-editor]').count(),1);
  assert.equal(await page.locator('[data-invoice-field="description"]').inputValue(),'Synthetic unsaved description');assert.equal(await page.evaluate(()=>__writes.length),0);
 }finally{await page.close();}
});
