'use strict';

// These capabilities copy only the database already bound to the trusted main
// window. A renderer can choose a new target, never an arbitrary source folder.
const path=require('node:path');
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function fail(code,message){throw Object.assign(Error(message),{code});}
function object(value,allowed){
 if(value===null||typeof value!=='object'||Array.isArray(value))fail('INVALID_UPGRADE','Нужны параметры обновлённой копии');
 for(const key of Reflect.ownKeys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!allowed.includes(key)||!descriptor?.enumerable||descriptor.get||descriptor.set)fail('INVALID_UPGRADE','Недопустимые параметры обновлённой копии');}
 return value;
}
function createHandlers(options){
 for(const name of ['getContext','assertContext','inspectSource','upgradeCopy'])if(typeof options?.[name]!=='function')throw TypeError('Missing schema upgrade capability: '+name);
 function context(){const value=options.getContext();if(!value||value.client||value.role!=='admin')fail('UPGRADE_ACCESS_DENIED','Обновлённую копию создаёт администратор на компьютере с исходной базой');if(typeof value.sourceDir!=='string'||!path.isAbsolute(value.sourceDir))fail('UPGRADE_SOURCE_REQUIRED','Сначала откройте исходную базу');return value;}
 async function inspect(payload={}){object(payload,[]);const captured=context();options.assertContext(captured);const result=await options.inspectSource({sourceDir:captured.sourceDir});options.assertContext(captured);return {...result,ok:true};}
 async function copy(payload){
  const input=object(payload,['targetDir','targetFormat','expectedSourceFingerprint']),captured=context();
  if(typeof input.targetDir!=='string'||!path.isAbsolute(input.targetDir)||input.targetDir.includes('\0')||!input.targetDir.trim())fail('UPGRADE_TARGET_REQUIRED','Укажите полный путь к новой папке копии');
  if(own(input,'targetFormat')&&!['json','sqlite'].includes(input.targetFormat))fail('INVALID_UPGRADE','Выберите JSON или SQLite');
  if(typeof input.expectedSourceFingerprint!=='string'||!/^sha256:[a-f0-9]{64}$/.test(input.expectedSourceFingerprint))fail('UPGRADE_REVIEW_REQUIRED','Сначала проверьте исходную базу и параметры копии');
  const source=path.resolve(captured.sourceDir),target=path.resolve(input.targetDir),relative=path.relative(source,target),reverse=path.relative(target,source);
  const contained=relativePath=>!relativePath||!path.isAbsolute(relativePath)&&relativePath!=='..'&&!relativePath.startsWith('..'+path.sep);
  if(contained(relative)||contained(reverse))fail('UPGRADE_TARGET_OVERLAP','Новая папка должна находиться отдельно от исходной базы');
  options.assertContext(captured);
  const result=await options.upgradeCopy({sourceDir:source,targetDir:target,expectedSourceFingerprint:input.expectedSourceFingerprint,...(own(input,'targetFormat')?{targetFormat:input.targetFormat}:{})});
  try{options.assertContext(captured);}catch(error){return {...result,ok:true,sessionChanged:true,message:'Обновлённая копия создана. База в программе переключена отдельно; исходная база не изменена.'};}
  return {...result,ok:true};
 }
 return Object.freeze({inspect,copy});
}
module.exports=Object.freeze({createHandlers});
