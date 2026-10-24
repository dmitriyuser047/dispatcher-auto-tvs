/* Procurement forecasts are estimates. Orders never mutate inventory or fuel journals. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('../core/accounting-boundary.js'),require('../core/decimal-core.js'),()=>require('../core/fuel-stock.js'),()=>require('../core/inventory-stock.js'),()=>require('../core/procurement-operations.js'),require('../core/entity-identity.js'),()=>require('../core/effective-periods.js'));else root.ProcurementEngine=factory(root.AccountingBoundary,root.DecimalCore,()=>root.FuelStock,()=>root.InventoryStock,()=>root.ProcurementOperations,root.EntityIdentity,()=>root.EffectivePeriods);})(typeof globalThis!=='undefined'?globalThis:this,function(accounting,decimal,getFuelStock,getInventoryStock,getProcurement,identity,getPeriods){
 'use strict';
 const DAY=86400000,STATUSES=['draft','ordered','partial','received','cancelled'];
 const rows=(db,name)=>Array.isArray(db?.[name])?db[name]:[];
 const live=r=>r&&typeof r==='object'&&!r.archived&&!r.deleted&&!r.cancelled;
 function number(value){return value!==null&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value))?Number(value):null;}
 const nonnegative=value=>{const n=number(value);return n!==null&&n>=0?n:0;};
 function exact(){if(!decimal)throw Error('Не загружено ядро десятичных расчётов');return decimal;}
 const result=value=>exact().toNumberExact(value);
 const round=(n,scale=3)=>result(exact().quantize(n,{scale,rounding:'half-away-from-zero'}));
 const add=(a,b)=>result(exact().add(a,b)),sub=(a,b)=>result(exact().sub(a,b));
 const multiply=(a,b)=>result(exact().mul(a,b));
 const divide=(a,b)=>result(exact().div(a,b,{scale:12,rounding:'half-away-from-zero'}));
 function ceilQuantity(value,whole){const scale=whole?0:3,rounded=round(value,scale);return exact().compare(rounded,value)<0?add(rounded,whole?1:0.001):rounded;}
 function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1900||Number(value.slice(0,4))>9990)return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
 function shift(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
 function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
 function itemKey(kind,id){return JSON.stringify([kind,typeof id,id]);}
 function item(db,kind,id){return rows(db,kind==='tank'?'tanks':'parts').find(r=>r.id===id);}
 function stockEngine(){const engine=getFuelStock?.();if(engine?.apiVersion!==1)throw Error('Не загружено общее ядро топливного запаса');return engine;}
 function inventoryEngine(){const engine=getInventoryStock?.();if(engine?.apiVersion!==1)throw Error('Не загружено общее ядро склада запчастей');return engine;}
 function stockRow(db,id,date,snapshot){const engine=stockEngine();return engine.at(snapshot||engine.project(db,{tankIds:[id],to:date}),{section:'tanks',id},date);}
 function movementLookup(list){const index=new Map(),originalCounts=new Map(),idCounts=new Map();for(const row of list){index.set(row.id,row);idCounts.set(row.id,(idCounts.get(row.id)||0)+1);if(identity.presentId(row.originalMovementId))originalCounts.set(row.originalMovementId,(originalCounts.get(row.originalMovementId)||0)+1);}index.originalCounts=originalCounts;index.idCounts=idCounts;return index;}
 function tankAccounting(obj){if(accounting)return accounting.resolve('tanks',obj==null?{}:obj);if(obj&&Object.hasOwn(obj,'fuelAccounting'))throw Error('Не загружен модуль начала топливного учёта');return {mode:'legacy'};}
 function balance(db,kind,id,date,snapshot){
  if(kind==='tank')return stockRow(db,id,date,snapshot).balance;
  const engine=inventoryEngine();return engine.at(snapshot||engine.project(db,{partIds:[id],to:date}),{section:'parts',id},date).balance;
 }
 function usage(db,kind,id,date,snapshot,movementIndex,stockIndex){
  const boundary=kind==='tank'?tankAccounting(item(db,kind,id)):{mode:'legacy'};
  if(boundary.mode==='explicit'&&date<boundary.from)return {total:null,daily:null,count:0,from:null,to:date,observedDays:0,status:'outside-accounting'};
  const from=boundary.mode==='explicit'&&boundary.from>shift(date,-29)?boundary.from:shift(date,-29),within=r=>live(r)&&validDate(r.date)&&r.date>=from&&r.date<=date;
  let total=0,count=0;
  const include=qty=>{const n=nonnegative(qty);if(n>0){total=add(total,n);count++;}};
  if(kind==='part'){
   const engine=inventoryEngine(),projection=snapshot||engine.project(db,{partIds:[id],to:date}),projected=engine.at(projection,{section:'parts',id},date),physical=stockIndex?.get(id)||projection.rows.find(row=>row.target.id===id);
   if(projected.status!=='known')return{total:null,daily:null,count:0,from,to:date,observedDays:0,status:projected.status,diagnostics:projected.diagnostics};
   const movements=movementIndex?.originalCounts?movementIndex:movementLookup(rows(db,'partMovements')),linkedCounts=movements.originalCounts;
   for(const event of physical.events){if(event.date<from||event.date>date||!event.stockAffects||!['issue','writeoff'].includes(event.kind)||exact().compare(event.deltaDecimal,0)>=0)continue;
    const original=rows(db,'partMovements')[event.source.rowIndex],inverse=original?movements.get(original.reversedBy):null;
    if(original&&identity.presentId(original.reversedBy)&&inverse&&movements.idCounts.get(original.id)===1&&movements.idCounts.get(inverse.id)===1&&!inverse.cancelled&&!inverse.deleted&&inverse.status!=='cancelled'&&inverse.id!==original.id&&!identity.presentId(original.originalMovementId)&&!identity.presentId(inverse.reversedBy)&&inverse.originalMovementId===original.id&&linkedCounts.get(original.id)===1&&inverse.kind==='return'&&inverse.partId===id&&inverse.date===original.date&&exact().compare(inverse.qty,original.qty)===0&&(!identity.presentId(inverse.assetRef)&&!identity.presentId(original.assetRef)||inverse.assetRef===original.assetRef)&&(!identity.presentId(inverse.workOrderId)&&!identity.presentId(original.workOrderId)||inverse.workOrderId===original.workOrderId)&&typeof original.reversedAt==='string'&&Number.isFinite(Date.parse(original.reversedAt))&&inverse.createdAt===original.reversedAt&&typeof inverse.reason==='string'&&inverse.reason.trim().length>=3)continue;
    include(result(exact().sub(0,event.deltaDecimal)));
   }
  }
  else{
   const projection=snapshot||stockEngine().project(db,{tankIds:[id],to:date}),projected=stockRow(db,id,date,projection),physical=stockIndex?.get(id)||projection.rows.find(row=>row.target.id===id);
   if(projected.status!=='known')return {total:null,daily:null,count:0,from,to:date,observedDays:0,status:projected.status,diagnostics:projected.diagnostics};
   const movements=movementIndex||new Map(rows(db,'fuelMovements').map(row=>[row.id,row]));
   for(const event of physical.events){
    if(event.date<from||event.date>date||!event.stockAffects||exact().compare(event.deltaDecimal,0)>=0||!['generator-issue','issue'].includes(event.kind))continue;
    const original=event.source.section==='fuelMovements'?rows(db,'fuelMovements')[event.source.rowIndex]:null,inverse=original?movements.get(original.reversedBy):null;
    // A marker alone does not undo a physical issue. Only its actual inverse does.
    if(original&&original.reversedBy!==undefined&&original.reversedBy!==null&&original.reversedBy!==''&&inverse&&live(inverse)&&inverse.originalMovementId===original.id&&inverse.date===original.date&&inverse.toTankId===id&&(inverse.fromTankId??'')===(original.toTankId??'')&&exact().compare(inverse.qty,original.qty)===0)continue;
    include(result(exact().sub(0,event.deltaDecimal)));
   }
  }
  const days=boundary.mode==='explicit'?Math.min(30,Math.floor((new Date(date+'T12:00:00Z')-new Date(from+'T12:00:00Z'))/DAY)+1):30;
  return {total,daily:divide(total,days),count,from,to:date,...(boundary.mode==='explicit'?{observedDays:days}:{})};
 }
 function orderState(order,db,projection){
  if(order?.procurement){
   const engine=getProcurement?.();if(engine?.apiVersion!==1)throw Error('Не загружены общие правила закупок');
   const state=projection||engine.project(db,{kind:order.kind,orderIds:[order.id],through:today()}).rows.find(row=>row.orderId===order.id);
   if(!state)throw Error('Не найдено исполнение связанного заказа');
   if(state.remainingQty==null)return {undelivered:null,pendingPosting:null,coverage:null,draft:null,projection:state};
   const remaining=state.status==='cancelled'?0:state.remainingQty;
   return {undelivered:remaining,pendingPosting:0,coverage:remaining,draft:order.status==='draft'?remaining:0,projection:state};
  }
  if(!order||order.status==='cancelled'||order.archived||order.deleted)return {undelivered:0,pendingPosting:0,coverage:0,draft:0};
  const qty=nonnegative(order.quantity),received=Math.min(qty,nonnegative(order.receivedQty)),posted=Math.min(received,nonnegative(order.stockPostedQty));
  const undelivered=Math.max(0,sub(qty,received)),pendingPosting=Math.max(0,sub(received,posted));
  return {undelivered,pendingPosting,coverage:add(undelivered,pendingPosting),draft:order.status==='draft'?undelivered:0};
 }
 function scheduled(db,kind,id,date,horizon){
  const demand=new Map();let knownJobs=0,unknownJobs=0;
  for(const job of rows(db,'dispatchJobs')){
   if(!live(job)||!['assigned','started'].includes(job.status))continue;
   const start=String(job.start||'').slice(0,10),end=String(job.end||'').slice(0,10);
   if(!validDate(start)||!validDate(end)||end<start||end<date||start>shift(date,horizon))continue;
   // Hours describe the whole assignment. Do not concentrate already elapsed
   // hours into its remaining days, or use today's norm for a later work date.
   const span=Math.max(1,Math.round((new Date(end+'T12:00Z')-new Date(start+'T12:00Z'))/DAY)+1);
   const first=start<date?date:start,last=end>shift(date,horizon)?shift(date,horizon):end;
   let qty=null;
   if(kind==='tank'){
    const generator=String(job.assetRef||'').startsWith('g:')?rows(db,'generators').find(g=>'g:'+g.id===job.assetRef&&!g.archived):null;
    // A vehicle assignment has no reliable source tank in the current data model.
    // Only generators with an explicit tank and a flat l/h norm can be quantified.
    if(!generator||generator.tankId!==id)continue;
    const hours=number(job.plannedHours);
    if(Object.hasOwn(generator,'fuelNorms')){
     const periods=getPeriods?.();if(periods?.apiVersion!==1)throw Error('Не загружены датированные нормы ДЭС');
     let missing=false;
     for(let day=first;day<=last;day=shift(day,1)){
      let rate=null;
      try{const selected=periods.resolve('generators',generator,day,'fuelNorms');if(selected.status==='known')rate=number(selected.parameters.norm);}catch{missing=true;}
      if(hours===null||hours<0||rate===null||rate<0){missing=true;continue;}
      demand.set(day,add(demand.get(day)||0,divide(multiply(hours,rate),span)));
     }
     if(missing)unknownJobs++;else knownJobs++;
     continue;
    }
    const rate=number(generator.norm);
    if(hours!==null&&hours>=0&&rate!==null&&rate>0)qty=multiply(hours,rate);else unknownJobs++;
   }else{
    const requirements=Array.isArray(job.partRequirements)?job.partRequirements.filter(r=>r.partId===id):[];
    if(!requirements.length)continue;
    if(requirements.every(r=>number(r.qty)!==null&&number(r.qty)>=0))qty=requirements.reduce((sum,r)=>add(sum,Number(r.qty)),0);else unknownJobs++;
   }
   if(qty===null||!Number.isFinite(qty))continue;knownJobs++;
   // Spread a multi-day assignment over its whole interval, not only its remaining days.
   const perDay=divide(qty,span);
   for(let d=first;d<=last;d=shift(d,1))demand.set(d,add(demand.get(d)||0,perDay));
  }
  return {demand,knownJobs,unknownJobs};
 }
 function plan(db,options={}){
  const date=options.date||today();if(!validDate(date))throw Error('Некорректная дата расчёта');
  const result=[],fuelSnapshot=rows(db,'tanks').some(live)?stockEngine().project(db,{to:date}):null,partSnapshot=rows(db,'parts').some(live)?inventoryEngine().project(db,{to:date}):null;
  const stocks={tank:fuelSnapshot,part:partSnapshot},movementIndexes={tank:new Map(rows(db,'fuelMovements').map(row=>[row.id,row])),part:movementLookup(rows(db,'partMovements'))},stockIndexes={tank:new Map((fuelSnapshot?.rows||[]).map(row=>[row.target.id,row])),part:new Map((partSnapshot?.rows||[]).map(row=>[row.target.id,row]))},orderIndexes={};
  for(const kind of ['tank','part']){const linked=rows(db,'procurementOrders').some(row=>row.kind===kind&&row.procurement);if(linked){const engine=getProcurement?.();if(engine?.apiVersion!==1)throw Error('Не загружены общие правила закупок');orderIndexes[kind]=new Map(engine.project(db,{kind,through:date}).rows.map(row=>[row.orderId,row]));}else orderIndexes[kind]=new Map();}
  for(const kind of ['tank','part'])for(const obj of rows(db,kind==='tank'?'tanks':'parts').filter(live)){
   if(kind==='tank'){const boundary=tankAccounting(obj);if(boundary.mode==='explicit'&&date<boundary.from)continue;}
   const rule=rows(db,'procurementRules').find(r=>!r.archived&&r.kind===kind&&r.itemId===obj.id);
   const leadDays=Number.isInteger(rule?.leadDays)&&rule.leadDays>=0&&rule.leadDays<=365?rule.leadDays:7;
   const coverDays=Number.isInteger(rule?.coverDays)&&rule.coverDays>=1&&rule.coverDays<=365?rule.coverDays:14;
   const reserve=rule&&number(rule.reserveQty)!==null?nonnegative(rule.reserveQty):nonnegative(kind==='tank'?obj.reserveLevel:obj.minStock);
   const recent=usage(db,kind,obj.id,date,stocks[kind],movementIndexes[kind],stockIndexes[kind]),manual=rule&&number(rule.expectedDaily)!==null;
   const daily=manual?nonnegative(rule.expectedDaily):recent.daily;
   const stock=balance(db,kind,obj.id,date,stocks[kind]),orders=rows(db,'procurementOrders').filter(r=>r.kind===kind&&r.itemId===obj.id);
   const states=orders.map(order=>({order,...orderState(order,db,orderIndexes[kind].get(order.id))})),unknownOrders=states.filter(row=>row.coverage==null),open=states.filter(r=>r.coverage>0);
   const undelivered=unknownOrders.length?null:open.reduce((s,r)=>add(s,r.undelivered),0),pendingPosting=unknownOrders.length?null:open.reduce((s,r)=>add(s,r.pendingPosting),0);
   const drafts=unknownOrders.length?null:open.reduce((s,r)=>add(s,r.draft),0),coverage=unknownOrders.length?null:add(undelivered,pendingPosting);
   const horizon=leadDays+coverDays,scheduledJobs=scheduled(db,kind,obj.id,date,Math.max(365,horizon));
   if(stock===null||daily===null||unknownOrders.length){
    const state=(kind==='tank'?stockEngine():inventoryEngine()).at(stocks[kind],{section:kind==='tank'?'tanks':'parts',id:obj.id},date);
    result.push({key:itemKey(kind,obj.id),kind,itemId:obj.id,name:obj.name||obj.id,unit:kind==='tank'?'л':obj.unit||'ед.',site:obj.site||obj.org||'',stock,reserve,leadDays,coverDays,daily,dailySource:manual?'manual':'missing',recent,knownJobs:scheduledJobs.knownJobs,unknownJobs:scheduledJobs.unknownJobs,demand:null,undelivered,pendingPosting,drafts,coverage,suggestedQty:null,reorderDate:null,crossingDate:null,stockoutDate:null,nextDelivery:null,gapDelivery:null,lateCoverage:false,shortageBeforeDelivery:false,status:state?.status||'unknown',diagnostics:state?.diagnostics||[],warnings:[unknownOrders.length?'Нет достоверного исполнения связанного заказа: проверьте его документы.':'Нет достоверного остатка: исправьте указанные источники перед расчётом потребности.',...(state?.diagnostics||[]).map(issue=>issue.message)],ruleId:rule?.id??null});continue;
   }
   // Planned demand replaces the routine estimate on its day if larger. Adding both
   // would count the same normal assignment twice.
   const demandAt=d=>Math.max(daily,scheduledJobs.demand.get(d)||0);
   let demand=0;for(let i=0;i<horizon;i++)demand=add(demand,demandAt(shift(date,i)));
   const rawNeed=Math.max(0,sub(sub(add(demand,reserve),stock),coverage)),wholeUnits=kind==='part'&&/^(шт\.?|компл\.?|ед\.?)$/i.test(String(obj.unit||'').trim());
   const need=Math.max(0,ceilQuantity(rawNeed,wholeUnits));
   const deliveryDates=open.filter(r=>r.order.status!=='draft'&&r.undelivered>0&&validDate(r.order.deliveryDate)&&r.order.deliveryDate>=date).map(r=>r.order.deliveryDate).sort(),nextDelivery=deliveryDates[0]||null;
   let physical=stock,crossing=null,stockoutDate=null,gapDelivery=null,shortageBeforeDelivery=false;
   for(let i=0;i<Math.max(366,horizon+1);i++){
    const day=shift(date,i);
    // Received-but-unposted quantities and draft purchases never become actual stock.
    const arrivals=open.filter(r=>r.order.status!=='draft'&&r.undelivered>0&&validDate(r.order.deliveryDate)&&r.order.deliveryDate===day).reduce((s,r)=>add(s,r.undelivered),0);
    physical=add(physical,arrivals);
    if(physical<=reserve&&crossing===null)crossing=day;
    physical=sub(physical,demandAt(day));
    if(physical<reserve&&crossing===null)crossing=day;
    if(physical<0&&stockoutDate===null)stockoutDate=day;
    if(physical<0&&gapDelivery===null)gapDelivery=deliveryDates.find(d=>d>day)||null;
    if(physical<0&&i<leadDays)shortageBeforeDelivery=true;
   }
   const reorderDate=crossing?shift(crossing,-leadDays):null;
   const warnings=[];
   if(!manual&&!recent.count)warnings.push('За 30 дней нет выдач: регулярный расход неизвестен. Задайте ожидаемый расход или проверьте резерв.');
   if(scheduledJobs.unknownJobs)warnings.push(`Не учтено заявок без часов или нормы: ${scheduledJobs.unknownJobs}.`);
   if(pendingPosting>0)warnings.push(`Получено, но отдельно не оприходовано: ${round(pendingPosting)}. Проверьте старый ручной заказ и явно свяжите его с фактическими приходами.`);
   if(drafts>0)warnings.push('Черновики уменьшают новую рекомендацию, но ещё не подтверждают поставку.');
   if(open.some(r=>r.undelivered>0&&r.order.status!=='draft'&&r.order.deliveryDate<date))warnings.push('Есть просроченная поставка: остаток заказа учтён в потребности, но не добавлен к наличию.');
   if(shortageBeforeDelivery)warnings.push('По оценке возможен дефицит раньше обычного срока поставки. Уточните дату или ускорьте текущий заказ.');
   const lateCoverage=!!gapDelivery;
   if(lateCoverage)warnings.push(`Разрыв поставки: расчётный запас закончится ${stockoutDate}, а следующая поставка после дефицита — ${gapDelivery}. Заказ удерживает потребность, но не покрывает этот интервал: ускорьте поставку или согласуйте временное пополнение.`);
   if(kind==='tank'&&number(obj.capacity)>0&&stock+undelivered>Number(obj.capacity))warnings.push('Наличие и неполученные заказы превышают вместимость ёмкости. Проверьте объём и даты.');
   result.push({key:itemKey(kind,obj.id),kind,itemId:obj.id,name:obj.name||obj.id,unit:kind==='tank'?'л':obj.unit||'ед.',site:obj.site||obj.org||'',stock,reserve,leadDays,coverDays,daily:round(daily),dailySource:manual?'manual':recent.count?'history':'missing',recent,knownJobs:scheduledJobs.knownJobs,unknownJobs:scheduledJobs.unknownJobs,demand:round(demand),undelivered,pendingPosting,drafts,coverage,suggestedQty:need,reorderDate,crossingDate:crossing,stockoutDate,nextDelivery,gapDelivery,lateCoverage,shortageBeforeDelivery,warnings,ruleId:rule?.id??null});
  }
  return result.sort((a,b)=>(b.suggestedQty>0)-(a.suggestedQty>0)||a.name.localeCompare(b.name,'ru'));
 }
 function validateSection(name,list,db){
  if(!['procurementOrders','procurementRules'].includes(name)||!Array.isArray(list))throw Error('Недопустимый раздел закупок');
  const ids=new Set(),keys=new Set();
  const allowed=name==='procurementRules'?['id','kind','itemId','leadDays','reserveQty','coverDays','expectedDaily','archived','createdAt','updatedAt']:['id','kind','itemId','supplier','quantity','receivedQty','stockPostedQty','deliveryDate','status','note','archived','createdAt','updatedAt'];
  for(const row of list){
   if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!allowed.includes(k)))throw Error('Недопустимые поля закупки');
   if(!identity?.identifier(row.id)||typeof row.id==='string'&&(row.id.length>200||['__proto__','constructor','prototype'].includes(row.id))||ids.has(row.id))throw Error('Некорректный или повторный ID закупки');ids.add(row.id);
   if(!['tank','part'].includes(row.kind)||!identity.identifier(row.itemId)||typeof row.itemId==='string'&&row.itemId.length>200||!item(db,row.kind,row.itemId))throw Error('Не найден объект закупки');
   if(row.archived!==undefined&&typeof row.archived!=='boolean')throw Error('Некорректный признак архива');
   for(const field of ['createdAt','updatedAt'])if(row[field]!==undefined&&(typeof row[field]!=='string'||row[field].length>40||!Number.isFinite(Date.parse(row[field]))))throw Error('Некорректная дата изменения');
   const numeric=(field,{positive=false,integer=false,max=1e12}={})=>{if(typeof row[field]!=='number'||!Number.isFinite(row[field])||row[field]<(positive?Number.MIN_VALUE:0)||row[field]>max||(integer&&!Number.isInteger(row[field])))throw Error('Проверьте неотрицательное количество / срок: '+field);};
   if(name==='procurementRules'){
    numeric('leadDays',{integer:true,max:365});numeric('coverDays',{positive:true,integer:true,max:365});numeric('reserveQty');
    if(row.expectedDaily!==null&&row.expectedDaily!==undefined)numeric('expectedDaily');
    const key=itemKey(row.kind,row.itemId);if(!row.archived&&keys.has(key))throw Error('Для объекта уже есть правило закупки');if(!row.archived)keys.add(key);
   }else{
    if(!STATUSES.includes(row.status))throw Error('Некорректное состояние заказа');
    numeric('quantity',{positive:true});numeric('receivedQty');numeric('stockPostedQty');
    if(row.receivedQty>row.quantity||row.stockPostedQty>row.receivedQty)throw Error('Оприходовано ≤ получено ≤ заказано');
    if(!validDate(row.deliveryDate))throw Error('Проверьте дату поставки');
    if(typeof row.supplier!=='string'||row.supplier.length>300||typeof row.note!=='string'||row.note.length>4000)throw Error('Проверьте поставщика и примечание');
    if(row.status!=='draft'&&!row.supplier.trim())throw Error('Укажите поставщика');
    if(['draft','ordered'].includes(row.status)&&row.receivedQty!==0)throw Error('Получение требует состояния «Частично получен» или «Получен»');
    if(row.status==='partial'&&!(row.receivedQty>0&&row.receivedQty<row.quantity))throw Error('Для частичной поставки укажите полученное количество меньше заказанного');
    if(row.status==='received'&&row.receivedQty!==row.quantity)throw Error('Для полного получения укажите всё заказанное количество');
    if(row.status==='cancelled'&&row.receivedQty>row.stockPostedQty)throw Error('Сначала оприходуйте уже полученное количество, затем отмените остаток заказа');
   }
  }
  return true;
 }
 return {plan,balance,usage,orderState,validDate,shift,itemKey,validateSection,STATUSES};
});
