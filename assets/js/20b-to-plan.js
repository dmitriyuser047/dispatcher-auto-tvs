// Регламенты ТО и построение графика обслуживания.
//
// Интервал берётся из карточки машины («Интервал ТО, км» и «мес»), а если он
// не заполнен — из таблицы регламентов по марке (данные заводов и официальных
// дилеров для России). План строится от последнего выполненного ТО, а если
// его нет — от ближайшего кратного интервалу пробега. Дата считается по
// среднему пробегу машины за последние три месяца и ограничивается сроком
// по времени (обычно 12 месяцев).
//
// Плановые записи помечены planned: true — при пересчёте они заменяются,
// выполненные ТО не трогаются.

// Регламенты по маркам: интервал (км), срок (мес), интервал в тяжёлых
// условиях (км) и источник. Тяжёлые условия — Крайний Север, бездорожье,
// пыль, морозы: заводы рекомендуют сокращать интервал примерно вдвое.
const TO_REGS = [
  { re: /mitsubishi|l\s?200/i,            km: 15000, months: 12, hard: 7500,  src: 'Mitsubishi, дилеры РФ' },
  { re: /уаз|патриот|patriot/i,           km: 10000, months: 12, hard: 5000,  src: 'УАЗ, сервисная книжка' },
  { re: /нива\s*тр[еэ]вел|niva\s*travel/i, km: 15000, months: 12, hard: 7500, src: 'АвтоВАЗ, Niva Travel' },
  { re: /шевроле\s*нива|chevrolet\s*niva/i, km: 15000, months: 12, hard: 7500, src: 'Chevrolet Niva (ВАЗ-2123)' },
  { re: /лада\s*нива|lada\s*2121|нива/i,  km: 10000, months: 12, hard: 5000,  src: 'АвтоВАЗ, Niva Legend' },
  { re: /duster|дастер/i,                 km: 15000, months: 12, hard: 10000, src: 'Renault, бензин (дизель — 10 000)' },
  { re: /sandero|сандеро/i,               km: 15000, months: 12, hard: 10000, src: 'Renault Sandero' },
  { re: /hilux|хайлюкс/i,                 km: 10000, months: 12, hard: 5000,  src: 'Toyota, дилеры РФ' },
  { re: /land\s*rover|ленд\s*ровер/i,     km: 13000, months: 12, hard: 13000, src: 'Land Rover, РФ («тяжёлые условия»)' },
  { re: /bmw|бмв/i,                       km: 10000, months: 12, hard: 7000,  src: 'BMW, сервис РФ' },
  { re: /mercedes|мерседес|майбах|гелен/i, km: 15000, months: 12, hard: 10000, src: 'Mercedes-Benz: бензин 15 000, дизель 10 000' },
  { re: /audi|ауди/i,                     km: 15000, months: 12, hard: 15000, src: 'Audi, инспекционный сервис' },
  { re: /zeekr|зикр/i,                    km: 10000, months: 12, hard: 10000, src: 'Zeekr, дилеры РФ' },
  { re: /tank|танк/i,                     km: 10000, months: 12, hard: 10000, src: 'TANK 500, дилеры РФ' },
  { re: /jac/i,                           km: 10000, months: 12, hard: 5000,  src: 'JAC, регламент РФ' },
  { re: /садко|газ\b|газель|газон/i,      km: 10000, months: 12, hard: 10000, src: 'ГАЗ: ТО-1 10 000, ТО-2 20 000' },
  { re: /урал/i,                          km: 4000,  months: 6,  hard: 4000,  src: 'Урал-4320: ТО-1 4 000 км, ТО-2 16 000 км' },
  { re: /тр[эе]кол|trekol/i,              km: 5000,  months: 6,  hard: 5000,  src: 'ТРЭКОЛ 39041: ТО-0 1 500 км, далее каждые 5 000' },
];
const TO_DEFAULT = { km: 10000, months: 12, hard: 5000, src: 'общее правило для парка' };

// В марках попадаются русские буквы-двойники («MERСEDES» с русской С),
// поэтому ищем и по исходному тексту, и по переводу кириллицы в латиницу
const TO_CYR2LAT = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };
function toRegFor(v) {
  const text = [v.make, v.model].filter(Boolean).join(' ');
  const lat = text.toUpperCase().replace(/[АВЕКМНОРСТУХ]/g, ch => TO_CYR2LAT[ch]);
  return TO_REGS.find(r => r.re.test(text) || r.re.test(lat)) || TO_DEFAULT;
}

