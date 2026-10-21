// Сверки: пробег по ГЛОНАСС против пробега в журнале и заправки против 1С.
//
// ГЛОНАСС — независимый источник пробега. Если водитель пишет больше, чем
// показал трекер, по норме списывается лишнее топливо. Сравниваем по дням,
// где заполнены оба пробега.
//
// Сверка с 1С — по поставщикам топливных карт за месяц: литры и суммы по
// выпискам против того, что проведено в 1С. Цифры 1С вносятся вручную
// (из оборотки по счёту 10.03 или из актов поставщика) и хранятся в месяце.

// ─── ГЛОНАСС ──────────────────────────────────────────────

const FG_DIFF_PCT = 10;   // расхождение за день в процентах
const FG_DIFF_KM = 20;    // и не меньше чем на столько км

let fgNoOffice = true;
let fgOpen = '';          // машина с раскрытыми днями

function fgRows(month) {
  return (data.vehicles || []).map(v => {
    if (fgNoOffice && fpIsOffice(v)) return null;
    const grouped=new Map();
    recsFor(v.id).filter(r => !month || month === 'all' || String(r.date || '').startsWith(month)).forEach(r => {
      if (!grouped.has(r.date)) grouped.set(r.date,[]); grouped.get(r.date).push(r);
    });
    const days=[...grouped].map(([date,records]) => {
      const telemetry=records.filter(r => fqValue(r.kmGlonass) != null || fqValue(r.glonassFuel) != null);
      const canonical=telemetry.find(r => r.glonassCanonical) || telemetry.slice().sort((a,b) => (fqValue(b.kmGlonass) || 0)-(fqValue(a.kmGlonass) || 0))[0];
      return {date,km:records.reduce((sum,r) => sum+(fqValue(r.km) || 0),0),kmGlonass:canonical ? fqValue(canonical.kmGlonass) : null,
        glonassFuel:canonical ? fqValue(canonical.glonassFuel) : null,glonassFuelKm:canonical ? fqValue(canonical.glonassFuelKm) : null,
        driver:[...new Set(records.map(r => r.driver).filter(Boolean))].join(', '),
        ambiguous:!telemetry.some(r => r.glonassCanonical) && telemetry.length > 1 && new Set(telemetry.map(r => JSON.stringify([r.kmGlonass,r.glonassFuel]))).size > 1};
    }).filter(day => day.km > 0 || day.kmGlonass != null || day.glonassFuel != null);
    if (!days.length) return null;
    const withKm=days.filter(day => day.km > 0), both=days.filter(day => day.kmGlonass != null);
    const km=both.reduce((sum,day) => sum+day.km,0), gl=both.reduce((sum,day) => sum+day.kmGlonass,0);
    const bad=both.filter(day => {const difference=Math.abs(day.km-day.kmGlonass); return difference >= FG_DIFF_KM && (!day.kmGlonass || difference/day.kmGlonass*100 >= FG_DIFF_PCT);}).sort((a,b) => a.date.localeCompare(b.date));
    const sensors=days.filter(day => day.glonassFuel != null && (day.glonassFuelKm ?? day.kmGlonass) > 0);
    const sensL=sensors.reduce((sum,day) => sum+day.glonassFuel,0), sensKm=sensors.reduce((sum,day) => sum+(day.glonassFuelKm ?? day.kmGlonass),0);
    const sens100=sensKm >= 50 ? sensL/sensKm*100 : null, sensDev=sens100 != null && v.norm ? (sens100-v.norm)/v.norm*100 : null;
    return {v,sensL,sensKm,sens100,sensDev,sensDays:sensors.length,days:withKm.length,both:both.length,
      noGl:withKm.filter(day => day.kmGlonass == null).length,km,gl,diff:km-gl,pct:gl ? (km-gl)/gl*100 : null,bad,
      ambiguous:days.filter(day => day.ambiguous).length,overDays:bad.filter(day => day.km > day.kmGlonass).length,
      totalKm:withKm.reduce((sum,day) => sum+day.km,0),sensorCoverage:gl > 0 ? Math.min(100,sensKm/gl*100) : null};
  }).filter(Boolean).sort((a,b) => b.diff-a.diff);
}
function fgHtml() {
  const rows = fgRows(fpMonth);
  const over = rows.filter(r => r.overDays > 0);
  const noGl = rows.filter(r => !r.both);
  const f = (x, d) => x == null ? '—' : fpNum(x, d);
  const body = rows.map(r => {
    const cls = r.pct != null && r.pct >= FG_DIFF_PCT && r.diff >= FG_DIFF_KM ? 'color:var(--red);font-weight:700'
      : r.pct != null && r.pct <= -FG_DIFF_PCT && -r.diff >= FG_DIFF_KM ? 'color:#d97706;font-weight:700' : '';
    const open = fgOpen === r.v.id;
    return `<tr style="cursor:pointer" onclick="fgOpen=fgOpen==='${r.v.id}'?'':'${r.v.id}';renderFuelPurchases()">
      <td><b>${fpEsc(r.v.plate)}</b><div style="font-size:12px;color:var(--text3)">${fpEsc(r.v.make || '')}</div></td>
      <td style="text-align:right">${r.days}</td>
      <td style="text-align:right">${r.both}${r.noGl ? `<div style="font-size:11px;color:#d97706">без ГЛОНАСС: ${r.noGl}</div>` : ''}</td>
      <td style="text-align:right">${f(r.km, 0)}</td>
      <td style="text-align:right">${f(r.gl, 0)}</td>
      <td style="text-align:right;${cls}">${r.both ? (r.diff > 0 ? '+' : '') + fpNum(r.diff, 0) : '—'}</td>
      <td style="text-align:right;${cls}">${r.pct == null ? '—' : (r.pct > 0 ? '+' : '') + fpNum(r.pct, 1) + '%'}</td>
      <td style="text-align:right">${r.bad.length || '—'}${r.ambiguous ? '<div style="color:var(--red)">старые показания неоднозначны: ' + r.ambiguous + '</div>' : ''}</td>
      <td style="text-align:right">${r.sensDays ? fpNum(r.sensL, 1) + '<div style="font-size:11px;color:var(--text3)">' + r.sensDays + ' дн. · покрытие ' + (r.sensorCoverage == null ? '—' : fpNum(r.sensorCoverage, 0) + '%') + '</div>' : '—'}</td>
      <td style="text-align:right;font-weight:700;${r.sensDev != null && r.sensDev >= 10 ? 'color:var(--red)' : ''}">${r.sens100 != null ? fpNum(r.sens100, 1) : '—'}${r.v.norm ? '<div style="font-size:11px;color:var(--text3);font-weight:400">норма ' + fpNum(r.v.norm, 1) + '</div>' : ''}</td>
      <td style="text-align:right;${r.sensDev != null && r.sensDev >= 10 ? 'color:var(--red);font-weight:700' : r.sensDev != null && r.sensDev <= -10 ? 'color:#d97706' : ''}">${r.sensDev == null ? '—' : (r.sensDev > 0 ? '+' : '') + fpNum(r.sensDev, 1) + '%'}</td>
      <td style="font-size:12px;color:var(--text3)">${open ? '▲' : r.bad.length ? '▼ дни' : ''}</td>
    </tr>${open && r.bad.length ? `<tr><td colspan="12" style="background:var(--bg2)">
      <table class="data-table" style="width:100%;margin:4px 0"><thead><tr><th>Дата</th><th style="text-align:right">Журнал, км</th><th style="text-align:right">ГЛОНАСС, км</th><th style="text-align:right">Разница, км</th><th>Водитель</th><th></th></tr></thead>
      <tbody>${r.bad.map(x => `<tr><td>${fmtDate(x.date)}</td><td style="text-align:right">${fpNum(x.km, 0)}</td><td style="text-align:right">${fpNum(x.kmGlonass, 0)}</td>
        <td style="text-align:right;font-weight:700">${(x.km - x.kmGlonass > 0 ? '+' : '') + fpNum(x.km - x.kmGlonass, 0)}</td><td>${fpEsc(x.driver || r.v.driver || '')}</td>
        <td><a href="#" onclick="event.preventDefault();event.stopPropagation();fpOpenJournal('${r.v.id}','${x.date.slice(0, 7)}')">в журнал</a></td></tr>`).join('')}</tbody></table>
    </td></tr>` : ''}`;
  }).join('');

  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" ${fgNoOffice ? 'checked' : ''} onchange="fgNoOffice=this.checked;renderFuelPurchases()"> без офисных машин</label>
      <button class="btn btn-primary" style="margin-left:auto" onclick="importGlonassTrips()">Загрузить отчёт ГЛОНАСС</button>
      <button class="btn btn-ghost" onclick="fgHistoryDialog()">История исходных отчётов</button>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${fkCard('Пробег в журнале больше ГЛОНАСС', over.length + ' машин', 'от ' + FG_DIFF_PCT + '% и ' + FG_DIFF_KM + ' км', over.length ? '#dc2626' : '#16a34a')}
      ${fkCard('Без данных ГЛОНАСС', noGl.length + ' машин', 'ездили, но ГЛОНАСС не внесён', noGl.length ? '#d97706' : '#16a34a')}
      ${fkCard('Дней с расхождением', rows.reduce((s, r) => s + r.bad.length, 0), '', '#64748b')}
    </div>
    <div class="table-wrap"><div class="table-scroll" style="overflow-x:auto">
      <table class="data-table" style="width:100%">
        <thead><tr><th>Машина</th><th style="text-align:right">Дней с пробегом</th><th style="text-align:right">С ГЛОНАСС</th>
          <th style="text-align:right">Журнал, км</th><th style="text-align:right">ГЛОНАСС, км</th><th style="text-align:right">Разница, км</th>
          <th style="text-align:right">%</th><th style="text-align:right">Дней с расхождением</th>
          <th style="text-align:right">Датчик ГЛОНАСС, л</th><th style="text-align:right">Датчик, л/100 км</th><th style="text-align:right">К норме</th><th></th></tr></thead>
        <tbody>${body || '<tr><td colspan="12" style="text-align:center;color:var(--text3);padding:16px">Нет данных</td></tr>'}</tbody>
      </table></div></div>
    <div style="font-size:12px;color:var(--text3);margin-top:10px">
      Сравниваются дневные суммы журнала и ГЛОНАСС, включая нулевой пробег журнала. Телеметрия не складывается повторно между строками одного дня. Пробег в журнале больше ГЛОНАСС — красным:
      по норме за такой пробег списывается лишнее топливо. Меньше — оранжевым. День считается расхождением от ${FG_DIFF_KM} км и ${FG_DIFF_PCT}%.
      Нажмите на машину, чтобы увидеть дни. «Датчик ГЛОНАСС» — расход по датчику уровня топлива из отчёта «Рейсы» за дни, где датчик дал данные;
      сравнивается с нормой из карточки машины, превышение от 10% — красным.
    </div>`;
}

// ─── Сверка с 1С ──────────────────────────────────────────

let frcMonth = '';
let _frcSession = null;

function frcContextStamp() {
  return typeof syncSessionStamp === 'function' ? syncSessionStamp() : typeof dispatcherContext === 'function' ? dispatcherContext().identity : String(typeof localCacheKey === 'undefined' ? 'local' : localCacheKey);
}
function frcSession() {
  const stamp=frcContextStamp();
  if (!_frcSession || _frcSession.stamp!==stamp) _frcSession={stamp,drafts:new Map(),chain:Promise.resolve(true),pending:0,lastSaved:false};
  return _frcSession;
}
function frcSameSession(session) { return session.stamp===frcContextStamp(); }
function frcWritable() {
  return !(typeof _loadWriteBlocked !== 'undefined' && _loadWriteBlocked) && (typeof _sync === 'undefined' || !_sync.access || (_sync.access.writable || []).includes('fuelPeriods'));
}
function frcDraftKey(month,provider,field) { return JSON.stringify([month,provider,field]); }
function frcReadValue(month,provider,field) {
  const period=(data.fuelPeriods || []).find(row=>row.month===month),recon=period?.recon;
  const values=recon && Object.prototype.hasOwnProperty.call(recon,provider) ? recon[provider] : null;
  return values && Object.prototype.hasOwnProperty.call(values,field) ? {present:true,value:values[field]} : {present:false};
}
function frcShownValue(month,provider,field,value) { const draft=frcSession().drafts.get(frcDraftKey(month,provider,field)); return draft ? draft.text : value; }
function frcInput(month,provider,field,value,closed,type='number') {
  const shown=frcShownValue(month,provider,field,value),text=field==='note' ? String(shown || '') : frcHas(shown) ? String(shown) : '';
  return '<input type="'+type+'" '+(type==='number' ? 'step="'+(field==='litres' ? '0.001' : '0.01')+'" style="width:115px;text-align:right" ' : '')+'value="'+fpEsc(text)+'" data-frc-month="'+fpEsc(month)+'" data-frc-provider="'+fpEsc(provider)+'" data-frc-field="'+field+'" data-frc-rendered="'+fpEsc(text)+'" data-frc-submitted="'+fpEsc(text)+'" data-frc-stamp="'+fpEsc(frcSession().stamp)+'" '+(closed || !frcWritable() ? 'disabled' : '')+' onchange="frcInputChanged(this)">';
}
function frcInputChanged(input) {
  // Blur during flush or another change event must not implicitly retry a
  // failed draft. Retrying is an explicit action and always sets a value.
  if(input.validity?.badInput){showToast('Завершите ввод числа в сверке');return Promise.resolve(false);}
  if(input.dataset.frcSubmitted===input.value)return;
  input.dataset.frcSubmitted=input.value;
  return frcSet(input.dataset.frcMonth,input.dataset.frcProvider,input.dataset.frcField,input.value,input.dataset.frcStamp);
}
function frcSaveStatusHtml(session=frcSession()) {
  const failed=[...session.drafts.values()].filter(entry=>entry.state==='failed');
  if (session.pending) return '<span>Сохраняем сверку… Ожидается подтверждение записи.</span>';
  if (failed.length) return '<span style="color:var(--red)">Не сохранено полей: '+failed.length+'. '+fpEsc(failed[0].error)+' Введённые значения оставлены в полях. Итоги рассчитаны по сохранённым данным.</span> <button type="button" class="btn btn-ghost btn-sm" data-frc-retry data-frc-stamp="'+fpEsc(session.stamp)+'" onclick="void frcRetry(this.dataset.frcStamp)" '+(!frcWritable() ? 'disabled' : '')+'>Повторить сохранение</button> <button type="button" class="btn btn-ghost btn-sm" data-frc-discard data-frc-stamp="'+fpEsc(session.stamp)+'" onclick="void frcDiscard(this.dataset.frcStamp)">Отменить несохранённые</button>';
  return session.lastSaved ? '<span style="color:var(--green)">Сверка сохранена</span>' : '';
}
function frcRefresh(session,committed) {
  if (!frcSameSession(session)) return;
  const status=document.getElementById('frcSaveStatus');if(status)status.innerHTML=frcSaveStatusHtml(session);
  if (committed) document.querySelectorAll('[data-frc-field]').forEach(input=>{
    if(input.dataset.frcMonth===committed.month && input.dataset.frcProvider===committed.provider && input.dataset.frcField===committed.field && input.value===committed.text && !session.drafts.has(committed.key)) input.dataset.frcRendered=input.value;
  });
  // Refresh calculated cells without replacing inputs: an ACK may arrive while
  // the user is already typing in the next cell, before its change event.
  if (!document.getElementById('frcTotals')) return;
  const template=document.createElement('template');template.innerHTML=frcHtml();
  for (const id of ['frcTotals','frcTotalsRow']) {
    const current=document.getElementById(id),fresh=template.content.querySelector('#'+id);
    if(current && fresh)current.replaceChildren(...fresh.childNodes);
  }
  const freshCells=new Map([...template.content.querySelectorAll('[data-frc-difference]')].map(cell=>[cell.dataset.frcDifference,cell.innerHTML]));
  document.querySelectorAll('[data-frc-difference]').forEach(cell=>{if(freshCells.has(cell.dataset.frcDifference))cell.innerHTML=freshCells.get(cell.dataset.frcDifference);});
}

function frcProvider(p) {
  const c = fcByNumber(p.cardNo);
  return p.sourceProvider || (c && c.provider) || fcGuessProvider(fcNorm(p.cardNo)) || 'Прочие карты';
}

function frcData(month) {
  const by = new Map();
  fpLive().filter(p => (p.date || '').startsWith(month)).forEach(p => {
    const k = frcProvider(p);
    const x = by.get(k) || { litres: 0, sum: 0, n: 0, noSum: 0 };
    x.litres += fqValue(p.qty) || 0; x.sum += fqValue(p.sum) || 0; x.n++; if (fqValue(p.sum) == null) x.noSum++;
    by.set(k, x);
  });
  return by;
}

function frcHas(value) { return fqValue(value) != null; }
function frcCompleteness(month) {
  const by=frcData(month), recon=(fuelPeriod(month) || {}).recon || {}, providers=[...new Set([...by.keys(),...Object.keys(recon)])];
  const result={providers:providers.length,litresKnown:0,moneyKnown:0,statementMoneyKnown:0,litres:0,money:0,statementLitres:0,statementMoney:0};
  providers.forEach(provider => {
    const values=recon[provider] || {}, statement=by.get(provider) || {litres:0,sum:0,n:0,noSum:0};
    result.statementLitres+=statement.litres; result.statementMoney+=statement.sum;
    if (frcHas(values.litres)) { result.litresKnown++; result.litres+=Number(values.litres); }
    if (frcHas(values.sum)) { result.moneyKnown++; result.money+=Number(values.sum); }
    if (!statement.noSum) result.statementMoneyKnown++;
  });
  result.litresComplete=providers.length > 0 && result.litresKnown === providers.length;
  result.moneyComplete=providers.length > 0 && result.moneyKnown === providers.length;
  result.statementMoneyComplete=providers.length > 0 && result.statementMoneyKnown === providers.length;
  return result;
}
function frcHtml() {
  const session=frcSession(),drafts=[...session.drafts.values()];
  const months=[...new Set([...fpMonthsList(),...fpCmpMonths(),...fuelPeriods().filter(period => period.recon).map(period => period.month),...drafts.map(entry=>entry.month)])].sort().reverse();
  if (!frcMonth || !months.includes(frcMonth)) frcMonth=months[0] || '';
  if (!frcMonth) return '<div class="welcome"><p>Нет данных</p></div>';
  const recon=(fuelPeriod(frcMonth) || {}).recon || {}, closed=fuelMonthClosed(frcMonth), by=frcData(frcMonth), providers=[...new Set([...by.keys(),...Object.keys(recon),...drafts.filter(entry=>entry.month===frcMonth).map(entry=>entry.provider)])].sort((a,b) => a.localeCompare(b,'ru'));
  const total=frcCompleteness(frcMonth), journal=(data.records || []).filter(r => String(r.date || '').startsWith(frcMonth)).reduce((sum,r) => sum+(fqValue(r.fuelIssued) || 0),0);
  const difference=(a,b,money) => {
    if (!frcHas(a) || !frcHas(b)) return '—'; const delta=Number(a)-Number(b), tolerance=money ? 1 : 0.5;
    return '<span style="font-weight:700;color:'+(Math.abs(delta) <= tolerance ? 'var(--green)' : 'var(--red)')+'">'+(delta > 0 ? '+' : '')+fpNum(delta,money ? 2 : 1)+'</span>';
  };
  const input=(provider,field,value,type) => frcInput(frcMonth,provider,field,value,closed,type);
  const rows=providers.map(provider => {
    const s=by.get(provider) || {litres:0,sum:0,n:0,noSum:0}, r=recon[provider] || {};
    return '<tr><td><b>'+fpEsc(provider)+'</b><div>'+s.n+' операций'+(s.noSum ? ' · без суммы: '+s.noSum : '')+'</div></td><td>'+fpNum(s.litres,1)+'</td><td>'+fpNum(s.sum,2)+(s.noSum ? ' (частично)' : '')+'</td><td>'+input(provider,'litres',r.litres)+'</td><td>'+input(provider,'sum',r.sum)+'</td><td data-frc-difference="'+fpEsc(JSON.stringify([provider,'litres']))+'">'+difference(s.litres,r.litres,false)+'</td><td data-frc-difference="'+fpEsc(JSON.stringify([provider,'sum']))+'">'+(s.noSum ? 'нужны суммы выписки' : difference(s.sum,r.sum,true))+'</td><td>'+input(provider,'note',r.note,'text')+'</td></tr>';
  }).join('');
  const partial=(value,known) => known ? fpNum(value,2)+(known < total.providers ? ' (частично: '+known+'/'+total.providers+')' : '') : 'не внесено';
  return '<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px"><select class="fsel" onchange="frcMonth=this.value;renderFuelPurchases()">'+months.map(month => '<option value="'+month+'"'+(month === frcMonth ? ' selected' : '')+'>'+fpMonthLabel(month)+(fuelMonthClosed(month) ? ' — закрыт' : '')+'</option>').join('')+'</select>'+(closed ? 'Месяц закрыт' : '')+'</div>'+
    '<div id="frcSaveStatus" role="status" aria-live="polite" style="font-size:12px;margin-bottom:12px">'+frcSaveStatusHtml(session)+'</div>'+
    '<div id="frcTotals" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">'+fkCard('Выписки',fpNum(total.statementLitres,1)+' л',fpNum(total.statementMoney,2)+' ₽'+(total.statementMoneyComplete ? '' : ' · стоимость неполная'),'#2563eb')+
    fkCard('Литры 1С',partial(total.litres,total.litresKnown),'Заполнено поставщиков: '+total.litresKnown+' из '+total.providers,total.litresComplete ? '#16a34a' : '#d97706')+
    fkCard('Стоимость 1С',partial(total.money,total.moneyKnown),'Заполнено поставщиков: '+total.moneyKnown+' из '+total.providers,total.moneyComplete ? '#16a34a' : '#d97706')+
    fkCard('Журнал без выписок',fpNum(journal-total.statementLitres,1)+' л','Выдано по журналу: '+fpNum(journal,1)+' л','#64748b')+'</div>'+
    '<div class="table-scroll"><table class="data-table"><thead><tr><th>Поставщик</th><th>Выписка, л</th><th>Выписка, ₽</th><th>1С, л</th><th>1С, ₽</th><th>Разница, л</th><th>Разница, ₽</th><th>Примечание</th></tr></thead><tbody>'+rows+
    '<tr id="frcTotalsRow" style="font-weight:700"><td>Итого</td><td>'+fpNum(total.statementLitres,1)+'</td><td>'+fpNum(total.statementMoney,2)+(total.statementMoneyComplete ? '' : ' (частично)')+'</td><td>'+partial(total.litres,total.litresKnown)+'</td><td>'+partial(total.money,total.moneyKnown)+'</td><td>'+(total.litresComplete ? difference(total.statementLitres,total.litres,false) : 'неполные данные')+'</td><td>'+(total.moneyComplete && total.statementMoneyComplete ? difference(total.statementMoney,total.money,true) : 'неполные данные')+'</td><td></td></tr></tbody></table></div>'+
    '<div style="font-size:12px;color:var(--text3);margin-top:12px">Литры и стоимость проверяются независимо. Пустое поле означает отсутствие данных; введённый ноль учитывается. Общая разница появляется только после заполнения всех поставщиков по соответствующему показателю; для стоимости также нужны суммы всех операций выписки. Допуск: 0,5 л и 1 ₽. Данные 1С пока вносятся вручную.</div>';
}
async function frcPersist(session,entry) {
  let target=null,periods=null,next=null;
  try {
    if (!frcSameSession(session)) throw Error('База или пользователь изменились. Откройте сверку заново.');
    entry.state='saving';frcRefresh(session);
    if (!frcWritable()) throw Error('Нет права изменения месячной сверки или запись заблокирована');
    if (fuelMonthClosed(entry.month)) throw Error('Месяц закрыт. Сначала откройте его с указанием причины.');
    if(typeof unifiedPendingSaves!=='undefined' && unifiedPendingSaves)throw Error('Дождитесь завершения текущего сохранения и повторите правку');
    const expected=entry.predecessor ? entry.predecessor.saved ? {present:true,value:entry.predecessor.value} : entry.predecessor.expected || entry.base : entry.base;
    entry.expected=expected;
    if (JSON.stringify(frcReadValue(entry.month,entry.provider,entry.field))!==JSON.stringify(expected)) throw Error('Показатель уже изменился в базе. Сверьте сохранённое значение и введите правку заново.');
    if (expected.present && expected.value===entry.value) { entry.saved=true;entry.state='saved';if(session.drafts.get(entry.key)===entry)session.drafts.delete(entry.key);return true; }
    periods=data.fuelPeriods || [];
    const matches=periods.filter(row=>row.month===entry.month);if(matches.length>1)throw Error('За месяц найдено несколько строк сверки. Сначала проверьте дубли.');
    const old=matches[0],period=old ? JSON.parse(JSON.stringify(old)) : {month:entry.month,history:[]};
    const object=value=>value && typeof value==='object' && !Array.isArray(value);
    if (period.recon!=null && !object(period.recon)) throw Error('Повреждена структура месячной сверки. Требуется проверка исходной записи.');
    const recon=period.recon || {},values=Object.prototype.hasOwnProperty.call(recon,entry.provider) ? recon[entry.provider] : {};
    if(!object(values))throw Error('Повреждены показатели поставщика. Требуется проверка исходной записи.');
    period.recon={...recon,[entry.provider]:{...values,[entry.field]:entry.value}};
    next=old ? periods.map(row=>row===old ? period : row) : [...periods,period];
    target=data;target.fuelPeriods=next;
    const saved=await saveData(target,{noMerge:true});
    if (!frcSameSession(session)) throw Error('База или пользователь изменились во время сохранения. Проверьте результат в исходной базе.');
    if (saved!==true) throw Error('Запись не подтверждена. Проверьте подключение и повторите сохранение.');
    entry.saved=true;entry.state='saved';session.lastSaved=true;
    if(session.drafts.get(entry.key)===entry)session.drafts.delete(entry.key);
    return true;
  } catch(error) {
    if(frcSameSession(session) && target===data && data.fuelPeriods===next){data.fuelPeriods=periods;rebuildIndex();}
    entry.state='failed';entry.error=error.message;return false;
  } finally {session.pending--;frcRefresh(session,entry.saved ? entry : null);}
}
function frcQueue(session,entry) {
  session.drafts.set(entry.key,entry);session.pending++;session.lastSaved=false;
  const pending=session.chain.then(()=>frcPersist(session,entry));session.chain=pending.catch(()=>false);frcRefresh(session);return pending;
}
async function frcSet(month,provider,field,value,expectedStamp) {
  if(expectedStamp!==undefined && expectedStamp!==frcContextStamp()){showToast('База или пользователь изменились. Откройте сверку заново.');return false;}
  if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||typeof provider!=='string'||!provider.trim()||['__proto__','prototype','constructor'].includes(provider)||!['litres','sum','note'].includes(field))return false;
  const text=String(value??''),empty=text.trim()==='';
  if(field!=='note' && !empty && !Number.isFinite(Number(text))){showToast('Укажите число или оставьте поле пустым');return false;}
  const session=frcSession(),key=frcDraftKey(month,provider,field),previous=session.drafts.get(key),predecessor=previous && ['queued','saving'].includes(previous.state) ? previous : null;
  const entry={key,month,provider,field,text,value:field==='note' ? text.trim() : empty ? '' : Number(text),base:predecessor ? predecessor.base : frcReadValue(month,provider,field),predecessor,state:'queued',saved:false,error:''};
  return frcQueue(session,entry);
}
async function frcRetry(expectedStamp) {
  if(expectedStamp!==undefined && expectedStamp!==frcContextStamp())return false;
  const session=frcSession(),failed=[...session.drafts.values()].filter(entry=>entry.state==='failed');if(session.pending)return false;
  const results=await Promise.all(failed.map(old=>frcQueue(session,{...old,base:old.expected || old.base,predecessor:null,state:'queued',saved:false,error:''})));
  return frcSameSession(session) && results.every(Boolean);
}
function frcHasPendingEdits() {
  const session=frcSession(),input=document.activeElement;
  const invalid=[...document.querySelectorAll('[data-frc-field]')].some(field=>field.dataset.frcStamp===session.stamp && field.validity?.badInput);
  return session.pending>0 || session.drafts.size>0 || invalid || !!(input?.matches?.('[data-frc-field]') && input.dataset.frcStamp===session.stamp && input.value!==input.dataset.frcRendered);
}
async function frcFlush() {
  const session=frcSession(),input=document.activeElement;
  const invalid=[...document.querySelectorAll('[data-frc-field]')].find(field=>field.dataset.frcStamp===session.stamp && field.validity?.badInput);
  if(invalid){invalid.focus();showToast('Завершите ввод числа в сверке');return false;}
  if(input?.matches?.('[data-frc-field]') && input.value!==input.dataset.frcRendered){
    if(input.dataset.frcStamp!==session.stamp)return false;
    const {frcMonth:month,frcProvider:provider,frcField:field}=input.dataset,text=input.value;
    input.blur();
    const captured=session.drafts.get(frcDraftKey(month,provider,field));
    if(frcSameSession(session) && (!captured || captured.text!==text) && await frcSet(month,provider,field,text,session.stamp)!==true)return false;
  }
  await session.chain;
  return frcSameSession(session) && session.pending===0 && session.drafts.size===0;
}
async function frcDiscard(expectedStamp) {
  if(expectedStamp!==undefined && expectedStamp!==frcContextStamp())return false;
  const session=frcSession();if(session.pending)return false;
  if(!await confirmAction('Отменить несохранённые значения сверки? В полях будут показаны данные из базы.'))return false;
  if(!frcSameSession(session))return false;
  session.drafts.clear();session.lastSaved=false;
  if(typeof activeSection!=='undefined' && activeSection==='fuelPurchases' && fpView==='recon')renderFuelPurchases();
  return true;
}
