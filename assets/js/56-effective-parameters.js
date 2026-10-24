// Effective parameters are an owned scenario until a canonical save is acknowledged.
const EFFECTIVE_PARAMETER_FIELDS={
 vehicles:[['norm','Базовая норма, л/100 км',6],['normCity','Город, л/100 км',6],['normHighway','Трасса, л/100 км',6],['normIdle','Холостой ход, л/ч',6]],
 generators:[['power','Номинальная мощность, кВт',6],['norm','Постоянная норма, л/ч',6],['norm100','Норма при 100% нагрузки, л/ч',6],['norm50','Норма при 50% нагрузки, л/ч',6],['normIdle','Холостой ход, л/ч',6]],
 costProfiles:[['salaryRate','Оплата труда, ₽/ед.',6],['depreciationRate','Амортизация, ₽/ед.',6],['fuelRate','Норма топлива, л/100 км или л/ч',6],['fuelPrice','Цена топлива, ₽/л',6]]
};
function effectiveParametersClone(value){return JSON.parse(JSON.stringify(value));}
function effectiveParametersReadable(section){return typeof _sync==='undefined'||!_sync.access||(_sync.access.readable||[]).includes(section);}
function effectiveParametersWritable(section,kind){
 if(typeof _loadWriteBlocked!=='undefined'&&_loadWriteBlocked)return false;
 if(typeof _sync==='undefined'||!_sync.access)return true;
 const access=_sync.access,fields=access.fieldPermissions;
 return (access.writable||[]).includes(section)&&(!fields||!Object.hasOwn(fields,section)||Array.isArray(fields[section])&&fields[section].includes(kind));
}
function effectiveParametersAsset(section,id){const rows=(data[section]||[]).filter(row=>row.id===id);if(rows.length!==1)throw Error('Карточка не найдена или её ID неоднозначен');return rows[0];}
function effectiveParametersProfile(assetRef){const rows=(data.costProfiles||[]).filter(row=>row.assetRef===assetRef);if(rows.length>1)throw Error('Для техники найдено несколько профилей ставок. Сначала проверьте дубли.');return rows[0]||null;}
function effectiveParametersToday(){return typeof dispatcherLocalDate==='function'?dispatcherLocalDate():wfToday();}
function effectiveParametersBefore(date){const day=new Date(date+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-1);return day.toISOString().slice(0,10);}
function effectiveParametersPeriodStart(period){return period.from==='1900-01-01'&&typeof period.id==='string'&&period.id.startsWith('fuel-season:baseline:')?'Прежние нормы карточки':fmtDate(period.from);}
function effectiveParametersMetadata(state){return {version:1,periods:effectiveParametersClone(state.periods)};}
function effectiveParametersValidate(state,metadata){return effectiveParametersClone(EffectivePeriods.validate(state.section,{...(state.original||{}),[state.kind]:metadata},state.kind));}
function effectiveParametersCurrent(state,write=true){
 if(state.context!==wfCommandContextStamp()||state.databaseRef!==data)throw Error('База, пользователь или права изменились. Откройте журнал заново. Введённые значения остаются в форме.');
 if(write&&!effectiveParametersWritable(state.section,state.kind))throw Error('Для вашей роли изменение этих параметров недоступно');
 const row=state.section==='costProfiles'?effectiveParametersProfile(state.assetRef):effectiveParametersAsset(state.section,state.id);
 if(JSON.stringify(row)!==state.originalText)throw Error('Исходные параметры уже изменились. Откройте журнал заново; введённые значения остаются в форме.');
 if(state.assetSection&&JSON.stringify(effectiveParametersAsset(state.assetSection,state.assetId))!==state.assetText)throw Error('Карточка техники изменилась. Откройте журнал ставок заново; введённые значения остаются в форме.');
 return row;
}
function effectiveParametersRaw(state){return JSON.stringify(Object.fromEntries(['from','basis',...state.fields.map(([key])=>key)].map(key=>[key,state.form.elements[key].value])));}
function effectiveParametersInvalidate(state){state.reviewed=null;state.form.elements.confirm.checked=false;state.form.querySelector('[data-ep-preview]').hidden=true;state.form.querySelector('[data-ep-confirm]').hidden=true;state.form.querySelector('[data-ep-save]').disabled=true;}
function effectiveParametersReset(state,period){
 state.editingId=period?.id??null;state.editing=period!=null;
 state.form.elements.from.value=period?.from||'';state.form.elements.basis.value=period?.basis||'';
 state.fields.forEach(([key])=>{state.form.elements[key].value=period?.parameters[key]??'';});
 state.form.querySelector('[data-ep-stage]').textContent=period?'Применить правку к черновику':'Добавить период в черновик';
 state.form.querySelector('[data-ep-editing]').textContent=period?(effectiveParametersPeriodStart(period)==='Прежние нормы карточки'?'Редактируются прежние нормы карточки':'Редактируется период с '+fmtDate(period.from)):'Новый период: укажите реальную дату начала и основание.';
 state.initialFields=effectiveParametersRaw(state);precisionRemember(state.form);
}
function effectiveParametersChoose(state,period){
 if(state.pending)return;
 if(effectiveParametersRaw(state)!==state.initialFields){state.form.querySelector('[data-ep-error]').textContent='Сначала примените текущую правку к черновику или отмените её.';return;}
 state.form.querySelector('[data-ep-error]').textContent='';effectiveParametersReset(state,period);
}
function effectiveParametersHistory(state){
 const host=state.form.querySelector('[data-ep-history]'),periods=state.periods.slice().sort((a,b)=>a.from.localeCompare(b.from));host.replaceChildren();
 if(!periods.length){host.innerHTML='<p>Периодов пока нет. Прежние поля карточки действуют, пока вы явно не сохраните журнал.</p>';return;}
 const table=document.createElement('table');table.className='tbl';table.innerHTML='<thead><tr><th>С даты</th><th>По дату включительно</th><th>Параметры</th><th>Основание</th>'+(state.readonly?'':'<th>Правка черновика</th>')+'</tr></thead><tbody></tbody>';
 const body=table.querySelector('tbody');periods.forEach((period,index)=>{
  const row=document.createElement('tr');row.dataset.periodId=JSON.stringify(period.id);row.innerHTML='<td>'+htmlEsc(effectiveParametersPeriodStart(period))+(period.from>effectiveParametersToday()?'<br><small>Будущий период</small>':'')+'</td><td>'+htmlEsc(periods[index+1]?fmtDate(effectiveParametersBefore(periods[index+1].from)):'Без окончания')+'</td><td>'+state.fields.map(([key,label])=>htmlEsc(label)+': '+htmlEsc(period.parameters[key]==null?'Не задано':precisionFormat(period.parameters[key]))).join('<br>')+'</td><td style="white-space:pre-wrap">'+htmlEsc(period.basis)+'</td>';
  if(!state.readonly){const actions=document.createElement('td');actions.innerHTML='<button type="button" class="btn btn-ghost btn-sm" data-ep-edit>Изменить</button> <button type="button" class="btn btn-ghost btn-sm" data-ep-delete>Убрать из черновика</button>';
   actions.querySelector('[data-ep-edit]').onclick=()=>effectiveParametersChoose(state,period);
   actions.querySelector('[data-ep-delete]').onclick=()=>{if(state.pending)return;if(effectiveParametersRaw(state)!==state.initialFields){state.form.querySelector('[data-ep-error]').textContent='Сначала примените или отмените текущую правку.';return;}state.periods=state.periods.filter(item=>item.id!==period.id);effectiveParametersInvalidate(state);effectiveParametersReset(state);effectiveParametersHistory(state);};row.append(actions);
  }body.append(row);
 });host.append(table);
}
function effectiveParametersStage(state){
 effectiveParametersCurrent(state);const form=state.form;
 if(!form.elements.from.value)throw Error('Укажите дату начала периода');
 const basis=form.elements.basis.value.trim();if(!basis)throw Error('Укажите основание периода');
 const parameters=Object.fromEntries(state.fields.map(([key,,scale])=>[key,precisionInput(form.elements[key],{scale,blank:'null'})]));
 const period={id:state.editing?state.editingId:wfId('parameter-period'),from:form.elements.from.value,basis,parameters};
 const periods=state.periods.filter(row=>!state.editing||row.id!==state.editingId);periods.push(period);
 const metadata=effectiveParametersValidate(state,{version:1,periods});state.periods=metadata.periods;effectiveParametersInvalidate(state);effectiveParametersReset(state);effectiveParametersHistory(state);
 return metadata;
}
function effectiveParametersPreview(state){
 effectiveParametersCurrent(state);if(effectiveParametersRaw(state)!==state.initialFields)effectiveParametersStage(state);
 const metadata=effectiveParametersValidate(state,effectiveParametersMetadata(state)),resolved=EffectivePeriods.resolve(state.section,{...(state.original||{}),[state.kind]:metadata},effectiveParametersToday(),state.kind);
 const box=state.form.querySelector('[data-ep-preview]');box.innerHTML='<h4>Предпросмотр журнала</h4><p>Периодов: '+metadata.periods.length+'. Первый период — с '+htmlEsc(fmtDate(metadata.periods[0].from))+'. На сегодня: '+htmlEsc(resolved.status==='known'?'выбран период с '+fmtDate(resolved.from):'параметры не заданы')+'.</p><p><b>До первого периода параметры неизвестны.</b> Прежние поля карточки не подставляются в новый режим.</p><p>Если ранее были закрытые месяцы или проведённые акты, сохранение проверит их покрытие. Чтобы сохранить защищённую историю, при необходимости добавьте отдельный период с теми же прежними параметрами, реальной датой начала и основанием. Программа не создаёт такой период автоматически.</p><p>Это сценарий по открытым данным. При сохранении сервер повторно проверит актуальные документы и закрытые месяцы. Прежние поля карточки, пробег, часы и исходные документы остаются на месте.</p>';
 box.hidden=false;state.reviewed=JSON.stringify(metadata);state.form.elements.confirm.checked=false;state.form.querySelector('[data-ep-confirm]').hidden=false;state.form.querySelector('[data-ep-save]').disabled=true;
}
async function effectiveParametersCommit(state){
 if(state.pending||state.readonly)return;const form=state.form,errorNode=form.querySelector('[data-ep-error]');errorNode.textContent='';let saved=false,unlock;
 try{
  effectiveParametersCurrent(state);if(effectiveParametersRaw(state)!==state.initialFields)throw Error('Примените последнюю правку и повторите предпросмотр');
  const metadata=effectiveParametersValidate(state,effectiveParametersMetadata(state)),text=JSON.stringify(metadata);
  if(state.reviewed!==text||!form.elements.confirm.checked)throw Error('Откройте предпросмотр и подтвердите периоды');
  if(JSON.stringify(state.original?.[state.kind])===text){showToast('Периоды не изменились');return;}
  if(typeof _pendingSaveOperations!=='undefined'&&_pendingSaveOperations.size)throw Error('Дождитесь завершения текущего сохранения');
  const baseline=platformSaveBaseline(),matches=(baseline[state.section]||[]).filter(row=>state.section==='costProfiles'?row.assetRef===state.assetRef:row.id===state.id);
  if(matches.length!==(state.original?1:0)||JSON.stringify(matches[0]||null)!==state.originalText)throw Error('Сначала сохраните или отмените незавершённые изменения исходной карточки');
  const next=effectiveParametersClone(baseline);let row=(next[state.section]||[]).find(item=>item.id===state.id);
  if(!row){row={id:state.id,assetRef:state.assetRef};(next[state.section]||(next[state.section]=[])).push(row);}row[state.kind]=metadata;
  if(state.operationText!==text){state.operationText=text;state.operationId=wfId('effective-parameters');}
  const auditBefore=JSON.stringify(data.auditLog||[]);state.pending=true;unlock=wfLockCommandForm(form);form.querySelector('[data-ep-status]').textContent='Ожидается подтверждение сохранения…';
  saved=await saveData(next,{noMerge:true,requiredCanonicalSections:[state.section],operation:{id:state.operationId},history:{action:state.kind==='fuelNorms'?'Периоды норм топлива':'Периоды ставок оценки',reason:metadata.periods.map(period=>period.from+': '+period.basis).join('; ').slice(0,4000)}});
  if(saved!==true){const detail=typeof platformRuntimeStatus==='function'?platformRuntimeStatus().lastError?.message:'';throw Error((detail?detail+'. ':'')+'Сохранение периодов не подтверждено. Введённые значения остаются в форме; проверьте результат и повторите.');}
  effectiveParametersCurrent(state);const canonical=(next[state.section]||[]).filter(item=>item.id===state.id);if(canonical.length!==1)throw Error('Сервер не вернул сохранённый журнал. Загрузите данные и проверьте исходную базу.');
  EffectivePeriods.validate(state.section,canonical[0],state.kind);
  data[state.section]=state.original?(data[state.section]||[]).map(item=>item.id===state.id?effectiveParametersClone(canonical[0]):item):[...(data[state.section]||[]),effectiveParametersClone(canonical[0])];
  if(JSON.stringify(data.auditLog||[])===auditBefore)data.auditLog=effectiveParametersClone(next.auditLog||[]);rebuildIndex();
  if(document.getElementById('wfModal')?.contains(form))closeModal('wfModal');
  if(typeof syncRefreshView==='function')syncRefreshView([state.section]);showToast('Периоды сохранены');
 }catch(error){wfShowCommandError(errorNode,saved?Error('Сервер подтвердил сохранение, но карточка или сеанс изменились. Проверьте исходную базу перед повтором. '+error.message):error);}
 finally{state.pending=false;if(unlock)unlock();form.querySelector('[data-ep-status]').textContent='';form.querySelector('[data-ep-save]').disabled=!state.reviewed||!form.elements.confirm.checked;}
}
function effectiveParametersOpen(section,id,assetRef){
 try{
  if(typeof EffectivePeriods==='undefined'||EffectivePeriods.apiVersion!==1)throw Error('Модуль периодов не загружен. Откройте программу заново.');
  if(!effectiveParametersReadable(section))throw Error('Для вашей роли журнал параметров недоступен');
  const kind=section==='costProfiles'?'ratePeriods':'fuelNorms',original=section==='costProfiles'?effectiveParametersProfile(assetRef):effectiveParametersAsset(section,id),kindTitle=kind==='fuelNorms'?'Нормы топлива по датам':'Ставки оценки по датам';
  let assetSection=null,assetId=null,asset=null;
  if(section==='costProfiles'){const references=wfAssets().filter(item=>item.ref===assetRef);if(references.length!==1)throw Error('Техника не найдена или её ссылка неоднозначна');const reference=references[0];if(!reference||!effectiveParametersReadable(assetRef.startsWith('v:')?'vehicles':'generators'))throw Error('Техника недоступна');assetSection=assetRef.startsWith('v:')?'vehicles':'generators';assetId=reference.row.id;asset=effectiveParametersAsset(assetSection,assetId);id=original?.id??wfId('costprofile');}
  const validated=EffectivePeriods.validate(section,original||{},kind),state={section,id,kind,assetRef,assetSection,assetId,assetText:asset?JSON.stringify(asset):null,original:original?effectiveParametersClone(original):null,originalText:JSON.stringify(original||null),context:wfCommandContextStamp(),databaseRef:data,fields:EFFECTIVE_PARAMETER_FIELDS[section],periods:validated.mode==='legacy'?[]:effectiveParametersClone(validated.periods),readonly:!effectiveParametersWritable(section,kind),reviewed:null,pending:false};
  if(section==='costProfiles'){const unit=assetSection==='vehicles'?'км':'ч';state.fields=state.fields.map(([key,title,scale])=>[key,key==='salaryRate'?'Оплата труда, ₽/'+unit:key==='depreciationRate'?'Амортизация, ₽/'+unit:key==='fuelRate'?'Норма топлива, '+(unit==='км'?'л/100 км':'л/ч'):title,scale]);}
  const label=section==='costProfiles'?wfAsset(assetRef).label:fuelAccountingLabel(section,original),note='Пустой параметр означает «неизвестно», 0 — явный ноль. Каждый период содержит полный набор параметров и не наследует значения прошлого периода.';
  if(document.getElementById('genericModal'))closeModal('genericModal');
  wfShowDialog(kindTitle+' · '+label,'<form id="effectiveParametersForm" class="wf-form"><p class="wf-wide">'+htmlEsc(note)+'</p><div class="wf-wide" data-ep-history style="overflow:auto"></div>'+(state.readonly?'<p class="wf-wide">Журнал доступен только для просмотра.</p>':'<div class="wf-wide"><button type="button" class="btn btn-ghost btn-sm" data-ep-new>Новый период</button></div><p class="wf-wide" data-ep-editing></p><label>С даты *<input name="from" type="date" required></label><label class="wf-wide">Основание / документ *<textarea name="basis" rows="2" maxlength="4000" required></textarea></label>'+state.fields.map(([key,title])=>'<label>'+htmlEsc(title)+'<input name="'+key+'" inputmode="decimal" placeholder="Не задано"></label>').join('')+'<div class="wf-wide wf-actions"><button type="button" class="btn btn-ghost btn-sm" data-ep-copy>Скопировать прежние значения карточки</button><button type="button" class="btn btn-ghost btn-sm" data-ep-reset>Отменить правку полей</button><button type="button" class="btn btn-ghost" data-ep-stage>Добавить период в черновик</button></div><p class="wf-wide">Время окончания определяется следующим периодом. Даты и основания задаются вручную. Пока сохранение не подтверждено, изменения существуют только в этом черновике.</p><section class="wf-wide wf-note" data-ep-preview hidden></section><label class="wf-wide" data-ep-confirm hidden><span><input name="confirm" type="checkbox"> Подтверждаю даты, основания и параметры после проверки предпросмотра</span></label>')+'<div class="wf-wide wf-error" role="alert" data-ep-error></div><p class="wf-wide" role="status" data-ep-status></p><div class="wf-wide wf-actions"><button type="button" class="btn btn-ghost" data-ep-cancel>Закрыть</button>'+(state.readonly?'':'<button type="button" class="btn btn-ghost" data-ep-review>Предпросмотр</button><button type="button" class="btn btn-primary" data-ep-save disabled>Подтвердить сохранение</button>')+'</div></form>');
  const form=state.form=document.getElementById('effectiveParametersForm');form.querySelectorAll('.wf-actions').forEach(row=>row.style.flexWrap='wrap');form.querySelector('[data-ep-cancel]').onclick=()=>closeModal('wfModal');effectiveParametersHistory(state);if(state.readonly)return;
  effectiveParametersReset(state);const action=fn=>{if(state.pending)return;form.querySelector('[data-ep-error]').textContent='';try{fn();}catch(error){wfShowCommandError(form.querySelector('[data-ep-error]'),error);}};
  form.querySelector('[data-ep-new]').onclick=()=>action(()=>effectiveParametersChoose(state));
  form.querySelector('[data-ep-reset]').onclick=()=>action(()=>effectiveParametersReset(state,state.editing?state.periods.find(period=>period.id===state.editingId):null));
  form.querySelector('[data-ep-copy]').onclick=()=>action(()=>{state.fields.forEach(([key])=>{form.elements[key].value=state.original?.[key]??'';});effectiveParametersInvalidate(state);});
  form.querySelector('[data-ep-stage]').onclick=()=>action(()=>effectiveParametersStage(state));form.querySelector('[data-ep-review]').onclick=()=>action(()=>effectiveParametersPreview(state));form.querySelector('[data-ep-save]').onclick=()=>void effectiveParametersCommit(state);
  form.onsubmit=event=>{event.preventDefault();action(()=>effectiveParametersStage(state));};
  form.addEventListener('input',event=>{if(event.target===form.elements.confirm){form.querySelector('[data-ep-save]').disabled=!state.reviewed||!form.elements.confirm.checked;return;}effectiveParametersInvalidate(state);});
  form.addEventListener('change',event=>{if(event.target===form.elements.confirm){form.querySelector('[data-ep-save]').disabled=!state.reviewed||!form.elements.confirm.checked;return;}effectiveParametersInvalidate(state);});
 }catch(error){showToast(error.message);}
}
function fuelNormsOpen(section,id){if(!['vehicles','generators'].includes(section)){showToast('Периоды норм доступны для машины или ДЭС');return;}effectiveParametersOpen(section,id);}
function costRatesOpen(assetRef){effectiveParametersOpen('costProfiles',null,assetRef);}

