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

function platformHealthSnapshot() {
  const context = platformSessionContext();
  const inspected=PlatformIntegrity.inspect(data, { readable:context.readable, today:dispatcherLocalDate() });
  const issueFields=['code','severity','section','recordId','rowIndex','field','message','targetSection','targetId','relatedRecordId'];
  const integrity={ counts:{...inspected.counts}, sections:inspected.sections,
    issues:inspected.issues.map(issue => Object.fromEntries(issueFields.filter(field => issue[field] != null && ['string','number'].includes(typeof issue[field])).map(field => [field,issue[field]]))) };
  return { inspectedAt:new Date().toISOString(), schemaVersion:PlatformSchema.apiVersion,
    modules:PlatformSchema.describe(), integrity,
    runtime:platformRuntimeStatus(), calculations:dispatcherEngineStats(),
    storage:{ connected:!_loadWriteBlocked, sectionProtocol:!!_sync.enabled, operationProtocol:!!_sync.platform?.operations, role:context.actor?.role || 'local',
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
  const row = (data[section] || []).find(row => String(row.id ?? row.month ?? '') === String(id));
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
      (issue.section ? '<button type="button" class="btn btn-ghost btn-sm" data-platform-source="' + htmlEsc(issue.section) + '" data-platform-id="' + htmlEsc(issue.recordId || '') + '">Открыть раздел</button>' : '') + '</article>').join('') + '</div>' : '<div class="platform-empty">Замечаний по выбранному фильтру нет.</div>') +
    (issues.length > shown.length ? '<button type="button" class="btn btn-ghost" id="platformMoreIssues">Показать ещё</button>' : '');
}
function renderPlatformSystem() {
  const report = platformHealthSnapshot(), counts = report.integrity.counts || {}, allowed = new Set(report.storage.readable);
  const modules = Array.isArray(PlatformSchema.modules) ? PlatformSchema.modules : Object.values(PlatformSchema.modules);
  const history = report.runtime.recent || report.runtime.operations || [];
  document.getElementById('mainContent').innerHTML = '<div class="platform-workspace"><div class="platform-heading"><div><h2>Состояние программы</h2><p>Общие проверки данных и операций всех модулей.</p></div><div class="platform-actions"><button type="button" class="btn btn-ghost" id="platformExport">Выгрузить диагностику</button><button type="button" class="btn btn-primary" id="platformRefresh">Проверить заново</button></div></div>' +
    '<div class="platform-summary"><article><span>Хранилище</span><strong>' + (report.storage.connected ? report.storage.operationProtocol ? 'Подключено' : 'Совместимый режим' : 'Только просмотр') + '</strong><small>' + (report.storage.operationProtocol ? 'Подтверждение операций и проверка версий' : report.storage.sectionProtocol ? 'Проверка версий; сервер без протокола операций' : 'Доступность подтверждения зависит от подключения') + '</small></article><article><span>Модули</span><strong>' + modules.length + '</strong><small>Общий каталог и правила связей</small></article><article><span>Связи и значения</span><strong>' + (counts.error || 0) + '</strong><small>Ошибок данных для проверки · замечаний ' + (counts.warning || 0) + '</small></article></div>' +
    '<section><h3>Разделы программы</h3><div class="platform-modules">' + modules.map(module => {
      const sections = (module.sections || []).filter(section => allowed.has(section)), rows = sections.reduce((sum,section) => sum + (data[section]?.length || 0),0);
      const issues = report.integrity.issues.filter(issue => sections.includes(issue.section));
      return '<article><strong>' + htmlEsc(module.label || module.name || module.id) + '</strong><p>' + (sections.length ? rows + ' записей · ' + sections.length + ' разделов' : 'Нет доступа к данным') + '</p><small>' + (issues.length ? 'Замечаний: '+issues.length : sections.length ? 'Связи проверены' : 'Разделы скрыты правами доступа') + '</small></article>';
    }).join('') + '</div></section><section><h3>Проверка данных</h3><p class="platform-note">Открытие проверки не исправляет существующие данные. Сохранение запрещает новые повреждения и удаление записей, на которые ссылаются другие документы.</p><div class="platform-filters"><label>Раздел<select id="platformSection"><option value="">Все доступные разделы</option>' + PlatformSchema.sections.filter(section => allowed.has(section)).map(section => '<option value="' + htmlEsc(section) + '"' + (platformIssueFilter === section ? ' selected' : '') + '>' + htmlEsc(platformSectionLabel(section)) + '</option>').join('') + '</select></label><label>Уровень<select id="platformSeverity"><option value="">Все замечания</option><option value="error"' + (platformIssueSeverity === 'error' ? ' selected' : '') + '>Ошибки данных</option><option value="warning"' + (platformIssueSeverity === 'warning' ? ' selected' : '') + '>Предупреждения</option></select></label></div><div id="platformIssues">' + renderPlatformIssues(report) + '</div></section>' +
    '<section><h3>Последние операции этого сеанса</h3><p class="platform-note">Здесь виден результат сохранения. Подтверждённая история изменений хранится в базе.</p>' + (history.length ? '<div class="platform-operation-list">' + history.slice().reverse().slice(0,20).map(operation => '<article><div><strong>' + htmlEsc(({committed:'Сохранено',failed:'Не сохранено',unchanged:'Без изменений'})[operation.status] || 'Операция') + '</strong><span>' + htmlEsc((operation.changed || operation.sections || []).map(platformSectionLabel).join(', ')) + '</span></div><small>' + htmlEsc(operation.at || operation.completedAt || operation.id || '') + '</small></article>').join('') + '</div>' : '<div class="platform-empty">В этом сеансе сохранений ещё не было.</div>') + '</section></div>';
  document.getElementById('platformRefresh').onclick = renderPlatformSystem;
  document.getElementById('platformExport').onclick = platformExportDiagnostics;
  const refreshIssues = () => {
    document.getElementById('platformIssues').innerHTML = renderPlatformIssues(report); platformBindSourceLinks(report);
  };
  document.getElementById('platformSection').onchange = event => { platformIssueFilter=event.target.value; platformIssueLimit=40; refreshIssues(); };
  document.getElementById('platformSeverity').onchange = event => { platformIssueSeverity=event.target.value; platformIssueLimit=40; refreshIssues(); };
  platformBindSourceLinks(report);
  platformRenderRecoveryPanel();
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
  document.querySelectorAll('[data-platform-source]').forEach(button => { button.onclick = () => platformOpenSource(button.dataset.platformSource,button.dataset.platformId); });
  const more=document.getElementById('platformMoreIssues');
  if (more) more.onclick = () => { platformIssueLimit+=40; document.getElementById('platformIssues').innerHTML=renderPlatformIssues(report); platformBindSourceLinks(report); };
}
function platformExportDiagnostics() {
  const report = platformHealthSnapshot();
  const blob = new Blob([JSON.stringify(report,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url; link.download='Диагностика_программы_'+dispatcherLocalDate()+'.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
