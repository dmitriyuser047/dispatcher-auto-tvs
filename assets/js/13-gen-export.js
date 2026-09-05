// ДЭС: экспорт и печатные акты
// Выделено из index.html

// ═══════════════════════════════════════════════════════
// ДЭС — ДИЗЕЛЬНЫЕ ГЕНЕРАТОРЫ
// ═══════════════════════════════════════════════════════

// ─── GEN EXPORT ──────────────────────────────────────────
let genExportMode = 'all';
let exportingGenId = null;

let genExportFormat = 'xls';
function openGenExportAllModal(fmt) {
  if (!(data.generators||[]).length) { showToast('Нет дизельных генераторов для выгрузки'); return; }
  genExportMode = 'all';
  genExportFormat = fmt === 'pdf' ? 'pdf' : 'xls';
  exportingGenId = null;
  document.getElementById('genExportPeriodTitle').textContent =
    genExportFormat === 'pdf' ? 'Выгрузка сводки в PDF — все ДЭС' : 'Выгрузка сводки — все ДЭС';
  document.getElementById('gep_all').checked = true;
  document.getElementById('gep_range_inputs').style.display = 'none';
  const now = new Date();
  const y = now.getFullYear(), m = (now.getMonth()+1).toString().padStart(2,'0');
  document.getElementById('gep_date_from').value = `01.${m}.${y}`;
  document.getElementById('gep_date_to').value = fmtDate(now.toISOString().split('T')[0]);
  openModal('genExportPeriodModal');
}

function openGenExportOneModal(gid) {
  const g = (data.generators||[]).find(x=>x.id===gid);
  if (!g) return;
  genExportMode = 'one';
  genExportFormat = 'xls';
  exportingGenId = gid;
  document.getElementById('genExportPeriodTitle').textContent = `Выгрузка: ${g.name}`;
  document.getElementById('gep_all').checked = true;
  document.getElementById('gep_range_inputs').style.display = 'none';
  const now = new Date();
  const y = now.getFullYear(), m = (now.getMonth()+1).toString().padStart(2,'0');
  document.getElementById('gep_date_from').value = `01.${m}.${y}`;
  document.getElementById('gep_date_to').value = fmtDate(now.toISOString().split('T')[0]);
  openModal('genExportPeriodModal');
}

function doGenExport() {
  const isRange = document.getElementById('gep_range').checked;
  let dateFrom = null, dateTo = null;
  if (isRange) {
    dateFrom = parseDate(document.getElementById('gep_date_from').value.trim());
    dateTo   = parseDate(document.getElementById('gep_date_to').value.trim());
    if (!dateFrom || !dateTo) { alert('Укажите обе даты периода в формате ДД.ММ.ГГГГ'); return; }
    if (dateFrom > dateTo) { alert('Дата «с» не может быть позже даты «по»'); return; }
  }
  closeModal('genExportPeriodModal');
  if (genExportMode === 'all') {
    if (genExportFormat === 'pdf') exportAllGensToPdf(dateFrom, dateTo);
    else exportAllGensToXlsx(dateFrom, dateTo);
  } else {
    exportOneGenToXlsx(exportingGenId, dateFrom, dateTo);
  }
}

