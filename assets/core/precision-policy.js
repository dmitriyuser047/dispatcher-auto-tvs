/* Precision is checked on changed facts, never by rewriting source snapshots. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./platform-schema.js'),()=>require('./decimal-core.js'));else root.PrecisionPolicy=factory(root.PlatformSchema,()=>root.DecimalCore);})(typeof globalThis==='object'?globalThis:this,function(schema,getDecimal){
  'use strict';
  const maximum='1000000000000', own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const specs={};
  const add=(section,scale,fields)=>{if(!specs[section])specs[section]=[];for(const field of fields.split(' ').filter(Boolean))specs[section].push(Object.freeze({field,scale,max:maximum}));};
  add('vehicles',3,'odometer fuelBalance tankVolume toIntervalKm maintenanceRules[].km fuelBalanceSources[].qty fuelAccounting.opening fuelAccounting.sources[].qty');
  add('vehicles',6,'norm normCity normHighway normIdle');
  add('records',3,'km kmGlonass fuelIssued fuelActual fuelUsed fuelIdle odoStart odoEnd tankMeasured');add('records',2,'fuelSum');
  add('generators',3,'hoursInit fuelBalance maintenanceRules[].hours fuelAccounting.opening fuelAccounting.sources[].qty');add('generators',6,'power norm norm100 norm50 normIdle');add('generators',2,'cost');
  add('genRecords',3,'hours meterStart meterEnd fuelIssued fuelUsed fuelActual');add('genRecords',6,'load');
  add('tanks',3,'capacity balanceInit reserveLevel fuelAccounting.opening fuelAccounting.sources[].qty');
  add('tankIncomes',3,'amount liters litres qty');add('tankIncomes',2,'sum vatAmount grossSum');add('tankIncomes',6,'vatRate');
  add('toRecords',3,'hours nextHours nextHoursAbs');add('toRecords',2,'cost');add('vehicleTo',3,'odometer nextKm nextOdometerAbs');add('vehicleTo',2,'cost');
  add('repairs',3,'mileage');add('repairs',2,'cost');add('payments',2,'sum paidAmount');add('budget',2,'sum');
  add('fuelPurchases',3,'qty');add('fuelPurchases',2,'sum');add('fuelPurchases',6,'price');add('monthlyFuel',3,'liters');add('monthlyFuel',2,'sum');
  add('dispatchJobs',3,'plannedKm actualKm plannedHours actualHours partRequirements[].qty');add('dispatchJobs',2,'cost');add('workOrders',2,'cost actualCost');
  add('fuelMovements',3,'qty');add('partMovements',3,'qty meter');add('parts',3,'minStock');add('shiftReports',3,'odoStart odoEnd hours fuelIssued tankMeasured');
  add('glonassTrips',3,'km fuel fuelIdle engine idle odoStart odoEnd');add('costEntries',2,'amount');add('costProfiles',6,'salaryRate depreciationRate fuelRate fuelPrice');
  add('procurementOrders',3,'quantity receivedQty stockPostedQty');add('procurementRules',3,'reserveQty expectedDaily');
  for(const section of Object.keys(specs))Object.freeze(specs[section]);Object.freeze(specs);
  function decimal(){let api;try{api=getDecimal();}catch{}if(!api||api.apiVersion!==1)throw Object.assign(Error('Не загружены правила точности чисел'),{code:'MODULE_UNAVAILABLE'});return api;}
  const rows=(db,section)=>Array.isArray(db?.[section])?db[section]:[];
  function stable(value){if(value===undefined)return 'undefined';if(typeof value==='number'&&!Number.isFinite(value))return '<number:'+String(value)+'>';if(value===null||typeof value!=='object')return JSON.stringify(value);return Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';}
  function rowKey(section,row,index){
    const descriptor=schema.descriptors[section].identity,value=row?.[descriptor.field];
    if(typeof value==='string'&&value.trim()||typeof value==='number'&&Number.isFinite(value))return typeof value+':'+JSON.stringify(value);
    if(descriptor.composite)return 'composite:'+stable(descriptor.composite.map(field=>row?.[field]));
    if(descriptor.natural){const value=row?.[descriptor.natural.field];if(value!=null&&value!=='')return 'natural:'+String(value).replace(/\D/g,'').toUpperCase();}
    return 'legacy:'+index;
  }
  function previousRows(section,before,after){
    const identities=new Map(),exact=new Map(),used=new Set(),result=new Map();
    before.forEach((row,index)=>{const key=rowKey(section,row,index),text=stable(row);if(!identities.has(key))identities.set(key,[]);identities.get(key).push(index);if(!exact.has(text))exact.set(text,[]);exact.get(text).push(index);});
    // Reserve unchanged duplicate/legacy rows first so an earlier changed row
    // cannot consume their historical identity and cause a false precision edit.
    after.forEach((row,index)=>{const positions=exact.get(stable(row)),match=positions?.find(position=>!used.has(position));if(match!==undefined){used.add(match);result.set(index,before[match]);}});
    after.forEach((row,index)=>{if(result.has(index))return;const match=identities.get(rowKey(section,row,index))?.find(position=>!used.has(position));if(match!==undefined){used.add(match);result.set(index,before[match]);}});
    return result;
  }
  function values(row,field){
    const tokens=field.split('.'),result=[];
    function walk(value,index,path){if(index===tokens.length){result.push({path,value});return;}if(value==null||typeof value!=='object')return;
      const token=tokens[index],many=token.endsWith('[]'),key=many?token.slice(0,-2):token,next=path?path+'.'+key:key;
      if(many){if(Array.isArray(value[key]))value[key].forEach((child,position)=>walk(child,index+1,next+'['+position+']'));}
      else if(own(value,key))walk(value[key],index+1,next);
    }walk(row,0,'');return result;
  }
  function at(row,path){return path.split('.').reduce((value,key)=>{const match=key.match(/^(.*?)\[(\d+)\]$/);return match?value?.[match[1]]?.[Number(match[2])]:value?.[key];},row);}
  function check(value,spec){
    if(value===undefined||value===null||value==='')return null;
    try{const api=decimal();const checked=api.parse(value,{scale:spec.scale,max:maximum});api.toNumberExact(checked);return null;}
    catch(error){if(error.code==='MODULE_UNAVAILABLE')throw error;return {code:error.code==='RANGE'?'NUMERIC_RANGE':error.code==='PRECISION'?'NUMERIC_PRECISION':'NUMERIC_FORMAT',message:error.code==='RANGE'?'Значение выходит за допустимый диапазон ±1 000 000 000 000 или не представимо без потери точности':error.code==='PRECISION'?'Допустимо не более '+spec.scale+' знаков после запятой; исходное значение не округлено':'Требуется конечное десятичное число; исходное значение не изменено'};}
  }
  function allocationIssues(section,row,before,reportAll){
    if(!['vehicles','generators','tanks'].includes(section))return [];
    const groups=[];
    if(own(row,'fuelAccounting')&&row.fuelAccounting&&typeof row.fuelAccounting==='object'&&own(row.fuelAccounting,'sources'))groups.push({field:'fuelAccounting.sources',opening:row.fuelAccounting.opening,sources:row.fuelAccounting.sources,before:before?.fuelAccounting&&{opening:before.fuelAccounting.opening,sources:before.fuelAccounting.sources}});
    if(section==='vehicles'&&own(row,'fuelBalanceSources'))groups.push({field:'fuelBalanceSources',opening:row.fuelBalance,sources:row.fuelBalanceSources,before:before&&{opening:before.fuelBalance,sources:before.fuelBalanceSources}});
    const issues=[];
    for(const group of groups){
      if(!reportAll&&group.before&&stable({opening:group.opening,sources:group.sources})===stable(group.before))continue;
      try{if(!Array.isArray(group.sources))continue;const api=decimal(),sum=api.sum(group.sources.map(source=>api.parse(source?.qty)));if(api.compare(sum,group.opening)!==0)issues.push({field:group.field,code:'NUMERIC_ALLOCATION_TOTAL',message:'Сумма распределённых литров должна точно равняться входящему остатку; исходные значения не округлены'});}
      catch(error){if(error.code==='MODULE_UNAVAILABLE')throw error;issues.push({field:group.field,code:'NUMERIC_ALLOCATION_TOTAL',message:'Распределение остатка содержит некорректные числа; исходные значения не изменены'});}
    }return issues;
  }
  function taxIssues(section,row,before,reportAll){
    if(section!=='tankIncomes')return [];
    const fields=['sum','vatAmount','grossSum'],group=value=>fields.map(field=>value?.[field]);
    if(fields.some(field=>row[field]===undefined||row[field]===null||row[field]==='')||!reportAll&&before&&stable(group(row))===stable(group(before)))return [];
    const api=decimal();let net,vat,gross;
    try{net=api.parse(row.sum);vat=api.parse(row.vatAmount);gross=api.parse(row.grossSum);}catch{return [];}
    if(api.compare(net,0)<0)net=api.sub(0,net);
    // sum is explicitly the amount before VAT in the source document form.
    // An explicit VAT amount outranks its rate; no statutory rate is inferred.
    return api.compare(api.add(net,vat),gross)===0?[]:[{field:'grossSum',code:'NUMERIC_TAX_TOTAL',message:'Итог документа должен точно равняться сумме без НДС и явно указанному НДС; исходные суммы не изменены'}];
  }
  function collect(db,context={},previous){
    const issues=[],readable=Array.isArray(context.readable)&&!context.readable.includes('*')?new Set(context.readable):null;
    for(const [section,fields]of Object.entries(specs)){
      if(readable&&!readable.has(section))continue;
      if(previous&&previous[section]===db[section])continue;
      const current=rows(db,section),old=previous===undefined?null:previousRows(section,rows(previous,section),current);
      current.forEach((row,rowIndex)=>{if(!row||typeof row!=='object'||Array.isArray(row))return;const before=old?.get(rowIndex);
        const recordId=typeof row.id==='string'||typeof row.id==='number'&&Number.isFinite(row.id)?row.id:'';
        for(const spec of fields)for(const entry of values(row,spec.field)){
          if(before&&stable(at(before,entry.path))===stable(entry.value))continue;
          const error=check(entry.value,spec);if(error)issues.push({severity:'error',section,recordId,rowIndex,field:entry.path,...error});
        }
        for(const error of allocationIssues(section,row,before,previous===undefined))issues.push({severity:'error',section,recordId,rowIndex,...error});
        for(const error of taxIssues(section,row,before,previous===undefined))issues.push({severity:'error',section,recordId,rowIndex,...error});
      });
    }
    return {issues,counts:{error:issues.length,warning:0,total:issues.length}};
  }
  function inspect(db,context){return collect(db,context);}
  function validateChanges(previous,next,context){const report=collect(next,context,previous);if(report.issues.length){const error=Error(report.issues.slice(0,5).map(issue=>issue.field+': '+issue.message).join('; '));error.name='PrecisionPolicyError';error.code='PRECISION_VIOLATION';error.status=400;error.issues=report.issues;error.details={issues:report.issues};throw error;}return true;}
  return Object.freeze({apiVersion:1,calculationVersion:2,maximum,specs,inspect,validateChanges});
});
