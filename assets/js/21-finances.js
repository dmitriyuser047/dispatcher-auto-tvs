// Финансы и бюджет
// Выделено из index.html

// ─── ФИНАНСЫ ──────────────────────────────────────────
let editingPaymentId = null;
let finMonth = 'all';
let finCategory = '';
let finPaidFilter = '';
let finPartyFilter = '';
let finYearFilter = null;
let finBudgetDrill = null;
let finView = 'table'; // 'table' | 'analytics'

function finNumber(value) { if(value==null||typeof value==='string'&&value.trim()==='')return 0;try{return DecimalCore.toNumberExact(DecimalCore.parse(value));}catch{throw Error('Некорректное число в финансовом источнике. Проверьте исходную запись.');} }
function finToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const finProjectedPayments=new WeakSet();
function finPayments(){
  if(typeof DocumentEngine!=='undefined'&&typeof DocumentEngine.activeRows==='function'){const rows=DocumentEngine.activeRows(data,'payments');rows.forEach(row=>finProjectedPayments.add(row));return rows;}
  const rows=data.payments||[];if(rows.some(row=>row.lifecycle||row.paymentSettlements))throw Error('Не загружены правила версий и оплат документов');return rows;
}
function finEffectivePayment(payment){
  if(payment&&finProjectedPayments.has(payment))return payment;
  if(typeof DocumentEngine!=='undefined'&&payment&&payment.id!=null&&(data.payments||[]).some(row=>row.id===payment.id))return DocumentEngine.effectiveRow(data,'payments',payment.id)||payment;
  return payment;
}
function finPaidAmount(payment) {
  payment=finEffectivePayment(payment);
  return payment.paidAmount !== undefined && payment.paidAmount !== null
    ? Math.max(0, finNumber(payment.paidAmount)) : payment.paid ? Math.max(0, finNumber(payment.sum)) : 0;
}
function finAdd(a,b){return DecimalCore.toNumberExact(DecimalCore.add(a,b));}
function finSum(values){return DecimalCore.toNumberExact(DecimalCore.sum(values));}
function finMoney(value){return precisionFormat(value,{minimumScale:2});}
function finDebt(payment) { payment=finEffectivePayment(payment);return Math.max(0,DecimalCore.toNumberExact(DecimalCore.sub(finNumber(payment.sum),finPaidAmount(payment)))); }
function finOverpaid(payment){payment=finEffectivePayment(payment);return Math.max(0,DecimalCore.toNumberExact(DecimalCore.sub(finPaidAmount(payment),finNumber(payment.sum))));}
function finOverdue(payment) { return finDebt(payment) > 0.005 && /^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate || '') && payment.dueDate < finToday(); }
function finNameKey(value) { return String(value || '').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' '); }
function finResolveContragent(payment) {
  const list = data.contragents || [];
  if (payment.contragentId!=null&&payment.contragentId!=='') { const matches=list.filter(c=>c.id===payment.contragentId);return matches.length===1?matches[0]:null; }
  const key = finNameKey(payment.contragent || payment.company);
  const matches = key ? list.filter(c => finNameKey(c.name) === key) : [];
  return matches.length === 1 ? matches[0] : null;
}
function finContragentName(payment) { return finResolveContragent(payment)?.name || payment.contragent || payment.company || ''; }
function finPartyKey(payment) { const party = finResolveContragent(payment),id=party?party.id:payment.contragentId;return typeof id==='string'&&id.trim()||typeof id==='number'&&Number.isFinite(id)?'id:'+JSON.stringify([typeof id,id]):'name:'+finNameKey(payment.contragent||payment.company); }
function finPaymentContext(payment) {
  const matches=(data.vehicles||[]).filter(row=>row.id===payment.vehicleId);if(matches.length!==1)return {};
  const vehicle=matches[0],stringMatches=(data.vehicles||[]).filter(row=>String(row.id)===String(vehicle.id));
  return typeof wfContext==='function'&&stringMatches.length===1?wfContext('v:'+vehicle.id,payment.date||finToday()):vehicle;
}
function finPaymentOrg(payment) { return typeof payment.org === 'string' ? payment.org : payment.organization || finPaymentContext(payment).org || ''; }
function finPaymentObject(payment) { return typeof payment.object === 'string' ? payment.object : finPaymentContext(payment).object || ''; }