function exportAllGensToXlsx(dateFrom, dateTo) {
  const gens = data.generators || [];
  if (!gens.length) return;
  const NC = 16;
  const inPeriod = d => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  function filterGenRecs(gid) {
    const recs = genRecsFor(gid);
    if (!dateFrom && !dateTo) return recs;
    return recs.filter(r => {
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo   && r.date > dateTo)   return false;
      return true;
    });
  }
  const periodLabel = dateFrom ? `${fmtDate(dateFrom)} — ${fmtDate(dateTo)}` : 'За всё время';
  const today = new Date().toLocaleDateString('ru');
  const fuelLabels = { diesel:'Дизельное', gasoline:'Бензин', gas:'Газ (ГБО)' };
  const P = {
    dark:'0F1117',navy:'1B3A6B',navyMid:'2D5A8E',navyLight:'D6E4F7',
    white:'FFFFFF',gray1:'F8FAFC',gray2:'F1F5F9',gray3:'E2E8F0',gray4:'94A3B8',
    text:'1E293B',textMid:'475569',
    blue:'2563EB',bluePale:'DBEAFE',green:'16A34A',greenPale:'DCFCE7',
    yellow:'D97706',yellowPale:'FEF3C7',teal:'0D9488',tealPale:'CCFBF1',
    red:'DC2626',redPale:'FEE2E2',
  };
  function bAll(st,rgb){const b={style:st,color:{rgb}};return{top:b,bottom:b,left:b,right:b};}
  function cs(font,fill,align,border){return{font:font||{},fill:fill?{patternType:'solid',fgColor:{rgb:fill}}:{patternType:'none'},alignment:align||{vertical:'center'},border:border||{}};}
  const ST={
    title:cs({bold:true,sz:15,color:{rgb:P.white}},P.dark,{horizontal:'center',vertical:'center'},bAll('medium',P.dark)),
    sub:  cs({sz:10,italic:true,color:{rgb:P.gray4}},P.dark,{horizontal:'center',vertical:'center'},bAll('medium',P.dark)),
    secN: cs({bold:true,sz:11,color:{rgb:P.white}},P.navy,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy)),
    secT: cs({bold:true,sz:11,color:{rgb:P.white}},P.teal,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.teal)),
    sp:   cs(null,P.white,null,{}),
    tHead:cs({bold:true,sz:10,color:{rgb:P.white}},P.navyMid,{horizontal:'center',vertical:'center',wrapText:true},bAll('medium',P.navy)),
    tot:  cs({bold:true,sz:10,color:{rgb:P.text}},P.navyLight,{horizontal:'center',vertical:'center'},bAll('medium',P.navy)),
    totL: cs({bold:true,sz:10,color:{rgb:P.text}},P.navyLight,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy)),
    tdC: bg=>cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3)),
    tdR: bg=>cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3)),
    tdL: bg=>cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.gray3)),
  };
  const ws={'!merges':[],'!rows':[]};
  const rows={n:0};
  function put(r,c,val,style){const addr=XLSX.utils.encode_cell({r,c});ws[addr]={v:val??'',t:typeof val==='number'?'n':'s',s:style};ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r,c:NC}});}
  function merge(r1,c1,r2,c2){ws['!merges'].push({s:{r:r1,c:c1},e:{r:r2,c:c2}});}
  function fill(r,style){for(let c=0;c<=NC;c++)if(!ws[XLSX.utils.encode_cell({r,c})])put(r,c,'',style);}
  function fillRange(r,style,cFrom,cTo){for(let c=cFrom;c<=cTo;c++)if(!ws[XLSX.utils.encode_cell({r,c})])put(r,c,'',style);}
  function rowH(r,h){ws['!rows'][r]={hpt:h};}
  function R(){return rows.n;}
  function next(){rows.n++;}
  function spacer(){put(R(),0,'',ST.sp);merge(R(),0,R(),NC);fill(R(),ST.sp);rowH(R(),6);next();}
  function hdr(text,style){put(R(),0,text,style);merge(R(),0,R(),NC);fill(R(),style);rowH(R(),22);next();}

  put(R(),0,'СВОДКА — ДИЗЕЛЬНЫЕ ГЕНЕРАТОРЫ (ДЭС)',ST.title);
  merge(R(),0,R(),NC);fill(R(),ST.title);rowH(R(),34);next();
  put(R(),0,`Дата выгрузки: ${today}   ·   Период: ${periodLabel}   ·   Всего ДЭС: ${gens.length}`,ST.sub);
  merge(R(),0,R(),NC);fill(R(),ST.sub);rowH(R(),18);next();
  spacer();

  hdr('  СВОДКА ПО ВИДАМ ТОПЛИВА', ST.secT);
  const fHS=cs({bold:true,sz:10,color:{rgb:P.white}},P.teal,{horizontal:'center',vertical:'center',wrapText:true},bAll('medium',P.teal));
  [[0,3,'Вид топлива'],[3,2,'Выдано, л'],[5,2,'По норме, л'],[7,2,'Факт. расход, л'],[9,2,'Экономия, л'],[11,2,'Перерасход, л'],[13,4,'Остаток, л']].forEach(([c,span,h])=>{
    put(R(),c,h,fHS);merge(R(),c,R(),c+span-1);
  });
  fill(R(),fHS);rowH(R(),22);next();
  const gIss={diesel:0,gasoline:0,gas:0},gAct={diesel:0,gasoline:0,gas:0},gBal={diesel:0,gasoline:0,gas:0};
  const gNorm={diesel:0,gasoline:0,gas:0},gEcon={diesel:0,gasoline:0,gas:0},gOver={diesel:0,gasoline:0,gas:0};
  gens.forEach(g=>{
    const ft=g.fuel||'diesel';
    let gn=0, ga=0;
    filterGenRecs(g.id).forEach(r=>{gIss[ft]+=(r.fuelIssued||0);gAct[ft]+=(r.fuelActual||0);gn+=(r.fuelUsed||0);ga+=(r.fuelActual||0);});
    gNorm[ft]+=gn;
    gEcon[ft]+=Math.max(0,gn-ga);
    gOver[ft]+=Math.max(0,ga-gn);
    const bm=computeGenFuelBalances(g.id);
    const sorted=genRecsFor(g.id).slice().sort((a,b)=>cmpDateAsc(a.date, b.date));
    gBal[ft]+=sorted.length?(bm[sorted[sorted.length-1].id]||0):(g.fuelBalance||0);
  });
  const usedFuels=new Set(gens.map(g=>g.fuel||'diesel'));
  ['diesel','gasoline','gas'].filter(ft=>usedFuels.has(ft)).forEach((ft,i)=>{
    const bg=i%2===0?P.white:P.gray1;
    const bal=+gBal[ft].toFixed(2);
    const bBg=bal<0?P.redPale:bal===0?P.gray2:P.greenPale;
    const sL=cs({bold:true,sz:10,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.gray3));
    const sN=cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
    const sEcon=cs({bold:true,sz:10,color:{rgb:P.green}},P.greenPale,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
    const sOver=cs({bold:true,sz:10,color:{rgb:P.red}},P.redPale,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
    const sB=cs({bold:true,sz:10,color:{rgb:bal<0?P.red:bal===0?P.gray4:P.green}},bBg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
    put(R(),0,fuelLabels[ft],sL);merge(R(),0,R(),2);fill(R(),sL);
    put(R(),3,+gIss[ft].toFixed(2),sN);merge(R(),3,R(),4);
    put(R(),5,+gNorm[ft].toFixed(2),sN);merge(R(),5,R(),6);
    put(R(),7,+gAct[ft].toFixed(2),sN);merge(R(),7,R(),8);
    put(R(),9,+gEcon[ft].toFixed(2),gEcon[ft]>0?sEcon:sN);merge(R(),9,R(),10);
    put(R(),11,+gOver[ft].toFixed(2),gOver[ft]>0?sOver:sN);merge(R(),11,R(),12);
    put(R(),13,bal,sB);merge(R(),13,R(),16);
    rowH(R(),20);next();
  });
  spacer();

  // ── СВОДКА ПО ЁМКОСТЯМ (ТОПЛИВНЫЕ БАКИ) ──
  if ((data.tanks || []).length) {
    const secTk=cs({bold:true,sz:11,color:{rgb:P.white}},'0D9488',{horizontal:'left',vertical:'center',indent:1},bAll('medium','0D9488'));
    hdr('  СВОДКА ПО ЁМКОСТЯМ (ОСТАТКИ ТОПЛИВА)', secTk);
    const hTk=cs({bold:true,sz:10,color:{rgb:P.white}},P.navyMid,{horizontal:'left',vertical:'center',indent:1,wrapText:true},bAll('medium',P.navy));
    const hTkC=cs({bold:true,sz:10,color:{rgb:P.white}},P.navyMid,{horizontal:'center',vertical:'center',wrapText:true},bAll('medium',P.navy));
    [[0,4,'Наименование'],[4,4,'Местонахождение / Объект'],[8,2,'Вид топлива'],[10,2,'Объём, л'],[12,2,'Приход за период, л'],[14,2,'Расход за период, л'],[16,1,'Остаток, л']]
      .forEach(([c,span,t])=>{ put(R(),c,t,c===0||c===4?hTk:hTkC); merge(R(),c,R(),c+span-1); });
    rowH(R(),24);next();
    let tkIncTot=0, tkIssTot=0, tkBalTot=0;
    tanksAll().slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','ru')).forEach((t,i)=>{
      const bg=i%2===0?P.white:P.gray1;
      const income=(data.tankIncomes||[]).filter(r=>r.tankId===t.id&&inPeriod(r.date)).reduce((s,r)=>s+(r.amount||0),0);
      const boundGenIds=new Set((data.generators||[]).filter(g=>g.tankId===t.id).map(g=>g.id));
      const issued=(data.genRecords||[]).filter(r=>boundGenIds.has(r.generatorId)&&inPeriod(r.date)).reduce((s,r)=>s+(r.fuelIssued||0),0);
      const cb=computeTankBalance(t.id);
      tkIncTot+=income; tkIssTot+=issued; tkBalTot+=cb.balance;
      const bBg=cb.balance<0?P.redPale:cb.balance===0?P.gray2:P.greenPale;
      const sB=cs({bold:true,sz:10,color:{rgb:cb.balance<0?P.red:cb.balance===0?P.gray4:P.green}},bBg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
      put(R(),0,t.name||'—',ST.tdL(bg));merge(R(),0,R(),3);
      put(R(),4,[t.location,t.object].filter(Boolean).join(' · ')||'—',ST.tdL(bg));merge(R(),4,R(),7);
      put(R(),8,fuelLabels[t.fuel||'diesel'],ST.tdC(bg));merge(R(),8,R(),9);
      put(R(),10,t.capacity!=null?+t.capacity:'—',ST.tdC(bg));merge(R(),10,R(),11);
      put(R(),12,+income.toFixed(2),ST.tdR(bg));merge(R(),12,R(),13);
      put(R(),14,+issued.toFixed(2),ST.tdR(bg));merge(R(),14,R(),15);
      put(R(),16,+cb.balance.toFixed(2),sB);
      rowH(R(),20);next();
    });
    const tkTL=cs({bold:true,sz:11,color:{rgb:P.text}},P.navyLight,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy));
    const tkTN=cs({bold:true,sz:11,color:{rgb:P.text}},P.navyLight,{horizontal:'right',vertical:'center',indent:1},bAll('medium',P.navy));
    put(R(),0,'ИТОГО',tkTL);merge(R(),0,R(),11);fill(R(),tkTL);
    put(R(),12,+tkIncTot.toFixed(2),tkTN);merge(R(),12,R(),13);
    put(R(),14,+tkIssTot.toFixed(2),tkTN);merge(R(),14,R(),15);
    const tkBalRound=+tkBalTot.toFixed(2);
    put(R(),16,tkBalRound,cs({bold:true,sz:11,color:{rgb:tkBalRound<0?P.red:P.green}},P.navyLight,{horizontal:'right',vertical:'center',indent:1},bAll('medium',P.navy)));
    rowH(R(),22);next();
    spacer();
  }

  // ── СВОДКА ПО МЕСТОНАХОЖДЕНИЯМ (СОСТОЯНИЕ ДЭС) ──
  {
    const secLoc=cs({bold:true,sz:11,color:{rgb:P.white}},'1D4ED8',{horizontal:'left',vertical:'center',indent:1},bAll('medium','1D4ED8'));
    hdr('  СВОДКА ПО МЕСТОНАХОЖДЕНИЯМ (СОСТОЯНИЕ ДЭС)', secLoc);
    const locBreak=computeGenLocationBreakdown();
    const hL=cs({bold:true,sz:10,color:{rgb:P.white}},P.navyMid,{horizontal:'left',vertical:'center',indent:1,wrapText:true},bAll('medium',P.navy));
    [[0,6,'Местонахождение'],[6,2,'В работе'],[8,2,'В резерве'],[10,2,'В ремонте'],[12,2,'Всего ДЭС']]
      .forEach(([c,span,t])=>{ put(R(),c,t,c===0?hL:ST.tHead); merge(R(),c,R(),c+span-1); });
    fillRange(R(),ST.tHead,14,NC);
    rowH(R(),24);next();
    let lWork=0,lRes=0,lRep=0,lTot=0;
    locBreak.forEach(([name,r],i)=>{
      const bg=i%2===0?P.white:P.gray1;
      lWork+=r.work; lRes+=r.reserve; lRep+=r.repair; lTot+=r.total;
      const sName=cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.gray3));
      const sW=cs({bold:true,sz:11,color:{rgb:P.green}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
      const sR=cs({bold:true,sz:11,color:{rgb:P.blue}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
      const sRep=cs({bold:true,sz:11,color:{rgb:P.red}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
      const sTot=cs({bold:true,sz:11,color:{rgb:P.text}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
      put(R(),0,name,sName);merge(R(),0,R(),5);fill(R(),sName);
      put(R(),6,r.work,sW);merge(R(),6,R(),7);
      put(R(),8,r.reserve,sR);merge(R(),8,R(),9);
      put(R(),10,r.repair,sRep);merge(R(),10,R(),11);
      put(R(),12,r.total,sTot);merge(R(),12,R(),13);
      rowH(R(),20);next();
    });
    const tL=cs({bold:true,sz:11,color:{rgb:P.text}},P.navyLight,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy));
    const tN=cs({bold:true,sz:11,color:{rgb:P.text}},P.navyLight,{horizontal:'center',vertical:'center'},bAll('medium',P.navy));
    put(R(),0,'ИТОГО',tL);merge(R(),0,R(),5);fill(R(),tL);
    put(R(),6,lWork,tN);merge(R(),6,R(),7);
    put(R(),8,lRes,tN);merge(R(),8,R(),9);
    put(R(),10,lRep,tN);merge(R(),10,R(),11);
    put(R(),12,lTot,tN);merge(R(),12,R(),13);
    rowH(R(),22);next();
  }
  spacer();

  hdr('  ПЕРЕЧЕНЬ ДИЗЕЛЬНЫХ ГЕНЕРАТОРОВ (ПО МЕСТОНАХОЖДЕНИЮ)', ST.secN);
  ['№','Наименование','Серийный номер','Ответственное лицо','Местонахождение','Мощность, кВт','Вид топлива','Состояние','Наработка, мтч','Выдано, л','По норме, л','Факт. расход, л','Экономия, л','Перерасход, л','Остаток в баке, л','Стоимость ДЭС, руб.','Примечание']
    .forEach((h,c)=>put(R(),c,h,ST.tHead));
  rowH(R(),28);next();
  const gensByLoc=gens.slice().sort((a,b)=>{const la=(a.location||'￿').toLowerCase(),lb=(b.location||'￿').toLowerCase();return la<lb?-1:la>lb?1:0;});
  let totH=0,totIss=0,totNorm=0,totAct=0,totEcon=0,totOver=0,totBal=0,totCost=0, curLoc=null, gNum=0, zebra=0;
  gensByLoc.forEach(g=>{
    const locGroup=g.location||'— Без местонахождения —';
    if(locGroup!==curLoc){
      curLoc=locGroup; zebra=0;
      const sGrp=cs({bold:true,sz:11,color:{rgb:P.navy}},P.navyLight,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy));
      put(R(),0,'  Местонахождение: '+locGroup,sGrp);merge(R(),0,R(),NC);fill(R(),sGrp);rowH(R(),22);next();
    }
    const bg=zebra%2===0?P.white:P.gray1; zebra++; gNum++;
    const recs=filterGenRecs(g.id);
    const hours=recs.reduce((s,r)=>s+(r.hours||0),0);
    const issued=recs.reduce((s,r)=>s+(r.fuelIssued||0),0);
    const norm=recs.reduce((s,r)=>s+(r.fuelUsed||0),0);
    const actual=recs.reduce((s,r)=>s+(r.fuelActual||0),0);
    const economy=Math.max(0,norm-actual);
    const overrun=Math.max(0,actual-norm);
    const bm=computeGenFuelBalances(g.id);
    const sorted=genRecsFor(g.id).slice().sort((a,b)=>cmpDateAsc(a.date, b.date));
    const bal=sorted.length?(bm[sorted[sorted.length-1].id]||0):(g.fuelBalance||0);
    totH+=hours;totIss+=issued;totNorm+=norm;totAct+=actual;totEcon+=economy;totOver+=overrun;totBal+=bal;
    if(g.cost!=null) totCost+=g.cost;
    const fBal=+bal.toFixed(2);
    const bBg=fBal<0?P.redPale:fBal===0?P.gray2:P.greenPale;
    const sB=cs({bold:true,sz:10,color:{rgb:fBal<0?P.red:fBal===0?P.gray4:P.green}},bBg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
    const st=(g.status||'').toLowerCase();
    const sBg=!g.status?P.gray2:st==='в работе'?P.greenPale:st==='резерв'?P.bluePale:P.redPale;
    const sC=!g.status?P.gray4:st==='в работе'?P.green:st==='резерв'?P.blue:P.red;
    const sStatus=cs({bold:true,sz:10,color:{rgb:sC}},sBg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
    const sEcon=cs({bold:true,sz:10,color:{rgb:P.green}},P.greenPale,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
    const sOver=cs({bold:true,sz:10,color:{rgb:P.red}},P.redPale,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
    put(R(),0,gNum,ST.tdC(bg));put(R(),1,g.name||'—',ST.tdL(bg));put(R(),2,g.serial||'—',ST.tdC(bg));
    put(R(),3,g.responsible||'—',ST.tdL(bg));put(R(),4,g.location||'—',ST.tdL(bg));
    put(R(),5,g.power!=null?g.power:'—',ST.tdC(bg));put(R(),6,fuelLabels[g.fuel||'diesel'],ST.tdC(bg));
    put(R(),7,g.status||'—',sStatus);put(R(),8,+hours.toFixed(1),ST.tdR(bg));
    put(R(),9,+issued.toFixed(2),ST.tdR(bg));put(R(),10,+norm.toFixed(2),ST.tdR(bg));put(R(),11,+actual.toFixed(2),ST.tdR(bg));
    put(R(),12,economy>0?+economy.toFixed(2):'—',economy>0?sEcon:ST.tdR(bg));
    put(R(),13,overrun>0?+overrun.toFixed(2):'—',overrun>0?sOver:ST.tdR(bg));
    put(R(),14,fBal,sB);
    put(R(),15,g.cost!=null?g.cost.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'—',ST.tdR(bg));
    put(R(),16,g.note||'—',ST.tdL(bg));
    rowH(R(),20);next();
  });
  put(R(),0,'ИТОГО',ST.totL);merge(R(),0,R(),7);fill(R(),ST.totL);
  put(R(),8,+totH.toFixed(1),ST.tot);put(R(),9,+totIss.toFixed(2),ST.tot);put(R(),10,+totNorm.toFixed(2),ST.tot);put(R(),11,+totAct.toFixed(2),ST.tot);
  put(R(),12,+totEcon.toFixed(2),cs({bold:true,sz:10,color:{rgb:P.green}},P.navyLight,{horizontal:'center',vertical:'center'},bAll('medium',P.navy)));
  put(R(),13,+totOver.toFixed(2),cs({bold:true,sz:10,color:{rgb:P.red}},P.navyLight,{horizontal:'center',vertical:'center'},bAll('medium',P.navy)));
  const tBal=+totBal.toFixed(2);
  put(R(),14,tBal,cs({bold:true,sz:10,color:{rgb:tBal<0?P.red:P.green}},P.navyLight,{horizontal:'center',vertical:'center'},bAll('medium',P.navy)));
  put(R(),15,totCost>0?totCost.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'—',ST.tot);
  put(R(),16,'',ST.tot);
  rowH(R(),22);next();
  spacer();

  // ─── ИСТОРИЯ ТО ───────────────────────────────────────────
  hdr('  ИСТОРИЯ ТЕХНИЧЕСКОГО ОБСЛУЖИВАНИЯ', ST.secT);
  const toHdrs=['Генератор','Дата','Вид ТО','Счётчик, мтч','След. ТО, мтч','Дата след. ТО','Стоимость ТО, руб.','Исполнитель','Примечание'];
  toHdrs.forEach((h,c)=>put(R(),c,h,ST.tHead));
  merge(R(),8,R(),NC);fill(R(),ST.tHead);rowH(R(),28);next();
  const allToRecs=(data.toRecords||[]).filter(r=>(data.generators||[]).some(g=>g.id===r.generatorId))
    .sort((a,b)=>cmpDateAsc(a.date, b.date));
  if(!allToRecs.length){
    const sE=cs({sz:10,italic:true,color:{rgb:P.gray4}},P.white,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
    put(R(),0,'Нет записей ТО',sE);merge(R(),0,R(),NC);rowH(R(),20);next();
  } else {
    let totToC=0;
    allToRecs.forEach((r,i)=>{
      const bg=i%2===0?P.white:P.gray1;
      const gen=(data.generators||[]).find(g=>g.id===r.generatorId);
      if(r.cost!=null) totToC+=r.cost;
      put(R(),0,gen?gen.name:'—',ST.tdL(bg));
      put(R(),1,fmtDate(r.date),ST.tdC(bg));
      put(R(),2,r.type||'—',ST.tdC(bg));
      put(R(),3,r.hours!=null?+r.hours:'—',ST.tdR(bg));
      put(R(),4,r.nextHoursAbs!=null?+r.nextHoursAbs:(r.nextHours?'+'+r.nextHours:'—'),ST.tdR(bg));
      put(R(),5,r.nextDate?fmtDate(r.nextDate):'—',ST.tdC(bg));
      put(R(),6,r.cost!=null?r.cost.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'—',ST.tdR(bg));
      put(R(),7,r.performer||'—',ST.tdL(bg));
      put(R(),8,r.note||'—',ST.tdL(bg));merge(R(),8,R(),NC);
      rowH(R(),18);next();
    });
    put(R(),0,'ИТОГО ТО',ST.totL);merge(R(),0,R(),5);fill(R(),ST.totL);
    put(R(),6,totToC>0?totToC.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'—',ST.tot);
    merge(R(),7,R(),NC);put(R(),7,'',ST.tot);
    rowH(R(),22);next();
  }
  ws['!cols']=[{wch:4},{wch:22},{wch:16},{wch:20},{wch:20},{wch:10},{wch:12},{wch:12},{wch:12},{wch:10},{wch:10},{wch:12},{wch:11},{wch:11},{wch:12},{wch:16},{wch:28}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Все ДЭС');
  const fname=`ДЭС_Сводка_${dateFrom?fmtDate(dateFrom).replace(/\./g,'-')+'_'+fmtDate(dateTo).replace(/\./g,'-'):'ВсёВремя'}.xlsx`;
  XLSX.writeFile(wb,fname);
}

function exportOneGenToXlsx(gid, dateFrom, dateTo) {
  const g=(data.generators||[]).find(x=>x.id===gid);
  if(!g) return;
  const NC=10;
  const allRecs=genRecsFor(gid).slice().sort((a,b)=>cmpDateAsc(a.date, b.date));
  const filtRecs=(!dateFrom&&!dateTo)?allRecs:allRecs.filter(r=>{
    if(dateFrom&&r.date<dateFrom) return false;
    if(dateTo&&r.date>dateTo)     return false;
    return true;
  });
  const periodLabel=dateFrom?`${fmtDate(dateFrom)} — ${fmtDate(dateTo)}`:'За всё время';
  const today=new Date().toLocaleDateString('ru');
  const fuelLabels={diesel:'Дизельное',gasoline:'Бензин',gas:'Газ (ГБО)'};
  const DAYS=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  const P={
    dark:'0F1117',navy:'1B3A6B',navyMid:'2D5A8E',navyLight:'D6E4F7',
    white:'FFFFFF',gray1:'F8FAFC',gray2:'F1F5F9',gray3:'E2E8F0',gray4:'94A3B8',
    text:'1E293B',textMid:'475569',
    blue:'2563EB',bluePale:'DBEAFE',green:'16A34A',greenPale:'DCFCE7',
    yellow:'D97706',yellowPale:'FEF3C7',teal:'0D9488',tealPale:'CCFBF1',
    red:'DC2626',redPale:'FEE2E2',
  };
  function bAll(st,rgb){const b={style:st,color:{rgb}};return{top:b,bottom:b,left:b,right:b};}
  function cs(font,fill,align,border){return{font:font||{},fill:fill?{patternType:'solid',fgColor:{rgb:fill}}:{patternType:'none'},alignment:align||{vertical:'center'},border:border||{}};}
  const ST={
    title:cs({bold:true,sz:15,color:{rgb:P.white}},P.dark,{horizontal:'center',vertical:'center'},bAll('medium',P.dark)),
    sub:  cs({sz:10,italic:true,color:{rgb:P.gray4}},P.dark,{horizontal:'center',vertical:'center'},bAll('medium',P.dark)),
    secN: cs({bold:true,sz:11,color:{rgb:P.white}},P.navy,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy)),
    secT: cs({bold:true,sz:11,color:{rgb:P.white}},P.teal,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.teal)),
    sp:   cs(null,P.white,null,{}),
    tHead:cs({bold:true,sz:10,color:{rgb:P.white}},P.navyMid,{horizontal:'center',vertical:'center',wrapText:true},bAll('medium',P.navy)),
    tot:  cs({bold:true,sz:10,color:{rgb:P.text}},P.navyLight,{horizontal:'center',vertical:'center'},bAll('medium',P.navy)),
    totL: cs({bold:true,sz:10,color:{rgb:P.text}},P.navyLight,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy)),
    tdC: bg=>cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3)),
    tdR: bg=>cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3)),
    tdL: bg=>cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.gray3)),
  };
  const ws={'!merges':[],'!rows':[]};
  const rows={n:0};
  function put(r,c,val,style){const addr=XLSX.utils.encode_cell({r,c});ws[addr]={v:val??'',t:typeof val==='number'?'n':'s',s:style};ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r,c:NC}});}
  function merge(r1,c1,r2,c2){ws['!merges'].push({s:{r:r1,c:c1},e:{r:r2,c:c2}});}
  function fill(r,style){for(let c=0;c<=NC;c++)if(!ws[XLSX.utils.encode_cell({r,c})])put(r,c,'',style);}
  function rowH(r,h){ws['!rows'][r]={hpt:h};}
  function R(){return rows.n;}
  function next(){rows.n++;}
  function spacer(){put(R(),0,'',ST.sp);merge(R(),0,R(),NC);fill(R(),ST.sp);rowH(R(),6);next();}
  function hdr(text,style){put(R(),0,text,style);merge(R(),0,R(),NC);fill(R(),style);rowH(R(),22);next();}

  put(R(),0,g.name,ST.title);merge(R(),0,R(),NC);fill(R(),ST.title);rowH(R(),34);next();
  put(R(),0,`Период: ${periodLabel}   ·   Выгружено: ${today}`,ST.sub);merge(R(),0,R(),NC);fill(R(),ST.sub);rowH(R(),18);next();
  spacer();

  hdr('  ИНФОРМАЦИЯ О ГЕНЕРАТОРЕ', ST.secN);
  [
    ['Серийный номер', g.serial||'—'],
    ['Ответственное лицо', g.responsible||'—'],
    ['Местонахождение', g.location||'—'],
    ['Мощность', g.power!=null?g.power+' кВт':'—'],
    ['Вид топлива', fuelLabels[g.fuel||'diesel']],
    ['Норма расхода', g.norm?g.norm+' л/мтч':'—'],
    ['Стоимость ДЭС', g.cost!=null?g.cost+' руб.':'—'],
    ['Состояние', g.status||'—'],
    ['Примечание', g.note||'—'],
  ].forEach(([label,val],i)=>{
    const bg=i%2===0?P.gray2:P.white;
    put(R(),0,label,cs({bold:true,sz:10,color:{rgb:P.textMid}},bg,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.gray3)));
    merge(R(),0,R(),3);
    put(R(),4,val,cs({sz:10,color:{rgb:P.text}},P.white,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.gray3)));
    merge(R(),4,R(),NC);
    fill(R(),cs({sz:10},P.white,null,bAll('thin',P.gray3)));
    rowH(R(),18);next();
  });
  spacer();

  hdr('  ПОКАЗАТЕЛИ ЗА ПЕРИОД', ST.secT);
  const totHours=filtRecs.reduce((s,r)=>s+(r.hours||0),0);
  const totIssued=filtRecs.reduce((s,r)=>s+(r.fuelIssued||0),0);
  const totNorm=filtRecs.reduce((s,r)=>s+(r.fuelUsed||0),0);
  const totActual=filtRecs.reduce((s,r)=>s+(r.fuelActual||0),0);
  const totEconomy=Math.max(0,totNorm-totActual);
  const totOverrun=Math.max(0,totActual-totNorm);
  const avgCons=totHours>0&&totActual>0?totActual/totHours:0;
  const balMap=computeGenFuelBalances(gid);
  const lastRec=allRecs[allRecs.length-1];
  const curBal=lastRec?((balMap[lastRec.id]!=null?balMap[lastRec.id]:g.fuelBalance)||0):(g.fuelBalance||0);
  [
    ['Наработка за период, мтч', +totHours.toFixed(1)],
    ['Количество записей', filtRecs.length],
    ['Выдано топлива за период, л', +totIssued.toFixed(2)],
    ['Расход по норме за период, л', +totNorm.toFixed(2)],
    ['Фактический расход за период, л', +totActual.toFixed(2)],
    ['Экономия топлива, л', totEconomy>0?+totEconomy.toFixed(2):'—'],
    ['Перерасход топлива, л', totOverrun>0?+totOverrun.toFixed(2):'—'],
    ['Средний расход, л/мтч', avgCons>0?+avgCons.toFixed(2):'—'],
    ['Текущий остаток в баке, л', +curBal.toFixed(2)],
  ].forEach(([label,val],i)=>{
    const bg=i%2===0?P.gray2:P.white;
    put(R(),0,label,cs({bold:true,sz:10,color:{rgb:P.textMid}},bg,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.gray3)));
    merge(R(),0,R(),5);
    put(R(),6,val,cs({bold:true,sz:10,color:{rgb:P.text}},P.white,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3)));
    merge(R(),6,R(),NC);
    fill(R(),cs({sz:10},P.white,null,bAll('thin',P.gray3)));
    rowH(R(),18);next();
  });
  spacer();

  hdr('  ЖУРНАЛ ЗАПИСЕЙ', ST.secN);
  ['Дата','Наработка, мтч','Счётчик нач.','Счётчик кон.','Выдано, л','По норме, л','Факт. расход, л','Остаток, л','Норма л/мтч','Факт л/мтч','Примечание']
    .forEach((h,c)=>put(R(),c,h,ST.tHead));
  rowH(R(),28);next();
  if(!filtRecs.length){
    const sE=cs({sz:10,italic:true,color:{rgb:P.gray4}},P.white,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
    put(R(),0,'Нет записей за выбранный период',sE);merge(R(),0,R(),NC);rowH(R(),20);next();
  } else {
    let sH=0,sIss=0,sAct=0;
    filtRecs.forEach((r,i)=>{
      const bg=i%2===0?P.white:P.gray1;
      const day=DAYS[new Date(r.date).getDay()];
      const bal=balMap[r.id];
      const bBg=bal!=null?(bal<0?P.redPale:bal===0?P.gray2:P.greenPale):P.gray2;
      const sB=cs({bold:true,sz:10,color:{rgb:bal!=null?(bal<0?P.red:bal===0?P.gray4:P.green):P.gray4}},bBg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
      const factLh=r.fuelActual&&r.hours>0?r.fuelActual/r.hours:null;
      sH+=(r.hours||0);sIss+=(r.fuelIssued||0);sAct+=(r.fuelActual||0);
      put(R(),0,`${fmtDate(r.date)} ${day}`,ST.tdC(bg));
      put(R(),1,r.hours!=null?+r.hours:'—',ST.tdR(bg));
      put(R(),2,r.meterStart!=null?+r.meterStart:'—',ST.tdR(bg));
      put(R(),3,r.meterEnd!=null?+r.meterEnd:'—',ST.tdR(bg));
      put(R(),4,r.fuelIssued!=null?+r.fuelIssued:'—',ST.tdR(bg));
      put(R(),5,r.fuelUsed!=null?+r.fuelUsed:'—',ST.tdR(bg));
      put(R(),6,r.fuelActual!=null?+r.fuelActual:'—',ST.tdR(bg));
      put(R(),7,bal!=null?+bal.toFixed(2):'—',sB);
      put(R(),8,g.norm?+g.norm:'—',ST.tdC(bg));
      put(R(),9,factLh!=null?+factLh.toFixed(2):'—',ST.tdR(bg));
      put(R(),10,r.note||'—',ST.tdL(bg));
      rowH(R(),18);next();
    });
    put(R(),0,'ИТОГО',ST.totL);merge(R(),0,R(),0);fill(R(),ST.totL);
    put(R(),1,+sH.toFixed(1),ST.tot);[2,3].forEach(c=>put(R(),c,'',ST.tot));
    put(R(),4,+sIss.toFixed(2),ST.tot);put(R(),5,'',ST.tot);put(R(),6,+sAct.toFixed(2),ST.tot);
    const cBal=+curBal.toFixed(2);
    put(R(),7,cBal,cs({bold:true,sz:10,color:{rgb:cBal<0?P.red:P.green}},P.navyLight,{horizontal:'center',vertical:'center'},bAll('medium',P.navy)));
    [8,9,10].forEach(c=>put(R(),c,'',ST.tot));
    rowH(R(),22);next();
  }
  spacer();

  // ─── ИСТОРИЯ ТО ───────────────────────────────────────────
  hdr('  ИСТОРИЯ ТЕХНИЧЕСКОГО ОБСЛУЖИВАНИЯ', ST.secT);
  const toRecs=(data.toRecords||[]).filter(r=>r.generatorId===gid)
    .sort((a,b)=>cmpDateAsc(a.date, b.date));
  ['Дата','Вид ТО','Счётчик, мтч','След. ТО, мтч','Дата след. ТО','Стоимость ТО, руб.','Исполнитель','Примечание','','','']
    .forEach((h,c)=>put(R(),c,h,ST.tHead));
  merge(R(),7,R(),NC);fill(R(),ST.tHead);rowH(R(),28);next();
  if(!toRecs.length){
    const sE=cs({sz:10,italic:true,color:{rgb:P.gray4}},P.white,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
    put(R(),0,'Нет записей ТО',sE);merge(R(),0,R(),NC);rowH(R(),20);next();
  } else {
    let totToC=0;
    toRecs.forEach((r,i)=>{
      const bg=i%2===0?P.white:P.gray1;
      if(r.cost!=null) totToC+=r.cost;
      put(R(),0,fmtDate(r.date),ST.tdC(bg));
      put(R(),1,r.type||'—',ST.tdC(bg));
      put(R(),2,r.hours!=null?+r.hours:'—',ST.tdR(bg));
      put(R(),3,r.nextHoursAbs!=null?+r.nextHoursAbs:(r.nextHours?'+'+r.nextHours:'—'),ST.tdR(bg));
      put(R(),4,r.nextDate?fmtDate(r.nextDate):'—',ST.tdC(bg));
      put(R(),5,r.cost!=null?r.cost.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'—',ST.tdR(bg));
      put(R(),6,r.performer||'—',ST.tdL(bg));
      put(R(),7,r.note||'—',ST.tdL(bg));merge(R(),7,R(),NC);
      rowH(R(),18);next();
    });
    put(R(),0,'ИТОГО ТО',ST.totL);merge(R(),0,R(),4);fill(R(),ST.totL);
    put(R(),5,totToC>0?totToC.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'—',ST.tot);
    merge(R(),6,R(),NC);put(R(),6,'',ST.tot);
    rowH(R(),22);next();
  }

  ws['!cols']=[{wch:14},{wch:12},{wch:12},{wch:12},{wch:10},{wch:10},{wch:12},{wch:12},{wch:10},{wch:10},{wch:24}];
  const wb=XLSX.utils.book_new();
  const sheetName=g.name.replace(/[\[\]\\\/\?\*\:]/g,'').slice(0,31);
  XLSX.utils.book_append_sheet(wb,ws,sheetName);
  const fname=`ДЭС_${g.name}_${dateFrom?fmtDate(dateFrom).replace(/\./g,'-')+'_'+fmtDate(dateTo).replace(/\./g,'-'):'ВсёВремя'}.xlsx`;
  XLSX.writeFile(wb,fname);
}