// Интервал машины: из карточки, иначе по регламенту марки
function toIntervalKm(v) { return +v.toIntervalKm > 0 ? +v.toIntervalKm : (v.toSevereConditions ? toRegFor(v).hard : toRegFor(v).km); }
function toIntervalMonths(v) { return +v.toIntervalMonths > 0 ? +v.toIntervalMonths : toRegFor(v).months; }

function toLocalDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// Текущий пробег: начальный одометр плюс журнал
function toCurrentOdo(v) {
  const today = toLocalDate();
  return (+v.odometer || 0) + recsFor(v.id).filter(r => r.date <= today).reduce((s, r) => s + (+r.km || 0), 0);
}

// Прогноз использует актуальное окно, включая дни простоя. Старые показания не
// переносят прежнюю интенсивность работы на будущий год.
function toUsageTrend(records, field, now = new Date()) {
  const today = toLocalDate(now), day = new Date(today + 'T12:00:00');
  const fromDate = new Date(day); fromDate.setDate(fromDate.getDate() - 89);
  const from = toLocalDate(fromDate);
  const tail = records.filter(r => r.date >= from && r.date <= today && Number.isFinite(+r[field]) && +r[field] >= 0)
    .slice().sort((a,b) => cmpDateAsc(a.date,b.date));
  if (!tail.length) return { rate:0, reason:'нет записей за последние 90 дней', age:null, days:0 };
  const age = Math.round((day - new Date(tail[tail.length-1].date + 'T12:00:00')) / 86400000);
  const days = Math.max(1, Math.round((day - new Date(tail[0].date + 'T12:00:00')) / 86400000) + 1);
  if (age > 30) return { rate:0, reason:'последние показания старше 30 дней', age, days };
  if (days < 7 || new Set(tail.map(r => r.date)).size < 2) return { rate:0, reason:'недостаточно истории для прогноза (минимум 7 дней и 2 даты)', age, days };
  const amount = tail.reduce((sum,r) => sum + (+r[field] || 0),0);
  return { rate:amount / days, reason:amount > 0 ? `по ${days} календарным дням, включая простой` : 'движение не зафиксировано', age, days };
}

function toDailyKm(v) { return toUsageTrend(recsFor(v.id), 'km').rate; }

function toAddMonths(dateIso, months) {
  const d = new Date(dateIso + 'T12:00:00');
  const originalDay = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + Math.max(0, Math.round(months)));
  const lastDay = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDay));
  return toLocalDate(d);
}

function toGeneratorRulePlan(g, rule, horizonMonths) {
  const today = toLocalDate(), interval = +rule.hours || 0, months = +rule.months || 0;
  const records = (data.genRecords || []).filter(r => r.generatorId === g.id);
  const current = (+g.hoursInit || 0) + records.filter(r => r.date <= today).reduce((s,r) => s + (+r.hours || 0),0);
  const trend = toUsageTrend(records, 'hours');
  const done = (data.toRecords || []).filter(r => r.generatorId === g.id && !r.planned && r.date <= today &&
    (r.maintenanceRuleId === rule.id || !r.maintenanceRuleId && String(r.type || '').toLowerCase() === rule.label.toLowerCase()))
    .sort((a,b) => cmpDateAsc(a.date,b.date));
  const last = done[done.length-1];
  let nextMeter = interval > 0 ? (last?.nextHoursAbs ?? (last?.hours != null ? +last.hours + interval : Math.floor(current / interval) * interval + interval)) : null;
  let nextDate = last?.nextDate || (months > 0 ? toAddMonths(last?.date || today, months) : null);
  const limit = toAddMonths(today, horizonMonths), items = [];
  for (let i=0; i<60; i++) {
    const byMeter = nextMeter != null && trend.rate > 0 ? toLocalDate(new Date(Date.now() + Math.max(0,(nextMeter-current)/trend.rate) * 86400000)) : nextMeter != null && current >= nextMeter ? today : null;
    const date = byMeter && (!nextDate || byMeter < nextDate) ? byMeter : nextDate;
    if (!date || date > limit) break;
    items.push({ date:date < today ? today : date, dueDate:date, meter:nextMeter != null ? +nextMeter.toFixed(1) : null });
    if (nextMeter != null) nextMeter = nextMeter <= current ? current + interval : nextMeter + interval;
    nextDate = months > 0 ? toAddMonths(date < today ? today : date,months) : null;
  }
  return { current, trend, items };
}

