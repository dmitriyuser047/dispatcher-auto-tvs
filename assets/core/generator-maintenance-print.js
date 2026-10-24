/* Maintenance schedule template v1. Separate from existing sealed document templates. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./platform-contracts.js'),require('./generator-maintenance.js'));else root.GeneratorMaintenancePrint=factory(root.PlatformContracts,root.GeneratorMaintenance);})(typeof globalThis==='object'?globalThis:this,function(contracts,maintenance){
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
  return Object.freeze({version:1,templateVersion:1,planId:id,revision:plan.revision,status:plan.status,snapshot,approval:plan.status==='approved'?clone(plan.approval):null,fingerprint:plan.status==='approved'?plan.fingerprint:null});
 }
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const quantity=value=>typeof value==='number'&&Number.isFinite(value)?String(value).replace('.',','):'—';
 function render(model){
  const s=model.snapshot;if(model.version!==1||!object(s)||!Array.isArray(s.rows))fail('MAINTENANCE_PRINT_MODEL','Неверная печатная модель');
  const groups=new Map();for(const row of s.rows){const site=typeof row.site==='string'&&row.site.trim()?row.site:'Объект не указан';if(!groups.has(site))groups.set(site,[]);groups.get(site).push(row);}
  const body=[...groups.entries()].map(([site,rows])=>'<tbody><tr class="site"><th colspan="9">Объект: '+esc(site)+'</th></tr>'+rows.slice().sort((a,b)=>String(a.generator?.name||'').localeCompare(String(b.generator?.name||''),'ru')).map(row=>{
   const components=Array.isArray(row.components)&&row.components.length?row.components:[null];
   return components.map((component,index)=>'<tr>'+(index===0?'<td rowspan="'+components.length+'">'+esc(row.generator?.name||row.generatorId)+'</td><td rowspan="'+components.length+'">'+esc(row.type||'Не указан')+'</td><td rowspan="'+components.length+'">'+esc(row.plannedDate||'Не задана')+'</td><td rowspan="'+components.length+'">'+quantity(row.plannedHours)+'</td><td rowspan="'+components.length+'">'+quantity(row.generator?.hours)+'</td><td rowspan="'+components.length+'">'+esc(row.work).replace(/\n/g,'<br>')+(row.note?'<small>'+esc(row.note).replace(/\n/g,'<br>')+'</small>':'')+'</td>':'')+'<td>'+esc(component?.part?.name||'Не указаны')+(component?.part?.article?'<small>Арт. '+esc(component.part.article)+'</small>':'')+'</td><td>'+esc(component?.part?.unit||'—')+'</td><td>'+quantity(component?.qty)+'</td></tr>').join('');
  }).join('')+'</tbody>').join('');
  const person=(value,label)=>'<p>'+esc(label)+': '+esc(value?.position||'________________')+' <span class="signature">________________</span> '+esc(value?.name||'________________')+'</p>';
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>График ТО ДЭС</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10pt;color:#111}h1{font-size:16pt;margin:8px 0;text-align:center}.meta{text-align:center}.draft{font-size:15pt;color:#9b3100;text-align:center;font-weight:bold;border:2px solid;padding:8px}.approval{margin-left:55%;font-size:10pt}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8.5pt;margin:12px 0}th,td{border:1px solid #333;padding:5px;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}th{background:#eee}.site{break-after:avoid;page-break-after:avoid}.site th{background:#ddd;text-align:left}small{display:block;margin-top:4px}.signature{display:inline-block;margin:8px 12px}footer{font-size:8pt;margin-top:12px}.commission{break-inside:avoid}.commission p{margin:3px 0}</style></head><body>'+
   (model.status==='approved'?'<div class="approval"><b>УТВЕРЖДЕНО</b><p>'+esc(model.approval?.document)+'</p><p>Дата: '+esc(model.approval?.date)+'</p></div>':'<p class="draft">ПРОЕКТ · НЕ УТВЕРЖДЁН</p>')+
   '<h1>'+esc(s.title||'График технического обслуживания ДЭС')+'</h1><p class="meta">'+esc(s.org||'Организация не указана')+' · '+esc(s.year??'Год не указан')+' · редакция '+esc(model.revision??1)+'</p><table><colgroup><col style="width:13%"><col style="width:8%"><col style="width:9%"><col style="width:8%"><col style="width:10%"><col style="width:20%"><col style="width:18%"><col style="width:6%"><col style="width:8%"></colgroup><thead><tr><th>ДЭС</th><th>Вид ТО</th><th>Плановая дата</th><th>Моточасы<br>план</th><th>Счётчик<br>при утверждении</th><th>Работы / примечание</th><th>Комплектующие</th><th>Ед.</th><th>Кол-во</th></tr></thead>'+body+'</table><section class="commission"><b>Комиссия</b>'+person(s.commission?.chairman,'Председатель')+(s.commission?.members||[]).map(member=>person(member,'Член комиссии')).join('')+'</section><footer>Подписи проставляются на бумажном экземпляре. График не является документом выдачи запчастей.'+(model.fingerprint?'<br>Снимок: '+esc(model.fingerprint):'')+'</footer></body></html>';
 }
 return Object.freeze({apiVersion:1,templateVersion:1,dependencies:()=>names.slice(),prepare,render});
});
