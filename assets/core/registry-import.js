(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(()=>require('./document-state.js'),()=>require('./entity-identity.js'));else root.RegistryImport=factory(()=>root.DocumentState,()=>root.EntityIdentity);})(typeof globalThis==='object'?globalThis:this,function(getDocuments,getIdentity){
  'use strict';
  const MAX_ROWS=10000;
  const fields={sum:['сумма','сумма руб','сумма платежа','сумма к оплате','итого к оплате','amount','sum'],supplier:['контрагент','поставщик','получатель','наименование контрагента','supplier'],description:['назначение платежа','назначение','описание','наименование платежа','содержание','description'],obj:['объект','месторождение','объект затрат'],osn:['основание','счет','счёт','номер счета','счет на оплату','invoice'],date:['дата счета','дата счёта','дата','date'],invoiceNo:['номер счета','номер счёта','счет номер','invoice no'],dog:['номер договора с контрагентом','договор с контрагентом','договор'],incomeContract:['доходный договор'],initiator:['инициатор платежа','инициатор'],financeControl:['финконтроль','финансовый контроль'],category:['статья бддс','статья','категория']};
  const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
  const text=value=>value==null?'':String(value).trim();
  const key=value=>text(value).toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^а-яa-z0-9]+/g,' ').trim();
  const clone=value=>JSON.parse(JSON.stringify(value));
  const typed=id=>JSON.stringify([typeof id,id]);
  const isImportedRegister=entry=>entry?.kind==='payment-registry'&&entry.registryVersion===1;
  function cents(value){
    if(value===null||value===undefined||text(value)==='')return null;
    if(typeof value!=='string'&&typeof value!=='number')fail('REGISTRY_AMOUNT','Укажите сумму числом.');
    if(typeof value==='number'&&!Number.isFinite(value))fail('REGISTRY_AMOUNT','Некорректная сумма.');
    const raw=text(value).replace(/[\s\u00a0\u202f]/g,'').replace(/(?:руб\.?|₽)$/i,'').replace(',','.');
    if(!/^\d+(?:\.\d{1,2})?$/.test(raw))fail('REGISTRY_AMOUNT','Сумма должна быть неотрицательной, с точностью до копейки.');
    const parts=raw.split('.'),result=BigInt(parts[0])*100n+BigInt((parts[1]||'').padEnd(2,'0'));
    if(result>BigInt(Number.MAX_SAFE_INTEGER))fail('REGISTRY_AMOUNT','Сумма слишком велика.');return Number(result);
  }
  function amount(value){const result=cents(value);return result===null?null:result/100;}
  function total(values){let result=0;for(const value of values){const part=cents(value);if(part===null)fail('REGISTRY_AMOUNT','У части строк не указана сумма.');result+=part;if(!Number.isSafeInteger(result))fail('REGISTRY_AMOUNT','Общий итог слишком велик.');}return result/100;}
  function isoDate(value){const raw=text(value);if(!raw)return '';let y,m,d;let match=/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(raw);if(match)[,y,m,d]=match;else if((match=/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw)))[,d,m,y]=match;else return '';const date=new Date(Date.UTC(+y,+m-1,+d));return date.getUTCFullYear()===+y&&date.getUTCMonth()===+m-1&&date.getUTCDate()===+d?`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`:'';}
  function invoiceDetails(value){const match=/сч[её]т(?:\s+на\s+оплату)?\s*№?\s*([а-яa-z0-9][а-яa-z0-9\/_.-]*)\s+от\s+(\d{1,2}[./]\d{1,2}[./]\d{4})/i.exec(text(value));return match?{invoiceNo:match[1],date:isoDate(match[2])}:{invoiceNo:'',date:''};}
  function detectHeader(grid){let best=null;for(let index=0;index<Math.min(grid.length,60);index++){const names=grid[index].map(key),columns={};for(const[field,aliases]of Object.entries(fields)){const column=names.findIndex(name=>aliases.some(alias=>key(alias)===name));if(column>=0)columns[field]=column;}const score=Object.keys(columns).length;if(columns.sum!==undefined&&(columns.supplier!==undefined||columns.description!==undefined)&&(!best||score>best.score))best={headerRow:index,columns,score};}return best;}
  function parseTable(table,options={}){
    const grid=table.grid;if(!Array.isArray(grid)||grid.length>MAX_ROWS+100)fail('REGISTRY_LIMIT','В одном реестре допускается до 10 000 строк.');
    const detected=detectHeader(grid),headerRow=Number.isInteger(options.headerRow)?options.headerRow:detected?.headerRow,columns=options.columns||detected?.columns;
    if(!Number.isInteger(headerRow)||headerRow<0||headerRow>=grid.length||!columns||!Number.isInteger(columns.sum))fail('REGISTRY_COLUMNS','Не удалось определить столбцы. Выберите строку заголовков и столбец суммы.');
    for(const index of Object.values(columns))if(!Number.isInteger(index)||index<0||index>200)fail('REGISTRY_COLUMNS','Некорректный столбец.');
    const preamble=[...(table.preamble||[]),...grid.slice(0,headerRow).flat()].map(text).join('\n');
    const heading=/реестр\s*№?\s*([^\s]+)\s*от\s*(\d{1,2}\.\d{1,2}\.\d{4})/i.exec(preamble);
    const rows=[],warnings=[];let declaredTotal=null;
    for(let index=headerRow+1;index<grid.length;index++){
      const cells=grid[index];if(!Array.isArray(cells)||cells.every(value=>!text(value)))continue;
      const combined=cells.map(text).join(' '),get=field=>columns[field]===undefined?'':text(cells[columns[field]]);
      if(/^(?:всего|итого|общая сумма)(?:\s|:|$)/i.test(combined.trim())||cells.some(cell=>/^(?:всего|итого)(?:\s+по(?:\s|$)|\s*:?\s*$)/i.test(text(cell)))){const raw=get('sum');if(raw){try{declaredTotal=amount(raw);}catch{warnings.push('Не удалось прочитать итог исходного документа.');}}continue;}
      if(key(get('sum'))==='сумма руб'||key(get('supplier'))==='контрагент')continue;
      if(!get('sum')&&!get('supplier')&&!get('description'))continue;
      let sum=null;try{sum=amount(get('sum'));}catch{warnings.push('Проверьте сумму в строке '+(index+1)+'.');}
      const osn=get('osn'),details=invoiceDetails(osn+'\n'+get('description'));
      rows.push({sourceRow:index+1,sourcePage:table.rowPages?.[index]||null,supplier:get('supplier'),description:get('description'),obj:get('obj'),osn,invoiceNo:get('invoiceNo')||details.invoiceNo,date:isoDate(get('date'))||details.date,sum,dog:get('dog'),incomeContract:get('incomeContract'),initiator:get('initiator'),financeControl:get('financeControl'),category:get('category'),rawCells:cells.map(text)});
      if(rows.length>MAX_ROWS)fail('REGISTRY_LIMIT','В одном реестре допускается до 10 000 счетов.');
    }
    if(!rows.length)fail('REGISTRY_EMPTY','После заголовка не найдено счетов.');
    const knownTotal=rows.some(row=>row.sum===null)?null:total(rows.map(row=>row.sum));
    if(declaredTotal!==null&&knownTotal!==null&&cents(declaredTotal)!==cents(knownTotal))warnings.push('Сумма строк отличается от итога исходного документа. Проверьте все строки перед сохранением.');
    return {rows,headerRow,columns,number:heading?.[1]||'',date:heading?isoDate(heading[2]):'',declaredTotal,knownTotal,warnings};
  }
  function fingerprint(row){const details=invoiceDetails(row.osn||''),number=text(row.invoiceNo)||details.invoiceNo,date=isoDate(row.date)||details.date,supplier=key(row.supplier||row.contractor);return number&&date&&supplier&&cents(row.sum)!==null?JSON.stringify([supplier,number.toLocaleLowerCase('ru'),date,cents(row.sum)]):null;}
  function invoices(entry){
    const groups=new Map();for(const row of entry.rows||[]){const id=row.registryInvoiceId||row.id||'legacy-'+groups.size;if(!groups.has(id)){const copy=clone(row);copy.sum=row.registryInvoiceSum??row.sum;copy.allocations=[];groups.set(id,copy);}groups.get(id).allocations.push({kind:row.registryAllocationKind|| (row.vehicleId!==undefined?'vehicle':row.generatorId!==undefined?'generator':'unassigned'),assetId:row.vehicleId??row.generatorId??row.driverId??null,sum:row.sum,label:row.allocationLabel||'',expenseType:row.registryExpenseType||'other',...(row.serviceRef?{serviceRef:clone(row.serviceRef)}:{})});}return [...groups.values()].map(invoice=>({...invoice,driverId:linkedDriverId(invoice)}));
  }
  function linkedDriverId(invoice){const parts=invoice?.allocations||[];if(!parts.length||parts[0].kind!=='driver'||parts[0].assetId===null||parts[0].assetId===undefined)return null;const id=parts[0].assetId;return parts.every(part=>part.kind==='driver'&&part.assetId===id)?id:null;}
  function linkDriver(invoice,id){const result=clone(invoice);result.driverId=id??null;const parts=result.allocations?.length?result.allocations:[{sum:result.sum,kind:'unassigned',assetId:null}];result.allocations=parts.map(part=>{const next=id===null||id===undefined?part.kind==='driver'?{...part,kind:'unassigned',assetId:null,label:''}:part:{...part,kind:'driver',assetId:id,label:'',expenseType:part.expenseType||'other'};if(next.kind!=='vehicle')delete next.serviceRef;return next;});return result;}
  function driverInvoices(database,driverId){
    if(driverId===null||driverId===undefined)return [];
    const result=[];for(const entry of database.savedReestrs||[]){if(!isImportedRegister(entry))continue;for(const [index,invoice]of invoices(entry).entries()){const parts=invoice.allocations.filter(part=>part.kind==='driver'&&part.assetId===driverId);if(!parts.length)continue;result.push({registerId:entry.id,registerNumber:entry.number,invoiceId:invoice.registryInvoiceId,invoiceIndex:index,invoiceNo:invoice.invoiceNo||invoice.osn||'',date:invoice.date||'',supplier:invoice.supplier||'',description:invoice.description||'',sum:total(parts.map(part=>part.sum)),invoiceSum:invoice.sum,types:[...new Set(parts.map(part=>part.expenseType||'other'))]});}}return result;
  }
  // Invoice links live on registry allocations. Posting a repair, its cost and
  // payments remain independent facts; matching invoice numbers is never a FK.
  function serviceTarget(database,ref){
    if(!ref||!['repairs','vehicleTo'].includes(ref.section)||!['string','number'].includes(typeof ref.id)||typeof ref.id==='number'&&!Number.isFinite(ref.id)||typeof ref.id==='string'&&!ref.id.trim()||Object.keys(ref).some(field=>!['section','id'].includes(field)))fail('REGISTRY_SERVICE','Выберите запись ремонта или ТО.');
    const documents=getDocuments?.();if(!documents)fail('REGISTRY_SERVICE','Не загружены правила ремонта и ТО. Обновите страницу.');
    let resolved;try{resolved=documents.resolveDocument(database,ref);}catch{fail('REGISTRY_SERVICE','Связанный ремонт или ТО не найден однозначно. Сначала снимите привязку счёта.');}
    const row=resolved.effective;
    if(documents.state(ref.section,resolved.current)==='void'||row.deleted||row.cancelled||row.status==='cancelled')fail('REGISTRY_SERVICE','К отменённой записи нельзя привязать счёт. Сначала снимите привязку.');
    const explicit=row.assetRef===undefined?null:getIdentity?.()?.resolveAsset(database,row.assetRef),vehicleId=row.vehicleId??explicit?.id;if(explicit&&(explicit.status!=='known'||explicit.section!=='vehicles'||explicit.id!==vehicleId))fail('REGISTRY_SERVICE','Транспорт записи ремонта или ТО определён неоднозначно.');
    if((database.vehicles||[]).filter(asset=>asset.id===vehicleId).length!==1)fail('REGISTRY_SERVICE','Автомобиль ремонта или ТО не найден однозначно.');
    return {ref:{section:ref.section,id:resolved.root.id},row:{...row,vehicleId}};
  }
  function serviceChoices(database,vehicleId){
    if(vehicleId===null||vehicleId===undefined)return [];
    const result=[],seen=new Set();for(const section of ['repairs','vehicleTo'])for(const row of database[section]||[]){if(row.vehicleId!==vehicleId&&(row.vehicleId!==undefined||!row.assetRef||getIdentity?.()?.resolveAsset(database,row.assetRef)?.id!==vehicleId))continue;try{const item=serviceTarget(database,{section,id:row.id}),key=section+':'+typed(item.ref.id);if(item.row.vehicleId===vehicleId&&!seen.has(key)){seen.add(key);result.push(item);}}catch{}}
    return result;
  }
  function serviceInvoices(database,ref){
    const target=serviceTarget(database,ref),result=[];
    for(const entry of database.savedReestrs||[]){if(!isImportedRegister(entry))continue;const groups=new Map();for(const row of entry.rows||[]){if(row.registryAllocationKind!=='vehicle'||row.vehicleId!==target.row.vehicleId||row.serviceRef?.section!==target.ref.section||row.serviceRef?.id!==target.ref.id)continue;const id=row.registryInvoiceId;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}for(const [invoiceId,rows]of groups){const first=rows[0];result.push({registerId:entry.id,registerNumber:entry.number,invoiceId,invoiceNo:first.invoiceNo||first.osn||'',date:first.date||'',supplier:first.supplier||'',description:first.description||'',sum:total(rows.map(row=>row.sum)),invoiceSum:first.registryInvoiceSum});}}
    return result;
  }
  function setServiceLinks(database,ref,selection){
    const target=serviceTarget(database,ref),selected=new Set();if(!Array.isArray(selection))fail('REGISTRY_SERVICE','Не подтверждён список счетов.');
    for(const item of selection){if(!item||typeof item.rowId!=='string'||typeof item.registerId!=='string')fail('REGISTRY_SERVICE','Не подтверждена строка счёта.');const entry=(database.savedReestrs||[]).filter(entry=>isImportedRegister(entry)&&entry.id===item.registerId),rows=entry.length===1?(entry[0].rows||[]).filter(row=>row.id===item.rowId):[];if(rows.length!==1)fail('REGISTRY_SERVICE','Строка счёта изменилась. Откройте привязку заново.');const row=rows[0];if(row.registryAllocationKind!=='vehicle'||row.vehicleId!==target.row.vehicleId)fail('REGISTRY_SERVICE','Выберите счёт, распределённый на этот автомобиль.');if(row.serviceRef&&(row.serviceRef.section!==target.ref.section||row.serviceRef.id!==target.ref.id))fail('REGISTRY_SERVICE','Часть счёта уже связана с другим ремонтом или ТО. Сначала снимите прежнюю привязку.');const key=JSON.stringify([item.registerId,item.rowId]);if(selected.has(key))fail('REGISTRY_SERVICE','Строка счёта выбрана повторно.');selected.add(key);}
    return (database.savedReestrs||[]).map(entry=>{if(!isImportedRegister(entry))return entry;let changed=false;const rows=entry.rows.map(row=>{const wanted=selected.has(JSON.stringify([entry.id,row.id])),linked=row.serviceRef?.section===target.ref.section&&row.serviceRef?.id===target.ref.id;if(wanted===linked)return row;changed=true;const next=clone(row);if(wanted)next.serviceRef=clone(target.ref);else delete next.serviceRef;return next;});return changed?{...entry,reason:'Привязка счетов к '+(ref.section==='repairs'?'ремонту':'ТО'),rows}:entry;});
  }
  function buildRegister(input,database){
    if(!input||!Array.isArray(input.invoices)||!input.invoices.length||input.invoices.length>MAX_ROWS)fail('REGISTRY_EMPTY','Добавьте счета реестра.');
    const rows=[],invoiceIds=new Set(),reserved=new Set(input.invoices.map(invoice=>invoice.registryInvoiceId).filter(id=>id!==undefined));for(const [index,invoice]of input.invoices.entries()){
      let invoiceId=invoice.registryInvoiceId;if(invoiceId===undefined){let suffix=index;invoiceId=input.id+':invoice:'+suffix;while(invoiceIds.has(invoiceId)||reserved.has(invoiceId))invoiceId=input.id+':invoice:'+(++suffix);}if(typeof invoiceId!=='string'||!invoiceId||invoiceIds.has(invoiceId))fail('REGISTRY_STRUCTURE','Неверный или повторный ID счёта.');invoiceIds.add(invoiceId);
      const invoiceSum=amount(invoice.sum);if(invoiceSum===null)fail('REGISTRY_AMOUNT','Укажите сумму счёта '+(index+1)+'.');
      if(!text(invoice.supplier)&&!text(invoice.description))fail('REGISTRY_INVOICE','Укажите контрагента или назначение счёта '+(index+1)+'.');
      if(!Array.isArray(invoice.allocations)||!invoice.allocations.length)fail('REGISTRY_ALLOCATION','Добавьте распределение счёта '+(index+1)+'.');
      const allocations=invoice.driverId!==null&&invoice.driverId!==undefined?linkDriver(invoice,invoice.driverId).allocations:invoice.allocations;if(cents(total(allocations.map(row=>row.sum)))!==cents(invoiceSum))fail('REGISTRY_BALANCE','Распределение счёта '+(index+1)+' не совпадает с его суммой.');
      for(const [part,allocation]of allocations.entries()){
        if(!['vehicle','generator','driver','other','unassigned'].includes(allocation.kind))fail('REGISTRY_ALLOCATION','Выберите вид распределения.');
        const row={id:input.id+':'+index+':'+part,registryInvoiceId:invoiceId,registryInvoiceSum:invoiceSum,registryAllocationKind:allocation.kind,sum:amount(allocation.sum),supplier:text(invoice.supplier),description:text(invoice.description),obj:text(invoice.obj),invoiceNo:text(invoice.invoiceNo),date:isoDate(invoice.date),osn:text(invoice.osn),dog:text(invoice.dog),incomeContract:text(invoice.incomeContract),initiator:text(invoice.initiator),financeControl:text(invoice.financeControl),category:text(invoice.category),'statья':text(invoice.category),sourceRow:invoice.sourceRow||index+1,sourcePage:invoice.sourcePage||null};
        if(allocation.serviceRef)row.serviceRef=clone(allocation.serviceRef);
        if(invoice.contragentId!==null&&invoice.contragentId!==undefined)row.contragentId=invoice.contragentId;
        if(['vehicle','generator'].includes(allocation.kind)){const section=allocation.kind==='vehicle'?'vehicles':'generators',matches=(database[section]||[]).filter(asset=>asset.id===allocation.assetId);if(matches.length!==1)fail('REGISTRY_ASSET','Выберите одну доступную карточку техники.');const asset=matches[0];row[allocation.kind==='vehicle'?'vehicleId':'generatorId']=asset.id;row.allocationLabel=allocation.kind==='vehicle'?[asset.plate,asset.make].filter(Boolean).join(' · '):[asset.name,asset.serial].filter(Boolean).join(' · ');if(allocation.kind==='vehicle')row.vehiclePlate=asset.plate||'';row.org=text(asset.org);row.site=text(asset.site||asset.object||asset.location);}
        else if(allocation.kind==='driver'){const people=(database.drivers||[]).filter(person=>person.id===allocation.assetId);if(people.length!==1)fail('REGISTRY_DRIVER','Выберите одного водителя из справочника.');if(!['training','clothing','other'].includes(allocation.expenseType||'other'))fail('REGISTRY_EXPENSE','Выберите категорию расходов водителя.');const person=people[0];row.driverId=person.id;row.registryExpenseType=allocation.expenseType||'other';row.allocationLabel=text(person.name)||'Водитель';row.org=text(person.org);row.site=text(person.site||person.object);}
        else{row.allocationLabel=allocation.kind==='other'?text(allocation.label)||'Прочие платежи':'Не разнесено';if(input.org)row.org=text(input.org);if(row.obj)row.site=row.obj;}
        rows.push(row);
      }
    }
    const entry={id:input.id,kind:'payment-registry',registryVersion:1,workspace:'registries',number:text(input.number),date:isoDate(input.date),title:text(input.title),source:clone(input.source),rowCount:input.invoices.length,totalSum:total(rows.map(row=>row.sum)),declaredTotal:input.declaredTotal===null||input.declaredTotal===undefined?null:amount(input.declaredTotal),reason:text(input.reason),duplicateReason:text(input.duplicateReason),rows};
    validateRegister(entry,database);return entry;
  }
  function validateRegister(entry,database){
    if(entry.workspace!==undefined&&!['registries','logistics'].includes(entry.workspace))fail('REGISTRY_WORKSPACE','Загруженный реестр принадлежит разделу «Реестры».');
    if(typeof entry.id!=='string'||!/^[a-zA-Z0-9._:-]{1,160}$/.test(entry.id)||entry.registryVersion!==1||!Array.isArray(entry.rows)||!entry.rows.length||entry.rows.length>MAX_ROWS)fail('REGISTRY_STRUCTURE','Неверная структура реестра.');
    if(!entry.source||!/^[a-f0-9]{64}$/.test(entry.source.sha256)||entry.source.id!==entry.source.sha256+(/\.[a-z0-9]{1,6}$/i.exec(entry.source.name||'')?.[0]?.toLowerCase()||'.bin')||typeof entry.source.name!=='string'||!Number.isSafeInteger(entry.source.size)||entry.source.size<1||entry.source.size>25*1024*1024)fail('REGISTRY_SOURCE','Не подтверждён оригинал реестра.');
    if(typeof entry.number!=='string'||!entry.number||entry.number.length>200||entry.date!==isoDate(entry.date)||!entry.date||text(entry.reason).length<3)fail('REGISTRY_DETAILS','Укажите номер, дату реестра и основание сохранения.');
    const groups=new Map(),ids=new Set();for(const row of entry.rows){if(!row||typeof row.id!=='string'||ids.has(row.id)||typeof row.registryInvoiceId!=='string'||!['vehicle','generator','driver','other','unassigned'].includes(row.registryAllocationKind))fail('REGISTRY_STRUCTURE','Неверная строка распределения.');ids.add(row.id);if(cents(row.sum)===null||cents(row.registryInvoiceSum)===null)fail('REGISTRY_AMOUNT','Не указана сумма строки.');const key=row.registryInvoiceId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
      const kind=row.registryAllocationKind;if(kind!=='driver'&&Object.hasOwn(row,'registryExpenseType'))fail('REGISTRY_EXPENSE','Обучение и одежда должны быть связаны с водителем.');if(['vehicle','generator'].includes(kind)){const section=kind==='vehicle'?'vehicles':'generators',field=kind==='vehicle'?'vehicleId':'generatorId',opposite=kind==='vehicle'?'generatorId':'vehicleId';if(Object.hasOwn(row,'driverId')||Object.hasOwn(row,opposite)||(database[section]||[]).filter(asset=>asset.id===row[field]).length!==1)fail('REGISTRY_ASSET','Карточка техники не подтверждена.');}else if(kind==='driver'){if(Object.hasOwn(row,'vehicleId')||Object.hasOwn(row,'generatorId')||(database.drivers||[]).filter(person=>person.id===row.driverId).length!==1)fail('REGISTRY_DRIVER','Водитель не подтверждён.');if(!['training','clothing','other'].includes(row.registryExpenseType))fail('REGISTRY_EXPENSE','Не подтверждена категория расходов водителя.');}else if(Object.hasOwn(row,'vehicleId')||Object.hasOwn(row,'generatorId')||Object.hasOwn(row,'driverId'))fail('REGISTRY_ALLOCATION','Прочий или неразнесённый платёж не должен ссылаться на технику или водителя.');
    }
    for(const row of entry.rows){validateService(row,database);validateCounterparty(row,database);}
    for(const rows of groups.values()){const first=rows[0];for(const row of rows)for(const field of ['registryInvoiceSum','supplier','contragentId','invoiceNo','date','description','osn','sourceRow','sourcePage'])if(row[field]!==first[field])fail('REGISTRY_STRUCTURE','Части одного счёта содержат разные исходные реквизиты.');if(cents(total(rows.map(row=>row.sum)))!==cents(first.registryInvoiceSum))fail('REGISTRY_BALANCE','Сумма распределения отличается от суммы счёта.');}
    if(entry.rowCount!==groups.size||cents(entry.totalSum)!==cents(total(entry.rows.map(row=>row.sum)))||entry.declaredTotal!==null&&cents(entry.declaredTotal)!==cents(entry.totalSum))fail('REGISTRY_TOTAL','Общий итог реестра не сходится с суммой счетов.');
    return entry;
  }
  function validateService(row,database){
    if(!Object.hasOwn(row,'serviceRef'))return;
    if(row.registryAllocationKind!=='vehicle')fail('REGISTRY_SERVICE','Ремонт или ТО можно связать только с частью счёта на автомобиль.');
    const target=serviceTarget(database,row.serviceRef);if(target.ref.id!==row.serviceRef.id||target.row.vehicleId!==row.vehicleId)fail('REGISTRY_SERVICE','Счёт должен ссылаться на корень ремонта или ТО того же автомобиля. Сначала снимите прежнюю привязку.');
  }
  function validateCounterparty(row,database){if(row.contragentId!==null&&row.contragentId!==undefined&&(database.contragents||[]).filter(party=>party.id===row.contragentId).length!==1)fail('REGISTRY_COUNTERPARTY','Контрагент счёта не найден однозначно. Связанную карточку можно переместить в архив.');}
  function validateChanges(previous,next){
    // Also enforce links when a primary record is corrected, moved or removed.
    for(const entry of next.savedReestrs||[])if(isImportedRegister(entry))for(const row of entry.rows||[]){validateService(row,next);validateCounterparty(row,next);}
    const before=new Map((previous.savedReestrs||[]).map(entry=>[typed(entry.id),entry]));
    for(const entry of next.savedReestrs||[])if(before.get(typed(entry.id))?.kind==='payment-registry'&&entry.kind!=='payment-registry')fail('REGISTRY_STRUCTURE','Тип загруженного реестра нельзя менять.');
    for(const entry of next.savedReestrs||[]){if(entry.kind!=='payment-registry'||JSON.stringify(entry)===JSON.stringify(before.get(typed(entry.id))))continue;validateRegister(entry,next);
      const old=before.get(typed(entry.id));if(old?.kind==='payment-registry'&&['id','sha256','size','name','table'].some(field=>old.source?.[field]!==entry.source?.[field]))fail('REGISTRY_SOURCE','Оригинал сохранённого реестра нельзя подменять. Загрузите новый документ отдельно.');
      if((next.savedReestrs||[]).some(other=>other!==entry&&other.source?.sha256===entry.source.sha256&&(other.source.table||'')===(entry.source.table||'')))fail('REGISTRY_DUPLICATE_SOURCE','Этот реестр или лист файла уже загружен. Откройте сохранённый реестр.');
      const seen=new Set();for(const other of previous.savedReestrs||[])if(typed(other.id)!==typed(entry.id))for(const invoice of invoices(other)){const mark=fingerprint(invoice);if(mark)seen.add(mark);}for(const invoice of invoices(entry)){const mark=fingerprint(invoice);if(mark&&seen.has(mark)&&text(entry.duplicateReason).length<3)fail('REGISTRY_DUPLICATE_INVOICE','Счёт уже есть в реестрах. Для повтора укажите отдельное основание.');if(mark)seen.add(mark);}
    }
  }
  return Object.freeze({MAX_ROWS,fields,key,cents,amount,total,isoDate,invoiceDetails,detectHeader,parseTable,fingerprint,typed,invoices,linkedDriverId,linkDriver,driverInvoices,serviceTarget,serviceChoices,serviceInvoices,setServiceLinks,buildRegister,validateRegister,validateChanges,isImportedRegister});
});
