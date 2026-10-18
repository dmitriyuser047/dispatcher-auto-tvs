// Profile-scoped drafts, shift entry, saved selections and Ctrl+K search.
// No preference or draft is written to a shared unscoped browser key.
const productivityMemory = new Map();
let productivityShift = null, productivityShiftSaving = false, productivityViews = [], productivitySearchResults = [], productivitySearchIndex = 0;
let productivityViewsScope = null;

async function productivityIdentity() {
  try {
    const response = await window.electronAPI?.getDataIdentity?.();
    const identity = typeof response === 'string' ? response : response?.identity;
    return typeof identity === 'string' && identity ? identity : null;
  } catch (_) { return null; }
}
function productivityKey(scope, name) { return 'dispatcher.productivity.v1.' + encodeURIComponent(scope) + '.' + name; }
function productivityRead(scope, name, fallback) {
  if (!scope) return productivityMemory.get(name) ?? fallback;
  try { const value = JSON.parse(localStorage.getItem(productivityKey(scope, name))); return value ?? fallback; } catch (_) { return fallback; }
}
function productivityWrite(scope, name, value) {
  if (!scope) { productivityMemory.set(name, value); return true; }
  try { localStorage.setItem(productivityKey(scope, name), JSON.stringify(value)); return true; }
  catch (_) { showToast('Черновик остаётся в окне: локальное хранилище недоступно'); return false; }
}
async function productivitySetPreference(name, value) {
  const scope = await productivityIdentity(), preferences = productivityRead(scope, 'preferences', {});
  productivityWrite(scope, 'preferences', { ...preferences, [name]: value });
}
async function productivityInitialize() {
  const scope = await productivityIdentity(), prefs = productivityRead(scope, 'preferences', {});
  for (const section of ['vehicles', 'generators']) fleetViewModes[section] = prefs['fleetView.' + section] === 'cards' ? 'cards' : 'table';
  productivityViews=[];productivityViewsScope=scope;productivityShift=null;
  for(const id of ['globalSearchModal','savedViewsModal','shiftEntryModal'])document.getElementById(id)?.classList.remove('open');
}
function productivityCanOpen(id) {
  if(_activeSaves||productivityShiftSaving){showToast('Дождитесь завершения сохранения');return false;}
  if([...document.querySelectorAll('.modal-overlay.open')].some(el=>el.id!==id)){
    showToast('Сначала завершите или закройте текущее окно. Введённые данные остаются в нём.');return false;
  }
  return true;
}
function productivityModal(id, title, body, footer, width = 1000) {
  let overlay = document.getElementById(id);
  if (!overlay) { overlay = document.createElement('div'); overlay.id = id; overlay.className = 'modal-overlay productivity-overlay'; document.body.appendChild(overlay); bindModalOverlay(overlay); }
  overlay.innerHTML = `<div class="modal productivity-modal" role="dialog" aria-modal="true" aria-labelledby="${id}Title" style="width:${width}px;max-width:calc(100vw - 32px)"><div class="modal-header"><h2 class="modal-title" id="${id}Title">${htmlEsc(title)}</h2><button type="button" class="icon-btn" aria-label="Закрыть" onclick="closeModal('${id}')">${workspaceIcon('plus').replace('svg ', 'svg style="transform:rotate(45deg)" ')}</button></div><div class="modal-body productivity-modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</div>`;
  openModal(id);
  requestAnimationFrame(()=>{const first=overlay.querySelector('.modal-body input:not([type=checkbox]),.modal-body select')||overlay.querySelector('.modal-header button');first?.focus();});
  return overlay;
}
function productivityText(value) { return String(value ?? '').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е'); }
function productivityMatch(query, values) {
  const text = productivityText(values.filter(v => v != null).join(' '));
  return productivityText(query).split(/\s+/).every(word => text.includes(word));
}
function productivitySearch(query) {
  const entries = [];
  const add = (section, id, title, subtitle, values) => { if (productivityMatch(query, [title, subtitle, ...values])) entries.push({ section, id: String(id), title, subtitle }); };
  (data.vehicles || []).forEach(v => add('vehicles', v.id, [v.plate, v.make, v.model].filter(Boolean).join(' · '), [v.driver, v.org, v.object].filter(Boolean).join(' · '), [v.vin,v.note]));
  (data.generators || []).forEach(g => add('generators', g.id, g.name || 'ДЭС', [g.serial,g.location].filter(Boolean).join(' · '), [g.responsible,g.note]));
  (data.payments || []).forEach(p => add('payments', p.id, p.invoiceNo || p.invoice || p.description || 'Платёж', [p.contragent,p.date,Number(p.sum || 0).toLocaleString('ru') + ' ₽'].filter(Boolean).join(' · '), [p.note,p.category,p.description]));
  (data.contragents || []).forEach(c => add('contragents', c.id, c.name || 'Контрагент', [c.inn,c.contact,c.phone].filter(Boolean).join(' · '), [c.note]));
  (data.savedReestrs || []).forEach(r => add('reestr', r.id || r.number, 'Реестр № ' + (r.number || r.id), [r.date,r.rowCount + ' строк'].filter(Boolean).join(' · '), [JSON.stringify(r.rows || [])]));
  (data.reestrRows || []).forEach((r, i) => add('reestr', 'row:' + i, r.invoiceNo || r.number || r.osn || 'Счёт · строка ' + (i + 1), [r.description,r.date,r.sum && r.sum + ' ₽'].filter(Boolean).join(' · '), [r.naz,r.contragent,r.obj,r.dog]));
  productivityViews.forEach(v => { if (productivityMatch(query,[v.name])) entries.push({ section:'view',id:v.id,title:v.name,subtitle:'Сохранённая выборка' }); });
  return entries.slice(0, 60);
}
async function openGlobalSearch() {
  if (!productivityCanOpen('globalSearchModal')) return;
  productivityViewsScope = await productivityIdentity();
  productivityViews = productivityValidViews(productivityRead(productivityViewsScope, 'views', []));
  productivityModal('globalSearchModal', 'Поиск по рабочей базе', `<label class="productivity-search-label" for="globalSearchInput">Транспорт, ДЭС, счета, контрагенты и выборки</label><input id="globalSearchInput" class="productivity-search-input" type="search" autocomplete="off" placeholder="Номер, название, водитель, ИНН или сумма" oninput="productivityRenderSearch(this.value)" aria-controls="globalSearchResults"><div id="globalSearchResults" class="productivity-search-results" role="listbox" aria-label="Результаты поиска"></div><p class="productivity-hint">↑ ↓ — выбор · Enter — открыть · Esc — закрыть</p>`, '', 740);
  productivityRenderSearch(''); document.getElementById('globalSearchInput').focus();
}
function productivityRenderSearch(query) {
  productivitySearchResults = productivitySearch(query); productivitySearchIndex = 0;
  const labels = {vehicles:'Транспорт',generators:'ДЭС',payments:'Платёж',contragents:'Контрагент',reestr:'Счёт / реестр',view:'Выборка'};
  document.getElementById('globalSearchResults').innerHTML = productivitySearchResults.length ? productivitySearchResults.map((r,i) => `<button type="button" role="option" aria-selected="${i === 0}" class="productivity-search-result ${i === 0 ? 'active' : ''}" data-search-index="${i}" onclick="productivityOpenSearchResult(${i})"><span><strong>${htmlEsc(r.title)}</strong><small>${htmlEsc(r.subtitle)}</small></span><span class="workspace-badge is-neutral">${labels[r.section]}</span></button>`).join('') : '<div class="fleet-empty"><strong>Ничего не найдено</strong><p>Попробуйте номер, название или ИНН.</p></div>';
}
async function productivityOpenSearchResult(index) {
  const result = productivitySearchResults[index]; if (!result) return;
  if (await productivityIdentity() !== productivityViewsScope) { showToast('База переключена. Откройте поиск заново'); return; }
  closeModal('globalSearchModal');
  if (result.section === 'view') return productivityApplyView(productivityViews.find(v => v.id === result.id));
  if (typeof workspaceFocusRecord === 'function') workspaceFocusRecord(result.section, result.id);
}

const productivityViewSections = ['vehicles','generators','fuelPurchases','finances','contragents'];
function productivityValidViews(value) { return Array.isArray(value) ? value.filter(v => v && typeof v.id === 'string' && typeof v.name === 'string' && productivityViewSections.includes(v.section) && v.context && typeof v.context === 'object').slice(0,40) : []; }
function productivityCaptureView() {
  const section = activeSection;
  if (section === 'vehicles') return {section,context:{search:vcSearchQuery,status:filterStatus,fuel:filterFuel,org:filterOrg,view:fleetViewModes.vehicles}};
  if (section === 'generators') return {section,context:{search:genSearchQuery,view:fleetViewModes.generators}};
  if (section === 'fuelPurchases') return {section,context:{month:fpMonth,org:gsmOrg,fuel:gsmFuel,search:fpSearch,view:fpView === 'vehicle' ? 'receipts' : fpView}};
  if (section === 'finances') return {section,context:{month:finMonth,category:finCategory,paid:finPaidFilter,view:finView}};
  if (section === 'contragents') return {section,context:{search:caSearchQuery}};
  return null;
}
async function openSavedViews() {
  if(!productivityCanOpen('savedViewsModal'))return;
  productivityViewsScope = await productivityIdentity(); productivityViews = productivityValidViews(productivityRead(productivityViewsScope,'views',[]));
  const current = productivityCaptureView();
  productivityModal('savedViewsModal','Сохранённые выборки',`${current ? '<div class="productivity-save-view"><label for="savedViewName">Название текущей выборки</label><input id="savedViewName" maxlength="70" placeholder="Например, дизельные ТС на объекте"><button type="button" class="btn btn-primary" onclick="productivitySaveView()">Сохранить текущую</button></div>' : '<p class="productivity-hint">Чтобы сохранить выборку, откройте транспорт, ДЭС, ГСМ, финансы или контрагентов и настройте фильтры.</p>'}<p class="productivity-hint">Выборки относятся к текущей базе. Они сохраняют поиск, фильтры, период и вид списка.</p><div id="savedViewsList"></div>`, '<button type="button" class="btn btn-ghost" onclick="closeModal(\'savedViewsModal\')">Закрыть</button>', 740);
  productivityRenderViews();
}
function productivityRenderViews() {
  const labels = {vehicles:'Транспорт',generators:'ДЭС',fuelPurchases:'ГСМ',finances:'Финансы',contragents:'Контрагенты'};
  document.getElementById('savedViewsList').innerHTML = productivityViews.length ? productivityViews.map(v => `<div class="productivity-saved-view"><button type="button" class="productivity-view-open" onclick="productivityApplySavedView(${htmlJs(v.id)})"><strong>${htmlEsc(v.name)}</strong><small>${labels[v.section]} · ${htmlEsc(productivityViewSummary(v))}</small></button><button type="button" class="btn btn-ghost btn-sm" aria-label="Удалить выборку ${htmlEsc(v.name)}" onclick="productivityDeleteView(${htmlJs(v.id)})">Удалить</button></div>`).join('') : '<div class="fleet-empty"><strong>Сохранённых выборок пока нет</strong><p>Настройте нужные фильтры и сохраните их с понятным названием.</p></div>';
}
function productivityViewSummary(view){
  const c=view.context,labels={diesel:'Дизель',gasoline:'Бензин',gas:'Газ',table:'Таблица',cards:'Карточки',paid:'Оплачено',unpaid:'Есть остаток',partial:'Частичная оплата',overdue:'Просрочено',mismatch:'Сумма отличается от заявки',analytics:'Аналитика',budget:'Бюджет',receipts:'Выписка',manual:'Ручной ввод',journal:'Журнал и остатки',writeoff:'Списание'};
  return [c.search&&'Поиск: '+c.search,c.status,c.org,c.fuel&&(labels[c.fuel]||c.fuel),c.category,c.paid&&(labels[c.paid]||c.paid),c.month&&(c.month==='all'?'Все периоды':c.month.slice(5)+'.'+c.month.slice(0,4)),c.view&&(labels[c.view]||'Дополнительный раздел')].filter(Boolean).join(' · ');
}
async function productivitySaveView() {
  const name = document.getElementById('savedViewName')?.value.trim(), view = productivityCaptureView();
  if (!name || !view) { showToast('Укажите название выборки'); return; }
  if (await productivityIdentity() !== productivityViewsScope) { showToast('База переключена. Откройте выборки заново'); return; }
  if (productivityViews.length >= 40) { showToast('Можно сохранить до 40 выборок'); return; }
  productivityViews.push({...view,id:newId('view'),name:name.slice(0,70)}); productivityWrite(productivityViewsScope,'views',productivityViews); productivityRenderViews(); document.getElementById('savedViewName').value=''; showToast('Выборка сохранена');
}
async function productivityDeleteView(id) {
  if (await productivityIdentity() !== productivityViewsScope) return;
  productivityViews = productivityViews.filter(v=>v.id!==id); productivityWrite(productivityViewsScope,'views',productivityViews); productivityRenderViews();
}
function productivityApplySavedView(id) { return productivityApplyView(productivityViews.find(v=>v.id===id)); }
async function productivityApplyView(view) {
  if (!productivityValidViews([view]).length || _activeSaves) return false;
  if([...document.querySelectorAll('.modal-overlay.open')].some(el=>!['savedViewsModal','globalSearchModal'].includes(el.id))){showToast('Закройте текущее окно перед применением выборки');return false;}
  if (productivityViewsScope !== null && await productivityIdentity() !== productivityViewsScope) { showToast('База переключена. Откройте выборки заново'); return false; }
  const c=view.context, text=v=>typeof v==='string'?v.slice(0,500):'', month=v=>v==='all'||/^\d{4}-\d{2}$/.test(v||'')?v:'all';
  if(view.section==='vehicles'){vcSearchQuery=text(c.search);filterStatus=text(c.status);filterFuel=['diesel','gasoline','gas'].includes(c.fuel)?c.fuel:'';filterOrg=text(c.org);fleetViewModes.vehicles=c.view==='cards'?'cards':'table';}
  if(view.section==='generators'){genSearchQuery=text(c.search);fleetViewModes.generators=c.view==='cards'?'cards':'table';}
  if(view.section==='fuelPurchases'){fpMonth=month(c.month);gsmOrg=text(c.org);gsmFuel=text(c.fuel);fpSearch=text(c.search);fpView=[...GSM_MAIN_VIEWS,...GSM_EXTRA_VIEWS].some(([v])=>v===c.view)?c.view:'receipts';}
  if(view.section==='finances'){finMonth=month(c.month);finCategory=text(c.category);finPaidFilter=['paid','unpaid','partial','overdue','mismatch'].includes(c.paid)?c.paid:'';finView=['table','analytics','budget'].includes(c.view)?c.view:'table';}
  if(view.section==='contragents')caSearchQuery=text(c.search);
  for(const id of ['savedViewsModal','globalSearchModal'])if(document.getElementById(id))closeModal(id);
  document.getElementById('mainContent').innerHTML=''; switchSection(view.section); showToast('Применена выборка «'+view.name+'»'); return true;
}

function productivityShiftFingerprint(db, id) {
  return JSON.stringify([(db.vehicles||[]).find(v=>v.id===id), (db.records||[]).filter(r=>r.vehicleId===id), (db.fuelPurchases||[]).filter(p=>p.vehicleId===id), db.fuelCards||[], db.fuelPeriods||[]]);
}
function productivityShiftRows(db,date) {
  return (db.vehicles||[]).map(v=>{
    const day=(db.records||[]).filter(r=>r.vehicleId===v.id&&r.date===date),old=day.length===1?day[0]:null;
    const previous=(db.records||[]).filter(r=>r.vehicleId===v.id&&r.date<date).sort((a,b)=>cmpDateDesc(a.date,b.date))[0];
    return {vehicleId:v.id,selected:false,baseId:old?.id||null,baseline:productivityShiftFingerprint(db,v.id),ambiguous:day.length>1,
      driver:old?.driver||v.driver||'',km:old?.km??'',odoStart:old?.odoStart??previous?.odoEnd??'',odoEnd:old?.odoEnd??'',fuelIssued:old?.fuelIssued??'',fuelCardNum:old?.fuelCardNum||'',fuelOrg:old?.fuelOrg||gsmVehicleOrgAt(v,date)||'',error:''};
  });
}
async function openShiftEntry(date) {
  if (!productivityCanOpen('shiftEntryModal')) return;
  const scope=await productivityIdentity(), stored=productivityRead(scope,'shiftDrafts',{});
  date=typeof date==='string'&&gsmValidDate(date)?date:stored.lastDate&&gsmValidDate(stored.lastDate)?stored.lastDate:todayIso();
  const draft=stored.dates?.[date];
  productivityShift={scope,date,rows:Array.isArray(draft?.rows)?draft.rows:productivityShiftRows(data,date),restored:!!draft};
  productivityRenderShift();
}
function productivityPersistShift() {
  if(!productivityShift)return;
  const s=productivityShift, stored=productivityRead(s.scope,'shiftDrafts',{}),dates={...(stored.dates||{}),[s.date]:{rows:s.rows,updatedAt:Date.now()}};
  Object.keys(dates).sort((a,b)=>(dates[b].updatedAt||0)-(dates[a].updatedAt||0)).slice(15).forEach(k=>delete dates[k]);
  productivityWrite(s.scope,'shiftDrafts',{lastDate:s.date,dates});
}
async function productivityShiftDate(date) { if(productivityShiftSaving)return;productivityPersistShift();await openShiftEntry(date); }
function productivityShiftRowHtml(row,index) {
  const v=(data.vehicles||[]).find(v=>v.id===row.vehicleId), field=(name,label,type='text')=>`<input ${type==='number'?'type="number" min="0" step="any"':'type="text"'} data-shift-row="${index}" data-field="${name}" aria-label="${htmlEsc(label+' '+(v?.plate||index+1))}" value="${htmlEsc(row[name])}" ${row.ambiguous?'disabled':''} oninput="productivityShiftInput(${index},'${name}',this.value)">`;
  const cards=(data.fuelCards||[]).filter(c=>c.number===row.fuelCardNum||gsmCardAt(data,c.number,productivityShift.date).org);
  return `<tr data-shift-index="${index}" class="${row.error?'shift-row-error':''}"><td><input type="checkbox" data-field="selected" aria-label="Включить ${htmlEsc(v?.plate||row.vehicleId)}" ${row.selected?'checked':''} ${row.ambiguous?'disabled':''} onchange="productivityShiftInput(${index},'selected',this.checked)"></td><td><strong>${htmlEsc(v?.plate||'ТС удалено')}</strong><small>${htmlEsc(v?.make||'')}${row.baseId?' · правка записи':''}</small>${row.ambiguous?'<small>Несколько записей за дату — откройте журнал</small>':''}<span class="shift-row-message" role="status">${htmlEsc(row.error||'')}</span></td><td>${field('driver','Водитель')}</td><td>${field('km','Пробег за день','number')}</td><td>${field('odoStart','Одометр начало','number')}</td><td>${field('odoEnd','Одометр конец','number')}</td><td>${field('fuelIssued','Выдано топлива','number')}</td><td><select data-shift-row="${index}" data-field="fuelCardNum" aria-label="Карта ${htmlEsc(v?.plate||index+1)}" onchange="productivityShiftInput(${index},'fuelCardNum',this.value)"><option value="">Без карты</option>${cards.map(c=>`<option value="${htmlEsc(c.number)}" ${row.fuelCardNum===c.number?'selected':''}>${htmlEsc(c.number)}</option>`).join('')}</select>${field('fuelOrg','Организация топлива')}</td><td><button type="button" class="btn btn-ghost btn-sm" onclick="productivityCopyPrevious(${index})" ${row.ambiguous?'disabled':''}>Повторить</button><button type="button" class="btn btn-ghost btn-sm" onclick="productivityRefreshShiftRow(${index})">Обновить</button></td></tr>`;
}
function productivityRenderShift() {
  const s=productivityShift;if(!s)return;
  productivityModal('shiftEntryModal','Ввод смены',`<div class="shift-toolbar"><label for="shiftDate">Дата смены<input id="shiftDate" type="date" value="${s.date}" onchange="productivityShiftDate(this.value)"></label><button type="button" class="btn btn-ghost" onclick="productivityCopyPrevious()">Повторить предыдущую смену</button><button type="button" class="btn btn-ghost" onclick="productivityClearShift()">Очистить черновик</button><span id="shiftDraftStatus" role="status">${s.restored?'Черновик восстановлен':'Изменения сохраняются в черновик'}${s.scope?'':' · только в этой сессии'}</span></div><p class="productivity-hint">Отметьте нужные ТС. Enter — следующая строка, Tab — следующая ячейка, Ctrl+Enter — сохранить. Повтор копирует водителя и пробег, продолжает одометр; заправки не копируются. Заправки из выписок редактируются в ГСМ.</p><div class="shift-table-scroll"><table class="workspace-table shift-table"><thead><tr><th><input type="checkbox" aria-label="Включить все ТС" onchange="productivityShiftSelectAll(this.checked)"></th><th>Транспорт</th><th>Водитель</th><th>Пробег, км</th><th>Одометр от</th><th>Одометр до</th><th>Выдано, л</th><th>Карта / организация</th><th>Действия</th></tr></thead><tbody>${s.rows.map(productivityShiftRowHtml).join('')}</tbody></table></div><p id="shiftEntryError" class="productivity-error" role="alert"></p>`, `<span class="productivity-hint" id="shiftSelectionCount">Отмечено: ${s.rows.filter(r=>r.selected).length}</span><button type="button" class="btn btn-ghost" onclick="closeModal('shiftEntryModal')">Закрыть</button><button type="button" id="shiftSaveButton" class="btn btn-primary" onclick="productivitySaveShift()">Сохранить смену</button>`, 1320);
}
function productivityShiftInput(index,field,value) {
  const row=productivityShift?.rows[index];if(!row||productivityShiftSaving)return;
  row[field]=value;row.error='';if(field!=='selected')row.selected=true;
  if(field==='fuelCardNum'&&value)row.fuelOrg=gsmCardAt(data,value,productivityShift.date).org||'';
  if((field==='km'||field==='odoStart')&&row.km!==''&&row.odoStart!=='') {row.odoEnd=String(Math.round((Number(row.odoStart)+Number(row.km))*1000)/1000);const end=document.querySelector(`[data-shift-row="${index}"][data-field="odoEnd"]`);if(end)end.value=row.odoEnd;}
  const tr=document.querySelector(`[data-shift-index="${index}"]`);if(tr){tr.classList.remove('shift-row-error');tr.querySelector('.shift-row-message').textContent='';tr.querySelector('[data-field="selected"]').checked=row.selected;const org=tr.querySelector('[data-field="fuelOrg"]');if(org)org.value=row.fuelOrg;}
  productivityPersistShift();document.getElementById('shiftSelectionCount').textContent='Отмечено: '+productivityShift.rows.filter(r=>r.selected).length;
}
function productivityShiftSelectAll(selected){productivityShift.rows.forEach(r=>{if(!r.ambiguous)r.selected=selected;});productivityPersistShift();productivityRenderShift();}
function productivityCopyPrevious(index) {
  if(!productivityShift||productivityShiftSaving)return;
  const s=productivityShift, previousDate=(data.records||[]).filter(r=>r.date<s.date).map(r=>r.date).sort().pop();
  const rows=index==null?s.rows:[s.rows[index]];let copied=0;
  rows.forEach(row=>{if(!row||row.ambiguous)return;const prev=(data.records||[]).filter(r=>r.vehicleId===row.vehicleId&&r.date<s.date&&(index!=null||r.date===previousDate)).sort((a,b)=>cmpDateDesc(a.date,b.date))[0];if(!prev)return;row.driver=prev.driver||(data.vehicles||[]).find(v=>v.id===row.vehicleId)?.driver||'';row.km=prev.km??'';row.odoStart=prev.odoEnd??row.odoStart;row.odoEnd=row.odoStart!==''&&row.km!==''?Number(row.odoStart)+Number(row.km):'';row.selected=true;copied++;});
  productivityPersistShift();productivityRenderShift();showToast(copied?'Скопировано строк: '+copied+'. Заправки сохранены без копирования.':'Предыдущая смена не найдена');
}
function productivityRefreshShiftRow(index){if(productivityShiftSaving)return;const fresh=productivityShiftRows(data,productivityShift.date).find(r=>r.vehicleId===productivityShift.rows[index]?.vehicleId);if(fresh){productivityShift.rows[index]=fresh;productivityPersistShift();productivityRenderShift();}}
function productivityClearShift(){if(productivityShiftSaving)return;productivityShift.rows=productivityShiftRows(data,productivityShift.date);productivityShift.restored=false;productivityPersistShift();productivityRenderShift();}
function productivityShiftPlan(db,state) {
  if(!gsmValidDate(state.date))throw Error('Укажите корректную дату смены');
  if((db.fuelPeriods||[]).some(p=>p.closed&&p.month===state.date.slice(0,7)))throw Error('Месяц закрыт. Откройте период в ГСМ перед изменением смены');
  const selected=state.rows.filter(r=>r.selected),ids=new Set();if(!selected.length)throw Error('Отметьте хотя бы одно ТС');
  const changes=selected.map(row=>{
    const v=(db.vehicles||[]).find(v=>v.id===row.vehicleId),fail=message=>{const error=Error((v?.plate||'ТС')+': '+message);error.vehicleId=row.vehicleId;throw error;};
    if(!v)fail('транспорт удалён');if(ids.has(v.id))fail('ТС повторяется в смене');ids.add(v.id);
    if(row.ambiguous)fail('несколько записей за дату — используйте журнал');
    if(productivityShiftFingerprint(db,v.id)!==row.baseline)fail('данные изменились. Обновите строку и сверьте значения');
    const old=row.baseId?(db.records||[]).find(r=>r.id===row.baseId):null;
    if(row.baseId&&!old)fail('исходная запись удалена');
    if(!old&&(db.records||[]).some(r=>r.vehicleId===v.id&&r.date===state.date))fail('уже существует запись за дату');
    const numeric=name=>{const value=String(row[name]??'').trim();if(!value)return null;const n=Number(value.replace(',','.'));if(!Number.isFinite(n)||n<0)fail('проверьте неотрицательные значения пробега, одометра и топлива');return n;};
    const km=numeric('km'),odoStart=numeric('odoStart'),odoEnd=numeric('odoEnd'),fuelIssued=numeric('fuelIssued');
    if(km==null)fail('укажите пробег, в том числе 0 для стоянки');
    if(odoStart!=null&&odoEnd!=null&&(odoEnd<odoStart||Math.abs(odoEnd-odoStart-km)>.11))fail('пробег не совпадает с разницей одометра');
    const card=String(row.fuelCardNum||'').trim(),owner=gsmCardAt(db,card,state.date),org=String(row.fuelOrg||'').trim();
    const fuelChanged=!old||Number(old.fuelIssued||0)!==Number(fuelIssued||0)||String(old.fuelCardNum||'')!==card||!!old.fuelOrg&&String(old.fuelOrg)!==org;
    const purchases=(db.fuelPurchases||[]).filter(p=>!p.deleted&&p.vehicleId===v.id&&p.date===state.date);
    if(purchases.length&&fuelChanged&&(Number(fuelIssued||0)>0||Number(old?.fuelIssued||0)>0))fail('заправка связана с выпиской. Меняйте топливо в разделе ГСМ');
    if(Number(fuelIssued)>0&&fuelChanged){
      if(!org||org===GSM_UNKNOWN_ORG)fail('укажите организацию топлива');
      if(card&&(!owner.org||gsmOrgKey(owner.org)!==gsmOrgKey(org)))fail('карта не принадлежит организации на дату смены');
      const problem=typeof gsmManualRecipientError==='function'?gsmManualRecipientError(db,v.id,card,state.date,vehicleFuelGrade(v)):'';if(problem)fail(problem);
    }
    const record={...(old||{}),id:old?.id||newId('r_shift'),vehicleId:v.id,date:state.date,driver:String(row.driver||'').trim()||null,km,odoStart,odoEnd,fuelIssued,fuelCardNum:card||null,fuelOrg:org,fuelProvider:card?owner.provider:'',fuelGrade:old?.fuelGrade||vehicleFuelGrade(v),fuelUsed:old&&old.km===km?old.fuelUsed:(v.norm?Math.round(v.norm*km/100*10)/10:null)};
    return record;
  });
  const next=JSON.parse(JSON.stringify(db));next.records=next.records||[];changes.forEach(r=>{const index=next.records.findIndex(old=>old.id===r.id);if(index<0)next.records.push(r);else next.records[index]=r;});return {next,count:changes.length};
}
async function productivitySaveShift() {
  if(productivityShiftSaving||_activeSaves||!productivityShift)return false;
  productivityShiftSaving=true;const button=document.getElementById('shiftSaveButton');if(button)button.disabled=true;
  try{
    const state=productivityShift;if(await productivityIdentity()!==state.scope)throw Error('База переключена. Откройте ввод смены заново');
    const plan=productivityShiftPlan(data,state),before=JSON.stringify(data);data=plan.next;rebuildIndex();
    let saved=false;try{saved=await saveData(data,{noMerge:true,history:{action:'Ввод смены'}});}catch(error){data=JSON.parse(before);rebuildIndex();throw error;}
    if(!saved){data=JSON.parse(before);rebuildIndex();throw Error('Смена не сохранена. Черновик оставлен для повторной проверки');}
    const stored=productivityRead(state.scope,'shiftDrafts',{});if(stored.dates)delete stored.dates[state.date];productivityWrite(state.scope,'shiftDrafts',stored);
    productivityShift=null;closeModal('shiftEntryModal');if(typeof workspaceRefresh==='function')workspaceRefresh();if(activeSection==='vehicles'){document.getElementById('mainContent').innerHTML='';renderVehicleCards();}else if(activeSection==='home')renderMainMenu();showToast('Смена сохранена: '+plan.count+' ТС');return true;
  }catch(error){const el=document.getElementById('shiftEntryError');if(el)el.textContent=error.message;const index=productivityShift?.rows.findIndex(r=>r.vehicleId===error.vehicleId)??-1;if(index>=0){productivityShift.rows[index].error=error.message;const tr=document.querySelector(`[data-shift-index="${index}"]`);if(tr){tr.classList.add('shift-row-error');tr.querySelector('.shift-row-message').textContent=error.message;}}productivityPersistShift();return false;}
  finally{productivityShiftSaving=false;if(button)button.disabled=false;}
}
document.addEventListener('keydown',event=>{
  if(event.key==='Tab'){
    const overlay=[...document.querySelectorAll('.productivity-overlay.open')].pop();
    if(overlay){const controls=[...overlay.querySelectorAll('button,input,select,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  }
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!document.querySelector('.modal-overlay.open'))openGlobalSearch();else if(document.getElementById('globalSearchModal')?.classList.contains('open'))document.getElementById('globalSearchInput').focus();else showToast('Сначала завершите или закройте текущее окно. Введённые данные остаются в нём.');return;}
  if(document.getElementById('globalSearchModal')?.classList.contains('open')&&(event.target.id==='globalSearchInput'||event.target.closest('[data-search-index]'))&&['ArrowDown','ArrowUp','Enter'].includes(event.key)){
    if(event.key==='Enter'&&event.target.id!=='globalSearchInput')return;
    event.preventDefault();if(event.key==='Enter'){productivityOpenSearchResult(productivitySearchIndex);return;}const length=productivitySearchResults.length;if(!length)return;productivitySearchIndex=(productivitySearchIndex+(event.key==='ArrowDown'?1:-1)+length)%length;document.querySelectorAll('[data-search-index]').forEach((el,i)=>{el.classList.toggle('active',i===productivitySearchIndex);el.setAttribute('aria-selected',String(i===productivitySearchIndex));if(i===productivitySearchIndex)el.scrollIntoView({block:'nearest'});});return;
  }
  if(!document.getElementById('shiftEntryModal')?.classList.contains('open'))return;
  if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();productivitySaveShift();return;}
  if(event.key==='Enter'&&event.target.matches('[data-shift-row]')){event.preventDefault();const index=Number(event.target.dataset.shiftRow)+(event.shiftKey?-1:1);document.querySelector(`[data-shift-row="${index}"][data-field="${event.target.dataset.field}"]`)?.focus();}
});
