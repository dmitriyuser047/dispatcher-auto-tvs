// Быстрый поиск по разделам и объектам приложения (Ctrl+K).
const CC_SECTIONS = [
  ['Диспетчерская · Обзор · Заявки · Назначения', 'dispatch'],
  ['Рабочие процессы · Задачи · Ремонт · Документы', 'workflows'],
  ['Транспорт', 'vehicles'], ['ДЭС', 'generators'], ['Ёмкости', 'tanks'],
  ['Водители · Сотрудники · Категории', 'drivers'], ['Операторы ДЭС · Сотрудники · Допуски', 'operators'],
  ['ГСМ · Заправки', 'fuelPurchases'], ['ГСМ · Отчёт по топливу', 'fuelReport'],
  ['Реестр', 'reestr'], ['График ТО', 'toSchedule'],
  ['Финансы', 'finances'], ['Контрагенты', 'contragents'], ['Отчёты', 'reports'],
  ['Стоимость работы · Расходы на километр · Моточас', 'costs'], ['Закупки · Топливо · Запчасти', 'procurement'],
  ['Печатные формы', 'printForms'],
];
let _ccItems = [], _ccIndex = 0;

function ccNorm(value) {
  return String(value ?? '').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
}

function ccBuildItems(query) {
  const q = ccNorm(query), items = [];
  CC_SECTIONS.forEach(([label, section]) => {if(['drivers','operators'].includes(section)&&typeof _sync!=='undefined'&&_sync.access&&!(_sync.access.readable||[]).includes('drivers'))return;items.push({ label, detail: 'Раздел', section, score: q && ccNorm(label).includes(q) ? 0 : 3 });});
  items.push({ label: 'Журнал ремонта', detail: 'Раздел', action: () => openRepairsJournal(), score: q && ccNorm('Журнал ремонта').includes(q) ? 0 : 3 });
  items.push({ label: 'Редактор PDF', detail: 'Документы', action: () => openPdfEditor(), score: q && ccNorm('Редактор PDF').includes(q) ? 0 : 3 });
  items.push({ label: 'Уведомления Windows', detail: 'Настройки напоминаний', action: () => openNotificationSettings(), score: q && ccNorm('Уведомления Windows напоминания').includes(q) ? 0 : 3 });
  const addRows = (rows, kind, section, fields, open) => (rows || []).forEach(row => {
    const label = fields.map(k => row[k]).filter(Boolean).join(' · ');
    const haystack = ccNorm([label, row.note, row.driver, row.object, row.location, row.serial, row.org].join(' '));
    if (!label || (q && !haystack.includes(q))) return;
    items.push({ label, detail: typeof kind==='function'?kind(row):kind, section, open: () => open(row), score: q && ccNorm(label).startsWith(q) ? 1 : 2 });
  });
  addRows(data.vehicles, 'Транспортное средство', 'vehicles', ['plate', 'make'], row => {
    switchSection('vehicles'); selectVehicle(row.id);
  });
  addRows(data.generators, 'Дизельный генератор', 'generators', ['name', 'location'], row => {
    switchSection('generators'); openGeneratorDetail(row.id);
  });
  addRows(data.tanks, 'Топливная ёмкость', 'tanks', ['name', 'object'], row => {
    switchSection('tanks'); selectTank(row.id);
  });
  addRows(data.contragents, 'Контрагент', 'contragents', ['name', 'fullName'], row => {
    caSearchQuery = row.name || row.fullName || ''; switchSection('contragents');
  });
  addRows(data.fuelCards, 'Топливная карта', 'fuelPurchases', ['number', 'provider', 'org'], row => {
    fpView = 'fcards'; fcSearch = row.number || row.provider || ''; switchSection('fuelPurchases');
  });
  if(typeof _sync==='undefined'||!_sync.access||(_sync.access.readable||[]).includes('drivers')){
    addRows(data.drivers,row=>[wfPersonnelMatches(row,'driver')?'Водитель':'',wfPersonnelMatches(row,'operator')?'Оператор ДЭС':''].filter(Boolean).join(' · ')||'Сотрудник','drivers',['name','phone','site'],row=>{if(typeof personnelOpenPerson==='function')personnelOpenPerson(row.id);else wfOpenTab('drivers');});
  }
  ['dispatchJobs','opsTasks','workOrders','assetDocuments','shiftReports'].forEach(section=>{
    const rows=typeof DocumentEngine!=='undefined'&&DocumentEngine.sections.includes(section)?DocumentEngine.activeRows(data,section):data[section];
    addRows(rows, typeof WF_TABS!=='undefined'?WF_TABS[section]:section, wfSectionForTab(section),['title','name','number'],row=>{wfOpenTab(section);wfEdit(section,row.id);});
  });
  addRows(typeof finPayments==='function'?finPayments():data.payments,'Платёж','finances',['contragent','purpose','description'],()=>switchSection('finances'));
  addRows(data.reestrRows,'Счёт / реестр','reestr',['supplier','number','invoice','contract'],()=>switchSection('reestr'));
  return items.filter(item => !q || item.score < 3).sort((a, b) => a.score - b.score || a.label.localeCompare(b.label, 'ru')).slice(0, 40);
}

