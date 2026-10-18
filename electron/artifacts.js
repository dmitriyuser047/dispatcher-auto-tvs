const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {dialog,shell,BrowserWindow}=require('electron');
const AdmZip=require('adm-zip');
const storage=require('./storage');
const SAFE_EXT=new Set(['.pdf','.png','.jpg','.jpeg','.webp','.txt','.csv','.xlsx','.xls','.docx','.odt','.ods']);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function packageNameSafe(name){
 if(typeof name!=='string'||name.length>240||name.includes('\\')||name.startsWith('/'))return false;
 if(['database.json','settings.json','manifest.json'].includes(name))return true;
 const p=name.split('/');if(p.length!==2||!['attachments','import-sources','reestr-knowledge'].includes(p[0]))return false;
 return !!p[1]&&!/[\x00-\x1f\/:*?"<>|]/.test(p[1])&&!/[. ]$/.test(p[1])&&!/^\.{1,2}$/.test(p[1])&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p[1]);
}
function checkedBackupFiles(zip){
 const entries=zip.getEntries(),entryNames=new Set();let bytes=0;
 if(entries.length>10000)throw Error('Слишком много файлов в резервном пакете');
 for(const entry of entries){
  if(entry.isDirectory)continue;
  if(!packageNameSafe(entry.entryName)||entryNames.has(entry.entryName.toLowerCase()))throw Error('Недопустимый путь или дубль в ZIP');
  entryNames.add(entry.entryName.toLowerCase());
  if(((entry.attr>>>16)&0o170000)===0o120000)throw Error('Символьные ссылки в ZIP не допускаются');
  if(!Number.isSafeInteger(entry.header.size)||entry.header.size<0)throw Error('Некорректный размер файла');
  bytes+=entry.header.size;if(bytes>512*1024*1024)throw Error('Распакованные данные превышают 512 МБ');
 }
 const manifestEntry=zip.getEntry('manifest.json');
 if(!manifestEntry||manifestEntry.isDirectory||manifestEntry.header.size>5*1024*1024)throw Error('Нет корректного манифеста');
 const manifest=JSON.parse(manifestEntry.getData().toString('utf8'));
 if(manifest.format!=='tvs-backup'||manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length>9999)throw Error('Неверный манифест');
 const names=new Set(),checked=[];
 for(const file of manifest.files){
  if(!file||!packageNameSafe(file.name)||file.name==='manifest.json'||names.has(file.name.toLowerCase()))throw Error('Недопустимый путь или дубль в манифесте');
  if(!Number.isSafeInteger(file.size)||file.size<0||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Некорректные метаданные файла');
  names.add(file.name.toLowerCase());const entry=zip.getEntry(file.name);
  if(!entry||entry.isDirectory||entry.header.size!==file.size)throw Error('Нет файла или размер не совпадает: '+file.name);
  const b=entry.getData();if(b.length!==file.size||sha(b)!==file.sha256)throw Error('Ошибка контрольной суммы: '+file.name);
  if(/^(attachments|import-sources)\/[a-f0-9]{64}\./.test(file.name)&&path.posix.basename(file.name).slice(0,64)!==file.sha256)throw Error('Имя архивного файла не совпадает с SHA256');
  checked.push([file.name,b]);
 }
 if(entries.some(e=>!e.isDirectory&&e.entryName!=='manifest.json'&&!names.has(e.entryName.toLowerCase())))throw Error('В ZIP есть файлы вне манифеста');
 return checked;
}
function register({ipcMain,getDataDir,isClientMode,getSettings,knowledgeDir}){
 const local=()=>{if(isClientMode())throw Error('Файлы и резервный пакет создаются на компьютере с основной базой.');};
 const filePath=id=>{if(!/^[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(id))throw Error('Неверный ID файла');return path.join(getDataDir(),'attachments',id);};
 ipcMain.handle('add-attachment',async(event)=>{try{local();const r=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Добавить документ',properties:['openFile'],filters:[{name:'Документы',extensions:[...SAFE_EXT].map(x=>x.slice(1))}]});if(r.canceled)return {ok:false,canceled:true};const source=r.filePaths[0],ext=path.extname(source).toLowerCase();if(!SAFE_EXT.has(ext))throw Error('Неподдерживаемый тип документа');if(fs.statSync(source).size>25*1024*1024)throw Error('Файл больше 25 МБ');const b=fs.readFileSync(source),hash=sha(b),id=hash+ext,dest=filePath(id);fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.writeFileSync(dest,b,{flag:'wx'});return {ok:true,file:{id,name:path.basename(source),size:b.length,sha256:hash,addedAt:new Date().toISOString()}};}catch(e){return {ok:false,error:e.message};}});
 ipcMain.handle('open-attachment',async(_event,id)=>{try{local();const p=filePath(id);if(!SAFE_EXT.has(path.extname(p)))throw Error('Неподдерживаемый тип');const b=fs.readFileSync(p);if(sha(b)!==id.slice(0,64))throw Error('Контрольная сумма документа не совпала');const err=await shell.openPath(p);if(err)throw Error(err);return {ok:true};}catch(e){return {ok:false,error:e.message};}});
 ipcMain.handle('archive-import-source',async(_event,payload)=>{try{local();const b=Buffer.from(payload.bytes);if(b.length>25*1024*1024)throw Error('Исходный файл больше 25 МБ');const hash=sha(b),ext=path.extname(String(payload.name||'')).toLowerCase();const suffix=/^\.[a-z0-9]{1,6}$/.test(ext)?ext:'.bin',id=hash+suffix;const dest=path.join(getDataDir(),'import-sources',id);fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.writeFileSync(dest,b,{flag:'wx'});return {ok:true,id,sha256:hash,size:b.length,name:path.basename(String(payload.name||'source'))};}catch(e){return {ok:false,error:e.message};}});
 ipcMain.handle('create-backup-package',async(event)=>{
  try{
   local();const originalDir=path.resolve(getDataDir());
   const pick=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Резервный пакет базы и документов',defaultPath:'TVS-backup-'+new Date().toISOString().slice(0,10)+'.zip',filters:[{name:'ZIP',extensions:['zip']}]});
   if(pick.canceled)return {ok:false,canceled:true};local();if(path.resolve(getDataDir())!==originalDir)throw Error('Профиль базы изменился. Повторите операцию.');
   const zip=new AdmZip(),files=[],names=new Set();let total=0;
   const add=(name,buffer)=>{if(!packageNameSafe(name)||names.has(name.toLowerCase()))throw Error('Недопустимое имя или дубль файла резервной копии');total+=buffer.length;if(total>512*1024*1024||files.length>=9998)throw Error('Резервный пакет превышает 512 МБ или 10000 файлов');names.add(name.toLowerCase());zip.addFile(name,buffer);files.push({name,size:buffer.length,sha256:sha(buffer)});};
   add('database.json',Buffer.from(JSON.stringify(storage.readAll(originalDir))));add('settings.json',Buffer.from(JSON.stringify(getSettings())));
   for(const [prefix,dir]of [['attachments',path.join(originalDir,'attachments')],['import-sources',path.join(originalDir,'import-sources')],['reestr-knowledge',knowledgeDir()]]){
    if(!fs.existsSync(dir))continue;
    for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Символьные ссылки не включаются в резервный пакет');if(stat.isFile()){if(total+stat.size>512*1024*1024)throw Error('Резервный пакет превышает 512 МБ');add(prefix+'/'+name,fs.readFileSync(file));}}
   }
   zip.addFile('manifest.json',Buffer.from(JSON.stringify({format:'tvs-backup',version:1,createdAt:new Date().toISOString(),files})));
   const temp=pick.filePath+'.part-'+crypto.randomBytes(5).toString('hex');zip.writeZip(temp);fs.renameSync(temp,pick.filePath);return {ok:true,path:pick.filePath};
  }catch(e){return {ok:false,error:e.message};}
 });
 ipcMain.handle('verify-backup-package',async(event)=>{
  let target;
  try{
   local();const originalDir=path.resolve(getDataDir());
   const pick=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Выберите резервный пакет для проверки',properties:['openFile'],filters:[{name:'ZIP',extensions:['zip']}]});
   if(pick.canceled)return {ok:false,canceled:true};local();if(path.resolve(getDataDir())!==originalDir)throw Error('Профиль базы изменился. Повторите операцию.');
   if(fs.statSync(pick.filePaths[0]).size>512*1024*1024)throw Error('Слишком большой резервный пакет');
   const checked=checkedBackupFiles(new AdmZip(pick.filePaths[0]));
   const database=JSON.parse(checked.find(([n])=>n==='database.json')?.[1]?.toString('utf8')||'null');
   if(!database||!Array.isArray(database.vehicles)||!Array.isArray(database.records)||Object.entries(database).some(([n,r])=>storage.SECTIONS.includes(n)&&!Array.isArray(r)))throw Error('Повреждена структура базы');
   for(const [name,rows]of Object.entries(database)){if(!storage.SECTIONS.includes(name))continue;const ids=new Set();for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Повреждена запись раздела '+name);if(row.id!=null){if(typeof row.id!=='string'||ids.has(row.id))throw Error('Повторный или некорректный ID в '+name);ids.add(row.id);}}}
   const settingsFile=checked.find(([n])=>n==='settings.json');if(settingsFile){const s=JSON.parse(settingsFile[1].toString('utf8'));if(!s||typeof s!=='object'||Array.isArray(s))throw Error('Повреждены настройки резервной копии');}
   const folder=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Папка для отдельного восстановления',properties:['openDirectory','createDirectory']});
   if(folder.canceled)return {ok:false,canceled:true};local();if(path.resolve(getDataDir())!==originalDir)throw Error('Профиль базы изменился. Повторите операцию.');
   const parent=path.resolve(folder.filePaths[0]);target=path.resolve(parent,'TVS-restored-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex'));
   const relativeTarget=path.relative(parent,target);if(!relativeTarget||relativeTarget.startsWith('..')||path.isAbsolute(relativeTarget))throw Error('Неверная папка восстановления');fs.mkdirSync(target,{mode:0o700});
   for(const [name,b]of checked){const dest=path.resolve(target,name==='database.json'?'data.json':name);if(!dest.startsWith(target+path.sep))throw Error('Путь выходит за папку восстановления');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b,{flag:'wx',mode:0o600});}
   return {ok:true,path:target,rows:Object.values(database).filter(Array.isArray).reduce((s,r)=>s+r.length,0)};
  }catch(e){return {ok:false,error:e.message,path:target||null};}
 });
}
module.exports={register};
