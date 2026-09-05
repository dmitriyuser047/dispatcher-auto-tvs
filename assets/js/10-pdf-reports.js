// PDF-сводки и акт на списание ГСМ
// Выделено из index.html

// ─── PDF: ОБЩИЕ СВОДКИ ───────────────────────────────────
function _pdfEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function _pdfNum(n,d){const x=Number(n);if(!isFinite(x))return '0';return x.toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:d==null?2:d});}
function _balCls(b){return b<0?'neg':b===0?'zero':'pos';}

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
  data.vehicles.forEach(v=>{
    const ft=v.fuel||'diesel';
    const vRecs=filterRecs(recsFor(v.id));
    vRecs.forEach(r=>{ gIss[ft]+=r.fuelIssued||0; gUsd[ft]+=r.fuelUsed||0; });
    const bm=computeFuelBalances(v.id, dateFrom, dateTo);
    const sorted=vRecs.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    if(sorted.length) gBal[ft]+=bm[sorted[sorted.length-1].id]||0;
    else if(!dateFrom) gBal[ft]+=v.fuelBalance||0;
  });
  const vFuelSet=new Set(data.vehicles.map(v=>v.fuel||'diesel'));
  let fuelRows='';
  fuelTypes.filter(ft=>vFuelSet.has(ft)).forEach(ft=>{
    const bal=+gBal[ft].toFixed(2);
    fuelRows+='<tr><td class="l"><b>'+fuelLabels[ft]+'</b></td><td class="r">'+_pdfNum(gIss[ft])+'</td><td class="r">'+_pdfNum(gUsd[ft])+'</td><td class="r '+_balCls(bal)+'">'+_pdfNum(bal)+'</td></tr>';
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
  let curObj=null, globalNum=0, rows='', aKm=0,aIss=0,aUsd=0,aAct=0;
  sortedVehicles.forEach(v=>{
    const objGroup=v.object||'— Без объекта —';
    if(objGroup!==curObj){ curObj=objGroup; rows+='<tr class="grp"><td colspan="14" class="l">Объект: '+_pdfEsc(objGroup)+'</td></tr>'; }
    globalNum++;
    const vRecs=filterRecs(recsFor(v.id));
    const vKm=vRecs.reduce((s,r)=>s+(r.km||0),0);
    const vIss=vRecs.reduce((s,r)=>s+(r.fuelIssued||0),0);
    const vUsd=vRecs.reduce((s,r)=>s+(r.fuelUsed||0),0);
    const vAct=vRecs.reduce((s,r)=>s+(r.fuelActual||0),0);
    const bm=computeFuelBalances(v.id, dateFrom, dateTo);
    const sorted=vRecs.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    const vBal=+(sorted.length?(bm[sorted[sorted.length-1].id]||0):0).toFixed(2);
    const avg=vKm>0&&vAct>0?+(vAct/vKm*100).toFixed(2):null;
    aKm+=vKm; aIss+=vIss; aUsd+=vUsd; aAct+=vAct;
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
      +'<td class="r">'+_pdfNum(vIss)+'</td>'
      +'<td class="r">'+_pdfNum(vUsd)+'</td>'
      +'<td class="r">'+_pdfNum(vAct)+'</td>'
      +'<td class="r '+_balCls(vBal)+'">'+_pdfNum(vBal)+'</td>'
      +'<td class="r">'+(avg==null?'—':_pdfNum(avg))+'</td>'
      +'</tr>';
  });
  rows+='<tr class="tot"><td colspan="8" class="l">ИТОГО</td><td class="r">'+_pdfNum(aKm,1)+'</td><td class="r">'+_pdfNum(aIss)+'</td><td class="r">'+_pdfNum(aUsd)+'</td><td class="r">'+_pdfNum(aAct)+'</td><td></td><td></td></tr>';
  const mainTable='<div class="sec navy">Сводка по транспортным средствам (по объектам)</div>'
    +'<table><thead><tr>'
    +'<th style="width:24px">№</th><th>Госномер</th><th>Марка / Модель</th><th>Водитель</th><th>Организация</th><th>Объект</th><th>Вид топлива</th><th>Состояние</th>'
    +'<th>Пробег, км</th><th>Выдано, л</th><th>Расход по норме, л</th><th>Факт. расход, л</th><th>Остаток, л</th><th>Ср.расход л/100км</th>'
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
  gens.forEach(g=>{
    const ft=g.fuel||'diesel';
    filterGenRecs(g.id).forEach(r=>{ gIss[ft]+=r.fuelIssued||0; gAct[ft]+=r.fuelActual||0; });
    const bm=computeGenFuelBalances(g.id);
    const sorted=genRecsFor(g.id).slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    gBal[ft]+=sorted.length?(bm[sorted[sorted.length-1].id]||0):(g.fuelBalance||0);
  });
  const usedFuels=new Set(gens.map(g=>g.fuel||'diesel'));
  let fuelRows='';
  ['diesel','gasoline','gas'].filter(ft=>usedFuels.has(ft)).forEach(ft=>{
    const bal=+gBal[ft].toFixed(2);
    fuelRows+='<tr><td class="l"><b>'+fuelLabels[ft]+'</b></td><td class="r">'+_pdfNum(gIss[ft])+'</td><td class="r">'+_pdfNum(gAct[ft])+'</td><td class="r '+_balCls(bal)+'">'+_pdfNum(bal)+'</td></tr>';
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
  let rows='', curLoc=null, gNum=0, totH=0,totIss=0,totAct=0,totBal=0,totCost=0;
  gensByLoc.forEach(g=>{
    const locGroup=g.location||'— Без местонахождения —';
    if(locGroup!==curLoc){ curLoc=locGroup; rows+='<tr class="grp"><td colspan="14" class="l">Местонахождение: '+_pdfEsc(locGroup)+'</td></tr>'; }
    gNum++;
    const recs=filterGenRecs(g.id);
    const hours=recs.reduce((s,r)=>s+(r.hours||0),0);
    const issued=recs.reduce((s,r)=>s+(r.fuelIssued||0),0);
    const actual=recs.reduce((s,r)=>s+(r.fuelActual||0),0);
    const bm=computeGenFuelBalances(g.id);
    const sorted=genRecsFor(g.id).slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    const bal=+(sorted.length?(bm[sorted[sorted.length-1].id]||0):(g.fuelBalance||0)).toFixed(2);
    totH+=hours; totIss+=issued; totAct+=actual; totBal+=bal; if(g.cost!=null) totCost+=g.cost;
    rows+='<tr>'
      +'<td class="c">'+gNum+'</td>'
      +'<td class="l">'+_pdfEsc(g.name||'—')+'</td>'
      +'<td class="c">'+_pdfEsc(g.serial||'—')+'</td>'
      +'<td class="l">'+_pdfEsc(g.responsible||'—')+'</td>'
      +'<td class="l">'+_pdfEsc(g.location||'—')+'</td>'
      +'<td class="c">'+(g.power!=null?_pdfEsc(g.power):'—')+'</td>'
      +'<td class="c">'+fuelLabels[g.fuel||'diesel']+'</td>'
      +'<td class="c">'+_pdfEsc(g.status||'—')+'</td>'
      +'<td class="r">'+_pdfNum(hours,1)+'</td>'
      +'<td class="r">'+_pdfNum(issued)+'</td>'
      +'<td class="r">'+_pdfNum(actual)+'</td>'
      +'<td class="r '+_balCls(bal)+'">'+_pdfNum(bal)+'</td>'
      +'<td class="r">'+(g.cost!=null?_pdfNum(g.cost):'—')+'</td>'
      +'<td class="l">'+_pdfEsc(g.note||'—')+'</td>'
      +'</tr>';
  });
  const tBal=+totBal.toFixed(2);
  rows+='<tr class="tot"><td colspan="8" class="l">ИТОГО</td><td class="r">'+_pdfNum(totH,1)+'</td><td class="r">'+_pdfNum(totIss)+'</td><td class="r">'+_pdfNum(totAct)+'</td><td class="r '+_balCls(tBal)+'">'+_pdfNum(tBal)+'</td><td class="r">'+(totCost>0?_pdfNum(totCost):'—')+'</td><td></td></tr>';
  const listTable='<div class="sec navy">Перечень дизельных генераторов (по местонахождению)</div><table><thead><tr>'
    +'<th style="width:24px">№</th><th>Наименование</th><th>Серийный номер</th><th>Ответственное лицо</th><th>Местонахождение</th><th>Мощность, кВт</th><th>Вид топлива</th><th>Состояние</th><th>Наработка, мтч</th><th>Выдано, л</th><th>Факт. расход, л</th><th>Остаток в баке, л</th><th>Стоимость ДЭС, руб.</th><th>Примечание</th>'
    +'</tr></thead><tbody>'+rows+'</tbody></table>';

  // ── История ТО ──
  const allToRecs=(data.toRecords||[]).filter(r=>gens.some(g=>g.id===r.generatorId)).sort((a,b)=>new Date(a.date)-new Date(b.date));
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

// ─── АКТ НА СПИСАНИЕ ГСМ ─────────────────────────────────
// Список организаций (по ТС на дизеле/бензине)
function actGsmOrgs() {
  const set = new Set();
  data.vehicles.forEach(v => {
    const ft = v.fuel || 'diesel';
    if (ft !== 'diesel' && ft !== 'gasoline') return;
    set.add((v.org || '').trim() || '— Без организации —');
  });
  return Array.from(set).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
}

function openActGsmModal() {
  if (!data.vehicles.length) return;
  document.getElementById('ag_all').checked = true;
  document.getElementById('ag_range_inputs').style.display = 'none';
  const now = new Date();
  const y = now.getFullYear(), m = (now.getMonth()+1).toString().padStart(2,'0');
  document.getElementById('ag_date').value = fmtDate(now.toISOString().split('T')[0]);
  document.getElementById('ag_date_from').value = `01.${m}.${y}`;
  document.getElementById('ag_date_to').value = fmtDate(now.toISOString().split('T')[0]);
  // Заполняем список организаций
  const sel = document.getElementById('ag_org');
  const orgs = actGsmOrgs();
  sel.innerHTML = '<option value="__ALL__">Все организации (по отдельности)</option>'
    + orgs.map(o => `<option value="${o.replace(/"/g,'&quot;')}">${o}</option>`).join('');
  openModal('actGsmModal');
}

function doExportActGsm() {
  const isRange = document.getElementById('ag_range').checked;
  let dateFrom = null, dateTo = null;
  if (isRange) {
    dateFrom = parseDate(document.getElementById('ag_date_from').value.trim());
    dateTo   = parseDate(document.getElementById('ag_date_to').value.trim());
    if (!dateFrom || !dateTo) { alert('Укажите обе даты периода в формате ДД.ММ.ГГГГ'); return; }
    if (dateFrom > dateTo) { alert('Дата «с» не может быть позже даты «по»'); return; }
  }
  const opts = {
    actNo: document.getElementById('ag_no').value.trim(),
    actDate: parseDate(document.getElementById('ag_date').value.trim()) || new Date().toISOString().split('T')[0],
    org: document.getElementById('ag_org').value,
  };
  closeModal('actGsmModal');
  exportFuelWriteOffAct(dateFrom, dateTo, opts);
}

function exportFuelWriteOffAct(dateFrom, dateTo, opts) {
  opts = opts || {};
  const fuelMark = { diesel:'ДТ', gasoline:'Бензин', gas:'Газ' };
  const MONTHS_RU = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];

  function inPeriod(r){ return (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo); }
  let periodLabel;
  if (dateFrom && dateTo) {
    const df = new Date(dateFrom), dt = new Date(dateTo);
    if (df.getFullYear()===dt.getFullYear() && df.getMonth()===dt.getMonth())
      periodLabel = `${MONTHS_RU[df.getMonth()]} ${df.getFullYear()}г.`;
    else periodLabel = `${fmtDate(dateFrom)} — ${fmtDate(dateTo)}`;
  } else periodLabel = 'всё время';

  const allOrgs = actGsmOrgs();
  const orgsToRender = (opts.org && opts.org !== '__ALL__') ? [opts.org] : allOrgs;
  if (!orgsToRender.length) { alert('Нет организаций с ТС на дизеле/бензине.'); return; }

  // ── Стили ──
  const P = { navy:'1B3A6B', navyMid:'2D5A8E', navyLight:'D6E4F7', white:'FFFFFF',
    gray1:'F8FAFC', gray2:'F1F5F9', gray3:'E2E8F0', gray4:'94A3B8', text:'1E293B',
    green:'16A34A', red:'DC2626', greenPale:'DCFCE7', redPale:'FEE2E2' };
  function bAll(st,rgb){const b={style:st,color:{rgb}};return{top:b,bottom:b,left:b,right:b};}
  function cs(font,fill,align,border){return{font:font||{},fill:fill?{patternType:'solid',fgColor:{rgb:fill}}:{patternType:'none'},alignment:align||{vertical:'center'},border:border||{}};}
  const NC = 25; // колонки 0..25
  const SUPPLIERS = ['Газпром','Волга-Интер','СПС','Наличка','Другой']; // колонки 15..19
  const supplierCol = s => { const idx = SUPPLIERS.indexOf(s); return 15 + (idx >= 0 ? idx : 4); }; // не указан/иной → «Другой»
  const ST = {
    appr:  cs({sz:10,color:{rgb:P.text}},null,{horizontal:'left',vertical:'center',wrapText:true},{}),
    title: cs({bold:true,sz:13,color:{rgb:P.text}},null,{horizontal:'center',vertical:'center',wrapText:true},{}),
    center:cs({sz:10,color:{rgb:P.text}},null,{horizontal:'center',vertical:'center'},{}),
    plain: cs({sz:10,color:{rgb:P.text}},null,{horizontal:'left',vertical:'center',wrapText:true},{}),
    head:  cs({bold:true,sz:9,color:{rgb:P.white}},P.navyMid,{horizontal:'center',vertical:'center',wrapText:true},bAll('medium',P.navy)),
    tot:   cs({bold:true,sz:10,color:{rgb:P.text}},P.navyLight,{horizontal:'center',vertical:'center'},bAll('medium',P.navy)),
    totL:  cs({bold:true,sz:10,color:{rgb:P.text}},P.navyLight,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy)),
    tdC: bg=>cs({sz:9,color:{rgb:P.text}},bg,{horizontal:'center',vertical:'center',wrapText:true},bAll('thin',P.gray3)),
    tdL: bg=>cs({sz:9,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',wrapText:true,indent:1},bAll('thin',P.gray3)),
    tdR: bg=>cs({sz:9,color:{rgb:P.text}},bg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3)),
    sp:    cs(null,null,null,{}),
  };

  const ws = {'!merges':[],'!rows':[],'!cols':[]};
  let n = 0;
  function put(r,c,val,style){
    ws[XLSX.utils.encode_cell({r,c})]={v:val==null?'':val,t:typeof val==='number'?'n':'s',s:style};
    ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(r,0),c:NC}});
  }
  function merge(r1,c1,r2,c2){ws['!merges'].push({s:{r:r1,c:c1},e:{r:r2,c:c2}});}
  function fillRow(r,style){for(let c=0;c<=NC;c++)if(!ws[XLSX.utils.encode_cell({r,c})])put(r,c,'',style);}
  function rowH(r,h){ws['!rows'][r]={hpt:h};}
  const num = (x,d)=> +(Number(x)||0).toFixed(d==null?2:d);

  // Остаток топлива на начало периода
  function startBalance(v, recsSorted){
    let bal = v.fuelBalance || 0;
    if (!dateFrom) return bal;
    recsSorted.forEach(r=>{ if (r.date < dateFrom) bal += (r.fuelIssued||0) - (r.fuelActual!=null?r.fuelActual:(r.fuelUsed||0)) - (r.fuelIdle||0); });
    return bal;
  }

  let renderedAny = false;

  orgsToRender.forEach((org, oi) => {
    const orgLabel = org === '— Без организации —' ? 'организации' : org;
    const orgVehicles = data.vehicles.filter(v => {
      const ft = v.fuel || 'diesel';
      if (ft !== 'diesel' && ft !== 'gasoline') return false;
      return (((v.org||'').trim()) || '— Без организации —') === org;
    }).sort((a,b)=>{ const oa=(a.object||'￿').toLowerCase(), ob=(b.object||'￿').toLowerCase(); return oa<ob?-1:oa>ob?1:0; });
    if (!orgVehicles.length) return;
    renderedAny = true;

    if (oi>0) { put(n,0,'',ST.sp); merge(n,0,n,NC); rowH(n,10); n++; }

    // Утверждаю (справа)
    put(n,18,'Утверждаю:',ST.appr); merge(n,18,n,NC); rowH(n,14); n++;
    put(n,18,'Руководитель '+orgLabel,ST.appr); merge(n,18,n,NC); rowH(n,14); n++;
    put(n,18,'_______________ / ______________ /',ST.appr); merge(n,18,n,NC); rowH(n,14); n++;

    // Заголовок акта
    put(n,0,`Акт списания ГСМ по ${orgLabel} за ${periodLabel}`,ST.title); merge(n,0,n,NC); fillRow(n,ST.title); rowH(n,22); n++;
    if (opts.actNo) { put(n,0,`Акт № ${opts.actNo}   ·   Дата составления: ${fmtDate(opts.actDate)}`,ST.center); merge(n,0,n,NC); rowH(n,14); n++; }
    put(n,0,'',ST.sp); merge(n,0,n,NC); rowH(n,4); n++;

    // Шапка таблицы (2 строки)
    const h1 = n, h2 = n+1;
    const vh = (c,label)=>{ put(h1,c,label,ST.head); merge(h1,c,h2,c); };
    const gh = (c1,c2,label,subs)=>{ put(h1,c1,label,ST.head); merge(h1,c1,h1,c2); subs.forEach((s,k)=>put(h2,c1+k,s,ST.head)); };
    vh(0,'№ п/п'); vh(1,'Марка а/м'); vh(2,'№ а/м'); vh(3,'Объект'); vh(4,'Марка топлива'); vh(5,'ФИО водителя');
    gh(6,7,'Спидометр',['на нач','на кон']);
    gh(8,10,'Норма, л/100км',['город','трасса','х/х']);
    vh(11,'Пробег, км'); vh(12,'Пробег Глонасс, км'); vh(13,'Остаток на нач., л');
    gh(14,19,'Получено, л',['Газпром','Волга-Интер','СПС','Наличка','Другой','Всего']);
    gh(20,22,'Списано, л',['по норме','по факту','х/х']);
    vh(23,'Остаток на кон., л'); vh(24,'Экономия(+)/ Перерасход(-), л'); vh(25,'Поставщик');
    rowH(h1,16); rowH(h2,30); n+=2;

    // Строки
    let i=0, tKm=0,tGl=0,tIdle=0,tStart=0,tIss=0,tNorm=0,tAct=0,tEnd=0,tEco=0;
    const tSup=[0,0,0,0,0];
    orgVehicles.forEach(v=>{
      const ft=v.fuel||'diesel';
      const allRecs = recsFor(v.id).slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
      const per = allRecs.filter(inPeriod);
      const km=per.reduce((s,r)=>s+(r.km||0),0);
      const glon=per.reduce((s,r)=>s+(r.kmGlonass||0),0);
      const idle=per.reduce((s,r)=>s+(r.fuelIdle||0),0);
      const iss=per.reduce((s,r)=>s+(r.fuelIssued||0),0);
      const normL=per.reduce((s,r)=>s+(r.fuelUsed||0),0);
      const actL=per.reduce((s,r)=>s+(r.fuelActual!=null?r.fuelActual:(r.fuelUsed||0)),0);
      const sBal=startBalance(v, allRecs);
      const eBal=sBal + per.reduce((s,r)=>s+((r.fuelIssued||0)-(r.fuelActual!=null?r.fuelActual:(r.fuelUsed||0))-(r.fuelIdle||0)),0);
      const eco=normL-actL;
      const odoNach = per.length? (per[0].odoStart!=null?per[0].odoStart:'') : (v.odometer!=null?v.odometer:'');
      const odoKon  = per.length? (per[per.length-1].odoEnd!=null?per[per.length-1].odoEnd:'') : (v.odometer!=null?v.odometer:'');
      const grade = (v.fuelGrade||'').trim() || fuelMark[ft] || '—';
      const nCity = v.normCity!=null ? v.normCity : (v.norm!=null ? v.norm : null);
      const supIdx = supplierCol(v.supplier) - 15;
      const bg=i%2===0?P.white:P.gray1;
      i++;
      tKm+=km; tGl+=glon; tIdle+=idle; tStart+=sBal; tIss+=iss; tNorm+=normL; tAct+=actL+idle; tEnd+=eBal; tEco+=eco; tSup[supIdx]+=iss;
      const ecoBg=eco<0?P.redPale:eco>0?P.greenPale:bg;
      const ecoStyle=cs({bold:true,sz:9,color:{rgb:eco<0?P.red:eco>0?P.green:P.text}},ecoBg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
      put(n,0,i,ST.tdC(bg));
      put(n,1,v.make||'—',ST.tdL(bg));
      put(n,2,v.plate||'—',ST.tdC(bg));
      put(n,3,v.object||'—',ST.tdL(bg));
      put(n,4,grade,ST.tdC(bg));
      put(n,5,(v.driver||'—').replace(/\r?\n/g,', '),ST.tdL(bg));
      put(n,6,odoNach===''?'—':+odoNach,ST.tdR(bg));
      put(n,7,odoKon===''?'—':+odoKon,ST.tdR(bg));
      put(n,8,nCity!=null?+nCity:'—',ST.tdR(bg));
      put(n,9,v.normHighway!=null?+v.normHighway:'—',ST.tdR(bg));
      put(n,10,v.normIdle!=null?+v.normIdle:'—',ST.tdR(bg));
      put(n,11,num(km,1),ST.tdR(bg));
      put(n,12,glon>0?num(glon,1):'—',ST.tdR(bg));
      put(n,13,num(sBal),ST.tdR(bg));
      for(let c=0;c<5;c++) put(n,14+c, c===supIdx?num(iss):'', ST.tdR(bg));
      put(n,19,num(iss),ST.tdR(bg));
      put(n,20,num(normL),ST.tdR(bg));
      put(n,21,num(actL+idle),ST.tdR(bg));
      put(n,22,num(idle),ST.tdR(bg));
      put(n,23,num(eBal),ST.tdR(bg));
      put(n,24,num(eco),ecoStyle);
      put(n,25,v.supplier||'—',ST.tdC(bg));
      rowH(n,16); n++;
    });

    // ИТОГО
    put(n,0,'ИТОГО:',ST.totL); merge(n,0,n,10); fillRow(n,ST.totL);
    put(n,11,num(tKm,1),ST.tot); put(n,12,tGl>0?num(tGl,1):'—',ST.tot); put(n,13,num(tStart),ST.tot);
    for(let c=0;c<5;c++) put(n,14+c,num(tSup[c]),ST.tot);
    put(n,19,num(tIss),ST.tot); put(n,20,num(tNorm),ST.tot); put(n,21,num(tAct),ST.tot); put(n,22,num(tIdle),ST.tot); put(n,23,num(tEnd),ST.tot); put(n,24,num(tEco),ST.tot);
    put(n,25,'',ST.tot);
    rowH(n,18); n++;

    // Подписи
    put(n,0,'',ST.sp); merge(n,0,n,NC); rowH(n,6); n++;
    put(n,0,'Комиссия:   Главный механик _______________ / ________________ /',ST.plain); merge(n,0,n,NC); rowH(n,16); n++;
    put(n,0,'Управляющий директор _______________ / ________________ /',ST.plain); merge(n,0,n,NC); rowH(n,16); n++;
  });

  if (!renderedAny) { alert('Нет ТС на дизеле/бензине для выбранной организации.'); return; }

  ws['!cols']=[{wch:4},{wch:18},{wch:12},{wch:14},{wch:8},{wch:18},{wch:9},{wch:9},{wch:7},{wch:7},{wch:6},{wch:9},{wch:10},{wch:9},{wch:9},{wch:10},{wch:8},{wch:8},{wch:8},{wch:9},{wch:9},{wch:9},{wch:8},{wch:9},{wch:11},{wch:13}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Акт списания ГСМ');
  const d=new Date();
  const ds=`${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()}`;
  const orgSuffix = (opts.org && opts.org!=='__ALL__') ? '_'+opts.org.replace(/[^\wА-Яа-яЁё]+/g,'').slice(0,20) : '_все';
  XLSX.writeFile(wb, `Акт_списания_ГСМ${orgSuffix}_${ds}.xlsx`);
}