let toRulesAssetKind = 'vehicle';
let toRulesAssetId = null;
let toRulesSession = null;
function toRulesStamp(){return gmUiStamp();}
function toRulesRaw(){const form=document.getElementById('toRulesEditor');return form?JSON.stringify([...form.querySelectorAll('input,textarea')].map(input=>[input.className,input.type==='checkbox'?input.checked:input.value])):'';}
function toRulesHasPendingEdits(){const s=toRulesSession;return !!s&&s.stamp===toRulesStamp()&&s.form?.isConnected&&document.getElementById('genericModal')?.classList.contains('open')&&(s.pending||toRulesRaw()!==s.initial);}
function toRulesAssetLabel(asset,kind=toRulesAssetKind){return (kind==='vehicle'?[asset.plate,asset.make]:[asset.name,asset.serial,asset.site||asset.location]).filter(Boolean).join(' · ');}
function toRulesPick(kind,token){
 const s=toRulesSession;if(!s||s.pending)return;
 if(toRulesHasPendingEdits()){showToast('Сначала сохраните настройки или отмените изменения.');s.form.querySelector('[data-to-kind]').value=toRulesAssetKind;s.form.querySelector('[data-to-asset]').value=String(s.selected);return;}
 const id=kind===toRulesAssetKind?s.choices[Number(token)]:undefined;toOpenRules(kind,id,s.afterSave);
}
function toOpenRules(kind='vehicle',id,afterSave){
 try{
  kind=kind==='generator'?'generator':'vehicle';const section=kind==='generator'?'generators':'vehicles',assets=(data[section]||[]).filter(asset=>!asset.archived&&!asset.deleted);
  if(!gmUiRead([section]))throw Error('Нет доступа к карточкам выбранной техники.');const asset=id===undefined?assets[0]:assets.find(asset=>asset.id===id);if(!asset){showToast(kind==='generator'?'Нет выбранной доступной ДЭС.':'Техника не найдена.');return;}
  if(assets.filter(item=>item.id===asset.id).length!==1)throw Error('Карточка техники найдена неоднозначно.');toRulesAssetKind=kind;toRulesAssetId=asset.id;
  const s={kind,section,id:asset.id,choices:assets.map(asset=>asset.id),selected:assets.indexOf(asset),stamp:toRulesStamp(),source:PlatformKernel.stableSerialize(asset),rules:gmUiClone(asset.maintenanceRules||[]),afterSave,pending:false};toRulesSession=s;
  s.canNorm=gmUiWrite(section,['maintenanceRules']);s.canSevere=kind==='vehicle'&&gmUiWrite(section,['toSevereConditions']);const readonly=s.readonly=!s.canNorm&&!s.canSevere;
  openGenericModal(kind==='generator'?'Настройка ТО ДЭС':'Настройка ТО транспорта',
   '<div id="toRulesEditor" class="gm-ui-form to-rules-editor"><div class="gm-rules-fields"><div class="gm-ui-grid"><label>Тип техники<select data-to-kind onchange="toRulesPick(this.value,0)"><option value="vehicle"'+(kind==='vehicle'?' selected':'')+'>Транспорт</option><option value="generator"'+(kind==='generator'?' selected':'')+'>ДЭС</option></select></label><label>'+(kind==='generator'?'Выбранная ДЭС':'Выбранный транспорт')+'<select data-to-asset onchange="toRulesPick(toRulesAssetKind,this.value)">'+assets.map((item,index)=>'<option value="'+index+'"'+(item.id===asset.id?' selected':'')+'>'+htmlEsc(toRulesAssetLabel(item,kind))+'</option>').join('')+'</select></label></div>'+
   '<div class="gm-setup-explanation"><strong>1. Какие работы и как часто</strong><p>Каждый вид ТО задаётся отдельной строкой: например, «Замена масла и фильтра» — каждые 300 '+(kind==='generator'?'моточасов':'км')+'. Интервал возьмите из регламента вашей техники.</p><p>Поле «Либо через месяцев» необязательно. Если заданы оба интервала, ТО наступает по более раннему условию.</p></div>'+
   (readonly?'<p class="gm-ui-warning">Настройки доступны для просмотра. Для изменения нужно право на регламенты техники.</p>':'')+
   (kind==='vehicle'?'<label class="gm-ui-confirm"><input id="to_rules_severe" type="checkbox"'+(asset.toSevereConditions?' checked':'')+'>Тяжёлые условия для базового регламента марки</label>':'')+
   '<div id="toRulesRows"></div><button type="button" class="btn btn-ghost" data-to-rule-add onclick="toAddRuleRow()">+ Ещё один вид ТО</button>'+
   '<p class="gm-setup-next">'+(kind==='generator'?'2. После сохранения выберите ДЭС в списке настройки и перейдите к графику. Виды ТО и интервалы подставятся; останется задать плановые часы по месяцам.':'После сохранения эти виды ТО используются при планировании обслуживания выбранного транспорта.')+'</p>'+
   '</div><div data-to-rules-error role="status"></div><div class="gm-ui-actions"><button type="button" class="btn btn-ghost" onclick="closeModal(&quot;genericModal&quot;)">Отменить</button><button type="button" class="btn btn-primary" data-to-rules-save onclick="toSaveRules()">Сохранить настройки этой '+(kind==='generator'?'ДЭС':'техники')+'</button></div></div>',850);
  s.form=document.getElementById('toRulesEditor');(asset.maintenanceRules||[]).forEach(rule=>toAddRuleRow(rule));if(!s.rules.length)toAddRuleRow(kind==='vehicle'?{label:'ТО',km:toIntervalKm(asset),months:toIntervalMonths(asset)}:{});
  toRulesUnlock(s);s.initial=toRulesRaw();
 }catch(error){showToast(error.message);}
}
function toRulesUnlock(s){
 s.form.querySelectorAll('input,select,textarea,button').forEach(control=>control.disabled=false);
 if(!s.canNorm)s.form.querySelectorAll('.to-rule-row input,.to-rule-row textarea,.to-rule-row button,[data-to-rule-add]').forEach(control=>control.disabled=true);
 const severe=s.form.querySelector('#to_rules_severe');if(severe)severe.disabled=!s.canSevere;s.form.querySelector('[data-to-rules-save]').disabled=s.readonly;
}
function toAddRuleRow(rule={}){
 const host=document.getElementById('toRulesRows');if(!host||toRulesSession?.pending)return;const row=document.createElement('div');row.className='to-rule-row gm-rule-card';
 row._toRuleId=rule.id??wfId('maintenance-rule');row.dataset.ruleId=String(row._toRuleId);const meter=toRulesAssetKind==='vehicle'?rule.km:rule.hours;
 row.innerHTML='<div class="gm-ui-grid"><label>Название вида ТО<input class="to-rule-label" value="'+htmlEsc(rule.label||'')+'" placeholder="Например: ТО-1"></label><label>Каждые, '+(toRulesAssetKind==='vehicle'?'км':'моточасов')+'<input class="to-rule-meter" inputmode="decimal" value="'+htmlEsc(meter==null?'':precisionFormat(meter))+'" placeholder="Например: 300"></label><label>Либо через месяцев · необязательно<input class="to-rule-months" inputmode="numeric" value="'+htmlEsc(rule.months??'')+'" placeholder="Без календарного интервала"></label><label class="gm-ui-confirm"><input class="to-rule-enabled" type="checkbox"'+(rule.enabled!==false?' checked':'')+'>Использовать в графике</label><label class="gm-ui-wide">Какие работы входят в ТО · необязательно<textarea class="to-rule-work" rows="2" placeholder="Например: замена масла, масляного и топливного фильтра">'+htmlEsc(rule.work||'')+'</textarea><small>Этот перечень подставится в новый график.</small></label></div><button type="button" class="btn btn-ghost btn-sm" onclick="this.closest(&quot;.to-rule-row&quot;).remove()">Убрать вид ТО</button>';host.appendChild(row);
}
async function toSaveRules(){
 const s=toRulesSession;if(!s||s.pending)return;const errorNode=s.form.querySelector('[data-to-rules-error]');
 try{
  if(s.stamp!==toRulesStamp()||!(gmUiWrite(s.section,['maintenanceRules'])||s.kind==='vehicle'&&gmUiWrite(s.section,['toSevereConditions'])))throw Error('База или права изменились. Откройте настройки заново.');
  const matches=(data[s.section]||[]).filter(asset=>asset.id===s.id);if(matches.length!==1||PlatformKernel.stableSerialize(matches[0])!==s.source)throw Error('Карточка техники изменилась. Откройте настройки заново.');const asset=matches[0],rules=[];
  for(const row of s.canNorm?s.form.querySelectorAll('.to-rule-row'):[]){
   const label=row.querySelector('.to-rule-label').value.trim(),meter=precisionInput(row.querySelector('.to-rule-meter'),{scale:3,blank:'null'}),months=precisionInput(row.querySelector('.to-rule-months'),{scale:0,blank:'null'});
   if(!label||meter!==null&&meter<=0||months!==null&&months<=0||!(meter>0||months>0))throw Error('Для каждого вида ТО укажите название и положительный интервал в '+(s.kind==='generator'?'моточасах':'км')+' или месяцах.');
   if(rules.some(rule=>rule.label.toLocaleLowerCase('ru')===label.toLocaleLowerCase('ru')))throw Error('Названия видов ТО должны различаться.');
   if(!PlatformContracts.identifier(row._toRuleId))throw Error('Не подтверждён код вида ТО. Откройте настройки заново.');const original=s.rules.find(rule=>rule.id===row._toRuleId)||{},work=row.querySelector('.to-rule-work').value.trim();if(work.length>20000)throw Error('Перечень работ не должен превышать 20 000 символов.');rules.push({...original,...(work||Object.hasOwn(original,'work')?{work}:{}),id:row._toRuleId,label,[s.kind==='vehicle'?'km':'hours']:meter,months,enabled:row.querySelector('.to-rule-enabled').checked});
  }
  if(s.canNorm)asset.maintenanceRules=rules;if(s.canSevere)asset.toSevereConditions=!!s.form.querySelector('#to_rules_severe')?.checked;
  s.pending=true;errorNode.textContent='Сохраняем настройки…';s.form.querySelectorAll('input,select,textarea,button').forEach(control=>control.disabled=true);
  if(!await saveData(data)){errorNode.textContent='Сохранение не подтверждено. Введённые настройки остаются в форме; проверьте подключение и повторите сохранение.';return;}
  s.initial=toRulesRaw();s.pending=false;closeModal('genericModal');toRulesSession=null;showToast('Настройки ТО сохранены для '+toRulesAssetLabel(asset,s.kind)+'.');if(typeof s.afterSave==='function')s.afterSave();
 }catch(error){errorNode.textContent=error.message;errorNode.className='gm-ui-error';showToast(error.message);}finally{s.pending=false;if(toRulesSession===s&&s.stamp===toRulesStamp())toRulesUnlock(s);}
}

