// Кнопка профилей доступна в штатной вкладке обмена.
const providerOriginalWorkflows=renderWorkflows;
renderWorkflows=function(...args){const result=providerOriginalWorkflows.apply(this,args);if(activeSection==='workflows'&&wfTab==='connectors'){const toolbar=document.querySelector('.wf-heading .wf-actions');if(toolbar){const button=document.createElement('button');button.className='btn btn-primary';button.textContent='1С, топливные карты и ГЛОНАСС';button.onclick=wfProviderProfiles;toolbar.prepend(button);}}return result;};
// Файловые профили. Название системы не означает наличие API-соединения.
const WF_PROVIDER_PROFILES = [
  {id:'1c83-bp',title:'1С 8.3 · Бухгалтерия предприятия',provider:'1С',family:'1c',format:'provider-month-totals-v1',description:'Сверка итогов по поставщику и месяцу через унифицированный CSV/XLSX. Перенесите итоги из отчёта 1С в шаблон.'},
  {id:'volga-inter',title:'ТК «Волга-Интер»',provider:'Волга-Интер',family:'cards',format:'fuel-statement-columns',description:'Файл выписки с датой, количеством, товаром и картой. Используется общий проверяемый импорт; структура конкретной выписки проверяется до записи.'},
  {id:'gazpromneft',title:'ТК «Газпромнефть»',provider:'Газпромнефть',family:'cards',format:'fuel-statement-columns',description:'Файл выписки с датой транзакции, количеством, товаром, картой и суммой клиента. Сопоставление и изменения показываются в плане.'},
  ...['Wialon','Omnicomm','FortMonitor','Geotab','Webfleet','Samsara'].map(provider => ({id:'telemetry-'+provider.toLowerCase(),title:provider,provider,family:'telemetry',format:'glonass-trips-columns',description:'Файл с унифицированными колонками «Объект», «Начало» или «Дата», «Пробег, км» или «Пройденный путь». Произвольный собственный формат поставщика требует адаптации; наличие профиля не гарантирует его разбор.'}))
];
let wfProviderSelected='1c83-bp', wf1cPending=null, wf1cSaving=false;
function wfProviderProfile() { return WF_PROVIDER_PROFILES.find(profile => profile.id === wfProviderSelected) || WF_PROVIDER_PROFILES[0]; }
function wfProviderProfiles() {
  const profile=wfProviderProfile(), saved=(data.appMeta || []).find(row => row.id === 'provider-profile:'+profile.id);
  wfShowDialog('Профили файлового обмена',
    '<div class="gsm-status">Настроены файловые сценарии. Активного API-соединения с перечисленными системами нет; адреса и ключи не запрашиваются.</div><label>Система / поставщик<select id="wfProviderChoice" class="fsel">'+WF_PROVIDER_PROFILES.map(item => '<option value="'+item.id+'"'+(item.id === profile.id ? ' selected' : '')+'>'+htmlEsc(item.title)+'</option>').join('')+'</select></label><article class="wf-card"><h3>'+htmlEsc(profile.title)+'</h3><p>'+htmlEsc(profile.description)+'</p><p>Режим: файл · '+(saved ? 'профиль сохранён' : 'профиль ещё не сохранён')+'</p>'+
    (profile.family === '1c' ? '<p>Конфигурация: <b>Бухгалтерия предприятия</b>, платформа <b>1С 8.3</b>. Этот формат переносит месячные итоги в существующую сверку ГСМ с 1С; он не загружает проводки и не меняет базу 1С.</p><div class="gsm-actions"><button class="btn btn-primary" id="wfProviderImport1c">Загрузить CSV / XLSX итогов</button><button class="btn btn-ghost" onclick="wfProviderTemplate(\'csv\')">Шаблон CSV</button><button class="btn btn-ghost" onclick="wfProviderTemplate(\'xlsx\')">Шаблон Excel</button><button class="btn btn-ghost" onclick="wfProviderOpenRecon()">Открыть сверку с 1С</button></div><input id="wfProvider1cFile" type="file" accept=".csv,.xlsx,.xls" style="display:none">' :
      profile.family === 'cards' ? '<div class="gsm-actions"><button class="btn btn-primary" onclick="wfProviderImportCards(\'fuel\')">Загрузить выписку</button><button class="btn btn-ghost" onclick="wfProviderImportCards(\'office\')">Формат офисных карт</button></div>' : '<div class="gsm-actions"><button class="btn btn-primary" onclick="wfProviderImportTelemetry()">Загрузить и проверить отчёт ГЛОНАСС</button></div>')+
    '</article><p class="wf-note">Выбор профиля описывает способ обмена. Заголовки, поставщик и содержимое самого файла проверяются отдельно. Для новых форматов нужен пример обезличенного файла.</p><div id="wfProviderStatus" class="wf-error" role="alert"></div>',
    '<button class="btn btn-ghost" onclick="wfProviderImportHistory()">История загрузок 1С</button><button class="btn btn-primary" id="wfProviderSave">Сохранить выбранный профиль</button>');
  document.getElementById('wfProviderChoice').onchange=event => {wfProviderSelected=event.target.value;wfProviderProfiles();};
  document.getElementById('wfProviderSave').onclick=wfProviderSaveProfile;
  const input=document.getElementById('wfProvider1cFile');
  if(input) {document.getElementById('wfProviderImport1c').onclick=() => input.click();input.onchange=() => wfProviderImport1c(input);}
}
async function wfProviderSaveProfile() {
  const profile=wfProviderProfile(), row={id:'provider-profile:'+profile.id,rowType:'provider-profile',profileId:profile.id,title:profile.title,provider:profile.provider,kind:'file',format:profile.format,configuration:profile.family === '1c' ? 'Бухгалтерия предприятия' : '',platform:profile.family === '1c' ? '1С 8.3' : '',updatedAt:new Date().toISOString()};
  const rows=data.appMeta || (data.appMeta=[]), index=rows.findIndex(item => item.id === row.id);
  if(index < 0) rows.push(row); else rows[index]={...rows[index],...row};
  if(await saveData(data,{noMerge:true})) {showToast('Файловый профиль сохранён');wfProviderProfiles();}
}
function wfProviderImportCards(mode) {
  const input=document.getElementById(mode === 'office' ? 'officeFuelImportInput' : 'fuelImportInput');
  if(!input) {showToast('Форма импорта выписок недоступна');return;} closeModal('wfModal');input.click();
}
function wfProviderImportTelemetry() {closeModal('wfModal');importGlonassTrips();}
function wfProviderOpenRecon(month) {closeModal('wfModal');fpView='recon';if(month){frcMonth=month;fpMonth=month;}switchSection('fuelPurchases');}
function wf1cProviderKey(value) {
  return String(value || '').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/(?:^|\s)(?:ооо|пао|ао|тк)(?=\s|$)/g,'').replace(/[^a-zа-я0-9]/g,'');
}
function wf1cKnownProviders(db=data) {
  const names=[...(db.fuelCards || []).map(card => card.provider),...(db.fuelPurchases || []).filter(purchase => !purchase.deleted).map(purchase => frcProvider(purchase)),...(db.fuelPeriods || []).flatMap(period => Object.keys(period.recon || {}))].filter(Boolean);
  return [...new Map(names.map(name => [wf1cProviderKey(name),name])).values()].sort((a,b) => a.localeCompare(b,'ru'));
}
function wf1cCurrentMonth() {const now=new Date();return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');}
function wfProviderTemplate(kind) {
  const providers=wf1cKnownProviders(), month=wf1cCurrentMonth();
  const examples=(providers.length ? providers : ['Волга-Интер','Газпромнефть']).map(provider => [provider,month,'','','']);
  const values=[['provider','month','litres','sum','source_document'],...examples];
  if(kind === 'xlsx') {
    const book=XLSX.utils.book_new(), sheet=XLSX.utils.aoa_to_sheet(values);sheet['!cols']=[{wch:30},{wch:12},{wch:16},{wch:20},{wch:35}];
    XLSX.utils.book_append_sheet(book,sheet,'Итоги 1С');
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
      ['Формат','provider-month-totals-v1'],['Система','1С 8.3 · Бухгалтерия предприятия'],
      ['provider','Поставщик: точное имя в карточках карт или сверке. При импорте можно выбрать существующее имя.'],
      ['month','Месяц в формате ГГГГ-ММ. Одна строка на поставщика и месяц.'],
      ['litres','Итог литров. Пусто: не передавать показатель. 0: известный нулевой итог.'],
      ['sum','Итог в рублях для сравнения с суммой выписок; используйте одинаковый состав НДС. Пусто и 0 различаются.'],
      ['source_document','Необязательные номер/название исходного отчёта 1С.'],
      ['Ограничение','Это шаблон итогов. Произвольная оборотка Бухгалтерии предприятия автоматически не разбирается.'],
      ['Запись','Только после предварительного просмотра; закрытые месяцы пропускаются.']
    ]),'Описание');
    XLSX.writeFile(book,'1С_БП_итоги_ГСМ_шаблон.xlsx');return;
  }
  const quote=value => '"'+String(value ?? '').replace(/"/g,'""')+'"';
  const csv='\uFEFF'+values.map(row => row.map(quote).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})), link=document.createElement('a');link.href=url;link.download='1С_БП_итоги_ГСМ_шаблон.csv';link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
}
function wf1cParseCsv(text) {
  text=String(text).replace(/^\uFEFF/,'');
  const first=text.split(/\r?\n/,1)[0], delimiter=first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let index=0;index<text.length;index++) {
    const char=text[index];
    if(char === '"') {if(quoted && text[index+1] === '"'){cell+='"';index++;}else if(!quoted && cell.trim() !== '')throw Error('Некорректные кавычки CSV');else quoted=!quoted;}
    else if(char === delimiter && !quoted) {row.push(cell);cell='';}
    else if((char === '\n' || char === '\r') && !quoted) {if(char === '\r' && text[index+1] === '\n')index++;row.push(cell);if(row.some(value => value.trim() !== ''))rows.push(row);row=[];cell='';}
    else cell+=char;
  }
  if(quoted)throw Error('Не закрыта кавычка в CSV');row.push(cell);if(row.some(value => value.trim() !== ''))rows.push(row);return rows;
}
function wf1cNumber(value,label) {
  if(value == null || String(value).trim() === '')return null;
  const text=String(value).replace(/[\s\u00a0]/g,'').replace(',','.');
  if(!/^[+-]?\d+(?:\.\d+)?$/.test(text))throw Error('Неверное число: '+label);
  const number=Number(text);if(!Number.isFinite(number))throw Error('Неверное число: '+label);return number;
}
function wf1cFingerprint(db=data) {return JSON.stringify(['fuelPeriods','fuelCards','fuelPurchases'].map(name => db[name] || []));}
function wf1cTablePlan(table) {
  const aliases={provider:['provider','поставщик','поставщик карт'],month:['month','месяц','период'],litres:['litres','liters','литры','литры 1с','количество'],sum:['sum','сумма','сумма 1с'],source_document:['source_document','документ','отчёт','отчет']};
  const normalized=value => String(value || '').trim().toLocaleLowerCase('ru');
  let header=-1,columns;
  for(let index=0;index<Math.min(20,table.length);index++) {const values=table[index].map(normalized), found=Object.fromEntries(Object.entries(aliases).map(([key,names]) => [key,values.findIndex(value => names.includes(value))]));if(['provider','month','litres','sum'].every(key => found[key] >= 0)){header=index;columns=found;break;}}
  if(header < 0)throw Error('Нужны колонки provider, month, litres, sum. Скачайте шаблон.');
  const known=wf1cKnownProviders(), entries=[];
  table.slice(header+1).forEach((row,index) => {
    if(!row.some(value => String(value ?? '').trim() !== ''))return;
    const get=key => columns[key] < 0 ? '' : row[columns[key]], sourceProvider=String(get('provider') || '').trim(), rawMonth=String(get('month') || '').trim();
    const month=/^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : /^\d{2}\.\d{4}$/.test(rawMonth) ? rawMonth.slice(3)+'-'+rawMonth.slice(0,2) : rawMonth;
    let error='',litres=null,sum=null;
    try {if(!sourceProvider)throw Error('Нет поставщика');if(!fqDate(month+'-01'))throw Error('Месяц должен быть ГГГГ-ММ');litres=wf1cNumber(get('litres'),'литры');sum=wf1cNumber(get('sum'),'сумма');if(litres == null && sum == null)throw Error('Оба показателя пустые');}catch(failure){error=failure.message;}
    const closed=(data.fuelPeriods || []).some(period => period.month === month && period.closed);if(closed)error='Месяц закрыт';
    const matches=known.filter(provider => wf1cProviderKey(provider) === wf1cProviderKey(sourceProvider));
    entries.push({sourceRow:index+header+2,sourceProvider,provider:matches.length === 1 ? matches[0] : '',month,litres,sum,sourceDocument:String(get('source_document') || '').trim(),error,include:!error,mode:'fill'});
  });
  if(!entries.length)throw Error('Нет строк итогов для проверки');if(entries.length > 10000)throw Error('Максимум 10000 строк за одну загрузку');return {entries,known,fingerprint:wf1cFingerprint()};
}
async function wfProviderImport1c(input) {
  const file=input.files?.[0];if(!file)return;input.value='';
  try {
    const bytes=await file.arrayBuffer();let table;
    if(/\.csv$/i.test(file.name)){let text=new TextDecoder('utf-8').decode(bytes);if(text.includes('\uFFFD'))text=new TextDecoder('windows-1251').decode(bytes);table=wf1cParseCsv(text);}
    else {const book=XLSX.read(bytes,{type:'array',cellDates:false});table=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:'',raw:false});}
    const plan=wf1cTablePlan(table);wf1cPending={file,bytes,profileId:'1c83-bp',...plan};wfProvider1cPreview();
  } catch(error) {showToast('Итоги 1С: '+error.message);}
}
function wfProvider1cPreview() {
  const pending=wf1cPending;if(!pending || wf1cSaving)return;
  const number=value => value == null ? 'не передаётся' : fpNum(value,2);
  const rows=pending.entries.map((entry,index) => {
    const current=(fuelPeriod(entry.month)?.recon || {})[entry.provider] || {};
    return '<tr><td><input type="checkbox" data-1c-include="'+index+'" '+(entry.include ? 'checked' : '')+' '+(entry.error ? 'disabled' : '')+'></td><td>'+entry.sourceRow+'</td><td>'+htmlEsc(entry.sourceProvider)+'</td><td><select data-1c-provider="'+index+'" '+(entry.error ? 'disabled' : '')+'><option value="">Выберите существующего поставщика</option>'+pending.known.map(provider => '<option'+(entry.provider === provider ? ' selected' : '')+'>'+htmlEsc(provider)+'</option>').join('')+'</select></td><td>'+htmlEsc(entry.month)+'</td><td>'+number(current.litres)+' → '+number(entry.litres)+'</td><td>'+number(current.sum)+' → '+number(entry.sum)+'</td><td>'+(entry.error ? htmlEsc(entry.error) : '<select data-1c-mode="'+index+'"><option value="fill"'+(entry.mode === 'fill' ? ' selected' : '')+'>Заполнить только пустые показатели</option><option value="replace"'+(entry.mode === 'replace' ? ' selected' : '')+'>Заменить переданные показатели</option></select>')+'</td></tr>';
  }).join('');
  wfShowDialog('Проверка итогов 1С: '+pending.file.name,'<p>Пустое поле файла сохраняет прежний показатель. Введённый ноль записывается как ноль. Поставщик выбирается из уже известных карт, покупок и сверок; новые поставщики автоматически не создаются. Отрицательные итоги сохраняют свой знак и требуют проверки по исходному отчёту.</p>'+(!pending.known.length ? '<div class="gsm-status gsm-error">Нет известных поставщиков. Сначала укажите поставщика в карточках топливных карт или загрузите выписку.</div>' : '')+'<div class="table-scroll" style="max-height:60vh"><table class="data-table"><thead><tr><th>Включить</th><th>Строка</th><th>В файле</th><th>Поставщик сверки</th><th>Месяц</th><th>Литры: было → файл</th><th>Сумма: было → файл</th><th>Действие / ошибка</th></tr></thead><tbody>'+rows+'</tbody></table></div><div id="wf1cError" class="wf-error" role="alert"></div>','<button class="btn btn-ghost" onclick="wfProviderProfiles()">Назад</button><button id="wf1cCommit" class="btn btn-primary">Записать выбранные итоги</button>');
  document.querySelectorAll('#wfModal [data-1c-provider]').forEach(select => select.onchange=() => {wfProvider1cCapture();wfProvider1cPreview();});
  document.getElementById('wf1cCommit').onclick=wfProvider1cCommit;
}
function wfProvider1cCapture() {
  if(!wf1cPending)return;
  wf1cPending.entries.forEach((entry,index) => {entry.include=!!document.querySelector('[data-1c-include="'+index+'"]')?.checked;entry.provider=document.querySelector('[data-1c-provider="'+index+'"]')?.value || '';entry.mode=document.querySelector('[data-1c-mode="'+index+'"]')?.value || 'fill';});
}
async function wfProvider1cCommit() {
  if(!wf1cPending || wf1cSaving)return;const error=document.getElementById('wf1cError');
  try {
    wfProvider1cCapture();const pending=wf1cPending, selected=pending.entries.filter(entry => entry.include), keys=new Set();
    if(!selected.length)throw Error('Выберите строки для записи');
    selected.forEach(entry => {if(entry.error)throw Error('Строка '+entry.sourceRow+': '+entry.error);if(!pending.known.includes(entry.provider))throw Error('Строка '+entry.sourceRow+': выберите существующего поставщика');const key=JSON.stringify([entry.month,entry.provider]);if(keys.has(key))throw Error('В файле несколько итогов одного поставщика за один месяц: '+entry.provider);keys.add(key);if(!['fill','replace'].includes(entry.mode))throw Error('Неверное действие строки');});
    if(wf1cFingerprint() !== pending.fingerprint)throw Error('База изменилась. Загрузите файл заново и проверьте актуальные значения.');
    wf1cSaving=true;document.getElementById('wf1cCommit').disabled=true;
    if(!window.crypto?.subtle)throw Error('Недоступен SHA256 исходного файла. Перезапустите программу.');
    const digest=await crypto.subtle.digest('SHA-256',pending.bytes), sha256=Array.from(new Uint8Array(digest),byte => byte.toString(16).padStart(2,'0')).join('');
    const sourceArchive=await importArchiveSource(pending.file);if(sourceArchive.available && sourceArchive.sha256 && sourceArchive.sha256.toLowerCase() !== sha256)throw Error('Контрольная сумма архива не совпадает с исходником');
    if(wf1cFingerprint() !== pending.fingerprint)throw Error('База изменилась во время подготовки. Загрузите файл заново.');
    const next=JSON.parse(JSON.stringify(data)), batchId='1c-import:'+Date.now()+'-'+Math.random().toString(36).slice(2,8),at=new Date().toISOString(), results=[];next.fuelPeriods=next.fuelPeriods || [];
    selected.forEach(entry => {
      let period=next.fuelPeriods.find(item => item.month === entry.month);if(period?.closed)throw Error('Месяц '+entry.month+' закрыт');if(!period){period={month:entry.month,history:[]};next.fuelPeriods.push(period);}
      const recon=period.recon || (period.recon={}), values=recon[entry.provider] || (recon[entry.provider]={}),before={litres:values.litres ?? '',sum:values.sum ?? ''},changed=[];
      ['litres','sum'].forEach(field => {if(entry[field] == null)return;if(entry.mode === 'replace' || fqValue(values[field]) == null){if(fqValue(values[field]) !== entry[field])changed.push(field);values[field]=entry[field];}});
      const source={batchId,fileName:pending.file.name,sha256,sourceRow:entry.sourceRow,sourceDocument:entry.sourceDocument,sourceProvider:entry.sourceProvider,profileId:pending.profileId,at};
      if(changed.length)(values.importHistory || (values.importHistory=[])).push({at,before,changed,source});
      values.importSource=source;results.push({...entry,before,after:{litres:values.litres ?? '',sum:values.sum ?? ''},changed});
    });
    (next.appMeta || (next.appMeta=[])).push({id:batchId,rowType:'1c-provider-totals-import',profileId:pending.profileId,at,fileName:pending.file.name,sha256,size:pending.bytes.byteLength,sourceArchive,rows:results});
    data=next;if(!await saveData(data,{noMerge:true}))throw Error('Итоги не сохранены. Проверьте соединение и загрузите файл заново.');
    wf1cPending=null;wfShowDialog('Итоги 1С записаны','<p>Выбранных строк: '+selected.length+'. Изменённых показателей: '+results.reduce((sum,row) => sum+row.changed.length,0)+'.</p><p>SHA256: '+htmlEsc(sha256)+'</p><p>'+htmlEsc(sourceArchive.available ? 'Исходный файл сохранён в локальном архиве.' : sourceArchive.reason)+'</p><p>История и исходные значения доступны в профилях обмена.</p>','<button class="btn btn-primary" onclick="wfProviderOpenRecon('+htmlEsc(JSON.stringify(selected[0].month))+')">Открыть сверку</button>');
  } catch(failure) {if(error?.isConnected)error.textContent=failure.message;else showToast(failure.message);}
  finally {wf1cSaving=false;const button=document.getElementById('wf1cCommit');if(button)button.disabled=false;}
}
function wfProviderImportHistory() {
  const batches=(data.appMeta || []).filter(row => row.rowType === '1c-provider-totals-import').slice().reverse();
  wfShowDialog('История загрузок итогов 1С',batches.map(batch => '<details><summary>'+htmlEsc(new Date(batch.at).toLocaleString('ru')+' · '+batch.fileName)+' · '+batch.rows.length+' строк</summary><p>SHA256: '+htmlEsc(batch.sha256)+'</p><p>'+htmlEsc(batch.sourceArchive?.available ? 'Исходник в локальном архиве' : batch.sourceArchive?.reason || 'Архив недоступен')+'</p><table class="data-table"><thead><tr><th>Строка</th><th>Поставщик / месяц</th><th>Литры: было → стало</th><th>Сумма: было → стало</th><th>Документ</th></tr></thead><tbody>'+batch.rows.map(row => '<tr><td>'+row.sourceRow+'</td><td>'+htmlEsc(row.provider+' · '+row.month)+'</td><td>'+htmlEsc(String(row.before.litres)+' → '+String(row.after.litres))+'</td><td>'+htmlEsc(String(row.before.sum)+' → '+String(row.after.sum))+'</td><td>'+htmlEsc(row.sourceDocument || '')+'</td></tr>').join('')+'</tbody></table></details>').join('') || '<p>Загрузок пока нет.</p>','<button class="btn btn-ghost" onclick="wfProviderProfiles()">К профилям</button>');
}
