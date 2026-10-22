// Read-only stock projections and reviewed tank-only fuel actions.
let tankFuelSession=null;
let tankStockReadContext=null;
let tankStockIndexContext=null;
const TANK_STOCK_SECTIONS=['tanks','tankIncomes','generators','genRecords','fuelMovements'];
function tankStockReadAllowed(names=TANK_STOCK_SECTIONS){const access=platformSessionContext().readable;return !Array.isArray(access)||access.includes('*')||names.every(name=>access.includes(name));}
function tankStockApi(){if(typeof FuelStock==='undefined'||FuelStock.apiVersion!==1)throw Error('Не загружен общий расчёт остатков ёмкостей');return FuelStock;}
function tankStockSnapshot(){if(!tankStockReadAllowed())throw Error('Недостаточно доступа для расчёта остатков ёмкостей');return tankStockReadContext||tankStockApi().project(data);}
function tankStockWithSnapshot(action){if(tankStockReadContext)return action(tankStockReadContext);const snapshot=tankStockSnapshot();tankStockReadContext=snapshot;tankStockIndexContext=new Map(snapshot.rows.map(row=>[row.target.id,row]));try{return action(snapshot);}finally{tankStockReadContext=null;tankStockIndexContext=null;}}
function tankStockDisplaySnapshot(action){return tankStockReadAllowed()?tankStockWithSnapshot(action):action(null);}
function tankStockAt(id,date=dispatcherLocalDate(),inclusive=true,snapshot){return tankStockApi().at(snapshot||tankStockSnapshot(),{section:'tanks',id},date,{inclusive});}
function tankStockRow(id,snapshot){const source=snapshot||tankStockSnapshot();return source===tankStockReadContext?tankStockIndexContext.get(id):source.rows.find(row=>row.target.id===id);}
function tankStockEvents(id,date=dispatcherLocalDate(),snapshot){return(tankStockRow(id,snapshot)?.events||[]).filter(event=>event.date<=date&&event.stockAffects);}
function tankStockLabel(row){return row.status==='outside-accounting'?'Учёт ещё не начат':row.status==='known'?precisionFormat(row.balance):'Остаток не определён';}
function tankFuelGrade(row){if(!row)return 'вид топлива не определён';return row.fuelGrade||({diesel:'ДТ',gasoline:'Бензин',gas:'Газ'}[row.fuel])||'ДТ';}
function tankFuelOrg(row){return typeof row?.org==='string'&&row.org.trim()?row.org.trim():'организация не определена';}
function tankFuelCaption(row){return row?[row.name||row.plate||String(row.id),tankFuelGrade(row),tankFuelOrg(row)].join(' · '):'Не выбрано';}
function tankOperationSummary(section,payload,options={}){
 if(!tankStockReadAllowed())return 'Недостаточно доступа для проверки расчётного остатка. Скрытые данные не показаны.';
 const date=payload.date;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return 'Укажите дату операции: остаток будет показан на конец выбранного дня.';
 const snapshot=tankStockSnapshot(),lookup=id=>(data.tanks||[]).find(row=>row.id===id),from=lookup(payload.fromTankId),to=lookup(section==='tankIncomes'?payload.tankId:payload.toTankId),asset=payload.assetRef?wfAsset(payload.assetRef):null;
 const source=from?tankFuelCaption(from):section==='tankIncomes'?(payload.source||'Внешний источник'):['receipt','return'].includes(payload.kind)?'Внешний источник':'Источник не выбран';
 const recipient=to?tankFuelCaption(to):asset?asset.label+' · '+tankFuelGrade(asset.row)+' · '+(asset.section==='vehicles'?(gsmVehicleOrgAt(asset.row,date)||'организация не определена'):tankFuelOrg(asset.row)):'Получатель не выбран';
 const qty=section==='tankIncomes'?payload.amount:payload.qty;
 const existing=options.existing===true,balances=[from,to].filter(Boolean).map(row=>{const stock=tankStockAt(row.id,date,true,snapshot);if(stock.balance==null)return row.name+': '+tankStockLabel(stock);const after=qty==null||existing?null:DecimalCore.toNumberExact(row===from?DecimalCore.sub(stock.balance,qty):DecimalCore.add(stock.balance,qty));return row.name+': '+(existing?'расчёт до действия ':'доступно ')+precisionFormat(stock.balance)+' л'+(after===null?'':' → после операции '+precisionFormat(after)+' л');});
 return source+' → '+recipient+' · '+precisionFormat(section==='tankIncomes'?payload.amount:payload.qty)+' л. Расчёт на конец '+fmtDate(date)+'. '+balances.join('; ')+(existing?'. При исправлении или отмене прежняя версия учитывается отдельно; новое количество не прибавляется повторно.':'')+'. Физический остаток ёмкости не зависит от расхода получателя.';
}
function tankFuelToday(){return new Date().toISOString().slice(0,10);}
function tankFuelContextStamp(){return JSON.stringify([wfCommandContextStamp(),typeof _sync==='undefined'?null:_sync.access?.fuelActions??null]);}
function tankFuelApi(){if(typeof FuelOperations==='undefined'||FuelOperations.apiVersion!==1)throw Error('Не загружены правила замеров и отмены топлива');return FuelOperations;}
function tankFuelSupported(){return typeof _sync!=='undefined'&&_sync.platform?.fuelOperations===1&&typeof platformExecuteCommand==='function';}
function tankFuelPermission(action){const context=platformSessionContext(),actions=typeof _sync==='undefined'?null:_sync.access?.fuelActions;if(context.blocked)return false;if(Array.isArray(actions))return actions.includes(action);return context.actor?.role==='admin'&&lifecycleCanWrite(['fuelMovements']);}
function tankFuelDependencies(input){return tankFuelApi().dependencies(input);}
function tankFuelAssert(s){
 if(tankFuelSession!==s||!s.form.isConnected||document.getElementById('tankFuelActionForm')!==s.form||!s.form.closest('#wfModal.open'))throw Error('Форма закрыта или заменена. Откройте действие заново.');
 if(s.database!==data||s.context!==tankFuelContextStamp()||s.today!==tankFuelToday())throw Error('База, пользователь, права или дата изменились. Ввод сохранён; откройте проверку заново.');
}
function tankFuelInput(s){
 const reason=s.form.elements.reason.value.trim();if(reason.length<3)throw Error('Укажите основание от трёх знаков');
 const input={action:s.action,reason};
 if(s.action==='measure'){const token=s.form.elements.tank.value,row=token===''?null:s.tanks[Number(token)];if(!row)throw Error('Выберите действующую ёмкость');input.target={section:'tanks',id:row.id};input.date=s.form.elements.date.value;input.observedQty=precisionParse(s.form.elements.observedQty.value,{scale:3,blank:'error'});}
 else if(s.action==='reverseLegacyTransfer'){input.outId=s.outId;input.inId=s.inId;}
 else input.measurementId=s.measurementId;
 if(!tankStockReadAllowed(tankFuelDependencies(input)))throw Error('Недостаточно доступа к связанным разделам для проверки');return input;
}
function tankFuelInvalidate(s){s.review=null;s.form.elements.confirm.checked=false;s.form.querySelector('[data-tank-save]').disabled=true;s.form.querySelector('[data-tank-review]').replaceChildren();}
function tankFuelReview(s){
 tankFuelAssert(s);const input=tankFuelInput(s),readable=platformSessionContext().readable,review=tankFuelApi().preview(data,input,{today:s.today,...(Array.isArray(readable)?{readable}:{})});
 const host=s.form.querySelector('[data-tank-review]');host.replaceChildren();const note=document.createElement('p');note.textContent=s.action==='measure'?'Сохраняется факт замера на конец дня. Этот замер не меняет расчётный остаток.':s.action==='applyDifference'?'Разница будет оформлена отдельной корректировкой. Замер и исходные движения сохраняются.':s.action==='voidMeasurement'?'Отменяется только факт замера; исходные литры и движения сохраняются.':'Старое перемещение сохраняется. Отмена оформляется отдельным обратным движением для обеих ёмкостей.';host.append(note);
 const measurement=review.measurement;if(measurement){const p=document.createElement('p');p.textContent='Измерено: '+precisionFormat(measurement.observedQty)+' л; расчёт: '+precisionFormat(measurement.calculatedQty,{blank:'не определён'})+' л; разница: '+precisionFormat(measurement.differenceQty,{blank:'не определена'})+' л.';host.append(p);}
 for(const [title,issues]of [['Что мешает',review.blockers||review.issues||[]],['Замечания',review.warnings||[]]])if(issues.length){const h=document.createElement('strong'),ul=document.createElement('ul');h.textContent=title;host.append(h);for(const issue of issues){const li=document.createElement('li');li.textContent=issue.message||issue.code;ul.append(li);}host.append(ul);}
 const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=JSON.stringify(review.diff||[],null,2);host.append(pre);
 if(!tankFuelSupported()){const p=document.createElement('p');p.textContent='Подключение не поддерживает эти действия. Обновите основную программу; прямого сохранения нет.';host.append(p);}
 if(!tankFuelPermission(s.action)){const p=document.createElement('p');p.textContent='Ваши права позволяют только просмотр этого действия.';host.append(p);}
 s.review={input,stamp:JSON.stringify(input),value:review};s.form.querySelector('[data-tank-save]').disabled=!review.canApply||!tankFuelSupported()||!tankFuelPermission(s.action)||!s.form.elements.confirm.checked;return review;
}
async function tankFuelCommit(s){
 if(s.pending)return;let unlock;try{
  tankFuelAssert(s);if(!tankFuelSupported())throw Error('Обновите программу: подключение не поддерживает действия с замерами');if(!tankFuelPermission(s.action))throw Error('Недостаточно прав для действия с топливом');
  const input=tankFuelInput(s);if(!s.review||s.review.stamp!==JSON.stringify(input)||!s.review.value.canApply||!s.form.elements.confirm.checked)throw Error('Проверьте действие и подтвердите последствия');
  const readable=platformSessionContext().readable,current=tankFuelApi().preview(data,input,{today:s.today,...(Array.isArray(readable)?{readable}:{})});if(!current.canApply||current.fingerprint!==s.review.value.fingerprint)throw Error('Исходные данные изменились после проверки. Повторите предпросмотр; ввод сохранён.');
  const command={type:'FuelAction',version:1,input:{...input,reviewFingerprint:current.fingerprint}},stamp=JSON.stringify(command);if(s.operationStamp!==stamp){s.operationStamp=stamp;s.operationId='tank-'+crypto.randomUUID();}
  s.pending=true;unlock=wfLockCommandForm(s.form);s.form.querySelector('[data-tank-error]').textContent='';s.form.querySelector('[data-tank-pending]').textContent='Ожидаем подтверждение базы…';
  const result=await platformExecuteCommand(command,{operationId:s.operationId});if(!result.ok)throw Object.assign(Error(result.message||result.error||'Действие не подтверждено'),result);
  if(s.database!==data||s.context!==tankFuelContextStamp())throw Error('Действие подтверждено, но сеанс изменился. Проверьте результат в исходной базе.');
  if(tankFuelSession===s&&document.getElementById('tankFuelActionForm')===s.form&&s.form.closest('#wfModal.open')){tankFuelSession=null;closeModal('wfModal');if(s.action==='measure')tankMeasurementOpen(s.operationId);else tankStockRefresh();}
  showToast('Действие подтверждено базой. Исходная история сохранена.');return result;
 }catch(error){wfShowCommandError(s.form.querySelector('[data-tank-error]'),error);s.form.querySelector('[data-tank-pending]').textContent=error.unknown?'Подтверждение ещё не получено. Ввод сохранён; повтор использует ту же операцию.':'';return {ok:false,code:error.code,error:error.message};}
 finally{s.pending=false;unlock?.();if(s.review)s.form.querySelector('[data-tank-save]').disabled=!s.review.value.canApply||!tankFuelSupported()||!tankFuelPermission(s.action)||!s.form.elements.confirm.checked;}
}
function tankStockRefresh(){if(selectedTankId!=null&&selectedTankId!==''){const tank=(data.tanks||[]).find(row=>row.id===selectedTankId);if(tank)return tankStockWithSnapshot(()=>{renderTankList();renderTankDetail(tank);});}if(typeof renderWorkflows==='function'&&wfTab==='fuelMovements')renderWorkflows();}
function tankStockOpen(id){switchSection('tanks');selectTank(id);}
function tankFuelActionOpen(action,options={}){
 try{
  tankFuelApi();const probe={action,reason:'Проверка доступа',...(action==='measure'?{target:{section:'tanks',id:options.tankId??0},date:'2000-01-01',observedQty:0}:action==='reverseLegacyTransfer'?{outId:options.outId,inId:options.inId}:{measurementId:options.measurementId})};
  const reads=tankFuelDependencies(probe);if(!tankStockReadAllowed(reads))throw Error('Недостаточно доступа к связанным разделам. Скрытые данные не показаны.');
  const titles={measure:'Записать замер ёмкости',applyDifference:'Применить разницу замера',voidMeasurement:'Отменить замер',reverseLegacyTransfer:'Отменить старое перемещение'};
  const tanks=(data.tanks||[]).filter(row=>!row.archived&&!row.mergedInto),measurement=options.measurementId==null?null:(data.fuelMovements||[]).find(row=>row.id===options.measurementId);
  wfShowDialog(titles[action],'<form id="tankFuelActionForm" class="wf-form"><p class="wf-wide wf-note">Замер — факт наблюдения на конец дня. Он сам не меняет остаток. Применение разницы и отмена требуют отдельного подтверждения.</p>'+(action==='measure'?'<label class="wf-wide"><span>Ёмкость</span><select name="tank"></select></label><label><span>Дата замера</span><input name="date" type="date" required></label><label><span>Измерено, л</span><input name="observedQty" inputmode="decimal" required></label>':'<p class="wf-wide" data-tank-original></p>')+'<label class="wf-wide"><span>Основание *</span><textarea name="reason" minlength="3" maxlength="2000" required></textarea></label><button type="button" class="btn btn-ghost wf-wide" data-tank-preview>Проверить действие</button><div class="wf-wide wf-note" data-tank-review></div><label class="wf-wide"><span><input type="checkbox" name="confirm"> Проверил дату, исходные данные и последствия</span></label><p class="wf-wide" role="status" data-tank-pending></p><p class="wf-wide wf-error" role="alert" data-tank-error></p><div class="wf-wide wf-actions"><button type="button" class="btn btn-ghost" data-tank-cancel>Закрыть окно</button><button type="submit" class="btn btn-primary" data-tank-save disabled>Подтвердить действие</button></div></form>');
  const form=document.getElementById('tankFuelActionForm'),s=tankFuelSession={...options,action,form,tanks,database:data,context:tankFuelContextStamp(),today:tankFuelToday(),pending:false,review:null};
  if(action==='measure'){form.elements.tank.append(new Option('— выберите ёмкость —',''));tanks.forEach((row,index)=>form.elements.tank.append(new Option(tankFuelCaption(row),String(index),false,row.id===options.tankId)));form.elements.date.value=options.date||'';form.elements.observedQty.value=options.observedQty??'';}
  else form.querySelector('[data-tank-original]').textContent=measurement?'Замер '+fmtDate(measurement.date)+' · '+precisionFormat(measurement.measurement?.observedQty)+' л · '+(measurement.reason||''):'Сохраняются обе исходные строки перемещения. Доступность отмены проверяется для обеих ёмкостей.';
  form.elements.reason.value=options.reason||'';form.addEventListener('input',event=>{if(event.target.name==='confirm')form.querySelector('[data-tank-save]').disabled=!s.review?.value.canApply||!tankFuelSupported()||!tankFuelPermission(action)||!form.elements.confirm.checked;else tankFuelInvalidate(s);});
  form.querySelector('[data-tank-preview]').onclick=()=>{if(s.pending)return;form.querySelector('[data-tank-error]').textContent='';try{tankFuelReview(s);}catch(error){tankFuelInvalidate(s);wfShowCommandError(form.querySelector('[data-tank-error]'),error);}};
  const close=()=>{if(!s.pending){tankFuelSession=null;closeModal('wfModal');}};form.querySelector('[data-tank-cancel]').onclick=close;form.closest('#wfModal').querySelector('.modal-header button').onclick=close;form.onsubmit=event=>{event.preventDefault();void tankFuelCommit(s);};return s;
 }catch(error){showToast(error.message);return null;}
}
function tankMeasurementOpen(id){
 try{if(!tankStockReadAllowed(tankFuelDependencies({action:'voidMeasurement',measurementId:id,reason:'Проверка доступа'})))throw Error('Недостаточно доступа к истории замера');const rows=(data.fuelMovements||[]).filter(row=>row.id===id);if(rows.length!==1||rows[0].kind!=='measurement')throw Error('Замер не найден однозначно');const row=rows[0],m=row.measurement,target=(data.tanks||[]).find(tank=>tank.id===m.target.id);
  wfShowDialog('Замер ёмкости','<div class="wf-form"><p class="wf-wide">'+htmlEsc(tankFuelCaption(target))+' · конец '+htmlEsc(fmtDate(row.date))+'</p><p class="wf-wide">Измерено: '+htmlEsc(precisionFormat(m.observedQty))+' л. Расчёт при записи: '+htmlEsc(precisionFormat(m.calculatedQty,{blank:'не определён'}))+' л. Разница: '+htmlEsc(precisionFormat(m.differenceQty,{blank:'не определена'}))+' л.</p><p class="wf-wide">'+htmlEsc(row.reason||'')+'</p><p class="wf-wide wf-note">Замер не изменяет расчётный остаток. Корректировка оформляется отдельно.</p><div class="wf-wide wf-actions" data-tank-measurement-actions></div></div>');
  const host=document.querySelector('[data-tank-measurement-actions]');if(row.lifecycle?.void){const p=document.createElement('p');p.textContent='Замер отменён. История сохранена.';host.append(p);}else for(const [action,label]of [['applyDifference','Применить разницу'],['voidMeasurement','Отменить замер']]){const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.textContent=label;button.onclick=()=>tankFuelActionOpen(action,{measurementId:id});host.append(button);}return row;
 }catch(error){showToast(error.message);return null;}
}
function tankLegacyTransferOpen(id){if(!tankStockReadAllowed([...TANK_STOCK_SECTIONS,'fuelPeriods','vehicles','records'])){showToast('Недостаточно доступа к истории перемещения');return null;}const row=(data.tankIncomes||[]).find(item=>item.id===id),peers=row&&EntityIdentity.presentId(row.linkId)?(data.tankIncomes||[]).filter(item=>item.linkId===row.linkId):[];const out=peers.filter(item=>item.kind==='out'),incoming=peers.filter(item=>item.kind==='in');if(peers.length!==2||out.length!==1||incoming.length!==1){showToast('Старое перемещение не образует однозначную пару. Проверьте диагностику; строки сохранены.');return null;}return tankFuelActionOpen('reverseLegacyTransfer',{outId:out[0].id,inId:incoming[0].id});}
function tankMovementOpen(kind,tankId){const tank=(data.tanks||[]).find(row=>row.id===tankId);if(!tank||tank.archived||tank.mergedInto){showToast('Выберите действующую ёмкость для новой операции');return null;}return newDocument('fuelMovements',{kind,...(['receipt','return'].includes(kind)?{toTankId:tank.id}:{fromTankId:tank.id})});}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&tankFuelSession?.pending&&document.getElementById('wfModal')?.classList.contains('open')){event.preventDefault();event.stopImmediatePropagation();}},true);
