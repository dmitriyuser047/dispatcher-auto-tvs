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
  const months=[...new Set([...fpMonthsList(),...fpCmpMonths(),...fuelPeriods().filter(period => period.recon).map(period => period.month)])].sort().reverse();
  if (!frcMonth || !months.includes(frcMonth)) frcMonth=months[0] || '';
  if (!frcMonth) return '<div class="welcome"><p>Нет данных</p></div>';
  const recon=(fuelPeriod(frcMonth) || {}).recon || {}, closed=fuelMonthClosed(frcMonth), by=frcData(frcMonth), providers=[...new Set([...by.keys(),...Object.keys(recon)])].sort((a,b) => a.localeCompare(b,'ru'));
  const total=frcCompleteness(frcMonth), journal=(data.records || []).filter(r => String(r.date || '').startsWith(frcMonth)).reduce((sum,r) => sum+(fqValue(r.fuelIssued) || 0),0);
  const difference=(a,b,money) => {
    if (!frcHas(a) || !frcHas(b)) return '—'; const delta=Number(a)-Number(b), tolerance=money ? 1 : 0.5;
    return '<span style="font-weight:700;color:'+(Math.abs(delta) <= tolerance ? 'var(--green)' : 'var(--red)')+'">'+(delta > 0 ? '+' : '')+fpNum(delta,money ? 2 : 1)+'</span>';
  };
  const input=(provider,field,value) => '<input type="number" step="0.01" value="'+(frcHas(value) ? value : '')+'" '+(closed ? 'disabled' : '')+' style="width:115px;text-align:right" onchange="frcSet('+fpEsc(JSON.stringify(frcMonth))+','+fpEsc(JSON.stringify(provider))+',\''+field+'\',this.value)">';
  const rows=providers.map(provider => {
    const s=by.get(provider) || {litres:0,sum:0,n:0,noSum:0}, r=recon[provider] || {};
    return '<tr><td><b>'+fpEsc(provider)+'</b><div>'+s.n+' операций'+(s.noSum ? ' · без суммы: '+s.noSum : '')+'</div></td><td>'+fpNum(s.litres,1)+'</td><td>'+fpNum(s.sum,2)+(s.noSum ? ' (частично)' : '')+'</td><td>'+input(provider,'litres',r.litres)+'</td><td>'+input(provider,'sum',r.sum)+'</td><td>'+difference(s.litres,r.litres,false)+'</td><td>'+(s.noSum ? 'нужны суммы выписки' : difference(s.sum,r.sum,true))+'</td><td><input type="text" value="'+fpEsc(r.note || '')+'" '+(closed ? 'disabled' : '')+' onchange="frcSet('+fpEsc(JSON.stringify(frcMonth))+','+fpEsc(JSON.stringify(provider))+',\'note\',this.value)"></td></tr>';
  }).join('');
  const partial=(value,known) => known ? fpNum(value,2)+(known < total.providers ? ' (частично: '+known+'/'+total.providers+')' : '') : 'не внесено';
  return '<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px"><select class="fsel" onchange="frcMonth=this.value;renderFuelPurchases()">'+months.map(month => '<option value="'+month+'"'+(month === frcMonth ? ' selected' : '')+'>'+fpMonthLabel(month)+(fuelMonthClosed(month) ? ' — закрыт' : '')+'</option>').join('')+'</select>'+(closed ? 'Месяц закрыт' : '')+'</div>'+
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">'+fkCard('Выписки',fpNum(total.statementLitres,1)+' л',fpNum(total.statementMoney,2)+' ₽'+(total.statementMoneyComplete ? '' : ' · стоимость неполная'),'#2563eb')+
    fkCard('Литры 1С',partial(total.litres,total.litresKnown),'Заполнено поставщиков: '+total.litresKnown+' из '+total.providers,total.litresComplete ? '#16a34a' : '#d97706')+
    fkCard('Стоимость 1С',partial(total.money,total.moneyKnown),'Заполнено поставщиков: '+total.moneyKnown+' из '+total.providers,total.moneyComplete ? '#16a34a' : '#d97706')+
    fkCard('Журнал без выписок',fpNum(journal-total.statementLitres,1)+' л','Выдано по журналу: '+fpNum(journal,1)+' л','#64748b')+'</div>'+
    '<div class="table-scroll"><table class="data-table"><thead><tr><th>Поставщик</th><th>Выписка, л</th><th>Выписка, ₽</th><th>1С, л</th><th>1С, ₽</th><th>Разница, л</th><th>Разница, ₽</th><th>Примечание</th></tr></thead><tbody>'+rows+
    '<tr style="font-weight:700"><td>Итого</td><td>'+fpNum(total.statementLitres,1)+'</td><td>'+fpNum(total.statementMoney,2)+(total.statementMoneyComplete ? '' : ' (частично)')+'</td><td>'+partial(total.litres,total.litresKnown)+'</td><td>'+partial(total.money,total.moneyKnown)+'</td><td>'+(total.litresComplete ? difference(total.statementLitres,total.litres,false) : 'неполные данные')+'</td><td>'+(total.moneyComplete && total.statementMoneyComplete ? difference(total.statementMoney,total.money,true) : 'неполные данные')+'</td><td></td></tr></tbody></table></div>'+
    '<div style="font-size:12px;color:var(--text3);margin-top:12px">Литры и стоимость проверяются независимо. Пустое поле означает отсутствие данных; введённый ноль учитывается. Общая разница появляется только после заполнения всех поставщиков по соответствующему показателю; для стоимости также нужны суммы всех операций выписки. Допуск: 0,5 л и 1 ₽. Данные 1С пока вносятся вручную.</div>';
}
let _frcSaveTimer=null;
function frcSet(month,provider,field,value) {
  if (fuelMonthClosed(month) || !['litres','sum','note'].includes(field)) return;
  if (field !== 'note' && value !== '' && fqValue(value) == null) { showToast('Укажите число или оставьте поле пустым'); return; }
  let period=fuelPeriod(month); if (!period) { period={month,history:[]}; fuelPeriods().push(period); }
  const values=(period.recon || (period.recon={}))[provider] || (period.recon[provider]={});
  values[field]=field === 'note' ? String(value || '').trim() : value === '' ? '' : Number(value);
  clearTimeout(_frcSaveTimer);
  _frcSaveTimer=setTimeout(async () => { const saved=await saveData(data,{noMerge:true}); if (saved) renderFuelPurchases(); },300);
}
