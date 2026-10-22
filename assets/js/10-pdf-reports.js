// PDF-сводки и акт на списание ГСМ
// Выделено из index.html

// ─── PDF: ОБЩИЕ СВОДКИ ───────────────────────────────────
function _pdfEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function _pdfNum(n,d){const x=Number(n);if(!isFinite(x))return '0';return x.toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:d==null?2:d});}
function _balCls(b){return b<0?'neg':b===0?'zero':'pos';}
function _pdfFuelExplicit(asset){return Object.prototype.hasOwnProperty.call(asset,'fuelAccounting')||asset.fuelNorms!=null;}
function _pdfFuelRows(section,asset,records){return _pdfFuelExplicit(asset)?records.filter(row=>fuelAccountingIncludes(section,asset,row.date)):records;}
function _pdfFuelNum(value,explicit){return value==null?'Нет данных':_pdfNum(value,explicit?3:2);}

// Категория состояния ТС: на ходу / в ремонте / требуется ремонт / прочее
function vehStatusCat(status){
  const st=(status||'').toLowerCase();
  if(st.includes('треб')||st.includes('нужд')) return 'need';
  if(st.includes('ремонт')||st.includes('дтп')) return 'repair';
  if(st.includes('ходу')) return 'run';
  return 'other';
}
// Разбивка ТС по объектам с подсчётом состояний
function computeObjectStatusBreakdown(){
  const map=new Map();
  data.vehicles.forEach(v=>{
    const key=v.object||'— Без объекта —';
    if(!map.has(key)) map.set(key,{run:0,repair:0,need:0,other:0,total:0});
    const row=map.get(key);
    row[vehStatusCat(v.status)]++;
    row.total++;
  });
  return Array.from(map.entries()).sort((a,b)=>a[0].toLowerCase()<b[0].toLowerCase()?-1:a[0].toLowerCase()>b[0].toLowerCase()?1:0);
}

// Категория состояния ДЭС: в работе / в резерве / в ремонте / прочее
function genStatusCat(status){
  const st=(status||'').toLowerCase();
  if(st.includes('работ')) return 'work';
  if(st.includes('резерв')) return 'reserve';
  if(st.includes('ремонт')||st.includes('неисправ')||st.includes('дтп')) return 'repair';
  return 'other';
}
// Разбивка ДЭС по местонахождениям с подсчётом состояний
function computeGenLocationBreakdown(){
  const map=new Map();
  (data.generators||[]).forEach(g=>{
    const key=g.location||'— Без местонахождения —';
    if(!map.has(key)) map.set(key,{work:0,reserve:0,repair:0,other:0,total:0});
    const row=map.get(key);
    row[genStatusCat(g.status)]++;
    row.total++;
  });
  return Array.from(map.entries()).sort((a,b)=>a[0].toLowerCase()<b[0].toLowerCase()?-1:a[0].toLowerCase()>b[0].toLowerCase()?1:0);
}

