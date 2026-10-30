// Per-DES regulations use the existing maintenanceRules on the asset card.
// Selecting equipment or preparing an annual draft never writes database rows.
let gmSetupSession=null;
function gmSetupRules(generator){return (generator.maintenanceRules||[]).filter(rule=>rule&&rule.enabled!==false);}
function gmSetupInterval(rule){return [rule.hours>0?'каждые '+precisionFormat(rule.hours)+' мтч':'',rule.months>0?'через '+precisionFormat(rule.months)+' мес.':''].filter(Boolean).join(' или ')||'Интервал не задан';}
function gmSetupAssert(s){if(gmSetupSession!==s||s.database!==data||s.stamp!==gmUiStamp()||s.source!==gmUiSource(['generators','generatorMaintenancePlans'])||!s.host.isConnected)throw Error('Данные или права изменились. Откройте настройку ТО заново.');}
function generatorMaintenanceSetupOpen(options={}){
 try{
  if(generatorMaintenanceHasPendingEdits())throw Error('Сохраните или отмените изменения открытой формы ТО.');
  if(!gmUiRead(['generators']))throw Error('Нет доступа к карточкам ДЭС.');
  const generators=(data.generators||[]).filter(row=>!row.archived&&!row.deleted),chosen=Object.hasOwn(options,'generatorId')?generators.find(row=>row.id===options.generatorId):null;
  if(Object.hasOwn(options,'generatorId')&&!chosen)throw Error('Выбранная ДЭС недоступна.');
  const organizations=[...new Set(generators.map(row=>String(row.org||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  const s={database:data,stamp:gmUiStamp(),source:gmUiSource(['generators','generatorMaintenancePlans']),generators,organizations,selected:new Set(options.selected|| (chosen?[gmUiId(chosen.id)]:[])),org:chosen?.org||options.org||'',search:'',year:options.year||gmUiToday().slice(0,4)};gmSetupSession=s;
  wfShowDialog('Настройка ТО ДЭС','<div class="gm-ui-form gm-setup" id="generatorMaintenanceSetup"><ol class="gm-setup-steps"><li class="active"><b>1</b><span>Настройте каждую ДЭС<small>Виды ТО и интервалы сохраняются в карточках</small></span></li><li><b>2</b><span>Задайте плановые часы<small>Счётчик возьмём из журнала ДЭС</small></span></li><li><b>3</b><span>Проверьте и сохраните график<small>Печать графика и ЗИП — отдельно</small></span></li></ol><p>Сначала укажите для каждой ДЭС, <strong>какие работы делать и через сколько моточасов</strong>. Затем выберите ДЭС для общего графика организации.</p><div class="gm-ui-grid"><label>Организация<select data-gm-setup-org><option value="">Все организации</option>'+organizations.map((org,index)=>'<option value="'+index+'"'+(org===s.org?' selected':'')+'>'+gmUiEsc(org)+'</option>').join('')+'</select></label><label>Найти ДЭС или объект<input data-gm-setup-search placeholder="Название, заводской номер или объект"></label></div><div class="gm-setup-selection"><label><input type="checkbox" data-gm-setup-all> Выбрать все показанные ДЭС</label><span data-gm-setup-count></span></div><div data-gm-setup-list></div><div class="gm-setup-footer"><label>Год графика<input inputmode="numeric" data-gm-setup-year value="'+gmUiEsc(s.year)+'"></label><button type="button" class="btn btn-primary" data-gm-setup-create>Перейти к часам и графику</button><button type="button" class="btn btn-ghost" data-gm-setup-plans>Открыть сохранённые графики</button></div><p class="gm-setup-footnote">Настройки ТО задаются один раз и подставляются в новые графики. Сами даты рассчитываются по введённой вами плановой наработке; фактическое обслуживание отмечается в журнале отдельно.</p><div role="status" class="gm-ui-error" data-gm-setup-error></div></div>');
  const modal=document.getElementById('wfModal');modal.querySelector('.wf-modal').classList.add('gm-ui-modal');s.host=modal.querySelector('#generatorMaintenanceSetup');
  const run=action=>{try{gmSetupAssert(s);s.host.querySelector('[data-gm-setup-error]').textContent='';action();}catch(error){s.host.querySelector('[data-gm-setup-error]').textContent=error.message;}};
  s.host.querySelector('[data-gm-setup-org]').onchange=event=>run(()=>{s.org=event.target.value===''?'':s.organizations[Number(event.target.value)];gmSetupRender(s);});
  s.host.querySelector('[data-gm-setup-search]').oninput=event=>run(()=>{s.search=event.target.value;gmSetupRender(s);});
  s.host.querySelector('[data-gm-setup-all]').onchange=event=>run(()=>{for(const generator of gmSetupVisible(s))if(event.target.checked)s.selected.add(gmUiId(generator.id));else s.selected.delete(gmUiId(generator.id));gmSetupRender(s);});
  s.host.querySelector('[data-gm-setup-create]').onclick=()=>run(()=>{
   const selected=s.generators.filter(generator=>s.selected.has(gmUiId(generator.id)));if(!selected.length)throw Error('Выберите хотя бы одну ДЭС.');
   const orgs=[...new Set(selected.map(generator=>String(generator.org||'').trim()))];if(orgs.length!==1||!orgs[0])throw Error('В один график включаются ДЭС одной организации. Уточните выбор и организацию в карточках.');
   const year=precisionInput(s.host.querySelector('[data-gm-setup-year]'),{scale:0,blank:'error'});if(year<1900||year>9999)throw Error('Укажите год графика от 1900 до 9999.');
   if(!gmUiSupported('plans')||!gmUiWrite('generatorMaintenancePlans'))throw Error(gmUiUnavailable('plans'));
   generatorMaintenanceEdit(undefined,{org:orgs[0],year,title:'График ТО ДЭС на '+year+' год',generatorIds:selected.map(generator=>generator.id)});
  });
  s.host.querySelector('[data-gm-setup-plans]').onclick=()=>run(()=>generatorMaintenanceOpen(s.org));gmSetupRender(s);
 }catch(error){showToast(error.message);}
}
function gmSetupVisible(s){const query=s.search.trim().toLocaleLowerCase('ru');return s.generators.filter(generator=>(!s.org||String(generator.org||'').trim()===s.org)&&(!query||[gmUiName(generator),generator.serial,generator.site,generator.location].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(query)));}
function gmSetupRender(s){
 const rows=gmSetupVisible(s),canEdit=gmUiWrite('generators',['maintenanceRules']);
 s.host.querySelector('[data-gm-setup-list]').innerHTML=rows.length?'<div class="gm-ui-scroll gm-setup-table"><table class="tbl"><thead><tr><th>В график</th><th>ДЭС</th><th>Объект</th><th>Настроенные виды ТО</th><th></th></tr></thead><tbody>'+rows.map((generator,index)=>{const rules=gmSetupRules(generator);return '<tr><td><input type="checkbox" data-gm-setup-select="'+index+'" aria-label="Включить '+gmUiEsc(gmUiName(generator))+' в график"'+(s.selected.has(gmUiId(generator.id))?' checked':'')+'></td><th>'+gmUiEsc(gmUiName(generator))+'<small>'+gmUiEsc([generator.serial? 'Зав. № '+generator.serial:'',generator.org].filter(Boolean).join(' · '))+'</small></th><td>'+gmUiEsc(generator.site||generator.location||'Объект не указан')+'</td><td>'+(rules.length?rules.map(rule=>'<div class="gm-setup-rule"><strong>'+gmUiEsc(rule.label||'Вид ТО не назван')+'</strong><small>'+gmUiEsc(gmSetupInterval(rule))+'</small></div>').join(''):'<span class="gm-setup-missing">Виды ТО ещё не настроены</span>')+'</td><td><button type="button" class="btn btn-ghost btn-sm" data-gm-setup-edit="'+index+'">'+(canEdit?'Настроить ТО':'Посмотреть')+'</button></td></tr>';}).join('')+'</tbody></table></div>':'<div class="gm-setup-empty">ДЭС по этим условиям не найдены. Измените организацию или поиск.</div>';
 s.host.querySelectorAll('[data-gm-setup-select]').forEach(input=>{const generator=rows[Number(input.dataset.gmSetupSelect)];input.onchange=()=>{try{gmSetupAssert(s);if(input.checked)s.selected.add(gmUiId(generator.id));else s.selected.delete(gmUiId(generator.id));gmSetupRender(s);}catch(error){showToast(error.message);}};});
 s.host.querySelectorAll('[data-gm-setup-edit]').forEach(button=>{const generator=rows[Number(button.dataset.gmSetupEdit)];button.onclick=()=>{try{gmSetupAssert(s);s.year=s.host.querySelector('[data-gm-setup-year]').value;toOpenRules('generator',generator.id,()=>generatorMaintenanceSetupOpen({org:s.org,year:s.year,selected:[...s.selected]}));}catch(error){showToast(error.message);}};});
 const all=s.host.querySelector('[data-gm-setup-all]'),count=rows.filter(generator=>s.selected.has(gmUiId(generator.id))).length;all.checked=rows.length>0&&count===rows.length;all.indeterminate=count>0&&count<rows.length;
 s.host.querySelector('[data-gm-setup-count]').textContent='Выбрано ДЭС: '+s.selected.size;s.host.querySelector('[data-gm-setup-create]').disabled=!s.selected.size||!gmUiSupported('plans')||!gmUiWrite('generatorMaintenancePlans');
}
function gmPlanSeedGenerators(s,ids){
 const seen=new Set();for(const id of ids){const key=gmUiId(id);if(seen.has(key))continue;seen.add(key);const generator=gmUiGenerator(id);if(generator.archived||generator.deleted)throw Error('Архивную ДЭС нельзя включить в новый график.');
  const rules=gmSetupRules(generator);for(const rule of rules.length?rules:[null]){
   if(s.rows.length>=10000)throw Error('В графике получается больше 10 000 видов ТО. Уменьшите выбор ДЭС.');const row=gmPlanRawRow({generatorId:id,site:generator.site||generator.location||'',type:rule?.label||'',work:typeof rule?.work==='string'?rule.work:''});row.open=s.rows.length===0;row.calendarOpen=!rule?.hours;row.forecast.open=!!rule?.hours;if(rule?.hours>0)row.forecast.intervalText=row.forecast.prefilledIntervalText=precisionFormat(rule.hours);s.rows.push(row);
  }
 }
}
function gmPlanHydrateRegulations(s){for(const row of s.rows){if(row.forecast.intervalText)continue;const generator=(data.generators||[]).find(generator=>generator.id===row.generatorId),rules=generator?gmSetupRules(generator).filter(rule=>String(rule.label||'').trim()===row.type.trim()&&rule.hours>0):[];if(rules.length===1)row.forecast.intervalText=row.forecast.prefilledIntervalText=precisionFormat(rules[0].hours);}}
function gmPlanRulePickerHtml(row){
 const generator=(data.generators||[]).find(generator=>generator.id===row.generatorId),rules=generator?gmSetupRules(generator):[];
 const matched=rules.filter(rule=>String(rule.label||'').trim()===row.type.trim()),selected=matched.length===1?rules.indexOf(matched[0]):-1;
 return '<div class="gm-plan-regulation"><label>Вид ТО из настроек этой ДЭС<select data-gm-rule-choice><option value="">'+(rules.length?'Выберите настроенный вид ТО':'Своё название и интервал можно указать ниже')+'</option>'+rules.map((rule,index)=>'<option value="'+index+'"'+(index===selected?' selected':'')+'>'+gmUiEsc((rule.label||'Вид ТО')+' · '+gmSetupInterval(rule))+'</option>').join('')+'</select></label><button type="button" class="btn btn-ghost btn-sm" data-gm-rule-apply'+(rules.length?'':' disabled')+'>Подставить</button>'+(rules.some(rule=>rule.months>0)?'<p>Расчёт ниже распределяет ТО по моточасам. Календарный срок в месяцах проверьте отдельно и при необходимости добавьте дату вручную.</p>':'')+'</div>';
}
function gmPlanApplyRule(s,row,index){
 const generator=gmUiGenerator(row.generatorId),rule=gmSetupRules(generator)[index];if(!rule)throw Error('Выберите настроенный вид ТО.');
 if(row.type.trim()!==String(rule.label||'').trim()&&row.occurrences.some(item=>item.plannedDate||item.hoursText))throw Error('Для другого вида ТО добавьте отдельный шаблон: у этого уже есть плановые даты.');
 if(!row.work.trim()&&typeof rule.work==='string')row.work=rule.work;row.type=rule.label||'';row.forecast.intervalText=rule.hours>0?precisionFormat(rule.hours):'';row.forecast.preview=null;row.forecast.previewSignature=null;row.forecast.appliedSignature=null;row.forecast.open=rule.hours>0;row.open=true;
 if(!(rule.hours>0))row.forecast.message='У этого вида ТО задан календарный интервал. Укажите даты в календаре вручную.';
}
function gmPlanShareHours(s,row){
 const targets=s.rows.filter(item=>item!==row&&item.generatorId===row.generatorId);if(!targets.length)throw Error('Для этой ДЭС пока нет других видов ТО.');
 const f=row.forecast;if(f.rateMode==='monthlyPlan'?!f.monthlyTexts.some(value=>value.trim()):!f.rateText.trim())throw Error('Сначала введите плановую наработку ДЭС.');
 for(const target of targets){Object.assign(target.forecast,{rateMode:f.rateMode,rateText:f.rateText,monthlyTexts:f.monthlyTexts.slice(),preview:null,previewSignature:null,appliedSignature:null});}
 f.message='Наработка подставлена в другие виды ТО этой ДЭС: '+targets.length+'. Для каждого вида проверьте основание первого ТО и рассчитайте даты.';
}
