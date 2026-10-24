/* Maintenance print forms v2. Both documents use the same immutable plan snapshot. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./platform-contracts.js'),require('./generator-maintenance.js'),require('./generator-maintenance-spares.js'));else root.GeneratorMaintenancePrint=factory(root.PlatformContracts,root.GeneratorMaintenance,root.GeneratorMaintenanceSpares);})(typeof globalThis==='object'?globalThis:this,function(contracts,maintenance,spares){
 'use strict';
 const names=['generatorMaintenancePlans','generators','genRecords','parts','partMovements','appMeta'];
 const own=(row,key)=>Object.prototype.hasOwnProperty.call(row,key),object=row=>row!==null&&typeof row==='object'&&!Array.isArray(row),clone=value=>JSON.parse(JSON.stringify(value));
 function fail(code,message){throw Object.assign(Error(message),{code,status:400});}
 function prepare(database,id,context={}){
  if(!contracts.identifier(id))fail('MAINTENANCE_PRINT_ID','Выберите график ТО');
  if(Array.isArray(context.readable)&&!context.readable.includes('*')&&names.some(name=>!context.readable.includes(name)))fail('ACCESS_DENIED','Нет доступа ко всем источникам графика ТО');
  const db=contracts.validateSections(Object.fromEntries(names.map(name=>[name,database[name]||[]])),names),matches=db.generatorMaintenancePlans.filter(row=>row.id===id);
  if(matches.length!==1)fail('MAINTENANCE_PRINT_SOURCE','График ТО не найден однозначно');
  const plan=matches[0];let snapshot;
  if(plan.status==='approved'){
   const s=plan.snapshot;
   if(!object(s)||plan.fingerprint!==maintenance.snapshotDigest(s)||!object(plan.approval)||s.planId!==plan.id||s.rootId!==plan.rootId||s.revision!==plan.revision||own(s,'previousId')!==own(plan,'previousId')||s.previousId!==plan.previousId||!object(s.approval)||maintenance.snapshotDigest(s.approval)!==maintenance.snapshotDigest(plan.approval))fail('MAINTENANCE_PRINT_SNAPSHOT','Снимок утверждённого графика повреждён');snapshot=clone(s);
  }else if(plan.status==='draft'){
   const find=(section,id)=>{const rows=db[section].filter(row=>row.id===id);if(rows.length!==1)fail('MAINTENANCE_PRINT_REFERENCE','Не подтверждены ссылки графика ТО');return rows[0];};
   if(!Array.isArray(plan.rows)||!object(plan.commission))fail('MAINTENANCE_PRINT_SOURCE','Черновик графика повреждён');
   snapshot={version:1,org:plan.org,year:plan.year,title:plan.title,commission:clone(plan.commission),rows:plan.rows.map(row=>{
    const generator=find('generators',row.generatorId);if(!Array.isArray(row.components))fail('MAINTENANCE_PRINT_SOURCE','Нет списка комплектующих');
    return {...clone(row),generator:{id:generator.id,name:generator.name||'',site:generator.site||generator.location||'',hours:null},components:row.components.map(component=>{const part=find('parts',component.partId);if(!own(part,'generatorId')||part.generatorId!==row.generatorId)fail('MAINTENANCE_PRINT_OWNER','Комплектующие принадлежат другой ДЭС');return {...clone(component),part:{id:part.id,name:part.name||'',article:part.article||'',unit:part.unit||'',generatorId:part.generatorId}};})};
   })};
  }else fail('MAINTENANCE_PRINT_STATE','Неизвестное состояние графика ТО');
  if(snapshot.version!==1||!Array.isArray(snapshot.rows)||!object(snapshot.commission))fail('MAINTENANCE_PRINT_SNAPSHOT','Снимок графика повреждён');
  return Object.freeze({version:1,templateVersion:2,planId:id,revision:plan.revision,status:plan.status,snapshot,approval:plan.status==='approved'?clone(plan.approval):null,fingerprint:plan.status==='approved'?plan.fingerprint:null});
 }
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const quantity=value=>typeof value==='number'&&Number.isFinite(value)?String(value).replace('.',','):'—';
 const line=value=>esc(value).replace(/\n/g,'<br>');
 const decimal=value=>value===null||value===undefined?'Не задано':esc(String(value).replace('.',','));
 const generatorName=row=>row?.name||'ДЭС № '+String(row?.id??'');
 function columns(widths){return '<colgroup>'+widths.map(width=>'<col style="width:'+width+'%">').join('')+'</colgroup>';}
 function heading(labels){return '<tr>'+labels.map(label=>'<th>'+label+'</th>').join('')+'</tr>';}
 function scheduleBody(snapshot){
  const groups=new Map();
  for(const row of snapshot.rows){const site=typeof row.site==='string'&&row.site.trim()?row.site:'Объект не указан';if(!groups.has(site))groups.set(site,[]);groups.get(site).push(row);}
  if(!groups.size)return '<p>В графике пока нет строк ТО.</p>';
  return [...groups.entries()].map(([site,rows])=>'<table class="schedule-table">'+columns([20,10,12,12,13,33])+ '<thead><tr class="group"><th colspan="6">Объект: '+esc(site)+'</th></tr>'+heading(['ДЭС','Вид ТО','Плановая дата','Целевой счётчик,<br>мтч','Счётчик при утверждении,<br>мтч','Работы / примечание'])+'</thead><tbody>'+rows.map(row=>'<tr><td>'+esc(generatorName(row.generator||{id:row.generatorId}))+'</td><td>'+esc(row.type||'Не указан')+'</td><td>'+esc(row.plannedDate||'Не задана')+'</td><td class="qty">'+quantity(row.plannedHours)+'</td><td class="qty">'+quantity(row.generator?.hours)+'</td><td>'+line(row.work)+(row.note?'<small>'+line(row.note)+'</small>':'')+'</td></tr>').join('')+'</tbody></table>').join('');
 }
 function sparesBody(snapshot){
  if(spares?.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружен расчёт потребности в ЗИП');
  const projection=spares.project(snapshot);
  const sourceText=item=>(item.sources||[]).map(source=>esc(source.type||'Вид ТО не указан')+' · '+esc(source.plannedDate||'Дата не задана')+' · '+decimal(source.qtyDecimal)+' '+esc(item.unit||'единица не указана')).join('<br>');
  const individual=projection.generators.map(generator=>'<table class="generator-spares-table">'+columns([6,27,19,8,13,27])+'<thead><tr class="group"><th colspan="6">ДЭС: '+esc(generatorName(generator))+'<small>Объекты: '+esc(generator.sites.join('; ')||'Не указаны')+'</small></th></tr>'+heading(['№','Наименование ЗИП','Артикул','Ед.','Потребность','Для каких ТО'])+'</thead><tbody>'+(generator.items.length?generator.items.map((item,index)=>'<tr><td>'+(index+1)+'</td><td>'+esc(item.name||'Наименование не указано')+'</td><td>'+esc(item.article||'Не указан')+'</td><td>'+esc(item.unit||'Не указана')+'</td><td class="qty">'+decimal(item.qtyDecimal)+'</td><td>'+sourceText(item)+'</td></tr>').join(''):'<tr><td colspan="6">ЗИП для плановых ТО этой ДЭС не указан.</td></tr>')+'</tbody></table>').join('');
  const organization='<table class="organization-spares-table">'+columns([6,27,19,8,13,27])+'<thead><tr class="group"><th colspan="6">Итоговая потребность по организации</th></tr>'+heading(['№','Наименование ЗИП','Артикул','Ед.','Всего требуется','Распределение по ДЭС'])+'</thead><tbody>'+(projection.organization.length?projection.organization.map((item,index)=>'<tr><td>'+(index+1)+'</td><td>'+esc(item.name||'Наименование не указано')+'</td><td>'+esc(item.article||'Не указан')+'</td><td>'+esc(item.unit||'Не указана')+'</td><td class="qty">'+decimal(item.qtyDecimal)+'</td><td>'+item.generators.map(generator=>esc(generatorName(generator))+' — '+decimal(generator.qtyDecimal)+' '+esc(item.unit||'единица не указана')).join('<br>')+'</td></tr>').join(''):'<tr><td colspan="6">В графике пока не указаны позиции ЗИП.</td></tr>')+'</tbody></table>';
  const warnings=(projection.warnings||[]).length?'<section class="warnings"><b>Требует уточнения</b><ul>'+projection.warnings.map(warning=>'<li>'+esc(warning.message)+'</li>').join('')+'</ul></section>':'';
  return '<p>Плановая потребность для ТО, включённых в график. Количества повторных ТО суммируются.</p>'+individual+organization+'<p class="note">Разные единицы измерения учитываются отдельно. Позиции с неполными реквизитами показаны раздельно. Неизвестное количество обозначено «Не задано» и требует уточнения.</p>'+warnings;
 }
 function render(model,options={}){
  if(!object(options)||Object.keys(options).some(key=>key!=='document')||Object.getOwnPropertyDescriptor(options,'document')?.get||Object.getOwnPropertyDescriptor(options,'document')?.set)fail('MAINTENANCE_PRINT_DOCUMENT','Выберите печатную форму');
  const document=options.document===undefined?'schedule':options.document;
  if(!['schedule','spares'].includes(document))fail('MAINTENANCE_PRINT_DOCUMENT','Неизвестная печатная форма');
  const s=model?.snapshot;if(model?.version!==1||model.templateVersion!==2||!object(s)||!Array.isArray(s.rows))fail('MAINTENANCE_PRINT_MODEL','Неверная версия печатной модели');
  const appendix=document==='spares',title=appendix?'Потребность в ЗИП':'График технического обслуживания ДЭС',person=(value,label)=>'<p>'+esc(label)+': '+esc(value?.position||'________________')+' <span class="signature">________________</span> '+esc(value?.name||'________________')+'</p>';
  const style='@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10pt;color:#111}h1{font-size:16pt;margin:10px 0;text-align:center}.meta,.appendix{text-align:center}.draft{font-size:15pt;color:#9b3100;text-align:center;font-weight:bold;border:2px solid;padding:8px}.approval{margin-left:55%;font-size:10pt}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:9pt;margin:16px 0}th,td{border:1px solid #333;padding:6px;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group;break-inside:avoid}tr{break-inside:avoid}.schedule-table tbody tr{break-inside:auto;page-break-inside:auto}th{background:#eee}.group th{background:#ddd;text-align:left}.group small{font-weight:normal}.qty{font-variant-numeric:tabular-nums;text-align:right}small{display:block;margin-top:4px;font-size:8.5pt}.signature{display:inline-block;margin:8px 12px}footer,.note{font-size:8pt;margin-top:12px}.commission{break-inside:avoid;break-after:avoid;page-break-after:avoid;margin-top:16px}footer{break-before:avoid;page-break-before:avoid;break-inside:avoid}.commission p{margin:3px 0}.warnings{border:1px solid #555;padding:8px;margin:12px 0}.warnings li{margin:4px 0}';
  const approval=model.status==='approved'?'<div class="approval"><b>УТВЕРЖДЕНО</b><p>'+esc(model.approval?.document)+'</p><p>Дата: '+esc(model.approval?.date)+'</p></div>':'<p class="draft">ПРОЕКТ · НЕ УТВЕРЖДЁН</p>';
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>'+style+'</style></head><body data-maintenance-document="'+document+'">'+approval+(appendix?'<p class="appendix"><b>Приложение № 1 к графику ТО ДЭС</b></p>':'')+'<h1>'+esc(title)+'</h1><p class="meta">'+esc(s.org||'Организация не указана')+' · '+esc(s.year??'Год не указан')+' · редакция '+esc(model.revision??1)+'</p>'+(s.title?'<p class="meta">'+esc(s.title)+'</p>':'')+(appendix?sparesBody(s):scheduleBody(s))+'<section class="commission"><b>Комиссия</b>'+person(s.commission?.chairman,'Председатель')+(s.commission?.members||[]).map(member=>person(member,'Член комиссии')).join('')+'</section><footer>Подписи проставляются на бумажном экземпляре. '+(appendix?'Перечень отражает плановую потребность и не является документом выдачи ЗИП.':'Перечень ЗИП приводится в отдельном приложении № 1.')+(model.fingerprint?'<br>Снимок графика и приложения: '+esc(model.fingerprint):'')+'</footer></body></html>';
 }
 return Object.freeze({apiVersion:1,templateVersion:2,documents:Object.freeze(['schedule','spares']),dependencies:()=>names.slice(),prepare,render});
});
