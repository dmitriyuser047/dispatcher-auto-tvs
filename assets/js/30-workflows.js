// Рабочие процессы. Старые журналы остаются первичными; новые сущности имеют собственные ID.
const WF_SECTIONS = ['dispatchJobs','drivers','assetAssignments','workOrders','opsTasks','assetDocuments','fuelMovements','parts','partMovements','shiftReports','connectors','auditLog','savedViews','glonassTrips','glonassImports','costEntries','costProfiles','procurementOrders','procurementRules','fuelWriteoffs'];
const WF_TABS = {dispatchJobs:'Заявки',opsTasks:'Задачи',drivers:'Сотрудники',assetAssignments:'Назначения',workOrders:'Ремонтные заказы',assetDocuments:'Документы',fuelMovements:'Движения топлива',parts:'Запчасти и шины',partMovements:'Склад',shiftReports:'Сменные формы',connectors:'Обмен',auditLog:'История'};
const WF_STATUS = {new:'Новая',assigned:'Назначена',started:'В работе',done:'Выполнена',confirmed:'Подтверждена',cancelled:'Отменена',open:'Открыта',approved:'Согласован',repairing:'В ремонте',accepted:'Принят',closed:'Закрыта',snoozed:'Отложена',prepared:'Подготовлена',sent:'Отправлена',rejected:'Отклонена',active:'Активен',archived:'В архиве',file:'Файловый обмен',api:'API · настройка'};
let wfTab='opsTasks', wfQuery='', wfSite='', wfOrg='', wfShowArchive=false;
function wfId(prefix='wf') { return prefix+'_'+(globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)); }
function wfToday() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function wfHash(s) { let h=2166136261; for(let i=0;i<s.length;i++) h=Math.imul(h^s.charCodeAt(i),16777619); return (h>>>0).toString(16); }
function wfInitData(d) {
  WF_SECTIONS.forEach(n=>{if(!Array.isArray(d[n])) d[n]=[];});
  // Детерминированные ключи нужны старым строкам реестра для совместной работы.
  for(const section of ['reestrRows','budget',...WF_SECTIONS]) {
    const seen=new Map(); (d[section]||[]).forEach(r=>{ if(!r || typeof r!=='object' || r.id!==undefined&&r.id!==null&&r.id!=='') return; const h=wfHash(JSON.stringify(r)); const n=seen.get(h)||0; seen.set(h,n+1); r.id='legacy_'+section+'_'+h+'_'+n; });
  }
}
function wfAppendAudit(d, previous) {
  wfInitData(d); if(!previous) return;
  let old; try {old=JSON.parse(previous);} catch{return;}
  const entries=[];
  Object.keys(d).filter(n=>n!=='auditLog' && Array.isArray(d[n])).forEach(section=>{
    if(JSON.stringify(d[section])===JSON.stringify(old[section]||[])) return;
    const before=new Map((old[section]||[]).map((r,i)=>[r.id??r.month??'row:'+i,r]));
    const after=new Map(d[section].map((r,i)=>[r.id??r.month??'row:'+i,r]));
    new Set([...before.keys(),...after.keys()]).forEach(key=>{
      const b=before.get(key),a=after.get(key); if(JSON.stringify(a)===JSON.stringify(b))return;
      entries.push({id:wfId('audit'),at:new Date().toISOString(),actor:localStorage.getItem('wfActor')||'Локальный пользователь',section,recordId:String(key),action:!b?'create':!a?'delete':'update',before:b||null,after:a||null});
    });
  });
  d.auditLog.push(...entries);
}
function wfAssetDescriptor(ref,resolved){
  const row=resolved.row,label=resolved.section==='vehicles'?[row.plate,row.make].filter(Boolean).join(' · '):resolved.section==='generators'?'ДЭС '+row.name:'Ёмкость '+row.name;
  return {ref,label,row,section:resolved.section,id:resolved.id};
}
function wfAsset(ref) { const resolved=EntityIdentity.resolveAsset(data,ref);return resolved.status==='known'?wfAssetDescriptor(ref,resolved):null; }
function wfAssets() {
  const groups=new Map();for(const section of ['vehicles','generators','tanks'])for(const row of data[section]||[]){if(!EntityIdentity.identifier(row.id))continue;const ref=(section==='vehicles'?'v:':section==='generators'?'g:':'t:')+String(row.id);if(!groups.has(ref))groups.set(ref,[]);groups.get(ref).push({section,id:row.id,row});}
  return [...groups].filter(([,matches])=>matches.length===1).map(([ref,matches])=>wfAssetDescriptor(ref,matches[0]));
}
function wfContext(ref,date=wfToday()) { const a=wfAsset(ref);if(!a)return {}; const changes=(data.assetAssignments||[]).filter(x=>!x.archived && x.assetRef===ref && x.from<=date && (!x.to||x.to>=date)).sort((a,b)=>String(b.from).localeCompare(a.from)); return Object.assign({},a.row,changes[0]||{}); }
function wfOverlap(a,b) { return a.start<b.end && b.start<a.end; }
function wfPersonnelKind(assetRef){return typeof TvsPersonnelEngine!=='undefined'?TvsPersonnelEngine.kindForAsset(assetRef):String(assetRef||'').startsWith('g:')?'operator':String(assetRef||'').startsWith('v:')?'driver':null;}
function wfPersonnelFieldLabel(assetRef){const kind=wfPersonnelKind(assetRef);return kind==='operator'?'Оператор ДЭС':kind==='driver'?'Водитель':'Сотрудник';}
function wfPersonnelReferenceUnchanged(row,old){return !!old&&old.driverId===row.driverId&&(old.assetRef||'')===(row.assetRef||'');}
function wfPersonnelMatches(row,kind){if(!kind)return true;if(typeof TvsPersonnelEngine!=='undefined')return TvsPersonnelEngine.matchesRole(row,kind);return (Array.isArray(row.personnelRoles)?row.personnelRoles:['driver']).includes(kind);}
function wfPersonnelAvailable(row){return typeof TvsPersonnelEngine!=='undefined'?TvsPersonnelEngine.availability(row).available:!row.archived&&!row.deleted&&(!row.employmentStatus||row.employmentStatus==='active');}
function wfDispatchProblems(job,old) {
  const issues=[]; const asset=wfAsset(job.assetRef),driver=(data.drivers||[]).find(x=>x.id===job.driverId);
  if(!(job.start<job.end))issues.push('Конец задания должен быть позже начала');
  if(['assigned','started','done','confirmed'].includes(job.status)) {
    if(!asset || asset.row.archived)issues.push('Выберите действующую технику');
    if(!driver||(!wfPersonnelReferenceUnchanged(job,old)&&(!wfPersonnelAvailable(driver)||!wfPersonnelMatches(driver,wfPersonnelKind(job.assetRef)))))issues.push('Выберите действующего сотрудника: '+wfPersonnelFieldLabel(job.assetRef).toLowerCase());
    if(asset && /ремонт|списан|дтп|продан/i.test(wfContext(job.assetRef,job.start?.slice(0,10)).status||''))issues.push('Статус техники не позволяет назначение');
    for(const r of data.dispatchJobs||[]) if(!r.archived && r.id!==job.id && !['cancelled','done','confirmed'].includes(r.status) && wfOverlap(job,r)) {
      if(job.assetRef&&job.assetRef===r.assetRef)issues.push('Техника занята: '+r.title);
      if(EntityIdentity.presentId(job.driverId)&&job.driverId===r.driverId)issues.push('Сотрудник занят: '+r.title);
    }
    if((data.workOrders||[]).some(r=>r.assetRef===job.assetRef&&['approved','repairing'].includes(r.status)&&r.downtimeFrom&&r.downtimeFrom<job.end&&(!r.downtimeTo||r.downtimeTo>job.start)))issues.push('Задание пересекается с простоем по ремонту');
    if((data.assetDocuments||[]).some(r=>!r.archived&&r.mandatory&&r.expires&&r.expires<job.end.slice(0,10)&&(r.assetRef===job.assetRef||r.driverId===job.driverId)))issues.push('Обязательный документ истёк к дате задания');
    const skills=new Set(String(driver?.skills||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean));
    if(driver && job.requirements && !job.requirements.toLowerCase().split(',').map(s=>s.trim()).filter(Boolean).every(s=>skills.has(s)))issues.push('Не подтверждены все требуемые допуски сотрудника');
    if([...(data.vehicleTo||[]).filter(r=>asset?.section==='vehicles'&&r.vehicleId===asset.id),...(data.toRecords||[]).filter(r=>asset?.section==='generators'&&r.generatorId===asset.id)].some(r=>r.planned&&!r.completedAt&&r.date>=job.start.slice(0,10)&&r.date<=job.end.slice(0,10)))issues.push('В интервале задания запланировано ТО');
  }
  if(job.status==='confirmed'&&(!job.confirmedBy||!job.result))issues.push('Для подтверждения укажите принявшего и результат');
  return [...new Set(issues)];
}
function wfTankBalanceAt(id,date=wfToday()){return tankStockAt(id,date).balance;}