// План ТО машины на horizon месяцев вперёд
function toPlanFor(v, horizonMonths, rule) {
  const interval = rule ? (+rule.km || 0) : toIntervalKm(v), months = rule ? (+rule.months || 0) : toIntervalMonths(v);
  const cur = toCurrentOdo(v);
  const trend = toUsageTrend(recsFor(v.id), 'km'), perDay = trend.rate;
  const today = toLocalDate();
  const done = vehicleToFor(v.id).filter(r => !r.planned && r.date <= today && (rule ? (r.maintenanceRuleId === rule.id || !r.maintenanceRuleId && String(r.type || '').toLowerCase() === rule.label.toLowerCase()) : !r.maintenanceRuleId)).sort((a, b) => cmpDateAsc(a.date, b.date));
  const last = done[done.length - 1];

  // Отсчёт: от последнего ТО, иначе от ближайшего кратного интервалу пробега
  let nextOdo = last && last.nextOdometerAbs != null ? +last.nextOdometerAbs
    : last && last.odometer != null ? +last.odometer + interval
    : interval > 0 ? Math.floor(cur / interval) * interval + interval : null;
  if (!(interval > 0)) nextOdo = null;
  let nextDate = last?.nextDate || (months > 0 ? toAddMonths(last?.date || today, months) : null);

  const limit = toAddMonths(today, horizonMonths || 12);
  const out = [];
  for (let i = 0; i < 60; i++) {
    // Дата по пробегу: сколько дней до нужного пробега при текущем темпе
    const byKm = nextOdo != null && perDay > 0 ? toLocalDate(new Date(Date.now() + Math.max(0, (nextOdo - cur) / perDay) * 86400000)) : nextOdo != null && cur >= nextOdo ? today : null;
    const date = byKm && (!nextDate || byKm < nextDate) ? byKm : nextDate;
    if (!date) break;
    if (date > limit) break;
    out.push({ date: date < today ? today : date, dueDate:date, odo: nextOdo, overdue: date < today || nextOdo != null && cur > nextOdo, byKm: !!(byKm && (!nextDate || byKm < nextDate)) });
    if (nextOdo != null) nextOdo = nextOdo <= cur ? cur + interval : nextOdo + interval;
    nextDate = months > 0 ? toAddMonths(date < today ? today : date, months) : null;
  }
  return { interval, months, cur, perDay, trend, last, items: out };
}

