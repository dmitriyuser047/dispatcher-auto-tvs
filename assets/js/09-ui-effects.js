// Прогресс-бар, скелетоны, анимация счётчиков, тень шапки
// Выделено из index.html

// ─── SCROLL SHADOW on header ───
(function() {
  const main = document.querySelector('.main');
  const hdr = document.querySelector('header');
  if (main && hdr) {
    main.addEventListener('scroll', () => {
      hdr.classList.toggle('scrolled', main.scrollTop > 8);
    });
  }
})();

// ─── ANIMATED COUNTER for stat values ───
function animateCounters(container) {
  const els = (container || document).querySelectorAll('.stat-value');
  els.forEach(el => {
    const text = el.textContent.trim();
    const match = text.match(/^([\d\s,.]+)/);
    if (!match) return;
    const raw = match[1].replace(/\s/g, '').replace(',', '.');
    const target = parseFloat(raw);
    if (isNaN(target) || target === 0) return;
    const suffix = text.slice(match[1].length);
    const isFloat = raw.includes('.');
    const decimals = isFloat ? (raw.split('.')[1] || '').length : 0;
    const duration = 600;
    const start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = target * eased;
      const formatted = isFloat
        ? val.toLocaleString('ru', {minimumFractionDigits: decimals, maximumFractionDigits: decimals})
        : Math.round(val).toLocaleString('ru');
      el.childNodes[0].textContent = formatted + ' ';
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

// ─── PROGRESS BAR helper ───
function showProgress() {
  const bar = document.getElementById('topProgress');
  if (!bar) return;
  bar.className = 'top-progress active';
  bar.style.width = '0';
  requestAnimationFrame(() => { bar.style.width = '70%'; });
}
function hideProgress() {
  const bar = document.getElementById('topProgress');
  if (!bar) return;
  bar.style.width = '100%';
  setTimeout(() => {
    bar.className = 'top-progress done';
    setTimeout(() => { bar.style.width = '0'; bar.className = 'top-progress'; }, 500);
  }, 200);
}

// ─── SKELETON LOADING helper ───
function showSkeleton() {
  const mc = document.getElementById('mainContent');
  if (!mc) return;
  mc.innerHTML = `
    <div style="padding:24px 28px;width:100%;box-sizing:border-box">
      <div style="display:flex;gap:16px;margin-bottom:20px">
        <div class="skeleton skeleton-stat" style="flex:1"></div>
        <div class="skeleton skeleton-stat" style="flex:1"></div>
        <div class="skeleton skeleton-stat" style="flex:1"></div>
        <div class="skeleton skeleton-stat" style="flex:1"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
      </div>
    </div>`;
}


document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input[name="export_period"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.getElementById('ep_range_inputs').style.display =
        document.getElementById('ep_range').checked ? 'block' : 'none';
    });
  });
  document.querySelectorAll('input[name="gep_period"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.getElementById('gep_range_inputs').style.display =
        document.getElementById('gep_range').checked ? 'block' : 'none';
    });
  });
  document.querySelectorAll('input[name="act_period"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.getElementById('ag_range_inputs').style.display =
        document.getElementById('ag_range').checked ? 'block' : 'none';
    });
  });
});

function doExportAll() {
  const isRange = document.getElementById('ep_range').checked;
  let dateFrom = null, dateTo = null;
  if (isRange) {
    dateFrom = parseDate(document.getElementById('ep_date_from').value.trim());
    dateTo   = parseDate(document.getElementById('ep_date_to').value.trim());
    if (!dateFrom || !dateTo) { alert('Укажите обе даты периода в формате ДД.ММ.ГГГГ'); return; }
    if (dateFrom > dateTo) { alert('Дата «с» не может быть позже даты «по»'); return; }
  }
  closeModal('exportPeriodModal');
  if (transportExportFormat === 'pdf') exportAllToPdf(dateFrom, dateTo);
  else exportAllToXlsx(dateFrom, dateTo);
}

