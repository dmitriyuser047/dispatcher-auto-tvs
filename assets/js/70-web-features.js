// Native ports for the shared registry, invoice and finance views.
(() => {
 if(window.tvsWeb?.active)return;
 const web=window.tvsWeb ||= {},loaded=new Set();let loading=null,routing=false,routeSearch='';
 web.params=()=>new URLSearchParams(routeSearch);
 const scripts=['assets/core/registry-import.js','assets/core/registry-counterparties.js','assets/core/registry-statistics.js','web/public/bdds.js','web/public/registries.js','web/public/finance-registry.js','web/public/registry-counterparties.js','web/public/driver-invoices.js','web/public/vehicle-invoices.js','web/public/logistics.js'];
 const styles=['web/public/registries.css','web/public/finance-registry.css','web/public/vehicle-invoices.css','assets/css/shared-web-features.css'];
 const routes={'/registries':'registries','/finance':'finances','/finance/counterparties':'contragents','/transport':'vehicles','/transport/journal':'vehicles','/transport/vehicle':'vehicles','/generators/card':'generators','/people/drivers':'drivers','/maintenance':'toSchedule','/repairs':'repairs','/documents/invoices':'reestr','/logistics':'logistics'};
 const readable=name=>{const values=typeof _sync==='undefined'?null:_sync.access?.readable;return !values||values.includes('*')||values.includes(name);};
 function load(src){return new Promise((resolve,reject)=>{if(loaded.has(src)){resolve();return;}const node=document.createElement('script');node.src=src;node.onload=()=>{loaded.add(src);resolve();};node.onerror=()=>{node.remove();reject(Error('Не удалось загрузить модуль '+src));};document.head.append(node);});}
 function ensure(){if(loading)return loading;loading=(async()=>{
  const objectProfile=typeof window.electronAPI?.getProductProfile==='function'&&(await window.electronAPI.getProductProfile()).kind==='des-object';
  for(const href of styles)if(!document.querySelector('link[data-shared-feature="'+href+'"]')){const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.dataset.sharedFeature=href;document.head.append(link);}
  for(const src of scripts)await load(src);
  if(window.reestrAPI?.loadStatyi&&!objectProfile){const articles=await window.reestrAPI.loadStatyi();if(!document.getElementById('tvs-bdds-articles')&&Array.isArray(articles)){const node=document.createElement('script');node.type='application/json';node.id='tvs-bdds-articles';node.textContent=JSON.stringify(articles);document.head.append(node);}}
 })().catch(error=>{loading=null;throw error;});return loading;}
 const main=()=>document.getElementById('mainContent');
 function failure(error){const host=main();if(!host)return;host.innerHTML='<div class="welcome"><h2>Не удалось открыть раздел</h2><p role="alert"></p><button type="button" class="btn btn-primary">Повторить</button></div>';host.querySelector('[role="alert"]').textContent=error.message;host.querySelector('button').onclick=()=>render(activeSection);}
 function canLeave(){return !web.registries?.canLeave||web.registries.canLeave();}
 const legacyFinance=renderFinancesSection;
 async function render(section){const database=data,identity=syncSessionStamp(),host=main();if(!host)return;host.innerHTML='<div class="welcome"><p role="status">Открываем раздел…</p></div>';
  try{await ensure();if(activeSection!==section||database!==data||identity!==syncSessionStamp())return;
   if(section==='registries'){if(!readable('savedReestrs'))throw Error('Нет доступа к реестрам.');web.registries.render();}
   else if(section==='logistics')web.logistics.render();
   else if(web.params().get('view')==='ledger'){legacyFinance();web.financeRegistry.mountLegacyTabs();}
   else web.financeRegistry.render();
  }catch(error){if(activeSection===section)failure(error);}
 }
 renderFinancesSection=function(){return render('finances');};
 const originalSwitch=switchSection;
 switchSection=function(section,...args){if(!routing&&activeSection==='registries'&&section!=='registries'&&!canLeave())return;if(!routing)routeSearch='';return originalSwitch.call(this,section,...args);};
 async function navigate(input){const url=new URL(input,'https://dispatcher.invalid'),section=routes[url.pathname];if(!section)return false;
  if(document.querySelector('.modal-overlay.open')){showToast('Завершите или закройте открытую форму.');return true;}if(!canLeave())return true;
  await ensure();routeSearch=url.search;if(section==='registries')web.registries.resetNavigation?.();routing=true;try{originalSwitch(section);}finally{routing=false;}
  if(section==='vehicles'&&url.pathname==='/transport/vehicle'){let id;try{id=JSON.parse(url.searchParams.get('asset'));}catch{return true;}selectVehicle(id);const view=url.searchParams.get('view');if(['journal','repairs','to'].includes(view))openVehicleJournal(view);}
  else if(section==='generators'){try{selectGenerator(JSON.parse(url.searchParams.get('asset')));}catch{}}
  else if(section==='drivers'&&url.searchParams.has('person')){try{personnelOpenPerson(JSON.parse(url.searchParams.get('person')));}catch{}}
  else if(section==='finances'&&url.searchParams.get('view')==='ledger'&&url.searchParams.get('mode')==='budget'){finView='budget';renderFinancesSection();}
  return true;
 }
 document.addEventListener('click',event=>{const link=event.target.closest?.('a[href]'),href=link?.getAttribute('href');if(event.defaultPrevented||!href?.startsWith('/')||href.startsWith('//')||!routes[new URL(href,'https://dispatcher.invalid').pathname]||link.hasAttribute('download'))return;event.preventDefault();event.stopImmediatePropagation();void navigate(href).catch(error=>showToast(error.message));},true);
 document.addEventListener('submit',event=>{const action=event.target.getAttribute?.('action');if(!['/registries','/finance'].includes(action))return;event.preventDefault();void navigate(action+'?'+new URLSearchParams(new FormData(event.target))).catch(error=>showToast(error.message));},true);
 const vehicleRender=renderDetail;renderDetail=function(vehicle,...args){const result=vehicleRender.call(this,vehicle,...args);void ensure().then(()=>{if(activeSection==='vehicles'&&selectedVehicleId===vehicle.id)web.vehicleInvoices.mount(vehicle.id);}).catch(()=>{});return result;};
 const generatorRender=renderGenDetail;renderGenDetail=function(generator,...args){const result=generatorRender.call(this,generator,...args);void ensure().then(()=>{if(activeSection==='generators'&&selectedGeneratorId===generator.id)web.vehicleInvoices.mountGenerator(generator.id);}).catch(()=>{});return result;};
 const personRender=personnelRenderDetail;personnelRenderDetail=function(person,...args){const result=personRender.call(this,person,...args);void ensure().then(()=>{if(activeSection==='drivers'&&personnelView('driver').selected===person.id)web.driverInvoices.mount(person.id);}).catch(()=>{});return result;};
 window.desktopWebFeatures={ensure,render,navigate};void ensure().catch(()=>{});
})();
