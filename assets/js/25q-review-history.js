// Exact record navigation, review queues and server-backed change history.
const WORKSPACE_SECTION_NAMES={vehicles:'Транспорт',records:'Пробег',generators:'ДЭС',genRecords:'Наработка',vehicleTo:'ТО транспорта',toRecords:'ТО ДЭС',repairs:'Ремонты',payments:'Платежи',fuelPurchases:'Заправки',appMeta:'Настройки',reestrRows:'Счета',savedReestrs:'Реестры',contragents:'Контрагенты'};
const WORKSPACE_FIELD_NAMES={id:'Идентификатор',plate:'Госномер',make:'Марка',driver:'Водитель',org:'Организация',object:'Объект',date:'Дата',month:'Месяц',km:'Пробег, км',odoStart:'Одометр, начало',odoEnd:'Одометр, конец',fuelIssued:'Выдано топлива, л',fuelActual:'Фактический расход, л',fuelUsed:'Нормативный расход, л',fuelGrade:'Марка топлива',fuelOrg:'Источник топлива',fuelCardNum:'Топливная карта',qty:'Количество',sum:'Сумма, ₽',price:'Цена',paid:'Оплачен полностью',paidAmount:'Оплачено, ₽',settlements:'Проведённые оплаты',dueDate:'Срок оплаты',invoiceNo:'Номер счёта',description:'Описание',contragent:'Контрагент',note:'Примечание',comment:'Комментарий',category:'Статья затрат',cost:'Стоимость',planned:'Плановая работа',workStatus:'Состояние заявки',performer:'Исполнитель',serviceCenter:'Сервис',expectedReady:'Ожидаемая готовность',workDescription:'Работы',materials:'Материалы',downtimeStart:'Начало простоя',downtimeEnd:'Конец простоя',completedAt:'Завершено',paymentDueDate:'Срок оплаты',type:'Тип',name:'Название',hours:'Наработка, мтч',closed:'Период закрыт',sourceOrg:'Организация поступления',sourceSection:'Раздел заявки',sourceId:'Связанная запись',vehicleId:'Транспорт',generatorId:'ДЭС',recordId:'Запись журнала',status:'Состояние'};
let workspaceReview=null,workspaceHistory={items:[],next:null,identity:null,entry:null};
async function workspaceFocusRecord(section,id,context={}){
  if(_activeSaves){showToast('Дождитесь завершения сохранения');return false;}
  const generic=document.getElementById('genericModal');if(generic?.classList.contains('open'))closeModal('genericModal');
  let row;
  if(section==='vehicles'){row=data.vehicles.find(r=>r.id===id);if(!row)return false;switchSection('vehicles');selectVehicle(id);}
  else if(section==='generators'){row=data.generators.find(r=>r.id===id);if(!row)return false;switchSection('generators');openGeneratorDetail(id);}
  else if(section==='records'){row=data.records.find(r=>r.id===id);if(!row)return false;switchSection('vehicles');selectVehicle(row.vehicleId);selectedYear=+row.date?.slice(0,4);selectedMonth=+row.date?.slice(5,7);openEditRecord(id);}
  else if(section==='genRecords'){row=data.genRecords.find(r=>r.id===id);if(!row)return false;switchSection('generators');openGeneratorDetail(row.generatorId);openEditGenRecord(id);}
  else if(section==='fuelPurchases'){row=data.fuelPurchases.find(r=>r.id===id&&!r.deleted);if(!row)return false;fpMonth=row.date?.slice(0,7)||'all';fpView='receipts';gsmOrg='';switchSection('fuelPurchases');fpEdit(id);}
  else if(['vehicleTo','toRecords','repairs'].includes(section)){if(!(data[section]||[]).some(r=>r.id===id))return false;switchSection('toSchedule');if(typeof woOpen==='function')woOpen(section,id);else if(section==='repairs')openRepairsJournal();else tssEditRecord(id,section==='vehicleTo'?'vehicle':'generator');}
  else if(section==='payments'){if(!(data.payments||[]).some(r=>r.id===id))return false;finMonth='all';finCategory='';finPaidFilter='';switchSection('finances');await openEditPayment(id);}
  else if(section==='contragents'){if(!(data.contragents||[]).some(r=>r.id===id))return false;switchSection('contragents');openEditContragent(id);}
  else if(section==='reestr'){
    switchSection('reestr');
    if(String(id).startsWith('row:')){
      const index=Number(String(id).slice(4));row=(data.reestrRows||[])[index];if(!row)return false;
      document.getElementById('reestrReviewCard').style.display='';reestrRenderTable();
      const tr=document.querySelectorAll('#reestrReviewBody tr')[index];tr?.scrollIntoView({block:'center'});tr?.classList.add('workspace-highlight');tr?.querySelector('input')?.focus();
    }else{
      const index=(data.savedReestrs||[]).findIndex(r=>String(r.id||r.number)===String(id));row=data.savedReestrs[index];if(!row)return false;
      openGenericModal('Реестр №'+(row.number||''),'<p class="workspace-help">Сохранённый реестр · '+htmlEsc(row.date||'')+'</p><div class="table-wrap"><table><thead><tr><th>Документ</th><th>Получатель</th><th>Сумма</th></tr></thead><tbody>'+(row.rows||[]).map(r=>'<tr><td>'+htmlEsc(r.invoiceNo||r.osn||r.description||'—')+'</td><td>'+htmlEsc(r.contragent||r.recipient||'—')+'</td><td>'+workspaceNumber(r.sum,2)+' ₽</td></tr>').join('')+'</tbody></table></div><button class="btn btn-primary" onclick="workspaceEditSavedReestr('+index+')">Открыть для редактирования</button>',850);
    }
  }else return false;
  return true;
}
async function workspaceEditSavedReestr(index){
  if((data.reestrRows||[]).length&&!await confirmAction('Заменить текущий рабочий реестр сохранённым? Текущий реестр можно предварительно сохранить.',{label:'Открыть',danger:false}))return;
  closeModal('genericModal');await reestrOpenSaved(index);
}
function workspaceBuildIssues(kind,month=todayIso().slice(0,7)){
  if(kind==='fuel'){
    const range=gsmMonthRange(month);if(month===todayIso().slice(0,7))range.to=todayIso();const ledger=gsmBuildLedger(data,range);
    return ledger.errors.map(item=>({...item,key:[item.code,item.recordId,item.purchaseId,item.vehicleId,item.date,item.org,item.grade].join('|'),
      title:(data.vehicles.find(v=>v.id===item.vehicleId)?.plate||item.org||'ГСМ')+' · '+(item.date?fmtDate(item.date):'проверить дату'),message:item.message,
      section:item.purchaseId?'fuelPurchases':item.recordId?'records':item.vehicleId?'vehicles':null,id:item.purchaseId||item.recordId||item.vehicleId}));
  }
  if(kind==='payments')return(data.payments||[]).filter(p=>typeof woPaymentBalance==='function'?woPaymentBalance(p)>.009:!p.paid).map(p=>({key:p.id,title:p.invoiceNo||p.description||p.contragent||'Платёж',
    message:'Остаток '+workspaceNumber(typeof woPaymentBalance==='function'?woPaymentBalance(p):p.sum,2)+' ₽'+(p.dueDate?' · срок '+fmtDate(p.dueDate):''),section:'payments',id:p.id,date:p.dueDate||p.date}));
  const horizon=new Date();horizon.setDate(horizon.getDate()+7);const limit=todayIso(horizon);
  return ['vehicleTo','toRecords','repairs'].flatMap(section=>(data[section]||[]).filter(r=>(r.workStatus?r.workStatus!=='completed':r.planned)&& (r.expectedReady||r.date||r.invoiceDate||'')<=limit).map(r=>({key:section+'|'+r.id,title:(data.vehicles.find(v=>v.id===r.vehicleId)?.plate||data.generators.find(g=>g.id===r.generatorId)?.name||'Техника')+' · '+(r.type||r.description||'Обслуживание'),
    message:(r.expectedReady||r.date||r.invoiceDate?fmtDate(r.expectedReady||r.date||r.invoiceDate):'Срок не задан')+(r.performer?' · '+r.performer:''),section,id:r.id,date:r.expectedReady||r.date||r.invoiceDate}))).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
}
async function workspaceOpenIssues(kind,keep=false){
  if(_activeSaves)return;
  const identity=window.electronAPI?.getDataIdentity?await window.electronAPI.getDataIdentity():'browser';
  if(!keep||!workspaceReview||workspaceReview.identity!==identity)workspaceReview={kind,month:todayIso().slice(0,7),identity,visited:[],current:null};
  const items=workspaceBuildIssues(workspaceReview.kind,workspaceReview.month);workspaceReview.items=items;
  const names={fuel:'Проверка ГСМ',maintenance:'Ближайшие работы',payments:'Ожидают оплаты'};
  openGenericModal(names[workspaceReview.kind],'<div class="workspace-review-intro"><span class="workspace-badge">Осталось: '+items.length+'</span>'+(kind==='fuel'?'<label>Месяц <input type="month" value="'+workspaceReview.month+'" onchange="workspaceReview.month=this.value;workspaceReview.visited=[];workspaceOpenIssues(\'fuel\',true)"></label>':'')+'</div><div class="workspace-review-list" id="workspaceReviewList">'+(items.length?items.map((item,i)=>'<button class="workspace-review-item" onclick="workspaceReviewOpen('+i+')"><span><strong>'+htmlEsc(item.title)+'</strong><small>'+htmlEsc(item.message)+'</small></span>'+workspaceIcon('arrow-right')+'</button>').join(''):'<p class="workspace-help">Замечаний нет. Все операции этой очереди проверены.</p>')+'</div><div class="workspace-form-actions"><button class="btn btn-ghost" onclick="workspaceEndReview()">Завершить проверку</button></div>',850);
  workspaceRenderReviewBar();
}
async function workspaceReviewOpen(index){
  if(!workspaceReview)return;
  if(window.electronAPI?.getDataIdentity&&await window.electronAPI.getDataIdentity()!==workspaceReview.identity){workspaceEndReview();showToast('База переключена. Откройте проверку заново.');return;}
  const item=workspaceReview.items[index];if(!item)return;
  workspaceReview.current=item;workspaceReview.visited.push(item.key);closeModal('genericModal');
  if(!item.section||!await workspaceFocusRecord(item.section,item.id)){
    openGenericModal('Замечание', '<p>'+htmlEsc(item.message)+'</p><p class="workspace-help">Связанная запись отсутствует. Проверьте исходные документы и журнал.</p><button class="btn btn-ghost" onclick="workspaceOpenIssues(workspaceReview.kind,true)">К списку</button>',600);
  }
  workspaceRenderReviewBar();
}
function workspaceRenderReviewBar(){
  let el=document.getElementById('workspaceReviewBar');if(!el){el=document.createElement('div');el.id='workspaceReviewBar';el.className='workspace-review-bar';document.body.append(el);}
  el.hidden=!workspaceReview;if(!workspaceReview)return;
  el.innerHTML='<span><strong>Проверка записей</strong><small>'+htmlEsc(workspaceReview.current?.title||'Выберите замечание')+'</small></span><button class="btn btn-ghost btn-sm" onclick="workspaceOpenIssues(workspaceReview.kind,true)">К списку</button><button class="btn btn-primary btn-sm" onclick="workspaceReviewNext()">Следующее</button><button class="icon-btn" aria-label="Завершить проверку" onclick="workspaceEndReview()">×</button>';
}
async function workspaceReviewNext(){
  if(_activeSaves)return;const state=workspaceReview;if(!state)return;
  if(document.querySelector('.modal-overlay.open')){showToast('Сохраните или закройте текущую форму перед переходом');return;}
  state.items=workspaceBuildIssues(state.kind,state.month);
  const index=state.items.findIndex(item=>!state.visited.includes(item.key));
  if(index===-1){await workspaceOpenIssues(state.kind,true);return;}await workspaceReviewOpen(index);
}
function workspaceEndReview(){workspaceReview=null;workspaceRenderReviewBar();if(document.getElementById('workspaceReviewList'))closeModal('genericModal');}

