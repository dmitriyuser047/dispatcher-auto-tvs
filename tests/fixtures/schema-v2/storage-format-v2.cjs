'use strict';
// Business schema versions are independent of the JSON/SQLite container format.
const schema=require('../assets/core/platform-schema.js');
const FORMAT='tvs-platform-json',FORMAT_VERSION=1,SCHEMA_VERSION=2;
const legacySections=()=>schema.sections.filter(name=>name!=='documentDrafts');
function fail(code,message){const error=new Error(message);error.code=code;error.status=428;throw error;}
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function decodeRevisions(raw){
 if(!plain(raw))fail('STORAGE_FORMAT','Повреждены версии разделов базы');
 if(Object.hasOwn(raw,'format')){
  if(raw.format!==FORMAT||raw.formatVersion!==FORMAT_VERSION||raw.schemaVersion!==SCHEMA_VERSION||raw.vehicles!==null||raw.records!==null||!plain(raw.revisions)||Object.keys(raw).some(name=>!['format','formatVersion','schemaVersion','vehicles','records','revisions'].includes(name)))fail('STORAGE_FORMAT','Неподдерживаемая версия JSON базы');
  const revisions=raw.revisions;
  if(Object.keys(revisions).length!==schema.sections.length||schema.sections.some(name=>!Number.isSafeInteger(revisions[name])||revisions[name]<0)||Object.keys(revisions).some(name=>!schema.sections.includes(name)))fail('STORAGE_REVISIONS','Повреждены версии разделов базы');
  return {schemaVersion:SCHEMA_VERSION,revisions:{...revisions}};
 }
 if(Object.keys(raw).some(name=>!legacySections().includes(name))||['vehicles','records'].some(name=>!Number.isSafeInteger(raw[name])||raw[name]<0)||Object.values(raw).some(value=>!Number.isSafeInteger(value)||value<0))fail('STORAGE_REVISIONS','Неизвестная или повреждённая структура старой JSON базы');
 return {schemaVersion:1,revisions:Object.fromEntries(schema.sections.map(name=>[name,raw[name]??0]))};
}
function encodeRevisions(revisions){
 const result={format:FORMAT,formatVersion:FORMAT_VERSION,schemaVersion:SCHEMA_VERSION,vehicles:null,records:null,revisions};
 decodeRevisions(result);return result;
}
function upgradeRequired(){fail('SCHEMA_UPGRADE_REQUIRED','База открыта для чтения. Создайте отдельную обновлённую копию базы для новых документов. Исходная база останется без изменений.');}
module.exports=Object.freeze({FORMAT,FORMAT_VERSION,SCHEMA_VERSION,legacySections,decodeRevisions,encodeRevisions,upgradeRequired});
