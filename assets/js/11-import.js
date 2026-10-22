// Импорт из XLS, топливных карт, RAR, JSON, PDF; экспорт данных ДЭС
// Выделено из index.html

// ─── IMPORT FROM XLS ────────────────────────────────────
function importPlanFingerprint(db) { return JSON.stringify(['vehicles','records','fuelPurchases','fuelImports','fuelCards','fuelPeriods'].map(name => db[name] || [])); }
async function importArchiveSource(file) {
  if (!window.electronAPI?.archiveImportSource) return { available:false, reason:'Архив исходников недоступен в этом режиме' };
  const result=await window.electronAPI.archiveImportSource({name:file.name,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});
  if (!result?.ok) return {available:false,reason:result?.error || 'Архив исходников на сервере недоступен'};
  return {available:true,id:result.id,sha256:result.sha256,size:result.size,name:result.name};
}
function importConfirmPlan(title,body,buttonText) {
  return new Promise(resolve => {
    if (typeof wfShowDialog !== 'function') { alert('Предварительный просмотр недоступен. Перезапустите программу.'); resolve(false); return; }
    wfShowDialog(title,body,'<button class="btn btn-ghost" id="importPlanCancel">Отмена</button><button class="btn btn-primary" id="importPlanCommit">'+fpEsc(buttonText || 'Применить план')+'</button>');
    const modal=document.getElementById('wfModal'); let finished=false;
    const finish=value => { if (finished) return; finished=true; observer.disconnect(); document.removeEventListener('keydown',onKey,true); if(modal.isConnected && document.getElementById('wfModal') === modal) closeModal('wfModal'); resolve(value); };
    const onKey=event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(false); } };
    const observer=new MutationObserver(() => { if (!modal.isConnected || !modal.classList.contains('open')) finish(false); });
    observer.observe(document.body,{childList:true}); observer.observe(modal,{attributes:true,attributeFilter:['class']});
    document.addEventListener('keydown',onKey,true);
    document.getElementById('importPlanCancel').onclick=() => finish(false);
    document.getElementById('importPlanCommit').onclick=() => finish(true);
    const close=modal.querySelector('.modal-header .icon-btn'); if(close) close.onclick=() => finish(false);
  });
}
function fuelImportKeyV2(tx) {
  const text=value => String(value || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
  const provider=text(tx.provider || (typeof fcGuessProvider === 'function' ? fcGuessProvider(String(tx.cardNo || '').replace(/\D/g,'')) : '') || 'не указан');
  return 'v2:' + JSON.stringify(tx.supplierTransactionId ? [provider,tx.operationKind || 'purchase','id',text(tx.supplierTransactionId)] :
    [provider,tx.operationKind || 'purchase','row',tx.date,tx.time || '',String(tx.cardNo || '').replace(/\D/g,''),text(tx.fuel),Math.round((+tx.qty || 0)*100)/100,plateKey(tx.plate),text(tx.comment)]);
}
// V2 is intentionally frozen: its centilitre keys are already persisted. V3
// identifies the complete source quantity, without rewriting any old key.
function fuelImportKeyV3(tx) {
  const text=value => String(value ?? '').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
  const provider=text(tx.provider || (typeof fcGuessProvider === 'function' ? fcGuessProvider(String(tx.cardNo || '').replace(/\D/g,'')) : '') || 'не указан');
  return 'v3:' + JSON.stringify(tx.supplierTransactionId ? [provider,tx.operationKind || 'purchase','id',text(tx.supplierTransactionId)] :
    [provider,tx.operationKind || 'purchase','row',tx.date,tx.time || '',String(tx.cardNo || '').replace(/\D/g,''),text(tx.fuel),DecimalCore.parse(tx.qty,{scale:3,max:1e12,nonNegative:true}),plateKey(tx.plate),text(tx.comment)]);
}
function fuelImportKnownIndex(purchases){
  const index={v3:new Map(),v2:new Map(),v1:new Map()};
  const append=(map,key,row)=>{if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(row);};
  purchases.forEach(row=>{if(row.importKeyV3)append(index.v3,row.importKeyV3,row);else if(row.importKeyV2)append(index.v2,row.importKeyV2,row);else append(index.v1,row.importKey,row);});
  return index;
}
function fuelImportMatchKnown(tx,purchases,used) {
  const index=Array.isArray(purchases)?fuelImportKnownIndex(purchases):purchases;
  const exact=(index.v3.get(tx.importKeyV3)||[]).find(row=>!used.has(row));
  if(exact)return {purchase:exact};
  const legacy=[...(index.v2.get(tx.importKeyV2)||[]),...(index.v1.get(tx.importKey)||[])].filter(row=>!used.has(row));
  const proved=legacy.find(row=>tx.supplierTransactionId&&row.importKeyV2===tx.importKeyV2||
    fuelImportQuantityEqual(row.sourceTransaction?.qty ?? row.qty,tx.qty));
  if(proved)return {purchase:proved};
  return legacy.length ? {ambiguous:true,reason:'Старый ключ округлён до сотых; точное количество источника не подтверждено. Сверьте существующую покупку — журнал не изменён.'} : {};
}
function fuelImportQuantityEqual(a,b){try{return DecimalCore.compare(a,b)===0;}catch{return false;}}
function fuelImportSum(values){return DecimalCore.toNumberExact(DecimalCore.sum(values));}
function fuelImportAdd(a,b){return DecimalCore.toNumberExact(DecimalCore.add(a,b));}
function fuelImportRepeatedSources(transactions){
  const groups=new Map(),blocked=new Map();
  transactions.filter(tx=>tx.supplierTransactionId).forEach(tx=>{if(!groups.has(tx.importKeyV3))groups.set(tx.importKeyV3,[]);groups.get(tx.importKeyV3).push(tx);});
  const signature=tx=>JSON.stringify(['date','time','qty','sum','price','fuel','cardNo','plate','comment'].map(field=>tx[field]??null));
  for(const rows of groups.values()){
    if(rows.length<2)continue;
    const conflicting=new Set(rows.map(signature)).size>1;
    for(const row of conflicting?rows:rows.slice(1))blocked.set(row.sourceRow,conflicting?
      'Один ID поставщика содержит разные исходные данные. Все строки этого ID оставлены на сверку; журнал не изменён.':
      'Повтор ID поставщика внутри файла. Операция учитывается один раз; повтор не меняет журнал.');
  }
  return blocked;
}
function fuelImportRecognizedGrade(product) {
  const text=String(product || '').toUpperCase().replace(/Ё/g,'Е');
  if (/ПРИСАД|АНТИГЕЛ|МАСЛ|МОЙК|ОМЫВ|ADBLUE|АДБЛЮ|КАРБАМИД|КОМИСС|СЕРВИС/.test(text)) return '';
  const grade=parseFuelGrade(text);
  if (/^АИ-/.test(grade) && !/АИ|A[IИ]|БЕНЗ|G[ -]?DRIVE|ULTIMATE|PULSAR|ЭКТО|ATUM|РЕГУЛЯР|ПРЕМИУМ|СУПЕР|REGULAR|PREMIUM|SUPER/.test(text) && !/^\s*(92|95|98|100)\s*$/.test(text)) return '';
  if (grade === 'Газ' && !/(?:^|\s)ГАЗ(?:\s|$)|ГБО|ПРОПАН|МЕТАН|СУГ|LPG|CNG/.test(text)) return '';
  return grade;
}
function fuelImportStampSource(purchase,tx,sourceArchive) {
  const source={date:tx.date,time:tx.time || '',qty:tx.qty,sum:tx.sum,product:tx.fuel || '',provider:tx.provider || '',supplierTransactionId:tx.supplierTransactionId || '',sourceRow:tx.sourceRow};
  if (!purchase.sourceTransaction && (DecimalCore.compare(purchase.qty,tx.qty)!==0 || purchase.grade && fuelImportRecognizedGrade(tx.fuel) && purchase.grade !== fuelImportRecognizedGrade(tx.fuel))) purchase.sourceChanged=true;
  if (purchase.sourceTransaction && JSON.stringify(purchase.sourceTransaction) !== JSON.stringify(source)) {
    const values=['date','time','qty','sum','product'].some(field => purchase.sourceTransaction[field] !== source[field]);
    if (values) { purchase.sourceChanged=true; (purchase.sourceVersions || (purchase.sourceVersions=[])).push({at:new Date().toISOString(),values:source}); }
  }
  if (!purchase.sourceTransaction) purchase.sourceTransaction=source;
  Object.assign(purchase,{importKeyV2:tx.importKeyV2,importKeyV3:tx.importKeyV3,supplierTransactionId:tx.supplierTransactionId || '',sourceRow:tx.sourceRow});
  if (sourceArchive?.available) purchase.sourceArchive=sourceArchive;
}
function importVehiclesFromXls(input){return reviewedImportFile('vehicles',input,['vehicles'],{parser:{id:'vehicles',version:1}});}

// ─── ИМПОРТ ЗАПРАВОК ИЗ ОТЧЁТА ПО ТОПЛИВНЫМ КАРТАМ ──────
let _fuelImportLastReport = null;

function importFuelFromXls(input,mode='fuel'){return reviewedImportFile('fuel-statement',input,['fuelPurchases'],{parser:{id:'fuel-statement',version:1},mapping:{variant:mode==='office'?'office':'fuel'}});}

function fuelImportReportRow(grp, action, beforeIssued, afterIssued, statusText, recordId) {
  const vehicleTitle = [grp.v.plate, grp.v.make].filter(Boolean).join(' — ') || grp.v.id;
  const cards = [...new Set(grp.transactions.map(tx => tx.cardNo).filter(Boolean))];
  const comments = [...new Set(grp.transactions.map(tx => tx.comment).filter(Boolean))];
  return {
    action,
    statusText,
    recordId,
    vehicleId: grp.v.id,
    date: grp.date,
    grade: grp.grade,
    vehicle: vehicleTitle,
    qty: grp.totalQty,
    sum: grp.totalSum,
    beforeIssued,
    afterIssued,
    sourceRows: grp.transactions.map(tx => tx.sourceRow),
    transactionCount: grp.transactions.length,
    cardNo: cards.join(', '),
    comment: comments.join('; '),
    transactions: grp.transactions.map(tx => ({
      sourceRow: tx.sourceRow,
      date: tx.date,
      time: tx.time,
      azs: tx.azs,
      region: tx.region,
      qty: tx.qty,
      sum: tx.sum,
      price: tx.price,
      fuel: tx.fuel,
      importKey: tx.importKey,
      importKeyV2:tx.importKeyV2,importKeyV3:tx.importKeyV3,provider:tx.provider,supplierTransactionId:tx.supplierTransactionId,
      cardNo: tx.cardNo,
      vehicleText: tx.vehicleText,
      comment: tx.comment,
    })),
  };
}

function fuelImportVehicleTitle(vehicleIdOrVehicle) {
  const v = typeof vehicleIdOrVehicle === 'object'
    ? vehicleIdOrVehicle
    : (data.vehicles || []).find(x => x.id === vehicleIdOrVehicle);
  if (!v) return '—';
  return [v.plate, v.make].filter(Boolean).join(' — ') || v.id;
}

function fuelImportVehicleOptions(selectedId, includeBlank = false) {
  const blank = includeBlank ? '<option value="">— выберите ТС —</option>' : '';
  return blank + (data.vehicles || [])
    .slice()
    .sort((a, b) => fuelImportVehicleTitle(a).localeCompare(fuelImportVehicleTitle(b), 'ru'))
    .map(v => `<option value="${String(v.id).replace(/"/g, '&quot;')}" data-typed-id="${fpEsc(JSON.stringify(v.id))}"${v.id === selectedId ? ' selected' : ''}>${fuelImportVehicleTitle(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')}</option>`)
    .join('');
}

function fuelImportAppendNote(record, note) {
  if (!record || !note) return;
  const current = String(record.note || '');
  if (current.includes(note)) return;
  record.note = current ? current + '; ' + note : note;
}

function fuelImportRoundLitres(v) {
  return DecimalCore.toNumberExact(DecimalCore.parse(v,{scale:3,max:1e12}));
}

function fuelImportRoundMoney(v) {
  return DecimalCore.toNumberExact(DecimalCore.quantize(v,{scale:2,rounding:'half-away-from-zero'}));
}

function fuelImportTxSum(transactions) {
  return DecimalCore.toNumberExact(DecimalCore.sum((transactions || []).map(tx=>tx.sum ?? 0)));
}

function fuelImportTransactionNote(transactions, fallbackQty) {
  const txs = Array.isArray(transactions) ? transactions : [];
  const fuels = txs
    .map(tx => (tx.fuel || 'топливо') + ' ' + fuelImportRoundLitres(tx.qty || fallbackQty) + 'л')
    .filter(Boolean);
  const importKeys = txs.map(tx => tx.importKey).filter(Boolean);
  const fuelNote = 'заправка: ' + (fuels.length ? fuels.join(', ') : fuelImportRoundLitres(fallbackQty) + 'л');
  const importMarker = importKeys.length ? 'импорт заправок: ' + importKeys.join(' | ') : 'импорт заправок: ручное сопоставление из отчёта';
  return fuelNote + '; ' + importMarker;
}

function fuelImportApplyFuelToVehicle(vehicleId, date, qty, transactions, extraNote) {
  if (!data.records) data.records = [];
  const vehicle = (data.vehicles || []).find(x => x.id === vehicleId);
  const grade = fuelGradeFromTransactions(transactions, vehicle);
  let record = data.records.find(r => r.vehicleId === vehicleId && r.date === date && recordFuelGrade(r, vehicle) === grade);
  const created = !record;
  if (!record) {
    record = {
      id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      vehicleId,
      date,
      km: 0,
      fuelIssued: 0,
      note: '',
    };
    data.records.push(record);
  }

  const before = +record.fuelIssued || 0;
  record.fuelIssued = DecimalCore.toNumberExact(DecimalCore.add(before,qty));
  record.fuelGrade = grade;
  const addSum = fuelImportTxSum(transactions);
  if (addSum) record.fuelSum = fuelImportAdd(record.fuelSum ?? 0,addSum);
  fuelImportAppendNote(record, fuelImportTransactionNote(transactions, qty));
  fuelImportAppendNote(record, extraNote);

  return { record, created, beforeIssued: created ? null : before, afterIssued: record.fuelIssued };
}

function fuelImportSubtractFromRecord(row) {
  const qty = +row.qty || 0;
  if (!qty || !data.records) return null;
  const record = data.records.find(r => r.id === row.recordId) ||
    data.records.find(r => r.vehicleId === row.vehicleId && r.date === row.date);
  if (!record) return null;

  const before = +record.fuelIssued || 0;
  const after = Math.max(0,DecimalCore.toNumberExact(DecimalCore.sub(before,qty)));
  record.fuelIssued = after > 0 ? after : null;
  const subSum = fuelImportTxSum(row.transactions);
  if (subSum && record.fuelSum) {
    const left = DecimalCore.toNumberExact(DecimalCore.sub(record.fuelSum,subSum));
    record.fuelSum = left > 0 ? left : null;
  }
  fuelImportAppendNote(record, 'перенос заправки из отчёта импорта: -' + fuelImportRoundLitres(qty) + ' л');
  return { record, beforeIssued: before, afterIssued: record.fuelIssued };
}

// Перенос строк отчёта на другую машину через раздел «Заправки»:
// покупка снимается с прежней записи журнала и добавляется к новой.
// Если хоть одной покупки нет (старая загрузка) — null, работает прежний путь.
function fuelImportMoveViaPurchases(transactions, targetVehicleId) {
  if (typeof fpByKey !== 'function') return null;
  // Одинаковые ключи — разные покупки: каждой строке своя
  const used = new Set();
  const list = (transactions || []).map(tx => {
    const p = fpList().find(x => !x.deleted&&!used.has(x)&&(tx.importKeyV3 ? x.importKeyV3===tx.importKeyV3 : x.importKey===tx.importKey&&fuelImportQuantityEqual(x.sourceTransaction?.qty??x.qty,tx.qty)));
    if (p) used.add(p);
    return p;
  });
  if (!list.length || list.some(p => !p || p.deleted)) return null;
  const target = (data.vehicles || []).find(v => v.id === targetVehicleId);
  let res = null, created = false;
  list.forEach(p => {
    const grade = parseFuelGrade(p.product) || (p.vehicleId ? p.grade : '') || vehicleFuelGrade(target);
    const had = fpRecordFor(targetVehicleId, p.date, grade, false);
    res = fpUpdate(p, { vehicleId: targetVehicleId, grade });
    if (!had) created = true;
  });
  return res && { record: res.record, created, beforeIssued: created ? null : res.before, afterIssued: res.after };
}

function fuelImportRefreshVisibleVehicle() {
  if (typeof renderVehicleList === 'function') renderVehicleList();
  if (selectedVehicleId && typeof renderDetail === 'function') {
    const v = (data.vehicles || []).find(x => x.id === selectedVehicleId);
    if (v) renderDetail(v);
  }
}

async function changeFuelImportReportVehicle(index){try{const row=_fuelImportLastReport?.reportRows?.[index],select=document.getElementById('fuelImportVehicle_'+index),target=fuelImportSelectedVehicle(select);if(!row||target==null)throw Error('Выберите точную машину');const purchases=(row.transactions||[]).map(tx=>(data.fuelPurchases||[]).filter(p=>!p.deleted&&(tx.importKeyV3?p.importKeyV3===tx.importKeyV3:p.importKey===tx.importKey)));if(purchases.length!==1||purchases[0].length!==1)throw Error('Для группы покупок откройте исходную выписку и проверьте каждую строку в едином плане');return reviewedImportMapPurchase(purchases[0][0].id,target);}catch(error){showToast(error.message);return null;}}

async function assignFuelImportUnmatchedVehicle(index){try{const row=_fuelImportLastReport?.unmatchedRows?.[index],target=fuelImportSelectedVehicle(document.getElementById('fuelImportUnmatchedVehicle_'+index));if(!row||target==null)throw Error('Выберите точную машину');if(!row.purchaseId)throw Error('У старой загрузки нет подтверждённой покупки. Выберите исходную выписку повторно');return reviewedImportMapPurchase(row.purchaseId,target);}catch(error){showToast(error.message);return null;}}

function fuelImportExceptionHtml(id) {
  const batch=(data.fuelImports || []).find(row => row.id === id); if(!batch) return '';
  const corrections=batch.corrections || [], quarantined=batch.quarantined || [], rejected=batch.rejectedRows || [], archive=batch.sourceArchive;
  const archiveHtml=archive?.available ? '<div>Исходник сохранён: '+fpEsc(archive.name || batch.fileName)+' · SHA256 '+fpEsc(archive.sha256)+'</div>' : '<div style="color:var(--amber)">'+fpEsc(archive?.reason || 'Архив исходного файла не был сохранён')+'</div>';
  const exceptions=corrections.length+quarantined.length+rejected.length;
  return '<div class="gsm-status">'+archiveHtml+(exceptions ? '<b>Особые строки: '+exceptions+'</b><div>Корректировки и неизвестные товары не изменяют обычную выдачу. Результаты сверки сохраняются в истории.</div>' : '')+'</div>'+
    (corrections.length ? '<details open><summary>Возвраты / сторно / корректировки: '+corrections.length+'</summary><table class="data-table"><thead><tr><th>Строка / дата</th><th>Операция</th><th>Изменение литров</th><th>Изменение суммы</th><th>Исходная транзакция</th><th>Статус</th><th></th></tr></thead><tbody>'+corrections.map((row,index) => '<tr><td>'+row.sourceRow+' · '+fpEsc(row.date)+'</td><td>'+fpEsc(row.sourceOperation || row.kind)+'</td><td>'+(row.qtyDelta == null ? 'направление требует сверки' : fpNum(row.qtyDelta,2))+'</td><td>'+(row.sumDelta == null ? 'направление требует сверки' : fpNum(row.sumDelta,2))+'</td><td>'+fpEsc(row.originalTransactionId || 'не указана')+'</td><td>'+fpEsc(row.status === 'already-recorded' ? 'Уже зарегистрирована ранее' : row.status === 'reviewed' ? 'Сверена: '+(row.reviewNote || '') : 'Требуется сверка; в учёт не проведена')+'</td><td>'+(row.status === 'already-recorded' ? '' : '<button class="btn btn-ghost btn-sm" onclick="fuelImportReviewCorrection('+fpEsc(JSON.stringify(id))+','+index+')">Результат сверки</button>')+'</td></tr>').join('')+'</tbody></table></details>' : '')+
    (quarantined.length ? '<details open><summary>Товары без распознанной марки топлива: '+quarantined.length+'</summary><p>Уточните товар в исходном файле и повторите импорт; эти строки не включены в выдачу и остатки.</p><table class="data-table"><thead><tr><th>Строка</th><th>Дата</th><th>Товар</th><th>Количество</th><th>Карта</th></tr></thead><tbody>'+quarantined.map(row => '<tr><td>'+row.sourceRow+'</td><td>'+fpEsc(row.date)+'</td><td>'+fpEsc(row.fuel || 'пустой товар')+'</td><td>'+fpNum(row.qty,2)+'</td><td>'+fpEsc(row.cardNo)+'</td></tr>').join('')+'</tbody></table></details>' : '')+
    (rejected.length ? '<details><summary>Остальные строки на проверку: '+rejected.length+'</summary>'+rejected.map(row => '<p>Строка '+row.sourceRow+': '+fpEsc(row.reason)+' · '+fpEsc(row.sourceOperation || row.rawDate || '')+'</p>').join('')+'</details>' : '');
}
function fuelImportOpenBatch(id) {
  const batch=(data.fuelImports || []).find(row => row.id === id); if (!batch) return;
  if(batch.importBatch?.sourceId)return reviewedImportOpenSource(batch.importBatch.sourceId);
  wfShowDialog('Проверка загрузки: '+batch.fileName,fuelImportExceptionHtml(id)+'<details><summary>Решения по исходным строкам</summary>'+(batch.decisions || []).map(row => '<p>Строка '+row.sourceRow+': '+fpEsc(row.decision)+'</p>').join('')+'</details>');
}
function fuelImportReviewCorrection(id,index) {
  const batch=(data.fuelImports || []).find(row => row.id === id), correction=batch?.corrections?.[index]; if(!correction) return;
  wfShowDialog('Результат сверки корректировки','<p>Операция не проводит отрицательную выдачу автоматически. Укажите исходный документ и как отражено исправление.</p><form id="fuelCorrectionReview"><label>Основание / результат<textarea id="fuelCorrectionNote" required minlength="5">'+fpEsc(correction.reviewNote || '')+'</textarea></label><button class="btn btn-primary">Зафиксировать сверку</button></form>');
  document.getElementById('fuelCorrectionReview').onsubmit=async event => {
    event.preventDefault(); const note=document.getElementById('fuelCorrectionNote').value.trim(); if(note.length < 5) return;
    const current=(data.fuelImports || []).find(row => row.id === id)?.corrections?.[index]; if(!current || current.id !== correction.id) { showToast('Загрузка изменилась. Откройте её заново.'); return; }
    Object.assign(current,{status:'reviewed',reviewNote:note,reviewedAt:new Date().toISOString(),ledgerApplied:false});
    if(await saveData(data,{noMerge:true})) fuelImportOpenBatch(id);
  };
}
function showFuelImportReport(report) {
  _fuelImportLastReport = report;
  (report.reportRows || []).forEach((r, i) => { r._reportIndex = i; });
  (report.unmatchedRows || []).forEach((r, i) => { r._unmatchedIndex = i; });
  const body = document.getElementById('fuelImportReportBody');
  const modal = document.getElementById('fuelImportReportModal');
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const num = (v, dec = 2) => (+v || 0).toLocaleString('ru', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
  const signedNum = (v) => v == null ? '—' : num(v);
  const actionStyle = {
    added: 'background:#dcfce7;color:#15803d',
    updated: 'background:#dbeafe;color:#1d4ed8',
    adjusted: 'background:#fef3c7;color:#b45309',
    review: 'background:#fff4d4;color:#785600',
    duplicate: 'background:var(--bg3);color:var(--text3)',
  };
  const actionOrder = { added: 1, adjusted: 2, updated: 3, duplicate: 4 };
  const changedRows = report.reportRows.filter(r => r.action !== 'duplicate' && r.action !== 'review');
  const reviewRows = report.reportRows.filter(r => r.action === 'review');
  const loadedLitres = report.addedLitres + report.updatedLitres + report.adjustedLitres;
  const sortedRows = report.reportRows.slice().sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') ||
    (a.vehicle || '').localeCompare(b.vehicle || '') ||
    (actionOrder[a.action] || 9) - (actionOrder[b.action] || 9)
  );
  const sortedUnmatched = report.unmatchedRows.slice().sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.sourceRow || 0) - (b.sourceRow || 0)
  );
  const mergedRows = sortedRows.filter(r => r.transactionCount > 1);

  // Итоги по видам топлива: сколько загружено и сколько уже было
  const byGrade = {};
  report.reportRows.forEach(r => {
    const g = byGrade[r.grade || '—'] || (byGrade[r.grade || '—'] = { loaded: 0, dup: 0, n: 0 });
    if (r.action === 'duplicate') g.dup += +r.qty || 0; else g.loaded += +r.qty || 0;
    g.sum = (g.sum || 0) + (+r.sum || 0);
    g.sumQty = (g.sumQty || 0) + (r.sum ? +r.qty || 0 : 0);
    g.n++;
  });
  (report.unmatchedRows || []).forEach(r => {
    const k = parseFuelGrade(r.fuel) || '—';
    const g = byGrade[k] || (byGrade[k] = { loaded: 0, dup: 0, n: 0 });
    g.skip = (g.skip || 0) + (+r.qty || 0);
    g.sum = (g.sum || 0) + (+r.sum || 0);
    g.sumQty = (g.sumQty || 0) + (r.sum ? +r.qty || 0 : 0);
  });
  const gradeKeys = Object.keys(byGrade).sort((a, b) =>
    (typeof frFuelSort === 'function' ? frFuelSort(a, b) : a.localeCompare(b, 'ru')));
  const gradeHtml = gradeKeys.length ? `
    <div class="table-wrap" style="margin-bottom:14px">
      <div class="table-toolbar"><div class="table-toolbar-left">По видам топлива</div></div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>Вид топлива</th><th style="text-align:right">Загружено, л</th><th style="text-align:right">Уже было, л</th><th style="text-align:right">Не загрузилось, л</th><th style="text-align:right">Всего, л</th><th style="text-align:right">Сумма, ₽</th><th style="text-align:right">Ср. цена, ₽/л</th></tr></thead>
        <tbody>${gradeKeys.map(k => { const g = byGrade[k]; return `
          <tr><td style="font-weight:700">${esc(k)}</td>
            <td style="text-align:right">${num(g.loaded)}</td>
            <td style="text-align:right">${num(g.dup)}</td>
            <td style="text-align:right;${g.skip ? 'color:var(--red)' : ''}">${num(g.skip || 0)}</td>
            <td style="text-align:right;font-weight:700">${num(g.loaded + g.dup + (g.skip || 0))}</td>
            <td style="text-align:right">${g.sum ? num(g.sum) : '—'}</td>
            <td style="text-align:right">${g.sumQty ? num(g.sum / g.sumQty) : '—'}</td></tr>`; }).join('')}</tbody>
      </table>
    </div>` : '';

  const card = (title, value, sub, color) => `
    <div style="flex:1;min-width:140px;background:var(--bg2);border:1px solid var(--border);border-left:4px solid ${color};border-radius:8px;padding:12px 14px">
      <div style="font-size:12px;color:var(--text3);margin-bottom:4px">${esc(title)}</div>
      <div style="font-size:20px;font-weight:800;color:var(--text1)">${esc(value)}</div>
      ${sub ? `<div style="font-size:12px;color:var(--text3);margin-top:3px">${esc(sub)}</div>` : ''}
    </div>`;

  const rowHtml = sortedRows.map(r => `
    <tr>
      <td>${esc(r.date)}</td>
      <td><span style="display:inline-block;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700;${actionStyle[r.action] || actionStyle.duplicate}">${esc(r.statusText)}</span></td>
      <td>${esc(r.vehicle)}</td>
      <td>${esc(r.grade || '—')}</td>
      <td style="text-align:right;font-weight:700">${num(r.qty)}</td>
      <td style="text-align:right">${r.sum ? num(r.sum) : '—'}</td>
      <td style="text-align:right">${r.sum && r.qty ? num(r.sum / r.qty) : '—'}</td>
      <td style="text-align:right">${signedNum(r.beforeIssued)}</td>
      <td style="text-align:right">${signedNum(r.afterIssued)}</td>
      <td style="text-align:center">${r.transactionCount}</td>
      <td>${esc(r.sourceRows.join(', '))}</td>
      <td>${esc(r.cardNo || '—')}</td>
      <td style="max-width:300px;white-space:normal">${esc(r.comment || '—')}</td>
      <td style="min-width:260px">
        <div style="display:flex;gap:6px;align-items:center">
          <select id="fuelImportVehicle_${r._reportIndex}" class="fsel" style="min-width:185px;max-width:210px">${fuelImportVehicleOptions(r.vehicleId)}</select>
          <button class="btn btn-primary btn-sm" onclick="changeFuelImportReportVehicle(${r._reportIndex})" style="padding:4px 10px;font-size:12px">Применить</button>
        </div>
      </td>
    </tr>
  `).join('');

  const unmatchedHtml = sortedUnmatched.length ? `
    <div class="table-wrap" style="margin-top:14px">
      <div class="table-toolbar">
        <div class="table-toolbar-left">Не загрузилось: не найдено ТС</div>
      </div>
      <div class="table-scroll" style="max-height:220px;overflow:auto">
        <table class="data-table" style="width:100%">
          <thead><tr><th>Строка Excel</th><th>Дата</th><th style="text-align:right">Литры</th><th style="text-align:right">Сумма, ₽</th><th>Карта</th><th>ТС</th><th>Комментарий</th><th>Загрузить на ТС</th></tr></thead>
          <tbody>${sortedUnmatched.map(r => `
            <tr>
              <td>${esc(r.sourceRow)}</td>
              <td>${esc(r.date)}</td>
              <td style="text-align:right;font-weight:700">${num(r.qty)}</td>
              <td style="text-align:right">${r.sum ? num(r.sum) : '—'}</td>
              <td>${esc(r.cardNo || '—')}</td>
              <td>${esc(r.vehicleText || '—')}</td>
              <td style="max-width:360px;white-space:normal">${esc(r.comment || '—')}</td>
              <td style="min-width:260px">
                <div style="display:flex;gap:6px;align-items:center">
                  <select id="fuelImportUnmatchedVehicle_${r._unmatchedIndex}" class="fsel" style="min-width:185px;max-width:210px">${fuelImportVehicleOptions('', true)}</select>
                  <button class="btn btn-primary btn-sm" onclick="assignFuelImportUnmatchedVehicle(${r._unmatchedIndex})" style="padding:4px 10px;font-size:12px">Загрузить</button>
                </div>
              </td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    </div>
  ` : `
    <div style="margin-top:14px;background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;font-size:13px">
      Все строки сопоставлены с техникой. Ничего не вылетело по причине «ТС не найдено».
    </div>
  `;

  const mergedHtml = mergedRows.length ? `
    <div class="table-wrap" style="margin-top:14px">
      <div class="table-toolbar">
        <div class="table-toolbar-left">Объединённые покупки</div>
      </div>
      <div class="table-scroll" style="max-height:280px;overflow:auto">
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th>Дата</th><th>ТС</th><th>Строка Excel</th><th style="text-align:right">Литры</th><th style="text-align:right">Сумма, ₽</th><th>Товар</th><th>Карта</th><th>ТС из отчёта</th><th>Комментарий</th>
            </tr>
          </thead>
          <tbody>${mergedRows.map(group => {
            const rows = group.transactions.map((tx, idx) => `
              <tr>
                ${idx === 0 ? `<td rowspan="${group.transactions.length}">${esc(group.date)}</td><td rowspan="${group.transactions.length}">${esc(group.vehicle)}<div style="font-size:11px;color:var(--text3);margin-top:3px">Итого: ${num(group.qty)} л</div></td>` : ''}
                <td>${esc(tx.sourceRow)}</td>
                <td style="text-align:right;font-weight:700">${num(tx.qty)}</td>
                <td style="text-align:right">${tx.sum ? num(tx.sum) : '—'}</td>
                <td>${esc(tx.fuel || '—')}</td>
                <td>${esc(tx.cardNo || '—')}</td>
                <td>${esc(tx.vehicleText || '—')}</td>
                <td style="max-width:320px;white-space:normal">${esc(tx.comment || '—')}</td>
              </tr>
            `).join('');
            return rows;
          }).join('')}</tbody>
        </table>
      </div>
    </div>
  ` : `
    <div style="margin-top:14px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;color:var(--text3)">
      Объединённых покупок нет: каждая строка Excel попала в отдельную дневную запись.
    </div>
  `;

  const html = fuelImportExceptionHtml(report.importId) + `
    <div style="font-size:13px;color:var(--text3);margin-bottom:12px">
      Файл: <b style="color:var(--text1)">${esc(report.fileName || '—')}</b>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
      ${card('Транзакций в Excel', String(report.transactionsCount), num(report.sourceLitres) + ' л' + (report.sourceSum ? ' · ' + num(report.sourceSum) + ' ₽' : ''), '#64748b')}
      ${card('Дневных записей', String(report.groupedCount), report.mergedTransactions ? 'объединено покупок: ' + report.mergedTransactions : 'без объединений', '#2563eb')}
      ${card('Загружено/изменено', String(changedRows.length), num(loadedLitres) + ' л', '#16a34a')}
      ${card('Уже было', String(report.duplicates), num(report.duplicateLitres) + ' л', '#94a3b8')}
      ${reviewRows.length ? card('На сверку с журналом', String(reviewRows.length), num(reviewRows.reduce((s,r) => s + r.qty, 0)) + ' л; ручной журнал не изменён', '#b45309') : ''}
      ${card('Не загрузилось', String(report.skipped), num(report.skippedLitres) + ' л', report.skipped ? '#dc2626' : '#16a34a')}
    </div>
    ${report.closedCount ? `<div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px">Пропущено строк закрытых месяцев (${report.closedMonths.map(m => fpMonthLabel(m)).join(", ")}): ${report.closedCount}, ${num(report.closedLitres)} л. Чтобы загрузить их, откройте месяц: Заправки → Закрытие месяца.</div>` : ""}
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;font-size:12px;color:var(--text3)">
      <span>Добавлено: <b style="color:var(--text1)">${report.added}</b> (${num(report.addedLitres)} л)</span>
      <span>Обновлено: <b style="color:var(--text1)">${report.updated}</b> (${num(report.updatedLitres)} л)</span>
      <span>Уточнено округлений: <b style="color:var(--text1)">${report.adjusted}</b> (${num(report.adjustedLitres)} л)</span>
      ${report.backfilledSums ? `<span>Проставлены суммы в ранее загруженные записи: <b style="color:var(--text1)">${report.backfilledSums}</b></span>` : ''}
    </div>
    ${gradeHtml}
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="table-toolbar-left">Что произошло по датам</div>
      </div>
      <div class="table-scroll" style="max-height:360px;overflow:auto">
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th>Дата</th><th>Статус</th><th>ТС</th><th>Топливо</th><th style="text-align:right">Литры из Excel</th><th style="text-align:right">Сумма, ₽</th><th style="text-align:right">Цена, ₽/л</th>
              <th style="text-align:right">Было</th><th style="text-align:right">Стало</th>
              <th style="text-align:center">Покупок</th><th>Строки Excel</th><th>Карта</th><th>Комментарий</th><th>Изменить ТС</th>
            </tr>
          </thead>
          <tbody>${rowHtml || '<tr><td colspan="14" style="text-align:center;color:var(--text3);padding:16px">Нет обработанных строк</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="gsm-actions"><button class="btn btn-primary" onclick="gsmOpenStatement()">Открыть выписку</button></div>
    ${mergedHtml}
    ${unmatchedHtml}
  `;

  if (!body || !modal || typeof openModal !== 'function') {
    alert('Импорт заправок завершён.\nТранзакций: ' + report.transactionsCount +
      '\nДневных записей: ' + report.groupedCount +
      '\nНе найдено ТС: ' + report.skipped);
    return;
  }
  body.innerHTML = html;
  openModal('fuelImportReportModal');
}

// ─── ИМПОРТ ИЗ RAR (пополнение данных) ───────────────────
const RAR_KEYS = ['vehicles', 'records', 'generators', 'genRecords', 'toRecords', 'tanks', 'tankIncomes'];
const RAR_LABELS = { vehicles:'ТС', records:'записей о поездках', generators:'ДЭС', genRecords:'записей ДЭС', toRecords:'записей ТО', tanks:'ёмкостей', tankIncomes:'записей прихода' };
let _rarImport = null;

async function importFromRar(){try{reviewedImportReady();if(!window.electronAPI?.importRar)throw Error('Загрузка RAR доступна только в установленной программе');const database=data,context=reviewedImportStamp(),result=await window.electronAPI.importRar();if(!result||result.canceled)return null;if(database!==data||context!==reviewedImportStamp())throw Error('База или права изменились во время выбора архива');if(!result.ok)throw Error(result.error||'Не удалось прочитать архив');return reviewedImportNative('section-data',result,RAR_KEYS,{parser:{id:'section-data',version:1},mapping:{includeBackups:false},allowBackups:result.backupCount>0});}catch(error){showToast(error.message);return null;}}
async function importFromJsonFile(){try{reviewedImportReady();if(!window.electronAPI?.importJsonFile)throw Error('Загрузка JSON доступна только в установленной программе');const database=data,context=reviewedImportStamp(),result=await window.electronAPI.importJsonFile();if(!result||result.canceled)return null;if(database!==data||context!==reviewedImportStamp())throw Error('База или права изменились во время выбора файла');if(!result.ok)throw Error(result.error||'Не удалось прочитать файл');return reviewedImportNative('section-data',result,RAR_KEYS,{parser:{id:'section-data',version:1}});}catch(error){showToast(error.message);return null;}}

// ─── ИМПОРТ ИЗ СВОДКИ (PDF) ──────────────────────────────
let _svodkaParsed = null;

async function importSvodkaPdf(){try{reviewedImportReady();if(!window.electronAPI?.importSvodkaPdf)throw Error('Загрузка PDF доступна только в установленной программе');const database=data,context=reviewedImportStamp(),result=await window.electronAPI.importSvodkaPdf();if(!result||result.canceled)return null;if(database!==data||context!==reviewedImportStamp())throw Error('База или права изменились во время чтения PDF');if(!result.ok)throw Error(result.error||'Не удалось прочитать PDF');const parsed=parseSvodkaItems(result.items||[]),decoded={rows:parsed.map((row,index)=>({rowId:'summary-'+index,section:'records',locator:{entry:result.fileName,page:row.sourcePage,row:row.sourceRow},raw:row,normalized:{date:row.date,sourceVehicleLabel:[row.plate,row.make].filter(Boolean).join(' · '),...Object.fromEntries(['km','fuelIssued','fuelActual','fuelUsed','route','note'].filter(key=>row[key]!==null&&row[key]!==undefined&&row[key]!=='').map(key=>[key,row[key]]))}}))};return reviewedImportNative('section-data',result,['records'],{parser:{id:'section-data',version:1},decoded});}catch(error){showToast(error.message);return null;}}

function parseSvodkaItems(items) {
  const sorted = items.slice().sort((a, b) => {
    const pageDiff = (a.page || 1) - (b.page || 1);
    if (pageDiff !== 0) return pageDiff;
    const dy = b.y - a.y;
    if (Math.abs(dy) > 3) return dy;
    return a.x - b.x;
  });

  const lines = [];
  let cur = null;
  for (const it of sorted) {
    const y = it.y;
    if (!cur || Math.abs(cur.y - y) > 3 || (it.page || 1) !== cur.page) {
      cur = { y, page: it.page || 1, parts: [it] };
      lines.push(cur);
    } else {
      cur.parts.push(it);
    }
  }
  for (const line of lines) {
    line.parts.sort((a, b) => a.x - b.x);
    line.text = line.parts.map(p => p.str).join(' ');
  }

  let headerLine = -1;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const t = lines[i].text.toLowerCase();
    if (t.includes('госномер') && (t.includes('марка') || t.includes('модель'))) {
      headerLine = i;
      break;
    }
  }
  if (headerLine === -1) return [];

  const hLine = lines[headerLine];
  const hParts = hLine.parts;
  const hAll = [];
  for (let li = headerLine; li < Math.min(headerLine + 3, lines.length); li++) {
    for (const p of lines[li].parts) hAll.push(p);
  }

  const colDefs = [
    { key: 'num',    words: ['№'] },
    { key: 'plate',  words: ['госномер'] },
    { key: 'make',   words: ['марка', 'модель'] },
    { key: 'driver', words: ['водител'] },
    { key: 'org',    words: ['организац'] },
    { key: 'object', words: ['объект'] },
    { key: 'fuel',   words: ['топлив'] },
    { key: 'status', words: ['состоян'] },
    { key: 'km',     words: ['пробег'] },
    { key: 'issued', words: ['выдано'] },
    { key: 'norm',   words: ['норм'] },
    { key: 'actual', words: ['факт'] },
    { key: 'avg',    words: ['ср.расх', 'средн', 'ср.'] },
    { key: 'route',  words: ['маршрут'] },
    { key: 'note',   words: ['примечан'] },
  ];

  const colBounds = [];
  for (const def of colDefs) {
    let found = null;
    for (const w of def.words) {
      found = hAll.find(p => p.str.toLowerCase().includes(w));
      if (found) break;
    }
    colBounds.push({ name: def.key, x: found ? found.x : -1 });
  }
  colBounds.sort((a, b) => a.x - b.x);

  let periodDate = null;
  for (let i = 0; i <= headerLine; i++) {
    const t = lines[i].text;
    const m = t.match(/(\d{2}\.\d{2}\.\d{4})/);
    if (m) {
      const parts = m[1].split('.');
      periodDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      break;
    }
  }

  function getCellText(line, colIdx) {
    if (colBounds[colIdx].x === -1) return '';
    const xStart = colBounds[colIdx].x - 5;
    const xEnd = colIdx + 1 < colBounds.length && colBounds[colIdx + 1].x !== -1
      ? colBounds[colIdx + 1].x - 5
      : 99999;
    return line.parts
      .filter(p => p.x >= xStart && p.x < xEnd)
      .map(p => p.str).join(' ').trim();
  }

  function colIndex(name) {
    return colBounds.findIndex(c => c.name === name);
  }

  const rows = [];
  for (let i = headerLine + 1; i < lines.length; i++) {
    const line = lines[i];
    const txt = line.text.trim();
    if (!txt) continue;
    if (txt.startsWith('Объект:') || txt.startsWith('ИТОГО') || txt.includes('СВОДКА')) continue;
    if (txt.toLowerCase().includes('дата выпуска') || txt.toLowerCase().includes('период:')) continue;

    const numText = getCellText(line, colIndex('num'));
    const num = parseInt(numText);
    if (!num || num < 1 || num > 999) continue;

    const plate = getCellText(line, colIndex('plate')).replace(/\s+/g, '');
    if (!plate) continue;

    const make = getCellText(line, colIndex('make'));
    const driver = getCellText(line, colIndex('driver'));
    const org = getCellText(line, colIndex('org'));
    const object = getCellText(line, colIndex('object'));
    const fuelText = getCellText(line, colIndex('fuel'));
    const status = getCellText(line, colIndex('status'));
    const kmText = getCellText(line, colIndex('km'));
    const issuedText = getCellText(line, colIndex('issued'));
    const normText = getCellText(line, colIndex('norm'));
    const actualText = getCellText(line, colIndex('actual'));
    const avgText = getCellText(line, colIndex('avg'));
    const route = getCellText(line, colIndex('route'));
    const note = getCellText(line, colIndex('note'));

    const parseFl = value => {if(!String(value??'').trim())return null;try{return DecimalCore.parseInput(value,{scale:3,blank:'null',nonNegative:true,max:1e12});}catch{return String(value);}};
    let fuel = '';
    const ft = fuelText.toLowerCase();
    if(ft.includes('дизел')||ft==='дт')fuel='diesel';else if (ft.includes('бензин') || ft.includes('аи')) fuel = 'gasoline';
    else if (ft.includes('газ') || ft.includes('пропан')) fuel = 'gas';

    rows.push({
      num, plate, make, driver, org, object, fuel, fuelText, status,
      km: parseFl(kmText), fuelIssued: parseFl(issuedText),
      fuelUsed: parseFl(normText), fuelActual: parseFl(actualText),
      avgConsumption: parseFl(avgText),
      route, note, date: periodDate, sourcePage:line.page,sourceRow:i+1,
    });
  }
  return rows;
}

function showSvodkaPreview(rows, fileName) {
  const existing = new Set(data.vehicles.map(v => normPlate(v.plate)));
  let newCount = 0, updateCount = 0;
  rows.forEach(r => {
    if (existing.has(normPlate(r.plate))) updateCount++;
    else newCount++;
  });

  document.getElementById('svodkaImportTitle').textContent = 'Импорт из Сводки (PDF)';
  let info = '<b>Файл:</b> ' + _pdfEsc(fileName) + '<br>';
  info += '<b>Дата:</b> ' + (rows[0] && rows[0].date ? fmtDate(rows[0].date) : '—') + '<br>';
  info += '<b>Найдено ТС:</b> ' + rows.length;
  if (newCount) info += ' (<span style="color:#16a34a;font-weight:600">+' + newCount + ' новых</span>)';
  if (updateCount) info += ' (<span style="color:#2563eb;font-weight:600">' + updateCount + ' обновление</span>)';
  document.getElementById('svodkaImportInfo').innerHTML = info;

  let html = '<thead><tr><th>✓</th><th>№</th><th>Госномер</th><th>Марка</th><th>Водитель</th><th>Объект</th><th>Топливо</th><th>Состояние</th><th>Пробег</th><th>Выдано</th><th>Расход</th><th>Маршрут</th><th>Статус</th></tr></thead><tbody>';
  rows.forEach((r, i) => {
    const isNew = !existing.has(normPlate(r.plate));
    const badge = isNew
      ? '<span style="color:#16a34a;font-weight:600">Новое ТС</span>'
      : '<span style="color:#2563eb">Обновление</span>';
    html += '<tr>';
    html += '<td><input type="checkbox" class="svodka-chk" data-idx="' + i + '" checked style="width:auto;accent-color:var(--accent)"></td>';
    html += '<td>' + r.num + '</td>';
    html += '<td><b>' + _pdfEsc(r.plate) + '</b></td>';
    html += '<td>' + _pdfEsc(r.make) + '</td>';
    html += '<td>' + _pdfEsc(r.driver) + '</td>';
    html += '<td>' + _pdfEsc(r.object) + '</td>';
    html += '<td>' + _pdfEsc(r.fuelText) + '</td>';
    html += '<td>' + _pdfEsc(r.status) + '</td>';
    html += '<td>' + r.km + '</td>';
    html += '<td>' + r.fuelIssued + '</td>';
    html += '<td>' + r.fuelActual + '</td>';
    html += '<td>' + _pdfEsc(r.route || '—') + '</td>';
    html += '<td>' + badge + '</td>';
    html += '</tr>';
  });
  html += '</tbody>';
  document.getElementById('svodkaPreviewTable').innerHTML = html;
  openModal('svodkaImportModal');
}

function normPlate(s) {
  return (s || '').replace(/[\s\-]/g, '').toUpperCase();
}

async function doSvodkaImport(){showToast('Импорт сводки выполняется через проверяемый источник. Выберите исходный PDF повторно; старый предварительный просмотр не меняет факты.');return false;}

async function exportDesForOtherComputer() {
  if (!window.electronAPI || !window.electronAPI.exportJson) {
    alert('Экспорт доступен только в установленном приложении.');
    return;
  }
  const payload = {};
  DES_KEYS.forEach(k => { payload[k] = data[k] || []; });
  const d = new Date();
  const ds = `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()}`;
  const res = await window.electronAPI.exportJson(JSON.stringify(payload), `ДЭС_экспорт_${ds}.json`);
  if (res && res.ok) showToast('Файл сохранён: ' + res.filePath);
}

function showImportPreview(result){return reviewedImportNative('section-data',result,RAR_KEYS,{parser:{id:'section-data',version:1},mapping:{includeBackups:false}});}
async function doRarMerge(){showToast('Откройте исходный архив в проверяемом импорте и подтвердите его единый план. Прямого слияния нет.');return false;}

function fuelImportSelectedVehicle(select){if(!select||select.value==='')return null;const text=select.selectedOptions?.[0]?.dataset.typedId;if(text===undefined)throw Error('Откройте список машин заново: тип ссылки не подтверждён');let id;try{id=JSON.parse(text);}catch{throw Error('Некорректная ссылка на машину');}if(!EntityIdentity.identifier(id)||(data.vehicles||[]).filter(row=>row.id===id).length!==1)throw Error('Машина не найдена однозначно');return id;}
