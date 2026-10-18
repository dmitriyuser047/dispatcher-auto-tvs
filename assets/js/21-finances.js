// Финансы и бюджет
// Выделено из index.html

// ─── ФИНАНСЫ ──────────────────────────────────────────
let editingPaymentId = null;
let finMonth = 'all';
let finCategory = '';
let finPaidFilter = '';
let finView = 'table'; // 'table' | 'analytics'

function renderFinancesSection() {
  const payments = data.payments || [];
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
    if (finMonth !== 'all' && p.date) {
      const d = new Date(p.date);
      const mk = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      if (mk !== finMonth) return false;
    }
    if (finCategory && p.category !== finCategory) return false;
    if (finPaidFilter === 'paid' && !p.paid) return false;
    if (finPaidFilter === 'unpaid' && p.paid) return false;
    if (finPaidFilter === 'partial' && !(woPaidAmount(p) > 0 && woPaymentBalance(p) > 0)) return false;
    if (finPaidFilter === 'overdue' && !woPaymentState(p, data, todayIso()).overdue) return false;
    if (finPaidFilter === 'mismatch' && !woPaymentState(p, data, todayIso()).amountMismatch) return false;
    return true;
  });
  filtered.sort((a, b) => cmpDateDesc(a.date, b.date));

  const totalSum = filtered.reduce((s,p) => s + (p.sum||0), 0);
  const paidSum = filtered.reduce((s,p) => s + woPaidAmount(p), 0);
  const unpaidSum = filtered.reduce((s,p) => s + woPaymentBalance(p), 0);

  const monthTabs = `<button class="mtab ${finMonth==='all'?'active':''}" onclick="finMonth='all';renderFinancesSection()">Все</button>` +
    sortedMonths.map(m => {
      const [y, mo] = m.split('-');
      const label = monthNames[parseInt(mo)-1] + ' ' + y;
      return `<button class="mtab ${finMonth===m?'active':''}" onclick="finMonth='${m}';renderFinancesSection()">${label}</button>`;
    }).join('');

  const usedCategories = [...new Set(payments.map(p => p.category).filter(Boolean))].sort();
  const catOptions = `<option value="" ${finCategory===''?'selected':''}>Все статьи</option>` +
    usedCategories.map(c =>
      `<option value="${htmlEsc(c)}" ${finCategory===c?'selected':''}>${htmlEsc(c)}</option>`
    ).join('');

  const paidOptions = [['','Все статусы'],['paid','Оплачено'],['unpaid','Есть остаток'],['partial','Частичная оплата'],['overdue','Просрочено'],['mismatch','Сумма отличается от заявки']].map(([v,l]) =>
    `<option value="${v}" ${finPaidFilter===v?'selected':''}>${l}</option>`
  ).join('');

  const vMap = {};
  (data.vehicles||[]).forEach(v => vMap[v.id] = v.plate);

  let contentHtml;
  if (finView === 'budget') {
    contentHtml = renderBudgetHtml();
  } else if (finView === 'analytics') {
    contentHtml = renderFinancesAnalyticsHtml(payments);
  } else {
    const rows = filtered.map(p => {
      const dateStr = p.date ? new Date(p.date).toLocaleDateString('ru') : '—';
      const vPlate = p.vehicleId ? (vMap[p.vehicleId]||'—') : '—';
      const reestrLabel = p.reestrNo ? ('Реестр №'+p.reestrNo) : '—';
      const state = woPaymentState(p, data, todayIso());
      const statusBadge = '<span class="workspace-badge ' + (state.balance <= 0 ? 'is-success' : state.paidAmount > 0 ? 'is-warning' : 'is-neutral') + '">' +
        (state.balance <= 0 ? 'Оплачено' : state.paidAmount > 0 ? 'Частично оплачено' : 'Не оплачено') + '</span>' +
        (state.overdue ? '<div class="gsm-error" style="margin-top:5px">Срок просрочен</div>' : '') +
        (state.amountMismatch ? '<div class="gsm-error" style="margin-top:5px">Сумма заявки: ' + woCurrency(state.sourceCost) + '</div>' : '') +
        (state.sourceMissing ? '<div class="gsm-error">Заявка не найдена</div>' : '') +
        (state.duplicateLink ? '<div class="gsm-error">Несколько счетов на заявку</div>' : '');
      const catShort = p.category ? (p.category.length > 30 ? p.category.slice(0,30)+'…' : p.category) : '—';
      return `<tr style="cursor:pointer" onclick="openEditPayment(${htmlJs(p.id)})">
        <td>${dateStr}</td>
        <td style="font-weight:600">${(p.sum||0).toLocaleString('ru')} ₽</td>
        <td title="${(p.category||'').replace(/"/g,'&quot;')}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${htmlEsc(catShort)}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${htmlEsc(p.description||'—')}</td>
        <td>${htmlEsc(p.contragent||'—')}</td>
        <td>${htmlEsc(vPlate)}</td>
        <td>${htmlEsc(reestrLabel)}</td>
        <td>${p.dueDate ? htmlEsc(fmtDate(p.dueDate)) : '—'}</td>
        <td>${woCurrency(state.paidAmount)}<div style="font-size:11px;color:var(--text3)">Остаток: ${woCurrency(state.balance)}</div></td>
        <td>${statusBadge}</td>
        <td onclick="event.stopPropagation()">${state.source ? '<button type="button" class="btn btn-ghost btn-sm" onclick="woOpen(' + htmlJs(state.sourceSection) + ',' + htmlJs(p.sourceId) + ')">Заявка</button>' : ''}${state.balance > 0 ? '<button type="button" class="btn btn-ghost btn-sm" onclick="woPaymentDialog(' + htmlJs(p.id) + ')">Внести оплату</button>' : ''}</td>
      </tr>`;
    }).join('');

    contentHtml = `<div style="overflow-x:auto">
      <table class="tbl" style="width:100%;min-width:800px">
        <thead><tr>
          <th>Дата</th><th>Сумма</th><th>Статья БДДС</th><th>Описание</th><th>Контрагент</th><th>ТС</th><th>Реестр</th><th>Срок оплаты</th><th>Оплаты / остаток</th><th>Статус</th><th>Действия</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="11" style="text-align:center;color:var(--text3);padding:40px">Нет записей</td></tr>'}</tbody>
      </table>
    </div>`;
  }

  document.getElementById('mainContent').innerHTML = `
    <div style="padding:24px 28px;width:100%;box-sizing:border-box;overflow-y:auto;height:100%">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;overflow-x:auto;padding-bottom:4px">
        ${monthTabs}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <select class="fsel" style="max-width:200px" onchange="finCategory=this.value;renderFinancesSection()">${catOptions}</select>
        <select class="fsel" style="max-width:200px" onchange="finPaidFilter=this.value;renderFinancesSection()">${paidOptions}</select>
        <div style="flex:1"></div>
        <button class="toggle-btn ${finView==='analytics'?'active':''}" onclick="finView=finView==='table'?'analytics':'table';renderFinancesSection()">Аналитика</button>
        <button class="btn btn-ghost btn-sm" onclick="finView='budget';renderFinancesSection()">Бюджет</button>
        <button class="btn btn-ghost btn-sm" onclick="importPaymentsFromJournals()">Импорт из журналов</button>
        <button class="btn btn-primary btn-sm" onclick="openAddPayment()">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          + Платёж
        </button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid var(--accent)">
          <div style="font-size:20px;font-weight:700">${totalSum.toLocaleString('ru')} ₽</div>
          <div style="font-size:12px;color:var(--text3)">Всего расходов</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid #16a34a">
          <div style="font-size:20px;font-weight:700">${paidSum.toLocaleString('ru')} ₽</div>
          <div style="font-size:12px;color:var(--text3)">Оплачено</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid #dc2626">
          <div style="font-size:20px;font-weight:700">${unpaidSum.toLocaleString('ru')} ₽</div>
          <div style="font-size:12px;color:var(--text3)">Не оплачено</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid #7c3aed">
          <div style="font-size:20px;font-weight:700">${filtered.length}</div>
          <div style="font-size:12px;color:var(--text3)">Записей</div>
        </div>
      </div>
      ${contentHtml}
    </div>
  `;
}

