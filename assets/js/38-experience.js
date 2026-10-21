// Начальный экран и общие визуальные действия, без изменения учётных данных.
function xpIcon(name,size=20){
  const paths={
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    car:'<path d="m3 15 2-7h14l2 7M3 15h18v4H3zM7 19v2m10-2v2M7 8l1-3h8l1 3M6 15h2m8 0h2"/>',
    power:'<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
    tank:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    fuel:'<path d="M4 21V4h10v17M3 21h12M7 7h4M14 10h2l3 3v5a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-12 4h.01M12 15h.01M16 15h.01"/>',
    tool:'<path d="M21 4a6 6 0 0 1-8 7L5 20a2 2 0 0 1-3-3l9-8a6 6 0 0 1 7-8l-4 4 3 3z"/>',
    document:'<path d="M14 2H5v20h14V7zM14 2v5h5M8 12h8m-8 4h8"/>',
    wallet:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-6 5h6M6 5V3h12"/>',
    people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-3-5"/>',
    chart:'<path d="M3 3v18h18M7 16v-5m5 5V7m5 9v-8"/>',
    print:'<path d="M6 8V3h12v5M6 17H3V9h18v8h-3M6 14h12v7H6zM17 11h1"/>',
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.grid}</svg>`;
}
const XP_MODULES={
  dispatch:{title:'Диспетчерская',note:'Смена, заявки и назначения',icon:'grid'},
  drivers:{title:'Водители',note:'Карточки, категории, документы и назначения',icon:'people'},
  operators:{title:'Операторы ДЭС',note:'Состав смен, допуски и работа на генераторах',icon:'people'},
  vehicles:{title:'Транспорт',note:'Автопарк и журналы работы',icon:'car',count:()=>data.vehicles.filter(v=>!v.archived).length+' ТС'},
  generators:{title:'Дизельные генераторы',note:'Наработка, расход и обслуживание',icon:'power',count:()=>(data.generators||[]).filter(v=>!v.archived).length+' ДЭС'},
  tanks:{title:'Топливные ёмкости',note:'Остатки и движения',icon:'tank',count:()=>(data.tanks||[]).filter(v=>!v.archived).length},
  toSchedule:{title:'Обслуживание',note:'Регламенты и график ТО',icon:'calendar'},
  repairs:{title:'Журнал ремонта',note:'Неисправности и затраты',icon:'tool',action:'openRepairsJournal()'},
  fuelPurchases:{title:'ГСМ и заправки',note:'Выписки, сверка и топливные карты',icon:'fuel'},
  fuelReport:{title:'Топливная аналитика',note:'Приход, расход и источники',icon:'chart'},
  finances:{title:'Финансы',note:'Расходы, оплаты и бюджет',icon:'wallet'},
  costs:{title:'Стоимость работы',note:'Учтённые расходы на километр и моточас',icon:'chart'},
  procurement:{title:'Планирование закупок',note:'Потребность, сроки и заказы поставщикам',icon:'tank'},
  reestr:{title:'Распознавание счетов',note:'Документы → проверка → реестр',icon:'document'},
  contragents:{title:'Контрагенты',note:'Реквизиты и история расчётов',icon:'people'},
  reports:{title:'Отчёты',note:'Итоги и план–факт',icon:'chart'},
  printForms:{title:'Печатные формы',note:'Путевые листы, акты и заявки',icon:'print'},
  pdf:{title:'PDF-редактор',note:'Страницы, поворот и объединение',icon:'document',action:'openPdfEditor()'},
  workflows:{title:'Рабочие процессы',note:'Задачи, ремонтные заказы и склад',icon:'grid'},
};
function xpModuleAction(id){return XP_MODULES[id]?.action||`switchSection(${htmlJs(id)})`;}
function xpRememberSection(section){
  document.body.dataset.section=section;
  if(!XP_MODULES[section])return;
  try{const recent=JSON.parse(localStorage.getItem('tvs-recent-sections')||'[]');localStorage.setItem('tvs-recent-sections',JSON.stringify([section,...recent.filter(s=>s!==section&&XP_MODULES[s])].slice(0,3)));}catch{}
}
function renderLaunchpad(){
  const today=new Date();let recent=[];
  const visible=id=>!['drivers','operators'].includes(id)||typeof _sync==='undefined'||!_sync.access||(_sync.access.readable||[]).includes('drivers');
  try{recent=JSON.parse(localStorage.getItem('tvs-recent-sections')||'[]').filter(s=>XP_MODULES[s]&&visible(s));}catch{}
  for(const id of ['vehicles','fuelPurchases','reestr'])if(!recent.includes(id))recent.push(id);
  const groups=[
    ['Техника и эксплуатация',['vehicles','generators','tanks','toSchedule','repairs']],
    ['Сотрудники',['drivers','operators']],
    ['Топливо и финансы',['fuelPurchases','fuelReport','finances','costs','contragents','reports']],
    ['Документы и процессы',['reestr','workflows','procurement','printForms','pdf']],
  ];
  const module=id=>{const item=XP_MODULES[id];return `<button type="button" class="xp-module" onclick="${xpModuleAction(id)}"><span class="xp-icon">${xpIcon(item.icon)}</span><span class="xp-module-copy"><b>${item.title}</b><small>${item.note}</small></span>${item.count?`<span class="xp-module-count">${htmlEsc(item.count())}</span>`:''}<span class="xp-module-arrow">›</span></button>`;};
  document.getElementById('mainContent').innerHTML=`<div class="xp-launchpad">
    <div class="xp-home-top"><div><div class="xp-eyebrow">Технрайз Велл Сервис / Автопарк</div><h2>Рабочее пространство</h2></div><span class="xp-home-date">${today.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}</span></div>
    <div class="xp-home-lead"><button type="button" class="xp-dispatch-entry" onclick="wfOpenTab('overview')"><div><div class="xp-eyebrow">Пульт диспетчера</div><h3>Вся смена.<br>В одном рабочем пространстве.</h3></div><span class="xp-entry-link">Открыть диспетчерскую ${xpIcon('arrow',18)}</span></button>
    <section class="xp-shortcuts"><h3>Быстрый доступ</h3>${recent.slice(0,3).map(id=>`<button type="button" class="xp-shortcut" onclick="${xpModuleAction(id)}"><span class="xp-icon">${xpIcon(XP_MODULES[id].icon,18)}</span>${XP_MODULES[id].title}<span style="margin-left:auto">↗</span></button>`).join('')}</section></div>
    <div class="xp-catalog">${groups.filter(([,ids])=>ids.some(visible)).map(([title,ids])=>`<section class="xp-catalog-group"><h3>${title}</h3><div class="xp-catalog-list">${ids.filter(visible).map(module).join('')}</div></section>`).join('')}</div>
    <div class="xp-home-footer"><span>ТВС · Техника, люди и документы</span><span><kbd>Ctrl K</kbd> — найти раздел, машину или документ</span></div>
  </div>`;
}
async function xpToggleFocus(){
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.getElementById('mainContent').requestFullscreen();}
  catch{showToast('Полноэкранный режим недоступен в этом окне');}
}
document.addEventListener('keydown',event=>{
  if(event.key==='F8'&&activeSection==='dispatch'&&!document.querySelector('.modal-overlay.open')){event.preventDefault();xpToggleFocus();}
});
