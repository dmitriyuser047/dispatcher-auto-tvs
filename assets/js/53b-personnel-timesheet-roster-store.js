/* Save reviewed cards and timesheet links with one acknowledged transaction. */
'use strict';
async function personnelTimesheetRosterStore(request) {
  if(personnelSaving || typeof unifiedPendingSaves!=='undefined' && unifiedPendingSaves) throw Error('Дождитесь завершения сохранения');
  const target=data,clone=value=>JSON.parse(JSON.stringify(value)),text=value=>JSON.stringify(value||[]);
  const assertSession=()=>{
    personnelAssertIdentity(request.identity);
    if(data!==target||platformPrepareAccessStamp(platformSessionContext())!==request.accessStamp) throw Error('База, пользователь или права изменились. Откройте проверку заново.');
    for(const section of ['drivers','assetDocuments']) if(!personnelCanRead(section)||!personnelCanWrite(section)) throw Error('Нет доступа к изменению справочника сотрудников и табелей.');
  };
  assertSession();
  if(typeof request.operationId!=='string'||!request.operationId.trim()||typeof request.reason!=='string'||request.reason.trim().length<5) throw Error('Укажите основание добавления сотрудников.');
  if(typeof request.now!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(request.now)||!Number.isFinite(Date.parse(request.now))) throw Error('Откройте проверку переноса заново: не зафиксировано время операции.');
  const context=platformSessionContext(),policy=context.accessPolicy;
  if(policy&&!policy.grants?.some(grant=>grant.org?.any===true&&grant.site?.any===true&&(!grant.actions||grant.actions.includes('read')))) throw Error('Для проверки дубликатов нужен полный доступ к справочнику сотрудников. Обратитесь к ответственному за справочник.');
  const readFields=policy?.sections?.drivers?.readFields;
  if(Array.isArray(readFields)&&!readFields.includes('*')) throw Error('Для проверки дубликатов нужен доступ ко всем полям справочника сотрудников.');
  const required={drivers:['name','org','site','personnelNumber','personnelRoles','employmentStatus'],assetDocuments:['kind','title','date','org','personnelTimesheet','createdAt','updatedAt']};
  for(const section of Object.keys(required)){
    const fields=context.fieldPermissions?.[section];
    if(fields&&(!Array.isArray(fields)||!fields.includes('*')&&required[section].some(field=>!fields.includes(field)))) throw Error('Недостаточно прав на поля справочника сотрудников или табеля.');
  }
  const baseline=platformSaveBaseline();
  const assertSources=()=>{
    assertSession();
    for(const section of ['drivers','assetDocuments']) if(text(data[section])!==request.baseline?.[section]) throw Error('Справочник или табели изменились после проверки. Откройте добавление в справочник заново.');
  };
  assertSources();
  for(const section of ['drivers','assetDocuments']) if(text(baseline[section])!==text(data[section])) throw Error('Сначала сохраните или отмените другие изменения справочника и табелей.');
  const plan=PersonnelTimesheetRoster.preview(baseline,request.model,request.options);
  if(!plan.canApply||plan.fingerprint!==request.reviewFingerprint) throw Error('Результат проверки изменился. Проверьте совпадения сотрудников заново.');
  const original=request.original??null,id=original?original.id:request.operationId,current=(baseline.assetDocuments||[]).filter(row=>row.id===id);
  if(original?current.length!==1||JSON.stringify(current[0])!==JSON.stringify(original):current.length!==0) throw Error('Сохранённый табель изменился. Откройте актуальный документ и повторите проверку.');
  if(original&&plan.createdIds.length===0&&JSON.stringify(original.personnelTimesheet)===JSON.stringify(plan.model)) return {record:clone(original),createdIds:[],plan};
  const record=PersonnelTimesheetDocument.makeRecord(plan.model,{id,previous:original,now:request.now}),next=clone(baseline);
  next.drivers=clone(plan.drivers);
  next.assetDocuments=original?(next.assetDocuments||[]).map(row=>row.id===id?record:row):(next.assetDocuments||[]).concat(record);
  const audit=text(data.auditLog),changed=['drivers','assetDocuments'].filter(section=>text(next[section])!==text(baseline[section]));
  personnelSaving=true;
  let saved=false;
  try {
    saved=await saveData(next,{noMerge:true,atomicSections:['drivers','assetDocuments'],requiredCanonicalSections:changed,operation:{id:request.operationId},history:{action:'Сотрудники из табеля',reason:request.reason.trim()}});
    if(saved!==true) throw Error('Сохранение не подтверждено. Введённые данные остаются в форме; повторите попытку.');
    assertSources();
    const records=(next.assetDocuments||[]).filter(row=>row.id===id);
    if(records.length!==1||JSON.stringify(records[0].personnelTimesheet)!==JSON.stringify(plan.model)) throw Error('База не вернула сохранённый табель со связями сотрудников.');
    PersonnelTimesheetDocument.validateRecord(records[0]);
    for(const item of plan.items) if(item.status==='create'||item.status==='matched') {
      const people=(next.drivers||[]).filter(row=>row.id===item.employeeId);
      if(people.length!==1||!TvsPersonnelEngine.matchesRole(people[0],plan.model.kind)) throw Error('База не вернула карточку сотрудника из табеля.');
    }
    data.drivers=clone(next.drivers);data.assetDocuments=clone(next.assetDocuments);
    if(text(data.auditLog)===audit)data.auditLog=clone(next.auditLog||[]);
    rebuildIndex();
    return {record:clone(records[0]),createdIds:clone(plan.createdIds),plan};
  } catch(error) {
    if(saved===true) throw Error('База подтвердила сохранение, но сеанс или исходные данные изменились. Проверьте исходную базу. '+error.message);
    throw error;
  } finally {personnelSaving=false;}
}