function renderFinancesAnalyticsHtml(allPayments) {
  const payments = allPayments || data.payments || [];
  const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const vMap = {};
  (data.vehicles||[]).forEach(v => vMap[v.id] = v.plate);

  const byMonth = {}, byCat = {}, byVehicle = {};
  let grandTotal = 0;
  payments.forEach(p => {
    const sum = p.sum || 0;
    grandTotal += sum;
    if (p.date) {
      const d = new Date(p.date);
      const mk = monthNames[d.getMonth()] + ' ' + d.getFullYear();
      if (!byMonth[mk]) byMonth[mk] = {total:0,paid:0,unpaid:0,count:0,sortKey:p.date};
      byMonth[mk].total += sum;
      byMonth[mk].count++;
      byMonth[mk].paid += woPaidAmount(p);
      byMonth[mk].unpaid += woPaymentBalance(p);
      if (!byMonth[mk].sortKey || p.date < byMonth[mk].sortKey) byMonth[mk].sortKey = p.date;
    }
    const cat = p.category || 'Без категории';
    if (!byCat[cat]) byCat[cat] = {total:0,count:0};
    byCat[cat].total += sum; byCat[cat].count++;
    if (p.vehicleId) {
      const plate = vMap[p.vehicleId] || p.vehicleId;
      if (!byVehicle[plate]) byVehicle[plate] = {total:0,count:0};
      byVehicle[plate].total += sum; byVehicle[plate].count++;
    }
  });

  const monthRows = Object.entries(byMonth)
    .sort((a,b) => b[1].sortKey.localeCompare(a[1].sortKey))
    .map(([name,d]) => `<tr><td>${htmlEsc(name)}</td><td style="font-weight:600">${d.total.toLocaleString('ru')} ₽</td><td style="color:#16a34a">${d.paid.toLocaleString('ru')} ₽</td><td style="color:#dc2626">${d.unpaid.toLocaleString('ru')} ₽</td><td>${d.count}</td></tr>`).join('');

  const palette = ['#2563eb','#7c3aed','#dc2626','#d97706','#059669','#db2777','#64748b','#0284c7','#16a34a','#a21caf'];
  const catEntries = Object.entries(byCat).sort((a,b) => b[1].total - a[1].total);
  const catRows = catEntries.map(([name,d], i) => {
      const pct = grandTotal > 0 ? (d.total/grandTotal*100).toFixed(1) : 0;
      const clr = palette[i % palette.length];
      return `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${clr};margin-right:6px"></span><span style="max-width:250px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle">${htmlEsc(name)}</span></td><td style="font-weight:600">${d.total.toLocaleString('ru')} ₽</td><td>${pct}%</td><td>${d.count}</td></tr>`;
    }).join('');

  const vehRows = Object.entries(byVehicle)
    .sort((a,b) => b[1].total - a[1].total)
    .map(([name,d]) => `<tr><td>${htmlEsc(name)}</td><td style="font-weight:600">${d.total.toLocaleString('ru')} ₽</td><td>${d.count}</td></tr>`).join('');

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
      <div style="font-size:13px;color:var(--text3)">Общий итог за весь период</div>
      <div style="font-size:26px;font-weight:700;margin-top:4px">${grandTotal.toLocaleString('ru')} ₽</div>
    </div>
  `;
}

// ─── BUDGET ─────────────────────────────────────────────
let budgetYear = new Date().getFullYear();

function renderBudgetHtml() {
  const budget = data.budget || [];
  const MN = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const MNF = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  const yearEntries = budget.filter(b => b.year === budgetYear);
  const companies = [...new Set(yearEntries.map(b => b.company))].sort();
  const allCompanies = [...new Set(budget.map(b => b.company))].sort();

  const grid = {};
  yearEntries.forEach(b => {
    const key = b.company;
    if (!grid[key]) grid[key] = {};
    grid[key][b.month] = (grid[key][b.month] || 0) + b.sum;
  });

  const monthTotals = new Array(12).fill(0);
  let grandTotal = 0;

  const rows = companies.map(comp => {
    let rowTotal = 0;
    const cells = MN.map((_, mi) => {
      const v = (grid[comp] && grid[comp][mi + 1]) || 0;
      rowTotal += v;
      monthTotals[mi] += v;
      grandTotal += v;
      return `<td style="text-align:right;padding:6px 8px;font-size:13px">${v ? v.toLocaleString('ru') : ''}</td>`;
    }).join('');
    return `<tr>
      <td style="padding:6px 10px;font-weight:500;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${comp}">${comp}</td>
      ${cells}
      <td style="text-align:right;padding:6px 8px;font-weight:700;background:var(--ws-accent-soft)">${rowTotal.toLocaleString('ru')}</td>
      <td style="text-align:center;padding:4px">
        <button class="icon-btn" title="Удалить компанию" onclick="deleteBudgetCompany('${comp.replace(/'/g, "\\'")}')">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#dc2626" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');

  const totalCells = MN.map((_, mi) =>
    `<td style="text-align:right;padding:6px 8px;font-weight:700;font-size:13px">${monthTotals[mi] ? monthTotals[mi].toLocaleString('ru') : ''}</td>`
  ).join('');

  const companyOptions = allCompanies.map(c => `<option value="${c}">`).join('');

  return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <h3 style="margin:0;font-size:16px">Бюджет по контрагентам</h3>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm" onclick="budgetYear--;renderFinancesSection()">◀</button>
        <span style="font-weight:600;font-size:15px">${budgetYear}</span>
        <button class="btn btn-ghost btn-sm" onclick="budgetYear++;renderFinancesSection()">▶</button>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm" onclick="exportBudgetToXlsx()">Экспорт Excel</button>
      </div>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;padding:12px;background:var(--bg);border-radius:8px;border:1px solid var(--border)">
        <div style="flex:1;min-width:160px">
          <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px">Компания</label>
          <input type="text" id="budg_company" list="budg_company_list" placeholder="Название компании..." style="width:100%;box-sizing:border-box">
          <datalist id="budg_company_list">${companyOptions}</datalist>
        </div>
        <div style="min-width:120px">
          <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px">Месяц</label>
          <select id="budg_month" style="width:100%;box-sizing:border-box">
            ${MNF.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}
          </select>
        </div>
        <div style="min-width:100px">
          <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px">Сумма (руб.)</label>
          <input type="number" id="budg_sum" placeholder="0" min="0" step="0.01" style="width:100%;box-sizing:border-box">
        </div>
        <button class="btn btn-primary btn-sm" onclick="addBudgetEntry()" style="height:34px">Добавить</button>
      </div>
      <div style="overflow-x:auto">
        <table class="tbl" style="width:100%;min-width:900px">
          <thead><tr>
            <th style="text-align:left;min-width:150px">Компания</th>
            ${MN.map(m => `<th style="text-align:right;padding:6px 8px">${m}</th>`).join('')}
            <th style="text-align:right;padding:6px 8px">Итого</th>
            <th style="width:40px"></th>
          </tr></thead>
          <tbody>
            ${rows || '<tr><td colspan="15" style="text-align:center;color:var(--text3);padding:30px">Нет данных. Добавьте запись выше.</td></tr>'}
          </tbody>
          ${companies.length ? `<tfoot><tr style="border-top:2px solid var(--border)">
            <td style="padding:6px 10px;font-weight:700">ИТОГО</td>
            ${totalCells}
            <td style="text-align:right;padding:6px 8px;font-weight:700;font-size:14px;background:var(--ws-accent-soft)">${grandTotal.toLocaleString('ru')}</td>
            <td></td>
          </tr></tfoot>` : ''}
        </table>
      </div>
    </div>`;
}

async function addBudgetEntry() {
  const company = document.getElementById('budg_company').value.trim();
  const month = parseInt(document.getElementById('budg_month').value);
  const sum = parseFloat(document.getElementById('budg_sum').value);
  if (!company) return alert('Укажите компанию');
  if (!Number.isFinite(sum) || sum <= 0) return alert('Укажите положительную конечную сумму');
  if (!data.budget) data.budget = [];
  data.budget.push({ id: newId('bg'), company, month, year: budgetYear, sum });
  if (!await saveData(data)) return;
  document.getElementById('budg_sum').value = '';
  renderFinancesSection();
}

async function deleteBudgetCompany(company) {
  if (!await confirmAction('Удалить все записи «' + company + '» за ' + budgetYear + '?')) return;
  data.budget = (data.budget || []).filter(b => !(b.company === company && b.year === budgetYear));
  if (!await saveData(data)) return;
  renderFinancesSection();
}

function exportBudgetToXlsx() {
  const budget = (data.budget || []).filter(b => b.year === budgetYear);
  if (!budget.length) return alert('Нет данных для экспорта');
  const MNF = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const companies = [...new Set(budget.map(b => b.company))].sort();
  const grid = {};
  budget.forEach(b => {
    if (!grid[b.company]) grid[b.company] = {};
    grid[b.company][b.month] = (grid[b.company][b.month] || 0) + b.sum;
  });

  const ws = {};
  const NC = 13;
  let r = 0;

  function put(row, col, val, style) {
    const addr = XLSX.utils.encode_cell({ r: row, c: col });
    ws[addr] = { v: val == null ? '' : val, t: typeof val === 'number' ? 'n' : 's', s: style || {} };
  }

  const hdrStyle = { font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: 'D9E2F3' } }, alignment: { horizontal: 'center' }, border: { bottom: { style: 'thin', color: { rgb: '999999' } } } };
  const numStyle = { numFmt: '#,##0', alignment: { horizontal: 'right' } };
  const boldNum = { numFmt: '#,##0', font: { bold: true }, alignment: { horizontal: 'right' }, fill: { fgColor: { rgb: 'E8F0FE' } } };
  const compStyle = { font: { bold: true, sz: 11 } };
  const totalRowStyle = { font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: 'D9E2F3' } }, numFmt: '#,##0', alignment: { horizontal: 'right' } };

  put(r, 0, 'Бюджет ' + budgetYear, { font: { bold: true, sz: 14 } });
  r += 2;

  put(r, 0, 'Компания', hdrStyle);
  MNF.forEach((m, i) => put(r, i + 1, m, hdrStyle));
  put(r, 13, 'Итого', hdrStyle);
  r++;

  const monthTotals = new Array(12).fill(0);
  let grandTotal = 0;

  companies.forEach(comp => {
    put(r, 0, comp, compStyle);
    let rowTotal = 0;
    for (let mi = 0; mi < 12; mi++) {
      const v = (grid[comp] && grid[comp][mi + 1]) || 0;
      if (v) put(r, mi + 1, v, numStyle);
      rowTotal += v;
      monthTotals[mi] += v;
    }
    grandTotal += rowTotal;
    put(r, 13, rowTotal, boldNum);
    r++;
  });

  put(r, 0, 'ИТОГО', totalRowStyle);
  monthTotals.forEach((v, i) => put(r, i + 1, v, totalRowStyle));
  put(r, 13, grandTotal, totalRowStyle);

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: NC } });
  ws['!cols'] = [{ wch: 30 }, ...new Array(12).fill({ wch: 12 }), { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Бюджет ' + budgetYear);
  XLSX.writeFile(wb, 'Бюджет_' + budgetYear + '.xlsx');
}

async function openAddPayment() {
  editingPaymentId = null;
  document.getElementById('paymentModalTitle').textContent = 'Добавить платёж';
  document.getElementById('paymentDeleteBtn').style.display = 'none';
  document.getElementById('pay_date').value = '';
  document.getElementById('pay_sum').value = '';
  document.getElementById('pay_description').value = '';
  document.getElementById('pay_contragent').value = '';
  document.getElementById('pay_invoice').value = '';
  document.getElementById('pay_paid').checked = false;
  document.getElementById('pay_note').value = '';
  await populatePaymentSelects();
  selectPayCategory('');
  document.getElementById('pay_vehicle').value = '';
  document.getElementById('pay_reestr').value = '';
  woPaymentFormMount(null);
  openModal('paymentModal');
}

async function openEditPayment(id) {
  const p = (data.payments||[]).find(x => x.id === id);
  if (!p) return;
  editingPaymentId = id;
  document.getElementById('paymentModalTitle').textContent = 'Редактировать платёж';
  document.getElementById('paymentDeleteBtn').style.display = '';
  const dateStr = p.date ? new Date(p.date).toLocaleDateString('ru') : '';
  document.getElementById('pay_date').value = dateStr;
  document.getElementById('pay_sum').value = p.sum || '';
  document.getElementById('pay_description').value = p.description || '';
  document.getElementById('pay_contragent').value = p.contragent || '';
  document.getElementById('pay_invoice').value = p.invoiceNo || '';
  document.getElementById('pay_paid').checked = !!p.paid;
  document.getElementById('pay_note').value = p.note || '';
  await populatePaymentSelects();
  selectPayCategory(p.category || '');
  document.getElementById('pay_vehicle').value = p.vehicleId || '';
  document.getElementById('pay_reestr').value = p.reestrNo || '';
  woPaymentFormMount(p);
  openModal('paymentModal');
}

let payStatyiItems = [];

async function populatePaymentSelects() {
  await loadReestrStatyi();
  payStatyiItems = reestrStatyi.map(s => s.label);
  filterPayCategory();
  const vSel = document.getElementById('pay_vehicle');
  vSel.innerHTML = '<option value="">— не привязано —</option>' +
    (data.vehicles||[]).map(v => `<option value="${htmlEsc(v.id)}">${htmlEsc(v.plate)}</option>`).join('');
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
  const sum = parseFloat(document.getElementById('pay_sum').value);
  const category = document.getElementById('pay_category').value;
  const description = document.getElementById('pay_description').value.trim();
  if (!dateRaw || !Number.isFinite(sum) || sum < 0 || !description) {
    alert('Заполните обязательные поля: дата, сумма, описание');
    return;
  }
  const isoDate = parseDate(dateRaw);
  if (!isoDate) { showFieldError('Укажите действительную дату', 'pay_date'); return; }
  let settlement;
  try { settlement = woPaymentFormRead(sum); } catch (error) { showToast(error.message); return; }
  const existing = (data.payments || []).find(p => p.id === editingPaymentId);
  if (editingPaymentId && !existing) { showToast('Счёт уже удалён. Откройте платежи заново.'); return; }

  const obj = {
    ...(existing || {}),
    id: editingPaymentId || (newId('pay')),
    date: isoDate,
    sum: sum,
    category: category,
    description: description,
    vehicleId: document.getElementById('pay_vehicle').value || null,
    contragent: document.getElementById('pay_contragent').value.trim(),
    reestrNo: document.getElementById('pay_reestr').value ? parseInt(document.getElementById('pay_reestr').value) : null,
    invoiceNo: document.getElementById('pay_invoice').value.trim(),
    paid: document.getElementById('pay_paid').checked,
    note: document.getElementById('pay_note').value.trim(),
    source: null,
    sourceId: null
  };
  Object.assign(obj, settlement);
  try {
    Object.assign(obj, woMergeFormRecord(existing, obj, 'pay'));
    if (woPaidAmount(obj) > woMoney(obj.sum)) throw Error('Оплаченная сумма больше текущей суммы счёта. Сверьте изменения.');
    obj.paid = woMoney(obj.sum) > 0 && woPaymentBalance(obj) <= 0;
  } catch (error) { showToast(error.message); return; }
  const before = JSON.stringify(data);

  if (editingPaymentId) {
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
  const section = woSourceSection(obj, data);
  if (section) woSyncSourcePaid(data, section, obj.sourceId);
  if (!await saveData(data)) { data = JSON.parse(before); rebuildIndex(); return; }
  closeModal('paymentModal');
  renderFinancesSection();
}

async function deletePayment(id) {
  if (!id) return;
  const record = (data.payments || []).find(p => p.id === id);
  if (record && (woPaidAmount(record) > 0 || (record.settlements || []).length)) {
    showToast('В счёте есть оплаты. Сохраните его для истории; исправить сумму можно в форме счёта.'); return;
  }
  if (!await confirmAction('Удалить запись?')) return;
  const before = JSON.stringify(data);
  const source = record && woSource(record, data);
  if (source) source.paid = false;
  data.payments = data.payments.filter(p => p.id !== id);
  if (!await saveData(data)) { data = JSON.parse(before); rebuildIndex(); return; }
  closeModal('paymentModal');
  renderFinancesSection();
}

async function importPaymentsFromJournals() {
  const before = JSON.stringify(data);
  if (!data.payments) data.payments = [];
  let imported = 0;
  for (const section of WO_SECTIONS) {
    for (const row of data[section] || []) {
      if (!(Number(row.cost) > 0) || woLinkedPayments(data, section, row.id).length) continue;
      data.payments.push(woInvoiceFromSource(data, section, row.id, newId('pay'), todayIso()));
      imported++;
    }
  }
  if (!imported) { showToast('Нет новых записей для импорта'); return; }
  if (!await saveData(data, { history: { action: 'Связанные счета из журналов' } })) { data = JSON.parse(before); rebuildIndex(); return; }
  renderFinancesSection();
  showToast('Создано связанных счетов: ' + imported);
}