// Scalar fields remain visible for old cards; a dated journal owns subsequent changes.
function effectiveParametersLegacyForm(section,row,modalId){
 const modal=document.getElementById(modalId),active=row?.fuelNorms!=null;
 const ids=section==='vehicles'?['vm_norm','vm_norm_city','vm_norm_highway','vm_norm_idle']:['gm_power','gm_norm','gm_norm100','gm_norm50','gm_norm_idle'];
 ids.forEach(id=>{const input=document.getElementById(id);if(input){input.readOnly=active;input.setAttribute('aria-readonly',String(active));}});
 modal?.querySelector('[data-ep-legacy]')?.remove();if(!row||!modal)return;
 const panel=document.createElement('div');panel.dataset.epLegacy='';panel.className='wf-note';panel.style.gridColumn='1 / -1';panel.style.flexBasis='100%';panel.innerHTML='<p>'+htmlEsc(active?'Действуют нормы по датам. Прежние параметры карточки доступны только для просмотра; изменение задаётся отдельным периодом.':'Прежние нормы действуют по всей истории. Можно явно включить журнал норм по датам.')+'</p><button type="button" class="btn btn-ghost btn-sm">Периоды норм</button>';panel.querySelector('button').onclick=()=>{closeModal(modalId);fuelNormsOpen(section,row.id);};
 const first=document.getElementById(ids[0]);(first?.closest('.form-group')||modal.querySelector('.modal-body'))?.before(panel);
}
function effectiveParametersScalarGuard(section,row,map){
 if(row?.fuelNorms==null)return true;
 for(const [key,id]of Object.entries(map)){const input=document.getElementById(id);if(input&&input._precisionInitial!==undefined&&input.value!==input._precisionInitial){showFieldError('Нормы уже заданы по датам. Измените нужный период в журнале норм.',id);return false;}}
 return true;
}