// Пересчёт планов по всему парку: плановые записи заменяются, факт не трогается
async function toRebuildPlan(horizonMonths) {
  const vehicles = (data.vehicles || []).filter(v => !v.archived && !/списан|продан/i.test(v.status || ''));
  // Ручные планы сохраняются; старые автоматически созданные планы узнаются по ID.
  data.vehicleTo = (data.vehicleTo || []).filter(r => !r.planned || !(r.generatedBy === 'regulation' || String(r.id || '').startsWith('vto_plan_')));
  let added = 0;
  vehicles.forEach(v => {
    const rules = (v.maintenanceRules || []).filter(r => r.enabled !== false && (+r.km > 0 || +r.months > 0));
    const reg = toRegFor(v);
    ((v.maintenanceRules || []).length ? rules : [null]).forEach(rule => {
    const p = toPlanFor(v, horizonMonths || 12, rule);
    p.items.forEach((it, i) => {
      data.vehicleTo.push({
        id: 'vto_plan_' + v.id + '_' + (rule?.id || 'default') + '_' + i + '_' + Date.now().toString(36),
        vehicleId: v.id,
        date: it.date,
        type: rule ? rule.label + ' (план)' : 'ТО по регламенту (план)',
        planned: true,
        generatedBy: 'regulation', maintenanceRuleId: rule?.id || null,
        maintenanceIntervalMonths: p.months || null,
        dueDate: it.dueDate,
        odometer: it.odo != null ? Math.round(it.odo) : null,
        nextKm: p.interval || null,
        nextOdometerAbs: it.odo != null ? Math.round(it.odo) : null,
        nextDate: it.date,
        cost: null,
        performer: '',
        note: 'Регламент: каждые ' + p.interval.toLocaleString('ru') + ' км или ' + p.months + ' мес. (' + reg.src + '). ' +
          (it.byKm ? 'Срок по пробегу' : 'Срок по времени') +
          (p.perDay ? ', средний пробег ' + Math.round(p.perDay) + ' км/сут' : ', прогноз по пробегу недоступен: ' + p.trend.reason) +
          (it.overdue ? '. ТО просрочено — поставлено на сегодня' : ''),
      });
      added++;
    });
    });
  });
  data.toRecords = (data.toRecords || []).filter(r => !r.planned || r.generatedBy !== 'regulation');
  (data.generators || []).filter(g => !g.archived).forEach(g => {
    (g.maintenanceRules || []).filter(rule => rule.enabled !== false && (+rule.hours > 0 || +rule.months > 0)).forEach(rule => {
      const plan = toGeneratorRulePlan(g, rule, horizonMonths || 12);
      plan.items.forEach((it,i) => {
        data.toRecords.push({ id:'to_plan_' + g.id + '_' + rule.id + '_' + i + '_' + Date.now().toString(36),
          generatorId:g.id, date:it.date, dueDate:it.dueDate, type:rule.label + ' (план)', planned:true,
          generatedBy:'regulation', maintenanceRuleId:rule.id, maintenanceIntervalMonths:+rule.months || null,
          hours:it.meter, nextHours:+rule.hours || null, nextHoursAbs:it.meter, nextDate:it.date,
          cost:null, performer:'', note:'Срок наступает по первому условию: ' + (+rule.hours > 0 ? rule.hours + ' мтч ' : '') + (+rule.months > 0 ? rule.months + ' мес. ' : '') + '. ' + plan.trend.reason,
        });
        added++;
      });
    });
  });
  if (!await saveData(data)) return null;
  return added;
}

