// Финансовая ведомость: единая семантика частичных оплат и стабильных связей.
let reportPeriod='all',reportGroupBy='category',reportKind='fuel';
let reportOrg='',reportObject='',reportCategory='',reportSettlement='',reportExpandedKey=null;
const REPORT_GROUPS={category:'По статьям',vehicle:'По ТС',contragent:'По контрагентам',org:'По организациям',object:'По объектам',month:'По месяцам'};
function reportsAdd(a,b){return DecimalCore.toNumberExact(DecimalCore.add(a,b));}
function reportsFilteredPayments() {
  return finPayments().filter(p=>{
    if(reportPeriod!=='all'&&String(p.date||'').slice(0,7)!==reportPeriod)return false;
    if(reportOrg&&finNameKey(finPaymentOrg(p))!==finNameKey(reportOrg))return false;
    if(reportObject&&finNameKey(finPaymentObject(p))!==finNameKey(reportObject))return false;
    if(reportCategory&&finNameKey(p.category)!==finNameKey(reportCategory))return false;
    if(reportSettlement==='paid'&&finDebt(p)>0.005)return false;
    if(reportSettlement==='debt'&&finDebt(p)<=0.005)return false;
    if(reportSettlement==='partial'&&!(finPaidAmount(p)>0&&finDebt(p)>0.005))return false;
    if(reportSettlement==='overdue'&&!finOverdue(p))return false;
    return true;
  });
}
function reportsPaymentGroup(p) {
  if(reportGroupBy==='vehicle') {
    const v=(data.vehicles||[]).find(v=>v.id===p.vehicleId);
    return {key:p.vehicleId?'vehicle:'+p.vehicleId:'unassigned:vehicle',name:v?[v.plate,v.make].filter(Boolean).join(' · '):p.vehicleId?'ТС удалено из справочника':'Без ТС'};
  }
  if(reportGroupBy==='month') {
    const month=/^\d{4}-\d{2}/.test(p.date||'')?p.date.slice(0,7):'';
    return {key:month||'unassigned:date',name:month?new Date(Number(month.slice(0,4)),Number(month.slice(5,7))-1,1).toLocaleDateString('ru',{month:'long',year:'numeric'}):'Без даты'};
  }
  return finBudgetGroup(p,false,reportGroupBy);
}
function reportsPaymentGroups(payments) {
  const groups=new Map();
  payments.forEach(p=>{
    const group=reportsPaymentGroup(p);
    if(!groups.has(group.key))groups.set(group.key,{...group,count:0,sum:0,paid:0,debt:0,overdue:0});
    const out=groups.get(group.key);out.count++;out.sum=reportsAdd(out.sum,finNumber(p.sum));out.paid=reportsAdd(out.paid,finPaidAmount(p));out.debt=reportsAdd(out.debt,finDebt(p));if(finOverdue(p))out.overdue=reportsAdd(out.overdue,finDebt(p));
  });
  return [...groups.values()].sort((a,b)=>b.sum-a.sum||a.name.localeCompare(b.name,'ru'));
}
function reportsSelectOptions(dimension,current) {
  const values=new Set(finPayments().map(p=>dimension==='org'?finPaymentOrg(p):dimension==='object'?finPaymentObject(p):p.category||'').filter(Boolean));
  if(current)values.add(current);
  return '<option value="">Все</option>'+[...values].sort((a,b)=>a.localeCompare(b,'ru')).map(value=>`<option value="${htmlEsc(value)}" ${current===value?'selected':''}>${htmlEsc(value)}</option>`).join('');
}
function reportsToggleDetail(key) {reportExpandedKey=reportExpandedKey===key?null:key;renderReportsSection();}
function reportsOpenPayment(id) {switchSection('finances');openEditPayment(id);}
function renderReportsSection(){try{return reportsRenderCurrentSection();}catch(error){const host=document.getElementById('mainContent');if(host)host.innerHTML='<div class="wf-note" role="alert"><h3>Отчёт недоступен</h3><p>'+htmlEsc(error.message)+'</p><p>Проверьте историю документа и диагностику базы. Неполные итоги не показаны.</p></div>';}}
function reportsRenderCurrentSection(){
  if(reportKind==='fuel'){renderFuelReport();return;}
  const filtered=reportsFilteredPayments(),groups=reportsPaymentGroups(filtered),money=n=>precisionFormat(n,{minimumScale:2});
  const totals=filtered.reduce((out,p)=>{out.sum=reportsAdd(out.sum,finNumber(p.sum));out.paid=reportsAdd(out.paid,finPaidAmount(p));out.debt=reportsAdd(out.debt,finDebt(p));if(finOverdue(p))out.overdue=reportsAdd(out.overdue,finDebt(p));out.overpaid=reportsAdd(out.overpaid,Math.max(0,DecimalCore.toNumberExact(DecimalCore.sub(finPaidAmount(p),finNumber(p.sum)))));return out;},{sum:0,paid:0,debt:0,overdue:0,overpaid:0});
  const periods=[...new Set(finPayments().map(p=>String(p.date||'').slice(0,7)).filter(m=>/^\d{4}-\d{2}$/.test(m)))].sort().reverse();
  const periodTabs='<button class="mtab '+(reportPeriod==='all'?'active':'')+'" onclick="reportPeriod=\'all\';reportExpandedKey=null;renderReportsSection()">Все</button>'+periods.map(m=>`<button class="mtab ${reportPeriod===m?'active':''}" onclick="reportPeriod='${m}';reportExpandedKey=null;renderReportsSection()">${new Date(Number(m.slice(0,4)),Number(m.slice(5,7))-1,1).toLocaleDateString('ru',{month:'long',year:'numeric'})}</button>`).join('');
  const groupButtons=Object.entries(REPORT_GROUPS).map(([key,label])=>`<button class="mtab ${reportGroupBy===key?'active':''}" onclick="reportGroupBy='${key}';reportExpandedKey=null;renderReportsSection()">${label}</button>`).join('');
  const rows=groups.map(g=>`<tr><td><button class="btn btn-ghost btn-sm" onclick="reportsToggleDetail(${htmlJs(g.key)})">${htmlEsc(g.name)}</button></td><td class="num">${g.count}</td><td class="num">${money(g.sum)}</td><td class="num">${money(g.paid)}</td><td class="num">${money(g.debt)}</td><td class="num" style="color:${g.overdue?'var(--red)':'inherit'}">${money(g.overdue)}</td><td class="num">${totals.sum>0?(g.sum/totals.sum*100).toFixed(1)+'%':'—'}</td></tr>`).join('');
  const expanded=reportExpandedKey===null?null:groups.find(g=>g.key===reportExpandedKey);
  const details=expanded?`<section style="margin-top:24px"><h3>${htmlEsc(expanded.name)} · исходные документы</h3><div style="overflow:auto"><table class="tbl" style="width:100%;min-width:850px"><thead><tr><th>Дата расхода</th><th>Описание</th><th>Контрагент</th><th>Расход</th><th>Оплачено</th><th>Долг</th><th>Срок оплаты</th></tr></thead><tbody>${filtered.filter(p=>reportsPaymentGroup(p).key===reportExpandedKey).slice().sort((a,b)=>cmpDateDesc(a.date,b.date)).map(p=>`<tr><td>${htmlEsc(p.date?fmtDate(p.date):'—')}</td><td><button class="btn btn-ghost btn-sm" onclick="reportsOpenPayment(${htmlJs(p.id)})">${htmlEsc(p.description||'Без описания')}</button></td><td>${htmlEsc(finContragentName(p)||'—')}</td><td class="num">${money(finNumber(p.sum))}</td><td class="num">${money(finPaidAmount(p))}</td><td class="num">${money(finDebt(p))}</td><td style="color:${finOverdue(p)?'var(--red)':'inherit'}">${htmlEsc(p.dueDate?fmtDate(p.dueDate):'Не задан')}</td></tr>`).join('')}</tbody></table></div></section>`:'';
  const cards=[['Расходы',totals.sum],['Оплачено по этим расходам',totals.paid],['Долг',totals.debt],['Просроченный долг',totals.overdue]];
  if(totals.overpaid>0.005)cards.push(['Переплата',totals.overpaid]);
  const statusOptions=[['','Все статусы'],['paid','Оплачено'],['debt','Есть долг'],['partial','Частичная оплата'],['overdue','Просрочено']].map(([key,label])=>`<option value="${key}" ${reportSettlement===key?'selected':''}>${label}</option>`).join('');
  document.getElementById('mainContent').innerHTML=`<div style="padding:24px 28px;width:100%;box-sizing:border-box;overflow:auto;height:100%">${reportsKindSwitchHtml('payments')}<h3>Ведомость расходов и оплат</h3><p style="font-size:12px;color:var(--text3)">Период определён датой расхода. Оплаты включают частичные и могут относиться к другим датам; это не отчёт о движении денег за период. Долг и просрочка считаются по каждому документу. Нажмите строку для раскрытия.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px">${cards.map(([label,value])=>`<div class="stat-card"><div class="stat-value">${money(value)} ₽</div><div class="stat-label">${label}</div></div>`).join('')}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${periodTabs}</div><div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px"><label>Организация <select onchange="reportOrg=this.value;reportExpandedKey=null;renderReportsSection()">${reportsSelectOptions('org',reportOrg)}</select></label><label>Объект <select onchange="reportObject=this.value;reportExpandedKey=null;renderReportsSection()">${reportsSelectOptions('object',reportObject)}</select></label><label>Статья <select onchange="reportCategory=this.value;reportExpandedKey=null;renderReportsSection()">${reportsSelectOptions('category',reportCategory)}</select></label><select aria-label="Статус оплаты" onchange="reportSettlement=this.value;reportExpandedKey=null;renderReportsSection()">${statusOptions}</select></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${groupButtons}</div><div style="overflow:auto"><table class="data-table" style="width:100%;min-width:800px"><thead><tr><th>Группа</th><th>Документов</th><th>Расходы, ₽</th><th>Оплачено, ₽</th><th>Долг, ₽</th><th>Просрочено, ₽</th><th>Доля</th></tr></thead><tbody>${rows||'<tr><td colspan="7">Нет данных по выбранным условиям</td></tr>'}</tbody><tfoot><tr><th>Итого</th><th>${filtered.length}</th><th>${money(totals.sum)}</th><th>${money(totals.paid)}</th><th>${money(totals.debt)}</th><th>${money(totals.overdue)}</th><th>${totals.sum>0?'100%':'—'}</th></tr></tfoot></table></div>${details}<div style="margin-top:20px;text-align:right"><button class="primary-btn" onclick="exportReportXlsx()">Экспорт в Excel</button></div></div>`;
}
function exportReportXlsx(){try{return reportsExportCurrentXlsx();}catch(error){showToast('Экспорт недоступен: '+error.message);return false;}}
function reportsExportCurrentXlsx() {
  if(typeof XLSX==='undefined'){showToast('Библиотека Excel не загружена');return;}
  const filtered=reportsFilteredPayments().slice().sort((a,b)=>cmpDateAsc(a.date,b.date)),groups=reportsPaymentGroups(filtered);
  const details=[['Дата расхода','Расход, ₽','Статья','Описание','Контрагент','ID контрагента','Организация','Объект','ТС','Оплачено, ₽','Долг, ₽','Срок оплаты','Просроченный долг, ₽','Дата оплаты','Счёт','Источник','ID источника']];
  filtered.forEach(p=>{const vehicle=(data.vehicles||[]).find(v=>v.id===p.vehicleId);details.push([p.date||'',finNumber(p.sum),p.category||'',p.description||'',finContragentName(p),p.contragentId||finResolveContragent(p)?.id||'',finPaymentOrg(p),finPaymentObject(p),vehicle?.plate||p.vehicleId||'',finPaidAmount(p),finDebt(p),p.dueDate||'',finOverdue(p)?finDebt(p):0,p.paidDate||'',p.invoiceNo||'',p.source||'',p.sourceId||'']);});
  const summary=[['Группа','Документов','Расходы','Оплачено','Долг','Просрочено'],...groups.map(g=>[g.name,g.count,g.sum,g.paid,g.debt,g.overdue])];
  const conditions=[['Период по дате расхода',reportPeriod==='all'?'Все':reportPeriod],['Организация',reportOrg||'Все'],['Объект',reportObject||'Все'],['Статья',reportCategory||'Все'],['Статус оплаты',reportSettlement||'Все'],['Группировка',REPORT_GROUPS[reportGroupBy]],['Примечание','Оплаты включают частичные, относятся к выбранным расходам, а не к датам движения денег.']];
  const wb=XLSX.utils.book_new();
  [['Документы',details],['Сводка',summary],['Условия',conditions]].forEach(([name,rows])=>{const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=rows[0].map((_,i)=>({wch:i===3?40:22}));XLSX.utils.book_append_sheet(wb,ws,name);});
  XLSX.writeFile(wb,'Расходы_и_оплаты_'+finToday()+'.xlsx');
}