function _pdfShell(title, sub, bodyHtml){
  return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><style>'
    + '*{box-sizing:border-box;}'
    + 'body{font-family:Arial,"Segoe UI",sans-serif;color:#1E293B;margin:0;padding:0;font-size:9px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    + '.doc-title{background:#0F1117;color:#fff;text-align:center;font-size:14px;font-weight:700;padding:9px 8px 4px;}'
    + '.doc-sub{background:#0F1117;color:#94A3B8;text-align:center;font-size:9px;font-style:italic;padding:0 8px 9px;}'
    + '.sec{color:#fff;font-weight:700;font-size:11px;padding:5px 10px;margin-top:14px;}'
    + '.sec.navy{background:#1B3A6B;}.sec.teal{background:#0D9488;}.sec.blue{background:#1D4ED8;}'
    + 'table{width:100%;border-collapse:collapse;}'
    + 'th{background:#2D5A8E;color:#fff;font-size:8.5px;font-weight:700;padding:5px 3px;border:1px solid #1B3A6B;text-align:center;}'
    + 'td{font-size:8.5px;padding:3px 4px;border:1px solid #E2E8F0;vertical-align:middle;}'
    + 'tbody tr:nth-child(even) td{background:#F8FAFC;}'
    + 'tr.grp td{background:#D6E4F7;font-weight:700;color:#1B3A6B;}'
    + 'tr.tot td{background:#D6E4F7;font-weight:700;border:1px solid #1B3A6B;}'
    + '.c{text-align:center;}.r{text-align:right;}.l{text-align:left;}'
    + '.pos{color:#16A34A;font-weight:700;}.neg{color:#DC2626;font-weight:700;}.zero{color:#94A3B8;font-weight:700;}'
    + '@page{size:A4 landscape;margin:10mm 8mm;}'
    + '</style></head><body>'
    + '<div class="doc-title">' + _pdfEsc(title) + '</div>'
    + '<div class="doc-sub">' + _pdfEsc(sub) + '</div>'
    + bodyHtml
    + '</body></html>';
}

async function _savePdf(html, fname){
  if(!window.electronAPI || !window.electronAPI.exportPdf){
    alert('Экспорт в PDF доступен только в установленном приложении.');
    return;
  }
  try {
    const res = await window.electronAPI.exportPdf(html, fname);
    if(res && res.ok) showToast('PDF сохранён');
    else if(!(res && res.canceled)) alert('Не удалось сохранить PDF: ' + ((res && res.error) || 'неизвестная ошибка'));
  } catch(e){
    alert('Ошибка при создании PDF: ' + e.message);
  }
}

function exportAllToPdf(dateFrom, dateTo){
  if(!data.vehicles.length) return;
  function filterRecs(recs){
    if(!dateFrom && !dateTo) return recs;
    return recs.filter(r=>{ if(dateFrom&&r.date<dateFrom)return false; if(dateTo&&r.date>dateTo)return false; return true; });
  }
  const periodLabel = dateFrom ? (fmtDate(dateFrom)+' — '+fmtDate(dateTo)) : 'За всё время';
  const today = new Date().toLocaleDateString('ru');
  const fuelLabels = { diesel:'Дизельное', gasoline:'Бензин', gas:'Газ (ГБО)' };
  const fuelTypes  = ['diesel','gasoline','gas'];

  // ── Сводка по видам топлива ──
  const gIss={diesel:0,gasoline:0,gas:0}, gUsd={diesel:0,gasoline:0,gas:0}, gBal={diesel:0,gasoline:0,gas:0};
  const gExplicit={},gMissing={};
  data.vehicles.forEach(v=>{
    const ft=v.fuel||'diesel';
    const vRecs=filterRecs(recsFor(v.id));
    _pdfFuelRows('vehicles',v,vRecs).forEach(r=>{ gIss[ft]+=r.fuelIssued||0; gUsd[ft]=fuelReportAdd(gUsd[ft],fuelReportField('vehicles',v,r,'fuelUsed')); });
    const bm=computeFuelBalances(v.id, dateFrom, dateTo);
    const sorted=vRecs.slice().sort((a,b)=>cmpDateAsc(a.date, b.date));
    if(_pdfFuelExplicit(v)){gExplicit[ft]=true;const value=fuelAccountingCurrentBalance('vehicles',v,recsFor(v.id),bm,dateTo||'');if(value==null)gMissing[ft]=true;else gBal[ft]+=value;}
    else if(sorted.length) gBal[ft]+=bm[sorted[sorted.length-1].id]||0;
    else if(!dateFrom) gBal[ft]+=v.fuelBalance||0;
  });
  const vFuelSet=new Set(data.vehicles.map(v=>v.fuel||'diesel'));
  let fuelRows='';
  fuelTypes.filter(ft=>vFuelSet.has(ft)).forEach(ft=>{
    const bal=gMissing[ft]?null:+gBal[ft].toFixed(gExplicit[ft]?3:2);
    fuelRows+='<tr><td class="l"><b>'+fuelLabels[ft]+'</b></td><td class="r">'+_pdfFuelNum(gIss[ft],gExplicit[ft])+'</td><td class="r">'+_pdfFuelNum(gUsd[ft],gExplicit[ft])+'</td><td class="r '+(bal==null?'zero':_balCls(bal))+'">'+(bal==null?fuelReportGroupBalanceLabel('vehicles',data.vehicles.filter(v=>(v.fuel||'diesel')===ft),dateTo||''):_pdfFuelNum(bal,gExplicit[ft]))+'</td></tr>';
  });
  const fuelTable='<div class="sec teal">Сводка по видам топлива</div><table><thead><tr><th style="width:30%">Вид топлива</th><th>Выдано, л</th><th>Израсходовано, л</th><th>Остаток, л</th></tr></thead><tbody>'+fuelRows+'</tbody></table>';

  // ── Сводка по объектам (состояние ТС) ──
  const objBreak=computeObjectStatusBreakdown();
  let obRows='', tRun=0,tRep=0,tNeed=0,tOther=0,tTot=0;
  objBreak.forEach(([name,r])=>{
    tRun+=r.run; tRep+=r.repair; tNeed+=r.need; tOther+=r.other; tTot+=r.total;
    obRows+='<tr>'
      +'<td class="l">'+_pdfEsc(name)+'</td>'
      +'<td class="c pos">'+r.run+'</td>'
      +'<td class="c neg">'+r.repair+'</td>'
      +'<td class="c" style="color:#D97706;font-weight:700">'+r.need+'</td>'
      +'<td class="c"><b>'+r.total+'</b></td>'
      +'</tr>';
  });
  obRows+='<tr class="tot"><td class="l">ИТОГО</td><td class="c">'+tRun+'</td><td class="c">'+tRep+'</td><td class="c">'+tNeed+'</td><td class="c">'+tTot+'</td></tr>';
  const statTable='<div class="sec blue">Сводка по объектам (состояние ТС)</div>'
    +'<table><thead><tr><th class="l" style="width:44%">Объект</th><th>На ходу</th><th>В ремонте</th><th>Требуется ремонт</th><th>Всего машин</th></tr></thead><tbody>'+obRows+'</tbody></table>';

  // ── Сводка по ТС (по объектам) ──
  const sortedVehicles=data.vehicles.slice().sort((a,b)=>{
    const oa=(a.object||'￿').toLowerCase(), ob=(b.object||'￿').toLowerCase();
    return oa<ob?-1:oa>ob?1:0;
  });
  let curObj=null, globalNum=0, rows='', aKm=0,aIss=0,aUsd=0,aAct=0,aGl=0,aSens=0;
  sortedVehicles.forEach(v=>{
    const objGroup=v.object||'— Без объекта —';
    if(objGroup!==curObj){ curObj=objGroup; rows+='<tr class="grp"><td colspan="16" class="l">Объект: '+_pdfEsc(objGroup)+'</td></tr>'; }
    globalNum++;
    const vRecs=filterRecs(recsFor(v.id));
    const vFuelRecs=_pdfFuelRows('vehicles',v,vRecs),explicit=_pdfFuelExplicit(v);
    const vKm=vRecs.reduce((s,r)=>s+(r.km||0),0);
    const vIss=vFuelRecs.reduce((s,r)=>s+(r.fuelIssued||0),0);
    const vUsd=fuelReportSum(vFuelRecs.map(r=>fuelReportField('vehicles',v,r,'fuelUsed')));
    const vAct=fuelReportSum(vFuelRecs.map(r=>fuelReportField('vehicles',v,r,'fuelActual')));
    const bm=computeFuelBalances(v.id, dateFrom, dateTo);
    const sorted=vRecs.slice().sort((a,b)=>cmpDateAsc(a.date, b.date));
    const vBal=explicit?fuelAccountingCurrentBalance('vehicles',v,recsFor(v.id),bm,dateTo||''):+(sorted.length?(bm[sorted[sorted.length-1].id]||0):0).toFixed(2);
    const fuelKm=vFuelRecs.reduce((s,r)=>s+(r.km||0),0);
    const avg=fuelKm>0&&vAct!=null&&(v.fuelNorms!=null||vAct>0)?+(vAct/fuelKm*100).toFixed(2):null;
    const vGl=vRecs.reduce((s,r)=>s+(+r.kmGlonass||0),0);
    const vSens=vFuelRecs.reduce((s,r)=>s+(+r.glonassFuel||0),0);
    aKm+=vKm; aIss+=vIss; aUsd=fuelReportAdd(aUsd,vUsd); aAct=fuelReportAdd(aAct,vAct); aGl+=vGl; aSens+=vSens;
    rows+='<tr>'
      +'<td class="c">'+globalNum+'</td>'
      +'<td class="c">'+_pdfEsc(v.plate)+'</td>'
      +'<td class="l">'+_pdfEsc(v.make)+'</td>'
      +'<td class="l">'+_pdfEsc(v.driver)+'</td>'
      +'<td class="l">'+_pdfEsc(v.org||'—')+'</td>'
      +'<td class="l">'+_pdfEsc(v.object||'—')+'</td>'
      +'<td class="c">'+fuelLabels[v.fuel||'diesel']+'</td>'
      +'<td class="c">'+_pdfEsc(v.status||'—')+'</td>'
      +'<td class="r">'+_pdfNum(vKm,1)+'</td>'
      +'<td class="r">'+_pdfFuelNum(vIss,explicit)+'</td>'
      +'<td class="r">'+_pdfFuelNum(vUsd,explicit)+'</td>'
      +'<td class="r">'+_pdfFuelNum(vAct,explicit)+'</td>'
      +'<td class="r '+(vBal==null?'zero':_balCls(vBal))+'">'+(vBal==null?fuelReportBalanceLabel('vehicles',v,dateTo||''):_pdfFuelNum(vBal,explicit))+'</td>'
      +'<td class="r">'+(avg==null?'—':_pdfNum(avg))+'</td>'
      +'<td class="r">'+(vGl?_pdfNum(vGl,1):'—')+'</td>'
      +'<td class="r">'+(vSens?_pdfNum(vSens):'—')+'</td>'
      +'</tr>';
  });
  const anyExplicit=data.vehicles.some(_pdfFuelExplicit);
  rows+='<tr class="tot"><td colspan="8" class="l">ИТОГО</td><td class="r">'+_pdfNum(aKm,1)+'</td><td class="r">'+_pdfFuelNum(aIss,anyExplicit)+'</td><td class="r">'+_pdfFuelNum(aUsd,anyExplicit)+'</td><td class="r">'+_pdfFuelNum(aAct,anyExplicit)+'</td><td></td><td></td><td class="r">'+_pdfNum(aGl,1)+'</td><td class="r">'+_pdfNum(aSens)+'</td></tr>';
  const mainTable='<div class="sec navy">Сводка по транспортным средствам (по объектам)</div>'
    +'<table><thead><tr>'
    +'<th style="width:24px">№</th><th>Госномер</th><th>Марка / Модель</th><th>Водитель</th><th>Организация</th><th>Объект</th><th>Вид топлива</th><th>Состояние</th>'
    +'<th>Пробег, км</th><th>Выдано, л</th><th>Расход по норме, л</th><th>Факт. расход, л</th><th>Остаток, л</th><th>Ср.расход л/100км</th><th>Пробег ГЛОНАСС, км</th><th>Датчик ГЛОНАСС, л</th>'
    +'</tr></thead><tbody>'+rows+'</tbody></table>';

  const sub='Дата выгрузки: '+today+'   ·   Период: '+periodLabel+'   ·   Всего ТС: '+data.vehicles.length;
  const html=_pdfShell('ОБЩАЯ СВОДКА — ДИСПЕТЧЕРИЗАЦИЯ АВТО ООО «ТЕХНРАЙЗ ВЕЛЛ СЕРВИС»', sub, fuelTable+statTable+mainTable);
  const d=new Date();
  const ds=d.getDate().toString().padStart(2,'0')+'.'+(d.getMonth()+1).toString().padStart(2,'0')+'.'+d.getFullYear();
  const periodSuffix = dateFrom ? ('_'+fmtDate(dateFrom).replace(/\./g,'')+'-'+fmtDate(dateTo).replace(/\./g,'')) : '_всё_время';
  _savePdf(html, 'Сводка_все_ТС_'+ds+periodSuffix+'.pdf');
}

function exportAllGensToPdf(dateFrom, dateTo){
  const gens = data.generators || [];
  if(!gens.length) return;
  function filterGenRecs(gid){
    const recs=genRecsFor(gid);
    if(!dateFrom && !dateTo) return recs;
    return recs.filter(r=>{ if(dateFrom&&r.date<dateFrom)return false; if(dateTo&&r.date>dateTo)return false; return true; });
  }
  const periodLabel = dateFrom ? (fmtDate(dateFrom)+' — '+fmtDate(dateTo)) : 'За всё время';
  const today = new Date().toLocaleDateString('ru');
  const fuelLabels = { diesel:'Дизельное', gasoline:'Бензин', gas:'Газ (ГБО)' };

  // ── Сводка по видам топлива ──
  const gIss={diesel:0,gasoline:0,gas:0}, gAct={diesel:0,gasoline:0,gas:0}, gBal={diesel:0,gasoline:0,gas:0};
  const gExplicit={},gMissing={};
  gens.forEach(g=>{
    const ft=g.fuel||'diesel';
    _pdfFuelRows('generators',g,filterGenRecs(g.id)).forEach(r=>{ gIss[ft]+=r.fuelIssued||0; gAct[ft]=fuelReportAdd(gAct[ft],fuelReportField('generators',g,r,'fuelActual')); });
    const bm=computeGenFuelBalances(g.id);
    const sorted=genRecsFor(g.id).slice().sort((a,b)=>cmpDateAsc(a.date, b.date));
    if(_pdfFuelExplicit(g)){gExplicit[ft]=true;const value=fuelAccountingCurrentBalance('generators',g,genRecsFor(g.id),bm,dateTo||'');if(value==null)gMissing[ft]=true;else gBal[ft]+=value;}
    else gBal[ft]+=sorted.length?(bm[sorted[sorted.length-1].id]||0):(g.fuelBalance||0);
  });
  const usedFuels=new Set(gens.map(g=>g.fuel||'diesel'));
  let fuelRows='';
  ['diesel','gasoline','gas'].filter(ft=>usedFuels.has(ft)).forEach(ft=>{
    const bal=gMissing[ft]?null:+gBal[ft].toFixed(gExplicit[ft]?3:2);
    fuelRows+='<tr><td class="l"><b>'+fuelLabels[ft]+'</b></td><td class="r">'+_pdfFuelNum(gIss[ft],gExplicit[ft])+'</td><td class="r">'+_pdfFuelNum(gAct[ft],gExplicit[ft])+'</td><td class="r '+(bal==null?'zero':_balCls(bal))+'">'+(bal==null?fuelReportGroupBalanceLabel('generators',gens.filter(g=>(g.fuel||'diesel')===ft),dateTo||''):_pdfFuelNum(bal,gExplicit[ft]))+'</td></tr>';
  });
  const fuelTable='<div class="sec teal">Сводка по видам топлива</div><table><thead><tr><th style="width:30%">Вид топлива</th><th>Выдано, л</th><th>Факт. расход, л</th><th>Остаток, л</th></tr></thead><tbody>'+fuelRows+'</tbody></table>';

  // ── Сводка по местонахождениям (состояние ДЭС) ──
  const locBreak=computeGenLocationBreakdown();
  let lbRows='', lWork=0,lRes=0,lRep=0,lTot=0;
  locBreak.forEach(([name,r])=>{
    lWork+=r.work; lRes+=r.reserve; lRep+=r.repair; lTot+=r.total;
    lbRows+='<tr>'
      +'<td class="l">'+_pdfEsc(name)+'</td>'
      +'<td class="c pos">'+r.work+'</td>'
      +'<td class="c" style="color:#2563EB;font-weight:700">'+r.reserve+'</td>'
      +'<td class="c neg">'+r.repair+'</td>'
      +'<td class="c"><b>'+r.total+'</b></td>'
      +'</tr>';
  });
  lbRows+='<tr class="tot"><td class="l">ИТОГО</td><td class="c">'+lWork+'</td><td class="c">'+lRes+'</td><td class="c">'+lRep+'</td><td class="c">'+lTot+'</td></tr>';
  const locTable='<div class="sec blue">Сводка по местонахождениям (состояние ДЭС)</div>'
    +'<table><thead><tr><th class="l" style="width:44%">Местонахождение</th><th>В работе</th><th>В резерве</th><th>В ремонте</th><th>Всего ДЭС</th></tr></thead><tbody>'+lbRows+'</tbody></table>';

  // ── Перечень ДЭС (сгруппирован по местонахождению) ──
  const gensByLoc=gens.slice().sort((a,b)=>{
    const la=(a.location||'￿').toLowerCase(), lb=(b.location||'￿').toLowerCase();
    return la<lb?-1:la>lb?1:0;
  });
  let rows='', curLoc=null, gNum=0, totH=0,totIss=0,totAct=0,totBal=0,totCost=0,missingBalance=false;
  gensByLoc.forEach(g=>{
    const locGroup=g.location||'— Без местонахождения —';
    if(locGroup!==curLoc){ curLoc=locGroup; rows+='<tr class="grp"><td colspan="14" class="l">Местонахождение: '+_pdfEsc(locGroup)+'</td></tr>'; }
    gNum++;
    const recs=filterGenRecs(g.id);
    const fuelRecs=_pdfFuelRows('generators',g,recs),explicit=_pdfFuelExplicit(g);
    const hours=recs.reduce((s,r)=>s+(r.hours||0),0);
    const issued=fuelRecs.reduce((s,r)=>s+(r.fuelIssued||0),0);
    const actual=fuelReportSum(fuelRecs.map(r=>fuelReportField('generators',g,r,'fuelActual')));
    const bm=computeGenFuelBalances(g.id);
    const sorted=genRecsFor(g.id).slice().sort((a,b)=>cmpDateAsc(a.date, b.date));
    const bal=explicit?fuelAccountingCurrentBalance('generators',g,genRecsFor(g.id),bm,dateTo||''):+(sorted.length?(bm[sorted[sorted.length-1].id]||0):(g.fuelBalance||0)).toFixed(2);
    if(bal==null)missingBalance=true;
    totH+=hours; totIss+=issued; totAct=fuelReportAdd(totAct,actual); totBal+=bal; if(g.cost!=null) totCost+=g.cost;
    rows+='<tr>'
      +'<td class="c">'+gNum+'</td>'
      +'<td class="l">'+_pdfEsc(g.name||'—')+'</td>'
      +'<td class="c">'+_pdfEsc(g.serial||'—')+'</td>'
      +'<td class="l">'+_pdfEsc(g.responsible||'—')+'</td>'
      +'<td class="l">'+_pdfEsc(g.location||'—')+'</td>'
      +'<td class="c">'+(g.power!=null?_pdfEsc(g.power)+(g.fuelNorms!=null?' (исходная)':''):'—')+'</td>'
      +'<td class="c">'+fuelLabels[g.fuel||'diesel']+'</td>'
      +'<td class="c">'+_pdfEsc(g.status||'—')+'</td>'
      +'<td class="r">'+_pdfNum(hours,1)+'</td>'
      +'<td class="r">'+_pdfFuelNum(issued,explicit)+'</td>'
      +'<td class="r">'+_pdfFuelNum(actual,explicit)+'</td>'
      +'<td class="r '+(bal==null?'zero':_balCls(bal))+'">'+(bal==null?fuelReportBalanceLabel('generators',g,dateTo||''):_pdfFuelNum(bal,explicit))+'</td>'
      +'<td class="r">'+(g.cost!=null?_pdfNum(g.cost):'—')+'</td>'
      +'<td class="l">'+_pdfEsc(g.note||'—')+'</td>'
      +'</tr>';
  });
  const anyExplicit=gens.some(_pdfFuelExplicit),tBal=missingBalance?null:+totBal.toFixed(anyExplicit?3:2);
  rows+='<tr class="tot"><td colspan="8" class="l">ИТОГО</td><td class="r">'+_pdfNum(totH,1)+'</td><td class="r">'+_pdfFuelNum(totIss,anyExplicit)+'</td><td class="r">'+_pdfFuelNum(totAct,anyExplicit)+'</td><td class="r '+(tBal==null?'zero':_balCls(tBal))+'">'+(tBal==null?fuelReportGroupBalanceLabel('generators',gens,dateTo||''):_pdfFuelNum(tBal,anyExplicit))+'</td><td class="r">'+(totCost>0?_pdfNum(totCost):'—')+'</td><td></td></tr>';
  const listTable='<div class="sec navy">Перечень дизельных генераторов (по местонахождению)</div><table><thead><tr>'
    +'<th style="width:24px">№</th><th>Наименование</th><th>Серийный номер</th><th>Ответственное лицо</th><th>Местонахождение</th><th>Мощность, кВт</th><th>Вид топлива</th><th>Состояние</th><th>Наработка, мтч</th><th>Выдано, л</th><th>Факт. расход, л</th><th>Остаток в баке, л</th><th>Стоимость ДЭС, руб.</th><th>Примечание</th>'
    +'</tr></thead><tbody>'+rows+'</tbody></table>';

  // ── История ТО ──
  const allToRecs=(data.toRecords||[]).filter(r=>gens.some(g=>g.id===r.generatorId)).sort((a,b)=>cmpDateAsc(a.date, b.date));
  let toBody='';
  if(!allToRecs.length){
    toBody='<tr><td colspan="9" class="c zero" style="font-style:italic">Нет записей ТО</td></tr>';
  } else {
    let totToC=0;
    allToRecs.forEach(r=>{
      const gen=gens.find(g=>g.id===r.generatorId);
      if(r.cost!=null) totToC+=r.cost;
      toBody+='<tr>'
        +'<td class="l">'+_pdfEsc(gen?gen.name:'—')+'</td>'
        +'<td class="c">'+fmtDate(r.date)+'</td>'
        +'<td class="c">'+_pdfEsc(r.type||'—')+'</td>'
        +'<td class="r">'+(r.hours!=null?_pdfNum(r.hours,1):'—')+'</td>'
        +'<td class="r">'+(r.nextHoursAbs!=null?_pdfNum(r.nextHoursAbs,1):(r.nextHours?'+'+_pdfNum(r.nextHours,1):'—'))+'</td>'
        +'<td class="c">'+(r.nextDate?fmtDate(r.nextDate):'—')+'</td>'
        +'<td class="r">'+(r.cost!=null?_pdfNum(r.cost):'—')+'</td>'
        +'<td class="l">'+_pdfEsc(r.performer||'—')+'</td>'
        +'<td class="l">'+_pdfEsc(r.note||'—')+'</td>'
        +'</tr>';
    });
    toBody+='<tr class="tot"><td colspan="6" class="l">ИТОГО ТО</td><td class="r">'+(totToC>0?_pdfNum(totToC):'—')+'</td><td colspan="2"></td></tr>';
  }
  const toTable='<div class="sec teal">История технического обслуживания</div><table><thead><tr>'
    +'<th>Генератор</th><th>Дата</th><th>Вид ТО</th><th>Счётчик, мтч</th><th>След. ТО, мтч</th><th>Дата след. ТО</th><th>Стоимость ТО, руб.</th><th>Исполнитель</th><th>Примечание</th>'
    +'</tr></thead><tbody>'+toBody+'</tbody></table>';

  const sub='Дата выгрузки: '+today+'   ·   Период: '+periodLabel+'   ·   Всего ДЭС: '+gens.length;
  const html=_pdfShell('СВОДКА — ДИЗЕЛЬНЫЕ ГЕНЕРАТОРЫ (ДЭС)', sub, fuelTable+locTable+listTable+toTable);
  const fname='ДЭС_Сводка_'+(dateFrom?fmtDate(dateFrom).replace(/\./g,'-')+'_'+fmtDate(dateTo).replace(/\./g,'-'):'ВсёВремя')+'.pdf';
  _savePdf(html, fname);
}

// Акт использует тот же расчёт, что журнал и общие бочки.
function actGsmCardOrg(cardNumber, date) {
  return gsmCardAt(data, cardNumber, date || BusinessCalendar.resolve(data,new Date().toISOString()).today).org;
}
function actGsmVehicleOrg(v) { return (v.org || '').trim() || GSM_UNKNOWN_ORG; }
function actGsmVehicleOrgs(v, dateFrom, dateTo) {
  return [...new Set(gsmBuildLedger(data, { from: dateFrom, to: dateTo }).rows.filter(r => r.vehicleId === v.id).map(r => r.org))];
}
function actGsmOrgs(dateFrom, dateTo) {
  return [...new Set(gsmActRows(gsmBuildLedger(data, { from: dateFrom, to: dateTo })).map(r => r.org))].sort((a, b) => a.localeCompare(b, 'ru'));
}
function openActGsmModal() {
  if (!data.vehicles.length) return;
  const today = BusinessCalendar.resolve(data,new Date().toISOString()).today;
  document.getElementById('ag_all').checked = true;
  document.getElementById('ag_range_inputs').style.display = 'none';
  document.getElementById('ag_date').value = fmtDate(today);
  document.getElementById('ag_date_from').value = fmtDate(today.slice(0, 8) + '01');
  document.getElementById('ag_date_to').value = fmtDate(today);
  document.getElementById('ag_org').innerHTML = '<option value="__ALL__">Все организации (по отдельности)</option>' +
    actGsmOrgs().map(o => '<option value="' + htmlEsc(o) + '">' + htmlEsc(o) + '</option>').join('');
  openModal('actGsmModal');
}
function doExportActGsm() {
  let from = '', to = '';
  if (document.getElementById('ag_range').checked) {
    from = parseDate(document.getElementById('ag_date_from').value.trim());
    to = parseDate(document.getElementById('ag_date_to').value.trim());
    if (!from || !to) { alert('Укажите обе даты периода в формате ДД.ММ.ГГГГ'); return null; }
    if (from > to) { alert('Дата «с» не может быть позже даты «по»'); return null; }
  }
  const actDate = parseDate(document.getElementById('ag_date').value.trim());
  if (!actDate) { alert('Укажите дату акта в формате ДД.ММ.ГГГГ'); return null; }
  const opts = { actNo: document.getElementById('ag_no').value.trim(), actDate, org: document.getElementById('ag_org').value };
  closeModal('actGsmModal');
  return exportFuelWriteOffAct(from, to, opts);
}
function exportFuelWriteOffAct(dateFrom, dateTo, opts) {
  opts = opts || {};
  const ledger = gsmBuildLedger(data, { from: dateFrom, to: dateTo });
  const org = opts && opts.org !== '__ALL__' ? opts && opts.org : '';
  if (!gsmActRows(ledger, org, opts.fuelGrade).length) {
    alert('Нет данных для акта за выбранный период'); return null;
  }
  const errors = gsmRelevantIssues(ledger, org, opts && opts.fuelGrade).filter(i => i.severity === 'error');
  if (errors.length && !opts.draft) return gsmReviewActExport(ledger, org, opts);
  const wb = gsmActWorkbook(ledger, org, opts || {});
  const suffix = org ? org.replace(/[<>:"/\\|?*]/g, '').slice(0, 40) + '_' : '';
  const prefix = opts.draft ? 'Черновик_акта_ГСМ_' : 'Акт_ГСМ_';
  try { XLSX.writeFile(wb, prefix + suffix + (dateFrom || 'начало') + '_' + (dateTo || 'всё') + '.xlsx'); }
  catch (error) {
    console.error('[ГСМ] Выгрузка акта: ' + error.message);
    alert('Не удалось сохранить файл акта: ' + error.message);
    return null;
  }
  return wb;
}