function renderFinancesSection(){try{return finRenderCurrentSection();}catch(error){const host=document.getElementById('mainContent');if(host)host.innerHTML='<div class="wf-note" role="alert"><h3>Финансовый расчёт недоступен</h3><p>'+htmlEsc(error.message)+'</p><p>Проверьте историю документа и диагностику базы. Неполные итоги не показаны.</p></div>';}}
function finRenderCurrentSection(){
  const payments = finPayments();
  const months = new Set();
  payments.forEach(p => {
    if (p.date) {
      const d = new Date(p.date);
      if (!isNaN(d)) months.add(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'));
    }
  });
  const sortedMonths = [...months].sort().reverse();
  const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  let filtered = payments.filter(p => {
    if (finYearFilter && !String(p.date || '').startsWith(finYearFilter + '-')) return false;
    if (finMonth !== 'all') {
      if (!p.date) return false;
      const d = new Date(p.date);
      const mk = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      if (mk !== finMonth) return false;
    }
    if (finCategory && p.category !== finCategory) return false;
    if (finPartyFilter && finPartyKey(p) !== finPartyFilter) return false;
    if (finBudgetDrill && (!finBudgetMatches(p, false, finBudgetDrill.scope) || finBudgetGroup(p, false, finBudgetDrill.dimension).key !== finBudgetDrill.key)) return false;
    if (finPaidFilter === 'paid' && finDebt(p) > 0.005) return false;
    if (finPaidFilter === 'unpaid' && finDebt(p) <= 0.005) return false;
    if (finPaidFilter === 'partial' && !(finPaidAmount(p) > 0 && finDebt(p) > 0.005)) return false;
    if (finPaidFilter === 'overdue' && !finOverdue(p)) return false;
    return true;
  });
  filtered.sort((a, b) => cmpDateDesc(a.date, b.date));

  const totalSum = finSum(filtered.map(p=>finNumber(p.sum)));
  const paidSum = finSum(filtered.map(finPaidAmount));
  const unpaidSum = finSum(filtered.map(finDebt));
  const overdueSum = finSum(filtered.filter(finOverdue).map(finDebt));

  const monthTabs = `<button class="mtab ${finMonth==='all'?'active':''}" onclick="finYearFilter=null;finMonth='all';renderFinancesSection()">Все</button>` +
    sortedMonths.map(m => {
      const [y, mo] = m.split('-');
      const label = monthNames[parseInt(mo)-1] + ' ' + y;
      return `<button class="mtab ${finMonth===m?'active':''}" onclick="finYearFilter=null;finMonth='${m}';renderFinancesSection()">${label}</button>`;
    }).join('');

  const usedCategories = [...new Set(payments.map(p => p.category).filter(Boolean))].sort();
  const catOptions = `<option value="" ${finCategory===''?'selected':''}>Все статьи</option>` +
    usedCategories.map(c =>
      `<option value="${htmlEsc(c)}" ${finCategory===c?'selected':''}>${htmlEsc(c)}</option>`
    ).join('');

  const paidOptions = [['','Все статусы'],['paid','Оплачено'],['unpaid','Есть долг'],['partial','Частично оплачено'],['overdue','Просрочено']].map(([v,l]) =>
    `<option value="${v}" ${finPaidFilter===v?'selected':''}>${l}</option>`
  ).join('');

  const vMap = new Map((data.vehicles||[]).map(v=>[v.id,v.plate]));
  const parties = new Map(payments.map(p => [finPartyKey(p), finContragentName(p) || 'Без контрагента']));
  const partyOptions = '<option value="">Все контрагенты</option>' + [...parties].sort((a,b) => a[1].localeCompare(b[1], 'ru')).map(([key,label]) => `<option value="${htmlEsc(key)}" ${finPartyFilter === key ? 'selected' : ''}>${htmlEsc(label)}</option>`).join('');

  let contentHtml;
  if (finView === 'budget') {
    contentHtml = renderBudgetHtml();
  } else if (finView === 'analytics') {
    contentHtml = renderFinancesAnalyticsHtml(filtered);
  } else {
    const rows = filtered.map(p => {
      const dateStr = p.date ? new Date(p.date).toLocaleDateString('ru') : '—';
      const vPlate = p.vehicleId!=null&&p.vehicleId!=='' ? (vMap.get(p.vehicleId)||'—') : '—';
      const reestrLabel = p.reestrNo ? ('Реестр №'+p.reestrNo) : '—';
      const statusBadge = finDebt(p) <= 0.005
        ? '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:10px;font-size:12px">Оплачено</span>'
        : `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:10px;font-size:12px">${finOverdue(p) ? 'Просрочено' : finPaidAmount(p) > 0 ? 'Частично' : 'Не оплачено'}</span><div style="font-size:11px;margin-top:4px">Долг ${finMoney(finDebt(p))} ₽${p.dueDate ? ' · до ' + htmlEsc(fmtDate(p.dueDate)) : ''}</div>`;
      const catShort = p.category ? (p.category.length > 30 ? p.category.slice(0,30)+'…' : p.category) : '—';
      return `<tr style="cursor:pointer" onclick="openEditPayment(${htmlJs(p.id)})">
        <td>${dateStr}</td>
        <td style="font-weight:600">${finMoney((p.sum||0))} ₽</td>
        <td title="${(p.category||'').replace(/"/g,'&quot;')}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${htmlEsc(catShort)}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${htmlEsc(p.description||'—')}${p.sourceMissing ? '<div style="color:var(--red);font-size:11px">Источник удалён или обнулён: проверьте расход</div>' : ''}${p.sourceReview ? '<div style="color:var(--red);font-size:11px;white-space:normal">Требует сверки: '+htmlEsc(p.sourceReview.message||'Проверьте связь с первичным документом')+'</div>' : ''}</td>
        <td>${htmlEsc(finContragentName(p)||'—')}</td>
        <td>${htmlEsc(vPlate)}</td>
        <td>${htmlEsc(reestrLabel)}</td>
        <td>${statusBadge}${finOverpaid(p)>0?'<div style="color:var(--red)">Переплата '+finMoney(finOverpaid(p))+' ₽</div>':''}</td>
      </tr>`;
    }).join('');

    contentHtml = `<div style="overflow-x:auto">
      <table class="tbl" style="width:100%;min-width:800px">
        <thead><tr>
          <th>Дата</th><th>Сумма</th><th>Статья БДДС</th><th>Описание</th><th>Контрагент</th><th>ТС</th><th>Реестр</th><th>Статус</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px">Нет записей</td></tr>'}</tbody>
      </table>
    </div>`;
  }

  document.getElementById('mainContent').innerHTML = `
    <div style="padding:24px 28px;width:100%;box-sizing:border-box;overflow-y:auto;height:100%">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;overflow-x:auto;padding-bottom:4px">
        ${monthTabs}
        ${finYearFilter ? `<button class="mtab active" onclick="finYearFilter=null;renderFinancesSection()">${finYearFilter} год ×</button>` : ''}
        ${finBudgetDrill ? `<button class="mtab active" onclick="finBudgetDrill=null;renderFinancesSection()">Из плана: ${htmlEsc(FIN_BUDGET_DIMS[finBudgetDrill.dimension])} ×</button>` : ''}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <select class="fsel" style="max-width:200px" onchange="finCategory=this.value;renderFinancesSection()">${catOptions}</select>
        <select class="fsel" style="max-width:200px" onchange="finPaidFilter=this.value;renderFinancesSection()">${paidOptions}</select>
        <select class="fsel" style="max-width:220px" onchange="finPartyFilter=this.value;renderFinancesSection()">${partyOptions}</select>
        <div style="flex:1"></div>
        <button class="toggle-btn ${finView==='analytics'?'active':''}" onclick="finView=finView==='table'?'analytics':'table';renderFinancesSection()">Аналитика</button>
        <button class="btn btn-ghost btn-sm" onclick="finView='budget';renderFinancesSection()">Бюджет</button>
        <button class="btn btn-ghost btn-sm" onclick="periodControlOpen('finance',finMonth==='all'?'':finMonth)">Периоды финансов</button><button class="btn btn-ghost btn-sm" onclick="documentDraftsOpen('payments')">Черновики</button><button class="btn btn-ghost btn-sm" onclick="importPaymentsFromJournals()">Импорт из журналов</button>
        <button class="btn btn-primary btn-sm" onclick="openAddPayment()">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          + Черновик расхода
        </button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid #2563eb">
          <div style="font-size:20px;font-weight:700">${finMoney(totalSum)} ₽</div>
          <div style="font-size:12px;color:var(--text3)">Всего расходов</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid #16a34a">
          <div style="font-size:20px;font-weight:700">${finMoney(paidSum)} ₽</div>
          <div style="font-size:12px;color:var(--text3)">Оплачено</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid #dc2626">
          <div style="font-size:20px;font-weight:700">${finMoney(unpaidSum)} ₽</div>
          <div style="font-size:12px;color:var(--text3)">Не оплачено</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid #7c3aed">
          <div style="font-size:20px;font-weight:700">${filtered.length}</div>
          <div style="font-size:12px;color:var(--text3)">Записей</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid #dc2626"><div style="font-size:20px;font-weight:700">${finMoney(overdueSum)} ₽</div><div style="font-size:12px;color:var(--text3)">Просроченный долг</div></div>
      </div>
      ${contentHtml}
    </div>
  `;
}

function renderFinancesAnalyticsHtml(allPayments) {
  const payments = allPayments || finPayments();
  const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const vMap = new Map((data.vehicles||[]).map(v=>[v.id,v.plate]));

  const byMonth = Object.create(null), byCat = Object.create(null), byVehicle = Object.create(null);
  let grandTotal = 0;
  payments.forEach(p => {
    const sum = finNumber(p.sum);
    grandTotal=finAdd(grandTotal,sum);
    if (p.date) {
      const d = new Date(p.date);
      const mk = monthNames[d.getMonth()] + ' ' + d.getFullYear();
      if (!byMonth[mk]) byMonth[mk] = {total:0,paid:0,unpaid:0,count:0,sortKey:p.date};
      byMonth[mk].total=finAdd(byMonth[mk].total,sum);
      byMonth[mk].count++;
      byMonth[mk].paid=finAdd(byMonth[mk].paid,finPaidAmount(p)); byMonth[mk].unpaid=finAdd(byMonth[mk].unpaid,finDebt(p));
      if (!byMonth[mk].sortKey || p.date < byMonth[mk].sortKey) byMonth[mk].sortKey = p.date;
    }
    const cat = p.category || 'Без категории';
    if (!byCat[cat]) byCat[cat] = {total:0,count:0};
    byCat[cat].total=finAdd(byCat[cat].total,sum); byCat[cat].count++;
    if (p.vehicleId) {
      const plate = vMap.get(p.vehicleId) || p.vehicleId;
      if (!byVehicle[plate]) byVehicle[plate] = {total:0,count:0};
      byVehicle[plate].total=finAdd(byVehicle[plate].total,sum); byVehicle[plate].count++;
    }
  });

  const monthRows = Object.entries(byMonth)
    .sort((a,b) => b[1].sortKey.localeCompare(a[1].sortKey))
    .map(([name,d]) => `<tr><td>${htmlEsc(name)}</td><td style="font-weight:600">${finMoney(d.total)} ₽</td><td style="color:#16a34a">${finMoney(d.paid)} ₽</td><td style="color:#dc2626">${finMoney(d.unpaid)} ₽</td><td>${d.count}</td></tr>`).join('');

  const palette = ['#2563eb','#7c3aed','#dc2626','#d97706','#059669','#db2777','#64748b','#0284c7','#16a34a','#a21caf'];
  const catEntries = Object.entries(byCat).sort((a,b) => b[1].total - a[1].total);
  const catRows = catEntries.map(([name,d], i) => {
      const pct = grandTotal > 0 ? (d.total/grandTotal*100).toFixed(1) : 0;
      const clr = palette[i % palette.length];
      return `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${clr};margin-right:6px"></span><span style="max-width:250px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle">${htmlEsc(name)}</span></td><td style="font-weight:600">${finMoney(d.total)} ₽</td><td>${pct}%</td><td>${d.count}</td></tr>`;
    }).join('');

  const vehRows = Object.entries(byVehicle)
    .sort((a,b) => b[1].total - a[1].total)
    .map(([name,d]) => `<tr><td>${htmlEsc(name)}</td><td style="font-weight:600">${finMoney(d.total)} ₽</td><td>${d.count}</td></tr>`).join('');

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div style="grid-column:1/-1">
        <h3 style="margin:0 0 10px;font-size:15px;font-weight:600">По месяцам</h3>
        <div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>Месяц</th><th>Итого</th><th>Оплачено</th><th>Не оплачено</th><th>Записей</th></tr></thead>
        <tbody>${monthRows||'<tr><td colspan="5" style="text-align:center;color:var(--text3)">Нет данных</td></tr>'}</tbody></table></div>
      </div>
      <div>
        <h3 style="margin:0 0 10px;font-size:15px;font-weight:600">По статьям БДДС</h3>
        <div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>Статья</th><th>Сумма</th><th>%</th><th>Кол-во</th></tr></thead>
        <tbody>${catRows||'<tr><td colspan="4" style="text-align:center;color:var(--text3)">Нет данных</td></tr>'}</tbody></table></div>
      </div>
      <div>
        <h3 style="margin:0 0 10px;font-size:15px;font-weight:600">По транспорту</h3>
        <div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>ТС</th><th>Сумма</th><th>Кол-во</th></tr></thead>
        <tbody>${vehRows||'<tr><td colspan="3" style="text-align:center;color:var(--text3)">Нет данных</td></tr>'}</tbody></table></div>
      </div>
    </div>
    <div style="margin-top:20px;padding:16px;background:var(--card);border:1px solid var(--border);border-radius:10px;text-align:center">
      <div style="font-size:13px;color:var(--text3)">Итог по выбранным фильтрам · по дате расхода</div>
      <div style="font-size:26px;font-weight:700;margin-top:4px">${finMoney(grandTotal)} ₽</div>
    </div>
  `;
}

// ─── БЮДЖЕТ: ПЛАН И ФАКТ ──────────────────────────────
const FIN_BUDGET_DIMS = {contragent:'Контрагент',org:'Организация',object:'Объект',category:'Статья'};
let budgetYear = new Date().getFullYear();
let budgetCompareMonth = 'all';
let budgetGroupBy = 'contragent';
const budgetScope = {org:'',object:'',category:''};

function finBudgetValues(row, planned) {
  return {contragent:finContragentName(row),org:planned ? row.org || row.organization || '' : finPaymentOrg(row),object:planned ? row.object || '' : finPaymentObject(row),category:row.category || ''};
}
function finBudgetGroup(row, planned, dimension = budgetGroupBy) {
  const values = finBudgetValues(row,planned), value = values[dimension] || '';
  if (!value) return {key:(planned ? 'unallocated:' : 'unassigned:') + dimension,name:(planned ? 'План без распределения: ' : 'Расходы без значения: ') + FIN_BUDGET_DIMS[dimension]};
  return {key:dimension === 'contragent' ? finPartyKey(row) : dimension + ':' + finNameKey(value),name:value};
}
function finBudgetMatches(row, planned, scope = budgetScope) {
  const values = finBudgetValues(row,planned);
  return Object.entries(scope).every(([dimension,value]) => !value || finNameKey(values[dimension]) === finNameKey(value));
}
function finBudgetComparison() {
  const groups = new Map();
  const get = (item,planned) => {
    const group = finBudgetGroup(item,planned);
    if (!groups.has(group.key)) groups.set(group.key,{...group,plan:0,hasPlan:false,actual:0,paid:0,debt:0,count:0});
    return groups.get(group.key);
  };
  (data.budget || []).filter(b => Number(b.year) === budgetYear && (budgetCompareMonth === 'all' || Number(b.month) === Number(budgetCompareMonth)) && finBudgetMatches(b,true)).forEach(b => {const row=get(b,true);row.plan=finAdd(row.plan,finNumber(b.sum));row.hasPlan=true;});
  finPayments().filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') && Number(p.date.slice(0,4)) === budgetYear && (budgetCompareMonth === 'all' || Number(p.date.slice(5,7)) === Number(budgetCompareMonth)) && finBudgetMatches(p,false)).forEach(p => {const row=get(p,false);row.actual=finAdd(row.actual,finNumber(p.sum));row.paid=finAdd(row.paid,finPaidAmount(p));row.debt=finAdd(row.debt,finDebt(p));row.count++;});
  return [...groups.values()].sort((a,b) => b.actual-a.actual || a.name.localeCompare(b.name,'ru'));
}
function finBudgetAnnual() {
  const groups = new Map();
  (data.budget || []).filter(b => Number(b.year) === budgetYear && finBudgetMatches(b,true)).forEach(b => {
    const group = finBudgetGroup(b,true);
    if (!groups.has(group.key)) groups.set(group.key,{...group,months:Array(12).fill(0)});
    if (Number(b.month)>=1 && Number(b.month)<=12) groups.get(group.key).months[Number(b.month)-1]=finAdd(groups.get(group.key).months[Number(b.month)-1],finNumber(b.sum));
  });
  return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name,'ru'));
}
function finBudgetScopeOptions(dimension) {
  const values = new Set([budgetScope[dimension],...(data.budget || []).map(b=>finBudgetValues(b,true)[dimension]),...finPayments().map(p=>finBudgetValues(p,false)[dimension])].filter(Boolean));
  return `<option value="">Все: ${FIN_BUDGET_DIMS[dimension].toLocaleLowerCase('ru')}</option>` + [...values].sort((a,b)=>a.localeCompare(b,'ru')).map(value=>`<option value="${htmlEsc(value)}" ${budgetScope[dimension]===value?'selected':''}>${htmlEsc(value)}</option>`).join('');
}
function finBudgetSuggestions(dimension) {
  const values = new Set([...(data.budget || []).map(b=>finBudgetValues(b,true)[dimension]),...finPayments().map(p=>finBudgetValues(p,false)[dimension]),...(dimension==='contragent' ? (data.contragents || []).filter(c=>!c.archived).map(c=>c.name) : dimension==='org' || dimension==='object' ? (data.vehicles || []).map(v=>v[dimension]) : (typeof reestrStatyi!=='undefined'?reestrStatyi:[]).map(s=>s.label))].filter(Boolean));
  return [...values].sort((a,b)=>a.localeCompare(b,'ru')).map(value=>`<option value="${htmlEsc(value)}">`).join('');
}
function finOpenBudgetPayments(key) {
  finPartyFilter='';finCategory='';finPaidFilter='';finView='table';
  finBudgetDrill={key,dimension:budgetGroupBy,scope:{...budgetScope}};
  finYearFilter=budgetCompareMonth==='all'?budgetYear:null;
  finMonth=budgetCompareMonth==='all'?'all':budgetYear+'-'+String(budgetCompareMonth).padStart(2,'0');
  renderFinancesSection();
}
function renderBudgetPlanFactHtml() {
  const rows=finBudgetComparison(), money=finMoney;
  const totals=rows.reduce((out,row)=>{['plan','actual','paid','debt'].forEach(k=>out[k]=finAdd(out[k],row[k]));return out;},{plan:0,actual:0,paid:0,debt:0});
  const body=rows.map(row=>`<tr><td><button class="btn btn-ghost btn-sm" onclick="finOpenBudgetPayments(${htmlJs(row.key)})">${htmlEsc(row.name)}</button></td><td class="num">${row.hasPlan?money(row.plan):'Не задан'}</td><td class="num">${money(row.actual)}</td><td class="num">${money(row.paid)}</td><td class="num">${money(row.debt)}</td><td class="num" style="color:${row.hasPlan&&row.actual>row.plan?'var(--red)':'inherit'}">${row.hasPlan?money(DecimalCore.sub(row.actual,row.plan)):'—'}</td><td class="num">${row.plan>0?(row.actual/row.plan*100).toFixed(1)+'%':'—'}</td></tr>`).join('');
  const options='<option value="all">Весь год</option>'+Array.from({length:12},(_,i)=>`<option value="${i+1}" ${Number(budgetCompareMonth)===i+1?'selected':''}>${new Date(2020,i,1).toLocaleDateString('ru',{month:'long'})}</option>`).join('');
  return `<section style="margin-top:24px;border-top:1px solid var(--border);padding-top:20px"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">План и факт · ${budgetYear}</h3><select onchange="budgetCompareMonth=this.value;renderFinancesSection()">${options}</select></div><p style="font-size:12px;color:var(--text3)">Расходы и оплаты сгруппированы по дате расхода. Частичные оплаты учтены, долг считается по каждому документу. План без нужного распределения показан отдельно и не распределяется автоматически. Нажмите строку, чтобы открыть исходные расходы.</p><div style="overflow:auto"><table class="tbl" style="width:100%;min-width:760px"><thead><tr><th>${FIN_BUDGET_DIMS[budgetGroupBy]}</th><th>План, ₽</th><th>Расходы, ₽</th><th>Оплачено, ₽</th><th>Долг, ₽</th><th>Отклонение, ₽</th><th>Исполнение</th></tr></thead><tbody>${body||'<tr><td colspan="7">Нет планов и расходов за этот период</td></tr>'}</tbody><tfoot><tr><th>Итого</th><th>${money(totals.plan)}</th><th>${money(totals.actual)}</th><th>${money(totals.paid)}</th><th>${money(totals.debt)}</th><th>${rows.every(r=>r.hasPlan&&!r.key.startsWith('unallocated:'))?money(DecimalCore.sub(totals.actual,totals.plan)):'Есть нераспределённые суммы'}</th><th></th></tr></tfoot></table></div></section>`;
}
function renderBudgetHtml() {
  const monthNames=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const groups=finBudgetAnnual(), totals=Array(12).fill(0);
  const rows=groups.map(group=>`<tr><td>${htmlEsc(group.name)}</td>${group.months.map((value,i)=>{totals[i]=finAdd(totals[i],value);return `<td class="num">${value?finMoney(value):'—'}</td>`;}).join('')}<td class="num"><b>${finMoney(finSum(group.months))}</b></td></tr>`).join('');
  const dimensions=Object.entries(FIN_BUDGET_DIMS).map(([key,label])=>`<option value="${key}" ${budgetGroupBy===key?'selected':''}>${label}</option>`).join('');
  const inputs=[['contragent','budg_company'],['org','budg_org'],['object','budg_object'],['category','budg_category']].map(([dimension,id])=>`<div style="flex:1;min-width:180px"><label for="${id}" style="font-size:12px">${FIN_BUDGET_DIMS[dimension]}</label><input id="${id}" list="${id}_list" placeholder="Если известно…" style="width:100%"><datalist id="${id}_list">${finBudgetSuggestions(dimension)}</datalist></div>`).join('');
  const entries=(data.budget||[]).filter(b=>Number(b.year)===budgetYear&&finBudgetMatches(b,true));
  const entryRows=entries.map(b=>`<tr><td>${String(b.month).padStart(2,'0')}.${b.year}</td><td>${htmlEsc(finContragentName(b))}</td><td>${htmlEsc(b.org||'')}</td><td>${htmlEsc(b.object||'')}</td><td>${htmlEsc(b.category||'')}</td><td class="num">${finMoney(finNumber(b.sum))}</td><td><button class="btn btn-ghost btn-sm" onclick="finEditBudgetEntry(${htmlJs(b.id)})">Изменить</button><button class="btn btn-ghost btn-sm" onclick="finDeleteBudgetEntry(${htmlJs(b.id)})">Удалить</button></td></tr>`).join('');
  return `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px"><h3 style="margin:0">Бюджет</h3><button class="btn btn-ghost btn-sm" onclick="budgetYear--;renderFinancesSection()">◀</button><b>${budgetYear}</b><button class="btn btn-ghost btn-sm" onclick="budgetYear++;renderFinancesSection()">▶</button><label>Группировка <select onchange="budgetGroupBy=this.value;renderFinancesSection()">${dimensions}</select></label><button class="btn btn-ghost btn-sm" onclick="exportBudgetToXlsx()">Экспорт Excel</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${['org','object','category'].map(d=>`<select aria-label="Фильтр: ${FIN_BUDGET_DIMS[d]}" onchange="budgetScope.${d}=this.value;renderFinancesSection()">${finBudgetScopeOptions(d)}</select>`).join('')}</div><details style="margin-bottom:18px"><summary>Добавить строку плана</summary><p style="font-size:12px;color:var(--text3)">Укажите организацию, объект, статью и контрагента в нужной детализации. Незаполненные измерения останутся без распределения.</p><div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;padding:12px;background:var(--bg);border-radius:8px">${inputs}<div><label for="budg_month">Месяц</label><select id="budg_month">${monthNames.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('')}</select></div><div><label for="budg_sum">Сумма, ₽</label><input type="number" id="budg_sum" min="0" step="0.01"></div><button class="btn btn-primary btn-sm" onclick="addBudgetEntry()">Добавить</button></div></details><div style="overflow:auto"><table class="tbl" style="width:100%;min-width:1000px"><thead><tr><th>${FIN_BUDGET_DIMS[budgetGroupBy]}</th>${monthNames.map(m=>`<th>${m}</th>`).join('')}<th>Итого</th></tr></thead><tbody>${rows||'<tr><td colspan="14">Нет плана по выбранным условиям</td></tr>'}</tbody><tfoot><tr><th>Итого</th>${totals.map(v=>`<th class="num">${finMoney(v)}</th>`).join('')}<th class="num">${finMoney(finSum(totals))}</th></tr></tfoot></table></div>${renderBudgetPlanFactHtml()}<details style="margin-top:20px"><summary>Строки плана · ${entries.length}</summary><div style="overflow:auto"><table class="tbl" style="width:100%;min-width:950px"><thead><tr><th>Период</th><th>Контрагент</th><th>Организация</th><th>Объект</th><th>Статья</th><th>План, ₽</th><th></th></tr></thead><tbody>${entryRows}</tbody></table></div></details></div>`;
}
function finBudgetPartyId(company,previous) {
  if (previous?.contragentId&&finNameKey(company)===finNameKey(finContragentName(previous))) return previous.contragentId;
  return finResolveContragent({company})?.id||null;
}
async function addBudgetEntry() {
  const company=document.getElementById('budg_company').value.trim(),org=document.getElementById('budg_org').value.trim(),object=document.getElementById('budg_object').value.trim(),category=document.getElementById('budg_category').value.trim();
  const month=Number(document.getElementById('budg_month').value);let sum;try{sum=precisionInput('budg_sum',{scale:2,blank:'error'});}catch(error){showFieldError(error.message,error.fieldId);return;}
  if(!company&&!org&&!object&&!category)return alert('Укажите хотя бы организацию, объект, статью или контрагента');
  if(!Number.isFinite(sum)||sum<=0)return alert('Укажите положительную сумму');
  if(!Number.isInteger(month)||month<1||month>12)return alert('Укажите месяц');
  if(!data.budget)data.budget=[];
  data.budget.push({id:'bg_'+(globalThis.crypto?.randomUUID?.()||Date.now()),company,contragentId:finBudgetPartyId(company),org,object,category,month,year:budgetYear,sum});
  if(await saveData(data,{noMerge:true}))renderFinancesSection();
}
function finEditBudgetEntry(id) {
  const entry=(data.budget||[]).find(b=>b.id===id);if(!entry)return;
  if(typeof wfShowDialog!=='function'){showToast('Окно редактирования недоступно');return;}
  wfShowDialog('Изменить строку плана',`<form id="finBudgetEditForm"><div class="wf-grid">${[['company','Контрагент'],['org','Организация'],['object','Объект'],['category','Статья']].map(([key,label])=>`<label>${label}<input name="${key}" value="${htmlEsc(key==='company'?finContragentName(entry):entry[key]||'')}"></label>`).join('')}<label>Год<input name="year" type="number" min="2000" max="2200" required value="${Number(entry.year)}"></label><label>Месяц<input name="month" type="number" min="1" max="12" required value="${Number(entry.month)}"></label><label>Сумма, ₽<input name="sum" type="number" min="0.01" step="any" required value="${finNumber(entry.sum)}"></label></div><button class="btn btn-primary">Сохранить</button></form>`);
  document.getElementById('finBudgetEditForm').onsubmit=async event=>{
    event.preventDefault();const fd=new FormData(event.target),company=String(fd.get('company')||'').trim(),org=String(fd.get('org')||'').trim(),object=String(fd.get('object')||'').trim(),category=String(fd.get('category')||'').trim(),year=Number(fd.get('year')),month=Number(fd.get('month')),formSum=event.target.elements.sum;let sum;try{sum=precisionInput(event.target.elements.sum,{scale:2,blank:'error',previous:entry.sum});}catch(error){showFieldError(error.message);return;}
    if(!company&&!org&&!object&&!category){showToast('Укажите измерение плана');return;}
    if(!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12||!Number.isFinite(sum)||sum<=0){showToast('Проверьте период и сумму');return;}
    Object.assign(entry,{company,contragentId:finBudgetPartyId(company,entry),org,object,category,year,month,sum});
    if(await saveData(data,{noMerge:true})){closeModal('wfModal');renderFinancesSection();}
  };
}
async function finDeleteBudgetEntry(id) {
  if(!await confirmAction('Удалить эту строку плана?'))return;
  data.budget=(data.budget||[]).filter(b=>b.id!==id);
  if(await saveData(data,{noMerge:true}))renderFinancesSection();
}
async function deleteBudgetCompany(company) {
  const entries=(data.budget||[]).filter(b=>b.company===company&&Number(b.year)===budgetYear);
  if(!entries.length||!await confirmAction('Удалить строк плана: '+entries.length+'?'))return;
  const ids=new Set(entries.map(b=>b.id));data.budget=data.budget.filter(b=>!ids.has(b.id));
  if(await saveData(data,{noMerge:true}))renderFinancesSection();
}
function exportBudgetToXlsx() {
  if(typeof XLSX==='undefined'){showToast('Библиотека Excel не загружена');return;}
  const annual=finBudgetAnnual(),comparison=finBudgetComparison(),entries=(data.budget||[]).filter(b=>Number(b.year)===budgetYear&&finBudgetMatches(b,true));
  if(!annual.length&&!comparison.length){showToast('Нет данных для экспорта');return;}
  const months=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const annualRows=[[FIN_BUDGET_DIMS[budgetGroupBy],...months,'Итого'],...annual.map(g=>[g.name,...g.months,finSum(g.months)])];
  const comparisonRows=[[FIN_BUDGET_DIMS[budgetGroupBy],'План','Расходы','Оплачено','Долг','Отклонение','Исполнение, %'],...comparison.map(r=>[r.name,r.hasPlan?r.plan:'',r.actual,r.paid,r.debt,r.hasPlan?DecimalCore.toNumberExact(DecimalCore.sub(r.actual,r.plan)):'',r.plan>0?r.actual/r.plan*100:''])];
  const detailRows=[['ID','Год','Месяц','Контрагент','Организация','Объект','Статья','План'],...entries.map(b=>[b.id,b.year,b.month,finContragentName(b),b.org||'',b.object||'',b.category||'',finNumber(b.sum)])];
  const scopeRows=[['Год',budgetYear],['Месяц план-факта',budgetCompareMonth==='all'?'Весь год':budgetCompareMonth],['Группировка',FIN_BUDGET_DIMS[budgetGroupBy]],...Object.entries(budgetScope).map(([key,value])=>[FIN_BUDGET_DIMS[key],value||'Все']),['Основание','По дате расхода; оплаты могут быть частичными. Нераспределённые планы показаны отдельно.']];
  const wb=XLSX.utils.book_new();
  [['Бюджет',annualRows],['План-факт',comparisonRows],['Строки плана',detailRows],['Условия',scopeRows]].forEach(([name,rows])=>{const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=rows[0].map((_,i)=>({wch:i===0?35:20}));XLSX.utils.book_append_sheet(wb,ws,name);});
  XLSX.writeFile(wb,'Бюджет_'+budgetYear+'.xlsx');
}
function finPaymentSelectedId(select){
  const option=select?.selectedOptions?.[0];if(!option||option.value==='')return null;
  let id;try{id=JSON.parse(option.dataset.typedId);}catch{throw Error('Выберите связь со справочником с подтверждённым ID');}
  if(!EntityIdentity.identifier(id))throw Error('Некорректный ID связи со справочником');return id;
}
function finPaymentSourceFields(){
  const fields=Object.fromEntries(['pay_date','pay_sum','pay_category','pay_contragent','pay_invoice','pay_org','pay_object','pay_reestr','pay_due_date','pay_paid_amount','pay_paid_date'].map(id=>[id,document.getElementById(id)?.value??'']));
  fields.vehicleId=finPaymentSelectedId(document.getElementById('pay_vehicle'));fields.contragentId=finPaymentSelectedId(document.getElementById('pay_contragent_id'));fields.paid=document.getElementById('pay_paid').checked;
  return JSON.stringify(fields);
}
function finEnsurePaymentFields(payment = {}) {
  const name = document.getElementById('pay_contragent');
  let select = document.getElementById('pay_contragent_id');
  if (!select) {
    const label = document.createElement('label'); label.textContent = 'Связь со справочником контрагентов';
    select = document.createElement('select'); select.id = 'pay_contragent_id';
    name.parentElement.insertBefore(label, name); name.parentElement.insertBefore(select, name);
    select.addEventListener('change', () => { select._catalogChanged=true;try{const id=finPaymentSelectedId(select),party=(data.contragents||[]).find(c=>c.id===id);if(party)name.value=party.name;}catch(error){showFieldError(error.message,'pay_contragent_id');} });
  }
  select.replaceChildren();
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Без привязки / ввести название вручную'; select.append(empty);
  const selectedId=payment.contragentId!=null&&payment.contragentId!==''?payment.contragentId:finResolveContragent(payment)?.id;
  (data.contragents || []).filter(c=>!c.archived&&!c.mergedInto||c.id===selectedId).sort((a,b) => (a.name || '').localeCompare(b.name || '', 'ru')).forEach(c => {
    const option = document.createElement('option'); option.value = c.id; option.dataset.typedId=JSON.stringify(c.id);option.selected=c.id===selectedId;option.textContent = c.name + (c.inn ? ' · ИНН ' + c.inn : '') + (c.archived ? ' · архив' : ''); select.append(option);
  });
  if (payment.contragentId!=null&&payment.contragentId!=='' && !(data.contragents || []).some(c => c.id === payment.contragentId)) {
    const missing = document.createElement('option'); missing.value = payment.contragentId;missing.dataset.typedId=JSON.stringify(payment.contragentId);missing.selected=true;missing.textContent = (payment.contragent || 'Контрагент') + ' · удалён из справочника'; select.append(missing);
  }
  select._catalogInitialId=selectedId??null;select._catalogChanged=false;
  if (!document.getElementById('pay_due_date')) {
    const fields = document.createElement('div'); fields.className = 'form-row';
    fields.innerHTML = '<div class="form-group"><label for="pay_due_date">Срок оплаты</label><input type="date" id="pay_due_date"></div><div class="form-group"><label for="pay_paid_amount">Оплачено, ₽</label><input type="number" id="pay_paid_amount" min="0" step="0.01"></div><div class="form-group"><label for="pay_paid_date">Дата оплаты</label><input type="date" id="pay_paid_date"></div>';
    const checkbox = document.getElementById('pay_paid');
    const group = checkbox.closest('.form-group'); group.parentElement.insertBefore(fields, group);
    checkbox.addEventListener('change', () => { document.getElementById('pay_paid_amount').value = checkbox.checked ? document.getElementById('pay_sum').value || '0' : '0'; });
    const updatePaidFlag = () => { try{const sum=precisionInput('pay_sum',{scale:2,blank:'null'}),paid=precisionInput('pay_paid_amount',{scale:2,blank:'zero'});checkbox.checked=sum>0&&paid>=sum;}catch{checkbox.checked=false;} };
    document.getElementById('pay_paid_amount').addEventListener('input', updatePaidFlag);
    document.getElementById('pay_sum').addEventListener('input', updatePaidFlag);
  }
  document.getElementById('pay_due_date').value = payment.dueDate || '';
  document.getElementById('pay_paid_amount').value = finPaidAmount(payment);
  document.getElementById('pay_paid_date').value = payment.paidDate || '';
  if (!document.getElementById('pay_org')) {
    const fields = document.createElement('div'); fields.className = 'form-row';
    fields.innerHTML = '<div class="form-group"><label for="pay_org">Организация расхода</label><input id="pay_org" list="pay_org_list"><datalist id="pay_org_list"></datalist></div><div class="form-group"><label for="pay_object">Объект расхода</label><input id="pay_object" list="pay_object_list"><datalist id="pay_object_list"></datalist></div>';
    name.parentElement.insertAdjacentElement('afterend', fields);
    document.getElementById('pay_vehicle').addEventListener('change', event => {
      let vehicle;try{const id=finPaymentSelectedId(event.target);vehicle=(data.vehicles||[]).find(v=>v.id===id);}catch(error){showFieldError(error.message,'pay_vehicle');return;}
      const org = document.getElementById('pay_org'), object = document.getElementById('pay_object');
      if (!org.value) org.value = vehicle?.org || '';
      if (!object.value) object.value = vehicle?.object || '';
    });
  }
  document.getElementById('pay_org').value = finPaymentOrg(payment);
  document.getElementById('pay_object').value = finPaymentObject(payment);
  document.getElementById('pay_org_list').innerHTML = finBudgetSuggestions('org');
  document.getElementById('pay_object_list').innerHTML = finBudgetSuggestions('object');
}

async function openAddPayment() { return newDocument('payments'); }

async function openEditPayment(id) {
  const p = (data.payments||[]).find(x => x.id === id);
  if (!p) return;
  if(typeof DocumentEngine!=='undefined'&&DocumentEngine.state('payments',p)!=='legacy-live')return lifecycleOpen('payments',id);
  editingPaymentId = id;
  document.getElementById('paymentModalTitle').textContent = 'Редактировать платёж';
  document.getElementById('paymentDeleteBtn').style.display = '';
  const dateStr = p.date ? new Date(p.date).toLocaleDateString('ru') : '';
  document.getElementById('pay_date').value = dateStr;
  document.getElementById('pay_sum').value = p.sum || '';
  document.getElementById('pay_description').value = p.description || '';
  document.getElementById('pay_contragent').value = finContragentName(p);
  document.getElementById('pay_invoice').value = p.invoiceNo || '';
  document.getElementById('pay_paid').checked = finDebt(p) <= 0.005;
  document.getElementById('pay_note').value = p.note || '';
  await populatePaymentSelects(p);
  selectPayCategory(p.category || '');
  document.getElementById('pay_reestr').value = p.reestrNo || '';
  finEnsurePaymentFields(p);
  ['pay_paid','pay_paid_amount','pay_paid_date'].forEach(key=>{document.getElementById(key).disabled=true;});
  document.getElementById('paymentModal')._paymentEditState={id,fields:finPaymentSourceFields()};
  openModal('paymentModal');
}

let payStatyiItems = [];

async function populatePaymentSelects(payment={}) {
  await loadReestrStatyi();
  payStatyiItems = reestrStatyi.map(s => s.label);
  filterPayCategory();
  const vSel = document.getElementById('pay_vehicle');
  vSel.innerHTML = '<option value="">— не привязано —</option>' +
    (data.vehicles||[]).filter(v=>!v.archived&&!v.mergedInto||v.id===payment.vehicleId).map(v => `<option value="${htmlEsc(v.id)}" data-typed-id="${htmlEsc(JSON.stringify(v.id))}" ${v.id===payment.vehicleId?'selected':''}>${htmlEsc(v.plate)}</option>`).join('');
  if(payment.vehicleId!=null&&payment.vehicleId!==''&&!(data.vehicles||[]).some(v=>v.id===payment.vehicleId)){const option=new Option('Прежняя техника · карточка недоступна',String(payment.vehicleId),false,true);option.dataset.typedId=JSON.stringify(payment.vehicleId);vSel.add(option);}
  const rSel = document.getElementById('pay_reestr');
  rSel.innerHTML = '<option value="">— не указан —</option>' +
    (data.savedReestrs||[]).map(r => `<option value="${htmlEsc(r.number)}">Реестр №${htmlEsc(r.number)}</option>`).join('');
}

function togglePayCategoryDrop() {
  const panel = document.getElementById('pay_category_panel');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    closePayCategoryDrop();
  } else {
    const btn = document.querySelector('#pay_category_wrap .sdrop-display');
    const rect = btn.getBoundingClientRect();
    document.body.appendChild(panel);
    panel.style.top = (rect.bottom + 4) + 'px';
    panel.style.left = rect.left + 'px';
    panel.style.width = Math.min(500, window.innerWidth - rect.left - 20) + 'px';
    panel.classList.add('open');
    const inp = document.getElementById('pay_category_search');
    inp.value = '';
    filterPayCategory();
    setTimeout(() => inp.focus(), 50);
    setTimeout(() => document.addEventListener('click', _closePayCatOnOutside, true), 10);
  }
}
function closePayCategoryDrop() {
  const panel = document.getElementById('pay_category_panel');
  panel.classList.remove('open');
  const wrap = document.getElementById('pay_category_wrap');
  if (wrap && panel.parentNode !== wrap) wrap.appendChild(panel);
  document.removeEventListener('click', _closePayCatOnOutside, true);
}
function _closePayCatOnOutside(e) {
  const panel = document.getElementById('pay_category_panel');
  if (panel && !panel.contains(e.target) && !e.target.closest('#pay_category_wrap .sdrop-display')) {
    closePayCategoryDrop();
  }
}

