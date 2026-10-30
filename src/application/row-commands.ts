import {errorOf,fail,isId,object,type CatalogSection,type ChangeRows,type Database,type Options,type Persist,type Row,type RowEdit,type RowResult} from './contracts';
import type {Repository} from './repository';
import type {SaveService} from './save-service';

export function createRowCommands(repository:Repository,saves:SaveService,persist:(database:Database,options:Options)=>Promise<boolean>){
 const sections:readonly CatalogSection[]=['vehicles','generators','drivers'];
 async function execute(value:ChangeRows):Promise<RowResult>{
  let confirmed=false;
  try{
   const command=repository.copyRows([value])[0]!;
   if(command.type!=='ChangeRows'||command.version!==1||!sections.includes(command.section as CatalogSection)||typeof command.reason!=='string'||!command.reason.trim()||typeof command.operationId!=='string'||!command.operationId)fail('ROW_COMMAND','Нужна команда изменения записей с основанием и кодом операции.');
   const section=command.section as CatalogSection,edits=command.edits as unknown as RowEdit[];
   if(!Array.isArray(edits)||!edits.length||edits.length>1000)fail('ROW_COMMAND','За одну операцию можно изменить от 1 до 1000 записей.');
   const capture=repository.capture([section]),saved=repository.baseline(),live=repository.read([section]);
   if(JSON.stringify(saved[section]||[])!==JSON.stringify(live[section]||[]))fail('UNSAVED_SECTION','В этом справочнике есть другие несохранённые изменения. Сначала сохраните или отмените их.');
   const rows=(saved[section]||[]).slice(),seen=new Set<string>();
   for(const edit of edits){
    if(!isId(edit.id)||!object(edit.changes)||edit.expected!==null&&!object(edit.expected))fail('ROW_COMMAND','Проверьте код записи и поля изменения.');
    const key=JSON.stringify([typeof edit.id,edit.id]);if(seen.has(key))fail('ROW_COMMAND','Запись повторяется в одной операции.');seen.add(key);
    const matches=rows.map((row,index)=>({row,index})).filter(item=>item.row.id===edit.id);
    if(edit.expected===null?matches.length!==0:matches.length!==1||JSON.stringify(matches[0]!.row)!==JSON.stringify(edit.expected))fail('STALE_ROW','Запись изменилась. Откройте её заново и проверьте поля.');
    if(Object.hasOwn(edit.changes,'id')&&edit.changes.id!==edit.id)fail('ROW_ID','Код записи нельзя менять через поля карточки.');
    const next:Row={...(matches[0]?.row||{}),...edit.changes,id:edit.id};
    if(edit.removeFields!==undefined){if(!Array.isArray(edit.removeFields)||edit.removeFields.some(name=>typeof name!=='string'||name==='id'||['__proto__','prototype','constructor'].includes(name)))fail('ROW_FIELDS','Недопустимое удаляемое поле.');for(const name of edit.removeFields)delete next[name];}
    if(matches.length)rows[matches[0]!.index]=next;else rows.push(next);
   }
   const next={...saved,[section]:rows},auditCapture=repository.capture(['auditLog']),apply:Persist=options=>persist(next,options);
   if(!await saves.save(next,{noMerge:true,requiredCanonicalSections:[section],operation:{id:command.operationId},history:{action:'Изменение карточек',reason:command.reason}},apply))return {ok:false,code:'SAVE_UNCONFIRMED',message:'Сохранение не подтверждено. Введённые поля остаются в форме.'};
   confirmed=true;repository.assertCurrent(capture);const install:Database={[section]:next[section]!};
   // Observe ownership without requiring or exposing a readable history view.
   try{repository.assertCurrent(auditCapture);if(Array.isArray(next.auditLog))install.auditLog=next.auditLog;}catch{}
   repository.install(install);return {ok:true,rows:repository.copyRows(next[section]!.filter(row=>seen.has(JSON.stringify([typeof row.id,row.id]))))};
  }catch(error){const failure=errorOf(error);return {ok:false,...failure,...(confirmed?{committed:true,needsReload:true}:{})};}
 }
 return Object.freeze({execute});
}
