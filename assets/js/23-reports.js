// Отчёты (оборотка)
// Выделено из index.html

// ─── ОТЧЁТЫ (ОБОРОТКА) ──────────────────────────────────
let reportPeriod = 'all';
let reportGroupBy = 'category';

function renderReportsSection() {
  const payments = data.payments || [];
  const vehicles = data.vehicles || [];
  const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  const months = new Set();
  payments.forEach(p => {
    if (p.date) {
      const d = new Date(p.date);
      if (!isNaN(d)) months.add(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));
    }
  });
  const sortedMonths = [...months].sort().reverse();

  let filtered = payments;
  if (reportPeriod !== 'all') {
    filtered = payments.filter(p => {
      if (!p.date) return false;
      const d = new Date(p.date);
      return (d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')) === reportPeriod;
    });
  }

  const totalSum = filtered.reduce((s,p)=>s+(p.sum||0),0);
  const paidSum = filtered.filter(p=>p.paid).reduce((s,p)=>s+(p.sum||0),0);
  const unpaidSum = totalSum - paidSum;

  const periodTabs = `<button class="mtab ${reportPeriod==='all'?'active':''}" onclick="reportPeriod='all';renderReportsSection()">Все</button>` +
    sortedMonths.map(m => {
      const [y,mo] = m.split('-');
      return `<button class="mtab ${reportPeriod===m?'active':''}" onclick="reportPeriod='${m}';renderReportsSection()">${monthNames[parseInt(mo)-1]} ${y}</button>`;
    }).join('');

  const groupBtns = [['category','По статьям'],['vehicle','По ТС'],['contragent','По контрагентам'],['month','По месяцам']].map(([k,l]) =>
    `<button class="mtab ${reportGroupBy===k?'active':''}" onclick="reportGroupBy='${k}';renderReportsSection()">${l}</button>`
  ).join('');

  const vMap = {};
  vehicles.forEach(v => vMap[v.id] = v.plate || v.make || v.id);

  const groups = {};
  filtered.forEach(p => {
    let key;
    if (reportGroupBy === 'category') key = p.category || 'Без категории';
    else if (reportGroupBy === 'vehicle') key = p.vehicleId ? (vMap[p.vehicleId]||p.vehicleId) : 'Без ТС';
    else if (reportGroupBy === 'contragent') key = p.contragent || 'Без контрагента';
    else if (reportGroupBy === 'month') {
      if (!p.date) { key = 'Без даты'; }
      else { const d = new Date(p.date); key = monthNames[d.getMonth()] + ' ' + d.getFullYear(); }
    }
    if (!groups[key]) groups[key] = { count:0, sum:0, paid:0, unpaid:0 };
    groups[key].count++;
    groups[key].sum += (p.sum||0);
    if (p.paid) groups[key].paid += (p.sum||0);
    else groups[key].unpaid += (p.sum||0);
  });

  const sorted = Object.entries(groups).sort((a,b)=>b[1].sum-a[1].sum);
  const pctBar = (val, max) => max > 0 ? `<div style="background:var(--border);border-radius:4px;height:6px;width:100px;display:inline-block;vertical-align:middle;margin-left:8px"><div style="background:#4f46e5;border-radius:4px;height:6px;width:${Math.round(val/max*100)}%"></div></div>` : '';

  const tableRows = sorted.map(([name, g]) => `<tr>
    <td style="font-weight:600">${name}</td>
    <td class="num">${g.count}</td>
    <td class="num">${g.sum.toLocaleString('ru-RU')} ₽ ${pctBar(g.sum, totalSum)}</td>
    <td class="num" style="color:#16a34a">${g.paid.toLocaleString('ru-RU')} ₽</td>
    <td class="num" style="color:#dc2626">${g.unpaid.toLocaleString('ru-RU')} ₽</td>
    <td class="num">${totalSum>0 ? (g.sum/totalSum*100).toFixed(1)+'%' : '—'}</td>
  </tr>`).join('');

  document.getElementById('mainContent').innerHTML = `
    <div style="padding:24px 28px;width:100%;box-sizing:border-box">
      <h3 style="margin:0 0 16px;font-size:18px;font-weight:700">Оборотно-сальдовая ведомость</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-value counter" data-target="${totalSum}">0</div><div class="stat-label">Итого расходов ₽</div></div>
        <div class="stat-card"><div class="stat-value counter" data-target="${paidSum}">0</div><div class="stat-label" style="color:#16a34a">Оплачено ₽</div></div>
        <div class="stat-card"><div class="stat-value counter" data-target="${unpaidSum}">0</div><div class="stat-label" style="color:#dc2626">Не оплачено ₽</div></div>
        <div class="stat-card"><div class="stat-value counter" data-target="${filtered.length}">0</div><div class="stat-label">Документов</div></div>
      </div>
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600;font-size:13px;color:var(--text3)">Период:</span>${periodTabs}
      </div>
      <div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600;font-size:13px;color:var(--text3)">Группировка:</span>${groupBtns}
      </div>
      ${sorted.length ? `<div style="overflow-x:auto"><table class="data-table" style="width:100%">
        <thead><tr><th>${reportGroupBy==='category'?'Статья':reportGroupBy==='vehicle'?'ТС':reportGroupBy==='contragent'?'Контрагент':'Период'}</th><th>Кол-во</th><th>Сумма</th><th>Оплачено</th><th>Не оплач.</th><th>Доля</th></tr></thead>
        <tbody>${tableRows}
          <tr style="font-weight:700;border-top:2px solid var(--border)">
            <td>ИТОГО</td><td class="num">${filtered.length}</td>
            <td class="num">${totalSum.toLocaleString('ru-RU')} ₽</td>
            <td class="num" style="color:#16a34a">${paidSum.toLocaleString('ru-RU')} ₽</td>
            <td class="num" style="color:#dc2626">${unpaidSum.toLocaleString('ru-RU')} ₽</td>
            <td class="num">100%</td>
          </tr>
        </tbody>
      </table></div>` : `<div class="welcome"><h2>Нет данных</h2><p>Добавьте платежи в разделе «Финансы»</p></div>`}
      <div style="margin-top:20px;text-align:right">
        <button class="primary-btn" onclick="exportReportXlsx()">Экспорт в Excel</button>
      </div>
    </div>`;
}