async function openChangeHistory(before){
  if(_activeSaves)return;
  if(!window.electronAPI?.readHistory){showToast('История доступна в установленном приложении');return;}
  if(!before&&document.querySelector('.modal-overlay.open')){showToast('Сохраните или закройте текущую форму');return;}
  try{
    const response=await window.electronAPI.readHistory({before,identity:before?workspaceHistory.identity:undefined,databaseToken:before?workspaceHistory.databaseToken:undefined});
    if(before&&workspaceHistory.databaseToken&&response.databaseToken!==workspaceHistory.databaseToken)throw new Error('База сервера переключена. Закройте и откройте историю заново.');
    if(!before)workspaceHistory.items=[];
    workspaceHistory={...workspaceHistory,...response,items:[...workspaceHistory.items,...response.items],entry:null};
    workspaceHistoryList();
  }catch(error){showToast('Не прочитана история: '+error.message);}
}
function workspaceHistoryList(){
  openGenericModal('История изменений','<p class="workspace-help">Показан профиль, с которого выполнено сохранение. Восстановление проверяет последующие правки, связи и закрытые месяцы.</p><div class="workspace-history-list">'+(workspaceHistory.items.length?workspaceHistory.items.map((event,index)=>'<button class="workspace-review-item" onclick="workspaceHistoryDetail('+index+')"><span><strong>'+htmlEsc(event.action)+'</strong><small>'+htmlEsc(new Date(event.at).toLocaleString('ru-RU'))+' · '+htmlEsc(event.actor)+' · '+event.count+' изм.</small><small>'+htmlEsc(event.sections.map(n=>WORKSPACE_SECTION_NAMES[n]||n).join(', '))+'</small></span>'+workspaceIcon('arrow-right')+'</button>').join(''):'<p>История появится после первого сохранения в этой версии.</p>')+'</div>'+(workspaceHistory.next?'<button class="btn btn-ghost" onclick="openChangeHistory('+htmlJs(workspaceHistory.next)+')">Загрузить ещё</button>':''),900);
}
async function workspaceHistoryDetail(index){
  try{
    const item=workspaceHistory.items[index],event=await window.electronAPI.readHistoryEntry({id:item.id,identity:workspaceHistory.identity,databaseToken:workspaceHistory.databaseToken});
    if(workspaceHistory.databaseToken&&event.databaseToken!==workspaceHistory.databaseToken)throw new Error('База сервера переключена. Откройте историю заново.');
    workspaceHistory.entry=event;workspaceHistory.entryPage=0;workspaceHistoryRenderDetail();
  }catch(error){showToast(error.message);}
}
function workspaceHistoryPage(delta){
  if(!workspaceHistory.entry)return;
  workspaceHistory.entryPage=Math.min(Math.ceil(workspaceHistory.entry.changes.length/25)-1,Math.max(0,workspaceHistory.entryPage+delta));workspaceHistoryRenderDetail();
}
function workspaceHistoryRenderDetail(){
    const event=workspaceHistory.entry,page=workspaceHistory.entryPage||0,pages=Math.ceil(event.changes.length/25);
    const value=v=>v===undefined?'—':typeof v==='object'?JSON.stringify(v):String(v);
    const rows=event.changes.slice(page*25,(page+1)*25).map(change=>{
      const fields=change.key===null?['Весь раздел']:[...new Set([...Object.keys(change.before||{}),...Object.keys(change.after||{})])].filter(f=>!(change.section==='appMeta'&&['changes','references','dependencies','referencesBefore','naturalState'].includes(f))&&JSON.stringify(change.before?.[f])!==JSON.stringify(change.after?.[f]));
      const record=change.after||change.before;
      return '<section class="workspace-history-change"><h3>'+htmlEsc(WORKSPACE_SECTION_NAMES[change.section]||change.section)+' · '+htmlEsc(change.key===null?'Порядок и состав записей':record?.plate||record?.name||record?.description||record?.date||'Запись')+'</h3><div class="table-wrap"><table><thead><tr><th>Поле</th><th>До</th><th>После</th></tr></thead><tbody>'+fields.map(field=>'<tr><td>'+htmlEsc(WORKSPACE_FIELD_NAMES[field]||field)+'</td><td>'+htmlEsc(value(change.key===null?change.before:change.before?.[field]))+'</td><td>'+htmlEsc(value(change.key===null?change.after:change.after?.[field]))+'</td></tr>').join('')+'</tbody></table></div></section>';
    }).join('');
    const pager=pages>1?'<div class="workspace-form-actions"><span class="workspace-help">Изменений: '+event.changes.length+' · страница '+(page+1)+' из '+pages+'</span><button class="btn btn-ghost" '+(page?'':'disabled')+' onclick="workspaceHistoryPage(-1)">Предыдущие</button><button class="btn btn-ghost" '+(page+1<pages?'':'disabled')+' onclick="workspaceHistoryPage(1)">Следующие</button></div>':'';
    openGenericModal('Операция: '+event.action,'<p class="workspace-help">'+htmlEsc(event.actor)+' · '+htmlEsc(new Date(event.at).toLocaleString('ru-RU'))+'</p>'+pager+rows+'<div class="workspace-form-actions"><button class="btn btn-ghost" onclick="workspaceHistoryList()">К истории</button><button class="btn btn-primary" '+(_loadWriteBlocked?'disabled':'')+' onclick="workspaceRestoreHistory()">Восстановить состояние до операции</button></div>',1000);
}
const workspaceRestoreHistory=singleFlightAction(async()=>{
  if(_loadWriteBlocked||!workspaceHistory.entry)return false;
  const event=workspaceHistory.entry;
  if(!await confirmAction('Восстановить состояние до этой операции? Будут проверены все '+event.changes.length+' изменений. Более поздние правки не перезаписываются.',{label:'Восстановить',danger:false}))return false;
  _activeSaves++;let locked=true;
  try{
    const result=await window.electronAPI.restoreHistoryEntry({id:event.id,identity:workspaceHistory.identity,databaseToken:workspaceHistory.databaseToken});
    if(!result.ok)throw new Error(result.error||'Не удалось восстановить операцию');
    data=result.data;_lastPersisted=JSON.stringify(data);rebuildIndex();
    if(typeof reestrRows!=='undefined')reestrRows=data.reestrRows||[];
    if(typeof _sync!=='undefined'&&_sync.enabled){_sync.revs=result.revisions;_sync.databaseToken=result.databaseToken||_sync.databaseToken;SYNC_SECTIONS.forEach(name=>{_sync.synced[name]=JSON.stringify(data[name]||[])});}
    scheduleLocalBackup(_lastPersisted);showToast('Операция восстановлена. В истории создана новая запись.');
    _activeSaves--;locked=false;closeModal('genericModal');switchSection(activeSection);await openChangeHistory();return true;
  }catch(error){showToast('Восстановление остановлено: '+error.message);return false;}
  finally{if(locked)_activeSaves--;}
});