function exportAllToXlsx(dateFrom, dateTo) {
  if (!data.vehicles.length) return;

  // Фильтр записей по периоду
  function filterRecs(recs) {
    if (!dateFrom && !dateTo) return recs;
    return recs.filter(r => {
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo   && r.date > dateTo)   return false;
      return true;
    });
  }

  const periodLabel = dateFrom
    ? `${fmtDate(dateFrom)} — ${fmtDate(dateTo)}`
    : 'За всё время';

  const MONTHS_RU_EXP = ['Январь','Февраль','Март','Апрель','Май','Июнь',
    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DAYS_RU_EXP = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  const fuelLabels  = { diesel:'Дизельное', gasoline:'Бензин', gas:'Газ (ГБО)' };
  const fuelTypes   = ['diesel','gasoline','gas'];
  const NC = 15;

  const P = {
    dark:'0F1117', navy:'1B3A6B', navyMid:'2D5A8E', navyLight:'D6E4F7',
    white:'FFFFFF', gray1:'F8FAFC', gray2:'F1F5F9', gray3:'E2E8F0', gray4:'94A3B8',
    text:'1E293B', textMid:'475569',
    blue:'2563EB', bluePale:'DBEAFE', green:'16A34A', greenPale:'DCFCE7',
    yellow:'D97706', yellowPale:'FEF3C7', teal:'0D9488', tealPale:'CCFBF1',
    red:'DC2626', redPale:'FEE2E2',
  };
  function bAll(st,rgb){const b={style:st,color:{rgb}};return{top:b,bottom:b,left:b,right:b};}
  function cs(font,fill,align,border){return{
    font:font||{},
    fill:fill?{patternType:'solid',fgColor:{rgb:fill}}:{patternType:'none'},
    alignment:align||{vertical:'center'},
    border:border||{},
  };}
  const ST = {
    title:  cs({bold:true,sz:15,color:{rgb:P.white}},P.dark,{horizontal:'center',vertical:'center'},bAll('medium',P.dark)),
    sub:    cs({sz:10,italic:true,color:{rgb:P.gray4}},P.dark,{horizontal:'center',vertical:'center'},bAll('medium',P.dark)),
    secN:   cs({bold:true,sz:11,color:{rgb:P.white}},P.navy,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy)),
    secT:   cs({bold:true,sz:11,color:{rgb:P.white}},P.teal,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.teal)),
    sp:     cs(null,P.white,null,{}),
    tHead:  cs({bold:true,sz:10,color:{rgb:P.white}},P.navyMid,{horizontal:'center',vertical:'center',wrapText:true},bAll('medium',P.navy)),
    tot:    cs({bold:true,sz:10,color:{rgb:P.text}},P.navyLight,{horizontal:'center',vertical:'center'},bAll('medium',P.navy)),
    totL:   cs({bold:true,sz:10,color:{rgb:P.text}},P.navyLight,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy)),
    mthH:   cs({bold:true,sz:10,color:{rgb:P.white}},P.navyMid,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.navyMid)),
    tdC: bg=> cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3)),
    tdR: bg=> cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3)),
    tdL: bg=> cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.gray3)),
  };

  // ── Per-sheet helpers that close over ws/rows ─────────
  function newSheet() {
    const ws = {'!merges':[],'!rows':[]};
    const rows = {n:0};
    function put(r,c,val,style){
      const addr=XLSX.utils.encode_cell({r,c});
      ws[addr]={v:val??'',t:typeof val==='number'?'n':'s',s:style};
      ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r,c:NC}});
    }
    function merge(r1,c1,r2,c2){ws['!merges'].push({s:{r:r1,c:c1},e:{r:r2,c:c2}});}
    function fill(r,style){for(let c=0;c<=NC;c++)if(!ws[XLSX.utils.encode_cell({r,c})])put(r,c,'',style);}
    function rowH(r,h){ws['!rows'][r]={hpt:h};}
    return {ws, rows, put, merge, fill, rowH};
  }

  const wb = XLSX.utils.book_new();
  const today = new Date().toLocaleDateString('ru');

  // ════════════════════════════════════════════════
  // SHEET 1: ОБЩАЯ СВОДКА
  // ════════════════════════════════════════════════
  {
    const {ws,rows,put,merge,fill,rowH} = newSheet();

    function R(){return rows.n;}
    function next(){rows.n++;}
    function spacer(){put(R(),0,'',ST.sp);merge(R(),0,R(),NC);fill(R(),ST.sp);rowH(R(),6);next();}
    function hdr(text,style){put(R(),0,text,style);merge(R(),0,R(),NC);fill(R(),style);rowH(R(),22);next();}
    // Заливка только части строки (колонки cFrom..cTo) — для мини-таблиц уже сверстанных вручную
    function fillRange(r,style,cFrom,cTo){for(let c=cFrom;c<=cTo;c++)if(!ws[XLSX.utils.encode_cell({r,c})])put(r,c,'',style);}

    put(R(),0,'ОБЩАЯ СВОДКА — ДИСПЕТЧЕРИЗАЦИЯ АВТО ООО «ТЕХНРАЙЗ ВЕЛЛ СЕРВИС»',ST.title);
    merge(R(),0,R(),NC);fill(R(),ST.title);rowH(R(),34);next();
    put(R(),0,`Дата выгрузки: ${today}   ·   Период: ${periodLabel}   ·   Всего ТС: ${data.vehicles.length}`,ST.sub);
    merge(R(),0,R(),NC);fill(R(),ST.sub);rowH(R(),18);next();
    spacer();

    hdr('  СВОДКА ПО ВИДАМ ТОПЛИВА', ST.secT);

    const fHS=cs({bold:true,sz:10,color:{rgb:P.white}},P.teal,{horizontal:'center',vertical:'center',wrapText:true},bAll('medium',P.teal));
    const fStarts=[0,4,7,9], fSpans=[4,3,2,5];
    ['Вид топлива','Выдано, л','Израсходовано, л','Остаток, л'].forEach((h,i)=>{
      put(R(),fStarts[i],h,fHS);merge(R(),fStarts[i],R(),fStarts[i]+fSpans[i]-1);
    });
    fill(R(),fHS);rowH(R(),22);next();

    let grandKm=0, grandKmGlonass=0;
    const gIss={diesel:0,gasoline:0,gas:0};
    const gUsd={diesel:0,gasoline:0,gas:0};
    const gBal={diesel:0,gasoline:0,gas:0};
    data.vehicles.forEach(v=>{
      const ft=v.fuel||'diesel';
      const vRecs=filterRecs(recsFor(v.id));
      vRecs.forEach(r=>{grandKm+=r.km||0;grandKmGlonass+=r.kmGlonass||0;gIss[ft]+=r.fuelIssued||0;gUsd[ft]+=r.fuelUsed||0;});
      const bm=computeFuelBalances(v.id, dateFrom, dateTo);
      const sorted=vRecs.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
      if(sorted.length) gBal[ft]+=bm[sorted[sorted.length-1].id]||0;
      else if(!dateFrom) gBal[ft]+=v.fuelBalance||0;
    });
    const vFuelSet=new Set(data.vehicles.map(v=>v.fuel||'diesel'));
    fuelTypes.filter(ft=>vFuelSet.has(ft)).forEach((ft,i)=>{
      const bg=i%2===0?P.white:P.gray1;
      const bal=+gBal[ft].toFixed(2);
      const balBg=bal<0?P.redPale:bal===0?P.gray2:P.greenPale;
      const sL=cs({bold:true,sz:10,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.gray3));
      const sN=cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
      const sB=cs({bold:true,sz:10,color:{rgb:bal<0?P.red:bal===0?P.gray4:P.green}},balBg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
      put(R(),0,fuelLabels[ft],sL);merge(R(),0,R(),3);fill(R(),sL);
      put(R(),4,+gIss[ft].toFixed(2),sN);merge(R(),4,R(),6);
      put(R(),7,+gUsd[ft].toFixed(2),sN);merge(R(),7,R(),8);
      put(R(),9,bal,sB);merge(R(),9,R(),13);fillRange(R(),cs(null,bg,null,{}),14,NC);
      rowH(R(),20);next();
    });
    spacer();

    // ── Общий пробег (+ по Глонасс, если есть) ───────────
    {
      const bg=P.gray1;
      const sL=cs({bold:true,sz:10,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',indent:1},bAll('thin',P.gray3));
      const sN=cs({bold:true,sz:10,color:{rgb:P.text}},bg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));
      put(R(),0,'Общий пробег, км',sL);merge(R(),0,R(),3);fill(R(),sL);
      put(R(),4,+grandKm.toFixed(1),sN);merge(R(),4,R(),6);
      fillRange(R(),cs(null,bg,null,{}),7,NC);
      rowH(R(),20);next();
      if (grandKmGlonass > 0) {
        put(R(),0,'Пробег по Глонасс, км',sL);merge(R(),0,R(),3);fill(R(),sL);
        put(R(),4,+grandKmGlonass.toFixed(1),sN);merge(R(),4,R(),6);
        fillRange(R(),cs(null,bg,null,{}),7,NC);
        rowH(R(),20);next();
      }
    }
    spacer();

    // ── СВОДКА ПО ОБЪЕКТАМ (СОСТОЯНИЕ ТС) ────────────────
    {
      const secObj=cs({bold:true,sz:11,color:{rgb:P.white}},'1D4ED8',{horizontal:'left',vertical:'center',indent:1},bAll('medium','1D4ED8'));
      hdr('  СВОДКА ПО ОБЪЕКТАМ (СОСТОЯНИЕ ТС)', secObj);

      const objBreak=computeObjectStatusBreakdown();
      // Компактная раскладка: узкие метрики (числа) не растягиваются на широкие
      // "чужие" колонки (Маршруты/Примечание) — иначе «Всего машин» выглядит
      // непропорционально широким рядом с «На ходу»/«В ремонте».
      const hSpec=[[0,7,'Объект'],[7,1,'На ходу'],[8,1,'В ремонте'],[9,2,'Требуется\nремонт'],[11,1,'Всего\nмашин']];
      const OBJ_END=11; // последняя колонка мини-таблицы (не доходит до NC=15)
      const hL=cs({bold:true,sz:10,color:{rgb:P.white}},P.navyMid,{horizontal:'left',vertical:'center',indent:1,wrapText:true},bAll('medium',P.navy));
      hSpec.forEach(([c,span,t])=>{ put(R(),c,t,c===0?hL:ST.tHead); merge(R(),c,R(),c+span-1); });
      fillRange(R(),ST.sp,OBJ_END+1,NC); // серая заливка справа, чтобы строка доходила до края листа
      rowH(R(),26); next();

      let tRun=0,tRep=0,tNeed=0,tTot=0;
      objBreak.forEach(([name,r],i)=>{
        const bg=i%2===0?P.white:P.gray1;
        tRun+=r.run; tRep+=r.repair; tNeed+=r.need; tTot+=r.total;
        const sName=cs({sz:10,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',indent:1,wrapText:true},bAll('thin',P.gray3));
        const sRun=cs({bold:true,sz:11,color:{rgb:P.green}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
        const sRep=cs({bold:true,sz:11,color:{rgb:P.red}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
        const sNeed=cs({bold:true,sz:11,color:{rgb:P.yellow}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
        const sTot=cs({bold:true,sz:11,color:{rgb:P.text}},bg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));
        put(R(),0,name,sName);merge(R(),0,R(),6);
        put(R(),7,r.run,sRun);
        put(R(),8,r.repair,sRep);
        put(R(),9,r.need,sNeed);merge(R(),9,R(),10);
        put(R(),11,r.total,sTot);
        fillRange(R(),cs(null,bg,null,{}),OBJ_END+1,NC);
        rowH(R(),18);next();
      });
      const tL=cs({bold:true,sz:11,color:{rgb:P.text}},P.navyLight,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy));
      const tN=cs({bold:true,sz:11,color:{rgb:P.text}},P.navyLight,{horizontal:'center',vertical:'center'},bAll('medium',P.navy));
      put(R(),0,'ИТОГО',tL);merge(R(),0,R(),6);
      put(R(),7,tRun,tN);
      put(R(),8,tRep,tN);
      put(R(),9,tNeed,tN);merge(R(),9,R(),10);
      put(R(),11,tTot,tN);
      fillRange(R(),tL,OBJ_END+1,NC);
      rowH(R(),22);next();
    }
    spacer();

    hdr('  СВОДКА ПО ТРАНСПОРТНЫМ СРЕДСТВАМ (по объектам)', ST.secN);
    ['№','Госномер','Марка / Модель','Водитель','Организация','Объект','Вид топлива','Состояние',
     'Пробег, км','Выдано, л','Расход по норме, л','Факт. расход, л','Остаток, л','Ср.расход л/100км','Маршруты','Примечание']
      .forEach((h,c)=>put(R(),c,h,ST.tHead));
    rowH(R(),24);next();

    const sortedVehicles = data.vehicles.slice().sort((a,b)=>{
      const oa=(a.object||'￿').toLowerCase();
      const ob=(b.object||'￿').toLowerCase();
      return oa<ob?-1:oa>ob?1:0;
    });
    let curObj=null, grpRowNum=0, globalNum=0;
    sortedVehicles.forEach(v=>{
      const objGroup=v.object||'— Без объекта —';
      if(objGroup!==curObj){
        curObj=objGroup;
        grpRowNum=0;
        const sGrp=cs({bold:true,sz:11,color:{rgb:P.navy}},P.navyLight,{horizontal:'left',vertical:'center',indent:1},bAll('medium',P.navy));
        put(R(),0,'  Объект: '+objGroup,sGrp);merge(R(),0,R(),NC);fill(R(),sGrp);rowH(R(),22);next();
      }
      const bg=grpRowNum%2===0?P.white:P.gray1;
      grpRowNum++;globalNum++;
      const vRecs=filterRecs(recsFor(v.id));
      const vKm=vRecs.reduce((s,r)=>s+(r.km||0),0);
      const vIss=vRecs.reduce((s,r)=>s+(r.fuelIssued||0),0);
      const vUsd=vRecs.reduce((s,r)=>s+(r.fuelUsed||0),0);
      const vAct=vRecs.reduce((s,r)=>s+(r.fuelActual||0),0);
      const bm=computeFuelBalances(v.id, dateFrom, dateTo);
      const sorted=vRecs.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
      const vBal=sorted.length?(bm[sorted[sorted.length-1].id]||0):0;
      const avg=vKm>0&&vAct>0?+(vAct/vKm*100).toFixed(2):null;
      const bal=+vBal.toFixed(2);
      const balBg=bal<0?P.redPale:bal===0?P.gray2:P.greenPale;
      const sB=cs({bold:true,sz:10,color:{rgb:bal<0?P.red:bal===0?P.gray4:P.green}},balBg,{horizontal:'right',vertical:'center',indent:1},bAll('thin',P.gray3));

      const st=(v.status||'').toLowerCase();
      const statusBg    = !v.status ? P.gray2
        : st.includes('резерв') ? P.bluePale
        : (st.includes('ходу') && !st.includes('треб')) ? P.greenPale
        : (st.includes('ремонт') || st.includes('дтп')) ? P.redPale
        : P.yellowPale;
      const statusColor = !v.status ? P.gray4
        : st.includes('резерв') ? P.blue
        : (st.includes('ходу') && !st.includes('треб')) ? P.green
        : (st.includes('ремонт') || st.includes('дтп')) ? P.red
        : P.yellow;
      const sStatus=cs({bold:true,sz:10,color:{rgb:statusColor}},statusBg,{horizontal:'center',vertical:'center'},bAll('thin',P.gray3));

      const vRoutes=vRecs.map(r=>{
        const rts=Array.isArray(r.route)?r.route:(r.route?[r.route]:[]);
        if(!rts.length) return null;
        return fmtDate(r.date)+': '+rts.join('; ');
      }).filter(Boolean).join('\n');
      const routeStyle=cs({sz:9,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',wrapText:true,indent:1},bAll('thin',P.gray3));
      const noteStyle=cs({sz:9,color:{rgb:P.text}},bg,{horizontal:'left',vertical:'center',wrapText:true,indent:1},bAll('thin',P.gray3));
      put(R(),0,globalNum,ST.tdC(bg));put(R(),1,v.plate,ST.tdC(bg));put(R(),2,v.make,ST.tdL(bg));
      put(R(),3,v.driver,ST.tdL(bg));put(R(),4,v.org||'—',ST.tdL(bg));put(R(),5,v.object||'—',ST.tdL(bg));
      put(R(),6,fuelLabels[v.fuel||'diesel'],ST.tdC(bg));
      put(R(),7,v.status||'—',sStatus);
      put(R(),8,+vKm.toFixed(1)||0,ST.tdR(bg));put(R(),9,+vIss.toFixed(2)||0,ST.tdR(bg));
      put(R(),10,+vUsd.toFixed(2)||0,ST.tdR(bg));put(R(),11,+vAct.toFixed(2)||0,ST.tdR(bg));
      put(R(),12,bal,sB);put(R(),13,avg??'',ST.tdR(bg));
      put(R(),14,vRoutes||'—',routeStyle);
      put(R(),15,v.note||'—',noteStyle);
      const noteLines=v.note?Math.ceil(v.note.length/30):1;
      const routeLines=vRoutes?vRoutes.split('\n').length:1;
      rowH(R(),Math.max(19,Math.min(Math.max(routeLines,noteLines)*16,80)));next();
    });

    const filteredAll=filterRecs(data.records);
    const aKm=filteredAll.reduce((s,r)=>s+(r.km||0),0);
    const aIss=filteredAll.reduce((s,r)=>s+(r.fuelIssued||0),0);
    const aUsd=filteredAll.reduce((s,r)=>s+(r.fuelUsed||0),0);
    const aAct=filteredAll.reduce((s,r)=>s+(r.fuelActual||0),0);
    for(let c=0;c<=NC;c++) put(R(),c,'',ST.tot);
    put(R(),1,'ИТОГО',ST.totL);
    put(R(),8,+aKm.toFixed(1),ST.tot);put(R(),9,+aIss.toFixed(2),ST.tot);
    put(R(),10,+aUsd.toFixed(2),ST.tot);put(R(),11,+aAct.toFixed(2),ST.tot);rowH(R(),22);next();

    ws['!cols']=[{wch:4},{wch:13},{wch:22},{wch:22},{wch:18},{wch:16},{wch:14},{wch:18},
                 {wch:13},{wch:13},{wch:16},{wch:15},{wch:13},{wch:16},{wch:40},{wch:30}];
    XLSX.utils.book_append_sheet(wb,ws,'Общая сводка');
  }

  const d=new Date();
  const ds=`${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()}`;
  const periodSuffix = dateFrom
    ? `_${fmtDate(dateFrom).replace(/\./g,'')}-${fmtDate(dateTo).replace(/\./g,'')}`
    : '_всё_время';
  XLSX.writeFile(wb,`Сводка_все_ТС_${ds}${periodSuffix}.xlsx`);
}