// Кнопка в разделе «График ТО»
async function toRebuildPlanClick() {
  if (!await confirmAction('Построить план ТО по регламентам на 12 месяцев вперёд? Автоматические планы будут пересозданы. Ручные планы и выполненные ТО сохранятся.')) return;
  const n = await toRebuildPlan(12);
  if (n == null) return;
  showToast('План ТО построен: ' + n + ' записей');
  renderToScheduleSection();
}

// Таблица регламентов и ближайших ТО — для просмотра и выгрузки
function toPlanOverview() {
  return (data.vehicles || []).filter(v => !v.archived).map(v => {
    const configured = v.maintenanceRules || [];
    const rules = configured.filter(r => r.enabled !== false && (+r.km > 0 || +r.months > 0));
    const plans = (configured.length ? rules : [null]).map(rule => ({rule,plan:toPlanFor(v,12,rule)}));
    plans.sort((a,b) => (a.plan.items[0]?.date || '9999').localeCompare(b.plan.items[0]?.date || '9999'));
    const chosen = plans[0];
    const p = chosen?.plan || {interval:0,months:0,cur:toCurrentOdo(v),perDay:0,last:null,items:[]};
    const reg = chosen?.rule ? {src:'Собственный регламент: ' + chosen.rule.label} : configured.length ? {src:'Все виды ТО отключены'} : toRegFor(v);
    const next = p.items[0];
    return { v, reg, interval: p.interval, months: p.months, cur: p.cur, perDay: p.perDay,
             last: p.last, next, count: plans.reduce((n,x) => n + x.plan.items.length,0) };
  }).sort((a, b) => (a.next ? a.next.date : '9').localeCompare(b.next ? b.next.date : '9'));
}