function ccEnsurePalette() {
  let overlay = document.getElementById('commandPalette');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'commandPalette'; overlay.className = 'modal-overlay command-overlay';
  overlay.setAttribute('role', 'presentation');
  const dialog = document.createElement('div');
  dialog.className = 'command-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Поиск по программе');
  const input = document.createElement('input');
  input.id = 'commandSearch'; input.type = 'search'; input.autocomplete = 'off'; input.placeholder = 'Раздел, госномер, ДЭС, ёмкость…';
  input.setAttribute('aria-label', 'Поиск по разделам и объектам');
  const list = document.createElement('div'); list.id = 'commandResults'; list.className = 'command-results'; input.addEventListener('input', ccRender);
  dialog.append(input, list);
  const hint = document.createElement('div'); hint.className = 'command-hint'; hint.textContent = '↑ ↓ выбрать · Enter открыть · Esc закрыть'; dialog.append(hint);
  overlay.append(dialog);
  overlay.addEventListener('pointerdown', e => { overlay._backdropDown = e.target === overlay; });
  overlay.addEventListener('pointerup', e => { if (e.target !== overlay) overlay._backdropDown = false; });
  overlay.addEventListener('click', e => { if (overlay._backdropDown && e.target === overlay) closeCommandPalette(); overlay._backdropDown = false; });
  document.body.append(overlay);
  return overlay;
}

function ccRender() {
  const input = document.getElementById('commandSearch'), list = document.getElementById('commandResults');
  if (!input || !list) return;
  _ccItems = ccBuildItems(input.value); _ccIndex = 0;
  list.replaceChildren();
  if (!_ccItems.length) { const empty = document.createElement('div'); empty.className = 'command-empty'; empty.textContent = 'Ничего не найдено'; list.append(empty); return; }
  _ccItems.forEach((item, i) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'command-result';
    button.setAttribute('role', 'option'); button.setAttribute('aria-selected', i === _ccIndex ? 'true' : 'false');
    const label = document.createElement('span'); label.className = 'command-result-label'; label.textContent = item.label;
    const detail = document.createElement('span'); detail.className = 'command-result-kind'; detail.textContent = item.detail;
    button.append(label, detail); button.addEventListener('mouseenter', () => { _ccIndex = i; ccMarkActive(); });
    button.addEventListener('click', () => ccRun(i)); list.append(button);
  });
}

function ccMarkActive() {
  document.querySelectorAll('.command-result').forEach((el, i) => el.setAttribute('aria-selected', i === _ccIndex ? 'true' : 'false'));
}

function ccRun(index) {
  const item = _ccItems[index]; if (!item) return;
  closeCommandPalette();
  if (item.open) item.open(); else if (item.action) item.action(); else switchSection(item.section);
}

function openCommandPalette() {
  const overlay = ccEnsurePalette(); overlay.classList.add('open');
  const input = document.getElementById('commandSearch'); input.value = ''; ccRender(); input.focus();
}

function closeCommandPalette() {
  const overlay = document.getElementById('commandPalette'); if (overlay) overlay.classList.remove('open');
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommandPalette(); return; }
  const overlay = document.getElementById('commandPalette');
  if (!overlay?.classList.contains('open')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); }
  else if (e.key === 'ArrowDown' && _ccItems.length) { e.preventDefault(); _ccIndex = (_ccIndex + 1) % _ccItems.length; ccMarkActive(); document.querySelectorAll('.command-result')[_ccIndex]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'ArrowUp' && _ccItems.length) { e.preventDefault(); _ccIndex = (_ccIndex - 1 + _ccItems.length) % _ccItems.length; ccMarkActive(); document.querySelectorAll('.command-result')[_ccIndex]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') { e.preventDefault(); ccRun(_ccIndex); }
});
