'use strict';

// A query never grants access: the trusted main/HTTP boundary supplies a fresh
// principal, and the service checks that principal again for every page.
const fs=require('node:fs');
const crypto=require('node:crypto');
const storage=require('./storage');
const sqlite=require('./sqlite-storage.cjs');
const access=require('./access-control');
const schema=require('../assets/core/platform-schema.js');
const kernel=require('../assets/core/platform-kernel.js');
const identity=require('../assets/core/entity-identity.js');
const SEARCH_FIELDS=Object.freeze(['id','plate','make','model','name','title','number','driver','status','note','description','date','month','assetRef','vehicleId','generatorId','tankId','org','type','kind','unit','category']);
const SEARCH_FIELD_LIMIT=500;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function fail(code,message,status=400){const error=new Error(message);error.code=code;error.status=status;throw error;}
function dateBound(value,field){
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}(?:-\d{2})?$/.test(value))fail('QUERY_INVALID','Неверная граница даты: '+field);
  const [year,month,day]=value.split('-').map(Number),end=new Date(Date.UTC(year,month,0)).getUTCDate();
  if(year<1900||month<1||month>12||day!==undefined&&(day<1||day>end))fail('QUERY_INVALID','Неверная граница даты: '+field);
  return value;
}
function normalizeQuery(value){
  if(!plain(value)||Object.keys(value).some(key=>!['section','limit','cursor','from','to','assetRef','search'].includes(key)))fail('QUERY_INVALID','Неверные параметры выборки');
  if(!schema.sections.includes(value.section))fail('QUERY_INVALID','Неизвестный раздел выборки');
  const limit=value.limit??50;if(!Number.isSafeInteger(limit)||limit<1||limit>200)fail('QUERY_INVALID','Размер страницы должен быть от 1 до 200');
  const from=dateBound(value.from,'from'),to=dateBound(value.to,'to');
  if(from&&to&&from>to+'\uffff')fail('QUERY_INVALID','Начало периода позже окончания');
  const optional=(key,max)=>{const item=value[key];if(item===undefined||item===null)return null;if(typeof item!=='string'||!item||item.length>max||item.includes('\0'))fail('QUERY_INVALID','Неверный параметр '+key);return item;};
  const assetRef=optional('assetRef',510);if(assetRef&&!/^[vgt]:[^\r\n]+$/.test(assetRef))fail('QUERY_INVALID','Неверная ссылка на технику');
  const cursor=optional('cursor',4096),search=optional('search',200)?.trim().toLowerCase()||null;
  return {section:value.section,limit,cursor,from,to,assetRef,search};
}
function dateOf(row){return typeof row.date==='string'?row.date:typeof row.month==='string'?row.month:null;}
function assetOf(row){return typeof row.assetRef==='string'?row.assetRef:row.vehicleId!==undefined&&row.vehicleId!==null&&row.vehicleId!==''?'v:'+row.vehicleId:row.generatorId!==undefined&&row.generatorId!==null&&row.generatorId!==''?'g:'+row.generatorId:null;}
function searchScalar(value){return typeof value==='string'||typeof value==='number'&&Number.isFinite(value)?String(value).slice(0,SEARCH_FIELD_LIMIT):'';}
function searchText(row){return SEARCH_FIELDS.map(field=>searchScalar(row[field])).join('\n').toLowerCase();}
function matchesRow(row,query){
  const date=dateOf(row);
  return (!query.from||date!==null&&date>=query.from)&&(!query.to||date!==null&&date<=query.to+'\uffff')&&(!query.assetRef||assetOf(row)===query.assetRef)&&(!query.search||searchText(row).includes(query.search));
}
function scopeOf(principal,section){
  if(!plain(principal)||!Object.hasOwn(access.ROLES,principal.role)||typeof principal.id!=='string'||!principal.id||principal.id.length>500)fail('ACCESS_DENIED','Не подтверждена учётная запись',403);
  const normalized=require('./access-context.cjs').normalizePrincipal(principal);
  if(!access.authorize(normalized,'read',section))fail('ACCESS_DENIED','Раздел недоступен для вашей роли',403);
  return sha(kernel.stableSerialize({id:normalized.id,policyStamp:normalized.policyStamp}));
}
function filterHash(query){const {cursor,...selection}=query;return sha(kernel.stableSerialize(selection));}
function cursorFor(binding,position){
  const payload={version:1,...binding,position},text=kernel.stableSerialize(payload);
  return Buffer.from(JSON.stringify({payload,checksum:sha('tvs-data-page\0'+text)})).toString('base64url');
}
function cursorPosition(cursor,binding){
  if(!cursor)return -1;
  let decoded;
  try{
    if(!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();
    const bytes=Buffer.from(cursor,'base64url');if(bytes.toString('base64url')!==cursor)throw Error();
    decoded=JSON.parse(bytes.toString('utf8'));
    const p=decoded?.payload;
    if(!plain(decoded)||Object.keys(decoded).sort().join(',')!=='checksum,payload'||!plain(p)||Object.keys(p).sort().join(',')!=='databaseToken,filter,position,revision,scope,section,version'||p.version!==1||!Number.isSafeInteger(p.position)||p.position<0||!Number.isSafeInteger(p.revision)||p.revision<0||typeof decoded.checksum!=='string'||decoded.checksum!==sha('tvs-data-page\0'+kernel.stableSerialize(p)))throw Error();
  }catch{fail('CURSOR_INVALID','Повреждён указатель страницы. Начните выборку заново.');}
  if(Object.entries(binding).some(([key,value])=>decoded.payload[key]!==value))fail('CURSOR_STALE','Данные, фильтр или права изменились. Начните выборку заново.',409);
  return decoded.payload.position;
}
function queryRows(dataDir,input,principal){
  const query=normalizeQuery(input),scope=scopeOf(principal,query.section);
  if(require('./access-context.cjs').hasNarrowing(principal)){const normalized=require('./access-context.cjs').normalizePrincipal(principal),masks=[normalized.readFields?.[query.section],normalized.accessPolicy?.sections?.[query.section]?.readFields].filter(Array.isArray),can=field=>masks.every(fields=>fields.includes(field));const dateField=['fuelPeriods','monthlyFuel'].includes(query.section)?'month':'date',assetFields=schema.relations.filter(ref=>ref.from===query.section&&(['vehicleId','generatorId'].includes(ref.field)||ref.field==='assetRef')).map(ref=>ref.field);if((query.from||query.to)&&!can(dateField)||query.assetRef&&!(assetFields.length?assetFields:['assetRef','vehicleId','generatorId']).every(can))fail('QUERY_FIELD_ACCESS','Фильтр использует недоступное поле.',403);}
  // Audit contains historical nested financial data. The old snapshot path has
  // its own visibility policy; this indexed endpoint must not pretend that a
  // generic text index or a COUNT over raw audit rows is an authorised query.
  if(['auditLog','documentDrafts'].includes(query.section))fail('QUERY_UNSUPPORTED','Постраничная история и смешанные черновики пока недоступны. Используйте штатный просмотр документов.');
  if(typeof dataDir!=='string'||!dataDir||!fs.statSync(dataDir).isDirectory())fail('QUERY_DATABASE','Каталог базы не найден');
  return storage.withDatabaseLock(dataDir,()=>{
    const sql=sqlite.exists(dataDir);
    const action=()=>{
      let revision,databaseToken,jsonRows,database;
      const scoped=require('./access-context.cjs').hasNarrowing(principal);
      if(sql){revision=sqlite.readRevisions(dataDir)[query.section];databaseToken=storage.databaseToken(dataDir);}
      else{const section=storage.readSection(dataDir,query.section);revision=section.rev;databaseToken=section.databaseToken;jsonRows=section.rows;}
      if(scoped){database=storage.readAll(dataDir);jsonRows=database[query.section]||[];}
      const scopedContext=scoped?require('./access-context.cjs').create(database,database,principal):null;
      const binding={databaseToken,section:query.section,revision,filter:filterHash(query),scope},afterPosition=cursorPosition(query.cursor,binding);
      if(query.assetRef){
        const section={v:'vehicles',g:'generators',t:'tanks'}[query.assetRef[0]],ambiguous=sql?sqlite.countLegacyAssetReferences(dataDir,section,query.assetRef.slice(2))>1:identity.resolveAsset({[section]:storage.readSection(dataDir,section).rows},query.assetRef).status==='ambiguous';
        if(scoped){const target=identity.resolveAsset(database,query.assetRef);if(target.status!=='known'||!scopedContext.permits(target.section,'read',target.row))fail('ACCESS_DENIED','Недостаточно прав для выбранной ссылки.',403);}
        if(ambiguous)fail('QUERY_ASSET_AMBIGUOUS','Ссылка на технику неоднозначна. Проверьте ID карточек.');
      }
      let rows,positions,total,hasMore;
      if(sql&&!scoped){
        const page=sqlite.queryRows(dataDir,{section:query.section,limit:query.limit,from:query.from,to:query.to,assetRef:query.assetRef,search:query.search,afterPosition});
        ({rows,positions,total,hasMore}=page);
      }else{
        const matching=[];jsonRows.forEach((original,position)=>{
          const row=scoped?require('./platform-service.cjs').visibleRows(query.section,[original],principal,database,scopedContext)[0]:original;
          if(!row)return;
          if(matchesRow(row,query))matching.push({row,position});
        });total=matching.length;
        const candidates=matching.filter(entry=>entry.position>afterPosition),page=candidates.slice(0,query.limit);
        rows=page.map(entry=>entry.row);positions=page.map(entry=>entry.position);hasMore=candidates.length>query.limit;
      }
      if(!scoped)rows=require('./platform-service.cjs').visibleRows(query.section,rows,principal,database);
      return {ok:true,section:query.section,revision,databaseToken,policyStamp:require('./access-context.cjs').policyStamp(principal),rows,total,nextCursor:hasMore?cursorFor(binding,positions.at(-1)):null,backend:sql?'sqlite':'json'};
    };
    return sql?sqlite.transaction(dataDir,action,{readOnly:true}):action();
  });
}
module.exports=Object.freeze({queryRows,normalizeQuery,SEARCH_FIELDS,SEARCH_FIELD_LIMIT,searchScalar,matchesRow});