// ─── Окно «Регламенты ТО» ─────────────────────────────────

function toGeneratorMaintenanceEntryHtml(){return typeof generatorMaintenanceSetupOpen==='function'?gmUiButton('setup',[],'1. Настроить ТО ДЭС')+gmUiButton('plans',[''],'Сохранённые графики'):'';}

function toShowRegs() {
  const list = toPlanOverview();
  const n = (x, d) => (+x || 0).toLocaleString('ru', { maximumFractionDigits: d ?? 0 });
  const today = BusinessCalendar.resolve(data,new Date().toISOString()).today;
  const rows = list.map(r => {
    const left = r.next ? r.next.odo - r.cur : null;
    const soon = r.next && (r.next.overdue || left <= r.interval * 0.15);
    return `<tr>
      <td><b>${fpEsc(r.v.plate)}</b><div style="font-size:12px;color:var(--text3)">${fpEsc(r.v.make || '')}</div></td>
      <td style="font-size:12px">${fpEsc(r.v.org || '')}<div style="color:var(--text3)">${fpEsc(r.v.status || '')}</div></td>
      <td style="text-align:right">${n(r.interval)} км<div style="font-size:11px;color:var(--text3)">${r.months} мес</div></td>
      <td style="font-size:12px;color:var(--text3);max-width:220px;white-space:normal">${fpEsc(r.reg.src)}${r.v.toIntervalKm ? '<div style="color:var(--green)">задан в карточке</div>' : ''}</td>
      <td style="text-align:right">${n(r.cur)}</td>
      <td style="text-align:right">${r.perDay ? n(r.perDay) + ' км/сут' : '—'}</td>
      <td>${r.last ? fmtDate(r.last.date) + '<div style="font-size:11px;color:var(--text3)">' + n(r.last.odometer) + ' км</div>' : '<span style="color:#d97706">не внесено</span>'}</td>
      <td style="${soon ? 'color:var(--red);font-weight:700' : ''}">${r.next ? fmtDate(r.next.date) : '—'}
        <div style="font-size:11px;font-weight:400;color:var(--text3)">${r.next ? n(r.next.odo) + ' км' + (left != null ? ', через ' + n(Math.max(0, left)) + ' км' : '') : ''}</div></td>
    </tr>`;
  }).join('');
  openGenericModal('Регламенты ТО и ближайшие сроки', `
    <div style="font-size:13px;color:var(--text3);margin-bottom:10px">
      Интервал берётся из карточки машины, а если там пусто — из заводского регламента по марке.
      Дата следующего ТО — по среднему пробегу за последние три месяца или по сроку в месяцах, что наступит раньше.</div>
    <div style="max-height:60vh;overflow:auto"><table class="data-table" style="width:100%">
      <thead><tr><th>Машина</th><th>Организация</th><th style="text-align:right">Интервал</th><th>Источник регламента</th>
        <th style="text-align:right">Пробег, км</th><th style="text-align:right">Темп</th><th>Последнее ТО</th><th>Следующее ТО</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px">
      <button class="btn btn-ghost" onclick="toExportRegs()">Выгрузить в Excel</button>
      <button class="btn btn-ghost" onclick="toOpenRules()">Настроить виды ТО</button>
      ${toGeneratorMaintenanceEntryHtml()}
      <span>
        <button class="btn btn-ghost" onclick="closeModal(&quot;genericModal&quot;)">Закрыть</button>
        <button class="btn btn-primary" onclick="closeModal('genericModal');toRebuildPlanClick()">Построить план</button>
      </span>
    </div>`, 1100);
}