function exportReportXlsx() {
  if (typeof XLSX === 'undefined') { alert('Библиотека XLSX не загружена'); return; }
  const payments = data.payments || [];
  const vehicles = data.vehicles || [];
  const vMap = {};
  vehicles.forEach(v => vMap[v.id] = v.plate || v.make || v.id);

  let filtered = payments;
  if (reportPeriod !== 'all') {
    filtered = payments.filter(p => {
      if (!p.date) return false;
      const d = new Date(p.date);
      return (d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')) === reportPeriod;
    });
  }

  const rows = [['Дата','Сумма','Категория','Описание','Контрагент','ТС','Оплачено']];
  filtered.sort((a, b) => cmpDateAsc(a.date, b.date)).forEach(p => {
    rows.push([
      p.date ? fmtDate(p.date) : '',
      p.sum||0,
      p.category||'',
      p.description||'',
      p.contragent||'',
      p.vehicleId ? (vMap[p.vehicleId]||'') : '',
      p.paid ? 'Да' : 'Нет'
    ]);
  });
  rows.push([]);
  rows.push(['ИТОГО', filtered.reduce((s,p)=>s+(p.sum||0),0)]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:12},{wch:12},{wch:14},{wch:30},{wch:20},{wch:16},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws, 'Оборотка');
  XLSX.writeFile(wb, `Оборотка_${new Date().toISOString().slice(0,10)}.xlsx`);
}

