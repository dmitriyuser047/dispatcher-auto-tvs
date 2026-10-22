// Реальный центр внимания главного экрана. Расчёты только читают базу;
// исправления, закрытие месяца и другие изменения пользователь подтверждает
// в соответствующих рабочих разделах.
let _opsFilter = 'all';
const _opsHidden = new Set();
let _opsIssues = [];

function opsMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function opsParseDate(value) {
  const s = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00`);
  const p = s.split('.');
  if (p.length === 3) return new Date(+p[2], +p[1] - 1, +p[0], 12);
  return null;
}

function opsDayDiff(value, today = new Date()) {
  const date = opsParseDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b - a) / 86400000);
}

function opsMakeIssue(id, level, filter, label, title, body, source, action, run) {
  return { id, level, filter, label, title, body, source, action, run };
}

function opsCollectIssues(today = new Date()) {
  const month = opsMonthKey(today), issues = [];
  const vehicles = (data.vehicles || []).filter(r=>!r.archived), generators = (data.generators || []).filter(r=>!r.archived);

  (data.tanks || []).filter(t=>!t.archived).forEach(tank => {
    const balance = computeTankBalance(tank.id);
    const reserve = Number(tank.reserveLevel);
    if (balance.balance < 0) {
      issues.push(opsMakeIssue(`tank-negative:${tank.id}`, 'critical', 'critical', 'ОТРИЦАТЕЛЬНЫЙ ОСТАТОК',
        `Расчётный остаток ёмкости «${tank.name}» ушёл в минус`,
        `Баланс ${balance.balance.toLocaleString('ru', { maximumFractionDigits: 1 })} л. Проверьте приход и выдачи, привязанные к ёмкости.`,
        `Ёмкости · ${tank.object || tank.location || tank.name}`, 'Проверить остаток', () => opsOpenTank(tank.id)));
    } else if (Number.isFinite(reserve) && reserve > 0 && balance.balance <= reserve) {
      issues.push(opsMakeIssue(`tank-low:${tank.id}`, 'critical', 'critical', 'НИЗКИЙ ОСТАТОК',
        `Остаток в ёмкости «${tank.name}» достиг резерва`,
        `${balance.balance.toLocaleString('ru', { maximumFractionDigits: 1 })} л при заданном резерве ${reserve.toLocaleString('ru')} л.`,
        `Ёмкости · ${tank.object || tank.location || tank.name}`, 'Проверить остаток', () => opsOpenTank(tank.id)));
    }
  });

  const unlinked = (data.fuelPurchases || []).filter(p => {
    if (p.deleted || !String(p.date || '').startsWith(month)) return false;
    if (!p.vehicleId) return true;
    try { return !(typeof fpLinkedRecord === 'function' && fpLinkedRecord(p)); }
    catch { return !p.recordId; }
  });
  if (unlinked.length) {
    const litres = unlinked.reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
    issues.push(opsMakeIssue('fuel-unlinked:' + month, 'warning', 'check', 'СВЕРКА ГСМ',
      `${unlinked.length} заправок не связаны с машиной или журналом`,
      `За ${fpMonthLabel(month)} не сопоставлено ${litres.toLocaleString('ru', { maximumFractionDigits: 1 })} л. Проверьте распознавание и связь с журналом.`,
      'ГСМ · выписки за текущий месяц', 'Разобрать выписки', () => opsOpenFuel(month, unlinked.some(p => !p.vehicleId) ? 'unmatched' : 'receipts')));
  }

  const recentFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 13);
  const genOutliers = new Map();
  (data.genRecords || []).forEach(record => {
    if (!String(record.date || '').startsWith(month)) return;
    const date = opsParseDate(record.date);
    if (!date || date < recentFrom) return;
    const gen = generators.find(g => g.id === record.generatorId);
    if (!gen || record.fuelActualSource==='estimate' || record.fuelActual==null || record.fuelActual==='') return;
    const norm = typeof genNormSpent === 'function' ? genNormSpent(gen, record) : 0;
    const actual = Number(record.fuelActual);
    if (!(norm > 0) || !(actual > norm * 1.2) || actual - norm < 5) return;
    const pct = Math.round((actual / norm - 1) * 100);
    const current = genOutliers.get(gen.id);
    if (!current || pct > current.pct) genOutliers.set(gen.id, { gen, record, pct, actual, norm });
  });
  genOutliers.forEach(({ gen, record, pct, actual, norm }) => {
    issues.push(opsMakeIssue(`gen-over:${gen.id}:${record.id}`, 'warning', 'check', 'ПРОВЕРИТЬ РАСХОД',
      `Расход ДЭС «${gen.name}» выше нормы на ${pct}%`,
      `${actual.toLocaleString('ru', { maximumFractionDigits: 1 })} л фактически против ${norm.toLocaleString('ru', { maximumFractionDigits: 1 })} л по норме за ${record.hours || 0} мтч.`,
      `Журнал ДЭС · ${gen.location || gen.name} · ${fmtDate(record.date)}`, 'Открыть ДЭС', () => opsOpenGenerator(gen.id)));
  });

  const horizon = 14;
  const addMaintenance = (id, name, date, source, open) => {
    const delta = opsDayDiff(date, today);
    if (delta == null || delta > horizon) return;
    const when = delta < 0 ? `Просрочено на ${Math.abs(delta)} дн.` : delta === 0 ? 'Срок сегодня' : `Через ${delta} дн.`;
    issues.push(opsMakeIssue(`to:${id}:${date}`, delta <= 0 ? 'warning' : 'info', 'soon', delta <= 0 ? 'ТО ПРОСРОЧЕНО' : `ТО ЧЕРЕЗ ${delta} ДН.`,
      `${name} · плановое обслуживание`, `${when}. Запланировано на ${fmtDate(date)}.`, source, 'Открыть график ТО', open));
  };

  const vehiclePlans = new Map();
  const currentTo=new Map();
  (data.vehicleTo || []).filter(r=>!r.cancelled).forEach(r=>{if(!r.planned){const key=r.vehicleId+'|'+(r.type||'ТО');const prev=currentTo.get(key);if(!prev||r.date>prev.date)currentTo.set(key,r);}});
  (data.vehicleTo || []).forEach(r => {
    if(r.cancelled||r.completedAt&&r.planned)return;
    if (r.planned) {
      const v = vehicles.find(x => x.id === r.vehicleId);
      if (v) vehiclePlans.set(`${v.id}|${r.type||'ТО'}|${r.date}`, { v, type:r.type||'ТО', date: r.date });
    } else if (r.nextDate && currentTo.get(r.vehicleId+'|'+(r.type||'ТО'))===r) {
      const v = vehicles.find(x => x.id === r.vehicleId);
      if (v) vehiclePlans.set(`${v.id}|${r.type||'ТО'}|${r.nextDate}`, { v, type:r.type||'ТО', date: r.nextDate });
    }
  });
  vehiclePlans.forEach(({ v, date,type }) => {
    if (/списан|продан/i.test(v.status || '')) return;
    addMaintenance(`vehicle:${v.id}:${type}`, `${v.plate || 'ТС'}${v.make ? ' · ' + v.make : ''} · ${type}`, date,
      `Транспорт · ${v.object || v.org || 'автопарк'}`, () => opsOpenVehicle(v.id));
  });

  generators.forEach(gen => {
    const records=(data.toRecords||[]).filter(r=>r.generatorId===gen.id&&!r.cancelled),latest=new Map(),dates=new Map();
    records.filter(r=>!r.planned).forEach(r=>{const type=r.type||'ТО',p=latest.get(type);if(!p||r.date>p.date)latest.set(type,r);});
    latest.forEach((r,type)=>{if(r.nextDate)dates.set(type+'|'+r.nextDate,{type,date:r.nextDate});});
    records.filter(r=>r.planned&&!r.completedAt).forEach(r=>dates.set((r.type||'ТО')+'|'+r.date,{type:r.type||'ТО',date:r.date}));
    dates.forEach(({type,date})=>addMaintenance(`generator:${gen.id}:${type}`,`ДЭС «${gen.name}» · ${type}`,date,`ДЭС · ${gen.location||gen.name}`,()=>opsOpenGenerator(gen.id)));
  });

  (data.assetDocuments||[]).filter(r=>!r.archived&&r.expires).forEach(r=>{const days=opsDayDiff(r.expires,today);if(days==null||days>30)return;issues.push(opsMakeIssue('document:'+r.id,days<0?'warning':'info','soon','ДОКУМЕНТ',r.title,(days<0?'Срок истёк':'Срок через '+days+' дн.')+' · '+fmtDate(r.expires),'Документы техники и сотрудников','Открыть',()=>{wfOpenTab('assetDocuments');wfEdit('assetDocuments',r.id);}));});
  (data.opsTasks||[]).filter(r=>!r.archived&&!['closed','snoozed'].includes(r.status)&&r.due&&r.due<=wfToday()).forEach(r=>{issues.push(opsMakeIssue('task:'+r.id,'warning','soon','ЗАДАЧА',r.title,`${r.owner||'Ответственный не назначен'} · срок ${fmtDate(r.due)}`,'Рабочие процессы','Открыть',()=>{wfOpenTab('opsTasks');wfEdit('opsTasks',r.id);}));});
  const overduePayments=typeof finOverdue==='function'?(typeof finPayments==='function'?finPayments():data.payments||[]).filter(finOverdue):[];
  if(overduePayments.length)issues.push(opsMakeIssue('payments-overdue','warning','check','ПРОСРОЧЕННАЯ ОПЛАТА',`Истёк срок оплаты по ${overduePayments.length} документам`,`Осталось оплатить ${overduePayments.reduce((sum,p)=>sum+finDebt(p),0).toLocaleString('ru',{maximumFractionDigits:2})} ₽. Частичная оплата учитывается.`,'Финансы','Открыть финансы',()=>switchSection('finances')));
  (data.parts||[]).filter(p=>!p.archived&&Number(p.minStock)>0).forEach(p=>{const stock=wfPartStock(p.id);if(stock<=Number(p.minStock))issues.push(opsMakeIssue('part-low:'+p.id,'info','soon','ЗАПАС ЗАПЧАСТЕЙ',p.name,`Остаток ${stock} ${p.unit||'ед.'} при минимуме ${p.minStock}.`,'Запчасти и шины','Открыть склад',()=>{wfOpenTab('parts');}));});

  const plateGroups = new Map();
  vehicles.forEach(v => {
    if (typeof plateKey !== 'function' || !v.plate) return;
    const key = plateKey(v.plate);
    if (!plateGroups.has(key)) plateGroups.set(key, []);
    plateGroups.get(key).push(v);
  });
  plateGroups.forEach((group, key) => {
    if (group.length < 2) return;
    const ids = group.map(v => v.id).sort().join(',');
    issues.push(opsMakeIssue(`duplicate-plate:${ids}`, 'warning', 'check', 'ПОВТОР ГОСНОМЕРА',
      `Госномер «${key}» указан у ${group.length} машин`,
      group.map(v => [v.make, v.org].filter(Boolean).join(' · ') || 'Карточка без описания').join('; '),
      'Транспорт · проверьте карточки', 'Открыть транспорт', () => switchSection('vehicles')));
  });

  // Последние десять дней месяца — напоминание о фактической готовности
  // закрытия периода. Список проверок уже является штатной логикой приложения.
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const daysToEnd = opsDayDiff(`${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`, today);
  if (daysToEnd <= 10 && !(typeof fuelMonthClosed === 'function' && fuelMonthClosed(month))) {
    let problems = 0;
    try { if (typeof fcChecklist === 'function') problems = fcChecklist(month).filter(item => item.bad).length; } catch {}
    issues.push(opsMakeIssue(`month-close:${month}`, problems ? 'warning' : 'info', 'soon', 'ЗАКРЫТИЕ МЕСЯЦА',
      `Подготовьте сверку ГСМ за ${fpMonthLabel(month)}`,
      problems ? `В контрольном списке закрытия ${problems} пунктов требуют проверки.` : 'Проверьте контрольный список и закройте месяц после сверки.',
      `ГСМ · до конца месяца ${daysToEnd} дн.`, 'Открыть закрытие месяца', () => opsOpenFuel(month, 'close')));
  }

  const order = { critical: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level] || a.title.localeCompare(b.title, 'ru'));
}

function opsOpenFuel(month, view) {
  if (typeof gsmOrg !== 'undefined') gsmOrg = '';
  if (typeof gsmFuel !== 'undefined') gsmFuel = '';
  fpMonth = month; fpView = view; switchSection('fuelPurchases');
}

function opsOpenTank(id) {
  switchSection('tanks');
  setTimeout(() => selectTank(id), 0);
}

function opsOpenGenerator(id) {
  switchSection('generators');
  setTimeout(() => { genSubView = 'generators'; selectGenerator(id); }, 0);
}

function opsOpenVehicle(id) {
  switchSection('vehicles');
  setTimeout(() => selectVehicle(id), 0);
}

function opsOpenMaintenance() { switchSection('toSchedule'); }

function opsRenderIssue(issue, index) {
  const severity = issue.level === 'critical' ? 'critical' : issue.level === 'info' ? 'info' : '';
  const tag = issue.level === 'critical' ? 'red' : issue.level === 'info' ? 'blue' : 'amber';
  return `<article class="ops-issue">
    <div class="ops-severity ${severity}" aria-hidden="true"></div>
    <div class="ops-issue-main">
      <div class="ops-issue-meta"><span class="ops-tag ${tag}">${htmlEsc(issue.label)}</span><span>${index + 1}</span></div>
      <h4>${htmlEsc(issue.title)}</h4><p>${htmlEsc(issue.body)}</p><div class="ops-issue-source">${htmlEsc(issue.source)}</div>
    </div>
    <div class="ops-issue-actions"><button class="btn btn-primary btn-sm" data-ops-open="${index}">${htmlEsc(issue.action)}</button><button class="btn btn-ghost btn-sm" onclick="wfTaskFromIssue(${index})">Назначить задачу</button><button class="btn btn-ghost btn-sm" onclick="wfSnoozeIssue(${index})">Отложить на сутки</button></div>
  </article>`;
}

function opsRenderHealth() {
  const host = document.getElementById('opsSystemStatus');
  const backup = document.getElementById('opsBackupStatus');
  const metric = document.getElementById('opsHealthMetric');
  if (!host || !backup || !metric) return;
  const setStatus = (el, text, state) => { el.textContent = text; el.className = `ops-state ${state || ''}`; };
  if (!window.electronAPI?.getDataHealth) {
    setStatus(host, 'Недоступно в этом режиме', '');
    setStatus(backup, 'Проверка недоступна', '');
    metric.textContent = '—'; return;
  }
  window.electronAPI.getDataHealth().then(status => {
    if (document.getElementById('opsSystemStatus')!==host) return;
    if (status.mode === 'client') {
      setStatus(host, status.available ? `Связь · ${status.serverName || 'сервер доступен'}` : 'Сервер не отвечает', status.available ? 'good' : 'bad');
      setStatus(backup, 'Резервирование на сервере', '');
      metric.textContent = status.available ? 'Связь есть' : 'Нет связи';
      return;
    }
    setStatus(host, status.available ? status.storage : 'Рабочая база не найдена', status.available ? 'good' : 'bad');
    if (status.lastBackupAt) {
      const date = new Date(status.lastBackupAt);
      const age = Math.floor((Date.now() - date.getTime()) / 86400000);
      const label = date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      setStatus(backup, `${label} · ${status.backupCount} коп.`, age > 7 ? 'warn' : 'good');
    } else setStatus(backup, 'Ещё не создавалась', 'warn');
    metric.textContent = status.available ? 'Локальная база' : 'Нет базы';
  }).catch(() => {
    setStatus(host, 'Не удалось проверить', 'warn');
    setStatus(backup, 'Не удалось проверить', 'warn');
    metric.textContent = 'Проверка недоступна';
  });
}

function renderOpsCenter() {
  const dashboard = document.querySelector('.home-dashboard');
  const kpis = dashboard?.querySelector('.home-kpis');
  if (!dashboard || !kpis) return;
  document.getElementById('opsCenter')?.remove();

  const today = new Date(), month = opsMonthKey(today), monthLabel = fpMonthLabel(month);
  _opsIssues = opsCollectIssues(today);
  const visible = _opsIssues.filter(i => !_opsHidden.has(i.id) && (typeof wfIssueVisible!=='function'||wfIssueVisible(i)));
  const critical = visible.filter(i => i.level === 'critical').length;
  const checks = visible.filter(i => i.level === 'warning').length;
  const due = visible.filter(i => i.id.startsWith('to:')).length;
  const unlinkedCount = (data.fuelPurchases || []).filter(p => !p.deleted && String(p.date || '').startsWith(month) && (!p.vehicleId || !(typeof fpLinkedRecord === 'function' && fpLinkedRecord(p)))).length;

  const root = document.createElement('section');
  root.id = 'opsCenter'; root.className = 'ops-center'; root.setAttribute('aria-label', 'Оперативный центр');
  root.innerHTML = `
    <div class="ops-metrics">
      <article class="ops-metric"><span>Требуют внимания</span><strong>${critical + checks}</strong><small>${critical} критично · ${checks} проверки</small></article>
      <article class="ops-metric"><span>ТО в ближайшие 14 дней</span><strong>${due}</strong><small>по графику транспорта и ДЭС</small></article>
      <article class="ops-metric"><span>Заправки без связи</span><strong>${unlinkedCount}</strong><small>за ${htmlEsc(monthLabel)}</small></article>
      <article class="ops-metric"><span>Состояние хранилища</span><strong class="ops-metric-status" id="opsHealthMetric">Проверяем…</strong><small>база и резервные копии</small></article>
    </div>
    <div class="ops-workspace">
      <section class="ops-panel">
        <header class="ops-panel-head"><div><h3>Очередь внимания</h3><p>Срочные вопросы и ближайшие события из рабочих данных</p></div><span class="ops-count" id="opsQueueCount"></span></header>
        <div class="ops-filters" role="group" aria-label="Фильтр событий">
          <button type="button" data-ops-filter="all">Все</button><button type="button" data-ops-filter="critical">Критично</button><button type="button" data-ops-filter="check">Проверить</button><button type="button" data-ops-filter="soon">Скоро</button>
        </div>
        <div class="ops-queue" id="opsQueue"></div>
      </section>
      <aside class="ops-rail">
        <section class="ops-panel ops-rail-card"><h3>Быстрые действия</h3>
          <button class="ops-quick-action" type="button" id="opsActionFuel"><span class="ops-quick-icon">⇄</span><span><b>Разобрать выписки</b><small>${unlinkedCount ? `${unlinkedCount} операций без связи` : 'Операции ГСМ текущего месяца'}</small></span><span class="ops-chevron">›</span></button>
          <button class="ops-quick-action" type="button" id="opsActionTo"><span class="ops-quick-icon">◷</span><span><b>План ТО</b><small>${due ? `${due} событий на горизонте` : 'График транспорта и ДЭС'}</small></span><span class="ops-chevron">›</span></button>
          <button class="ops-quick-action" type="button" id="opsActionClose"><span class="ops-quick-icon">▤</span><span><b>Закрытие месяца</b><small>${htmlEsc(monthLabel)} · ${typeof fuelMonthClosed === 'function' && fuelMonthClosed(month) ? 'закрыт' : 'открыт'}</small></span><span class="ops-chevron">›</span></button>
        </section>
        <section class="ops-panel ops-rail-card"><h3>Система и данные</h3>
          <div class="ops-status-line"><span>Подключение</span><strong id="opsSystemStatus" class="ops-state">Проверяем…</strong></div>
          <div class="ops-status-line"><span>Резервная копия</span><strong id="opsBackupStatus" class="ops-state">Проверяем…</strong></div>
          <p class="ops-note">Статус хранилища считывается из приложения. В сетевом режиме резервные копии остаются на сервере.</p>
        </section>
        <section class="ops-panel ops-rail-card"><h3>Текущий период</h3>
          <div class="ops-status-line"><span>Месяц</span><strong>${htmlEsc(monthLabel)}</strong></div>
          <div class="ops-status-line"><span>Статус</span><strong class="ops-state ${typeof fuelMonthClosed === 'function' && fuelMonthClosed(month) ? 'good' : ''}">${typeof fuelMonthClosed === 'function' && fuelMonthClosed(month) ? 'Закрыт' : 'Открыт'}</strong></div>
          <button class="btn btn-ghost btn-sm ops-period-button" type="button" id="opsOpenPeriod">Открыть журнал ГСМ →</button>
        </section>
      </aside>
    </div>`;
  kpis.insertAdjacentElement('afterend', root);

  const renderQueue = () => {
    const items = visible.filter(i => _opsFilter === 'all' || (_opsFilter === 'critical' ? i.level === 'critical' : i.filter === _opsFilter));
    root.querySelector('#opsQueueCount').textContent = `${items.length} ${items.length === 1 ? 'событие' : items.length > 1 && items.length < 5 ? 'события' : 'событий'}`;
    root.querySelectorAll('[data-ops-filter]').forEach(button => button.classList.toggle('active', button.dataset.opsFilter === _opsFilter));
    const queue = root.querySelector('#opsQueue');
    queue.innerHTML = items.length ? items.map(issue => opsRenderIssue(issue, _opsIssues.indexOf(issue))).join('') : '<div class="ops-empty">В этой категории событий нет.</div>';
    queue.querySelectorAll('[data-ops-open]').forEach(button => button.addEventListener('click', () => _opsIssues[+button.dataset.opsOpen]?.run?.()));
    queue.querySelectorAll('[data-ops-hide]').forEach(button => button.addEventListener('click', () => { const issue = _opsIssues[+button.dataset.opsHide]; if (issue) _opsHidden.add(issue.id); renderOpsCenter(); }));
  };
  root.querySelectorAll('[data-ops-filter]').forEach(button => button.addEventListener('click', () => { _opsFilter = button.dataset.opsFilter; renderQueue(); }));
  root.querySelector('#opsActionFuel').addEventListener('click', () => opsOpenFuel(month, 'receipts'));
  root.querySelector('#opsActionTo').addEventListener('click', opsOpenMaintenance);
  root.querySelector('#opsActionClose').addEventListener('click', () => opsOpenFuel(month, 'close'));
  root.querySelector('#opsOpenPeriod').addEventListener('click', () => opsOpenFuel(month, 'journal'));
  renderQueue();
  opsRenderHealth();
}