function toExportRegs() {
  const list = toPlanOverview();
  const P = { navy: '1B3A6B', white: 'FFFFFF', gray1: 'F8FAFC', gray3: 'E2E8F0', text: '1E293B', red: 'B91C1C' };
  const b = { style: 'thin', color: { rgb: P.gray3 } }, border = { top: b, bottom: b, left: b, right: b };
  const st = o => Object.assign({ font: { sz: 10, color: { rgb: P.text } }, border, alignment: { vertical: 'center', wrapText: true } }, o);
  const head = st({ font: { bold: true, sz: 10, color: { rgb: P.white } }, fill: { patternType: 'solid', fgColor: { rgb: P.navy } },
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true } });
  const cols = ['Госномер', 'Марка', 'Организация', 'Объект', 'Состояние', 'Интервал ТО, км', 'Интервал, мес', 'Источник регламента',
                'Пробег сейчас, км', 'Средний пробег, км/сут', 'Последнее ТО', 'Пробег на последнем ТО',
                'Следующее ТО (дата)', 'Следующее ТО (пробег)', 'Осталось, км', 'Плановых ТО за год'];
  const ws = {};
  const put = (r, c, v, s, z) => { const cell = { v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's', s }; if (z && typeof v === 'number') cell.z = z; ws[XLSX.utils.encode_cell({ r, c })] = cell; };
  put(0, 0, 'Регламенты ТО и график обслуживания на ' + fmtDate(BusinessCalendar.resolve(data,new Date().toISOString()).today), { font: { bold: true, sz: 13 } });
  cols.forEach((c, i) => put(2, i, c, head));
  list.forEach((r, i) => {
    const R = i + 3, fill = i % 2 ? { fill: { patternType: 'solid', fgColor: { rgb: P.gray1 } } } : {};
    const s = st(fill), num = st(Object.assign({ alignment: { horizontal: 'right', vertical: 'center' } }, fill));
    const left = r.next ? Math.round(r.next.odo - r.cur) : null;
    const red = st(Object.assign({ alignment: { horizontal: 'right', vertical: 'center' }, font: { sz: 10, bold: true, color: { rgb: P.red } } }, fill));
    [r.v.plate, r.v.make, r.v.org || '', r.v.object || '', r.v.status || '', r.interval, r.months, r.reg.src,
     Math.round(r.cur), Math.round(r.perDay), r.last ? fmtDate(r.last.date) : 'не внесено', r.last ? Math.round(r.last.odometer || 0) : '',
     r.next ? fmtDate(r.next.date) : '', r.next ? Math.round(r.next.odo) : '', left, r.count]
      .forEach((v, c) => put(R, c, v, c === 14 && left != null && left <= r.interval * 0.15 ? red : typeof v === 'number' ? num : s, '#,##0'));
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: list.length + 2, c: cols.length - 1 } });
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
  ws['!cols'] = [13, 20, 12, 24, 14, 12, 10, 34, 13, 12, 13, 14, 14, 14, 11, 10].map(wch => ({ wch }));
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Регламенты ТО');
  XLSX.writeFile(wb, 'Регламенты_и_график_ТО_' + BusinessCalendar.resolve(data,new Date().toISOString()).today + '.xlsx');
}


// ─── Разовая настройка после обновления ───────────────────
// Проставляет регламент машинам, у которых он не заполнен, и один раз строит
// график ТО, если плановых записей ещё нет. Отметка хранится в базе, поэтому
// на всех компьютерах это делается один раз, а не при каждом запуске.

async function toAutoSetupOnce() {
  if (!data.vehicles || !data.vehicles.length) return;
  const meta = (data.appMeta && data.appMeta[0]) || { id: 'meta' };
  if (!data.appMeta || !data.appMeta.length) (data.appMeta = data.appMeta || []).push(meta);

  let changed = 0;
  data.vehicles.forEach(v => {
    if (!v.toIntervalKm) {
      const reg = toRegFor(v);
      v.toIntervalKm = reg.km;
      v.toIntervalMonths = reg.months;
      changed++;
    }
  });

  const hasPlan = (data.vehicleTo || []).some(r => r.planned);
  const needPlan = !meta.toPlanInit && !hasPlan;
  if (!changed && !needPlan) return;

  if (needPlan) {
    if (await toRebuildPlan(12) == null) return;
    meta.toPlanInit = new Date().toISOString();
    await saveData(data);
    showToast && showToast('Построен график ТО по регламентам');
  } else {
    await saveData(data);
    if (changed) showToast && showToast('Регламент ТО проставлен: ' + changed + ' машин');
  }
}
