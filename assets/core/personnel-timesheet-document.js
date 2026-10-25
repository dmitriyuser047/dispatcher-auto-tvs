/* A personnel timesheet is a standalone employee document, not a shift fact. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(()=>require('./personnel-timesheet.js'));else root.PersonnelTimesheetDocument=factory(()=>root.PersonnelTimesheet);})(typeof globalThis==='object'?globalThis:this,function(getTimesheet){
  'use strict';
  const KIND='personnel-timesheet',own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key),plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const key=value=>typeof value+':'+JSON.stringify(value);
  function fail(message,field){const error=Error(message);error.code='PERSONNEL_TIMESHEET_DOCUMENT';error.field=field;throw error;}
  function isDocument(row){return plain(row)&&(row.kind===KIND||own(row,'personnelTimesheet'));}
  function core(){const api=getTimesheet();if(api?.apiVersion!==1||typeof api.validate!=='function')throw Object.assign(Error('Не загружены правила табеля сотрудников'),{code:'MODULE_UNAVAILABLE'});return api;}
  function validateRecord(row){
    if(!plain(row)||row.kind!==KIND||!own(row,'personnelTimesheet'))fail('Табель открывайте в разделе загрузки сотрудников','kind');
    if(!['string','number'].includes(typeof row.id)||typeof row.id==='string'&&!row.id.trim()||typeof row.id==='number'&&!Number.isSafeInteger(row.id))fail('Не указан идентификатор табеля','id');
    const model=row.personnelTimesheet;core().validate(model);
    if(typeof model.org!=='string'||row.org!==model.org||row.date!==model.from)fail('Организация и дата документа должны совпадать с табелем. Измените их в разделе загрузки сотрудников','org');
    if(typeof row.title!=='string'||!row.title.trim()||row.title.length>500)fail('Укажите название табеля','title');
    if(['driverId','assetRef'].some(field=>own(row,field)&&row[field]!==null&&row[field]!==''))fail('Общий табель хранится отдельно от документов одного сотрудника или единицы техники','driverId');
    return row;
  }
  function makeRecord(model,options={}){
    core().validate(model);const old=options.previous;
    if(old&&!isDocument(old))fail('Выбранный документ не является табелем','id');
    const now=options.now||new Date().toISOString(),id=options.id??old?.id;
    const title=model.title||'Табель '+(model.kind==='operator'?'машинистов ДЭС':'водителей')+' с '+model.from+' по '+model.to;
    const record={...(old?clone(old):{}),id,kind:KIND,title,date:model.from,org:model.org,personnelTimesheet:clone(model),createdAt:old?.createdAt||now,updatedAt:now};
    validateRecord(record);return record;
  }
  function list(database,kind){return (Array.isArray(database?.assetDocuments)?database.assetDocuments:[]).filter(row=>isDocument(row)&&row.kind===KIND&&plain(row.personnelTimesheet)&&(!kind||row.personnelTimesheet.kind===kind));}
  function validateChanges(previous,next){
    const before=Array.isArray(previous?.assetDocuments)?previous.assetDocuments:[],after=Array.isArray(next?.assetDocuments)?next.assetDocuments:[],old=new Map(before.filter(plain).map(row=>[key(row.id),row]));
    for(const row of after){if(!plain(row))continue;const prior=old.get(key(row.id));if(!isDocument(row)&&!isDocument(prior))continue;if(JSON.stringify(prior)===JSON.stringify(row))continue;
      if(isDocument(prior)&&!isDocument(row))fail('Нельзя превратить сохранённый табель в обычный документ. Откройте его в разделе загрузки сотрудников','kind');
      validateRecord(row);
    }
    return true;
  }
  return Object.freeze({apiVersion:1,kind:KIND,isDocument,validateRecord,makeRecord,list,validateChanges});
});
