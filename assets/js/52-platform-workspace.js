// Application-wide diagnostics. Reading this workspace never repairs or saves data.
let platformIssueFilter = '', platformIssueSeverity = '', platformIssueLimit = 40;
async function platformNotifyPendingOperations(){
  if(!window.electronAPI?.getPendingOperations)return;
  const stamp=syncSessionStamp();
  try{
    const result=await window.electronAPI.getPendingOperations();
    if(stamp!==syncSessionStamp()||!result?.ok)return;
    const count=(result.operations||[]).filter(row=>row.status!=='committed').length;
    if(count)showToast('Есть неподтверждённые операции: '+count+'. Откройте «Состояние программы», чтобы проверить результат.');
  }catch{}
}

function platformHealthSnapshot(calculatedIntegrity) {
  const context = platformSessionContext();
  const inspected=calculatedIntegrity||PlatformIntegrity.inspect(data, { readable:context.readable, today:dispatcherLocalDate() });
  const issueFields=['code','severity','section','recordId','rowIndex','field','message','targetSection','targetId','relatedRecordId'];
  const integrity={ counts:{...inspected.counts}, sections:inspected.sections,
    issues:inspected.issues.map(issue => Object.fromEntries(issueFields.filter(field => issue[field] != null && ['string','number'].includes(typeof issue[field])).map(field => [field,issue[field]]))) };
  return { inspectedAt:new Date().toISOString(), schemaVersion:PlatformSchema.apiVersion,
    modules:PlatformSchema.describe(), integrity,
    runtime:platformRuntimeStatus(), calculations:dispatcherEngineStats(),
    storage:{ connected:!_loadWriteBlocked, compatibility:_sync.platform?.negotiation||null, needsSchemaUpgrade:!!_sync.platform?.needsSchemaUpgrade, sectionProtocol:!!_sync.enabled, operationProtocol:!!_sync.platform?.operations, role:context.actor?.role || 'local',
      readable:context.readable || PlatformSchema.sections, writable:context.writable || PlatformSchema.sections } };
}
function platformSystemIssues(report) {
  return (report.integrity.issues || []).filter(issue => (!platformIssueFilter || issue.section === platformIssueFilter) &&
    (!platformIssueSeverity || issue.severity === platformIssueSeverity));
}
function platformSectionLabel(section) { return PlatformSchema.descriptors[section]?.label || section; }
function platformOpenSource(section, id) {
  const readable = platformSessionContext().readable;
  if (readable && !readable.includes(section)) { showToast('Раздел недоступен для вашей роли.'); return; }
  const row = (data[section] || []).find(row => (row.id ?? row.month ?? '') === id);
  if (section === 'drivers') { if (row) personnelOpenPerson(row.id); else switchSection('drivers'); return; }
  if (section === 'vehicles') { switchSection('vehicles'); if (row) renderDetail(row); return; }
  if (section === 'records') { switchSection('vehicles'); const vehicle = row && data.vehicles.find(vehicle => vehicle.id === row.vehicleId); if (vehicle) renderDetail(vehicle); return; }
  if (section === 'generators' || section === 'genRecords') { switchSection('generators'); return; }
  if (section === 'tanks' || section === 'tankIncomes') { switchSection('tanks'); return; }
  if (['fuelPurchases','fuelCards','fuelPeriods','fuelWriteoffs','monthlyFuel','fuelImports'].includes(section)) { switchSection('fuelPurchases'); fpView='diagnostics'; renderFuelPurchases(); return; }
  if (['payments','budget'].includes(section)) { switchSection('finances'); return; }
  if (section === 'contragents') { switchSection('contragents'); return; }
  if (['costEntries','costProfiles'].includes(section)) { switchSection('costs'); return; }
  if (['procurementOrders','procurementRules'].includes(section)) { switchSection('procurement'); return; }
  if (['reestrRows','savedReestrs'].includes(section)) { switchSection('reestr'); return; }
  switchSection('workflows');
  if (typeof wfOpenTab === 'function' && Object.hasOwn(WF_FIELDS, section)) wfOpenTab(section, { query:'', site:'', org:'', archive:false });
}
function renderPlatformIssues(report) {
  const issues = platformSystemIssues(report), shown = issues.slice(0,platformIssueLimit);
  return '<p class="platform-note" role="status">Показано ' + shown.length + ' из ' + issues.length + '. Проверка ничего не изменяет в базе.</p>' +
    (shown.length ? '<div class="platform-issues">' + shown.map(issue => '<article class="platform-issue ' + (issue.severity === 'error' ? 'is-error' : '') + '"><div><strong>' + htmlEsc(platformSectionLabel(issue.section)) + '</strong><span>' + (issue.severity === 'error' ? 'Нужна проверка' : 'Замечание') + '</span></div><p>' + htmlEsc(issue.message) + '</p><small>' + htmlEsc([issue.recordId ? 'Запись: '+issue.recordId : '',issue.field ? 'Поле: '+issue.field : ''].filter(Boolean).join(' · ')) + '</small>' +
      (issue.section ? '<button type="button" class="btn btn-ghost btn-sm" data-platform-source="' + htmlEsc(issue.section) + '" data-platform-id="' + htmlEsc(JSON.stringify(issue.recordId ?? '')) + '">Открыть раздел</button>' : '') + '</article>').join('') + '</div>' : '<div class="platform-empty">Замечаний по выбранному фильтру нет.</div>') +
    (issues.length > shown.length ? '<button type="button" class="btn btn-ghost" id="platformMoreIssues">Показать ещё</button>' : '');
}
function renderPlatformSystem(calculatedIntegrity) {
  const supplied=calculatedIntegrity&&Array.isArray(calculatedIntegrity.issues)&&calculatedIntegrity.counts?calculatedIntegrity:null;
  if(!supplied&&dispatcherBackgroundNeeded()){dispatcherRenderBackground('system','health',{},renderPlatformSystem);return;}
  const report = platformHealthSnapshot(supplied), counts = report.integrity.counts || {}, allowed = new Set(report.storage.readable);
  const modules = Array.isArray(PlatformSchema.modules) ? PlatformSchema.modules : Object.values(PlatformSchema.modules);
  const history = report.runtime.recent || report.runtime.operations || [];
  const mergeAvailable=typeof catalogMergeOpen==='function'&&catalogMergeReadable()&&catalogMergeWritable([]);
  document.getElementById('mainContent').innerHTML = '<div class="platform-workspace"><div class="platform-heading"><div><h2>Состояние программы</h2><p>Общие проверки данных и операций всех модулей.</p></div><div class="platform-actions">'+(mergeAvailable?'<button type="button" class="btn btn-ghost" id="platformCatalogMerge">Объединить дубли справочника</button>':'')+'<button type="button" class="btn btn-ghost" onclick="periodControlOpen()">Периоды учёта</button><button type="button" class="btn btn-ghost" id="platformExport">Выгрузить диагностику</button><button type="button" class="btn btn-primary" id="platformRefresh">Проверить заново</button></div></div>' +
    '<div class="platform-summary"><article><span>Хранилище</span><strong>' + (report.storage.connected ? report.storage.operationProtocol ? 'Подключено' : 'Совместимый режим' : 'Только просмотр') + '</strong><small>' + (report.storage.operationProtocol ? 'Подтверждение операций и проверка версий' : report.storage.sectionProtocol ? 'Проверка версий; сервер без протокола операций' : 'Доступность подтверждения зависит от подключения') + '</small></article><article><span>Модули</span><strong>' + modules.length + '</strong><small>Общий каталог и правила связей</small></article><article><span>Связи и значения</span><strong>' + (counts.error || 0) + '</strong><small>Ошибок данных для проверки · замечаний ' + (counts.warning || 0) + '</small></article></div>' +
    '<section><h3>Разделы программы</h3><div class="platform-modules">' + modules.map(module => {
      const sections = (module.sections || []).filter(section => allowed.has(section)), rows = sections.reduce((sum,section) => sum + (data[section]?.length || 0),0);
      const issues = report.integrity.issues.filter(issue => sections.includes(issue.section));
      return '<article><strong>' + htmlEsc(module.label || module.name || module.id) + '</strong><p>' + (sections.length ? rows + ' записей · ' + sections.length + ' разделов' : 'Нет доступа к данным') + '</p><small>' + (issues.length ? 'Замечаний: '+issues.length : sections.length ? 'Связи проверены' : 'Разделы скрыты правами доступа') + '</small></article>';
    }).join('') + '</div></section><section><h3>Проверка данных</h3><p class="platform-note">Открытие проверки не исправляет существующие данные. Сохранение запрещает новые повреждения и удаление записей, на которые ссылаются другие документы.</p><div class="platform-filters"><label>Раздел<select id="platformSection"><option value="">Все доступные разделы</option>' + PlatformSchema.sections.filter(section => allowed.has(section)).map(section => '<option value="' + htmlEsc(section) + '"' + (platformIssueFilter === section ? ' selected' : '') + '>' + htmlEsc(platformSectionLabel(section)) + '</option>').join('') + '</select></label><label>Уровень<select id="platformSeverity"><option value="">Все замечания</option><option value="error"' + (platformIssueSeverity === 'error' ? ' selected' : '') + '>Ошибки данных</option><option value="warning"' + (platformIssueSeverity === 'warning' ? ' selected' : '') + '>Предупреждения</option></select></label></div><div id="platformIssues">' + renderPlatformIssues(report) + '</div></section>' +
    '<section><h3>Последние операции этого сеанса</h3><p class="platform-note">Здесь виден результат сохранения. Подтверждённая история изменений хранится в базе.</p>' + (history.length ? '<div class="platform-operation-list">' + history.slice().reverse().slice(0,20).map(operation => '<article><div><strong>' + htmlEsc(({committed:'Сохранено',failed:'Не сохранено',unchanged:'Без изменений'})[operation.status] || 'Операция') + '</strong><span>' + htmlEsc((operation.changed || operation.sections || []).map(platformSectionLabel).join(', ')) + '</span></div><small>' + htmlEsc(operation.at || operation.completedAt || operation.id || '') + '</small></article>').join('') + '</div>' : '<div class="platform-empty">В этом сеансе сохранений ещё не было.</div>') + '</section></div>';
  document.getElementById('platformRefresh').onclick = renderPlatformSystem;
  document.getElementById('platformExport').onclick = platformExportDiagnostics;
  if(mergeAvailable)document.getElementById('platformCatalogMerge').onclick=()=>catalogMergeOpen();
  const documentActions=document.querySelector('#mainContent .platform-actions'),documentContext=platformSessionContext();
  if(report.storage.needsSchemaUpgrade){const note=document.createElement('p');note.className='platform-note';note.setAttribute('role','status');note.textContent='Старая база открыта только для чтения. Создайте обновлённую копию в новой папке и проверьте её перед переключением. Исходная база сохраняется.';document.querySelector('#mainContent .platform-heading')?.after(note);const status=document.querySelector('#mainContent .platform-summary article');if(status){status.querySelector('strong').textContent='Только просмотр';status.querySelector('small').textContent='Для изменений нужна отдельная обновлённая копия';}}
  if(documentActions&&typeof documentDraftsOpen==='function'&&_sync.platform?.documentDrafts===1&&(!Array.isArray(documentContext.readable)||documentContext.readable.includes('*')||documentContext.readable.includes('documentDrafts'))){const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.textContent='Черновики документов';button.onclick=()=>documentDraftsOpen();documentActions.append(button);}
  if(documentActions&&documentContext.actor?.role==='admin'&&typeof lifecycleUpgradeOpen==='function'&&window.electronAPI?.inspectSchemaUpgrade){const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.textContent=window.electronAPI?.databaseMaintenance?'Копии и перенос базы':'Обновить копию базы';button.onclick=()=>lifecycleUpgradeOpen();documentActions.append(button);}
  const refreshIssues = () => {
    document.getElementById('platformIssues').innerHTML = renderPlatformIssues(report); platformBindSourceLinks(report);
  };
  document.getElementById('platformSection').onchange = event => { platformIssueFilter=event.target.value; platformIssueLimit=40; refreshIssues(); };
  document.getElementById('platformSeverity').onchange = event => { platformIssueSeverity=event.target.value; platformIssueLimit=40; refreshIssues(); };
  platformBindSourceLinks(report);
  platformRenderRecoveryPanel();
  platformRenderDataBrowser();
  platformRenderHistory();
  platformRenderOperationalDiagnostics();
}
function platformRenderOperationalDiagnostics(){
  if(!window.electronAPI?.getOperationDiagnostics||platformSessionContext().actor?.role!=='admin')return;
  const workspace=document.querySelector('.platform-workspace');if(!workspace)return;
  const panel=document.createElement('section');panel.id='platformOperationalDiagnostics';
  panel.innerHTML='<h3>Техническая диагностика</h3><p class="platform-note">Этапы прохождения операций. Пакет для поддержки содержит обезличенный технический журнал без записей базы и ключей доступа.</p><p role="status"></p><form class="platform-filters"><label>ID операции<input name="operationId" maxlength="200" required></label><button type="submit" class="btn btn-ghost">Показать этапы</button></form><ol></ol><button type="button" class="btn btn-ghost" data-support-export>Пакет для поддержки</button>';
  workspace.append(panel);const stamp=syncSessionStamp(),status=panel.querySelector('[role=status]'),rows=panel.querySelector('ol'),form=panel.querySelector('form');let sequence=0;
  const current=()=>panel.isConnected&&stamp===syncSessionStamp();
  async function load(query){const request=++sequence;let result;try{result=await electronAPI.getOperationDiagnostics(query);}catch{result=null;}if(!current()||request!==sequence)return;rows.replaceChildren();
    if(!result?.ok){status.textContent='Техническая диагностика недоступна.';return;}
    status.textContent=query?'Найдено этапов: '+(result.events?.length||0)+(result.truncated?' · показаны последние 200':''):'Сохранено технических событий: '+result.eventCount+'. Журнал ограничен '+result.limits.files+' файлами.';
    const labels={'ui-prepared':'Запрос подготовлен','outbox-persisted':'Запрос сохранён в очереди','transport-sent':'Запрос отправлен','host-received':'Запрос получен основной базой','commit-started':'Начата проверка сохранения','commit-finished':'Завершена обработка сохранения','ack-received':'Получен ответ','recovery-looked-up':'Проверено подтверждение'},codes={prepared:'подготовлено',pending:'ожидается результат',committed:'сохранено',replayed:'подтверждён прежний результат',conflict:'данные изменились',denied:'отказ',unknown:'результат не подтверждён','not-found':'подтверждение не найдено',failed:'ошибка'};
    for(const event of result.events||[]){const item=document.createElement('li');item.textContent=[event.at,labels[event.phase]||'Техническое событие',codes[event.code]||'Статус недоступен'].join(' · ');rows.append(item);}
  }
  form.onsubmit=event=>{event.preventDefault();void load({operationId:form.elements.operationId.value.trim()});};
  const button=panel.querySelector('[data-support-export]');button.onclick=async()=>{button.disabled=true;try{const result=await electronAPI.exportOperationSupport();if(current())status.textContent=result?.ok?'Пакет диагностики сохранён.':result?.cancelled?'Сохранение отменено.':'Не удалось сохранить пакет диагностики.';}catch{if(current())status.textContent='Не удалось сохранить пакет диагностики.';}finally{if(current())button.disabled=false;}};void load();
}
function platformRenderHistory(){
  const readable=platformSessionContext().readable||PlatformSchema.sections;
  if(!window.electronAPI?.queryHistory||!(_sync.platform?.schemaVersion>=4)||!readable.includes('*')&&!readable.includes('auditLog'))return;
  const workspace=document.querySelector('.platform-workspace');if(!workspace)return;
  document.getElementById('platformHistory')?.remove();
  const panel=document.createElement('section');panel.id='platformHistory';
  panel.innerHTML='<h3>История изменений</h3><p class="platform-note">Текущие и архивные события показаны вместе. Подтверждения команд сохраняются после архивации.</p><form class="platform-filters"><label>Раздел<select name="section"><option value="">Все доступные разделы</option></select></label><label>Поиск<input name="search" maxlength="200" placeholder="По доступным событиям"></label><button class="btn btn-ghost" type="submit">Показать</button></form><p role="status"></p><div class="platform-page-rows"></div><div class="platform-actions"><button type="button" class="btn btn-ghost" data-history="previous">Назад</button><button type="button" class="btn btn-ghost" data-history="next">Далее</button></div>';
  const form=panel.querySelector('form'),status=panel.querySelector('[role=status]'),host=panel.querySelector('.platform-page-rows'),previous=panel.querySelector('[data-history=previous]'),next=panel.querySelector('[data-history=next]');
  for(const name of PlatformSchema.sections){if(!readable.includes('*')&&!readable.includes(name))continue;const option=document.createElement('option');option.value=name;option.textContent=platformSectionLabel(name);form.elements.section.append(option);}
  workspace.append(panel);let page=0,cursors=[null],nextCursor=null,sequence=0,query={};const stamp=syncSessionStamp();
  async function load(){
    const request=++sequence;previous.disabled=true;next.disabled=true;host.replaceChildren();status.textContent='Загружаю историю…';let result;
    try{result=await window.electronAPI.queryHistory({query,limit:25,...(cursors[page]?{cursor:cursors[page]}:{})});}catch{result={ok:false,error:'Не удалось загрузить историю. Повторите выборку.'};}
    if(request!==sequence||stamp!==syncSessionStamp()||!panel.isConnected)return;
    if(!result?.ok||!Array.isArray(result.rows)){status.textContent=result?.error||'История недоступна';previous.disabled=page===0;return;}
    nextCursor=result.nextCursor;previous.disabled=page===0;next.disabled=!nextCursor;status.textContent='Страница '+(page+1)+' · событий '+result.rows.length;
    for(const row of result.rows){
      const article=document.createElement('article'),title=document.createElement('strong'),description=document.createElement('p');article.className='platform-issue';
      title.textContent=platformSectionLabel(row.section)+' · '+(({create:'Добавлено',update:'Изменено',delete:'Удалено',transaction:'Подтверждено'})[row.action]||row.action||'Событие');
      description.textContent=[row.at,row.actor,Array.isArray(row.fields)&&row.fields.length?'Поля: '+row.fields.join(', '):''].filter(Boolean).join(' · ');article.append(title,description);
      if(row.before||row.after){const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('pre');summary.textContent='Данные события';details.append(summary,body);details.addEventListener('toggle',()=>{if(details.open&&!body.textContent)body.textContent=JSON.stringify({before:row.before??null,after:row.after??null},null,2);});article.append(details);}
      const id=row.after?.id??row.before?.id;if(id!==undefined&&row.section!=='auditLog'){const button=document.createElement('button');button.type='button';button.className='btn btn-ghost btn-sm';button.textContent='Открыть раздел';button.onclick=()=>platformOpenSource(row.section,id);article.append(button);}
      host.append(article);
    }
  }
  form.onsubmit=event=>{event.preventDefault();query={...(form.elements.section.value?{section:form.elements.section.value}:{}),...(form.elements.search.value.trim()?{search:form.elements.search.value.trim()}: {})};page=0;cursors=[null];void load();};
  previous.onclick=()=>{if(page>0){page--;void load();}};next.onclick=()=>{if(nextCursor){cursors[++page]=nextCursor;void load();}};void load();
}
function platformRenderDataBrowser(){
  if(!window.electronAPI?.queryRows)return;
  const workspace=document.querySelector('.platform-workspace');if(!workspace)return;
  const readable=platformSessionContext().readable||PlatformSchema.sections;
  const sections=PlatformSchema.sections.filter(section=>section!=='auditLog'&&readable.includes(section));
  if(!sections.length)return;
  const panel=document.createElement('section');panel.id='platformDataBrowser';
  panel.innerHTML='<h3>Просмотр записей</h3><p class="platform-note">Загрузка по 25 записей. Для исправления откройте исходный раздел.</p><form class="platform-filters"><label>Раздел<select name="section">'+sections.map(section=>'<option value="'+htmlEsc(section)+'">'+htmlEsc(platformSectionLabel(section))+'</option>').join('')+'</select></label><label>Поиск<input name="search" type="search" maxlength="200" placeholder="Номер, название, примечание"></label><label>С даты<input type="date" name="from"></label><label>По дату<input type="date" name="to"></label><button class="btn btn-ghost" type="submit">Показать</button></form><p role="status"></p><div class="platform-page-rows"></div><div class="platform-actions"><button type="button" class="btn btn-ghost" data-page="previous">Назад</button><button type="button" class="btn btn-ghost" data-page="next">Далее</button></div>';
  workspace.append(panel);
  const form=panel.querySelector('form'),status=panel.querySelector('[role=status]'),rowsHost=panel.querySelector('.platform-page-rows');
  const previous=panel.querySelector('[data-page=previous]'),next=panel.querySelector('[data-page=next]');
  let selection=null,cursors=[null],page=0,nextCursor=null,sequence=0;
  const stamp=syncSessionStamp();
  async function load(){
    const request=++sequence;previous.disabled=true;next.disabled=true;rowsHost.replaceChildren();status.textContent='Загружаю записи…';
    let result;try{result=await window.electronAPI.queryRows({...selection,limit:25,...(cursors[page]?{cursor:cursors[page]}:{})});}
    catch{result={ok:false,error:'Не удалось загрузить записи. Повторите выборку.'};}
    if(request!==sequence||stamp!==syncSessionStamp()||!panel.isConnected)return;
    if(!result?.ok){status.textContent=result?.error||'Выборка недоступна';previous.disabled=page===0;return;}
    nextCursor=result.nextCursor;previous.disabled=page===0;next.disabled=!nextCursor;
    status.textContent='Страница '+(page+1)+' · записей '+result.rows.length+' из '+result.total;
    for(const row of result.rows){
      const article=document.createElement('article'),title=document.createElement('strong'),text=document.createElement('p'),button=document.createElement('button');
      const id=row.id??row.month??row.cardNum??'';
      title.textContent=String(row.plate||row.name||row.title||row.number||id||'Запись');
      text.textContent=[row.date||row.month, id!==''?'ID: '+JSON.stringify(id):'',row.status,row.assetRef].filter(value=>value!==undefined&&value!==null&&value!=='').map(String).join(' · ');
      button.type='button';button.className='btn btn-ghost btn-sm';button.textContent='Открыть раздел';button.onclick=()=>platformOpenSource(selection.section,id);
      article.className='platform-issue';article.append(title,text,button);rowsHost.append(article);
    }
  }
  function start(){
    selection={section:form.elements.section.value,...(form.elements.search.value.trim()?{search:form.elements.search.value.trim()}:{}),...(form.elements.from.value?{from:form.elements.from.value}:{}),...(form.elements.to.value?{to:form.elements.to.value}:{})};
    cursors=[null];page=0;nextCursor=null;void load();
  }
  function dateFields(){
    const dated=PlatformSchema.descriptors[form.elements.section.value]?.dates?.some(item=>item.field==='date'||item.field==='month');
    for(const field of ['from','to']){form.elements[field].disabled=!dated;if(!dated)form.elements[field].value='';}
  }
  form.elements.section.onchange=()=>{dateFields();start();};
  form.onsubmit=event=>{event.preventDefault();start();};
  previous.onclick=()=>{if(page>0){page--;void load();}};
  next.onclick=()=>{if(nextCursor){cursors[++page]=nextCursor;void load();}};
  dateFields();start();
}
async function platformRenderRecoveryPanel(){
  if(!window.electronAPI?.getPendingOperations)return;
  const workspace=document.querySelector('.platform-workspace');if(!workspace)return;
  document.getElementById('platformRecovery')?.remove();
  const panel=document.createElement('section');panel.id='platformRecovery';
  panel.innerHTML='<h3>Восстановление операций</h3><p role="status">Проверяю локальную очередь…</p>';workspace.append(panel);
  const stamp=syncSessionStamp();
  let result;try{result=await window.electronAPI.getPendingOperations();}catch{result={ok:false,error:'Не удалось прочитать очередь'};}
  if(stamp!==syncSessionStamp()||!panel.isConnected)return;
  if(!result?.ok){panel.innerHTML='<h3>Восстановление операций</h3><p role="status">'+htmlEsc(result?.error||'Очередь недоступна')+'</p>';return;}
  if(result.supported===false){panel.innerHTML='<h3>Восстановление операций</h3><p role="status">В этом подключении восстановление операций недоступно. Серверу нужна поддержка сохранённой очереди.</p>';return;}
  const rows=(result.operations||[]).filter(row=>row.status!=='committed');
  panel.innerHTML='<h3>Восстановление операций</h3><p class="platform-note">Здесь хранятся изменения, результат которых нужно проверить. Проверка не выполняет их повторно. Повторная отправка использует исходную операцию.</p>'+
    (rows.length?'<div class="platform-operation-list">'+rows.map(row=>'<article><div><strong>'+htmlEsc(({pending:'Ожидает проверки',unknown:'Результат не подтверждён',conflict:'Нужна сверка версий',rejected:'Сохранение отклонено'})[row.status]||'Требует проверки')+'</strong><span>'+htmlEsc((row.sections||[]).map(platformSectionLabel).join(', '))+'</span><small>'+htmlEsc(row.createdAt)+'</small></div><div class="platform-actions">'+
      '<button class="btn btn-ghost btn-sm" data-operation-check="'+htmlEsc(row.id)+'">Проверить результат</button><button class="btn btn-ghost btn-sm" data-operation-retry="'+htmlEsc(row.id)+'">Повторить отправку</button><button class="btn btn-ghost btn-sm" data-operation-discard="'+htmlEsc(row.id)+'">Убрать из очереди</button></div></article>').join('')+'</div>':'<p role="status">Ожидающих операций нет.</p>');
  for(const [attribute,action]of [['check','reconcileOperation'],['retry','retryOperation'],['discard','discardOperation']])for(const button of panel.querySelectorAll('[data-operation-'+attribute+']'))button.onclick=async()=>{
    if(stamp!==syncSessionStamp())return;
    if(action==='discardOperation'&&!await confirmAction('Убрать операцию из локальной очереди? Это не отменяет запись, которую сервер уже выполнил.'))return;
    if(stamp!==syncSessionStamp())return;
    button.disabled=true;
    try{
      const response=await window.electronAPI[action](button.getAttribute('data-operation-'+attribute));
      if(stamp!==syncSessionStamp())return;
      if(!response?.ok)showToast(response?.error||'Не удалось проверить операцию');
      else if(response.committed||response.operationReceipt){
        data=await loadData();rebuildIndex();if(activeSection==='system')renderPlatformSystem();
        showToast('Операция сохранена. Данные обновлены.');return;
      }else showToast(action==='discardOperation'?'Операция убрана из очереди':response.conflicts?'Нужна сверка изменений: исходные данные в базе не перезаписаны':'Сервер пока не подтвердил выполнение операции');
    }catch(error){if(stamp===syncSessionStamp())showToast(error.message||'Проверка не завершена');}
    if(stamp===syncSessionStamp())platformRenderRecoveryPanel();
  };
}
function platformBindSourceLinks(report) {
  document.querySelectorAll('[data-platform-source]').forEach(button => { button.onclick = () => platformOpenSource(button.dataset.platformSource,JSON.parse(button.dataset.platformId)); });
  const more=document.getElementById('platformMoreIssues');
  if (more) more.onclick = () => { platformIssueLimit+=40; document.getElementById('platformIssues').innerHTML=renderPlatformIssues(report); platformBindSourceLinks(report); };
}
async function platformExportDiagnostics() {
  let report;
  try{report=platformHealthSnapshot(dispatcherBackgroundNeeded()?await dispatcherHealthAsync():null);}
  catch(error){showToast(error.message);return;}
  const blob = new Blob([JSON.stringify(report,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url; link.download='Диагностика_программы_'+dispatcherLocalDate()+'.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