function filterPayCategory() {
  const q = (document.getElementById('pay_category_search')?.value || '').toLowerCase();
  const list = document.getElementById('pay_category_list');
  const currentVal = document.getElementById('pay_category').value;
  const filtered = q ? payStatyiItems.filter(s => s.toLowerCase().includes(q)) : payStatyiItems;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="sdrop-empty">Ничего не найдено</div>';
    return;
  }
  list.innerHTML = '<div class="sdrop-item' + (!currentVal ? ' active' : '') + '" onclick="selectPayCategory(\'\')">' +
    '— не указана —</div>' +
    filtered.map(s => {
      const esc = s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      return '<div class="sdrop-item' + (currentVal === s ? ' active' : '') + '" title="' + esc + '" onclick="selectPayCategory(\'' + esc + '\')">' + s + '</div>';
    }).join('');
}

function selectPayCategory(val) {
  document.getElementById('pay_category').value = val;
  document.getElementById('pay_category_text').textContent = val || '— не указана —';
  closePayCategoryDrop();
}

async function savePayment() {
  const dateRaw = document.getElementById('pay_date').value.trim();
  const existing = editingPaymentId==null?null:(data.payments || []).find(p => p.id === editingPaymentId);
  if(!existing){showToast('Новый расход оформляется через отдельный черновик');return;}
  if(typeof DocumentEngine==='undefined'||DocumentEngine.state('payments',existing)!=='legacy-live'){showToast('Этот документ изменяется через историю, исправление или дополнительную оплату');return;}
  const paidInput=document.getElementById('pay_paid_amount'),paidUnchanged=existing&&paidInput._precisionInitial!==undefined&&paidInput.value===paidInput._precisionInitial&&!paidInput.validity?.badInput;
  const numeric=precisionRead({sum:['pay_sum',2,'error'],paidAmount:['pay_paid_amount',2,'zero']},existing?{...existing,paidAmount:finPaidAmount(existing)}:null);if(!numeric)return;
  const {sum,paidAmount}=numeric;
  const category = document.getElementById('pay_category').value;
  const description = document.getElementById('pay_description').value.trim();
  if (!dateRaw || !Number.isFinite(sum) || sum <= 0 || !description) {
    alert('Заполните обязательные поля: дата, сумма, описание');
    return;
  }
  const isoDate = parseDate(dateRaw);
  if (!isoDate) { showFieldError('Укажите действительную дату', 'pay_date'); return; }
  if (!Number.isFinite(paidAmount) || paidAmount < 0) { showFieldError('Укажите сумму оплаты не меньше нуля', 'pay_paid_amount'); return; }
  const dueDate = document.getElementById('pay_due_date')?.value || null;
  const paidDate = document.getElementById('pay_paid_date')?.value || null;
  let partyId,vehicleId;try{partyId=finPaymentSelectedId(document.getElementById('pay_contragent_id'));vehicleId=finPaymentSelectedId(document.getElementById('pay_vehicle'));}catch(error){showToast(error.message);return;}
  const party = (data.contragents || []).find(c => c.id === partyId);
  const partyText = document.getElementById('pay_contragent').value.trim();
  const partySelect=document.getElementById('pay_contragent_id'),partyUnchanged=!!existing&&partyId===partySelect._catalogInitialId&&!partySelect._catalogChanged&&partyText===document.getElementById('pay_contragent')._precisionInitial;
  const matched=party||(partyId==null?finResolveContragent({contragent:partyText}):null),resolved=matched&&(!matched.archived&&!matched.mergedInto||partyUnchanged)?matched:null;

  let obj = {
    ...(existing || {}),
    id: editingPaymentId!=null&&editingPaymentId!==''?editingPaymentId:('pay_' + (globalThis.crypto?.randomUUID?.() || Date.now())),
    date: isoDate,
    sum: sum,
    category: category,
    description: description,
    vehicleId,
    org: document.getElementById('pay_org')?.value.trim() || '',
    object: document.getElementById('pay_object')?.value.trim() || '',
    contragent: resolved?.name || partyText,
    contragentId: partyId ?? resolved?.id ?? null,
    contragentAtIssue: existing?.contragentAtIssue || existing?.contragent || partyText || resolved?.name || '',
    reestrNo: document.getElementById('pay_reestr').value ? parseInt(document.getElementById('pay_reestr').value) : null,
    invoiceNo: document.getElementById('pay_invoice').value.trim(),
    paid: paidAmount >= sum - 0.005,
    paidAmount,
    dueDate,
    paidDate,
    settlementManual: true,
    note: document.getElementById('pay_note').value.trim(),
    source: null,
    sourceId: null
  };
  // Settlement is an append-only document action, never an ordinary edit.
  for(const key of ['paid','paidAmount','paidDate','paymentSettlements']){if(Object.hasOwn(existing,key))obj[key]=existing[key];else delete obj[key];}

  if(partyUnchanged)for(const key of ['contragent','contragentId','contragentAtIssue']){if(Object.hasOwn(existing,key))obj[key]=existing[key];else delete obj[key];}
  if(paidUnchanged&&sum===existing.sum){if(Object.hasOwn(existing,'paidAmount'))obj.paidAmount=existing.paidAmount;else delete obj.paidAmount;}
  const editState=document.getElementById('paymentModal')._paymentEditState;
  if(existing&&editState?.id===editingPaymentId&&editState.fields===finPaymentSourceFields())obj={...existing,description,note:document.getElementById('pay_note').value.trim()};
  if (editingPaymentId!=null&&editingPaymentId!=='') {
    const existing = data.payments.find(p => p.id === editingPaymentId);
    if (existing) {
      obj.source = existing.source;
      obj.sourceId = existing.sourceId;
    }
    const idx = data.payments.findIndex(p => p.id === editingPaymentId);
    if (idx >= 0) data.payments[idx] = obj;
  } else {
    data.payments.push(obj);
  }
  if (!await saveData(data)) return;
  closeModal('paymentModal');
  renderFinancesSection();
}

