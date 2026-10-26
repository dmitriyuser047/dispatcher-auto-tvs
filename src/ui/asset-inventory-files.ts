/** Browser-selected bytes only. The host decodes, binds and stores sources;
 * this UI never supplies interpreted rows or a filesystem path. */
namespace AssetInventoryFiles {
 type Id=AssetInventoryWorkspace.Id;
 type Row=AssetInventoryWorkspace.Row;
 type Snapshot=AssetInventoryWorkspace.Snapshot;
 type Result=AssetInventoryWorkspace.FileResult;
 type Format='legacy'|'osv'|'comparison'|'auto';
 interface State {
  overlay:HTMLDivElement;form:HTMLFormElement;captured:Snapshot;sourceText:string;token:string;
  file:File|null;reader:FileReader|null;base64:string|null;sourceId:string|null;source:Row|null;mappingText:string;stagedFile:File|null;
  preview:Row|null;reviewInput:string;operationId:string|null;uncertain:boolean;busy:boolean;revoked:boolean;
  choices:Map<string,Id>;warnings:Row[];resolve:(result:Result)=>void;
 }
 const ownSections=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions'];
 const sectionLabels:Record<string,string>={inventoryOrgs:'Организации',inventoryObjects:'Объекты',inventoryMols:'МОЛ',inventoryItems:'Имущество',inventorySessions:'Описи'};
 const LIMIT=25*1024*1024;
 let active:State|null=null;
 const esc=(value:unknown):string=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]??char));
 const record=(value:unknown):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
 const items=(value:unknown):Row[]=>Array.isArray(value)?value.map(record):[];
 const string=(value:unknown):string=>typeof value==='string'?value:'';
 const text=(error:unknown):string=>error instanceof Error?error.message:String(error);
 const source=(snapshot:Snapshot):string=>JSON.stringify(ownSections.map(name=>[name,snapshot.database[name]??[]]));
 function required<T extends Element>(parent:ParentNode,selector:string):T {const node=parent.querySelector<T>(selector);if(!node)throw Error('Окно работы с файлами закрыто');return node;}
 function field(s:State,name:string):HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement {return required(s.form,'[name="'+name+'"]');}
 function supported(snapshot:Snapshot):boolean {return snapshot.isSQLite&&snapshot.schemaVersion===6&&snapshot.capabilities.some(value=>value.name==='inventoryV1'&&value.version===1);}
 function verify(captured:Snapshot,baseline:string|null,write:boolean):Snapshot {
  const current=assetInventoryHostSnapshot();
  if(current.database!==captured.database||current.identity!==captured.identity||!current.canRead)throw Error('База, пользователь или доступ изменились. Откройте работу с файлом заново.');
  if(baseline!==null&&(current.analysisStamp!==captured.analysisStamp||source(current)!==baseline||current.today!==captured.today))throw Error('Исходные данные или права изменились. Повторно откройте импорт и проверьте источник.');
  if(!supported(current))throw Error('Нужна отдельная обновлённая копия SQLite с поддержкой инвентаризации.');
  if(write&&!current.canWrite)throw Error('Нет права импорта данных инвентаризации.');
  return current;
 }
 function check(s:State,baseline=true):void {if(active!==s||s.revoked||!s.form.isConnected)throw Error('Окно импорта закрыто или относится к другому сеансу');verify(s.captured,baseline?s.sourceText:null,true);if(assetInventoryDatabaseToken()!==s.token)throw Error('Выбрана другая база. Откройте импорт заново.');}
 function showError(s:State,error:unknown):void {if(active===s&&!s.revoked)required<HTMLElement>(s.form,'[data-ai-file-error]').textContent=text(error);}
 function lock(s:State,busy:boolean):void {
  s.busy=busy;
  s.overlay.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|HTMLButtonElement>('input,select,textarea,button').forEach(element=>{
   const isConfirm=element.getAttribute('name')==='confirm';
   const isCommit=element.hasAttribute('data-ai-file-commit');
   const isClose=element.hasAttribute('data-ai-file-close');
   element.disabled=busy||s.uncertain&&!isClose&&!isCommit;
   if(isCommit)element.disabled=busy||s.preview?.canApply!==true||!required<HTMLInputElement>(s.form,'[name=confirm]').checked;
   if(isConfirm&&s.preview?.canApply!==true)element.disabled=true;
  });
  required<HTMLElement>(s.form,'[data-ai-file-status]').textContent=busy?'Ожидается подтверждение…':'';
  if(busy)s.overlay.focus();
  else if(document.activeElement===s.overlay||document.activeElement===document.body){const target=s.preview?.canApply===true?required<HTMLInputElement>(s.form,'[name=confirm]'):required<HTMLButtonElement>(s.form,'[data-ai-file-review]');if(!target.disabled)target.focus();}
 }
 function clearPreview(s:State,restage:boolean):void {
  if(s.busy||s.uncertain)return;
  s.preview=null;s.reviewInput='';s.operationId=null;required<HTMLElement>(s.form,'[data-ai-file-confirm]').hidden=true;required<HTMLInputElement>(s.form,'[name=confirm]').checked=false;
  required<HTMLElement>(s.form,'[data-ai-file-preview]').replaceChildren();
  if(restage){s.sourceId=null;s.source=null;s.base64=null;s.mappingText='';s.stagedFile=null;s.warnings=[];}
  lock(s,false);
 }
 function finish(s:State,result:Result):void {
  if(active!==s)return;s.reader?.abort();s.reader=null;s.base64=null;s.file=null;s.stagedFile=null;s.source=null;s.preview=null;s.choices.clear();
  const file=s.form.querySelector<HTMLInputElement>('[name=file]');if(file)file.value='';s.overlay.remove();active=null;s.resolve(result);
 }
 function close(s:State):void {
  if(s.busy)return;
  if(s.uncertain){if(!window.confirm('Результат импорта пока неизвестен. Закрытие окна не отменит уже выполненную операцию. Проверить результат позднее?'))return;finish(s,{ok:false,error:'Результат импорта пока неизвестен. Проверьте квитанцию операции и список имущества перед повторным добавлением источника.'});return;}
  if(s.file&&!window.confirm('Закрыть предпросмотр импорта? Реестр и описи ещё не изменены.'))return;
  finish(s,{ok:false,cancelled:true});
 }
 export function hasPending():boolean {return active!==null;}
 export function revoke():void {
  const s=active;if(!s)return;s.revoked=true;s.reader?.abort();s.reader=null;s.base64=null;s.file=null;s.stagedFile=null;s.source=null;s.preview=null;
  required<HTMLInputElement>(s.form,'[name=file]').value='';s.overlay.remove();s.choices.clear();active=null;
  s.resolve({ok:false,error:'Сеанс изменился. Окно импорта и выбранный файл очищены.'});
 }
 function options(s:State,section:string,selected:Id|undefined):string {
  return '<option value="">Не выбран</option>'+(s.captured.database[section]??[]).filter(row=>!row.archived).map(row=>{
   if(typeof row.id!=='string'&&typeof row.id!=='number')return '';
    const token='target-'+s.choices.size;s.choices.set(token,row.id);const name=(key:string,id:unknown):unknown=>(s.captured.database[key]??[]).find(value=>value.id===id)?.name??'Неизвестно';return '<option value="'+token+'"'+(row.id===selected?' selected':'')+'>'+esc(row.name)+(section==='inventoryMols'?' · '+esc(name('inventoryOrgs',row.orgId))+' / '+esc(name('inventoryObjects',row.objectId))+' · '+esc(row.accountCode):'')+'</option>';
  }).join('');
 }
 function selected(s:State,name:string,section:string):Id|undefined {
  const token=field(s,name).value;if(!token)return undefined;const id=s.choices.get(token);
  if(id===undefined||!(s.captured.database[section]??[]).some(row=>row.id===id&&!row.archived))throw Error('Выбранный справочник больше недоступен');return id;
 }
 function mapping(s:State):Row {
  const format=field(s,'format').value as Format,date=field(s,'date').value;
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date)||!date&&format!=='auto')throw Error('Укажите дату источника или выберите автоматический разбор документа.');
  const result:Row={format,...(date?{date}:{})};
  for(const name of ['defaultOrgName','defaultObjectName','title']){const value=field(s,name).value;if(value.trim())result[name]=value;}
  if(format==='osv')result.useOpeningIfNoClosing=(field(s,'useOpeningIfNoClosing') as HTMLInputElement).checked;
  if(format!=='legacy'){
   const orgId=selected(s,'targetOrg','inventoryOrgs'),objectId=selected(s,'targetObject','inventoryObjects'),molId=selected(s,'targetMol','inventoryMols');
   const target={...(orgId===undefined?{}:{orgId}),...(objectId===undefined?{}:{objectId}),...(molId===undefined?{}:{molId})};if(Object.keys(target).length)result.target=target;
  }
  return result;
 }
 function formatVisibility(s:State):void {const format=field(s,'format').value;required<HTMLElement>(s.form,'[data-ai-file-targets]').hidden=format==='legacy';required<HTMLElement>(s.form,'[data-ai-file-opening]').hidden=format!=='osv';}
 function readBytes(s:State,file:File):Promise<string> {
  if(file.size<=0||file.size>LIMIT)throw Error('Выберите непустой файл размером не более 25 МБ.');
  return new Promise((resolve,reject)=>{
   const reader=new FileReader();s.reader=reader;
   reader.onload=()=>{s.reader=null;const result=reader.result;
    if(typeof result!=='string'){reject(Error('Не удалось прочитать исходные байты файла'));return;}
    const match=/^data:[^,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(result),encoded=match?.[1];
    if(!encoded||encoded.length>Math.ceil(LIMIT/3)*4){reject(Error('Неверный размер или кодирование исходного файла'));return;}
    const padding=encoded.endsWith('==')?2:encoded.endsWith('=')?1:0,actual=encoded.length/4*3-padding;
    if(actual!==file.size||actual<=0||actual>LIMIT){reject(Error('Число прочитанных байтов не соответствует выбранному файлу'));return;}
    resolve(encoded);
   };
   reader.onerror=()=>{s.reader=null;reject(Error('Не удалось прочитать выбранный файл'));};reader.onabort=()=>{s.reader=null;reject(Error('Чтение файла прекращено после закрытия окна'));};reader.readAsDataURL(file);
  });
 }
 function messages(value:unknown,kind:string):string {return items(value).map(issue=>'<p class="'+kind+'">'+esc(issue.message||issue.code||'Проверьте источник')+'</p>').join('');}
 function warnings(s:State,...values:unknown[]):string {const seen=new Set<string>(),all=[...s.warnings,...values.flatMap(items)];return messages(all.filter(value=>{const key=JSON.stringify([value.code,value.message]);if(seen.has(key))return false;seen.add(key);return true;}),'ai-muted');}
 function sourceHtml(sourceValue:Row):string {
  const data=record(sourceValue.data);if(ownSections.some(section=>!Array.isArray(data[section])))throw Error('Сервер не подтвердил полный состав собственных разделов источника');
  let html='<h4>Состав выбранного источника</h4><p>'+ownSections.map(section=>sectionLabels[section]+': '+items(data[section]).length).map(esc).join(' · ')+'</p>';
  const sessions=items(data.inventorySessions);if(sessions.length)html+='<div data-ai-source-sessions class="ai-summary">'+sessions.map(session=>'<p><strong>'+esc(session.objectName)+'</strong> · '+esc(session.orgName||'Организация из строк описи')+' · дата описи '+esc(session.date)+' · позиций '+items(session.rows).length+'</p>').join('')+'</div>';
  const positions=items(data.inventoryItems);html+='<div class="ai-scroll"><table><thead><tr><th>Имущество</th><th>Код</th><th>Единица</th><th>Учётное количество</th><th>Учётная стоимость</th></tr></thead><tbody>'+positions.slice(0,50).map(row=>'<tr><td>'+esc(row.name)+'</td><td>'+esc(row.code)+'</td><td>'+esc(row.unit||'Не задано')+'</td><td>'+esc(typeof row.qty==='number'?row.qty:'Неизвестно')+'</td><td>'+esc(typeof row.cost==='number'?row.cost:'Неизвестно')+'</td></tr>').join('')+'</tbody></table></div>';
  if(positions.length>50)html+='<p>Показаны первые 50 из '+positions.length+' позиций. Будет проверен весь источник.</p>';
  return html+'<p class="ai-muted">Неизвестные значения не заменяются нулём. Единицы и учётные значения черновика можно позднее исправить отдельно с сохранением причины. Импорт не утверждает описи.</p>';
 }
 function importInput(s:State):Row {
  if(!s.sourceId||!s.source)throw Error('Сначала проверьте источник');
  const format=s.source.format;if(!['inventory-legacy-json','inventory-osv','inventory-comparison'].includes(string(format)))throw Error('Не подтверждён формат источника');
  const reason=field(s,'reason').value;if(reason.trim().length<3)throw Error('Укажите основание импорта не короче трёх символов');
  return {action:format==='inventory-legacy-json'?'importLegacy':'importRows',sourceId:s.sourceId,reason};
 }
 async function review(s:State):Promise<void> {
  if(s.busy||s.uncertain)return;
  try{
   check(s);const file=required<HTMLInputElement>(s.form,'[name=file]').files?.[0]??s.file;if(!file)throw Error('Выберите исходный файл');
   const map=mapping(s),format=map.format;
   if(format==='legacy'?!/\.json$/i.test(file.name):! /\.xlsx?$/i.test(file.name))throw Error(format==='legacy'?'Для переноса прежней базы выберите JSON-файл.':'Выберите исходную книгу XLS или XLSX.');
   if(field(s,'reason').value.trim().length<3)throw Error('Укажите основание импорта не короче трёх символов');
   const rpc=assetInventoryImportSource;
   s.file=file;clearPreview(s,false);lock(s,true);showError(s,'');
   const mapText=JSON.stringify(map);
   if(!s.sourceId||s.mappingText!==mapText||s.stagedFile!==file){
    s.base64=await readBytes(s,file);check(s);
    const staged=await rpc({action:'stage',profile:'asset-inventory',parser:{id:'asset-inventory',version:1},sections:ownSections.slice(),source:{name:file.name,base64:s.base64},mapping:map,databaseToken:s.token});s.base64=null;check(s);
    if(!staged.ok){required<HTMLElement>(s.form,'[data-ai-file-preview]').innerHTML=messages(staged.issues,'ai-error')+messages(staged.warnings,'ai-muted');throw Error(staged.error||staged.message||'Сервер не смог проверить исходный файл');}
    if(staged.databaseToken!==s.token)throw Error('Ответ относится к другой базе. Повторно откройте импорт.');
    const box=required<HTMLElement>(s.form,'[data-ai-file-preview]');
    if(staged.canImport===false){s.sourceId=null;s.source=null;s.preview=null;box.innerHTML='<h4>Источник нельзя импортировать полностью</h4>'+messages(staged.issues,'ai-error')+messages(staged.warnings,'ai-muted');throw Error('Импорт заблокирован: неполный или неоднозначный источник не будет добавлен частично.');}
    if(!staged.ok||!staged.source||typeof staged.sourceId!=='string'||! /^[a-f0-9]{64}$/.test(staged.sourceId))throw Error(staged.error||staged.message||'Сервер не подтвердил исходный файл');
    sourceHtml(staged.source);s.sourceId=staged.sourceId;s.source=staged.source;s.mappingText=mapText;s.stagedFile=file;s.warnings=[...items(staged.warnings),...items(staged.source.warnings)];
    box.innerHTML=sourceHtml(staged.source)+messages(staged.warnings,'ai-muted');
   }
   const input=importInput(s),reply=await rpc({action:'preview',profile:'asset-inventory',sourceId:s.sourceId,reason:input.reason,databaseToken:s.token});check(s);
   if(!reply.ok||reply.databaseToken!==s.token||!reply.preview)throw Error(reply.error||reply.message||'Предпросмотр источника не подтверждён');
   if(reply.input&&(reply.input.sourceId!==s.sourceId||reply.input.action!==input.action||reply.input.reason!==input.reason))throw Error('Предпросмотр относится к другому действию');
   const preview=reply.preview;if(typeof preview.fingerprint!=='string'||!/^sha256:[a-f0-9]{64}$/.test(preview.fingerprint))throw Error('Сервер не подтвердил отпечаток проверки');
   s.preview=preview;s.reviewInput=JSON.stringify(input);
   required<HTMLElement>(s.form,'[data-ai-file-preview]').innerHTML=sourceHtml(s.source!)+messages(preview.issues,'ai-error')+warnings(s,preview.warnings)+'<p><strong>'+(preview.canApply===true?'Весь источник проверен. Импорт будет выполнен одной операцией.':'Импорт заблокирован. Исправьте источник или параметры.')+'</strong></p>';
   required<HTMLElement>(s.form,'[data-ai-file-confirm]').hidden=preview.canApply!==true;required<HTMLInputElement>(s.form,'[name=confirm]').checked=false;
  }catch(error){showError(s,error);}finally{if(active===s&&!s.revoked){s.base64=null;lock(s,false);}}
 }
 function canonical(s:State,ack:AssetInventoryWorkspace.Ack):void {
  if(!s.operationId||ack.operationReceipt?.id!==s.operationId||!ack.canonicalSections)throw Error('Сервер не вернул квитанцию и канонические разделы импорта');
  const snapshot=assetInventoryHostSnapshot();let imported=false,confirmed=false;
  for(const name of ownSections){const values=ack.canonicalSections[name];if(!values)continue;confirmed=true;if(JSON.stringify(values)!==JSON.stringify(snapshot.database[name]??[]))throw Error('Подтверждённые разделы не установлены в исходной базе');if(values.some(row=>record(row.sourceMeta).importSourceId===s.sourceId))imported=true;}
  if(!confirmed||!imported)throw Error('Канонические данные не подтверждают импорт выбранного источника');
 }
 async function commit(s:State):Promise<void> {
  if(s.busy)return;
  try{
   check(s);const input=importInput(s),inputText=JSON.stringify(input);
   if(s.preview?.canApply!==true||inputText!==s.reviewInput||!required<HTMLInputElement>(s.form,'[name=confirm]').checked)throw Error('Сначала проверьте весь источник и подтвердите импорт');
   if(!s.operationId)s.operationId=wfId('asset-inventory-import');lock(s,true);showError(s,'');
   let ack:AssetInventoryWorkspace.Ack;
   try{ack=await assetInventoryExecuteCommand({type:'AssetInventoryAction',version:1,input:{...input,reviewFingerprint:s.preview.fingerprint}},{operationId:s.operationId});}catch(error){s.uncertain=true;throw error;}
   if(!ack.ok){s.uncertain=ack.unknown===true||ack.definitive===false;throw Error(ack.error||ack.message||'Импорт не подтверждён. Выбранный файл и параметры сохранены.');}
   s.uncertain=true;check(s,false);canonical(s,ack);s.uncertain=false;finish(s,{ok:true,message:'Импорт всего источника подтверждён. Проверьте реестр и черновики описей.'});
  }catch(error){showError(s,(s.uncertain?'Результат операции пока не подтверждён; повтор использует ту же квитанцию. ':'')+text(error));}finally{if(active===s&&!s.revoked)lock(s,false);}
 }
 export async function openImport(request:{format:'legacy'|'xlsx';scope:AssetInventoryWorkspace.Scope;selectedFile?:File}):Promise<Result> {
  if(active)return {ok:false,error:'Сначала завершите открытый импорт'};
  const captured=assetInventoryHostSnapshot();try{verify(captured,source(captured),true);}catch(error){return {ok:false,error:text(error)};}
  const token=assetInventoryDatabaseToken();if(typeof token!=='string'||!token)return {ok:false,error:'Сначала дождитесь подтверждения подключения к базе'};
  return new Promise(resolve=>{
   const overlay=document.createElement('div');overlay.className='ai-overlay ai-file-overlay';overlay.tabIndex=-1;
   overlay.innerHTML='<section class="ai-dialog" role="dialog" aria-modal="true" aria-label="Импорт инвентаризации"><header><h3>Импорт инвентаризации ОС</h3><button type="button" class="btn btn-secondary" data-ai-file-close>Закрыть</button></header><form class="ai-form" data-ai-files-form><p>Выберите исходный файл размером до 25 МБ. Сервер проверит весь источник перед подтверждением. Просмотр не меняет реестр и описи.</p><div class="ai-grid"><label>Исходный файл<input type="file" name="file" accept="'+(request.format==='legacy'?'.json':'.xls,.xlsx')+'"></label><label>Формат<select name="format">'+(request.format==='legacy'?'<option value="legacy">Прежняя база инвентаризации (JSON)</option>':'<option value="auto">Определить по содержимому файла</option><option value="osv">Оборотно-сальдовая ведомость</option><option value="comparison">Сличительная ведомость</option>')+'</select></label><label>Дата, если её нет в документе<input type="date" name="date"></label><label>Название описи (если нужно)<input name="title"></label><label>Название организации, если нет в источнике<input name="defaultOrgName"></label><label>Название объекта, если нет в источнике<input name="defaultObjectName"></label></div><fieldset data-ai-file-targets><legend>Собственные справочники для Excel (необязательно)</legend><p>Выбирайте только при подтверждённом совпадении источника. Существующие записи не будут переименованы.</p><div class="ai-grid"><label>Организация<select name="targetOrg"></select></label><label>Объект<select name="targetObject"></select></label><label>МОЛ / счёт<select name="targetMol"></select></label></div></fieldset><label class="ai-confirm" data-ai-file-opening><input type="checkbox" name="useOpeningIfNoClosing">Если остатка на конец нет, использовать остаток на начало (только по явному подтверждению)</label><label>Основание импорта<textarea name="reason" required minlength="3"></textarea></label><p class="ai-error" data-ai-file-error role="alert"></p><div data-ai-file-preview></div><label class="ai-confirm" data-ai-file-confirm hidden><input type="checkbox" name="confirm">Подтверждаю импорт всего проверенного источника</label><p data-ai-file-status role="status" aria-live="polite"></p><div class="ai-actions"><button type="button" class="btn btn-secondary" data-ai-file-review>Проверить источник</button><button type="submit" class="btn btn-primary" data-ai-file-commit disabled>Импортировать</button></div></form></section>';
   if(request.format==='legacy')required<HTMLElement>(overlay,'form>p').insertAdjacentHTML('afterend','<p class="ai-muted">Прежняя база переносится целиком в собственные справочники. Текущие фильтры раздела не ограничивают и не объединяют её данные.</p>');
   document.body.append(overlay);
   const s:State={overlay,form:required(overlay,'form'),captured,sourceText:source(captured),token,file:null,reader:null,base64:null,sourceId:null,source:null,mappingText:'',stagedFile:null,preview:null,reviewInput:'',operationId:null,uncertain:false,busy:false,revoked:false,choices:new Map(),warnings:[],resolve};active=s;if(request.selectedFile){s.file=request.selectedFile;const chosen=document.createElement('p');chosen.dataset.aiSelectedOriginal='';chosen.textContent='Исходный файл: '+request.selectedFile.name;required<HTMLInputElement>(s.form,'[name=file]').insertAdjacentElement('afterend',chosen);}
   (field(s,'targetOrg') as HTMLSelectElement).innerHTML=options(s,'inventoryOrgs',request.scope.orgId);
   (field(s,'targetObject') as HTMLSelectElement).innerHTML=options(s,'inventoryObjects',request.scope.objectId);
   (field(s,'targetMol') as HTMLSelectElement).innerHTML=options(s,'inventoryMols',request.scope.molId);
   required<HTMLButtonElement>(overlay,'[data-ai-file-close]').onclick=()=>close(s);overlay.onclick=event=>{if(event.target===overlay)close(s);};
   overlay.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(s);}else if(event.key==='Tab'){const enabled=[...overlay.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(node=>node.getClientRects().length>0),first=enabled[0],last=enabled[enabled.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
   s.form.onsubmit=event=>{event.preventDefault();void commit(s);};required<HTMLButtonElement>(s.form,'[data-ai-file-review]').onclick=()=>{void review(s);};
   s.form.addEventListener('input',event=>{const element=event.target as HTMLInputElement;if(element.name==='confirm')lock(s,false);else clearPreview(s,element.name!=='reason');});
   s.form.addEventListener('change',event=>{const element=event.target as HTMLInputElement;if(element.name==='file'){s.file=element.files?.[0]??null;s.form.querySelector('[data-ai-selected-original]')?.remove();}if(element.name==='format')formatVisibility(s);if(element.name==='confirm')lock(s,false);else clearPreview(s,element.name!=='reason');});
   formatVisibility(s);lock(s,false);field(s,'file').focus();
  });
 }
 export async function exportDocument(request:{format:'xlsx'|'pdf';sessionId:Id}):Promise<Result> {
  const captured=assetInventoryHostSnapshot(),baseline=source(captured),token=assetInventoryDatabaseToken();
  try{
   verify(captured,baseline,false);if(typeof token!=='string'||!token)throw Error('Нет подтверждённого подключения к базе');
   if(!(captured.database.inventorySessions??[]).some(row=>row.id===request.sessionId))throw Error('Опись не найдена в доступных данных');
   const rpc=assetInventoryExportRequest;
   const result=await rpc({format:request.format,sessionId:request.sessionId,databaseToken:token});
   if(result.ok){try{verify(captured,baseline,false);}catch{return {ok:true,message:'Файл сохранён, но база или доступ изменились. Проверьте текущий сеанс.'};}return {ok:true,message:result.message||'Файл сохранён'};}
   verify(captured,baseline,false);return result.cancelled?{ok:false,cancelled:true}:{ok:false,error:result.error||result.message||(result.unknown?'Результат сохранения файла неизвестен. Проверьте выбранную папку.':'Файл не сохранён')};
  }catch(error){return {ok:false,error:text(error)};}
 }
}
function assetInventoryImportWizard(request:{format:'legacy'|'xlsx';scope:AssetInventoryWorkspace.Scope}):Promise<AssetInventoryWorkspace.FileResult> {return AssetInventoryFiles.openImport(request);}
function assetInventoryExportDocument(request:{format:'xlsx'|'pdf';sessionId:AssetInventoryWorkspace.Id}):Promise<AssetInventoryWorkspace.FileResult> {return AssetInventoryFiles.exportDocument(request);}
function assetInventoryFilesRevoke():void {AssetInventoryFiles.revoke();}
