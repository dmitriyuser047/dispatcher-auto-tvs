// График ТО транспорта
// Выделено из index.html

// ═══════════════════════════════════════════════════════
// ГРАФИК ТО (ТРАНСПОРТ)
// ═══════════════════════════════════════════════════════
function renderVehicleToSection(vid, currentOdometer) {
  const recs = vehicleToFor(vid).slice().sort((a, b) => cmpDateAsc(a.date, b.date));
  const last = recs[recs.length - 1];

  let statusHtml = '';
  if (last) {
    const cards = [];
    if (last.nextOdometerAbs != null) {
      const diff = last.nextOdometerAbs - currentOdometer;
      const clr = diff <= 0 ? 'var(--red)' : diff <= 1000 ? 'var(--yellow)' : 'var(--green)';
      const bgClr = diff <= 0 ? '#fee2e2' : diff <= 1000 ? '#fef3c7' : '#dcfce7';
      const label = diff <= 0 ? 'Просрочено' : 'До след. ТО';
      const val = diff <= 0 ? Math.abs(diff) : diff;
      cards.push(`<div style="flex:1;min-width:160px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid ${clr}">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">${label}</div>
        <div style="font-size:22px;font-weight:700;color:${clr}">${val.toLocaleString('ru',{maximumFractionDigits:0})} <span style="font-size:13px;font-weight:500">км</span></div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">След. ТО: ${last.nextOdometerAbs.toLocaleString('ru',{maximumFractionDigits:0})} км</div>
      </div>`);
    }
    if (last.nextDate) {
      const nd = new Date(last.nextDate);
      const today = new Date(); today.setHours(0,0,0,0);
      const daysLeft = Math.ceil((nd - today) / 86400000);
      const clr = daysLeft <= 0 ? 'var(--red)' : daysLeft <= 14 ? 'var(--yellow)' : 'var(--green)';
      const label = daysLeft <= 0 ? 'Дата просрочена' : 'До след. ТО';
      const val = daysLeft <= 0 ? Math.abs(daysLeft) : daysLeft;
      const unit = daysLeft <= 0 ? 'дн. назад' : 'дн.';
      cards.push(`<div style="flex:1;min-width:160px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid ${clr}">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">${label}</div>
        <div style="font-size:22px;font-weight:700;color:${clr}">${val} <span style="font-size:13px;font-weight:500">${unit}</span></div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">Дата: ${fmtDate(last.nextDate)}</div>
      </div>`);
    }
    cards.push(`<div style="flex:1;min-width:160px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid var(--accent)">
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Текущий пробег</div>
      <div style="font-size:22px;font-weight:700">${currentOdometer.toLocaleString('ru',{maximumFractionDigits:0})} <span style="font-size:13px;font-weight:500">км</span></div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px">Последнее ТО: ${fmtDate(last.date)}</div>
    </div>`);
    if (last.cost != null) {
      cards.push(`<div style="flex:1;min-width:160px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid var(--text3)">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Стоимость</div>
        <div style="font-size:22px;font-weight:700">${last.cost.toLocaleString('ru-RU')} <span style="font-size:13px;font-weight:500">₽</span></div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${last.type || 'Последнее ТО'}</div>
      </div>`);
    }
    statusHtml = `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px">${cards.join('')}</div>`;
  }

  let rows = '';
  if (!recs.length) {
    rows = `<tr><td colspan="8" class="empty-table">Нет записей ТО. Нажмите «+ ТО» чтобы добавить.</td></tr>`;
  } else {
    [...recs].reverse().forEach(r => {
      rows += `<tr>
        <td class="td-day">${fmtDate(r.date)}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:600">${r.type || '—'}</td>
        <td class="td-num">${r.odometer != null ? r.odometer.toLocaleString('ru', {maximumFractionDigits:0}) : '—'}</td>
        <td class="td-num">${r.nextOdometerAbs != null ? r.nextOdometerAbs.toLocaleString('ru', {maximumFractionDigits:0}) : (r.nextKm ? '+'+r.nextKm.toLocaleString('ru')+' км' : '—')}</td>
        <td class="td-day">${r.nextDate ? fmtDate(r.nextDate) : '—'}</td>
        <td class="td-num">${r.cost != null ? r.cost.toLocaleString('ru-RU') + ' ₽' : '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2)">${r.performer || '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:var(--text2)">${r.note || '—'}</td>
        <td class="td-actions">
          <button class="icon-btn" onclick="openEditVehicleTo('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del" onclick="deleteVehicleTo('${r.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`;
    });
  }

  return `<div class="table-wrap" style="margin-top:24px">
    <div class="table-toolbar">
      <div class="table-toolbar-left">
        <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:var(--accent)"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
        График ТО
        <span style="color:var(--text3);font-weight:400;font-size:12px;margin-left:10px">${recs.length} записей</span>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openAddVehicleTo('${vid}')">
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        + ТО
      </button>
    </div>
    ${statusHtml}
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Дата</th><th>Вид ТО</th><th>Пробег, км</th><th>След. ТО (км)</th>
          <th>Дата след. ТО</th><th>Стоимость</th><th>Исполнитель</th><th>Примечание</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function openAddVehicleTo(vid) {
  editingVehicleToId = null;
  document.getElementById('vehicleToModalTitle').textContent = 'Добавить запись ТО';
  document.getElementById('vehicleToDeleteBtn').style.display = 'none';
  const now = new Date();
  document.getElementById('vto_date').value = fmtDate(now.toISOString().split('T')[0]);
  ['vto_type','vto_next_date','vto_performer','vto_note'].forEach(id => document.getElementById(id).value = '');
  ['vto_odometer','vto_next_km','vto_cost'].forEach(id => document.getElementById(id).value = '');
  const v = data.vehicles.find(x => x.id === vid);
  if (v) {
    const totalKm = recsFor(vid).reduce((s, r) => s + (r.km || 0), 0);
    const curOdo = (v.odometer || 0) + totalKm;
    if (curOdo > 0) document.getElementById('vto_odometer').value = Math.round(curOdo);
    const last = vehicleToFor(vid).slice().sort((a,b) => cmpDateAsc(a.date, b.date)).pop();
    if (last && last.nextKm) document.getElementById('vto_next_km').value = last.nextKm;
  }
  document.getElementById('vehicleToModal').dataset.vid = vid;
  openModal('vehicleToModal');
}

function openEditVehicleTo(id) {
  const r = (data.vehicleTo || []).find(x => x.id === id);
  if (!r) return;
  editingVehicleToId = id;
  document.getElementById('vehicleToModalTitle').textContent = 'Редактировать запись ТО';
  document.getElementById('vehicleToDeleteBtn').style.display = '';
  document.getElementById('vto_date').value       = fmtDate(r.date);
  document.getElementById('vto_type').value       = r.type        || '';
  document.getElementById('vto_odometer').value   = r.odometer    ?? '';
  document.getElementById('vto_next_km').value    = r.nextKm      ?? '';
  document.getElementById('vto_next_date').value  = r.nextDate    ? fmtDate(r.nextDate) : '';
  document.getElementById('vto_cost').value       = r.cost        ?? '';
  document.getElementById('vto_performer').value  = r.performer   || '';
  document.getElementById('vto_note').value       = r.note        || '';
  document.getElementById('vehicleToModal').dataset.vid = r.vehicleId;
  openModal('vehicleToModal');
}

function saveVehicleTo() {
  const dateIso = parseDate(document.getElementById('vto_date').value.trim());
  const type    = document.getElementById('vto_type').value.trim();
  if (!dateIso) { showFieldError('Укажите дату проведения ТО', 'vto_date'); return; }
  if (!type)    { showFieldError('Укажите вид ТО', 'vto_type'); return; }
  const nextKm      = parseFloat(document.getElementById('vto_next_km').value);
  const odometer    = parseFloat(document.getElementById('vto_odometer').value);
  const nextDate    = parseDate(document.getElementById('vto_next_date').value.trim()) || null;
  const hasNextKm   = !isNaN(nextKm);
  const hasOdometer = !isNaN(odometer);
  const nextOdometerAbs = hasOdometer && hasNextKm ? Math.round(odometer + nextKm) : null;
  const obj = {
    vehicleId:  document.getElementById('vehicleToModal').dataset.vid,
    date:       dateIso,
    type,
    odometer:   hasOdometer ? odometer : null,
    nextKm:     hasNextKm ? nextKm : null,
    nextOdometerAbs,
    nextDate,
    cost:       parseFloat(document.getElementById('vto_cost').value) || null,
    performer:  document.getElementById('vto_performer').value.trim(),
    note:       document.getElementById('vto_note').value.trim(),
  };
  if (!data.vehicleTo) data.vehicleTo = [];
  if (editingVehicleToId) {
    Object.assign(data.vehicleTo.find(x => x.id === editingVehicleToId), obj);
  } else {
    obj.id = 'vto_' + Date.now();
    data.vehicleTo.push(obj);
  }
  saveData(data);
  closeModal('vehicleToModal');
  const v = data.vehicles.find(x => x.id === obj.vehicleId);
  if (v) renderDetail(v);
}

function deleteVehicleTo(id) {
  if (!confirm('Удалить эту запись ТО?')) return;
  data.vehicleTo = (data.vehicleTo || []).filter(r => r.id !== id);
  saveData(data);
  closeModal('vehicleToModal');
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
}

