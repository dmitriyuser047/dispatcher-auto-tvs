/* Effective parameter histories: read-only diagnostics and trusted delta guards. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(()=>require('./effective-periods.js'));else root.TemporalPolicy=factory(()=>root.EffectivePeriods);})(typeof globalThis==='object'?globalThis:this,function(getPeriods){
  'use strict';
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key),rows=(db,name)=>Array.isArray(db?.[name])?db[name]:[];
  const normFields={vehicles:['norm','normCity','normHighway','normIdle'],generators:['power','norm','norm100','norm50','normIdle']},rateFields=['salaryRate','depreciationRate','fuelRate','fuelPrice'];
  const definitions={vehicles:['fuelNorms','orgHistory'],generators:['fuelNorms'],fuelCards:['orgHistory'],costProfiles:['ratePeriods']};
  function api(){let value;try{value=getPeriods();}catch{}if(value?.apiVersion!==1)throw Object.assign(Error('Не загружены правила периодов действия'),{code:'MODULE_UNAVAILABLE'});return value;}
  function stable(value,parents=new Set()){if(value===undefined)return 'undefined';if(typeof value==='number'&&!Number.isFinite(value))return '<number:'+String(value)+'>';if(value===null||typeof value!=='object')return JSON.stringify(value)??'<'+typeof value+'>';if(parents.has(value))return '<cycle>';parents.add(value);const text=Array.isArray(value)?'['+value.map(item=>stable(item,parents)).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key],parents)).join(',')+'}';parents.delete(value);return text;}
  const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const id=value=>typeof value==='string'||typeof value==='number'&&Number.isFinite(value)?typeof value+':'+JSON.stringify(value):null;
  const key=(row,index)=>id(row?.id)??'legacy:'+index;
  const orgKey=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru').replace(/ё/g,'е');
  const has=(row,kind)=>kind==='orgHistory'?!!row&&own(row,kind)&&(!Array.isArray(row.orgHistory)||row.orgHistory.length>0):!!row&&own(row,kind);
  const issue=(section,row,index,code,field,message)=>({severity:'error',section,recordId:id(row?.id)?row.id:'',rowIndex:index,code,field,message});
  function matches(before,after){const exact=new Map(),identities=new Map(),used=new Set(),result=new Map();before.forEach((row,index)=>{const text=stable(row),identity=key(row,index);if(!exact.has(text))exact.set(text,[]);exact.get(text).push(index);if(!identities.has(identity))identities.set(identity,[]);identities.get(identity).push(index);});after.forEach((row,index)=>{const found=exact.get(stable(row))?.find(position=>!used.has(position));if(found!==undefined){used.add(found);result.set(index,before[found]);}});after.forEach((row,index)=>{if(result.has(index))return;const found=identities.get(key(row,index))?.find(position=>!used.has(position));if(found!==undefined){used.add(found);result.set(index,before[found]);}});return result;}
  function checked(section,row,kind){return api().validate(section,row,kind);}
  const originValid=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='previous,version'&&value.version===1&&['absent','empty'].includes(value.previous);
  function newOrigin(before,row){if(!before||!Array.isArray(row?.orgHistory)||!row.orgHistory.length)return null;if(!own(before,'orgHistory'))return {version:1,previous:'absent'};if(Array.isArray(before.orgHistory)&&!before.orgHistory.length)return {version:1,previous:'empty'};return null;}
  function originErrors(section,row,before,index){
    if(own(before||{},'orgHistoryOrigin'))return stable(before.orgHistoryOrigin)===stable(row.orgHistoryOrigin)?[]:[issue(section,row,index,'TEMPORAL_ORIGIN_IMMUTABLE','orgHistoryOrigin','Сохранённое происхождение истории организации нельзя изменять или удалять')];
    if(!own(row,'orgHistoryOrigin'))return [];const expected=newOrigin(before,row);
    return expected&&originValid(row.orgHistoryOrigin)&&stable(expected)===stable(row.orgHistoryOrigin)?[]:[issue(section,row,index,'TEMPORAL_ORIGIN_FORGED','orgHistoryOrigin','Происхождение истории формируется только при первом переходе из сохранённого прежнего состояния')];
  }
  function overlapProofs(history){const result=[];if(!Array.isArray(history))return result;for(let a=0;a<history.length;a++)for(let b=a+1;b<history.length;b++){const left=history[a],right=history[b];if(!left||!right)continue;const fromA=left.from||'1900-01-01',fromB=right.from||'1900-01-01',toA=left.to||'9999-12-31',toB=right.to||'9999-12-31';if(fromA<=toB&&fromB<=toA)result.push({field:'orgHistory['+a+']/orgHistory['+b+']',proof:stable([[left.from??'',left.to??'',left.org],[right.from??'',right.to??'',right.org]].sort((a,b)=>stable(a).localeCompare(stable(b))))});}return result;}
  function inspect(db,context={}){
    const issues=[],readable=Array.isArray(context.readable)&&!context.readable.includes('*')?new Set(context.readable):null;
    for(const [section,kinds]of Object.entries(definitions)){if(readable&&!readable.has(section))continue;rows(db,section).forEach((row,index)=>{if(!row||typeof row!=='object'||Array.isArray(row))return;if(kinds.includes('orgHistory')&&own(row,'orgHistoryOrigin')&&!originValid(row.orgHistoryOrigin))issues.push(issue(section,row,index,'TEMPORAL_ORIGIN_INVALID','orgHistoryOrigin','Повреждено происхождение истории организации'));for(const kind of kinds){if(!own(row,kind))continue;try{checked(section,row,kind);if(kind==='orgHistory')for(const overlap of overlapProofs(row.orgHistory))issues.push(issue(section,row,index,'TEMPORAL_OVERLAP',overlap.field,'Периоды организаций пересекаются; на часть дат владелец неоднозначен'));}catch(error){issues.push(issue(section,row,index,'TEMPORAL_INVALID',kind,error.code==='MODULE_UNAVAILABLE'?'Не загружены правила периодов действия':'Проверьте даты, пересечения, основание и параметры истории периодов'));}}});}
    return {issues,counts:{error:issues.length,warning:0,total:issues.length}};
  }
  function fail(issues){if(!issues.length)return;const error=Error(issues.slice(0,5).map(row=>row.message).join('; '));error.name='TemporalPolicyError';error.code='TEMPORAL_VIOLATION';error.status=400;error.issues=issues;error.details={issues};throw error;}
  function orgDeltaErrors(section,row,before,index){
    const history=row.orgHistory;if(!Array.isArray(history))return [];
    const old=Array.isArray(before?.orgHistory)?before.orgHistory:[],used=new Set(),issues=[];
    for(let position=0;position<history.length;position++){
      const entry=history[position],same=old.findIndex((value,at)=>!used.has(at)&&stable(value)===stable(entry));if(same>=0){used.add(same);continue;}
      if(!entry||typeof entry!=='object')continue;
      // A reviewed first baseline retains a known old scalar; it never invents
      // a historical date or an organization different from the saved source.
      const blank=entry.from==null||entry.from==='';
      const retained=old.findIndex((value,at)=>!used.has(at)&&value&&(value.from??'')===(entry.from??'')&&orgKey(value.org)===orgKey(entry.org));if(retained>=0)used.add(retained);
      const absent=before&&(!own(before,'orgHistory')||Array.isArray(before.orgHistory)&&before.orgHistory.length===0);
      const baseline=blank&&absent&&position===0&&orgKey(entry.org)===orgKey(before.org)&&orgKey(entry.org)!==''&&date(entry.to)&&history.some((next,at)=>at!==position&&date(next?.from)&&new Date(Date.parse(next.from+'T12:00:00Z')-86400000).toISOString().slice(0,10)===entry.to);
      if(blank&&!baseline&&retained<0)issues.push(issue(section,row,index,'TEMPORAL_BASELINE','orgHistory['+position+'].from','Пустая начальная дата допустима только для явно подтверждённого прежнего владельца перед первым новым периодом'));
      if(!blank&&(!date(entry.from)||retained<0&&(typeof entry.basis!=='string'||!entry.basis.trim())))issues.push(issue(section,row,index,'TEMPORAL_BASIS','orgHistory['+position+'].basis','Для нового или изменённого периода организации укажите дату и основание'));
    }return issues;
  }
  function boundaries(row,kind){const result=[];if(kind==='orgHistory'){for(const entry of Array.isArray(row?.orgHistory)?row.orgHistory:[]){if(date(entry?.from))result.push(entry.from);if(date(entry?.to)){const next=new Date(Date.parse(entry.to+'T12:00:00Z')+86400000).toISOString().slice(0,10);if(date(next))result.push(next);}}}else for(const period of Array.isArray(row?.[kind]?.periods)?row[kind].periods:[])if(date(period?.from))result.push(period.from);return result;}
  function projection(section,row,day,kind){return api().projection(section,row,day,kind);}
  function semantic(value,kind){if(value.status!=='known'||!value.parameters||Object.values(value.parameters).every(value=>value===null)||kind==='orgHistory'&&!orgKey(value.parameters.org))return {status:'missing',parameters:null};return kind==='orgHistory'?{status:'known',parameters:{org:orgKey(value.parameters.org)}}:value;}
  function impacted(section,before,row,kind,range){
    const points=new Set([range.from,...boundaries(before,kind),...boundaries(row,kind)]);
    for(const day of [...points].filter(value=>value>=range.from&&value<=range.to).sort())if(stable(semantic(projection(section,before,day,kind),kind))!==stable(semantic(projection(section,row,day,kind),kind)))return true;
    return false;
  }
  function lastDay(month){if(typeof month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))return null;const next=new Date(month+'-01T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1,0);return next.toISOString().slice(0,10);}
  function startFor(db,section,row,end,start){
    const anchor=row?.fuelAccounting;if(anchor&&date(anchor.from)){if(anchor.from>end)return null;start=start<anchor.from?anchor.from:start;}
    if(section==='vehicles'||section==='generators')for(const record of rows(db,section==='vehicles'?'records':'genRecords')){if(record[section==='vehicles'?'vehicleId':'generatorId']!==row.id||!date(record.date)||record.date>end||anchor&&date(anchor.from)&&record.date<anchor.from)continue;if(record.date<start)start=record.date;}
    if(section==='vehicles'||section==='fuelCards')for(const source of ['records','fuelPurchases','monthlyFuel'])for(const record of rows(db,source)){
      const day=source==='monthlyFuel'&&lastDay(record.month)?record.month+'-01':record.date,number=value=>String(value??'').replace(/\D/g,'')||String(value??'').trim().toUpperCase();
      const related=section==='vehicles'?[record.vehicleId,record.cardVehicleId].includes(row.id):number(row.number)&&[record.fuelCardNum,record.cardNo,record.cardNumber].some(value=>number(value)===number(row.number));
      if(related&&date(day)&&day<=end&&!(anchor&&date(anchor.from)&&day<anchor.from)&&day<start)start=day;
    }
    return start;
  }
  function docIds(document){const ids=new Set();for(const row of document?.rows||[])if(id(row?.vehicleId))ids.add(id(row.vehicleId));for(const row of document?.snapshot?.vehicles||[])if(id(row?.id))ids.add(id(row.id));for(const row of document?.snapshot?.records||[])if(id(row?.vehicleId))ids.add(id(row.vehicleId));return ids;}
  function visibleToScope(section,before,row,range,scope){
    if(section!=='vehicles')return true;
    const grade=value=>{const text=String(value.fuelGrade||'').toUpperCase().replace(/[\s-]/g,'');return text||({diesel:'ДТ',gasoline:'БЕНЗИН',gas:'ГАЗ'}[value.fuel]||'');};
    if(scope?.grade&&![before,row].some(value=>grade(value)===String(scope.grade).toUpperCase().replace(/[\s-]/g,'')))return false;
    if(!scope?.org)return true;
    const points=new Set([range.from,range.to,...boundaries(before,'orgHistory'),...boundaries(row,'orgHistory')]);
    for(const day of points){if(day<range.from||day>range.to)continue;for(const candidate of [before,row]){try{if(orgKey(projection('vehicles',candidate,day,'orgHistory').parameters?.org)===orgKey(scope.org))return true;}catch{return true;}}}return false;
  }
  function protectedRanges(previous,next,section,before,row,kind){
    const ranges=[],closed=rows(previous,'fuelPeriods').filter(period=>period.closed&&lastDay(period.month));
    if(closed.length&&section!=='costProfiles'){
      const months=closed.map(period=>period.month).sort(),to=lastDay(months.at(-1)),baseline=months[0]+'-01',start=startFor(previous,section,before,to,baseline),other=startFor(next,section,row,to,baseline);
      if(start!==null||other!==null)ranges.push({from:start===null?other:other===null?start:start<other?start:other,to,type:'closed'});
    }
    if(section==='vehicles'||section==='fuelCards')for(const document of rows(previous,'fuelWriteoffs')){
      if(document?.status!=='posted'||!lastDay(document.scope?.month))continue;
      const changed=rows(next,'fuelWriteoffs').find(value=>id(value?.id)===id(document.id));if(changed?.status==='void')continue;
      const to=lastDay(document.scope.month),baseline=document.scope.month+'-01';
      if(section==='fuelCards'){
        const number=String(before?.number??row?.number??'').replace(/\D/g,''),snap=document.snapshot?.ledger?.receipts||document.snapshot?.ledger?.purchases||[],used=(document.sourceRefs||[]).some(ref=>ref?.section==='fuelCards'&&(ref.id===before.id||String(ref.id).replace(/\D/g,'')===number))||snap.some(value=>String(value.cardNo??'').replace(/\D/g,'')===number);
        // Older snapshots do not consistently list card IDs. Card histories
        // can affect vehicle ownership and receipts in an act's organization.
        if(!used&&document.scope.org&&![before.org,row.org,...(before.orgHistory||[]).map(entry=>entry?.org),...(row.orgHistory||[]).map(entry=>entry?.org)].some(org=>orgKey(org)===orgKey(document.scope.org)))continue;
      }
      const start=startFor(previous,section,before,to,baseline),other=startFor(next,section,row,to,baseline);if(start===null&&other===null)continue;const range={from:start===null?other:other===null?start:start<other?start:other,to,type:'posted'};
      if(section==='vehicles'&&!docIds(document).has(id(before.id))&&!visibleToScope(section,before,row,range,document.scope))continue;
      ranges.push(range);
    }return ranges;
  }
  function validateChanges(previous,next,context={}){
    const issues=[],changes=[];
    for(const [section,kinds]of Object.entries(definitions)){
      const beforeRows=rows(previous,section),afterRows=rows(next,section);if(beforeRows===afterRows)continue;const mapping=matches(beforeRows,afterRows);
      afterRows.forEach((row,index)=>{if(!row||typeof row!=='object'||Array.isArray(row))return;const before=mapping.get(index);
        if(kinds.includes('orgHistory'))issues.push(...originErrors(section,row,before,index));
        for(const kind of kinds){
          const metadataChanged=stable(before?.[kind])!==stable(row[kind]),fields=kind==='fuelNorms'?normFields[section]:kind==='ratePeriods'?rateFields:['org'],baseChanged=before&&fields.some(field=>stable(before[field])!==stable(row[field]));
          if(!metadataChanged&&!baseChanged)continue;
          if(own(row,kind)){try{checked(section,row,kind);}catch(error){if(error.code==='MODULE_UNAVAILABLE')throw error;issues.push(issue(section,row,index,'TEMPORAL_INVALID',kind,'Проверьте даты, пересечения, основание и параметры истории периодов'));continue;}}
          if(metadataChanged&&kind==='orgHistory'){
            issues.push(...orgDeltaErrors(section,row,before,index));
            const oldOverlaps=new Set(overlapProofs(before?.orgHistory).map(value=>value.proof));for(const overlap of overlapProofs(row.orgHistory))if(!oldOverlaps.has(overlap.proof))issues.push(issue(section,row,index,'TEMPORAL_OVERLAP',overlap.field,'Нельзя создавать или расширять пересечение периодов организаций'));
          }
          if(baseChanged&&(has(before,kind)||has(row,kind)))issues.push(issue(section,row,index,'TEMPORAL_SCALAR_LOCKED',fields.join('/'),'После включения истории изменяйте параметры отдельным периодом; прежние скалярные поля сохраняются'));
          if(before&&section!=='costProfiles')changes.push({section,row,before,index,kind});
        }
      });
    }
    fail(issues);
    for(const change of changes){const {section,row,before,index,kind}=change;for(const range of protectedRanges(previous,next,section,before,row,kind)){
      try{if(impacted(section,before,row,kind,range)){issues.push(issue(section,row,index,range.type==='closed'?'TEMPORAL_CLOSED_IMPACT':'TEMPORAL_POSTED_IMPACT',kind,(range.type==='closed'?'Месяц закрыт. ':'Есть проведённый акт. ')+'Период изменяет действующие параметры защищённой истории. Сохраните прежние значения в явно подтверждённом периоде или сначала откройте/аннулируйте соответствующий учётный документ'));break;}}
      catch(error){if(error.code==='MODULE_UNAVAILABLE')throw error;issues.push(issue(section,row,index,'TEMPORAL_PROTECTED_INVALID',kind,'Нельзя подтвердить неизменность параметров защищённой истории; сначала проверьте её периоды'));break;}
    }}
    // Malformed unchanged legacy histories stay editable as descriptions, but
    // cannot become the unexamined context for new or changed fuel facts.
    const dependencies={records:['vehicleId','date','km','fuelIssued','fuelUsed','fuelActual','fuelIdle','tankMeasured','fuelGrade','fuelOrg','fuelCardNum'],genRecords:['generatorId','date','hours','load','fuelIssued','fuelUsed','fuelActual','tankId'],fuelPurchases:['vehicleId','date','qty','sum','grade','cardNo','recordId','sourceOrg'],monthlyFuel:['vehicleId','month','liters','cardNumber']};
    for(const [section,fields]of Object.entries(dependencies)){
      const after=rows(next,section);if(rows(previous,section)===after)continue;const mapping=matches(rows(previous,section),after);
      after.forEach((row,index)=>{if(!row||typeof row!=='object')return;const before=mapping.get(index);if(before&&fields.every(field=>stable(before[field])===stable(row[field])))return;
        const assetSection=section==='genRecords'?'generators':'vehicles',asset=rows(next,assetSection).find(asset=>asset?.id===row[assetSection==='generators'?'generatorId':'vehicleId']);
        const checks=asset?(definitions[assetSection]||[]).filter(kind=>has(asset,kind)).map(kind=>({section:assetSection,row:asset,kind})):[];
        const number=String(row.cardNo??row.fuelCardNum??row.cardNumber??'').replace(/\D/g,'');if(number)for(const card of rows(next,'fuelCards'))if(String(card?.number??'').replace(/\D/g,'')===number&&has(card,'orgHistory'))checks.push({section:'fuelCards',row:card,kind:'orgHistory'});
        for(const check of checks){try{checked(check.section,check.row,check.kind);if(check.kind==='orgHistory'&&overlapProofs(check.row.orgHistory).length)throw Error('overlap');}catch(error){if(error.code==='MODULE_UNAVAILABLE')throw error;issues.push(issue(section,row,index,'TEMPORAL_CONTEXT_INVALID',check.kind,'У источника операции повреждена история параметров. Сначала проверьте её; исходные факты не изменены'));break;}}
      });
    }
    fail(issues);return true;
  }
  function compatibilitySnapshot(previous,next){
    // Never a caller-supplied permission flag. Semantic equivalence is proved
    // here against the current protected scopes before old shape is projected.
    validateChanges(previous,next);
    const replacements=[];
    for(const section of ['vehicles','fuelCards']){
      const after=rows(next,section),mapping=matches(rows(previous,section),after);
      after.forEach((row,index)=>{const before=mapping.get(index);if(originValid(row?.orgHistoryOrigin))replacements.push({section,index,origin:row.orgHistoryOrigin});else if(before&&stable(before.orgHistory)!==stable(row.orgHistory))replacements.push({section,index,before});});
    }
    if(!replacements.length)return next;
    function clone(value,parents=new Set()){
      if(value===undefined||value===null||typeof value==='string'||typeof value==='boolean')return value;
      if(typeof value==='number'){if(Number.isFinite(value))return value;throw Object.assign(Error('Неконечное число в источнике'),{code:'INVALID_SNAPSHOT'});}
      if(typeof value!=='object'||parents.has(value))throw Object.assign(Error('Некорректный снимок источников'),{code:'INVALID_SNAPSHOT'});parents.add(value);const out=Array.isArray(value)?[]:{};
      for(const key of Object.keys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||descriptor.get||descriptor.set||['__proto__','constructor','prototype'].includes(key))throw Object.assign(Error('Недопустимое поле источника'),{code:'INVALID_SNAPSHOT'});out[key]=clone(descriptor.value,parents);}parents.delete(value);return out;
    }
    const snapshot=clone(next);
    for(const {section,index,before,origin}of replacements){
      if(origin){if(origin.previous==='empty')snapshot[section][index].orgHistory=[];else delete snapshot[section][index].orgHistory;}
      else if(own(before,'orgHistory'))snapshot[section][index].orgHistory=clone(before.orgHistory);else delete snapshot[section][index].orgHistory;
      delete snapshot[section][index].orgHistoryOrigin;
    }
    return snapshot;
  }
  function canonicalizeOrigins(previous,sections){
    const result={...sections};
    for(const section of ['vehicles','fuelCards']){
      if(!own(sections,section))continue;const after=rows(sections,section),mapping=matches(rows(previous,section),after),issues=[];
      result[section]=after.map((row,index)=>{if(!row||typeof row!=='object')return row;const before=mapping.get(index);issues.push(...originErrors(section,row,before,index));if(own(before||{},'orgHistoryOrigin'))return row;const origin=newOrigin(before,row);return origin?{...row,orgHistoryOrigin:origin}:row;});fail(issues);
    }return result;
  }
  return Object.freeze({apiVersion:1,inspect,validateChanges,projection,impacted,compatibilitySnapshot,canonicalizeOrigins});
});
