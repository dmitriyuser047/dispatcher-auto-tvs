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
function wf1cCurrentMonth() {return BusinessCalendar.resolve(data,new Date().toISOString()).today.slice(0,7);}
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
 try{
  if(typeof reviewedImportOpen!=='function')throw Error('Не загружен проверяемый импорт');
  const database=data,stamp=syncSessionStamp(),bytes=await file.arrayBuffer();
  if(database!==data||stamp!==syncSessionStamp())throw Error('База или права изменились после выбора файла');
  return await reviewedImportOpen({profile:'provider-totals',source:{name:file.name,bytes},sections:['fuelPeriods'],parser:{id:'provider-totals',version:1},onApplied:()=>wfProviderProfiles()});
 }catch(error){showToast('Итоги 1С: '+error.message);}
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
 if(wf1cSaving||!wf1cPending?.file)return;
 return wfProviderImport1c({files:[wf1cPending.file],value:''});
}
function wfProviderImportHistory(onlyLegacy=false) {
  const batches=(data.appMeta || []).filter(row => row.rowType === '1c-provider-totals-import').slice().reverse();
  const history=(data.fuelPeriods||[]).flatMap(period=>Object.entries(period.recon||{}).flatMap(([provider,entry])=>(Array.isArray(entry?.importHistory)?entry.importHistory:[]).map(item=>({month:period.month,provider,...item})))).reverse();
  if(history.length&&!onlyLegacy){wfShowDialog('История загрузок итогов 1С',history.map(item=>'<article class="wf-card"><h3>'+htmlEsc(item.provider+' · '+item.month)+'</h3><p>Литры: '+htmlEsc(String(item.before?.litres??'неизвестно')+' → '+String(item.after?.litres??'неизвестно'))+'; сумма: '+htmlEsc(String(item.before?.sum??'неизвестно')+' → '+String(item.after?.sum??'неизвестно'))+'</p><p>'+htmlEsc(item.basis||'')+'</p><p>Источник SHA256: '+htmlEsc(item.source?.sourceArchive?.sha256||'не указан')+'</p><button class="btn btn-ghost" data-provider-import-source="'+htmlEsc(item.source?.sourceId||'')+'">Проверить сохранённый источник</button></article>').join('')+(batches.length?'<p>Прежних загрузок: '+batches.length+'. Их исходные записи сохранены.</p><button class="btn btn-ghost" onclick="wfProviderImportHistory(true)">Показать прежние загрузки</button>':''),'<button class="btn btn-ghost" onclick="wfProviderProfiles()">К профилям</button>');document.querySelectorAll('[data-provider-import-source]').forEach(button=>button.onclick=()=>reviewedImportOpenSource(button.dataset.providerImportSource));return;}
  wfShowDialog('История загрузок итогов 1С',batches.map(batch => '<details><summary>'+htmlEsc(new Date(batch.at).toLocaleString('ru')+' · '+batch.fileName)+' · '+batch.rows.length+' строк</summary><p>SHA256: '+htmlEsc(batch.sha256)+'</p><p>'+htmlEsc(batch.sourceArchive?.available ? 'Исходник в локальном архиве' : batch.sourceArchive?.reason || 'Архив недоступен')+'</p><table class="data-table"><thead><tr><th>Строка</th><th>Поставщик / месяц</th><th>Литры: было → стало</th><th>Сумма: было → стало</th><th>Документ</th></tr></thead><tbody>'+batch.rows.map(row => '<tr><td>'+row.sourceRow+'</td><td>'+htmlEsc(row.provider+' · '+row.month)+'</td><td>'+htmlEsc(String(row.before.litres)+' → '+String(row.after.litres))+'</td><td>'+htmlEsc(String(row.before.sum)+' → '+String(row.after.sum))+'</td><td>'+htmlEsc(row.sourceDocument || '')+'</td></tr>').join('')+'</tbody></table></details>').join('') || '<p>Загрузок пока нет.</p>','<button class="btn btn-ghost" onclick="wfProviderProfiles()">К профилям</button>');
}
