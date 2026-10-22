// One reviewed command per accounting scope; closing never edits accounting facts.
let periodControlSession=null;
function periodControlContext(){return platformSessionContext();}
function periodControlContextStamp(){return JSON.stringify([wfCommandContextStamp(),typeof _sync==='undefined'?null:_sync.access?.periodActions??null]);}
function periodControlToday(){return new Date().toISOString().slice(0,10);}
function periodControlRead(names){const allowed=periodControlContext().readable;return !Array.isArray(allowed)||allowed.includes('*')||names.every(name=>allowed.includes(name));}
function periodControlPermission(scope){
 const context=periodControlContext();if(context.blocked)return false;
 const actions=typeof _sync==='undefined'?null:_sync.access?.periodActions;
 if(Array.isArray(actions))return actions.includes(scope);
 return context.actor?.role==='admin'&&periodControlRead(PeriodPolicy.describe(scope).readSections);
}
function periodControlSupported(){return typeof _sync!=='undefined'&&_sync.platform?.periods===1&&typeof platformExecuteCommand==='function';}
function periodControlApi(){if(typeof PeriodPolicy==='undefined'||PeriodPolicy.apiVersion!==1)throw Error('Не загружены общие правила периодов. Обновите окно программы.');return PeriodPolicy;}
function periodControlReadable(scope){try{return periodControlRead(periodControlApi().describe(scope).readSections);}catch{return false;}}
function periodControlOptions(scope){return periodControlApi().describe().map(item=>'<option value="'+htmlEsc(item.scope)+'" '+(item.scope===scope?'selected':'')+'>'+htmlEsc(item.label)+(periodControlReadable(item.scope)?'':' · недостаточно доступа для проверки')+'</option>').join('');}
function periodControlAssert(s){
 if(periodControlSession!==s||!s.form.isConnected||document.getElementById('periodControlForm')!==s.form||!s.form.closest('#wfModal')?.classList.contains('open'))throw Error('Форма периода закрыта или заменена. Откройте проверку заново.');
 if(s.database!==data||s.context!==periodControlContextStamp()||s.today!==periodControlToday())throw Error('База, пользователь, права или дата изменились. Откройте проверку заново; ввод сохранён.');
}
function periodControlInput(s){
 const scope=s.form.elements.scope.value,month=s.form.elements.month.value,reason=s.form.elements.reason.value.trim(),action=s.form.elements.action.value;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Выберите месяц');
 if(reason.length<3)throw Error('Укажите основание от трёх знаков');
 if(!periodControlReadable(scope))throw Error('Недостаточно доступа к связанным разделам для проверки этой области');
 return {action,scope,month,reason};
}
function periodControlStatus(s){
 const scope=s.form.elements.scope.value,month=s.form.elements.month.value,host=s.form.querySelector('[data-period-status]');host.replaceChildren();
 const descriptor=periodControlApi().describe(scope),allowed=periodControlContext().readable;
 if(!periodControlReadable(scope)){
  const missing=descriptor.readSections.filter(name=>Array.isArray(allowed)&&!allowed.includes('*')&&!allowed.includes(name));host.textContent='Для проверки области «'+descriptor.label+'» недостаточно доступа: '+missing.map(name=>PlatformSchema.descriptors?.[name]?.label||name).join(', ')+'. Скрытые данные и замечания не показаны.';return;
 }
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){host.textContent='Выберите месяц. Области закрываются независимо; исходные документы и остатки не изменяются.';return;}
 try{
  const status=PeriodPolicy.status(data,scope,month,Array.isArray(allowed)?{readable:allowed}:{});
  const title=document.createElement('p');title.textContent='Выбранный месяц '+month+': '+(status.closed?'закрыт':'открыт')+'.';host.append(title);
  const protectedThrough=status.protectedThrough;if(protectedThrough){const p=document.createElement('p');p.textContent='Защищены данные по '+protectedThrough+'. Закрытые месяцы, от которых зависит защита: '+(status.protectingMonths||[]).join(', ')+'. Открытие выбранного месяца не снимает защиту более поздних закрытых месяцев.';host.append(p);}
  const history=status.history||[];if(history.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='История этой области · '+history.length;details.append(summary);for(const event of history.slice().reverse()){const p=document.createElement('p');p.textContent=[event.action==='close'?'Закрытие':event.action==='reopen'||event.action==='open'?'Открытие':event.action,event.month||month,event.at||'Время не подтверждено',event.actor?.name||'',event.reason||event.note||'',event.legacy?'Старая запись; данные времени и пользователя не подтверждены':''].filter(Boolean).join(' · ');details.append(p);}host.append(details);}
  for(const issue of status.diagnostics||[]){const p=document.createElement('p');p.textContent=issue.message||issue.code;host.append(p);}
 }catch(error){host.textContent='Статус недоступен: '+error.message;}
}
function periodControlInvalidate(s){s.review=null;s.form.elements.confirm.checked=false;s.form.querySelector('[data-period-save]').disabled=true;s.form.querySelector('[data-period-review]').replaceChildren();}
function periodControlReview(s){
 periodControlAssert(s);const input=periodControlInput(s),readable=periodControlContext().readable,review=PeriodPolicy.preview(data,input,{today:s.today,...(Array.isArray(readable)?{readable}:{} )});
 const host=s.form.querySelector('[data-period-review]');host.replaceChildren();
 const title=document.createElement('h4');title.textContent=(input.action==='close'?'Закрытие':'Открытие')+' · '+PeriodPolicy.describe(input.scope).label+' · '+input.month;host.append(title);
 const sections=[['Что мешает выполнению',review.blockers||[]],['Замечания',review.warnings||[]]];for(const [label,issues]of sections)if(issues.length){const heading=document.createElement('strong'),list=document.createElement('ul');heading.textContent=label;host.append(heading);for(const issue of issues){const li=document.createElement('li');li.textContent=issue.message||issue.code||String(issue);list.append(li);}host.append(list);}
 const message=document.createElement('p');message.textContent='Основание: '+input.reason+'. Исходные записи, суммы, литры и остатки не изменяются.';host.append(message);
 if(input.action==='reopen'&&review.status?.protectingMonths?.some(month=>month>input.month)){const p=document.createElement('p');p.textContent='После открытия этого месяца правки останутся защищены более поздними закрытыми месяцами: '+review.status.protectingMonths.filter(month=>month>input.month).join(', ')+'.';host.append(p);}
 const permitted=periodControlPermission(input.scope);if(!permitted){const p=document.createElement('p');p.textContent='Ваши права позволяют просмотр. Управление этой областью недоступно.';host.append(p);}if(!periodControlSupported()){const p=document.createElement('p');p.textContent='Подключение не поддерживает управление периодами. Обновите основную программу; прямое сохранение не выполняется.';host.append(p);}
 s.review={input,stamp:JSON.stringify(input),review};s.form.querySelector('[data-period-save]').disabled=!review.canApply||!permitted||!periodControlSupported()||!s.form.elements.confirm.checked;periodControlStatus(s);return review;
}
async function periodControlCommit(s){
 if(s.pending)return;let unlock;
 try{
  periodControlAssert(s);if(!periodControlSupported())throw Error('Подключение не поддерживает управление периодами. Обновите основную программу.');const input=periodControlInput(s);if(!periodControlPermission(input.scope))throw Error('Недостаточно прав для управления этой областью');
  if(!s.review||s.review.stamp!==JSON.stringify(input)||!s.form.elements.confirm.checked||!s.review.review.canApply)throw Error('Проверьте замечания и подтвердите действие');
  const readable=periodControlContext().readable,current=PeriodPolicy.preview(data,input,{today:s.today,...(Array.isArray(readable)?{readable}:{} )});if(!current.canApply||current.fingerprint!==s.review.review.fingerprint)throw Error('Исходные данные изменились после проверки. Повторите предпросмотр; ввод сохранён.');
  const command={type:'PeriodAction',version:1,input:{...input,reviewFingerprint:current.fingerprint}},stamp=JSON.stringify(command);if(s.operationStamp!==stamp){s.operationStamp=stamp;s.operationId='period-'+crypto.randomUUID();}
  s.pending=true;unlock=wfLockCommandForm(s.form);s.form.querySelector('[data-period-error]').textContent='';s.form.querySelector('[data-period-pending]').textContent='Ожидается подтверждение базы…';
  const result=await platformExecuteCommand(command,{operationId:s.operationId});if(!result.ok)throw Object.assign(Error(result.message||result.error||'Действие не подтверждено'),result);
  if(s.context!==periodControlContextStamp())throw Error('Сохранение подтверждено, но сеанс изменился. Проверьте результат в исходной базе.');
  if(periodControlSession===s&&document.getElementById('periodControlForm')===s.form&&s.form.closest('#wfModal')?.classList.contains('open')){periodControlSession=null;closeModal('wfModal');periodControlOpen(input.scope,input.month,input.action);}
  showToast(input.action==='close'?'Период закрыт. Основание и пользователь сохранены в истории.':'Открытие подтверждено. Проверьте защиту более поздними месяцами.');return result;
 }catch(error){wfShowCommandError(s.form.querySelector('[data-period-error]'),error);s.form.querySelector('[data-period-pending]').textContent=error.unknown?'Подтверждение не получено. Ввод сохранён; повтор использует прежнюю операцию.':'';return {ok:false,code:error.code,error:error.message};}
 finally{s.pending=false;unlock?.();if(s.review)s.form.querySelector('[data-period-save]').disabled=!s.review.review.canApply||!periodControlPermission(s.form.elements.scope.value)||!periodControlSupported()||!s.form.elements.confirm.checked;}
}
function periodControlOpen(scope='fuel',month='',action='close'){
 try{
  const descriptors=periodControlApi().describe();if(!descriptors.some(item=>item.scope===scope))scope=descriptors[0].scope;if(!['close','reopen'].includes(action))action='close';
  wfShowDialog('Закрытие и открытие периодов','<form id="periodControlForm" class="wf-form"><p class="wf-wide wf-note">ГСМ, склад запчастей и финансы управляются отдельно. Закрытие фиксирует период; открытие требует основания и сохраняется в истории.</p><label><span>Область учёта</span><select name="scope">'+periodControlOptions(scope)+'</select></label><label><span>Месяц</span><input name="month" type="month" required></label><div class="wf-wide wf-note" data-period-status></div><label class="wf-wide"><span>Действие</span><select name="action"><option value="close">Закрыть период</option><option value="reopen">Открыть период</option></select></label><label class="wf-wide"><span>Основание *</span><textarea name="reason" minlength="3" maxlength="2000" required></textarea></label><button type="button" class="btn btn-ghost wf-wide" data-period-preview>Проверить действие</button><div class="wf-wide wf-note" data-period-review></div><label class="wf-wide"><span><input type="checkbox" name="confirm"> Проверил замечания, основание и последствия для выбранной области</span></label><p class="wf-wide" role="status" data-period-pending></p><p class="wf-wide wf-error" role="alert" data-period-error></p><div class="wf-wide wf-actions"><button type="button" class="btn btn-ghost" data-period-cancel>Закрыть окно</button><button type="submit" class="btn btn-primary" data-period-save disabled>Подтвердить действие</button></div></form>');
  const form=document.getElementById('periodControlForm'),s=periodControlSession={form,database:data,context:periodControlContextStamp(),today:periodControlToday(),pending:false,review:null};form.elements.month.value=/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:'';form.elements.action.value=action;periodControlStatus(s);
  form.addEventListener('input',event=>{if(event.target.name==='confirm'){form.querySelector('[data-period-save]').disabled=!s.review?.review.canApply||!periodControlPermission(form.elements.scope.value)||!periodControlSupported()||!form.elements.confirm.checked;}else{periodControlInvalidate(s);if(['scope','month'].includes(event.target.name))periodControlStatus(s);}});
  form.querySelector('[data-period-preview]').onclick=()=>{if(s.pending)return;form.querySelector('[data-period-error]').textContent='';try{periodControlReview(s);}catch(error){periodControlInvalidate(s);wfShowCommandError(form.querySelector('[data-period-error]'),error);}};
  const close=()=>{if(!s.pending){periodControlSession=null;closeModal('wfModal');}};form.querySelector('[data-period-cancel]').onclick=close;form.closest('#wfModal').querySelector('.modal-header button').onclick=close;form.onsubmit=event=>{event.preventDefault();void periodControlCommit(s);};return s;
 }catch(error){showToast(error.message);return null;}
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&periodControlSession?.pending&&document.getElementById('wfModal')?.classList.contains('open')){event.preventDefault();event.stopImmediatePropagation();}},true);