let wfPartStockContext=null;
function wfPartStockWithSnapshot(action){const previous=wfPartStockContext;try{const readable=platformSessionContext().readable;if(Array.isArray(readable)&&!readable.includes('*')&&!InventoryStock.readSections.every(name=>readable.includes(name)))throw Error('Недостаточно доступа для расчёта склада запчастей');wfPartStockContext=InventoryStock.project(data,{to:wfToday()});return action();}finally{wfPartStockContext=previous;}}
function wfPartStock(id,date=wfToday(),snapshot=wfPartStockContext) { if(typeof InventoryStock==='undefined')throw Error('Не загружено общее ядро склада запчастей');return InventoryStock.at(snapshot||InventoryStock.project(data,{partIds:[id],to:date}),{section:'parts',id},date).balance; }
function wfValidDate(value,withTime=false) {
  if(typeof value!=='string'||!(withTime?/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/:/^\d{4}-\d{2}-\d{2}$/).test(value))return false;
  const d=new Date(value.slice(0,10)+'T12:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value.slice(0,10)&&(!withTime||Number.isFinite(new Date(value).getTime()));
}
const WF_TRANSITIONS={dispatchJobs:{new:['assigned','cancelled'],assigned:['new','started','cancelled'],started:['done','cancelled'],done:['confirmed'],confirmed:[],cancelled:['new']},workOrders:{new:['approved','cancelled'],approved:['new','repairing','cancelled'],repairing:['accepted','cancelled'],accepted:[],cancelled:['new']},opsTasks:{open:['started','snoozed','closed'],started:['open','snoozed','closed'],snoozed:['open','started','closed'],closed:['open']},shiftReports:{prepared:['sent'],sent:['accepted','rejected'],accepted:[],rejected:['prepared','sent']}};
function wfValidate(section,row,old,options={}) {
  if(!WF_SECTIONS.includes(section)||section==='auditLog'||!row||typeof row!=='object'||Array.isArray(row))throw Error('Недопустимый раздел или запись');
  if(!(typeof row.id==='number'&&Number.isFinite(row.id))&&(typeof row.id!=='string'||!row.id||row.id.length>200||['__proto__','constructor','prototype'].includes(row.id)))throw Error('Некорректный ID записи');
  const scan=value=>{if(!value||typeof value!=='object')return;for(const key of Object.keys(value)){if(['__proto__','prototype','constructor'].includes(key))throw Error('Недопустимое поле пакета');scan(value[key]);}};scan(row);
  for(const [key,label,type='text',required] of (typeof WF_FIELDS!=='undefined'?WF_FIELDS[section]||[]:[])) {
    const value=row[key];
    if(required&&(value==null||String(value).trim()===''))throw Error('Заполните поле «'+label+'»');
    if(value==null||value==='')continue;
    if(type==='number'&&(typeof value!=='number'||!Number.isFinite(value)||value<0))throw Error('Поле «'+label+'»: нужно неотрицательное число');
    if((type==='date'||type==='datetime-local')&&!wfValidDate(value,type==='datetime-local'))throw Error('Проверьте дату «'+label+'»');
    if(type==='checkbox'&&typeof value!=='boolean')throw Error('Недопустимое значение «'+label+'»');
    if((type.startsWith('status:')||type.startsWith('choice:'))&&!wfOptions(type).some(option=>option[0]===value))throw Error('Недопустимое состояние «'+label+'»');
    if(['asset','driver','tank','part'].includes(type)) {
      const ref=type==='asset'?wfAsset(value)?.row:type==='driver'?(data.drivers||[]).find(r=>r.id===value):type==='tank'?(data.tanks||[]).find(r=>r.id===value):(data.parts||[]).find(r=>r.id===value);
      if(!ref)throw Error('Не найден объект поля «'+label+'»');
      if(ref.archived&&(!old||old[key]!==value))throw Error('Нельзя выбрать объект из архива: '+label);
      if(type==='driver'&&['assetAssignments','dispatchJobs','shiftReports'].includes(section)&&!wfPersonnelReferenceUnchanged(row,old)){
        if(!wfPersonnelAvailable(ref))throw Error('Сотрудник недоступен для нового назначения');
        if(!wfPersonnelMatches(ref,wfPersonnelKind(row.assetRef)))throw Error('Для выбранной техники требуется '+wfPersonnelFieldLabel(row.assetRef).toLowerCase());
      }
    }
    if(!['number','checkbox','driver','tank','part'].includes(type)&&typeof value!=='string')throw Error('Поле «'+label+'» должно быть текстом');
  }
  const transitions=WF_TRANSITIONS[section];
  if(transitions&&old&&old.status!==row.status&&transitions[old.status]&&!transitions[old.status].includes(row.status))throw Error('Недопустимый переход: '+(WF_STATUS[old.status]||old.status)+' → '+(WF_STATUS[row.status]||row.status));
  if(section==='dispatchJobs') {const p=wfDispatchProblems(row,old);if(p.length)throw Error(p.join('\n'));}
  if(section==='assetAssignments') {
    if(row.to&&row.from>row.to)throw Error('Дата окончания раньше начала');
    if((data.assetAssignments||[]).some(r=>!r.archived&&r.id!==row.id&&r.id!==options.replacesAssignmentId&&r.assetRef===row.assetRef&&r.from<=(row.to||'9999')&&(r.to||'9999')>=row.from))throw Error('Период назначения пересекается с существующим. Выберите заменяемое назначение или уточните даты.');
  }
  if(section==='fuelMovements') {
    if(!(row.qty>0))throw Error('Количество должно быть больше нуля');
    const hasFrom=EntityIdentity.presentId(row.fromTankId),hasTo=EntityIdentity.presentId(row.toTankId);
    if(!hasFrom&&!hasTo)throw Error('Выберите ёмкость');
    if(row.fromTankId===row.toTankId)throw Error('Источник и получатель должны различаться');
    if(['transfer'].includes(row.kind)&&(!hasFrom||!hasTo))throw Error('Для перемещения нужны две ёмкости');
    if((['receipt','return'].includes(row.kind)&&(!hasTo||hasFrom))||(row.kind==='issue'&&(!hasFrom||hasTo))||(row.kind==='adjustment'&&hasFrom===hasTo))throw Error('Проверьте направление движения');
    const from=(data.tanks||[]).find(t=>t.id===row.fromTankId),to=(data.tanks||[]).find(t=>t.id===row.toTankId);
    if(from&&to&&(from.fuel||'diesel')!==(to.fuel||'diesel'))throw Error('Виды топлива ёмкостей не совпадают');
    if(row.kind==='return'&&row.assetRef)throw Error('Возврат из бака техники пока не поддерживается. Для внешнего возврата очистите поле техники.');
    if(row.kind==='issue'&&row.assetRef?.startsWith('t:'))throw Error('Для выдачи в ёмкость используйте перемещение');
    if(row.kind==='issue'&&row.assetRef?.startsWith('g:')&&!row.legacyOverlapConfirmed&&(data.genRecords||[]).some(r=>r.generatorId===wfAsset(row.assetRef)?.id&&r.date===row.date&&genRecordTankId(r)===row.fromTankId&&+r.fuelIssued>0))throw Error('В этот день уже есть выдача в журнале ДЭС. Если это отдельная дополнительная выдача, подтвердите её в форме; повторно существующую выдачу не вводите.');
    if(!row.reason)throw Error('Укажите основание движения');
    if(old)throw Error('Проведённые движения неизменяемы. Создайте обратное движение с основанием.');
    if(hasFrom&&wfTankBalanceAt(row.fromTankId,row.date)<row.qty)throw Error('На дату движения недостаточно расчётного топлива');
    if((data.fuelPeriods||[]).some(p=>p.month===row.date.slice(0,7)&&p.closed))throw Error('Топливный месяц закрыт');
  }
  if(section==='partMovements') {
    if(!(row.qty>0))throw Error('Количество должно быть больше нуля');
    if(['issue','writeoff'].includes(row.kind)){const stock=wfPartStock(row.partId,row.date);if(stock===null)throw Error('Остаток склада недостоверен. Исправьте источники перед выдачей.');if(stock<row.qty)throw Error('Недостаточно остатка на складе на дату операции');}
    if(old)throw Error('Изменение проведённого движения не допускается. Оформите возврат.');
  }
  if(section==='workOrders') {
    if(row.status==='accepted'&&(!row.acceptedBy||!row.result||!row.downtimeTo))throw Error('Для приёмки нужны результат, принявший и конец простоя');
    if(row.downtimeFrom&&row.downtimeTo&&row.downtimeFrom>row.downtimeTo)throw Error('Конец простоя раньше начала');
  }
  if(section==='opsTasks'&&row.status==='closed'&&!row.result)throw Error('Укажите результат решения задачи');
  if(section==='shiftReports') {
    if(row.odoEnd!=null&&row.odoStart!=null&&row.odoEnd<row.odoStart)throw Error('Конечный одометр меньше начального');
    if(row.status==='accepted'&&!row.acceptedBy)throw Error('Укажите принявшего сменную форму');
    if(old?.status==='accepted')throw Error('Принятая форма неизменяема. Создайте корректировку.');
    if(row.status==='rejected'&&!row.rejectionReason)throw Error('Укажите причину отклонения сменной формы');
  }
  if(section==='assetDocuments'&&!row.assetRef&&!EntityIdentity.presentId(row.driverId))throw Error('Свяжите документ с техникой или сотрудником');
  if(section==='assetDocuments'&&row.date&&row.expires&&row.expires<row.date)throw Error('Документ истекает раньше даты выдачи');
  if(section==='connectors'&&row.kind==='api'&&row.endpoint){let url;try{url=new URL(row.endpoint);}catch{throw Error('Проверьте адрес API');}if(url.protocol!=='https:'||url.username||url.password)throw Error('API адрес должен использовать HTTPS без пароля в адресе');}
}
function wfCommandContextStamp(){
  const context=typeof platformSessionContext==='function'?platformSessionContext():dispatcherContext();
  const list=value=>Array.isArray(value)?[...new Set(value)].sort():null;
  return JSON.stringify({identity:context.identity,actor:context.actor||null,readable:list(context.readable),writable:list(context.writable),fieldPermissions:context.fieldPermissions||null,blocked:!!context.blocked});
}
function wfCommandState(section,id,original){return {context:wfCommandContextStamp(),section,id,original:JSON.stringify(original||null),operationId:null,commandText:null,pending:false};}
function wfLockCommandForm(form){
  const controls=[...form.querySelectorAll('input,select,textarea,button[type="submit"]')].map(control=>[control,control.disabled]);
  for(const[control]of controls)control.disabled=true;
  return()=>{for(const[control,disabled]of controls)control.disabled=disabled;};
}
function wfAssertCommandState(state){
  if(state.context!==wfCommandContextStamp())throw Error('База, пользователь или права изменились. Откройте форму заново. Введённые значения остаются в полях.');
  if(state.section&&JSON.stringify((data[state.section]||[]).find(row=>row.id===state.id)||null)!==state.original)throw Error('Исходная запись уже изменена. Откройте актуальную форму; введённые значения остаются в полях.');
}
function wfCommandTarget(assetRef){
  const resolved=EntityIdentity.resolveAsset(data,assetRef,{v:'vehicles',g:'generators'});
  if(resolved.status!=='known')throw Error(resolved.status==='ambiguous'?'Нельзя однозначно определить технику. Проверьте её ID.':'Выберите машину или ДЭС');
  return {section:resolved.section,id:resolved.id};
}
function wfCommandReference(section,value,label,fromSelect=false){
  const exact=(data[section]||[]).filter(row=>row.id===value);if(!fromSelect&&exact.length===1)return exact[0].id;
  const matches=(data[section]||[]).filter(row=>String(row.id)===String(value));
  if(matches.length!==1)throw Error('Проверьте поле «'+label+'»: объект не найден или ID неоднозначен');return matches[0].id;
}
async function wfExecuteSemanticCommand(command,state){
  state=state||wfCommandState();wfAssertCommandState(state);
  if(state.pending)throw Error('Дождитесь подтверждения текущего действия');
  if(typeof platformExecuteCommand!=='function')throw Error('Эта версия программы не поддерживает безопасное выполнение действия. Обновите основную программу.');
  const text=JSON.stringify(command);if(state.commandText!==text){state.commandText=text;state.operationId=wfId('command');}
  state.pending=true;
  try{
    const result=await platformExecuteCommand(command,{operationId:state.operationId});
    if(state.context!==wfCommandContextStamp())throw Error('База, пользователь или права изменились. Проверьте результат в исходной базе; введённые значения остаются в форме.');
    if(result?.ok!==true){
      const detail=(result?.issues||[]).slice(0,3).map(issue=>issue.message).filter(Boolean).join('; ');
      const message=String(result?.message||result?.error||'Действие не подтверждено. Введённые значения остаются в форме.');
      throw Object.assign(Error(message+(detail&&!message.includes(detail)?': '+detail:'')+(result?.unknown?' Проверьте очередь сохранения: результат ещё не подтверждён.':'')+(result?.committed&&result?.needsReload?' Сервер подтвердил операцию, но локальные данные не обновлены. Сверьте историю перед повтором.':'')),{code:result?.code||'COMMAND_FAILED',unknown:!!result?.unknown});
    }
    return result;
  }finally{state.pending=false;}
}
function wfShowCommandError(node,error){
  if(!node)return;node.textContent=error.message;
  if(!error.unknown||!window.electronAPI?.getPendingOperations)return;
  const stamp=wfCommandContextStamp(),queue=document.createElement('p');queue.className='wf-note';queue.setAttribute('role','status');queue.textContent='Проверяю очередь сохранения…';node.append(queue);
  void(async()=>{
    try{
      const result=await window.electronAPI.getPendingOperations();if(!node.isConnected||stamp!==wfCommandContextStamp())return;
      if(!result?.ok||result.supported===false){queue.textContent=result?.error||'Очередь недоступна в этом подключении.';return;}
      const rows=(result.operations||[]).filter(row=>row.status!=='committed');
      queue.textContent=rows.length?'В очереди: '+rows.map(row=>(({pending:'ожидает проверки',unknown:'нет подтверждения',conflict:'нужна сверка',rejected:'отклонено'})[row.status]||'требует проверки')+' · '+String(row.id)).join('; ')+'. Повтор неизменённой формы использует ту же операцию.':'Неподтверждённых операций в очереди нет. Проверьте историю исходной базы.';
    }catch{if(node.isConnected&&stamp===wfCommandContextStamp())queue.textContent='Не удалось прочитать очередь. Введённые значения сохранены в форме.';}
  })();
}
function wfAssignmentInput(row,old,replacesAssignmentId){
  if(row.driverId==null||row.driverId==='')throw Error('Выберите сотрудника');
  return {...(old?{assignmentId:old.id}:{}),driverId:row.driverId,target:wfCommandTarget(row.assetRef),from:row.from,to:row.to||'',
    site:row.site,org:row.org||'',...(row.status!==undefined?{status:row.status}:{}),reason:row.reason,
    ...(replacesAssignmentId!==undefined?{replacesAssignmentId}: {})};
}
async function wfSave(section,row,state,options={}) {
  const old=(data[section]||[]).find(r=>r.id===row.id);if(state)wfAssertCommandState(state);wfValidate(section,row,old,options);
  if(section==='workOrders'&&row.status==='accepted'||section==='dispatchJobs'&&row.status==='confirmed'){
    if(!old)throw Error('Сначала сохраните исходный заказ или заявку. Проведение выполняется после проверки документа.');
    if(typeof lifecyclePostExisting!=='function'||typeof DocumentEngine==='undefined')throw Error('Не загружен общий движок документов');
    const descriptor=DocumentEngine.describe(section),payload={};for(const field of descriptor.fields)if(Object.hasOwn(row,field)&&row[field]!==undefined)payload[field]=JSON.parse(JSON.stringify(row[field]));
    lifecyclePostExisting(section,old.id,payload);return false;
  }
  let command=null;
  if(section==='fuelMovements'&&row.kind==='issue')command={type:'IssueFuel',version:1,input:{tankId:wfCommandReference('tanks',row.fromTankId,'Из ёмкости'),target:wfCommandTarget(row.assetRef),date:row.date,qty:row.qty,reason:row.reason,...(row.legacyOverlapConfirmed?{legacyOverlapConfirmed:true}:{})}};
  if(section==='assetAssignments')command={type:'AssignPerson',version:1,input:wfAssignmentInput(row,old,options.replacesAssignmentId)};
  if(section==='shiftReports'&&row.status==='accepted'){
    if(!old||old.status!=='sent')throw Error('Принять можно только ранее отправленную сменную форму');
    const changes={};for(const field of ['title','date','driverId','jobId','odoStart','odoEnd','hours','fuelIssued','tankMeasured','defect','result','acceptedBy'])if(row[field]!==undefined)changes[field]=row[field];
    changes.target=wfCommandTarget(row.assetRef);command={type:'AcceptShift',version:1,input:{shiftId:old.id,changes}};
  }
  if(command){await wfExecuteSemanticCommand(command,state);if(!state?.form||document.getElementById('wfModal')?.contains(state.form))closeModal('wfModal');if((activeSection==='drivers'||activeSection==='operators')&&typeof renderPersonnelSection==='function')renderPersonnelSection();else renderWorkflows();showToast('Действие подтверждено и сохранено');return true;}
  wfInitData(data);row.updatedAt=new Date().toISOString();if(!old)row.createdAt=row.updatedAt;
  if(old)Object.assign(old,row);else data[section].push(row);
  if(await saveData(data)){closeModal('wfModal');if((activeSection==='drivers'||activeSection==='operators')&&typeof renderPersonnelSection==='function')renderPersonnelSection();else renderWorkflows();showToast('Сохранено');return true;}return false;
}
function wfReversalCheck(id) {
  const original=(data.fuelMovements||[]).find(r=>r.id===id);
  if(!original||original.deleted||original.cancelled)throw Error('Исходное движение не найдено или уже отменено');
  if(EntityIdentity.presentId(original.reversedBy)||EntityIdentity.presentId(original.originalMovementId)||(data.fuelMovements||[]).some(r=>r.originalMovementId===id))throw Error('Повторное сторно не допускается');
  for(const tankId of [original.fromTankId,original.toTankId].filter(EntityIdentity.presentId))if(!(data.tanks||[]).some(t=>t.id===tankId))throw Error('Ёмкость исходного движения не найдена. Сначала восстановите её из истории.');
  if(!wfValidDate(original.date)||!Number.isFinite(original.qty)||original.qty<=0)throw Error('У исходного движения некорректны дата или количество');
  if(typeof fuelMonthClosed==='function'?fuelMonthClosed(original.date.slice(0,7)):(data.fuelPeriods||[]).some(p=>p.month===original.date.slice(0,7)&&p.closed))throw Error('Исходный месяц закрыт. Сначала откройте месяц с указанием причины.');
  if(EntityIdentity.presentId(original.toTankId)&&Math.min(wfTankBalanceAt(original.toTankId,original.date),wfTankBalanceAt(original.toTankId)) + 0.005 < original.qty)throw Error('В ёмкости-получателе недостаточно топлива для обратного движения на исходную дату или сегодня');
  let linked=null;
  if(original.kind==='issue'&&original.assetRef){
    const asset=wfAsset(original.assetRef);if(!asset||!['vehicles','generators'].includes(asset.section))throw Error('Техника выдачи не найдена или ссылка неоднозначна');
    const vehicle=asset.section==='vehicles',id=asset.id,records=vehicle?data.records:data.genRecords;
    const matches=(records||[]).filter(r=>r.id===original.recordId||r.fuelMovementId===original.id);
    if(matches.length!==1)throw Error('Не найдена единственная связанная запись журнала. Нужна проверка истории выдачи.');
    linked=matches[0];
    if(EntityIdentity.presentId(linked.reversalId)||Number(linked.fuelIssued)!==original.qty||(vehicle?linked.vehicleId:linked.generatorId)!==id)throw Error('Связанная запись уже изменена или сторнирована');
    const all=(records||[]).filter(r=>(vehicle?r.vehicleId:r.generatorId)===id&&r.date<=wfToday()).slice().sort((a,b)=>cmpDateAsc(a.date,b.date));
    const last=all[all.length-1];
    const balances=vehicle?computeFuelBalances(id,null,wfToday()):computeGenFuelBalances(id);
    const onSource=all.filter(r=>r.date<=original.date).pop();
    const current=last?balances[last.id]:Number(asset.row.fuelBalance)||0,atSource=onSource?balances[onSource.id]:Number(asset.row.fuelBalance)||0;
    if(!Number.isFinite(current)||!Number.isFinite(atSource)||Math.min(current,atSource)+0.005<original.qty)throw Error('В расчётном остатке техники недостаточно топлива для отмены этой выдачи. Проверьте последующий расход и замеры.');
  }
  return {original,linked};
}
async function wfReverseFuelMovement(id,reason) {
  reason=String(reason||'').trim();if(!reason)throw Error('Укажите причину сторно');
  wfReversalCheck(id);
  if(typeof lifecycleReverseExisting!=='function')throw Error('Не загружена проверка сторно документов');
  lifecycleReverseExisting('fuelMovements',id,reason);return false;
}
function wfCanRestoreDeleted(event) {
  return event?.action==='delete'&&typeof SYNC_SECTIONS!=='undefined'&&SYNC_SECTIONS.includes(event.section)&&event.section!=='auditLog'&&event.before&&typeof event.before==='object'&&!Array.isArray(event.before)&&EntityIdentity.identifier(event.before.id)&&!(data[event.section]||[]).some(r=>r.id===event.before.id);
}
function wfRestoreReferences(section,row) {
  const requireRef=(name,id,label)=>{if(EntityIdentity.presentId(id)&&!(data[name]||[]).some(r=>r.id===id))throw Error('Сначала восстановите '+label+' («'+id+'»). Запись без связи не будет создана.');};
  if(['records','vehicleTo','repairs'].includes(section)&&!EntityIdentity.presentId(row.vehicleId))throw Error('В истории отсутствует связь с машиной');
  if(['genRecords','toRecords'].includes(section)&&!EntityIdentity.presentId(row.generatorId))throw Error('В истории отсутствует связь с ДЭС');
  requireRef('vehicles',row.vehicleId,'машину');requireRef('generators',row.generatorId,'ДЭС');
  for(const key of ['tankId','fromTankId','toTankId','counterTankId'])requireRef('tanks',row[key],'ёмкость');
  requireRef('drivers',row.driverId,'сотрудника');requireRef('parts',row.partId,'номенклатуру');requireRef('workOrders',row.workOrderId,'ремонтный заказ');requireRef('dispatchJobs',row.jobId,'заявку');requireRef('contragents',row.contragentId,'контрагента');
  if(row.assetRef&&!wfAsset(row.assetRef))throw Error('Сначала восстановите технику, указанную в записи');
  if(EntityIdentity.presentId(row.recordId)){const list=section==='fuelMovements'&&row.assetRef?.startsWith('g:')?'genRecords':'records';requireRef(list,row.recordId,'связанную запись журнала');}
  requireRef('fuelMovements',row.fuelMovementId,'исходное движение топлива');
  requireRef('fuelMovements',row.originalMovementId,'исходное движение сторно');
  requireRef('fuelMovements',row.reversedBy,'движение сторно');
  if(EntityIdentity.presentId(row.fuelMovementId)){const movement=(data.fuelMovements||[]).find(r=>r.id===row.fuelMovementId);if(EntityIdentity.presentId(movement?.reversedBy)&&(row.reversalId!==movement.reversedBy||Number(row.fuelIssued)!==0))throw Error('Выдача уже сторнирована. Нельзя восстановить её прежний положительный приход.');}
  if(row.fuelCardNum&&!(data.fuelCards||[]).some(c=>typeof fcNorm==='function'?fcNorm(c.number)===fcNorm(row.fuelCardNum):String(c.number)===String(row.fuelCardNum)))throw Error('Топливная карта с этим номером не найдена. Сначала восстановите карту.');
  if(section==='vehicles'&&row.plate&&(data.vehicles||[]).some(v=>typeof plateKey==='function'?plateKey(v.plate)===plateKey(row.plate):v.plate===row.plate))throw Error('Машина с таким госномером уже существует');
  if(section==='fuelCards'&&row.number&&(data.fuelCards||[]).some(c=>typeof fcNorm==='function'?fcNorm(c.number)===fcNorm(row.number):c.number===row.number))throw Error('Карта с таким номером уже существует');
  const legacyParty=!EntityIdentity.presentId(row.contragentId)&&(row.contragent||(section==='budget'?row.company:''));
  if(legacyParty&&!(data.contragents||[]).some(c=>String(c.name||'').trim().toLowerCase()===String(legacyParty).trim().toLowerCase()))throw Error('Контрагент «'+legacyParty+'» не найден. Сначала восстановите контрагента.');
}
async function wfRestoreDeleted(auditId) {
  try{
    if(!await confirmAction('Восстановить удалённую запись из истории? Связи и состояние периода будут проверены перед сохранением.'))return;
    const event=(data.auditLog||[]).find(r=>r.id===auditId);
    if(!wfCanRestoreDeleted(event))throw Error('Запись уже восстановлена или её нельзя восстановить из этого события');
    const row=JSON.parse(JSON.stringify(event.before));wfRestoreReferences(event.section,row);
    const date=row.date||row.month;if(date&&typeof fuelMonthClosed==='function'&&['records','genRecords','tankIncomes','fuelPurchases','monthlyFuel','fuelMovements'].includes(event.section)&&fuelMonthClosed(date.slice(0,7)))throw Error('Месяц записи закрыт. Сначала откройте его с указанием причины.');
    if(WF_SECTIONS.includes(event.section)&&!['fuelMovements','partMovements'].includes(event.section))wfValidate(event.section,row,null);
    if(event.section==='fuelMovements'&&row.kind==='issue'&&row.assetRef&&!EntityIdentity.presentId(row.recordId))throw Error('В истории нет связанного прихода в журнал. Автоматическое восстановление этой выдачи заблокировано.');
    data[event.section].push(row);
    if(!await saveData(data,{noMerge:true}))throw Error('Восстановление не записано. Обновите базу и повторите проверку.');
    renderWorkflows();showToast('Запись восстановлена; событие удаления сохранено в истории');
  }catch(error){showToast(error.message);}
}
function wfAuditLabel(r) {return `${r.at?.slice(0,19).replace('T',' ')} · ${r.actor} · ${SYNC_NAMES[r.section]||r.section} · ${r.action==='create'?'добавление':r.action==='delete'?'удаление':'изменение'} · ${r.recordId}`;}
function wfTimeline(ref) {
  const a=wfAsset(ref);if(!a){showToast('Техника не найдена или ссылка неоднозначна. Проверьте ID карточек.');return;} const rows=[]; const add=(arr,label,predicate,date='date')=>(arr||[]).filter(predicate).forEach(r=>rows.push({at:r[date]||r.createdAt||'',label,text:r.title||r.description||r.note||r.type||r.result||'',id:r.id}));
  add(data.assetAssignments,'Назначение',r=>r.assetRef===ref,'from');add(data.dispatchJobs,'Задание',r=>r.assetRef===ref,'start');add(data.workOrders,'Ремонт',r=>r.assetRef===ref,'downtimeFrom');add(data.assetDocuments,'Документ',r=>r.assetRef===ref);add(data.fuelMovements,'Топливо',r=>r.assetRef===ref);add(data.shiftReports,'Смена',r=>r.assetRef===ref);
  const id=a.id,isV=a.section==='vehicles';if(a.section==='vehicles'||a.section==='generators'){add(isV?data.records:data.genRecords,'Журнал',r=>isV?r.vehicleId===id:r.generatorId===id);add(isV?data.vehicleTo:data.toRecords,'ТО',r=>isV?r.vehicleId===id:r.generatorId===id);add(data.repairs,'Ремонт · журнал',r=>r.vehicleId===id&&isV);}else add(data.tankIncomes,'Ёмкость · приход',r=>r.tankId===id);
  wfShowDialog('История · '+(a?.label||ref),`<div class="wf-timeline">${rows.sort((a,b)=>b.at.localeCompare(a.at)).map(r=>`<article><strong>${htmlEsc(r.at)} · ${r.label}</strong><p>${htmlEsc(r.text||r.id)}</p></article>`).join('')||'Нет событий'}</div>`);
}
function wfShowDialog(title,body,footer='') {document.getElementById('wfModal')?.remove();const el=document.createElement('div');el.id='wfModal';el.className='modal-overlay open';el.innerHTML=`<div class="modal wf-modal" role="dialog" aria-modal="true" aria-label="${htmlEsc(title)}"><div class="modal-header"><div class="modal-title">${htmlEsc(title)}</div><button class="icon-btn" onclick="closeModal('wfModal')" aria-label="Закрыть">×</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-footer">${footer}</div>`:''}</div>`;document.body.append(el);precisionRemember(el);el.querySelector('input,select,textarea,button')?.focus();}
async function wfArchive(section,id) {const r=data[section].find(x=>x.id===id);if(!r)return;if(['fuelMovements','partMovements','auditLog'].includes(section))return; if(section==='dispatchJobs'&&['started','done','confirmed'].includes(r.status)){showToast('Завершённое или начатое задание сохраняется в истории');return;}r.archived=!r.archived;if(await saveData(data))renderWorkflows();}
async function wfTaskFromIssue(index) {const issue=_opsIssues[index];if(!issue)return;const fingerprint=wfHash(issue.title+'|'+issue.body);const existing=(data.opsTasks||[]).find(t=>!t.archived&&t.sourceId===issue.id&&t.sourceFingerprint===fingerprint&&t.status!=='closed');wfOpenTab('opsTasks',{query:'',site:'',org:'',archive:false});if(existing){wfEdit('opsTasks',existing.id);return;}const task={id:wfId('task'),title:issue.title,description:issue.body,sourceId:issue.id,sourceFingerprint:fingerprint,status:'open',due:wfToday(),owner:'',result:''};wfEdit('opsTasks',null,task);}
async function wfSnoozeIssue(index) {const issue=_opsIssues[index];if(!issue)return;const fingerprint=wfHash(issue.title+'|'+issue.body);let state=data.appMeta.find(r=>r.id==='attention:'+issue.id);if(!state){state={id:'attention:'+issue.id};data.appMeta.push(state);}state.fingerprint=fingerprint;state.until=new Date(Date.now()+86400000).toISOString();if(await saveData(data)){if(activeSection==='dispatch')renderWorkflows();else if(activeSection==='home')renderMainMenu();}}
function wfIssueVisible(issue) {const state=(data.appMeta||[]).find(r=>r.id==='attention:'+issue.id);return !(state&&state.fingerprint===wfHash(issue.title+'|'+issue.body)&&state.until>new Date().toISOString());}
