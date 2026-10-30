// Legacy names delegate to the typed feature controller; plan helpers remain local.
function gmSetupRules(generator){return (generator.maintenanceRules||[]).filter(rule=>rule&&rule.enabled!==false);}
function gmSetupInterval(rule){return [rule.hours>0?'каждые '+precisionFormat(rule.hours)+' мтч':'',rule.months>0?'через '+precisionFormat(rule.months)+' мес.':''].filter(Boolean).join(' или ')||'Интервал не задан';}
function generatorMaintenanceSetupOpen(options={}){try{platformApplication().maintenanceSetup.open(options);}catch(error){showToast(error.message);}}
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
