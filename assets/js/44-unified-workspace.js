// Shared application shell; workflows and accounting keep their existing models.
const UNIFIED_NAV = [
 ['Рабочий день', [['home','Главная','grid'],['dispatch','Диспетчерская','calendar'],['workflows','Рабочие процессы','tool']]],
 ['Сотрудники', [['drivers','Водители','people','personnelDrivers'],['driverTimesheets','Загрузка водителей','calendar'],['operators','Операторы ДЭС','people','personnelOperators'],['operatorTimesheets','Загрузка машинистов ДЭС','calendar']]],
 ['Техника и топливо', [['vehicles','Транспорт','car','vehicles'],['generators','Генераторы','power','generators'],['tanks','Ёмкости','tank'],['fuelPurchases','ГСМ и заправки','fuel'],['fuelReport','Топливная аналитика','chart'],['procurement','Закупки','tank'],['toSchedule','Обслуживание','calendar'],['generatorSpares','ЗИП ДЭС','tool']]],
 ['Документы и расчёты', [['assetInventory','Инвентаризация ОС','grid'],['reestr','Реестр счетов','document'],['finances','Финансы','wallet'],['costs','Стоимость работы','chart'],['contragents','Контрагенты','people'],['reports','Отчёты','chart'],['printForms','Печатные формы','print']]],
];
function unifiedMountNav() {
 if(document.getElementById('unifiedNav'))return;
 const nav=document.createElement('nav');nav.id='unifiedNav';nav.className='workspace-nav';nav.setAttribute('aria-label','Разделы программы');
 nav.innerHTML=`<div class="workspace-brand"><span class="unified-brand-mark">ТВС</span><span><strong>Диспетчер</strong><small>Управление автопарком</small></span></div><div class="workspace-nav-groups">${UNIFIED_NAV.map(([title,items])=>`<div class="workspace-nav-group-title">${title}</div>${items.map(([section,label,icon,count])=>`<button type="button" class="workspace-nav-link" data-section="${section}">${xpIcon(icon,17)}<span class="workspace-nav-label">${label}</span>${count?`<span class="workspace-nav-count" data-count="${count}">0</span>`:''}</button>`).join('')}`).join('')}</div><div class="workspace-nav-footer"><button type="button" class="workspace-nav-link" data-action="pdf">${xpIcon('document',17)}<span>PDF-студия</span></button><button type="button" class="workspace-nav-link" data-action="settings">${xpIcon('tool',17)}<span>Настройки и база</span></button><button type="button" class="workspace-nav-link" data-action="notifications">${xpIcon('calendar',17)}<span>Уведомления</span></button><button type="button" class="workspace-nav-link" data-section="system">${xpIcon('grid',17)}<span>Состояние программы</span></button><span class="unified-build-note">Диспетчер ТВС · 3.5.10</span></div>`;
 nav.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.action==='pdf'){void openPdfEditor();return;}if(button.dataset.action==='settings'){void openSettingsModal();return;}if(button.dataset.action==='notifications'){void openNotificationSettings();return;}if(button.dataset.section)unifiedNavigate(button.dataset.section);});
 document.body.prepend(nav);
 const brand=document.querySelector('body > header .logo');
 if(brand){brand.className='workspace-breadcrumb';brand.innerHTML='<strong id="unifiedSectionLabel">Главная</strong><span class="unified-build-label">Версия 3.5.10</span>';}
 unifiedRefreshNav();
}
function unifiedNavigate(section) {
 if(document.querySelector('.modal-overlay.open')){showToast('Завершите или закройте открытую форму. Введённые данные остаются в ней.');return;}
 switchSection(section);
}
function unifiedRefreshNav() {
 document.querySelectorAll('#unifiedNav [data-section]').forEach(button=>{const active=button.dataset.section===activeSection,wasActive=button.classList.contains('active'),required=['driverTimesheets','operatorTimesheets'].includes(button.dataset.section)?'assetDocuments':button.dataset.section==='costs'?'costEntries':['drivers','operators'].includes(button.dataset.section)?'drivers':null;button.hidden=!!required&&typeof _sync!=='undefined'&&!!_sync.access&&!(_sync.access.readable||[]).includes(required);button.classList.toggle('active',active);if(active&&!wasActive)button.scrollIntoView({block:'nearest',inline:'nearest'});if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 document.querySelectorAll('#unifiedNav [data-count]').forEach(label=>{const key=label.dataset.count;if(key==='personnelDrivers'||key==='personnelOperators'){label.textContent=typeof personnelRows==='function'?personnelRows(key==='personnelDrivers'?'driver':'operator').filter(row=>!row.archived).length:0;}else label.textContent=(data[key]||[]).filter(row=>!row.archived).length;});
 const label=document.getElementById('unifiedSectionLabel');if(label)label.textContent=UNIFIED_NAV.flatMap(([,items])=>items).find(([section])=>section===activeSection)?.[1]||(activeSection==='system'?'Состояние программы':'Диспетчер');
}
let unifiedPendingSaves=0;
const unifiedOriginalSave=saveData;
saveData=async function(...args){unifiedPendingSaves++;try{return await unifiedOriginalSave.apply(this,args);}finally{unifiedPendingSaves--;unifiedRefreshNav();}};
function unifiedSingleFlight(action){let pending=null;return function(...args){if(pending)return pending;if(unifiedPendingSaves){showToast('Дождитесь завершения сохранения');return Promise.resolve(false);}pending=Promise.resolve().then(()=>action.apply(this,args)).finally(()=>{pending=null;});return pending;};}
['saveRecord','saveVehicle','saveGenerator','saveGenRecord','saveTank','saveTankIncome','savePayment','saveContragent','saveRepair','saveVehicleTo','saveTankTransfer','addBudgetEntry','doRarMerge','doSvodkaImport','reestrSaveCurrent','reestrOpenSaved','reestrDeleteSaved','tssSaveRecord','saveToRecord','wfSave','wfArchive','wfReverseFuelMovement','wfRestoreDeleted'].forEach(name=>{if(typeof globalThis[name]==='function')globalThis[name]=unifiedSingleFlight(globalThis[name]);});
const unifiedOriginalClose=closeModal;
closeModal=function(...args){const conflict=args[0]==='wfModal'&&document.querySelector('#wfModal #syncConflictForm');if(unifiedPendingSaves&&!conflict){showToast('Дождитесь завершения сохранения');return;}return unifiedOriginalClose.apply(this,args);};
const unifiedOriginalSwitch=switchSection;
switchSection=function(section,options){if(unifiedPendingSaves){showToast('Дождитесь завершения сохранения');return;}unifiedOriginalSwitch(section,options);unifiedRefreshNav();};
const unifiedOriginalPalette=openCommandPalette;
openCommandPalette=function(){if([...document.querySelectorAll('.modal-overlay.open')].some(el=>el.id!=='commandPalette')){showToast('Сначала завершите открытую форму');return;}return unifiedOriginalPalette();};
const unifiedOriginalSettings=openSettingsModal;
openSettingsModal=function(){if([...document.querySelectorAll('.modal-overlay.open')].some(el=>el.id!=='settingsModal')){showToast('Сначала завершите открытую форму');return;}return unifiedOriginalSettings();};
toggleTheme=async function(){const next=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(next);try{localStorage.setItem('theme',next);}catch{}try{await window.electronAPI?.setTheme?.(next);}catch(error){showToast('Не удалось сохранить тему: '+error.message);}};
unifiedMountNav();
