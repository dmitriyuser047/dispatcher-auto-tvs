// Формы и доска диспетчера, общий поиск и сохраняемые представления.
const WF_FIELDS={
 dispatchJobs:[['title','Заявка','text',1],['status','Состояние','status:new,assigned,started,done,confirmed,cancelled',1],['site','Объект','text',1],['org','Организация'],['customer','Заказчик'],['start','Начало','datetime-local',1],['end','Конец','datetime-local',1],['assetRef','Техника','asset'],['driverId','Сотрудник','driver'],['requirements','Допуски через запятую'],['points','Маршрут / точки','textarea'],['plannedKm','План, км','number'],['actualKm','Факт, км','number'],['plannedHours','План, часы','number'],['actualHours','Факт, часы','number'],['actualStart','Фактическое начало','datetime-local'],['actualEnd','Фактическое окончание','datetime-local'],['cost','Затраты, ₽','number'],['result','Результат','textarea'],['confirmedBy','Принял']],
 opsTasks:[['title','Задача','text',1],['status','Состояние','status:open,started,snoozed,closed',1],['owner','Ответственный','text',1],['due','Срок','date',1],['site','Объект'],['org','Организация'],['assetRef','Техника','asset'],['description','Причина и действия','textarea'],['result','Результат / доказательство','textarea']],
 drivers:[['name','ФИО','text',1],['phone','Телефон'],['skills','Допуски / категории'],['org','Организация'],['site','Объект'],['note','Примечание','textarea']],
 assetAssignments:[['assetRef','Техника','asset',1],['driverId','Сотрудник','driver'],['from','С даты','date',1],['to','По дату включительно','date'],['site','Объект','text',1],['org','Организация'],['status','Состояние техники'],['reason','Основание','textarea',1]],
 workOrders:[['title','Дефект / заказ','text',1],['assetRef','Техника','asset',1],['status','Состояние','status:new,approved,repairing,accepted,cancelled',1],['owner','Ответственный','text',1],['site','Объект'],['org','Организация'],['downtimeFrom','Начало простоя','datetime-local'],['downtimeTo','Конец простоя','datetime-local'],['description','Неисправность','textarea',1],['work','Работы и детали','textarea'],['cost','Согласованная стоимость, ₽','number'],['actualCost','Фактические затраты, ₽','number'],['warrantyUntil','Гарантия до','date'],['repeatOf','ID предыдущего заказа'],['result','Результат','textarea'],['acceptedBy','Принял']],
 assetDocuments:[['title','Документ','text',1],['assetRef','Техника','asset'],['driverId','Сотрудник','driver'],['number','Номер'],['date','Выдан','date'],['expires','Действует до','date'],['mandatory','Обязателен для назначения','checkbox'],['note','Примечание','textarea']],
 fuelMovements:[['date','Дата','date',1],['kind','Операция','choice:receipt=Приход,issue=Выдача,transfer=Перемещение,return=Внешний возврат,adjustment=Корректировка',1],['fromTankId','Из ёмкости','tank'],['toTankId','В ёмкость','tank'],['qty','Литры','number',1],['assetRef','Получатель / техника','asset'],['reason','Документ / основание','textarea',1],['legacyOverlapConfirmed','Проверено: это отдельная выдача сверх уже внесённой в журнал ДЭС','checkbox']],
 parts:[['name','Наименование','text',1],['kind','Вид','choice:part=Запчасть,tire=Шина',1],['article','Артикул'],['serial','Серийный номер'],['unit','Единица','text',1],['minStock','Минимальный запас','number'],['site','Склад / объект'],['note','Примечание','textarea']],
 partMovements:[['date','Дата','date',1],['partId','Номенклатура','part',1],['kind','Операция','choice:receipt=Приход,issue=Установка / выдача,return=Возврат,writeoff=Списание',1],['qty','Количество','number',1],['assetRef','Техника','asset'],['workOrderId','ID ремонтного заказа'],['meter','Пробег / часы на установке','number'],['reason','Основание','textarea',1]],
 shiftReports:[['title','Смена / задание','text',1],['date','Дата','date',1],['assetRef','Техника','asset',1],['driverId','Сотрудник','driver',1],['jobId','ID заявки'],['status','Состояние','status:prepared,sent,accepted,rejected',1],['odoStart','Одометр начала','number'],['odoEnd','Одометр конца','number'],['hours','Наработка, ч','number'],['fuelIssued','Получено, л','number'],['tankMeasured','Замер остатка, л','number'],['defect','Дефект','textarea'],['result','Работа и результат','textarea'],['acceptedBy','Принял'],['rejectionReason','Причина отклонения','textarea']],
 connectors:[['title','Название','text',1],['provider','Система / поставщик','text',1],['kind','Режим','status:file,api',1],['format','Формат','choice:shiftReports=Сменные формы,dispatchJobs=Заявки,assetDocuments=Документы,drivers=Сотрудники',1],['endpoint','HTTPS адрес API'],['owner','Ответственный'],['note','Правила обмена / настройка','textarea']]
};
function wfOptions(type,context={},section){if(type==='asset')return wfAssets().filter(a=>!a.row.archived).map(a=>[a.ref,a.label]);if(type==='driver'){if(typeof _sync!=='undefined'&&_sync.access&&!(_sync.access.readable||[]).includes('drivers'))return [];const assignment=['assetAssignments','dispatchJobs','shiftReports'].includes(section);return(data.drivers||[]).filter(r=>!r.archived&&!r.deleted&&(!assignment||wfPersonnelAvailable(r)&&wfPersonnelMatches(r,wfPersonnelKind(context.assetRef)))).map(r=>[r.id,r.name]);}if(type==='tank')return(data.tanks||[]).filter(r=>!r.archived).map(r=>[r.id,r.name]);if(type==='part')return(data.parts||[]).filter(r=>!r.archived).map(r=>[r.id,r.name]);if(type.startsWith('status:'))return type.slice(7).split(',').map(k=>[k,WF_STATUS[k]||k]);if(type.startsWith('choice:'))return type.slice(7).split(',').map(k=>k.split('='));return null;}
function wfAssignmentReplacementField(){return '<label class="wf-wide"><span>Заменить прежнее назначение</span><select name="replacesAssignmentId" data-assignment-replacement><option value="">Не заменять</option></select><small>Выбранное назначение завершится днём перед новой датой начала. Оба изменения сохранятся вместе.</small></label>';}
function wfRefreshAssignmentReplacements(form,assetRef,from,to,excludeId){
 const select=form.querySelector('[data-assignment-replacement]');if(!select)return;
 const chosen=select.value,rows=(data.assetAssignments||[]).filter(row=>row.id!==excludeId&&!row.archived&&!row.deleted&&row.assetRef===assetRef&&row.from<=(to||'9999-12-31')&&(!row.to||row.to>=from));
 select._wfReplacementRows=new Map(rows.map(row=>[JSON.stringify(row.id),JSON.stringify(row)]));
 select.replaceChildren(new Option('Не заменять',''),...rows.map(row=>new Option(((data.drivers||[]).find(person=>person.id===row.driverId)?.name||'Сотрудник')+' · '+row.from+' — '+(row.to||'без окончания'),JSON.stringify(row.id),false,JSON.stringify(row.id)===chosen)));
}
function wfSelectedAssignmentReplacement(form){
 const select=form.querySelector('[data-assignment-replacement]');if(!select?.value)return undefined;
 const id=JSON.parse(select.value),current=(data.assetAssignments||[]).find(row=>row.id===id);
 if(JSON.stringify(current)!==select._wfReplacementRows?.get(select.value))throw Error('Прежнее назначение изменилось. Откройте форму заново; введённые значения остаются в полях.');return id;
}
function wfTypedOption(type,id){return ['driver','tank','part'].includes(type)?' data-typed-id="'+htmlEsc(JSON.stringify(id))+'"':'';}
function wfSelectedReference(select,section,label){
 const option=select.selectedOptions[0];if(!option||option.value==='')return '';
 return option.dataset.typedId===undefined?wfCommandReference(section,option.value,label,true):wfCommandReference(section,JSON.parse(option.dataset.typedId),label);
}
function wfEdit(section,id,preset){
 if(typeof DocumentEngine!=='undefined'&&DocumentEngine.sections.includes(section)){
  const original=(data[section]||[]).find(row=>row.id===id);
  if(original&&['posted','void'].includes(DocumentEngine.state(section,original)))return lifecycleOpen(section,id);
  if(!original&&['fuelMovements','partMovements','fuelWriteoffs','payments','repairs','vehicleTo','toRecords'].includes(section))return newDocument(section,preset||{});
 }
 if(section==='drivers'){if(id!=null&&typeof personnelOpenPerson==='function')personnelOpenPerson(id);else switchSection('drivers');return;}
 if(typeof _sync!=='undefined'&&_sync.access&&!_sync.access.writable.includes(section)){showToast('Для вашей сетевой роли этот раздел доступен для просмотра');return;}
 if(section==='auditLog')return;wfInitData(data);const existing=data[section].find(x=>x.id===id);const row=JSON.parse(JSON.stringify(existing||preset||{id:wfId(section),date:wfToday(),from:wfToday(),unit:'шт',status:section==='opsTasks'?'open':section==='shiftReports'?'prepared':'new'}));
 const fields=WF_FIELDS[section]||[],commandState=wfCommandState(section,row.id,existing);
 wfShowDialog((existing?'Изменить · ':'Добавить · ')+WF_TABS[section],`<form id="wfForm" class="wf-form">${fields.map(([key,label,type='text',required])=>{
 const value=row[key]??'',options=wfOptions(type,row,section);const attr=`id="wf_${key}" name="${key}" ${required?'required':''}`;
 let input;if(options){if(value!==''&&!options.some(o=>o[0]===value)&&(type!=='driver'||existing?.driverId===value)){const person=type==='driver'?(data.drivers||[]).find(r=>r.id===value):null;options.push([value,(person?.name||value)+' · ранее выбран']);}input=`<select ${attr}><option value="">—</option>${options.map(([v,l])=>`<option value="${htmlEsc(v)}"${wfTypedOption(type,v)} ${v===value?'selected':''}>${htmlEsc(l)}</option>`).join('')}</select>`;}else if(type==='textarea')input=`<textarea ${attr} rows="3">${htmlEsc(value)}</textarea>`;else input=`<input ${attr} type="${type}" ${type==='checkbox'?(value?'checked':''):`value="${htmlEsc(value)}"`} ${type==='number'?'step="any" min="0"':''}>`;
 return `<label class="${type==='textarea'?'wf-wide':''}"><span>${htmlEsc(type==='driver'&&section!=='assetDocuments'?wfPersonnelFieldLabel(row.assetRef):label)}${required?' *':''}</span>${input}</label>`;}).join('')}${section==='assetAssignments'?wfAssignmentReplacementField():''}<div id="wfError" role="alert" class="wf-error wf-wide"></div><div class="wf-wide wf-actions"><button class="btn btn-ghost" type="button" onclick="closeModal('wfModal')">Отмена</button><button class="btn btn-primary" type="submit">Сохранить</button></div></form>`);
 const form=document.getElementById('wfForm');commandState.form=form;let pending=false;
 const refreshPersonnel=()=>{const select=document.getElementById('wf_driverId');if(!select)return;const current={...row};for(const key of ['assetRef','date','from','to','start','end']){const input=document.getElementById('wf_'+key);if(input)current[key]=input.value;}let value='';try{value=wfSelectedReference(select,'drivers','Сотрудник');}catch{}current.driverId=value;const options=wfOptions('driver',current,section),selected=(data.drivers||[]).find(r=>r.id===value);if(selected&&wfPersonnelReferenceUnchanged({...current,driverId:selected.id},existing)&&!options.some(([id])=>id===selected.id))options.push([selected.id,selected.name+' · ранее выбран']);select.replaceChildren(new Option('—',''),...options.map(([id,name])=>{const option=new Option(name,String(id),false,id===value);option.dataset.typedId=JSON.stringify(id);return option;}));const span=select.closest('label')?.querySelector('span'),field=fields.find(([key])=>key==='driverId');if(span)span.textContent=(section==='assetDocuments'?'Сотрудник':wfPersonnelFieldLabel(current.assetRef))+(field?.[3]?' *':'');};
 const refreshReplacement=()=>wfRefreshAssignmentReplacements(form,form.elements.assetRef?.value,form.elements.from?.value,form.elements.to?.value,existing?.id);
 for(const key of ['assetRef','date','from','to','start','end'])document.getElementById('wf_'+key)?.addEventListener('change',()=>{refreshPersonnel();refreshReplacement();});refreshReplacement();
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(pending)return;pending=true;const unlock=wfLockCommandForm(form),errorNode=form.querySelector('#wfError');errorNode.textContent='';
  try{
   fields.forEach(([key,,type='text'])=>{const el=form.elements[key];row[key]=type==='checkbox'?el.checked:type==='number'?precisionInput(el,{scale:/cost/i.test(key)?2:3,blank:'null',...(existing?{previous:existing[key]}:{})}):['driver','tank','part'].includes(type)?wfSelectedReference(el,{driver:'drivers',tank:'tanks',part:'parts'}[type],key):el.value.trim();if(type==='number'&&row[key]!=null&&(!Number.isFinite(row[key])||row[key]<0))throw Error('Введите неотрицательное число');});
   await wfSave(section,row,commandState,{replacesAssignmentId:wfSelectedAssignmentReplacement(form)});
  }catch(err){wfShowCommandError(errorNode,err);}finally{pending=false;unlock();}
 });
}
function wfLabel(section,row){return row.title||row.name||(section==='assetAssignments'?wfAsset(row.assetRef)?.label:section==='fuelMovements'?`${row.kind} · ${row.qty} л`:section==='partMovements'?data.parts.find(p=>p.id===row.partId)?.name:'')||row.id;}
function wfMatches(row){return(wfShowArchive||!row.archived)&&(!wfQuery||JSON.stringify(row).toLowerCase().includes(wfQuery.toLowerCase()))&&(!wfSite||row.site===wfSite)&&(!wfOrg||row.org===wfOrg);}
function wfCurrentRows(section){return typeof DocumentEngine!=='undefined'&&DocumentEngine.sections.includes(section)?DocumentEngine.activeRows(data,section):data[section]||[];}
function wfRowHtml(section,row){
 const label=wfLabel(section,row),asset=wfAsset(row.assetRef),driver=data.drivers.find(d=>d.id===row.driverId);const due=row.due||row.expires;
 const status=section==='fuelMovements'&&row.reversedBy?'Сторнировано':section==='fuelMovements'&&row.originalMovementId?'Сторно':WF_STATUS[row.status]||row.kind||'';const expired=due&&due<wfToday()&&!['closed','accepted','confirmed','cancelled'].includes(row.status);
 let info=[asset?.label,driver?.name,row.site,row.org,row.start?.replace('T',' '),row.end?'→ '+row.end.replace('T',' '):'',row.date,row.from?`${row.from} — ${row.to||'далее'}`:'',due?'Срок: '+due:''].filter(Boolean);
 if(section==='parts')info.push('На складе: '+wfPartStock(row.id)+' '+row.unit);
 if(section==='fuelMovements')info.push(`${data.tanks.find(t=>t.id===row.fromTankId)?.name||'Внешний источник'} → ${data.tanks.find(t=>t.id===row.toTankId)?.name||asset?.label||'Выдача'}`,row.reason);
 if(section==='fuelMovements'&&row.reversedBy)info.push('Проведение отменено. Оригинал сохранён в истории. Сторно: '+row.reversedBy);
 if(section==='fuelMovements'&&row.originalMovementId)info.push('Отмена движения '+row.originalMovementId);
 if(section==='partMovements')info.push(row.qty+' ед.',row.reason);
 const immutable=['fuelMovements','partMovements'].includes(section);return `<article class="wf-card ${expired?'wf-overdue':''}"><div class="wf-card-top"><strong>${htmlEsc(label)}</strong><span class="ops-tag ${expired?'red':'blue'}">${htmlEsc(row.archived?'Архив':status)}</span></div><p>${htmlEsc(info.join(' · '))}</p>${row.description?`<p>${htmlEsc(row.description)}</p>`:''}<div class="wf-actions">${typeof DocumentEngine!=='undefined'&&DocumentEngine.sections.includes(section)?`<button class="btn btn-ghost btn-sm" onclick="lifecycleOpen(${htmlJs(section)},${htmlJs(row.id)})">Версии / действия</button>`:''}${!immutable?`<button class="btn btn-ghost btn-sm" onclick="wfEdit(${htmlJs(section)},${htmlJs(row.id)})">Открыть</button>`:''}${row.assetRef?`<button class="btn btn-ghost btn-sm" onclick="wfTimeline(${htmlJs(row.assetRef)})">История техники</button>`:''}${section==='assetDocuments'||section==='workOrders'||section==='shiftReports'||section==='dispatchJobs'?`<button class="btn btn-ghost btn-sm" onclick="wfAttachments(${htmlJs(section)},${htmlJs(row.id)})">Файлы (${(row.attachments||[]).length})</button>`:''}${!immutable?`<button class="btn btn-ghost btn-sm" onclick="wfArchive(${htmlJs(section)},${htmlJs(row.id)})">${row.archived?'Восстановить':'В архив'}</button>`:''}</div><small class="wf-id">${htmlEsc(row.id)}</small></article>`;
}
function renderWorkflows(){try{return wfRenderCurrentWorkspace();}catch(error){const host=document.getElementById('mainContent');if(host)host.innerHTML='<div class="wf-note" role="alert"><h3>Документы недоступны</h3><p>'+htmlEsc(error.message)+'</p><p>Проверьте историю документа и диагностику базы. Неполные итоги не показаны.</p></div>';}}
function wfRenderCurrentWorkspace(){
 if(activeSection!=='dispatch'&&activeSection!=='workflows')return;
 if(wfTab==='drivers'||wfTab==='operators'){switchSection(wfTab);return;}
 const tabs=wfVisibleTabs();if(!Object.hasOwn(tabs,wfTab))wfTab=activeSection==='dispatch'?'overview':'opsTasks';
 if(wfTab==='overview'){renderDispatchOverview();return;}
 if(wfTab==='dispatchJobs'&&typeof dxRenderJobs==='function'){dxRenderJobs();return;}
 const isDispatch=activeSection==='dispatch';const savedViews=(data.savedViews||[]).filter(v=>wfSectionForTab(v.tab)===(isDispatch?'dispatch':'workflows'));
 wfInitData(data);const rows=wfCurrentRows(wfTab).filter(wfMatches).slice().reverse();const sites=[...new Set(Object.keys(tabs).flatMap(k=>(data[k]||[]).map(r=>r.site)).filter(Boolean))].sort();const orgs=[...new Set(Object.keys(tabs).flatMap(k=>(data[k]||[]).map(r=>r.org)).filter(Boolean))].sort();
 const select=(id,label,list,value)=>`<select id="${id}" aria-label="${label}"><option value="">${label}</option>${list.map(s=>`<option ${s===value?'selected':''}>${htmlEsc(s)}</option>`).join('')}</select>`;
 document.getElementById('mainContent').innerHTML=`<div class="wf-workspace"><header class="wf-heading"><div><h2>${isDispatch?'Диспетчерская':'Рабочие процессы'}</h2><p>${isDispatch?'Заявки, техника, сотрудники и выполнение работ.':'Задачи, ремонт, документы, склад и обмен.'}</p></div>${isDispatch?'':`<div class="wf-actions"><button class="btn btn-ghost" onclick="wfBackup()">Резервный пакет</button><button class="btn btn-ghost" onclick="wfRestoreBackup()">Проверить восстановление</button></div>`}</header>${wfTabsHtml(tabs)}<div class="wf-toolbar"><input id="wfSearch" type="search" placeholder="Поиск" value="${htmlEsc(wfQuery)}">${select('wfSite','Все объекты',sites,wfSite)}${select('wfOrg','Все организации',orgs,wfOrg)}<label><input id="wfArchived" type="checkbox" ${wfShowArchive?'checked':''}> Архив</label><button class="btn btn-ghost btn-sm" onclick="wfSaveView()">Сохранить вид</button><select id="wfSaved" aria-label="Сохранённый вид"><option value="">Сохранённые виды</option>${savedViews.map(v=>`<option value="${htmlEsc(v.id)}">${htmlEsc(v.name)}</option>`).join('')}</select></div><div class="wf-heading"><h3>${WF_TABS[wfTab]} · ${rows.length}</h3><div class="wf-actions">${wfTab!=='auditLog'?`<button class="btn btn-primary" onclick="wfEdit(${htmlJs(wfTab)})">Добавить</button>`:''}${['parts','partMovements'].includes(wfTab)?'<button class="btn btn-ghost" onclick="periodControlOpen(\'stock\')">Периоды склада</button>':''}<button class="btn btn-ghost" onclick="documentDraftsOpen(wfTab)">Черновики</button><button class="btn btn-ghost" onclick="wfExport()">Экспорт JSON</button>${wfTab==='connectors'?'<button class="btn btn-ghost" onclick="wfImportExchange()">Загрузить пакет</button>':''}${wfTab==='fuelMovements'?'<button class="btn btn-ghost" onclick="wfInventory()">Замер / инвентаризация</button>':''}</div></div>${wfTab==='connectors'?'<p class="wf-note">Файловый обмен проверяет пакет до записи. API хранит параметры подключения; активация потребует документации поставщика и учётных данных.</p>':''}${wfTab==='shiftReports'?'<p class="wf-note">Форма хранится в базе приложения. Для передачи между устройствами выгрузите пакет и загрузите его на рабочем месте диспетчера. Приёмка не создаёт повторную запись журнала автоматически.</p>':''}${wfTab==='fuelMovements'?wfTankSummary():''}${wfTab==='auditLog'?`<div class="wf-timeline">${rows.slice(0,300).map(r=>`<article><strong>${htmlEsc(wfAuditLabel(r))}</strong><details><summary>Изменённые поля</summary><pre>${htmlEsc(JSON.stringify({before:r.before,after:r.after},null,2))}</pre></details></article>`).join('')||'Нет событий'}</div>`:wfTab==='dispatchJobs'?`<div class="wf-board">${['new','assigned','started','done','confirmed','cancelled'].map(status=>`<section><h4>${WF_STATUS[status]} · ${rows.filter(r=>r.status===status).length}</h4>${rows.filter(r=>r.status===status).map(r=>wfRowHtml(wfTab,r)).join('')}</section>`).join('')}</div>`:`<div class="wf-grid">${rows.map(r=>wfRowHtml(wfTab,r)).join('')||'<p class="wf-note">Записей пока нет. Добавьте первую запись.</p>'}</div>`}</div>`;
 wfRenderHistoryActions(rows);
 const bind=(id,fn)=>document.getElementById(id).addEventListener('change',fn);document.getElementById('wfSearch').addEventListener('input',e=>{wfQuery=e.target.value;const focus=e.target.selectionStart;renderWorkflows();const input=document.getElementById('wfSearch');input.focus();input.setSelectionRange(focus,focus);});bind('wfSite',e=>{wfSite=e.target.value;renderWorkflows();});bind('wfOrg',e=>{wfOrg=e.target.value;renderWorkflows();});bind('wfArchived',e=>{wfShowArchive=e.target.checked;renderWorkflows();});bind('wfSaved',e=>{const v=data.savedViews.find(v=>v.id===e.target.value);if(v)wfOpenTab(v.tab,{query:v.query||'',site:v.site||'',org:v.org||'',archive:!!v.archive});});
}
function wfRenderHistoryActions(rows){
 if(typeof personnelOpenPerson==='function'&&(typeof _sync==='undefined'||!_sync.access||(_sync.access.readable||[]).includes('drivers'))){
  document.querySelectorAll('#mainContent .wf-card .wf-id').forEach(idNode=>{const row=rows[Array.from(document.querySelectorAll('#mainContent .wf-card .wf-id')).indexOf(idNode)];if(!row||row.driverId==null||row.driverId===''||!(data.drivers||[]).some(person=>person.id===row.driverId))return;const button=document.createElement('button');button.type='button';button.className='btn btn-ghost btn-sm';button.textContent='Карточка сотрудника';button.addEventListener('click',()=>personnelOpenPerson(row.driverId));idNode.closest('.wf-card')?.querySelector('.wf-actions')?.appendChild(button);});
 }
 if(wfTab==='auditLog'){
  document.querySelectorAll('#mainContent .wf-timeline > article').forEach((article,index)=>{
   const event=rows[index];if(!wfCanRestoreDeleted(event))return;
   const button=document.createElement('button');button.className='btn btn-ghost btn-sm';button.textContent='Восстановить запись';button.onclick=()=>wfRestoreDeleted(event.id);article.appendChild(button);
  });
 }
 if(wfTab==='fuelMovements'){
  const note=document.createElement('p');note.className='wf-note';note.textContent='Неверное проведение можно сторнировать с причиной в открытом исходном месяце. Движение и его исходные данные останутся в истории. Сторно исправляет учёт; возврат топлива из бака техники — отдельная операция, которая пока не поддерживается.';
  document.querySelector('#mainContent .wf-workspace')?.appendChild(note);
  document.querySelectorAll('#mainContent .wf-card .wf-id').forEach(idNode=>{
   const row=rows.find(r=>r.id===idNode.textContent);
   if(!row||row.reversedBy||row.originalMovementId||row.cancelled||row.deleted)return;
   const button=document.createElement('button');button.className='btn btn-ghost btn-sm';button.textContent='Сторнировать';button.onclick=()=>wfReverseMovementDialog(row.id);idNode.closest('.wf-card').querySelector('.wf-actions').appendChild(button);
  });
 }
}
function wfReverseMovementDialog(id){
 try{
  const {original}=wfReversalCheck(id),preview=_lastPersisted;
  wfShowDialog('Сторно движения топлива',`<p>Будет отменено проведение ${htmlEsc(original.qty)} л за ${htmlEsc(original.date)}. Оригинал останется в истории. Связанный приход в журнале станет нулевым с сохранением исходного количества.</p><form id="wfReverseForm" class="wf-form"><label class="wf-wide">Причина сторно<textarea id="wfReverseReason" required rows="3"></textarea></label><div id="wfReverseError" role="alert" class="wf-error wf-wide"></div><div class="wf-wide wf-actions"><button class="btn btn-ghost" type="button" onclick="closeModal('wfModal')">Отмена</button><button class="btn btn-primary" type="submit">Сторнировать</button></div></form>`);
  document.getElementById('wfReverseForm').onsubmit=async event=>{
   event.preventDefault();const button=event.submitter||document.querySelector('#wfReverseForm [type="submit"]');if(button)button.disabled=true;
   try{if(_lastPersisted!==preview)throw Error('База изменилась. Откройте сторно повторно для новой проверки.');await wfReverseFuelMovement(id,document.getElementById('wfReverseReason').value);}
   catch(error){const host=document.getElementById('wfReverseError');if(host)host.textContent=error.message;}
   finally{if(button)button.disabled=false;}
  };
 }catch(error){showToast(error.message);}
}
async function wfSaveView(){const input=document.createElement('input');wfShowDialog('Сохранить представление','<form id="wfViewForm" class="wf-form"><label>Название<input id="wfViewName" required maxlength="80"></label><button class="btn btn-primary">Сохранить</button></form>');document.getElementById('wfViewForm').onsubmit=async e=>{e.preventDefault();data.savedViews.push({id:wfId('view'),name:document.getElementById('wfViewName').value.trim(),tab:wfTab,section:wfSectionForTab(wfTab),query:wfQuery,site:wfSite,org:wfOrg,archive:wfShowArchive});if(await saveData(data)){closeModal('wfModal');renderWorkflows();}};}
function wfTankSummary(){return `<div class="wf-grid">${data.tanks.filter(t=>!t.archived).map(t=>{const bal=wfTankBalanceAt(t.id),from=new Date(Date.now()-29*86400000).toISOString().slice(0,10);const issued=(data.genRecords||[]).filter(r=>genRecordTankId(r)===t.id&&r.date>=from&&r.date<=wfToday()).reduce((s,r)=>s+(+r.fuelIssued||0),0)+(data.fuelMovements||[]).filter(r=>!r.reversedBy&&!r.deleted&&!r.cancelled&&r.fromTankId===t.id&&r.date>=from&&r.date<=wfToday()&&r.kind==='issue').reduce((s,r)=>s+(Number(r.qty)||0),0);const avg=issued/30,reserve=typeof tankReserveLevel==='function'?tankReserveLevel(t):Number(t.reserveLevel)||0;return `<article class="wf-card"><strong>${htmlEsc(t.name)} · ${bal.toLocaleString('ru')} л</strong><p>${avg>0?`До ${reserve>0?'резерва':'исчерпания'} около ${Math.max(0,Math.floor((bal-reserve)/avg))} дн. при выдаче ${avg.toFixed(1)} л/сут за последние 30 календарных дней`:'За последние 30 дней выдач нет; прогноз недоступен'}</p></article>`;}).join('')}</div>`;}
function wfInventory(){wfShowDialog('Замер остатка','<form id="wfInventoryForm" class="wf-form"><label>Ёмкость<select id="wfInvTank" required>'+wfOptions('tank').map(([id,n])=>`<option value="${htmlEsc(id)}">${htmlEsc(n)}</option>`).join('')+'</select></label><label>Дата<input id="wfInvDate" type="date" required value="'+wfToday()+'"></label><label>Измерено, л<input id="wfInvQty" type="number" min="0" step="any" required></label><label>Акт / основание<input id="wfInvReason" required></label><div id="wfInvError" role="alert" class="wf-error"></div><button class="btn btn-primary">Сохранить корректировку</button></form>');document.getElementById('wfInventoryForm').onsubmit=async e=>{e.preventDefault();try{const id=wfCommandReference('tanks',document.getElementById('wfInvTank').value,'Ёмкость',true),date=document.getElementById('wfInvDate').value,measured=precisionInput('wfInvQty',{scale:3,blank:'error'}),before=wfTankBalanceAt(id,date),diff=precisionRound(DecimalCore.sub(measured,before),3);if(!diff){showToast('Замер совпадает с расчётом');return;}await wfSave('fuelMovements',{id:wfId('inventory'),date,kind:'adjustment',fromTankId:diff<0?id:'',toTankId:diff>0?id:'',qty:Math.abs(diff),measured,balanceBefore:before,reason:document.getElementById('wfInvReason').value});}catch(err){document.getElementById('wfInvError').textContent=err.message;}};}
async function wfExport(){const payload={format:'tvs-exchange',version:1,section:wfTab,exportedAt:new Date().toISOString(),rows:(data[wfTab]||[]).filter(wfMatches)};if(window.electronAPI?.exportJson)await window.electronAPI.exportJson(JSON.stringify(payload,null,2),'ТВС-'+wfTab+'-'+wfToday()+'.json');}
async function wfImportExchange(){
 try{
  const raw=await window.electronAPI?.importJsonFile?.();
  if(!raw||raw.canceled||raw.cancelled)return;
  if(typeof raw==='object'&&raw.ok===false)throw Error(raw.error||'Файл не прочитан');
  const text=typeof raw==='string'?raw:raw.content||raw.json||raw.data||'';
  if(typeof text!=='string'||text.length>32*1024*1024)throw Error('Недопустимый размер файла обмена');
  const p=JSON.parse(text);
  if(p.format!=='tvs-exchange'||p.version!==1||!['shiftReports','dispatchJobs','assetDocuments','drivers'].includes(p.section)||!Array.isArray(p.rows))throw Error('Неверный формат обмена');
  if(p.rows.length>10000)throw Error('Пакет больше 10000 строк');
  wfInitData(data);
  const ids=new Set(),added=[],same=[],conflicts=[];
  const validateAdded=()=>{
   const original=data[p.section];data[p.section]=original.slice();
   try{for(const r of added){if(data[p.section].some(x=>x.id===r.id))throw Error('ID уже появился в базе: '+r.id);wfValidate(p.section,r,null);data[p.section].push(r);}}
   finally{data[p.section]=original;}
  };
  for(const r of p.rows){
   if(!r||typeof r.id!=='string'||!r.id)throw Error('У строки отсутствует ID');
   if(ids.has(r.id))throw Error('В пакете повторяется ID: '+r.id);ids.add(r.id);
   const old=data[p.section].find(x=>x.id===r.id);
   if(old)(JSON.stringify(old)===JSON.stringify(r)?same:conflicts).push(r);else added.push(r);
  }
  validateAdded();
  const previewPersisted=_lastPersisted,previewSection=JSON.stringify(data[p.section]);
  wfShowDialog('Проверка пакета',`<p>Раздел: ${htmlEsc(WF_TABS[p.section])}. Новых: ${added.length}; совпадений: ${same.length}; конфликтов: ${conflicts.length}.</p><p>Совпадающие и конфликтующие ID будут пропущены. Конфликт требует сверки с исходным устройством.</p><div class="wf-timeline">${added.slice(0,100).map(r=>`<p>${htmlEsc(wfLabel(p.section,r))}</p>`).join('')}</div><div id="wfPackageError" role="alert" class="wf-error"></div>`,`<button class="btn btn-primary" id="wfApplyPackage" ${added.length?'':'disabled'}>Записать ${added.length} новых</button>`);
  document.getElementById('wfApplyPackage').onclick=async event=>{
   const button=event.currentTarget;button.disabled=true;
   try{
    if(_lastPersisted!==previewPersisted||JSON.stringify(data[p.section])!==previewSection)throw Error('База изменилась после просмотра. Загрузите пакет повторно для новой проверки.');
    validateAdded();data[p.section].push(...added);
    if(await saveData(data,{noMerge:true})){closeModal('wfModal');wfOpenTab(p.section,{query:'',site:'',org:'',archive:false});}
    else throw Error('Пакет не записан. Повторите загрузку для новой проверки состояния базы.');
   }catch(error){const host=document.getElementById('wfPackageError');if(host)host.textContent=error.message;}
   finally{button.disabled=false;}
  };
 }catch(error){showToast('Обмен: '+error.message);}
}
async function wfAttachments(section,id){const row=data[section].find(r=>r.id===id);if(!row)return;wfShowDialog('Файлы · '+wfLabel(section,row),`<p class="wf-note">Документы открываются и добавляются на компьютере с основной базой. Между компьютерами передаются сведения о файле; для переноса содержимого используйте резервный пакет.</p><div>${(row.attachments||[]).map((a,i)=>`<p><button class="btn btn-ghost" data-file="${i}">${htmlEsc(a.name)} · ${Math.ceil(a.size/1024)} КБ</button><small> SHA256 ${htmlEsc(a.sha256)}</small></p>`).join('')||'<p>Нет файлов</p>'}</div>`,`<button class="btn btn-primary" id="wfAddFile">Добавить файл</button>`);document.querySelectorAll('#wfModal [data-file]').forEach(b=>b.onclick=async()=>{try{const result=await window.electronAPI?.openAttachment?.(row.attachments[+b.dataset.file].id);if(result?.error)showToast(result.error);}catch(error){showToast(error.message);}});document.getElementById('wfAddFile').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const r=await window.electronAPI?.addAttachment?.();if(r?.ok){const current=data[section].find(x=>x.id===id);if(!current)throw Error('Запись уже удалена');if(!(current.attachments||[]).some(a=>a.id===r.file.id))(current.attachments||(current.attachments=[])).push(r.file);if(await saveData(data))wfAttachments(section,id);}else if(r?.error)showToast(r.error);}catch(error){showToast(error.message);}finally{button.disabled=false;}};}
async function wfBackup(){const r=await window.electronAPI?.createBackupPackage?.();if(r?.ok)showToast('Резервный пакет: '+r.path);else if(r?.error)showToast(r.error);}
async function wfRestoreBackup(){const r=await window.electronAPI?.verifyBackupPackage?.();if(r?.ok)wfShowDialog('Пакет восстановлен в отдельную папку',`<p>${htmlEsc(r.path)}</p><p>Проверены SHA256 файлов и JSON разделов. Строк: ${r.rows}. Рабочая база не заменена.</p>`);else if(r?.error)showToast(r.error);}
