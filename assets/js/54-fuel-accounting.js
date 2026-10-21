// An explicit fuel anchor is an owned form draft until its canonical save ACK.
// Legacy balances, distance/hour journals and source records keep their values.
const FUEL_ACCOUNTING_SECTIONS=['vehicles','generators','tanks'];
const FUEL_ACCOUNTING_GRADES=['ДТ','Газ','Бензин','АИ-92','АИ-95','АИ-98','АИ-100'];
function fuelAccountingWritable(section){return !(typeof _loadWriteBlocked!=='undefined'&&_loadWriteBlocked)&&(typeof _sync==='undefined'||!_sync.access||(_sync.access.writable||[]).includes(section));}
function fuelAccountingAsset(section,id){
  if(!FUEL_ACCOUNTING_SECTIONS.includes(section))throw Error('Начало учёта доступно для машины, ДЭС или ёмкости');
  const matches=(data[section]||[]).filter(row=>row.id===id);if(matches.length!==1)throw Error('Карточка не найдена или её ID неоднозначен');return matches[0];
}
function fuelAccountingLabel(section,row){return section==='vehicles'?[row.plate,row.make].filter(Boolean).join(' · '):section==='generators'?'ДЭС · '+(row.name||row.code||row.id):'Ёмкость · '+(row.name||row.id);}
function fuelAccountingNumber(text,label){
  try{return precisionParse(text,{scale:3,blank:'error'});}catch(error){throw Error('Поле «'+label+'»: укажите полное неотрицательное число, до трёх знаков после запятой');}
}
function fuelAccountingGrade(asset){const grade=typeof vehicleFuelGrade==='function'?vehicleFuelGrade(asset):asset.fuelGrade;return FUEL_ACCOUNTING_GRADES.includes(grade)?grade:asset.fuel==='gas'?'Газ':asset.fuel==='gasoline'?'Бензин':'ДТ';}
function fuelAccountingSourceRow(source,grade){
  const row=document.createElement('div');row.className='gsm-opening-row';row.dataset.fuelAccountingSource='';
  row.innerHTML='<input aria-label="Организация входящего остатка" data-fa-source="org" maxlength="500" placeholder="Организация" value="'+htmlEsc(source.org??'')+'"><select aria-label="Марка входящего топлива" data-fa-source="grade">'+FUEL_ACCOUNTING_GRADES.map(value=>'<option'+(value===(source.grade||grade)?' selected':'')+'>'+htmlEsc(value)+'</option>').join('')+'</select><input aria-label="Литры источника" data-fa-source="qty" inputmode="decimal" value="'+htmlEsc(source.qty??'')+'"><button type="button" class="btn btn-ghost" aria-label="Удалить источник">×</button>';
  row.querySelector('button').onclick=()=>{row.remove();row._fuelAccountingChanged?.();};row._precisionSource=typeof source.qty==='number'?{qty:source.qty}:null;precisionRemember(row);return row;
}
function fuelAccountingRead(state){
  const form=state.form,metadata={version:1,from:form.elements.from.value,opening:precisionInput(form.elements.opening,{scale:3,blank:'error',...(state.original.fuelAccounting?{previous:state.original.fuelAccounting.opening}:{})}),basis:form.elements.basis.value.trim()};
  if(form.elements.allocate.checked)metadata.sources=[...form.querySelectorAll('[data-fuel-accounting-source]')].map(row=>({org:row.querySelector('[data-fa-source="org"]').value.trim(),grade:row.querySelector('[data-fa-source="grade"]').value,qty:precisionInput(row.querySelector('[data-fa-source="qty"]'),{scale:3,blank:'error',...(row._precisionSource?{previous:row._precisionSource.qty}:{})})}));
  const resolved=AccountingBoundary.resolve(state.section,{...state.original,fuelAccounting:metadata}),{mode,...value}=resolved;return JSON.parse(JSON.stringify(value));
}
function fuelAccountingCurrent(state){
  if(state.context!==wfCommandContextStamp()||data!==state.databaseRef)throw Error('База, пользователь или права изменились. Откройте форму заново. Введённые значения остаются в полях.');
  if(!fuelAccountingWritable(state.section))throw Error('Для вашей роли изменение начала учёта недоступно');
  const row=fuelAccountingAsset(state.section,state.id);if(JSON.stringify(row)!==state.originalText)throw Error('Карточка уже изменилась. Откройте её заново; введённые значения остаются в полях.');return row;
}
function fuelAccountingRows(section,id){
  if(section==='vehicles')return [...(data.records||[]).filter(row=>row.vehicleId===id),...(data.fuelPurchases||[]).filter(row=>row.vehicleId===id)];
  if(section==='generators')return (data.genRecords||[]).filter(row=>row.generatorId===id);
  return [...(data.tankIncomes||[]).filter(row=>row.tankId===id),...(data.genRecords||[]).filter(row=>(typeof genRecordTankId==='function'?genRecordTankId(row):row.tankId??row.counterTankId)===id),...(data.fuelMovements||[]).filter(row=>row.fromTankId===id||row.toTankId===id)];
}
function fuelAccountingPreview(state){
  if(state.pending)return;
  fuelAccountingCurrent(state);const metadata=fuelAccountingRead(state),boundary=AccountingBoundary.resolve(state.section,{...state.original,fuelAccounting:metadata});
  const counts={historical:0,current:0,'invalid-date':0};for(const row of fuelAccountingRows(state.section,state.id))counts[AccountingBoundary.classify(boundary,row.date)]++;
  state.reviewed=JSON.stringify(metadata);state.metadata=metadata;state.form.elements.confirm.checked=false;state.form.querySelector('[data-fa-save]').disabled=true;
  const panel=state.form.querySelector('[data-fa-preview]');panel.hidden=false;panel.innerHTML='<h3>Предпросмотр начала учёта</h3><p><strong>'+htmlEsc(fuelAccountingLabel(state.section,state.original))+'</strong></p><p>Учёт с '+htmlEsc(fmtDate(metadata.from))+'. Входящий остаток: <strong>'+htmlEsc(String(metadata.opening).replace('.',','))+' л</strong>.</p><p>Основание: '+htmlEsc(metadata.basis)+'</p><p>История до '+htmlEsc(fmtDate(metadata.from))+' остаётся видимой. В расчёте после начала учёта она не учитывается.</p><p>Исторических записей: '+counts.historical+'; с даты начала: '+counts.current+(counts['invalid-date']?'; с некорректной датой: '+counts['invalid-date']:'')+'.</p><p>Пробег, моточасы и исходные поля остатка карточки сохраняют свои значения.</p>';
  state.form.querySelector('[data-fa-confirmation]').hidden=false;
}
function fuelAccountingCopyMeasure(state){
  if(state.pending)return;
  fuelAccountingCurrent(state);const from=state.form.elements.from.value;if(!PlatformIntegrity.dateValid(from,'date'))throw Error('Сначала укажите дату начала учёта');
  const rows=fuelAccountingRows(state.section,state.id).filter(row=>PlatformIntegrity.dateValid(row.date,'date')&&row.date<from&&typeof(state.section==='tanks'?row.measured:row.tankMeasured)==='number'&&Number.isFinite(state.section==='tanks'?row.measured:row.tankMeasured)&&(state.section==='tanks'?row.measured:row.tankMeasured)>=0).sort((a,b)=>b.date.localeCompare(a.date));
  if(!rows.length)throw Error('Перед этой датой нет подтверждаемого числового замера. Введите остаток по первичному документу.');
  if(rows.filter(row=>row.date===rows[0].date).length!==1)throw Error('На последнюю дату записано несколько замеров. Сверьте документ и введите нужный остаток вручную.');
  const row=rows[0];let grade='';
  if(state.section==='vehicles'){
    const primary=vehicleFuelGrade(state.original);grade=recordFuelGrade(row,state.original);
    if(fqRecordFuelFamily(row,state.original)!==fqFuelFamily(primary))throw Error('Последний замер относится к другому виду топлива ('+grade+'). Введите подтверждённый остаток вручную и проверьте распределение источников.');
  }
  state.form.elements.opening.value=String(state.section==='tanks'?row.measured:row.tankMeasured);state.form.elements.basis.value='Замер остатка'+(grade?' · '+grade:'')+' от '+fmtDate(row.date)+', запись '+String(row.id);state.invalidate();
}
async function fuelAccountingCommit(state){
  if(state.pending)return;const form=state.form,errorNode=form.querySelector('[data-fa-error]');errorNode.textContent='';
  let unlock=null,saved=false;
  try{
    fuelAccountingCurrent(state);const metadata=fuelAccountingRead(state),text=JSON.stringify(metadata);
    if(!state.reviewed||state.reviewed!==text||!form.elements.confirm.checked)throw Error('Откройте предпросмотр и подтвердите дату и входящий остаток');
    if(typeof _pendingSaveOperations!=='undefined'&&_pendingSaveOperations.size)throw Error('Дождитесь завершения текущего сохранения');
    const previous=platformSaveBaseline(),matches=(previous[state.section]||[]).filter(row=>row.id===state.id);
    if(matches.length!==1||JSON.stringify(matches[0])!==state.originalText)throw Error('Сначала сохраните или отмените незавершённые изменения этой карточки');
    const next=JSON.parse(JSON.stringify(previous)),row=next[state.section].find(item=>item.id===state.id);row.fuelAccounting=metadata;
    if(state.operationText!==text){state.operationText=text;state.operationId=wfId('fuel-accounting');}
    const auditBefore=JSON.stringify(data.auditLog||[]);state.pending=true;unlock=wfLockCommandForm(form);form.querySelector('[data-fa-status]').textContent='Ожидается подтверждение сохранения…';
    saved=await saveData(next,{noMerge:true,requiredCanonicalSections:[state.section],operation:{id:state.operationId},history:{action:'Начало учёта ГСМ',reason:metadata.basis}});
    if(saved!==true)throw Error('Начало учёта не подтверждено. Введённые значения остаются в форме; проверьте подключение и повторите.');
    fuelAccountingCurrent(state);
    const canonical=(next[state.section]||[]).filter(item=>item.id===state.id);if(canonical.length!==1)throw Error('Сервер не вернул сохранённую карточку. Загрузите данные и проверьте историю.');
    AccountingBoundary.resolve(state.section,canonical[0]);
    data[state.section]=data[state.section].map(item=>item.id===state.id?JSON.parse(JSON.stringify(canonical[0])):item);
    if(JSON.stringify(data.auditLog||[])===auditBefore)data.auditLog=JSON.parse(JSON.stringify(next.auditLog||[]));rebuildIndex();
    if(document.getElementById('wfModal')?.contains(form))closeModal('wfModal');
    if(activeSection==='generators'&&typeof selectedGeneratorId!=='undefined'&&selectedGeneratorId===state.id&&typeof renderGenDetail==='function')renderGenDetail(fuelAccountingAsset('generators',state.id));
    else if(activeSection==='tanks'&&typeof selectedTankId!=='undefined'&&selectedTankId===state.id&&typeof renderTankDetail==='function')renderTankDetail(fuelAccountingAsset('tanks',state.id));
    else if(typeof syncRefreshView==='function')syncRefreshView([state.section]);
    showToast('Начало учёта ГСМ сохранено');
  }catch(error){wfShowCommandError(errorNode,saved?Error('Сервер подтвердил сохранение, но карточка или сеанс изменились. Проверьте исходную базу перед повтором. '+error.message):error);}
  finally{state.pending=false;if(unlock)unlock();const status=form.querySelector('[data-fa-status]');if(status)status.textContent='';const button=form.querySelector('[data-fa-save]');if(button)button.disabled=!state.reviewed||!form.elements.confirm.checked;}
}
function fuelAccountingOpen(section,id){
  try{
    const asset=fuelAccountingAsset(section,id);if(!fuelAccountingWritable(section))throw Error('Начало учёта доступно для вашей роли только для просмотра');
    if(typeof AccountingBoundary==='undefined'||AccountingBoundary.apiVersion!==1)throw Error('Модуль начала учёта не загружен. Откройте программу заново.');
    const original=JSON.parse(JSON.stringify(asset)),existing=original.fuelAccounting&&typeof original.fuelAccounting==='object'?original.fuelAccounting:null;
    const state={section,id,original,originalText:JSON.stringify(asset),databaseRef:data,context:wfCommandContextStamp(),reviewed:null,pending:false,operationId:null,operationText:null};
    const initial=existing||{},legacy=section==='tanks'?asset.balanceInit:asset.fuelBalance;
    if(document.getElementById('genericModal'))closeModal('genericModal');
    wfShowDialog('Начало учёта ГСМ · '+fuelAccountingLabel(section,asset),'<form id="fuelAccountingForm" class="wf-form"><p class="wf-wide">'+htmlEsc(existing?'У карточки задана отдельная точка начала топливного учёта. Изменение влияет на расчёт остатков и актов.':'Дата начала ещё не задана. Действует прежний расчёт по всей истории. Укажите подтверждённую точку отсчёта, чтобы включить новый режим.')+'</p><p class="wf-wide">Исходное поле карточки: '+htmlEsc(legacy==null?'не указано':String(legacy)+' л')+'. Начало учёта хранится отдельно.</p><label><span>Дата начала *</span><input name="from" type="date" required value="'+htmlEsc(typeof initial.from==='string'?initial.from:'')+'"></label><label><span>Входящий остаток, л *</span><input name="opening" inputmode="decimal" required value="'+htmlEsc(typeof initial.opening==='number'?String(initial.opening):'')+'" placeholder="Например: 923,537"></label><label class="wf-wide"><span>Основание / документ замера *</span><textarea name="basis" required maxlength="4000" rows="3" placeholder="Дата замера, номер документа, ссылка или пояснение">'+htmlEsc(typeof initial.basis==='string'?initial.basis:'')+'</textarea></label><div class="wf-wide"><button type="button" class="btn btn-ghost btn-sm" data-fa-measure>Взять последний замер перед датой</button></div><label class="wf-wide"><span><input name="allocate" type="checkbox" '+(Array.isArray(initial.sources)?'checked':'')+'> Распределить входящий остаток по организациям и топливу</span></label><div class="wf-wide" data-fa-sources '+(!Array.isArray(initial.sources)?'hidden':'')+'><div data-fa-source-rows></div><button type="button" class="btn btn-ghost btn-sm" data-fa-add-source>Добавить источник</button></div><section class="wf-wide wf-note" data-fa-preview hidden></section><label class="wf-wide" data-fa-confirmation hidden><span><input name="confirm" type="checkbox"> Подтверждаю дату, входящий остаток и основание после проверки предпросмотра</span></label><div class="wf-wide wf-error" role="alert" data-fa-error></div><p class="wf-wide" role="status" data-fa-status></p><div class="wf-wide wf-actions"><button type="button" class="btn btn-ghost" data-fa-cancel>Отмена</button><button type="button" class="btn btn-ghost" data-fa-review>Предпросмотр</button><button type="submit" class="btn btn-primary" data-fa-save disabled>Подтвердить начало учёта</button></div></form>');
    const form=state.form=document.getElementById('fuelAccountingForm'),sourceRows=form.querySelector('[data-fa-source-rows]');
    state.invalidate=()=>{state.reviewed=null;form.elements.confirm.checked=false;form.querySelector('[data-fa-preview]').hidden=true;form.querySelector('[data-fa-confirmation]').hidden=true;form.querySelector('[data-fa-save]').disabled=true;};
    const addSource=source=>{const row=fuelAccountingSourceRow(source,fuelAccountingGrade(asset));row.querySelector('button').onclick=()=>{if(state.pending)return;row.remove();state.invalidate();};sourceRows.append(row);};
    if(Array.isArray(initial.sources))initial.sources.forEach(source=>{if(source&&typeof source==='object')addSource(source);});
    form.querySelector('[data-fa-cancel]').onclick=()=>closeModal('wfModal');
    for(const event of ['input','change'])form.addEventListener(event,event=>{if(event.target===form.elements.confirm){form.querySelector('[data-fa-save]').disabled=!state.reviewed||!form.elements.confirm.checked;return;}state.invalidate();});
    form.elements.allocate.addEventListener('change',()=>{form.querySelector('[data-fa-sources]').hidden=!form.elements.allocate.checked;if(form.elements.allocate.checked&&!sourceRows.children.length)addSource({org:asset.org||'',grade:fuelAccountingGrade(asset),qty:''});});
    form.querySelector('[data-fa-add-source]').onclick=()=>{if(state.pending)return;addSource({org:'',qty:''});state.invalidate();};
    form.querySelector('[data-fa-review]').onclick=()=>{try{form.querySelector('[data-fa-error]').textContent='';fuelAccountingPreview(state);}catch(error){wfShowCommandError(form.querySelector('[data-fa-error]'),error);}};
    form.querySelector('[data-fa-measure]').onclick=()=>{try{form.querySelector('[data-fa-error]').textContent='';fuelAccountingCopyMeasure(state);}catch(error){wfShowCommandError(form.querySelector('[data-fa-error]'),error);}};
    form.onsubmit=event=>{event.preventDefault();void fuelAccountingCommit(state);};
    try{AccountingBoundary.resolve(section,original);}catch(error){form.querySelector('[data-fa-error]').textContent='В сохранённом начале учёта есть ошибка. Проверьте и исправьте параметры: '+error.message;}
  }catch(error){showToast(error.message);}
}
