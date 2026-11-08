'use strict';
(() => {
  const web = window.tvsWeb ||= {};
  const route = JSON.parse(document.querySelector('meta[name="tvs-route"]').content);
  const params = new URLSearchParams(location.search);
  const routes = {home:'/objects',generators:'/objects',vehicles:'/transport',dispatch:'/dispatch',logistics:'/logistics',registries:'/registries',workflows:'/workflows',toSchedule:'/maintenance',repairs:'/repairs',fuelPurchases:'/fuel',tanks:'/fuel/tanks',fuelReport:'/fuel/reports',generatorSpares:'/parts',drivers:'/people/drivers',operators:'/people/operators',driverTimesheets:'/people/drivers/timesheets',operatorTimesheets:'/people/operators/timesheets',assetInventory:'/inventory',objectQuantity:'/inventory/quantities',procurement:'/procurement',reestr:'/documents/invoices',printForms:'/documents/forms',finances:'/finance',costs:'/finance/costs',contragents:'/finance/counterparties',reports:'/reports',system:'/system'};
  const originalSwitch = switchSection;
  const originalRender = renderWorkspaceSection;
  const originalSelectVehicle = selectVehicle;
  const originalGeneratorDetail = openGeneratorDetail;
  const originalSelectGenerator = selectGenerator;
  const originalVehicleDetail = renderDetail;
  const originalSaveGenerator = saveGenerator;
  const originalSaveVehicle = saveVehicle;
  const originalWfEdit = wfEdit;
  const originalSelectTank = selectTank;
  const originalPersonnelOpen = personnelOpenPerson;
  const originalNewJob = dxJobNew;
  let starting = false;
  let pendingTarget = null, navigationQueued = false;
  const fmt = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU',{maximumFractionDigits:3}) : '—';
  const esc = htmlEsc;
  const typed = value => encodeURIComponent(JSON.stringify(value));
  const vehicleUrl = (id,view='') => '/transport/vehicle?asset='+typed(id)+(view?'&view='+encodeURIComponent(view):'');
  const generatorUrl = id => '/generators/card?asset='+typed(id);
  const selectedAsset = () => {try{return JSON.parse(params.get('asset'));}catch{return null;}};
  const objectName = row => String(row.location || row.object || '').trim() || 'Без объекта';
  const sorted = values => [...new Set(values)].sort((a,b)=>a.localeCompare(b,'ru'));
  const option = (value,label,selected) => `<option value="${esc(value)}"${String(selected)===String(value)?' selected':''}>${esc(label)}</option>`;
  const heading = (title,subtitle,actions='',context=true) => `<div class="tvs-page-heading"><div>${context?`<small>Компания / ${esc(route.title)}</small>`:''}<h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><div class="wf-actions">${actions}</div></div>`;
  const empty = (columns,label='Нет записей по выбранным условиям') => `<tr><td colspan="${columns}" class="empty-table">${esc(label)}</td></tr>`;
  const table = (heads,rows) => `<div class="tvs-table-wrap"><table class="tvs-data-table"><thead><tr>${heads.map(label=>`<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const canWrite = section => !_loadWriteBlocked && _sync.access?.writable?.includes(section) && _sync.platform?.negotiation?.writeCompatible === true;
  const button = (label,action,primary=false,allowed=true) => `<button type="button" class="btn ${primary?'btn-primary':'btn-ghost'}" data-web-action="${esc(action)}"${allowed?'':' disabled'}>${esc(label)}</button>`;
  const tabs = active => `<nav class="tvs-page-tabs" aria-label="Разделы транспорта"><a href="/transport"${active==='fleet'?' aria-current="page"':''}>Автопарк</a><a href="/transport/journal"${active==='mileage'?' aria-current="page"':''}>Журнал пробега</a></nav>`;
  const sectionLabel = () => ['fleet','mileage','vehicle'].includes(route.view)?'Транспорт':route.title;
  // Keep the domain buttons themselves: their handlers, disabled states and
  // epoch-bound references belong to the retained controllers, not this shell.
  function compactCardActions() {
    const main=document.getElementById('mainContent');
    if(!main||typeof MutationObserver!=='function')return;
    const closeMenus=except=>{
      main.querySelectorAll('.tvs-action-menu[open]').forEach(menu=>{if(menu!==except)menu.open=false;});
    };
    function menu(label,buttons) {
      if(!buttons.length)return null;
      const details=document.createElement('details');details.className='tvs-action-menu';
      const summary=document.createElement('summary');
      summary.setAttribute('aria-label',label==='Учёт'?'Учёт ГСМ и нормы':label==='Сервис'?'Обслуживание и допуски':label);
      summary.append(document.createTextNode(label));
      const chevron=document.createElement('span');chevron.setAttribute('aria-hidden','true');chevron.textContent='⌄';summary.append(chevron);
      const panel=document.createElement('div');panel.className='tvs-action-menu-panel';
      for(const button of buttons){
        if(button.classList.contains('btn-danger'))button.classList.add('tvs-action-danger');
        panel.append(button);
      }
      details.append(summary,panel);
      // Native summary retains Enter/Space and ordinary tab navigation. These
      // are disclosure panels, so they intentionally do not claim ARIA menus.
      details.addEventListener('toggle',()=>{if(details.open)closeMenus(details);});
      return details;
    }
    function arrange() {
      addDriverInvoices();
      if(route.section==='finances'&&params.get('view')==='ledger')web.financeRegistry?.mountLegacyTabs();
      if(route.view==='vehicle'&&selectedVehicleId!==null&&selectedVehicleId!==undefined)web.vehicleInvoices?.mount(selectedVehicleId);
      if(route.view==='generator'&&selectedGeneratorId!==null&&selectedGeneratorId!==undefined)web.vehicleInvoices?.mountGenerator(selectedGeneratorId);
      main.querySelectorAll('.vehicle-detail-header > .vdh-actions:not([data-compact-ready])').forEach(bar=>{
        const buttons=[...bar.children].filter(node=>node.tagName==='BUTTON');
        if(buttons.length<4)return;
        const groups={primary:[],history:[],accounting:[],maintenance:[],other:[]};
        for(const button of buttons){
          const command=button.getAttribute('onclick')||'';
          const key=/\bopenEdit(?:Vehicle|Generator)\(/.test(command)?'primary':
            /\bwfTimeline\(/.test(command)?'history':
            /\b(?:fuelAccountingOpen|fuelNormsOpen|seasonalFuelOpenReference)\(/.test(command)?'accounting':
            button.hasAttribute('data-gm-action')||/\bpersonnelRequirementsOpen\(/.test(command)?'maintenance':'other';
          groups[key].push(button);
        }
        bar.dataset.compactReady='true';bar.classList.add('tvs-card-actions');
        for(const button of [...groups.primary,...groups.history])bar.append(button);
        for(const[label,items]of [['Учёт',groups.accounting],['Сервис',groups.maintenance],['Ещё',groups.other]]){
          const disclosure=menu(label,items);if(disclosure)bar.append(disclosure);
        }
      });
    }
    let queued=false;
    new MutationObserver(()=>{
      if(queued)return;queued=true;
      queueMicrotask(()=>{queued=false;arrange();});
    }).observe(main,{childList:true,subtree:true});
    main.addEventListener('click',event=>{
      const panel=event.target.closest('.tvs-action-menu-panel');
      if(panel&&event.target.closest('button:not(:disabled)')){
        const owner=panel.closest('details');
        // Preserve the source button as the focus return point used by dialogs.
        // Collapsing its disclosure does not replace or synthesize the action.
        owner.open=false;
      }
    });
    document.addEventListener('click',event=>{
      const current=event.target.closest('.tvs-action-menu');closeMenus(current);
    });
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      const current=event.target.closest('.tvs-action-menu[open]');
      const open=current||main.querySelector('.tvs-action-menu[open]');
      if(open){closeMenus();open.querySelector('summary')?.focus();event.preventDefault();}
    });
    arrange();
  }
  compactCardActions();
  function mount(html) {
    const main = document.getElementById('mainContent');
    main.innerHTML = `<section class="tvs-page">${html}</section>`;
    document.getElementById('hdrVehicles').style.display = 'none';
    document.getElementById('hdrGenerators').style.display = 'none';
    document.querySelector('.sidebar').style.display = 'none';
    document.getElementById('unifiedSectionLabel').textContent = sectionLabel();
    const actions = {addVehicle:()=>openAddVehicle(),addGenerator:()=>openAddGenerator(),addMileage:openMileagePicker,exportFleet:()=>openExportPeriodModal('xls')};
    main.querySelectorAll('[data-web-action]').forEach(control => control.addEventListener('click',()=>actions[control.dataset.webAction]?.()));
  }
  function pageLinks(count,limit=50) {
    const pages = Math.ceil(count/limit);
    if (pages <= 1) return '';
    const page = Math.min(pages,Math.max(1,Number(params.get('page'))||1));
    const url = next => {const query = new URLSearchParams(params);query.set('page',String(next));return route.url+'?'+query;};
    return `<nav class="tvs-page-pagination" aria-label="Страницы записей">${page>1?`<a href="${esc(url(page-1))}">← Предыдущая</a>`:''}<span>Страница ${page} из ${pages}</span>${page<pages?`<a href="${esc(url(page+1))}">Следующая →</a>`:''}</nav>`;
  }
  function slicePage(rows,limit=50) {
    const page = Math.min(Math.max(1,Math.ceil(rows.length/limit)),Math.max(1,Number(params.get('page'))||1));
    return rows.slice((page-1)*limit,page*limit);
  }
  function renderObjects() {
    const all = (data.generators||[]).filter(row=>!row.archived);
    const names = sorted(all.map(objectName));
    const site = params.get('site') || '';
    const query = (params.get('q')||'').trim().toLocaleLowerCase('ru');
    const objects = names.filter(name=>(!site||site===name)&&(!query||name.toLocaleLowerCase('ru').includes(query)));
    const body = site ? renderObjectAssets(all.filter(row=>objectName(row)===site),site) : `<div class="tvs-object-grid">${objects.map(name=>{
      const assets = all.filter(row=>objectName(row)===name);
      const running = assets.filter(row=>row.status==='В работе').length;
      const lastDate = (data.genRecords||[]).filter(row=>assets.some(asset=>asset.id===row.generatorId)).map(row=>row.date).sort().at(-1);
      return `<a class="tvs-object-pane" href="/objects?site=${encodeURIComponent(name)}"><span class="tvs-object-kicker">Объект</span><h2>${esc(name)}</h2><div class="tvs-object-facts"><span><strong>${assets.length}</strong> ДЭС</span><span><strong>${running}</strong> в работе</span></div><small>Последняя запись: ${lastDate?esc(fmtDate(lastDate)):'нет данных'}</small><span class="tvs-object-link">Открыть объект →</span></a>`;
    }).join('') || '<p>Объекты появятся после добавления ДЭС с местом установки.</p>'}</div>`;
    mount(heading(site||'ДЭС','ДЭС, наработка и обслуживание по местам установки',button('Добавить ДЭС','addGenerator',true,canWrite('generators')))+`<form class="tvs-page-filters" action="/objects" method="get"><label>Объект<select name="site">${option('','Все объекты',site)}${names.map(name=>option(name,name,site)).join('')}</select></label><label>Поиск<input type="search" name="q" value="${esc(params.get('q')||'')}" placeholder="Название объекта"></label><button class="btn btn-ghost" type="submit">Показать</button>${site?'<a href="/objects">Все объекты</a>':'<a href="/generators">Список всех ДЭС</a>'}</form>`+body);
  }
  function renderObjectAssets(assets,site) {
    const rows = assets.map(asset=>{
      const records = (data.genRecords||[]).filter(row=>row.generatorId===asset.id).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      const last = records.at(-1);
      return `<tr><td><a href="${esc(generatorUrl(asset.id))}">${esc(asset.name||asset.serial||asset.id)}</a><small>${esc(asset.serial||'')}</small></td><td>${esc(asset.status||'Не указан')}</td><td class="tvs-num">${fmt(last?.meterEnd ?? (typeof asset.hoursInit==='number'?asset.hoursInit+records.reduce((sum,row)=>sum+(row.hours||0),0):null))}</td><td>${last?esc(fmtDate(last.date)):'—'}</td><td><a href="${esc(generatorUrl(asset.id))}">Карточка и журнал →</a></td></tr>`;
    }).join('');
    return table(['ДЭС / заводской номер','Состояние','Наработка, м/ч','Последняя запись',''],rows||empty(5,`На объекте «${site}» нет ДЭС`));
  }
  function renderFleet() {
    const site = params.get('site')||'', status=params.get('status')||'', query=(params.get('q')||'').toLocaleLowerCase('ru');
    const all = (data.vehicles||[]).filter(row=>!row.archived);
    const rows = all.filter(row=>(!site||row.object===site)&&(!status||row.status===status)&&(!query||[row.plate,row.make,row.model,row.driver,row.object].join(' ').toLocaleLowerCase('ru').includes(query)));
    const contents = slicePage(rows).map(row=>{
      const records = recsFor(row.id);
      const mileage = typeof row.odometer==='number'?row.odometer+records.reduce((sum,record)=>sum+(record.km||0),0):records.filter(record=>typeof record.odoEnd==='number').sort((a,b)=>String(a.date).localeCompare(String(b.date))).at(-1)?.odoEnd;
      return `<tr><td><a href="${esc(vehicleUrl(row.id))}">${esc(row.plate||'Без номера')}</a><small>${esc([row.make,row.model].filter(Boolean).join(' '))}</small></td><td>${esc(row.object||'—')}</td><td>${esc(row.driver||'—')}</td><td><span class="tvs-status">${esc(row.status||'Не указан')}</span></td><td class="tvs-num">${fmt(mileage)}</td></tr>`;
    }).join('');
    mount(heading('Транспорт','Весь автопарк компании · состояние и закрепление машин',button('Выгрузить сводку','exportFleet')+button('Добавить ТС','addVehicle',true,canWrite('vehicles')),false)+tabs('fleet')+`<form class="tvs-page-filters" method="get" action="/transport"><label>Поиск<input type="search" name="q" value="${esc(params.get('q')||'')}" placeholder="Номер, марка, водитель"></label><label>Объект<select name="site">${option('','Все объекты',site)}${sorted(all.map(row=>row.object).filter(Boolean)).map(value=>option(value,value,site)).join('')}</select></label><label>Состояние<select name="status">${option('','Все состояния',status)}${sorted(all.map(row=>row.status).filter(Boolean)).map(value=>option(value,value,status)).join('')}</select></label><button type="submit" class="btn btn-ghost">Показать</button></form>`+table(['Автомобиль','Объект','Водитель','Состояние','Пробег, км'],contents||empty(5))+`<div class="tvs-page-total">Машин: ${rows.length} из ${all.length}</div>`+pageLinks(rows.length));
  }
  function renderMileage() {
    const today = dispatcherLocalDate();
    const from=params.has('from')?params.get('from'):today.slice(0,7)+'-01', to=params.has('to')?params.get('to'):today;
    const car=params.get('car')||'', site=params.get('site')||'';
    const byId=new Map((data.vehicles||[]).map(asset=>[asset.id,asset]));
    const invalid = from && to && from>to;
    const rows=invalid?[]:(data.records||[]).filter(record=>(!from||record.date>=from)&&(!to||record.date<=to)&&(!car||JSON.stringify(record.vehicleId)===car)&&(!site||byId.get(record.vehicleId)?.object===site)).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.vehicleId).localeCompare(String(b.vehicleId)));
    const contents=slicePage(rows).map(record=>{
      const asset=byId.get(record.vehicleId);
      return `<tr><td><button type="button" class="tvs-text-button" data-web-record="${esc(JSON.stringify(record.id))}">${esc(fmtDate(record.date))}</button></td><td><a href="${esc(vehicleUrl(record.vehicleId,'journal'))}">${esc(asset?.plate||'ТС недоступно')}</a><small>${esc(asset?.make||'')}</small></td><td>${esc(record.driver||'—')}</td><td class="tvs-num">${fmt(record.odoStart)}</td><td class="tvs-num">${fmt(record.odoEnd)}</td><td class="tvs-num">${fmt(record.km)}</td></tr>`;
    }).join('');
    const known=rows.filter(record=>typeof record.km==='number'&&Number.isFinite(record.km));
    const total=known.reduce((sum,record)=>sum+record.km,0);
    mount(heading('Транспорт','Ежедневные записи пробега и итог за выбранный период',button('Добавить запись','addMileage',true,canWrite('records')),false)+tabs('mileage')+`<form class="tvs-page-filters" method="get" action="/transport/journal"><label>С даты<input type="date" name="from" value="${esc(from)}"></label><label>По дату<input type="date" name="to" value="${esc(to)}"></label><label>Автомобиль<select name="car">${option('','Все машины',car)}${(data.vehicles||[]).map(asset=>option(JSON.stringify(asset.id),[asset.plate,asset.make].filter(Boolean).join(' · '),car)).join('')}</select></label><label>Объект ТС<select name="site">${option('','Все объекты',site)}${sorted((data.vehicles||[]).map(asset=>asset.object).filter(Boolean)).map(value=>option(value,value,site)).join('')}</select></label><button type="submit" class="btn btn-ghost">Показать</button></form>${invalid?'<p role="alert">Начальная дата не может быть позже конечной.</p>':''}`+table(['Дата','Автомобиль','Водитель','Начало, км','Конец, км','За день, км'],contents||empty(6))+`<div class="tvs-page-total" aria-live="polite"><span>Записей: ${rows.length}</span><strong>Пробег по отобранным записям: ${fmt(total)} км</strong>${known.length!==rows.length?'<span>Есть записи без значения пробега</span>':''}</div>`+pageLinks(rows.length));
    document.querySelectorAll('[data-web-record]').forEach(control=>control.addEventListener('click',()=>{
      const id=JSON.parse(control.dataset.webRecord),record=data.records.find(row=>row.id===id);
      if(!record||!canWrite('records'))return;
      selectedVehicleId=record.vehicleId;
      openEditRecord(record.id);
    }));
  }
  function openMileagePicker() {
    const assets=(data.vehicles||[]).filter(row=>!row.archived);
    if(!assets.length){showToast('Сначала добавьте автомобиль');return;}
    wfShowDialog('Новая запись пробега',`<form id="webMileagePicker" class="wf-form"><label class="wf-wide"><span>Автомобиль</span><select name="asset" required>${assets.map((asset,index)=>option(index,[asset.plate,asset.make].filter(Boolean).join(' · '),0)).join('')}</select></label><div class="wf-actions wf-wide"><button type="button" class="btn btn-ghost" onclick="closeModal('wfModal')">Отмена</button><button type="submit" class="btn btn-primary">Открыть форму записи</button></div></form>`);
    document.getElementById('webMileagePicker').addEventListener('submit',event=>{
      event.preventDefault();
      selectedVehicleId=assets[Number(event.currentTarget.elements.asset.value)]?.id;
      closeModal('wfModal');
      openAddRecord();
    });
  }
  function renderSettings() {
    const roles={admin:'Администратор',dispatcher:'Диспетчер',mechanic:'Механик',accountant:'Бухгалтер',viewer:'Наблюдатель'};
    mount(heading('Настройки','Доступ и рабочее пространство')+`<div class="tvs-settings-pane"><h2>${esc(_sync.access?.user?.name||'Сотрудник')}</h2><p>Роль: ${esc(roles[_sync.access?.user?.role]||'—')}</p><p>База: общая серверная. Изменения проверяются по правам сотрудника и версиям записей.</p>${_sync.access?.user?.role==='admin'?'<p><a href="/settings/users">Сотрудники и доступ →</a></p>':''}<p>Резервные копии настраиваются администратором сервера.</p><a href="/system">Состояние базы и операций →</a></div>`);
  }
  function customRender() {
    if(route.section==='logistics'){web.logistics.render();return true;}
    if(route.section==='registries'){web.registries.render();return true;}
    if(route.section==='finances'&&params.get('view')!=='ledger'){web.financeRegistry.render();return true;}
    if(route.view==='objects'){renderObjects();return true;}
    if(route.view==='fleet'){renderFleet();return true;}
    if(route.view==='mileage'){renderMileage();return true;}
    if(route.view==='settings'){renderSettings();return true;}
    return false;
  }
  function addDriverInvoices(){
    if(route.section!=='drivers'||!params.has('person'))return;
    let id;try{id=JSON.parse(params.get('person'));}catch{return;}
    if((data.drivers||[]).some(person=>person.id===id))web.driverInvoices?.mount(id);
  }

  renderWorkspaceSection=function(section,options={}) {
    if(section===route.section&&customRender())return true;
    const result=originalRender(section,options);if(section==='finances'&&params.get('view')==='ledger')web.financeRegistry?.mountLegacyTabs();return result;
  };
  const navigate = target => {
    if(unifiedPendingSaves){showToast('Дождитесь завершения сохранения');return;}
    if(document.querySelector('.modal-overlay.open')){showToast('Завершите или закройте открытую форму');return;}
    // Legacy commands sometimes select a section and then a record in the same
    // click. Commit only the final document address, retaining the typed ID.
    pendingTarget = target;
    if(navigationQueued)return;
    navigationQueued=true;
    queueMicrotask(()=>{
      navigationQueued=false;
      const destination=pendingTarget;pendingTarget=null;
      if(!destination)return;
      if(unifiedPendingSaves||document.querySelector('.modal-overlay.open')){showToast('Завершите сохранение или закройте открытую форму');return;}
      location.assign(destination);
    });
  };
  switchSection=function(section,options={}) {
    const target=routes[section];
    if(!target){showToast('Адрес этого раздела ещё не настроен');return;}
    const query=new URLSearchParams();
    if(typeof activeSection!=='undefined'&&section===activeSection&&['dispatch','workflows'].includes(section)){
      options={query:typeof wfQuery==='string'?wfQuery:'',site:typeof wfSite==='string'?wfSite:'',org:typeof wfOrg==='string'?wfOrg:'',archive:typeof wfShowArchive==='boolean'?wfShowArchive:false,...options};
    }
    for(const[key,name]of Object.entries({workflowTab:'tab',query:'q',site:'site',org:'org'}))
      if(typeof options[key]==='string'&&options[key].length<=500)query.set(name,options[key]);
    if(typeof options.archive==='boolean')query.set('archive',options.archive?'1':'0');
    if(section==='dispatch'){
      if(typeof dxJobsView==='string')query.set('jobsView',dxJobsView);
      if(typeof dxJobsDate==='string'&&dxJobsDate)query.set('jobsDate',dxJobsDate);
      query.set('allDates',dxJobsAllDates?'1':'0');query.set('siteUnset',dxJobsSiteUnset?'1':'0');
    }
    if(section==='fuelPurchases'){
      if(typeof fpView==='string')query.set('fuelView',fpView);
      if(typeof fcSearch==='string'&&fcSearch)query.set('fuelSearch',fcSearch);
    }
    if(section==='contragents'&&typeof caSearchQuery==='string'&&caSearchQuery)query.set('q',caSearchQuery);
    navigate(target+(query.size?'?'+query:''));
  };
  selectVehicle=function(id){if(starting)return originalSelectVehicle(id);navigate(vehicleUrl(id));};
  openGeneratorDetail=function(id){if(starting){const result=originalGeneratorDetail(id);web.vehicleInvoices?.mountGenerator(id);return result;}navigate(generatorUrl(id));};
  selectGenerator=function(id){if(starting||route.view==='generator'&&id===selectedAsset())return originalSelectGenerator(id);navigate(generatorUrl(id));};
  selectTank=function(id){if(starting)return originalSelectTank(id);navigate('/fuel/tanks?asset='+typed(id));};
  personnelOpenPerson=function(id){
    if(starting)return originalPersonnelOpen(id);
    const person=personnelFind(id);if(!person){showToast('Сотрудник недоступен или запись удалена');return;}
    const roles=TvsPersonnelEngine.rolesOf(person),section=roles.includes(personnelKind())?personnelKind():roles.includes('driver')?'driver':'operator';
    navigate('/people/'+(section==='operator'?'operators':'drivers')+'?person='+typed(id));
  };
  wfEdit=function(section,id,preset){
    if(!starting&&pendingTarget){
      const destination=new URL(pendingTarget,location.origin);
      if(section==='dispatchJobs'&&id==null)destination.searchParams.set('newJob','1');
      else if(id!=null){destination.searchParams.set('editSection',section);destination.searchParams.set('edit',JSON.stringify(id));}
      else{showToast('Откройте создание записи в выбранном разделе');return;}
      pendingTarget=destination.pathname+destination.search;
      return;
    }
    return originalWfEdit(section,id,preset);
  };
  const originalJournal = openVehicleJournal;
  openVehicleJournal=function(view){if(starting)return originalJournal(view);if(selectedVehicleId!=null)navigate(vehicleUrl(selectedVehicleId,view));};
  renderDetail=function(asset){if(route.view==='mileage'){renderMileage();return;}if(route.view==='fleet'){renderFleet();return;}const result=originalVehicleDetail(asset);if(route.view==='vehicle')web.vehicleInvoices?.mount(asset.id);return result;};
  saveGenerator=async function(...args){const result=await originalSaveGenerator.apply(this,args);if(route.view==='objects'&&!document.getElementById('generatorModal').classList.contains('open'))renderObjects();return result;};
  saveVehicle=async function(...args){const result=await originalSaveVehicle.apply(this,args);if(route.view==='fleet'&&!document.getElementById('vehicleModal').classList.contains('open'))renderFleet();return result;};
  openSettingsModal=function(){navigate('/settings');};
  platformOpenSource=function(section,id){
    const readable=platformSessionContext().readable;
    if(readable&&!readable.includes('*')&&!readable.includes(section)){showToast('Раздел недоступен для вашей роли.');return;}
    const row=(data[section]||[]).find(row=>(row.id??row.month??'')===id);
    if(section==='savedReestrs'&&row?.kind==='payment-registry'&&row.registryVersion===1){navigate((row.workspace==='logistics'?'/logistics':'/registries')+'?register='+typed(id));return;}
    if(section==='vehicles'||section==='records'){const asset=section==='records'?row?.vehicleId:row?.id;navigate(asset!=null?vehicleUrl(asset,section==='records'?'journal':''):'/transport');return;}
    if(section==='generators'||section==='genRecords'){const asset=section==='genRecords'?row?.generatorId:row?.id;navigate(asset!=null?generatorUrl(asset):'/objects');return;}
    if(section==='tanks'||section==='tankIncomes'){const asset=section==='tankIncomes'?row?.tankId:row?.id;navigate('/fuel/tanks'+(asset!=null?'?asset='+typed(asset):''));return;}
    if(section==='drivers'){if(row)personnelOpenPerson(row.id);else switchSection('drivers');return;}
    if(['fuelPurchases','fuelCards','fuelPeriods','fuelWriteoffs','monthlyFuel','fuelImports'].includes(section)){navigate('/fuel?fuelView=diagnostics');return;}
    const sections={payments:'finances',budget:'finances',contragents:'contragents',costEntries:'costs',costProfiles:'costs',procurementOrders:'procurement',procurementRules:'procurement',reestrRows:'reestr',savedReestrs:'reestr'};
    if(sections[section]){switchSection(sections[section]);return;}
    if(Object.hasOwn(WF_FIELDS,section)){switchSection(wfSectionForTab(section),{workflowTab:section,query:'',site:'',org:'',archive:false});return;}
    switchSection('workflows');
  };
  web.startRoute=async()=>{
    starting=true;
    try {
      const options={};
      for(const[key,name]of Object.entries({workflowTab:'tab',query:'q',site:'site',org:'org'}))if(params.has(name))options[key]=params.get(name).slice(0,500);
      if(params.has('archive'))options.archive=params.get('archive')==='1';
      if(route.section==='dispatch'){
        if(['board','timeline'].includes(params.get('jobsView')))dxJobsView=params.get('jobsView');
        if(/^\d{4}-\d{2}-\d{2}$/.test(params.get('jobsDate')||''))dxJobsDate=params.get('jobsDate');
        dxJobsAllDates=params.get('allDates')==='1';dxJobsSiteUnset=params.get('siteUnset')==='1';
      }
      if(route.section==='fuelPurchases'){
        const views=['statement','operations','tanks','barrels','diagnostics','manual','receipts','journal','writeoff','unmatched','doubles','compare','negative','fcards','monthly','checks','measures','glonass','recon','close','history','cards'];
        if(views.includes(params.get('fuelView')))fpView=params.get('fuelView');
        if(params.has('fuelSearch'))fcSearch=params.get('fuelSearch').slice(0,500);
      }
      if(route.section==='contragents'&&params.has('q'))caSearchQuery=params.get('q').slice(0,500);
      if(route.section==='finances'&&params.get('view')==='ledger'&&params.get('mode')==='budget')finView='budget';
      originalSwitch(route.section,options);
      if(route.view==='vehicle'){
        const id=selectedAsset();
        if(!(data.vehicles||[]).some(asset=>asset.id===id)){mount(heading('Автомобиль недоступен','Запись удалена или закрыта вашими правами')+'<a href="/transport">Вернуться к сводке</a>');return;}
        originalSelectVehicle(id);
        if(['journal','to','repairs'].includes(params.get('view')))originalJournal(params.get('view'));
      }
      if(route.view==='generator'){
        const id=selectedAsset();
        if(!(data.generators||[]).some(asset=>asset.id===id)){mount(heading('ДЭС недоступна','Запись удалена или закрыта вашими правами')+'<a href="/objects">Вернуться в раздел ДЭС</a>');return;}
        originalGeneratorDetail(id);
        web.vehicleInvoices?.mountGenerator(id);
      }
      if(route.section==='tanks'&&params.has('asset'))await originalSelectTank(selectedAsset());
      if(['drivers','operators'].includes(route.section)&&params.has('person')){
        let id;try{id=JSON.parse(params.get('person'));}catch{}
        if((data.drivers||[]).some(row=>row.id===id))originalPersonnelOpen(id);
      }
      if(params.get('newJob')==='1'&&route.section==='dispatch')originalNewJob();
      if(params.has('edit')&&Object.hasOwn(WF_FIELDS,params.get('editSection'))){
        const section=params.get('editSection');let id;try{id=JSON.parse(params.get('edit'));}catch{}
        if(wfSectionForTab(section)===route.section&&(data[section]||[]).some(row=>row.id===id))originalWfEdit(section,id);
      }
      document.getElementById('unifiedSectionLabel').textContent=sectionLabel();
    } finally { starting=false; }
  };
  document.addEventListener('click',event=>{
    const anchor=event.target.closest('a[href]');
    if(anchor&&anchor.origin===location.origin&&(unifiedPendingSaves||document.querySelector('.modal-overlay.open'))){event.preventDefault();showToast('Завершите сохранение или закройте открытую форму');}
  });
  document.addEventListener('input',event=>{const modal=event.target.closest('.modal-overlay');if(modal)modal.dataset.webDirty='true';});
  window.addEventListener('beforeunload',event=>{
    if(unifiedPendingSaves||document.querySelector('.modal-overlay.open[data-web-dirty="true"]')){event.preventDefault();event.returnValue='';}
  });
  document.querySelector('[data-web-logout]')?.addEventListener('submit',async event=>{
    event.preventDefault();
    if(unifiedPendingSaves||document.querySelector('.modal-overlay.open')){showToast('Завершите сохранение или закройте открытую форму');return;}
    try{
      const response=await fetch('/web-api/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="tvs-csrf"]').content},body:'{}'});
      if(!response.ok)throw Error('Не удалось завершить сеанс');
      location.assign('/login');
    }catch(error){showToast(error.message);}
  });
})();
