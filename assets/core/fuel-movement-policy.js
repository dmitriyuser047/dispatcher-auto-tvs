/* Fuel conservation and journal linkage rules shared by native, API and UI saves. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(()=>require('./fuel-engine.js'),()=>require('./accounting-boundary.js'));else root.FuelMovementPolicy=factory(()=>root.TvsFuelEngine,()=>root.AccountingBoundary);})(typeof globalThis==='object'?globalThis:this,function(getFuel,getAccounting){
  'use strict';
  const EPS=1e-7;
  const own=(row,key)=>Object.prototype.hasOwnProperty.call(row,key);
  const rows=(db,section)=>Array.isArray(db?.[section])?db[section].filter(row=>row&&typeof row==='object'&&!Array.isArray(row)):[];
  const present=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
  const idKey=value=>typeof value+':'+String(value);
  const live=row=>!row.cancelled&&!row.deleted;
  const canRead=(context,section)=>!Array.isArray(context?.readable)||context.readable.includes('*')||context.readable.includes(section);
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())&&Number.isFinite(Number(value))?Number(value):NaN;
  const amount=row=>number(row.liters??row.litres??row.amount??row.qty);
  const quantity=value=>Number.isFinite(number(value))?number(value):0;
  const sameQty=(a,b)=>Number.isFinite(number(a))&&Number.isFinite(number(b))&&Math.abs(number(a)-number(b))<EPS;
  const sameRef=(a,b)=>!present(a)&&!present(b)||a===b;
  function stable(value){if(value===undefined)return 'undefined';if(value===null||typeof value!=='object')return JSON.stringify(value);return Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';}
  function dateValid(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
  const find=(db,section,id)=>rows(db,section).find(row=>row.id===id);
  function accounting(section,row){
    if(!row||!own(row,'fuelAccounting'))return {mode:'legacy'};
    const api=getAccounting();
    if(!api||api.apiVersion!==1||typeof api.resolve!=='function')throw Object.assign(Error('Не загружены правила начала учёта топлива'),{code:'MODULE_UNAVAILABLE'});
    return api.resolve(section,row);
  }
  function accountingState(section,row){try{return accounting(section,row);}catch(error){return {mode:'invalid',error};}}
  function asset(db,ref){const match=typeof ref==='string'&&ref.match(/^([vg]):(.+)$/);return match?rows(db,match[1]==='v'?'vehicles':'generators').find(row=>String(row.id)===match[2]):null;}
  function family(row){
    if(!row)return null;
    const fuel=getFuel(),grade=typeof fuel?.parseFuelGrade==='function'?fuel.parseFuelGrade(row.fuelGrade):'';
    if(grade==='ДТ')return 'diesel';if(grade==='Газ')return 'gas';if(/^АИ-/.test(grade)||/^бензин$/i.test(String(row.fuelGrade||'').trim()))return 'gasoline';
    if(['diesel','gasoline','gas'].includes(row.fuel))return row.fuel;
    return present(row.fuel)?null:'diesel';
  }
  function recordTank(db,row){return own(row,'tankId')?row.tankId:find(db,'generators',row.generatorId)?.tankId??null;}
  function tankTimeline(db){
    const timelines=new Map();
    for(const tank of rows(db,'tanks')){
      const boundary=accountingState('tanks',tank);
      if(boundary.mode==='invalid')continue;
      timelines.set(idKey(tank.id),{tank,initial:boundary.mode==='explicit'?boundary.opening:quantity(tank.balanceInit),from:boundary.mode==='explicit'?boundary.from:null,events:new Map()});
    }
    const add=(tankId,date,value)=>{const timeline=timelines.get(idKey(tankId));if(timeline&&dateValid(date)&&(!timeline.from||date>=timeline.from)&&Number.isFinite(value))timeline.events.set(date,(timeline.events.get(date)||0)+value);};
    // Signed old transfer halves remain signed. A gen-record tankId:null is an
    // explicit detached source; falling back to its generator would debit twice.
    for(const row of rows(db,'tankIncomes'))add(row.tankId,row.date,amount(row));
    for(const row of rows(db,'genRecords'))add(recordTank(db,row),row.date,-quantity(row.fuelIssued));
    for(const row of rows(db,'fuelMovements'))if(live(row)&&number(row.qty)>=0){add(row.toTankId,row.date,number(row.qty));add(row.fromTankId,row.date,-number(row.qty));}
    return timelines;
  }
  function balancesAt(timeline,dates){
    const events=timeline?[...timeline.events].sort((a,b)=>a[0].localeCompare(b[0])):[],balances=new Map();let position=0,balance=timeline?.initial||0;
    for(const day of dates){while(position<events.length&&events[position][0]<=day){balance+=events[position][1];position++;}balances.set(day,timeline?.from&&day<timeline.from?null:balance);}
    return balances;
  }
  function analyze(db,context={}){
    const issues=[];
    const add=(section,row,code,field,message,proof,extra={})=>issues.push({severity:'error',section,recordId:row.id??'',code,field,message,proof,...extra});
    for(const section of ['vehicles','generators','tanks'])if(canRead(context,section))for(const row of rows(db,section)){
      const boundary=accountingState(section,row);
      if(boundary.mode==='invalid')add(section,row,'FUEL_ACCOUNTING_INVALID','fuelAccounting',boundary.error.message,[row.fuelAccounting]);
    }
    const movements=rows(db,'fuelMovements');
    if(canRead(context,'fuelMovements'))for(const row of movements){
      const qty=number(row.qty),from=present(row.fromTankId),to=present(row.toTankId);
      if(!(qty>0))add('fuelMovements',row,'FUEL_QUANTITY','qty','Количество топлива должно быть больше нуля',[row.qty]);
      if(!dateValid(row.date))add('fuelMovements',row,'FUEL_DATE','date','Укажите действительную дату движения топлива',[row.date]);
      if(!['receipt','return','issue','transfer','adjustment'].includes(row.kind))add('fuelMovements',row,'FUEL_KIND','kind','Неизвестный вид движения топлива',[row.kind]);
      const direction=row.kind==='transfer'?from&&to&&row.fromTankId!==row.toTankId:['receipt','return'].includes(row.kind)?!from&&to:row.kind==='issue'?from&&!to:row.kind==='adjustment'?row.originalMovementId?(from||to)&&(!from||!to||row.fromTankId!==row.toTankId):from!==to:false;
      if(!direction)add('fuelMovements',row,'FUEL_DIRECTION','fromTankId/toTankId','Проверьте направление: приход в ёмкость, выдача из ёмкости, перемещение между двумя разными ёмкостями',[row.kind,row.fromTankId,row.toTankId]);
      if(!present(row.reason))add('fuelMovements',row,'FUEL_REASON','reason','Укажите документ или основание движения топлива',[row.reason]);
      if(row.kind==='return'&&present(row.assetRef))add('fuelMovements',row,'FUEL_ASSET_RETURN','assetRef','Возврат из бака техники требует отдельного поддерживаемого документа; обычный возврат считается внешним',[row.kind,row.assetRef]);
      if(row.kind==='issue'&&present(row.assetRef)&&!(typeof row.assetRef==='string'&&/^[vg]:.+$/.test(row.assetRef)))add('fuelMovements',row,'FUEL_ISSUE_ASSET','assetRef','Выдачу можно связать с транспортом или ДЭС; для ёмкости используйте перемещение',[row.kind,row.assetRef]);
      if(!canRead(context,'tanks'))continue;
      const source=find(db,'tanks',row.fromTankId),target=find(db,'tanks',row.toTankId);
      if(source&&!family(source)||target&&!family(target))add('fuelMovements',row,'FUEL_TYPE_UNKNOWN','fromTankId/toTankId','Укажите известный вид топлива у используемой ёмкости',[source?.fuel,source?.fuelGrade,target?.fuel,target?.fuelGrade]);
      if(source&&target&&family(source)!==family(target))add('fuelMovements',row,'FUEL_GRADE_MISMATCH','fromTankId/toTankId','Виды топлива исходной и принимающей ёмкостей не совпадают',[row.fromTankId,row.toTankId,family(source),family(target)]);
      if(source&&row.sourceSnapshot?.fuel&&row.sourceSnapshot.fuel!==family(source))add('fuelMovements',row,'FUEL_SOURCE_MISMATCH','sourceSnapshot.fuel','Вид топлива снимка источника не совпадает с ёмкостью',[row.sourceSnapshot.fuel,family(source)]);
      if(row.kind==='issue'&&source&&present(row.assetRef)&&canRead(context,String(row.assetRef).startsWith('v:')?'vehicles':'generators')){
        const recipient=asset(db,row.assetRef);
        if(recipient&&(!family(source)||family(source)!==family(recipient)))add('fuelMovements',row,'FUEL_GRADE_MISMATCH','assetRef','Вид выданного топлива не соответствует выбранной технике',[row.assetRef,family(source),family(recipient)]);
      }
      if(row.kind!=='issue'||!present(row.assetRef))continue;
      const section=String(row.assetRef).startsWith('v:')?'records':'genRecords',other=section==='records'?'genRecords':'records';
      if(!canRead(context,section))continue;
      if(section==='genRecords'&&!row.legacyOverlapConfirmed&&rows(db,'genRecords').some(record=>String(record.generatorId)===String(row.assetRef).slice(2)&&record.date===row.date&&recordTank(db,record)===row.fromTankId&&quantity(record.fuelIssued)>0&&record.fuelMovementId!==row.id))add('fuelMovements',row,'FUEL_LEGACY_ISSUE_OVERLAP','legacyOverlapConfirmed','За эту дату уже есть выдача из той же ёмкости в журнале ДЭС. Подтвердите отдельную дополнительную выдачу',[row.assetRef,row.date,row.fromTankId,row.legacyOverlapConfirmed]);
      const matches=rows(db,section).filter(record=>record.id===row.recordId||record.fuelMovementId===row.id);
      if(matches.length!==1||!present(row.recordId)||matches[0]?.id!==row.recordId||matches[0]?.fuelMovementId!==row.id){add('fuelMovements',row,'FUEL_JOURNAL_LINK','recordId','Выдача в технику должна иметь единственную связанную запись журнала с обратной ссылкой',[row.recordId,matches.map(record=>[record.id,record.fuelMovementId])]);continue;}
      const record=matches[0],assetField=section==='records'?'vehicleId':'generatorId';
      if(String(record[assetField])!==String(row.assetRef).slice(2)||record.date!==row.date)add(section,record,'FUEL_JOURNAL_TARGET',assetField+'/date','Техника и дата связанного прихода должны совпадать с выдачей',[record[assetField],record.date,row.assetRef,row.date]);
      if(section==='genRecords'&&(!own(record,'tankId')||present(record.tankId)))add(section,record,'FUEL_JOURNAL_DOUBLE_DEBIT','tankId','Связанный приход ДЭС не должен повторно списывать ту же выдачу из ёмкости',[record.tankId,own(record,'tankId')]);
      const issued=row.reversedBy?0:qty;
      if(!sameQty(record.fuelIssued,issued)||row.reversedBy&&(!sameQty(record.originalFuelIssued,qty)||record.reversalId!==row.reversedBy||record.reversedAt!==row.reversedAt)||!row.reversedBy&&present(record.reversalId))add(section,record,'FUEL_JOURNAL_QUANTITY','fuelIssued/reversalId','Литры связанного прихода и данные сторно должны точно соответствовать движению',[record.fuelIssued,record.originalFuelIssued,record.reversalId,record.reversedAt,row.qty,row.reversedBy,row.reversedAt]);
      if(section==='records'&&source&&family({...record,fuel:asset(db,row.assetRef)?.fuel})!==family(source))add(section,record,'FUEL_JOURNAL_GRADE','fuelGrade','Марка связанного прихода не соответствует виду топлива ёмкости',[record.fuelGrade,family(source)]);
      if(canRead(context,other)&&rows(db,other).some(record=>record.fuelMovementId===row.id))add('fuelMovements',row,'FUEL_JOURNAL_DUPLICATE','recordId','Одна выдача не может создавать приходы в двух журналах',[row.id]);
    }
    if(canRead(context,'fuelMovements'))for(const section of ['records','genRecords'])if(canRead(context,section))for(const record of rows(db,section))if(present(record.fuelMovementId)){
      const movement=movements.find(row=>row.id===record.fuelMovementId);
      if(!movement||movement.kind!=='issue'||!movement.assetRef||movement.recordId!==record.id||!live(movement))add(section,record,'FUEL_JOURNAL_ORPHAN','fuelMovementId','Связанный приход должен ссылаться на действующую выдачу с той же записью журнала',[record.fuelMovementId,movement?.kind,movement?.recordId,movement?.cancelled,movement?.deleted]);
    }
    if(['genRecords','generators','tanks'].every(section=>canRead(context,section)))for(const record of rows(db,'genRecords'))if(quantity(record.fuelIssued)>0){
      const generator=find(db,'generators',record.generatorId),tank=find(db,'tanks',recordTank(db,record));
      if(generator&&tank&&(!family(tank)||family(generator)!==family(tank)))add('genRecords',record,'FUEL_GENERATOR_GRADE','tankId','Вид топлива ёмкости не соответствует выбранной ДЭС',[record.generatorId,recordTank(db,record),family(tank),family(generator)]);
    }
    if(canRead(context,'tankIncomes')&&canRead(context,'tanks'))for(const row of rows(db,'tankIncomes'))if(['in','out'].includes(row.kind)){
      const peers=rows(db,'tankIncomes').filter(other=>other.linkId===row.linkId),counter=peers.find(other=>other.id!==row.id),from=row.kind==='out'?row:counter,to=row.kind==='in'?row:counter;
      if(!present(row.linkId)||peers.length!==2||!from||!to||from.kind!=='out'||to.kind!=='in'||!(amount(from)<0)||!(amount(to)>0)||!sameQty(-amount(from),amount(to))||from.date!==to.date||from.tankId===to.tankId||from.counterTankId!==to.tankId||to.counterTankId!==from.tankId)add('tankIncomes',row,'FUEL_LEGACY_TRANSFER_PAIR','linkId','Старое перемещение должно содержать согласованные расходную и приходную строки',[row.linkId,peers.map(peer=>[peer.id,peer.kind,peer.tankId,peer.counterTankId,peer.date,amount(peer)])]);
      const source=from&&find(db,'tanks',from.tankId),target=to&&find(db,'tanks',to.tankId);
      if(source&&target&&family(source)!==family(target))add('tankIncomes',row,'FUEL_LEGACY_TRANSFER_GRADE','counterTankId','Нельзя перемещать топливо между ёмкостями разных видов',[family(source),family(target)]);
    }
    const stockReadable=['tanks','tankIncomes','genRecords','generators','fuelMovements'].every(section=>canRead(context,section));
    if(stockReadable)for(const timeline of tankTimeline(db).values())for(const [day,balance]of balancesAt(timeline,[...timeline.events.keys()].sort()))if(Number.isFinite(balance)&&balance<-EPS)add('tanks',timeline.tank,'FUEL_STOCK_DEFICIT','balance','Недостаточно расчётного топлива в ёмкости на '+day,[timeline.tank.id,day],{date:day,deficit:-balance});
    return issues;
  }
  function inspect(db,context={}){const issues=analyze(db,context);return {issues,counts:{error:issues.filter(issue=>issue.severity==='error').length,warning:issues.filter(issue=>issue.severity==='warning').length,total:issues.length}};}
  function generatorSpent(generator,row){
    if(present(row.fuelActual))return quantity(row.fuelActual);if(present(row.fuelUsed))return quantity(row.fuelUsed);
    const hours=quantity(row.hours),power=number(generator?.power),n100=number(generator?.norm100),load=number(row.load),n50=number(generator?.norm50),idle=number(generator?.normIdle);
    if(!hours||!(power>0)||!Number.isFinite(n100)||!Number.isFinite(load))return 0;
    const percent=load/power*100,rate=Number.isFinite(n50)?percent<=50&&Number.isFinite(idle)?idle+(n50-idle)*percent/50:n50+(n100-n50)*(percent-50)/50:n100*percent/100;
    return Math.round(Math.max(0,rate)*hours*100)/100;
  }
  function assetBalances(db,ref){
    const target=asset(db,ref),vehicle=String(ref).startsWith('v:'),section=vehicle?'records':'genRecords',assetField=vehicle?'vehicleId':'generatorId';
    const boundary=accounting(vehicle?'vehicles':'generators',target);
    const records=rows(db,section).filter(row=>String(row[assetField])===String(ref).slice(2)&&dateValid(row.date)&&(boundary.mode!=='explicit'||row.date>=boundary.from)).slice().sort((a,b)=>a.date.localeCompare(b.date));
    if(vehicle){const engine=getFuel();if(!engine||typeof engine.recordBalances!=='function')throw Error('Не загружено ядро расчёта ГСМ для проверки сторно');return {records,balances:engine.recordBalances(db,target?.id??String(ref).slice(2))};}
    let balance=boundary.mode==='explicit'?boundary.opening:quantity(target?.fuelBalance);const balances={};for(const record of records){balance+=quantity(record.fuelIssued)-generatorSpent(target,record);balances[record.id]=balance;}return {records,balances};
  }
  // Compare only facts used by fuel calculations. Legacy malformed settings
  // remain repairable during descriptive edits; they cannot authorize a new
  // fuel calculation by silently falling back to the old opening balance.
  function changedFuelRows(previous,next,section,fields){
    const project=row=>stable(Object.fromEntries(['id',...fields].map(field=>[field,row[field]])));
    const unmatched=new Map();
    for(const row of rows(previous,section)){const key=project(row);if(!unmatched.has(key))unmatched.set(key,[]);unmatched.get(key).push(row);}
    const changed=[];
    for(const row of rows(next,section)){const peers=unmatched.get(project(row));if(peers?.length)peers.pop();else changed.push({row,current:true});}
    for(const peers of unmatched.values())for(const row of peers)changed.push({row,current:false});
    return changed;
  }
  function accountingContextIssues(previous,next){
    if(!['vehicles','generators','tanks'].some(section=>rows(previous,section).some(row=>own(row,'fuelAccounting'))||rows(next,section).some(row=>own(row,'fuelAccounting'))))return [];
    const issues=[],seen=new Set(),states=new Map();
    const state=(section,id)=>{const key=section+':'+idKey(id);if(!states.has(key)){const row=find(next,section,id);states.set(key,{row,boundary:accountingState(section,row)});}return states.get(key);};
    const invalid=(section,id,origin)=>{
      const entry=state(section,id);if(entry.boundary.mode!=='invalid')return;
      const key=section+':'+idKey(id);if(seen.has(key))return;seen.add(key);
      issues.push({severity:'error',section,recordId:id??'',code:'FUEL_ACCOUNTING_CONTEXT_INVALID',field:'fuelAccounting',message:'Сначала исправьте начало учёта топлива: '+entry.boundary.error.message,relatedRecordId:origin.id??''});
    };
    const referenced=(row,section,field)=>{if(present(row[field]))invalid(section,row[field],row);};
    const movementAssets=row=>{
      const entries=[['tanks',row.fromTankId],['tanks',row.toTankId]];
      const target=asset(next,row.assetRef);if(target)entries.push([String(row.assetRef).startsWith('v:')?'vehicles':'generators',target.id]);
      return entries.filter(([,id])=>present(id));
    };
    const specs={
      records:['vehicleId','date','km','fuelIssued','fuelActual','fuelUsed','fuelIdle','tankMeasured','fuelGrade','fuelOrg','fuelMovementId'],
      genRecords:['generatorId','tankId','date','hours','load','fuelIssued','fuelActual','fuelUsed','fuelMovementId'],
      tankIncomes:['tankId','date','amount','liters','litres','qty','kind','deleted','cancelled'],
      fuelMovements:['fromTankId','toTankId','assetRef','recordId','date','qty','kind','deleted','cancelled','originalMovementId','reversedBy'],
    };
    for(const [section,fields]of Object.entries(specs))for(const change of changedFuelRows(previous,next,section,fields)){
      const row=change.row;
      if(section==='records')referenced(row,'vehicles','vehicleId');
      else if(section==='genRecords'){referenced(row,'generators','generatorId');invalid('tanks',recordTank(change.current?next:previous,row),row);}
      else if(section==='tankIncomes')referenced(row,'tanks','tankId');
      else for(const [target,id]of movementAssets(row)){
        invalid(target,id,row);
        const boundary=state(target,id).boundary;
        if(change.current&&live(row)&&dateValid(row.date)&&boundary.mode==='explicit'&&row.date<boundary.from)
          issues.push({severity:'error',section:'fuelMovements',recordId:row.id??'',code:'FUEL_BEFORE_ACCOUNTING',field:'date',date:row.date,message:'Дата нового движения топлива раньше начала учёта источника или получателя',proof:[target,id,boundary.from,row.date]});
      }
    }
    for(const [section,fields]of Object.entries({vehicles:['fuelAccounting','fuelBalance','fuelBalanceSources','fuel','fuelGrade','norm','normCity','normHighway','normIdle','org','orgHistory'],generators:['fuelAccounting','fuelBalance','fuel','fuelGrade','power','norm','norm100','norm50','normIdle','tankId'],tanks:['fuelAccounting','balanceInit','fuel','fuelGrade']}))
      for(const {row}of changedFuelRows(previous,next,section,fields))invalid(section,row.id,row);
    return issues;
  }
  function validateChanges(previous,next){
    const issues=[],oldIssues=analyze(previous),current=analyze(next),signature=issue=>stable([issue.section,issue.recordId,issue.code,issue.field,issue.proof]);
    const existing=new Set(oldIssues.map(signature));
    issues.push(...current.filter(issue=>issue.code!=='FUEL_STOCK_DEFICIT'&&!existing.has(signature(issue))));
    issues.push(...accountingContextIssues(previous,next));
    const beforeTimelines=tankTimeline(previous),afterTimelines=tankTimeline(next);
    for(const [key,timeline]of afterTimelines){const before=beforeTimelines.get(key),dates=[...new Set([...(before?.events.keys()||[]),...timeline.events.keys()])].sort(),oldBalances=balancesAt(before,dates),newBalances=balancesAt(timeline,dates);for(const day of dates){const value=newBalances.get(day),old=oldBalances.get(day);if(Number.isFinite(value)&&value<-EPS&&(old===null||value<old-EPS))issues.push({severity:'error',section:'tanks',recordId:timeline.tank.id??'',code:'FUEL_STOCK_DEFICIT',field:'balance',date:day,deficit:-value,message:'Операция создаёт или увеличивает нехватку топлива в ёмкости на '+day});}}
    const protectedFields=['fuelIssued','fuelMovementId','date','vehicleId','generatorId','tankId','fuelGrade','fuelOrg','fuelProvider','fuelSourceSnapshot','originalFuelIssued','reversalId','reversedAt'];
    for(const section of ['records','genRecords'])for(const before of rows(previous,section))if(present(before.fuelMovementId)){
      const after=find(next,section,before.id),movement=find(next,'fuelMovements',before.fuelMovementId),oldMovement=find(previous,'fuelMovements',before.fuelMovementId);
      if(!after){issues.push({severity:'error',section,recordId:before.id??'',code:'FUEL_JOURNAL_DELETE',field:'id',message:'Связанный приход нельзя удалить отдельно от исходного движения'});continue;}
      const changed=protectedFields.filter(field=>stable(before[field])!==stable(after[field]));
      const reversal=movement?.reversedBy&&!oldMovement?.reversedBy&&after.reversalId===movement.reversedBy;
      const allowed=reversal?new Set(['fuelIssued','originalFuelIssued','reversalId','reversedAt']):new Set();
      if(changed.some(field=>!allowed.has(field)))issues.push({severity:'error',section,recordId:before.id??'',code:'FUEL_JOURNAL_FROZEN',field:changed.join(','),message:'Источник, дата и литры связанного прихода защищены. Исправьте выдачу согласованным сторно'});
    }
    for(const movement of rows(next,'fuelMovements'))if(movement.originalMovementId&&!find(previous,'fuelMovements',movement.id)){
      const original=find(next,'fuelMovements',movement.originalMovementId);
      if(!original?.assetRef||original.kind!=='issue')continue;
      const after=assetBalances(next,original.assetRef),before=assetBalances(previous,original.assetRef);
      for(const record of after.records)if(record.date>=original.date&&after.balances[record.id]<-0.005&&after.balances[record.id]<(before.balances[record.id]??0)-0.005)issues.push({severity:'error',section:String(original.assetRef).startsWith('v:')?'records':'genRecords',recordId:record.id??'',code:'FUEL_REVERSAL_ASSET_DEFICIT',field:'fuelIssued',message:'Сторно создаёт нехватку топлива у техники на '+record.date,date:record.date});
    }
    if(issues.length){const error=new Error(issues.slice(0,5).map(issue=>issue.message).join('; '));error.name='FuelMovementPolicyError';error.code='POLICY_VIOLATION';error.issues=issues;error.details={issues};throw error;}
    return true;
  }
  return Object.freeze({apiVersion:1,inspect,validateChanges});
});
