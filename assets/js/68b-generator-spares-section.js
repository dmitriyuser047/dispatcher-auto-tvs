// A read-only view of ZIP demand from one saved maintenance-plan snapshot.
// The DES filter changes the screen only; the separate PDF contains the plan.
let gmSparesSectionState=null;
const gmSparesSectionEsc=value=>htmlEsc(String(value??''));
const gmSparesSectionId=value=>typeof value==='string'&&value!==''||typeof value==='number'&&Number.isFinite(value);
const gmSparesSectionQuantity=value=>value===null?'Не определено':precisionFormat(value);
const gmSparesSectionYear=value=>JSON.stringify([typeof value,value]);
function gmSparesSectionContextStamp(){const context=platformSessionContext();return JSON.stringify([wfCommandContextStamp(),context.policyStamp??null,context.accessPolicy??null]);}
function gmSparesSectionSources(){
 if(typeof GeneratorMaintenancePrint==='undefined'||typeof GeneratorMaintenanceSpares==='undefined')throw Error('Правила перечня ЗИП не загружены. Обновите окно программы.');
 const names=GeneratorMaintenancePrint.dependencies(),context=platformSessionContext();
 if(Array.isArray(context.readable)&&!context.readable.includes('*')&&names.some(name=>!context.readable.includes(name)))throw Error('Нет права чтения всех источников перечня ЗИП и графика ТО.');
 if(names.some(name=>Array.isArray(context.accessPolicy?.sections?.[name]?.readFields)&&!context.accessPolicy.sections[name].readFields.includes('*')))throw Error('Для перечня ЗИП нужен полный просмотр реквизитов связанных документов.');
 if(typeof platformSaveBaseline!=='function')throw Error('Сохранённая редакция графика не подтверждена. Дождитесь загрузки базы.');
 if(JSON.stringify(platformSaveBaseline().generatorMaintenancePlans||[])!==JSON.stringify(data.generatorMaintenancePlans||[]))throw Error('В графиках есть несохранённые изменения. Сначала сохраните или загрузите подтверждённую редакцию.');
 return {context,names,source:JSON.stringify(names.map(name=>[name,data[name]||[]]))};
}
function gmSparesSectionTable(items){
 const esc=gmSparesSectionEsc;
 return '<div class="gm-ui-scroll"><table class="tbl"><thead><tr><th>Наименование ЗИП</th><th>Артикул</th><th>Ед.</th><th>Потребность по графику</th><th>Применение</th></tr></thead><tbody>'+items.map(item=>'<tr><th>'+esc(item.name||'Наименование не указано')+'</th><td>'+esc(item.article||'Не указан')+'</td><td>'+esc(item.unit||'Не указана')+'</td><td>'+esc(gmSparesSectionQuantity(item.qtyDecimal))+'</td><td><details><summary>ТО: '+item.sources.length+'</summary><ul>'+item.sources.map(source=>'<li>'+esc(source.type||'Вид ТО не указан')+' · '+esc(source.plannedDate||'Дата не задана')+' · '+esc(gmSparesSectionQuantity(source.qtyDecimal))+' '+esc(item.unit||'')+'</li>').join('')+'</ul></details></td></tr>').join('')+'</tbody></table></div>';
}
function renderGeneratorSparesSection(){
 const main=document.getElementById('mainContent');if(!main)return;
 const database=data,stamp=gmSparesSectionContextStamp(),esc=gmSparesSectionEsc;
 if(!gmSparesSectionState||gmSparesSectionState.database!==database||gmSparesSectionState.stamp!==stamp)gmSparesSectionState={database,stamp,org:null,year:null,planId:null,generatorId:null};
 const state=gmSparesSectionState;
 main.innerHTML='<section class="wf-workspace gm-ui-form" id="generatorSparesSection"><div class="wf-heading"><div><h2>Перечень ЗИП к графику ТО</h2><p>Отдельные списки по каждой ДЭС и итог по организации. Потребность берётся из комплектующих сохранённого графика.</p></div></div><p role="alert" class="gm-ui-warning" data-gms-error></p><div data-gms-content></div></section>';
 const view=main.querySelector('#generatorSparesSection'),error=view.querySelector('[data-gms-error]'),host=view.querySelector('[data-gms-content]');let sources,plans,model=null,projection=null;
 try{
  sources=gmSparesSectionSources();plans=(data.generatorMaintenancePlans||[]).filter(plan=>gmSparesSectionId(plan.id)&&['draft','approved'].includes(plan.status));
  const orgs=[...new Set(plans.map(plan=>typeof plan.org==='string'?plan.org:''))].sort((a,b)=>a.localeCompare(b,'ru'));
  if(state.org!==null&&!orgs.includes(state.org)){state.org=null;state.planId=null;state.generatorId=null;}
  const byOrg=plans.filter(plan=>state.org===null||(typeof plan.org==='string'?plan.org:'')===state.org),years=[...new Set(byOrg.map(plan=>plan.year??null))].sort((a,b)=>String(a??'').localeCompare(String(b??'')));
  if(state.year!==null&&!years.some(year=>gmSparesSectionYear(year)===state.year)){state.year=null;state.planId=null;state.generatorId=null;}
  const selectedPlans=byOrg.filter(plan=>state.year===null||gmSparesSectionYear(plan.year??null)===state.year);
  if(!selectedPlans.some(plan=>plan.id===state.planId)){state.planId=selectedPlans.length===1?selectedPlans[0].id:null;state.generatorId=null;}
  const selected=selectedPlans.find(plan=>plan.id===state.planId);
  if(selected)try{model=GeneratorMaintenancePrint.prepare(data,selected.id,sources.context);projection=GeneratorMaintenanceSpares.project(model.snapshot);if(state.generatorId!==null&&!projection.generators.some(generator=>generator.id===state.generatorId))state.generatorId=null;}catch(failure){model=null;projection=null;error.textContent=failure.message;}
  const options=(values,current,label,text)=>'<option value="">'+label+'</option>'+values.map((value,index)=>'<option value="'+index+'"'+(value===current?' selected':'')+'>'+esc(text(value))+'</option>').join('');
  host.innerHTML='<div class="gm-ui-grid"><label>Организация<select data-gms-org>'+options(orgs,state.org,'Все организации',org=>org||'Организация не указана')+'</select></label><label>Год<select data-gms-year>'+options(years,state.year===null?undefined:years.find(year=>gmSparesSectionYear(year)===state.year),'Все годы',year=>year??'Год не указан')+'</select></label><label class="gm-ui-wide">Сохранённый график<select data-gms-plan><option value="">Выберите график ТО</option>'+selectedPlans.map((plan,index)=>'<option value="'+index+'"'+(plan.id===state.planId?' selected':'')+'>'+esc([plan.org||'Организация не указана',plan.year??'Год не указан',plan.title||'Без названия',plan.status==='approved'?'Утверждён':'Черновик','ред. '+(plan.revision??1)].join(' · '))+'</option>').join('')+'</select></label><label class="gm-ui-wide">ДЭС на экране<select data-gms-generator>'+options(projection?.generators||[],projection?.generators.find(generator=>generator.id===state.generatorId),'Все ДЭС выбранного графика',generator=>generator.name||'ДЭС № '+String(generator.id))+'</select></label></div><div class="gm-ui-actions"><button type="button" class="btn btn-primary" data-gms-pdf'+(!model?' disabled':'')+'>Скачать перечень по организации в PDF</button><button type="button" class="btn btn-ghost" data-gms-open-plan'+(!model?' disabled':'')+'>Открыть график ТО</button></div><p class="wf-note">PDF содержит все ДЭС выбранного графика и итоги по организации. Фильтр ДЭС меняет только экран.</p><div data-gms-list></div>';
  const list=host.querySelector('[data-gms-list]');
  if(!plans.length)list.innerHTML='<p>Сохранённых графиков ТО пока нет. Создайте и сохраните график в разделе «Генераторы → График ТО организации», добавив комплектующие для ТО.</p>';
  else if(!model)list.innerHTML='<p>Выберите организацию, год и сохранённый график, чтобы показать перечень ЗИП. Редакции графиков не суммируются между собой.</p>';
  else{
   const shown=projection.generators.filter(generator=>state.generatorId===null||generator.id===state.generatorId),hasItems=projection.organization.length>0;
   list.innerHTML='<p data-gms-plan-state><b>'+esc(model.status==='approved'?'Утверждённая редакция':'Проект · не утверждён')+'</b> · '+esc(model.snapshot.org||'Организация не указана')+' · '+esc(model.snapshot.year??'Год не указан')+' · ред. '+esc(model.revision??1)+'</p>'+(!hasItems?'<p class="gm-ui-warning" data-gms-empty>Перечень берётся из комплектующих, указанных в графике ТО. Добавьте позиции в «Комплект на одно выполнение» и сохраните график. Остатки склада сами в план не подставляются.</p>':'')+shown.map((generator,index)=>'<section data-gms-des="'+index+'"><h3>'+esc(generator.name||'ДЭС № '+String(generator.id))+'</h3><p>Объекты: '+esc(generator.sites.filter(Boolean).join('; ')||'Не указаны')+'</p>'+(generator.items.length?gmSparesSectionTable(generator.items):'<p>Для плановых ТО этой ДЭС комплектующие не указаны.</p>')+'</section>').join('')+'<section data-gms-organization><h3>Итоги по организации · весь выбранный график</h3><div class="gm-ui-scroll"><table class="tbl"><thead><tr><th>Наименование ЗИП</th><th>Артикул</th><th>Ед.</th><th>Всего требуется</th><th>По ДЭС</th></tr></thead><tbody>'+projection.organization.map(item=>'<tr><th>'+esc(item.name||'Наименование не указано')+'</th><td>'+esc(item.article||'Не указан')+'</td><td>'+esc(item.unit||'Не указана')+'</td><td data-gms-total>'+esc(gmSparesSectionQuantity(item.qtyDecimal))+'</td><td>'+item.generators.map(generator=>esc(generator.name||'ДЭС № '+String(generator.id))+' — '+esc(gmSparesSectionQuantity(generator.qtyDecimal))+' '+esc(item.unit||'')).join('<br>')+'</td></tr>').join('')+'</tbody></table></div>'+(!hasItems?'<p>Позиции ЗИП в графике не указаны.</p>':'')+'</section>'+((projection.warnings||[]).length?'<div class="gm-ui-warning">'+projection.warnings.map(warning=>'<p>'+esc(warning.message)+'</p>').join('')+'</div>':'');
  }
  const capturedModel=model?JSON.stringify(model):null;
  const current=()=>{if(!view.isConnected||data!==database||gmSparesSectionContextStamp()!==stamp||gmSparesSectionState!==state||gmSparesSectionSources().source!==sources.source)throw Error('База, права или источники перечня изменились.');if(model&&JSON.stringify(GeneratorMaintenancePrint.prepare(data,model.planId,platformSessionContext()))!==capturedModel)throw Error('Редакция графика изменилась.');};
  const action=handler=>()=>{try{current();handler();}catch(failure){host.replaceChildren();if(gmSparesSectionState===state)gmSparesSectionState=null;error.textContent=failure.message+' Обновите данные из базы перед повторным открытием раздела.';if(view.isConnected)error.scrollIntoView({block:'nearest'});}};
  host.querySelector('[data-gms-org]').onchange=action(()=>{const value=host.querySelector('[data-gms-org]').value;state.org=value===''?null:orgs[Number(value)];state.year=null;state.planId=null;state.generatorId=null;renderGeneratorSparesSection();});
  host.querySelector('[data-gms-year]').onchange=action(()=>{const value=host.querySelector('[data-gms-year]').value;state.year=value===''?null:gmSparesSectionYear(years[Number(value)]);state.planId=null;state.generatorId=null;renderGeneratorSparesSection();});
  host.querySelector('[data-gms-plan]').onchange=action(()=>{const value=host.querySelector('[data-gms-plan]').value;state.planId=value===''?null:selectedPlans[Number(value)]?.id??null;state.generatorId=null;renderGeneratorSparesSection();});
  host.querySelector('[data-gms-generator]').onchange=action(()=>{const value=host.querySelector('[data-gms-generator]').value;state.generatorId=value===''?null:projection?.generators[Number(value)]?.id??null;renderGeneratorSparesSection();});
  host.querySelector('[data-gms-pdf]').onclick=action(()=>{if(!model)throw Error('Сначала выберите сохранённый график');printGeneratorMaintenanceSpares(model.planId);});
  host.querySelector('[data-gms-open-plan]').onclick=action(()=>{if(!model)throw Error('Сначала выберите сохранённый график');generatorMaintenanceEdit(model.planId);});
 }catch(failure){error.textContent=failure.message;}
}