async function deletePayment(id) {
  if(id==null||id==='')return;
  return lifecycleOpen('payments',id);
}

async function importPaymentsFromJournals() {
  return finImportDocumentDrafts();
}

async function finImportDocumentDrafts(){
  try{
    lifecycleReady();
    if(typeof DomainSources==='undefined'||DomainSources.apiVersion!==1)throw Error('Модуль признания расходов не загружен');
    let database=data;const context=wfCommandContextStamp(),projection=DomainSources.projectFinancialSources(data),keyOf=row=>JSON.stringify([row.source,typeof row.sourceId,row.sourceId]);
    const known=new Map();for(const row of data.payments||[])if(row.sourceId!=null&&row.source)known.set(keyOf(row),row);
    const discarded=[];
    for(const row of data.documentDrafts||[])if(row.section==='payments'&&row.payload?.sourceId!=null&&row.payload?.source){known.set(keyOf(row.payload),row.payload);if(row.status==='discarded')discarded.push({code:'discarded-source-draft',source:row.payload.source,sourceId:row.payload.sourceId,message:'Черновик по источнику '+row.payload.source+' · '+(typeof row.payload.sourceId==='number'?'число ':'строка ')+JSON.stringify(row.payload.sourceId)+' отменён. Повторный массовый импорт его не восстанавливает; исходная запись сохранена в истории.'});}
    // A prior import may have used its linked work order instead of the primary.
    // It is still the same obligation; never create another source draft.
    for(const excluded of projection.excluded||[])if(excluded.primarySource&&excluded.primarySourceId!=null&&known.has(keyOf(excluded)))known.set(keyOf({source:excluded.primarySource,sourceId:excluded.primarySourceId}),known.get(keyOf(excluded)));
    const incoming=[],discrepancies=[];for(const source of projection.sources){const old=known.get(keyOf(source));if(old){if(DecimalCore.compare(finNumber(old.sum),source.sum)!==0)discrepancies.push({source:source.source,sourceId:source.sourceId,saved:old.sum,current:source.sum});continue;}incoming.push(source);}
    const excluded=[...(projection.excluded||[]),...discarded];
    if(!incoming.length){showToast('Новых источников нет. Расхождений сумм: '+discrepancies.length+'. Спорных источников: '+excluded.length+'. Сохранённые расходы и оплаты не изменены.');if(discrepancies.length||excluded.length)finImportReview(discrepancies,excluded);return;}
    if(!await confirmAction('Создать отдельных черновиков: '+incoming.length+'? Расхождений с сохранёнными суммами: '+discrepancies.length+'. Они не будут перезаписаны. Проведение и оплата выполняются отдельно.'))return;
    let created=0;
    for(const source of incoming){
      if(database!==data||context!==wfCommandContextStamp())throw Error('База или права изменились. Создано черновиков: '+created);
      const current=DomainSources.projectFinancialSources(data).sources.find(row=>row.source===source.source&&row.sourceId===source.sourceId);if(!current||JSON.stringify(current)!==JSON.stringify(source))throw Error('Источник изменился. Повторите проверку. Создано черновиков: '+created);
      if((data.payments||[]).some(row=>row.sourceId!=null&&row.source&&keyOf(row)===keyOf(source))||(data.documentDrafts||[]).some(row=>row.section==='payments'&&row.payload?.sourceId!=null&&keyOf(row.payload)===keyOf(source)))continue;
      const snapshot={date:source.date,sum:source.sum,category:source.category,description:source.description,vehicleId:source.vehicleId,assetRef:source.assetRef,invoiceNo:source.invoiceNo,org:finPaymentOrg(source),object:finPaymentObject(source)};
      const payload={...snapshot,contragent:'',contragentId:null,note:'',source:source.source,sourceId:source.sourceId,sourceSnapshot:snapshot,sourceMissing:false};
      const operationId='payment-source-'+PlatformKernel.requestDigest({base:{},sections:{payments:[{context,source:source.source,sourceId:source.sourceId}]}}).replace(/[^a-zA-Z0-9]/g,'');
      const result=await platformExecuteCommand({type:'DocumentAction',version:1,input:{action:'saveDraft',section:'payments',payload}},{operationId});
      if(!result.ok)throw Object.assign(Error((result.message||result.error||'Черновик не подтверждён')+'. Создано: '+created),result);database=data;created++;
    }
    renderFinancesSection();if(discrepancies.length||excluded.length)finImportReview(discrepancies,excluded);showToast('Создано черновиков: '+created+'. Расхождений для сверки: '+discrepancies.length+'. Сохранённые суммы и оплаты не изменены.');
  }catch(error){showToast(error.message);}
}
function finImportReview(discrepancies,excluded){
  wfShowDialog('Сверка источников расходов','<div class="wf-form"><p class="wf-wide wf-note">Сохранённые суммы и фактические оплаты не изменены. Для исправления проведённого расхода откройте его историю версий. Спорные источники не создают новое обязательство автоматически.</p>'+(discrepancies.length?'<table class="tbl wf-wide"><thead><tr><th>Источник / ID</th><th>Сохранено, ₽</th><th>Текущая версия, ₽</th></tr></thead><tbody>'+discrepancies.map(row=>'<tr><td>'+htmlEsc(row.source+' · '+JSON.stringify(row.sourceId))+'</td><td>'+htmlEsc(finMoney(row.saved))+'</td><td>'+htmlEsc(finMoney(row.current))+'</td></tr>').join('')+'</tbody></table>':'')+'<ul class="wf-wide">'+excluded.map(issue=>'<li>'+htmlEsc(issue.message||issue.code)+'</li>').join('')+'</ul></div>');
}

