// Period documents use the same database, revisions and access checks as personnel documents.
let personnelTimesheetViews = new Map();
const ptEsc = value => htmlEsc(String(value ?? ''));
const ptClone = value => JSON.parse(JSON.stringify(value));
const ptSection = kind => kind === 'operator' ? 'operatorTimesheets' : 'driverTimesheets';
const ptLabel = kind => kind === 'operator' ? 'машинистов ДЭС' : 'водителей';
function ptStamp() { return platformPrepareAccessStamp(platformSessionContext()); }
function ptRead() { return personnelCanRead('assetDocuments'); }
function ptWrite() { return ptRead() && personnelCanWrite('assetDocuments'); }
function ptRosterWrite() { return ptWrite() && personnelCanRead('drivers') && personnelCanWrite('drivers'); }
function ptView(kind) {
  const stamp = ptStamp();
  if (personnelTimesheetViews.stamp !== stamp) { personnelTimesheetViews = new Map(); personnelTimesheetViews.stamp = stamp; }
  if (!personnelTimesheetViews.has(kind)) personnelTimesheetViews.set(kind,{kind,stamp,model:null,original:null,dirty:false,pending:false,workbook:null,fileName:'',query:'',generation:0});
  return personnelTimesheetViews.get(kind);
}
function ptAssert(s,write = false,visible = true) {
  if (s.stamp !== ptStamp() || personnelTimesheetViews.get(s.kind) !== s) throw Error('База или права изменились. Откройте раздел заново.');
  if (!ptRead() || write && !ptWrite()) throw Error('Нет доступа к '+(write ? 'изменению' : 'просмотру')+' табеля.');
  if (s.pending) throw Error('Дождитесь завершения сохранения.');
  if (visible && activeSection !== ptSection(s.kind)) throw Error('Раздел табеля закрыт. Откройте его заново.');
}
function ptSaved(kind) {
  if (!ptRead()) return [];
  return (data.assetDocuments || []).filter(row => PersonnelTimesheetDocument.isDocument(row) && row.personnelTimesheet.kind === kind && !row.archived && !row.deleted)
    .sort((a,b) => b.personnelTimesheet.from.localeCompare(a.personnelTimesheet.from) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}
function ptPeriod(m) { return fmtDate(m.from)+' — '+fmtDate(m.to); }
function ptFail(error) { const host = document.querySelector('[data-pt-error]'); if(host)host.textContent=error.message || String(error); else showToast(error.message); }
function ptCheckInputs() { if(document.querySelector('[data-pt-editor] [aria-invalid="true"]'))throw Error('Исправьте выделенные ячейки перед сохранением или выгрузкой табеля.'); }
async function ptMayReplace(s) {
  ptAssert(s); const generation=++s.generation;
  const replace=!s.dirty || await confirmAction('В табеле есть несохранённые изменения. Заменить текущий черновик?');
  ptAssert(s); if(generation!==s.generation)throw Error('Уже начато другое действие с табелем.');return replace;
}
function ptPreferredSheet(workbook,kind){return kind==='driver'?PersonnelTimesheet.listSheets(workbook).find(sheet=>sheet.valid&&sheet.name.replace(/\s/g,'').toLocaleLowerCase('ru')==='зпиюнь26')?.name:undefined;}
function ptOpen(s,record) {
  ptAssert(s); s.model = ptClone(record.personnelTimesheet); PersonnelTimesheet.validate(s.model);
  s.original=ptClone(record);s.dirty=false;s.workbook=null;s.fileName='';renderPersonnelTimesheets(s.kind);
}
function renderPersonnelTimesheets(kind) {
  const host = document.getElementById('mainContent');
  try {
    const s=ptView(kind),saved=ptSaved(kind),write=ptWrite();
    if (!ptRead()) { host.innerHTML='<div class="personnel-workspace"><h2>Табели '+ptLabel(kind)+'</h2><p>Для вашей роли документы сотрудников недоступны.</p></div>';return; }
    host.innerHTML='<div class="personnel-workspace pt-workspace" data-personnel-timesheet><div class="personnel-heading"><div><p class="personnel-eyebrow">Сотрудники · Учёт по дням</p><h2>Загрузка '+ptLabel(kind)+'</h2><p>Табель за выбранный период в формате вашего Excel.</p></div><div class="pt-actions"><button class="btn btn-ghost" data-pt-cards>Карточки сотрудников</button>'+(write?'<button class="btn btn-ghost" data-pt-new>Новый табель</button><button class="btn btn-primary" data-pt-import>Загрузить Excel</button><input type="file" accept=".xlsx,.xls" data-pt-file hidden>':'')+'</div></div><div class="pt-tabs"><span class="pt-tabs-active">Загрузка и табель</span><span>31 день · МВ / Д / ЯС / Я · Итоги за период</span></div><div class="pt-picker"><label>Сохранённые табели<select data-pt-saved><option value="">'+(saved.length?'Выберите период':'Сохранённых табелей пока нет')+'</option>'+saved.map((row,i)=>'<option value="'+i+'" '+(s.original?.id===row.id?'selected':'')+'>'+ptEsc(ptPeriod(row.personnelTimesheet)+' · '+(row.org||row.title))+'</option>').join('')+'</select></label><span data-pt-status role="status">'+(s.dirty?'Есть несохранённые изменения':s.original?'Сохранён в базе':'')+'</span></div><p class="wf-error" data-pt-error role="alert"></p><div data-pt-editor></div></div>';
    const view=host.querySelector('[data-personnel-timesheet]');
    view.querySelector('[data-pt-cards]').onclick=()=>switchSection(kind==='operator'?'operators':'drivers');
    view.querySelector('[data-pt-saved]').onchange=async event=>{try{if(event.target.value==='')return;if(await ptMayReplace(s))ptOpen(s,saved[Number(event.target.value)]);}catch(error){ptFail(error);}};
    if(write){view.querySelector('[data-pt-new]').onclick=()=>void ptNew(s);view.querySelector('[data-pt-import]').onclick=()=>view.querySelector('[data-pt-file]').click();view.querySelector('[data-pt-file]').onchange=event=>void ptImport(s,event.target.files[0]);}
    if(s.model)ptRenderEditor(s);else view.querySelector('[data-pt-editor]').innerHTML='<div class="pt-empty">'+xpIcon('calendar',36)+'<h3>Табель '+ptLabel(kind)+'</h3><p>Загрузите файл по вашему образцу или создайте табель из справочника сотрудников.</p><p>ФИО и объект слева, отметки по дням в центре, итоги и комментарии справа.</p></div>';
  } catch(error){host.innerHTML='<div class="personnel-workspace"><h2>Табели</h2><p role="alert">'+ptEsc(error.message)+'</p></div>';}
}
async function ptNew(s) {
  try{
    if(!await ptMayReplace(s))return;ptAssert(s,true);
    const today=wfToday(),month=today.slice(0,7);
    wfShowDialog('Новый табель '+ptLabel(s.kind),'<form id="personnelTimesheetNew" class="wf-form personnel-form"><label><span>С даты</span><input name="from" type="date" required value="'+month+'-01"></label><label><span>По дату</span><input name="to" type="date" required value="'+month+'-15"></label><label class="wf-wide"><span>Организация</span><input name="org" required maxlength="300" placeholder="Наименование организации"></label><label class="personnel-check wf-wide"><input name="seed" type="checkbox" checked> Добавить действующих сотрудников этой организации из справочника</label><p class="personnel-caption wf-wide">Период в пределах одного месяца. Часы и коды заполняются вручную.</p><p class="wf-error wf-wide" role="alert"></p><div class="wf-wide pt-actions"><button type="button" class="btn btn-ghost" data-pt-cancel>Отмена</button><button type="submit" class="btn btn-primary">Создать табель</button></div></form>');
    const form=document.getElementById('personnelTimesheetNew');form.querySelector('[data-pt-cancel]').onclick=()=>closeModal('wfModal');
    form.onsubmit=event=>{event.preventDefault();try{ptAssert(s,true);const rows=form.elements.seed.checked&&personnelCanRead('drivers')?personnelRows(s.kind).filter(row=>!row.archived&&!row.deleted&&row.org===form.elements.org.value.trim()).map(row=>ptPersonRow(row,s.kind)):[];s.model=PersonnelTimesheet.create({kind:s.kind,from:form.elements.from.value,to:form.elements.to.value,org:form.elements.org.value.trim(),rows});s.original=null;s.dirty=true;s.workbook=null;closeModal('wfModal');renderPersonnelTimesheets(s.kind);}catch(error){form.querySelector('[role=alert]').textContent=error.message;}};
  }catch(error){ptFail(error);}
}
function ptPersonRow(person,kind) {
  return {id:wfId('timesheet-row'),employeeId:person.id,name:person.name||'',position:kind==='operator'?'Машинист ДЭС':'Водитель',personnelNumber:String(person.personnelNumber??person.employeeNumber??''),department:person.org||'',site:person.site||'',days:{},note:''};
}
async function ptImport(s,file) {
  if(!file)return;
  try{
    if(!await ptMayReplace(s))return;ptAssert(s,true);const generation=s.generation;
    if(file.size>20*1024*1024)throw Error('Выберите Excel размером до 20 МБ.');
    const buffer=await file.arrayBuffer();ptAssert(s,true);
    if(generation!==s.generation)throw Error('Выбран другой файл или табель. Повторите загрузку.');
    const workbook=XLSX.read(buffer,{type:'array',cellDates:false,cellStyles:true});
    const model=PersonnelTimesheet.fromWorkbook(workbook,{kind:s.kind,fileName:file.name,sheetName:ptPreferredSheet(workbook,s.kind)});ptAssert(s,true);
    s.workbook=workbook;s.fileName=file.name;s.model=model;s.original=null;s.dirty=true;renderPersonnelTimesheets(s.kind);
  }catch(error){ptFail(error);}
}
function ptDirty(s) {s.dirty=true;const status=document.querySelector('[data-pt-status]');if(status)status.textContent='Есть несохранённые изменения';}
function ptInput(row,index,field,label,write) {
  if(!write)return ptEsc(row[field]);
  const attrs=' data-pt-row="'+index+'" data-pt-field="'+field+'" aria-label="'+ptEsc(label+' · '+row.name)+'" maxlength="'+(field==='note'?4000:300)+'"';
  return ['name','department','site','note'].includes(field)?'<textarea'+attrs+' rows="'+(field==='note'||field==='department'?3:2)+'">'+ptEsc(row[field])+'</textarea>':'<input'+attrs+' value="'+ptEsc(row[field])+'">';
}
function ptRenderEditor(s) {
  ptAssert(s);const m=s.model,write=ptWrite(),host=document.querySelector('[data-pt-editor]');
  PersonnelTimesheet.validate(m);
  const days=Array.from({length:31},(_,i)=>{const date=m.from.slice(0,7)+'-'+String(i+1).padStart(2,'0');const valid=PlatformIntegrity.dateValid(date,'date');return{day:i+1,date,valid,inPeriod:valid&&date>=m.from&&date<=m.to};});
  const summary=PersonnelTimesheet.summarize(m);
  const unlinked=m.rows.some(row=>row.employeeId===undefined||row.employeeId===null||row.employeeId==='');
  host.innerHTML='<div class="pt-document-tools"><div><h3>'+ptEsc(m.title||'Табель учёта рабочего времени')+'</h3><p>'+ptEsc(m.org)+' · '+ptPeriod(m)+'</p>'+(m.source?'<small>Источник: '+ptEsc(m.source.fileName)+' · '+ptEsc(m.source.sheetName)+'</small>':'')+'</div><div class="pt-actions">'+(write?'<button class="btn btn-ghost" data-pt-details>Реквизиты</button><button class="btn '+(unlinked?'btn-ghost':'btn-primary')+'" data-pt-save>'+(unlinked?'Сохранить только табель':'Сохранить табель')+'</button>':'')+'<button class="btn btn-ghost" data-pt-export>Выгрузить Excel</button><button class="btn btn-ghost" data-pt-print>Печать</button></div></div>'+
    (ptRosterWrite()&&m.rows.length?'<div class="pt-roster-hint"><div><strong>Сотрудники в справочнике</strong><p>Чтобы сотрудники из этого табеля появились в разделе «'+(s.kind==='operator'?'Операторы ДЭС':'Водители')+'», проверьте их и добавьте в справочник. Найденные карточки будут связаны с табелем.</p></div><button class="btn btn-primary" data-pt-roster>'+(!s.dirty&&s.original?'Добавить в справочник':'Сохранить и добавить в справочник')+'</button></div>':'')+
    (s.workbook?'<div class="pt-source"><label>Лист файла<select data-pt-sheet>'+PersonnelTimesheet.listSheets(s.workbook).filter(sheet=>sheet.valid).map(sheet=>'<option value="'+ptEsc(sheet.name)+'" '+(sheet.name===m.source?.sheetName?'selected':'')+'>'+ptEsc(sheet.name+' · '+fmtDate(sheet.from)+' — '+fmtDate(sheet.to))+'</option>').join('')+'</select></label><span>Период взят из ячеек табеля.</span></div>':'')+
    '<div class="pt-summary" data-pt-summary></div><div class="pt-legend"><span>Число — часы за смену</span><span>Коды сохраняются как в источнике</span><span class="pt-legend-inactive">Серые дни — вне периода</span></div><div data-pt-warnings></div><div class="pt-table-scroll" tabindex="0" aria-label="Табель '+ptLabel(m.kind)+'. Прокрутка по горизонтали"><table class="pt-table"><caption><strong>ТАБЕЛЬ</strong><span>учёта рабочего времени · '+ptEsc(m.org)+'</span><span>за период с '+fmtDate(m.from)+' по '+fmtDate(m.to)+'</span></caption><colgroup><col class="pt-col-no"><col class="pt-col-department"><col class="pt-col-name"><col class="pt-col-number"><col class="pt-col-site">'+days.map(()=>'<col class="pt-col-day">').join('')+'<col span="5" class="pt-col-total"><col class="pt-col-curator"><col class="pt-col-note">'+(write?'<col class="pt-col-action">':'')+'</colgroup><thead><tr><th rowspan="2">№</th><th rowspan="2">'+ptEsc(m.departmentLabel||'Юр лицо')+'</th><th rowspan="2">ФИО<br>Должность</th><th rowspan="2">Табельный<br>номер</th><th rowspan="2">Объект</th><th colspan="31">Отметки о явках и неявках на работу по числам месяца</th><th colspan="4">Всего дней</th><th rowspan="2">Итого<br>Д, ЯС, Я</th><th rowspan="2">'+ptEsc(m.signatureLabel||'Куратор')+(m.curator?'<br>'+ptEsc(m.curator):'')+'</th><th rowspan="2">'+ptEsc(m.noteLabel||'Комментарии')+'</th>'+(write?'<th rowspan="2" class="pt-no-print">Строка</th>':'')+'</tr><tr>'+days.map(day=>'<th class="'+(day.inPeriod?'':'pt-outside')+'">'+day.day+'</th>').join('')+'<th>МВ</th><th>Д</th><th>ЯС</th><th>Я</th></tr></thead><tbody>'+m.rows.map((row,index)=>'<tr data-pt-id="'+index+'"><td>'+ptEsc(row.number??index+1)+'</td><td>'+ptInput(row,index,'department','Организация',write)+'</td><td class="pt-person">'+ptInput(row,index,'name','ФИО',write)+'<small>'+ptInput(row,index,'position','Должность',write)+'</small></td><td>'+ptInput(row,index,'personnelNumber','Табельный номер',write)+'</td><td>'+ptInput(row,index,'site','Объект',write)+'</td>'+days.map(day=>'<td class="pt-day '+(day.inPeriod?'':'pt-outside')+'" data-pt-code="'+ptEsc(row.days[day.date]??'')+'">'+(write&&day.valid?'<input data-pt-row="'+index+'" data-pt-day="'+day.date+'" value="'+ptEsc(row.days[day.date]??'')+'" aria-label="'+ptEsc(row.name+' · '+fmtDate(day.date))+'" maxlength="24" '+(!day.inPeriod?'readonly tabindex="-1"':'')+'>':ptEsc(row.days[day.date]??''))+'</td>').join('')+['МВ','Д','ЯС','Я','total'].map(code=>'<td class="pt-total" data-pt-total="'+code+'"></td>').join('')+'<td>'+ptInput(row,index,'signature','Куратор',write)+'</td><td>'+ptInput(row,index,'note','Комментарий',write)+'</td>'+(write?'<td class="pt-no-print"><button class="btn btn-ghost btn-sm" data-pt-remove="'+index+'" aria-label="Удалить строку '+ptEsc(row.name)+'">Убрать</button></td>':'')+'</tr>').join('')+'</tbody><tfoot><tr><th colspan="36">Итого за период</th>'+['МВ','Д','ЯС','Я','total'].map(code=>'<td data-pt-grand="'+code+'"></td>').join('')+'<td colspan="'+(write?3:2)+'"></td></tr></tfoot></table></div>'+(write?'<div class="pt-add"><button class="btn btn-ghost" data-pt-add>Добавить сотрудника</button><span>Пустая отметка остаётся пустой. Итоги учитывают только выбранный период.</span></div>':'');
  ptUpdateSummary(s,summary);
  host.querySelector('[data-pt-export]').onclick=()=>{try{ptAssert(s);ptCheckInputs();PersonnelTimesheet.validate(s.model);const bytes=PersonnelTimesheet.toXlsx(s.model,XLSX),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download='Табель_'+(s.kind==='operator'?'машинисты_ДЭС':'водители')+'_'+s.model.from+'_'+s.model.to+'.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){ptFail(error);}};
  host.querySelector('[data-pt-print]').onclick=()=>{try{ptAssert(s);ptCheckInputs();document.body.classList.add('pt-printing');window.print();}catch(error){ptFail(error);}finally{document.body.classList.remove('pt-printing');}};
  if(!write)return;
  host.querySelector('[data-pt-details]').onclick=()=>ptDetails(s);
  host.querySelector('[data-pt-save]').onclick=()=>void ptSave(s);
  const roster=host.querySelector('[data-pt-roster]');if(roster)roster.onclick=()=>ptRoster(s);
  host.querySelector('[data-pt-add]').onclick=()=>ptAdd(s);
  host.querySelectorAll('[data-pt-remove]').forEach(button=>button.onclick=async()=>{try{ptAssert(s,true);if(!await confirmAction('Убрать сотрудника из этого табеля?'))return;ptAssert(s,true);s.model.rows.splice(Number(button.dataset.ptRemove),1);ptDirty(s);ptRenderEditor(s);}catch(error){ptFail(error);}});
  host.querySelectorAll('input[data-pt-row],textarea[data-pt-row]').forEach(input=>input.onchange=()=>{
    try{ptAssert(s,true);const row=m.rows[Number(input.dataset.ptRow)],before=ptClone(row);if(input.dataset.ptDay){const raw=input.value.trim(),value=raw!==''&&/^\d+(?:[.,]\d+)?$/.test(raw)?Number(raw.replace(',','.')):raw.toLocaleUpperCase('ru');if(value==='')delete row.days[input.dataset.ptDay];else row.days[input.dataset.ptDay]=value;input.value=String(value);input.closest('td').dataset.ptCode=String(value);}else row[input.dataset.ptField]=input.value.trim();
      try{PersonnelTimesheet.validate(m);}catch(error){Object.keys(row).forEach(key=>delete row[key]);Object.assign(row,before);input.setAttribute('aria-invalid','true');throw error;}
      input.removeAttribute('aria-invalid');ptDirty(s);ptUpdateSummary(s,PersonnelTimesheet.summarize(m));
    }catch(error){ptFail(error);}
  });
  const sheet=host.querySelector('[data-pt-sheet]');if(sheet)sheet.onchange=async()=>{try{const name=sheet.value;if(!await ptMayReplace(s)){sheet.value=m.source.sheetName;return;}ptAssert(s,true);s.model=PersonnelTimesheet.fromWorkbook(s.workbook,{kind:s.kind,fileName:s.fileName,sheetName:name});s.original=null;ptDirty(s);ptRenderEditor(s);}catch(error){ptFail(error);}};
}
function ptRoster(s) {
  try {
    ptAssert(s,true);ptCheckInputs();PersonnelTimesheet.validate(s.model);
    if(!ptRosterWrite())throw Error('Нет доступа к изменению справочника сотрудников.');
    const model=ptClone(s.model),source=JSON.stringify(s.model),generation=++s.generation;
    const database={drivers:ptClone(data.drivers||[])},baseline={drivers:JSON.stringify(data.drivers||[]),assetDocuments:JSON.stringify(data.assetDocuments||[])};
    const review={createIds:model.rows.map(row=>({rowId:row.id,id:wfId('person')})),skipRowIds:[],operationId:wfId('timesheet-roster'),now:new Date().toISOString(),reason:'Добавление сотрудников из табеля '+ptPeriod(model),pending:false};
    const assertReview=()=>{ptAssert(s,true);if(!ptRosterWrite())throw Error('Нет доступа к изменению справочника сотрудников.');if(generation!==s.generation||source!==JSON.stringify(s.model))throw Error('Табель изменился после проверки. Откройте добавление в справочник заново.');};
    wfShowDialog('Сотрудники из табеля · '+ptLabel(s.kind),'<form id="personnelTimesheetRoster" class="wf-form personnel-form"><div class="wf-wide" data-pt-roster-review></div><label class="wf-wide"><span>Основание добавления в справочник</span><input name="reason" required minlength="5" maxlength="500" value="'+ptEsc(review.reason)+'"></label><p class="wf-error wf-wide" role="alert"></p><div class="wf-wide pt-actions"><button type="button" class="btn btn-ghost" data-pt-roster-cancel>Вернуться к табелю</button><button type="submit" class="btn btn-primary" data-pt-roster-confirm>Подтвердить и сохранить</button></div></form>');
    const form=document.getElementById('personnelTimesheetRoster'),host=form.querySelector('[data-pt-roster-review]'),confirm=form.querySelector('[data-pt-roster-confirm]'),errorHost=form.querySelector('[role=alert]');
    const renderReview=()=>{
      assertReview();review.plan=PersonnelTimesheetRoster.preview(database,model,{createIds:review.createIds,skipRowIds:review.skipRowIds});
      const plan=review.plan,counts={create:plan.createdIds.length,matched:plan.items.filter(item=>item.status==='matched').length,blocked:plan.items.filter(item=>item.status==='blocked').length,skipped:plan.items.filter(item=>item.status==='skip').length};
      host.innerHTML='<p class="pt-roster-counts" role="status">Новых карточек: <strong>'+counts.create+'</strong> · Найдено в справочнике: <strong>'+counts.matched+'</strong> · Требуют уточнения: <strong>'+counts.blocked+'</strong> · Пропущено: <strong>'+counts.skipped+'</strong></p><p class="personnel-caption">Проверьте ФИО, табельные номера и организации. Карточки существующих сотрудников сохранят свои реквизиты. Отмеченные как «Пропустить» строки останутся в табеле.</p><div class="pt-roster-scroll"><table class="pt-roster-table"><thead><tr><th>Сотрудник</th><th>Организация / объект</th><th>Проверка</th><th>Пропустить</th></tr></thead><tbody>'+plan.items.map((item,index)=>{
        const row=model.rows.find(row=>row.id===item.rowId)||model.rows[index],person=plan.drivers.find(person=>person.id===item.employeeId),labels={create:'Новая карточка',matched:'Найден в справочнике',blocked:'Нужно уточнить',skip:'Пропущено'};
        return '<tr data-pt-roster-status="'+ptEsc(item.status)+'"><td><strong>'+ptEsc(row.name)+'</strong><small>Таб. № '+ptEsc(row.personnelNumber||'не указан')+'</small></td><td>'+ptEsc(row.department||model.org)+'<small>'+ptEsc(row.site||'Объект не указан')+'</small></td><td><strong>'+ptEsc(labels[item.status]||item.status)+'</strong><small>'+ptEsc(item.reason||person?.name||'')+'</small>'+((item.warnings||[]).map(warning=>'<small>'+ptEsc(warning)+'</small>').join(''))+'</td><td><label class="pt-roster-skip"><input type="checkbox" data-pt-roster-skip="'+index+'" '+(review.skipRowIds.some(id=>id===row.id)?'checked':'')+' aria-label="Пропустить '+ptEsc(row.name)+'"></label></td></tr>';
      }).join('')+'</tbody></table></div>'+(counts.blocked?'<p class="wf-error">Уточните данные отмеченных сотрудников в табеле или выберите «Пропустить». Добавление станет доступно после проверки всех выбранных строк.</p>':'');
      confirm.disabled=!plan.canApply;
      host.querySelectorAll('[data-pt-roster-skip]').forEach(input=>input.onchange=()=>{try{assertReview();const item=plan.items[Number(input.dataset.ptRosterSkip)];review.skipRowIds=review.skipRowIds.filter(id=>id!==item.rowId);if(input.checked)review.skipRowIds.push(item.rowId);errorHost.textContent='';renderReview();}catch(error){errorHost.textContent=error.message;confirm.disabled=true;}});
    };
    form.querySelector('[data-pt-roster-cancel]').onclick=()=>{if(!review.pending)closeModal('wfModal');};
    form.onsubmit=async event=>{
      event.preventDefault();if(review.pending)return;
      let controls=[];
      try {
        assertReview();ptCheckInputs();if(!review.plan.canApply)throw Error('Уточните или пропустите строки с ошибками.');
        review.reason=form.elements.reason.value.trim();if(review.reason.length<5)throw Error('Укажите основание добавления в справочник, не короче 5 символов.');
        const operationText=JSON.stringify([review.plan.fingerprint,review.reason]);
        if(review.operationText!==undefined&&review.operationText!==operationText){review.operationId=wfId('timesheet-roster');review.now=new Date().toISOString();}
        review.operationText=operationText;
        const identity=personnelIdentity(),accessStamp=ptStamp(),plan=review.plan;
        review.pending=true;s.pending=true;errorHost.textContent='';
        controls=[...document.querySelectorAll('[data-personnel-timesheet] button,[data-personnel-timesheet] input,[data-personnel-timesheet] textarea,[data-personnel-timesheet] select,#wfModal button,#wfModal input')].map(input=>({input,disabled:input.disabled}));controls.forEach(({input})=>input.disabled=true);
        const result=await personnelTimesheetRosterStore({model,original:s.original,options:{createIds:review.createIds,skipRowIds:review.skipRowIds},reviewFingerprint:plan.fingerprint,baseline,identity,accessStamp,operationId:review.operationId,now:review.now,reason:review.reason});
        s.pending=false;review.pending=false;assertReview();
        s.original=ptClone(result.record);s.model=ptClone(result.record.personnelTimesheet);s.dirty=false;s.workbook=null;
        closeModal('wfModal');renderPersonnelTimesheets(s.kind);
        const status=document.querySelector('[data-pt-status]');if(status)status.textContent='Сохранён в базе';
        const linked=(result.plan?.items||plan.items).filter(item=>item.status==='matched'||item.status==='create').length;
        const message='Новых карточек: '+result.createdIds.length+'. Связано строк табеля: '+linked+'. Табель сохранён.';
        const hint=document.querySelector('.pt-roster-hint');if(hint){hint.querySelector('strong').textContent=message;hint.querySelector('p').textContent='Сотрудников можно открыть в их разделе. Повторное добавление проверит уже созданные карточки.';const button=hint.querySelector('button');button.textContent='Открыть раздел «'+(s.kind==='operator'?'Операторы ДЭС':'Водители')+'»';button.dataset.ptRosterOpen='';button.onclick=()=>switchSection(s.kind==='operator'?'operators':'drivers');}
        showToast(message);
      } catch(error) {
        s.pending=false;review.pending=false;
        if(s.stamp===ptStamp()&&personnelTimesheetViews.get(s.kind)===s){controls.forEach(({input,disabled})=>input.disabled=disabled);errorHost.textContent=error.message||String(error);}else ptFail(error);
      }
    };
    renderReview();
  }catch(error){ptFail(error);}
}
function ptUpdateSummary(s,summary) {
  const host=document.querySelector('[data-pt-editor]');if(!host)return;
  const totals=summary.totals,counts=totals.counts||totals.days||totals;
  let other=host.querySelector('[data-pt-other]');if(!other){other=document.createElement('span');other.dataset.ptOther='';host.querySelector('.pt-legend').append(other);}other.textContent=Object.entries(totals.otherCodes||{}).map(([code,count])=>code+': '+count).join(' · ');
  host.querySelector('[data-pt-summary]').innerHTML='<article><span>Сотрудников</span><strong>'+s.model.rows.length+'</strong></article><article><span>Рабочих смен</span><strong>'+ptEsc(totals.workedDays)+'</strong></article><article><span>Часов по числовым отметкам</span><strong>'+ptEsc(totals.hours)+'</strong></article><article><span>Пустых отметок в периоде</span><strong>'+ptEsc(totals.blankDays)+'</strong></article>';
  summary.rows.forEach((row,index)=>{const tr=host.querySelector('[data-pt-id="'+index+'"]');if(!tr)return;const count=row.counts||row.days;['МВ','Д','ЯС','Я'].forEach(code=>tr.querySelector('[data-pt-total="'+code+'"]').textContent=count[code]??0);tr.querySelector('[data-pt-total=total]').textContent=row.totalDays;tr.classList.toggle('pt-mismatch',!!row.mismatches?.length);});
  ['МВ','Д','ЯС','Я'].forEach(code=>host.querySelector('[data-pt-grand="'+code+'"]').textContent=counts[code]??0);host.querySelector('[data-pt-grand=total]').textContent=totals.totalDays;
  const warnings=summary.warnings||[];
  host.querySelector('[data-pt-warnings]').innerHTML=warnings.length?'<details class="pt-warning" open><summary>Проверка исходных итогов · '+warnings.length+'</summary><ul>'+warnings.map(item=>'<li>'+ptEsc(typeof item==='string'?item:item.message||JSON.stringify(item))+'</li>').join('')+'</ul><p>Исходные итоги сохранены для сверки. В сетке и выгрузке показан расчёт по отметкам за период.</p></details>':'';
}
function ptAdd(s) {
  try{
    ptAssert(s,true);const people=personnelCanRead('drivers')?personnelRows(s.kind).filter(row=>!row.archived&&!row.deleted&&!s.model.rows.some(item=>item.employeeId!==undefined&&item.employeeId===row.id)):[];
    wfShowDialog('Добавить сотрудника в табель','<form id="personnelTimesheetAdd" class="wf-form personnel-form"><label class="wf-wide"><span>Из справочника</span><select name="person"><option value="">Ввести вручную</option>'+people.map((person,index)=>'<option value="'+index+'">'+ptEsc(person.name)+'</option>').join('')+'</select></label><label class="wf-wide"><span>ФИО</span><input name="name" maxlength="300" required></label><label><span>Должность</span><input name="position" maxlength="300" value="'+(s.kind==='operator'?'Машинист ДЭС':'Водитель')+'"></label><label><span>Табельный номер</span><input name="personnelNumber" maxlength="100"></label><label><span>Организация</span><input name="department" maxlength="300" value="'+ptEsc(s.model.org)+'"></label><label><span>Объект</span><input name="site" maxlength="300"></label><p class="wf-error wf-wide" role="alert"></p><div class="wf-wide pt-actions"><button type="button" class="btn btn-ghost" data-pt-cancel>Отмена</button><button type="submit" class="btn btn-primary">Добавить</button></div></form>');
    const form=document.getElementById('personnelTimesheetAdd');form.querySelector('[data-pt-cancel]').onclick=()=>closeModal('wfModal');
    form.elements.person.onchange=()=>{const person=people[Number(form.elements.person.value)];if(form.elements.person.value===''||!person)return;for(const field of ['name','personnelNumber','site'])form.elements[field].value=person[field]??'';form.elements.department.value=person.org||s.model.org;};
    form.onsubmit=event=>{event.preventDefault();try{ptAssert(s,true);const row={id:wfId('timesheet-row'),days:{},note:''};for(const field of ['name','position','personnelNumber','department','site'])row[field]=form.elements[field].value.trim();if(form.elements.person.value!=='')row.employeeId=people[Number(form.elements.person.value)].id;const candidate=ptClone(s.model);candidate.rows.push(row);PersonnelTimesheet.validate(candidate);s.model=candidate;ptDirty(s);closeModal('wfModal');ptRenderEditor(s);}catch(error){form.querySelector('[role=alert]').textContent=error.message;}};
  }catch(error){ptFail(error);}
}
function ptDetails(s) {
  try{
    ptAssert(s,true);ptCheckInputs();const m=s.model,fields=[['org','Организация','text'],['division','Подразделение','text'],['title','Название табеля','text'],['documentNumber','Номер документа','text'],['preparedAt','Дата составления','date'],['from','Период с','date'],['to','Период по','date'],['curator','Куратор в шапке','text']];
    wfShowDialog('Реквизиты табеля','<form id="personnelTimesheetDetails" class="wf-form personnel-form">'+fields.map(([key,label,type])=>'<label><span>'+label+'</span><input name="'+key+'" type="'+type+'" value="'+ptEsc(m[key])+'" maxlength="500" '+(['org','from','to'].includes(key)?'required':'')+'></label>').join('')+'<p class="wf-wide personnel-caption">Период в пределах одного месяца. Для другого месяца создайте новый табель.</p><p class="wf-wide wf-error" role="alert"></p><div class="wf-wide pt-actions"><button type="button" class="btn btn-ghost" data-pt-cancel>Отмена</button><button type="submit" class="btn btn-primary">Применить</button></div></form>');
    const form=document.getElementById('personnelTimesheetDetails');form.querySelector('[data-pt-cancel]').onclick=()=>closeModal('wfModal');form.onsubmit=event=>{event.preventDefault();try{ptAssert(s,true);const next=ptClone(m);for(const[key]of fields)next[key]=form.elements[key].value.trim();if(next.from.slice(0,7)!==m.from.slice(0,7))throw Error('Для другого месяца создайте новый табель.');PersonnelTimesheet.validate(next);s.model=next;ptDirty(s);closeModal('wfModal');ptRenderEditor(s);}catch(error){form.querySelector('[role=alert]').textContent=error.message;}};
  }catch(error){ptFail(error);}
}
async function ptSave(s) {
  if(s.pending)return;
  try{
    ptAssert(s,true);ptCheckInputs();PersonnelTimesheet.validate(s.model);
    const record=PersonnelTimesheetDocument.makeRecord(s.model,{id:s.original?.id??wfId('timesheet'),now:new Date().toISOString(),previous:s.original||undefined});
    const identity=personnelIdentity();s.pending=true;document.querySelectorAll('[data-personnel-timesheet] button,[data-personnel-timesheet] input,[data-personnel-timesheet] textarea,[data-personnel-timesheet] select').forEach(input=>input.disabled=true);
    await personnelStore('assetDocuments',record,s.original,identity);
    s.pending=false;ptAssert(s,true,false);
    const canonical=(data.assetDocuments||[]).find(row=>row.id===record.id);if(!canonical)throw Error('Не удалось прочитать сохранённый табель. Обновите раздел.');
    s.original=ptClone(canonical);s.model=ptClone(canonical.personnelTimesheet);s.dirty=false;s.workbook=null;if(activeSection===ptSection(s.kind))renderPersonnelTimesheets(s.kind);showToast('Табель сохранён в базе');
  }catch(error){s.pending=false;ptFail(error);if(s.stamp===ptStamp())document.querySelectorAll('[data-personnel-timesheet] button,[data-personnel-timesheet] input,[data-personnel-timesheet] textarea,[data-personnel-timesheet] select').forEach(input=>input.disabled=false);}
}
// Entry in each personnel section, alongside its existing cards and date planning.
const ptRenderPersonnelOriginal=renderPersonnelSection;
renderPersonnelSection=function(...args){const result=ptRenderPersonnelOriginal.apply(this,args),host=document.querySelector('.personnel-workspace');if(host&&!host.querySelector('[data-pt-entry]')&&ptRead()){const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.dataset.ptEntry='';button.textContent='Загрузка и табель';button.onclick=()=>switchSection(ptSection(personnelKind()));host.querySelector('.personnel-heading .personnel-actions, .personnel-heading')?.append(button);}return result;};
