// Уведомления (toast), ошибки полей, модальные окна
// Выделено из index.html

// ─── TOAST / FIELD ERROR ─────────────────────────────────
function showToast(msg) {
  let el = document.getElementById('globalToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalToast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

function showFieldError(msg, fieldId) {
  showToast(msg);
  if (fieldId) {
    const el = document.getElementById(fieldId);
    if (el) {
      el.classList.add('field-error');
      setTimeout(() => el.classList.remove('field-error'), 2500);
      setTimeout(() => el.focus(), 50);
    }
  }
}

let recordEditingState = null;
function recordFormFields() {
  const map = { date:'rec_date', km:'rec_km', kmGlonass:'rec_km_glonass', odoStart:'rec_odo_start', odoEnd:'rec_odo_end', driver:'rec_driver', fuelGrade:'rec_fuel_grade',
    fuelIssued:'rec_fuel_issued', fuelSum:'rec_fuel_sum', fuelUsed:'rec_fuel_used', fuelActual:'rec_fuel_actual', fuelIdle:'rec_fuel_idle', tankMeasured:'rec_tank_measured', fuelCardNum:'rec_fuel_card', note:'rec_note' };
  const text = new Set(['date','driver','fuelGrade','fuelCardNum','note']);
  const fields = Object.fromEntries(Object.entries(map).map(([key, id]) => [key, text.has(key) ? document.getElementById(id).value.trim() : optionalNumber(id)]));
  fields.route = routeGet(); return fields;
}

async function saveRecord() {
  const dateRaw = document.getElementById('rec_date').value.trim();
  const date = parseDate(dateRaw);
  const km = parseFloat(document.getElementById('rec_km').value);
  const _old = editingRecordId && data.records.find(x => x.id === editingRecordId);
  if (!date) { showFieldError('Укажите дату в формате ДД.ММ.ГГГГ', 'rec_date'); return; }
  if (!Number.isFinite(km) || km < 0) { showFieldError('Укажите неотрицательный пробег за день', 'rec_km'); return; }
  if (!validNonnegativeFields(['rec_km_glonass','rec_odo_start','rec_odo_end','rec_fuel_issued','rec_fuel_sum','rec_fuel_used','rec_fuel_actual','rec_fuel_idle','rec_tank_measured'])) return;
  const start = optionalNumber('rec_odo_start'), end = optionalNumber('rec_odo_end');
  if (start != null && end != null && (end < start || Math.abs(end - start - km) > 0.11) &&
      (!_old || _old.km !== km || _old.odoStart !== start || _old.odoEnd !== end)) { showFieldError('Пробег не совпадает с разницей одометра', 'rec_odo_end'); return; }
  if (typeof fuelEditAllowed === 'function' && !fuelEditAllowed(date, _old && _old.date)) return;
  let obj = {
    vehicleId: selectedVehicleId,
    date,
    km,
    kmGlonass: parseFloat(document.getElementById('rec_km_glonass').value) || null,
    odoStart: start,
    odoEnd: end,
    driver: document.getElementById('rec_driver').value.trim() || null,
    fuelGrade: document.getElementById('rec_fuel_grade').value === 'Бензин' ? '' : document.getElementById('rec_fuel_grade').value,
    fuelIssued: parseFloat(document.getElementById('rec_fuel_issued').value) || null,
    fuelSum:    parseFloat(document.getElementById('rec_fuel_sum').value)    || null,
    fuelUsed:   optionalNumber('rec_fuel_used'),
    fuelActual: document.getElementById('rec_fuel_actual').value.trim() === '' ? null : parseFloat(document.getElementById('rec_fuel_actual').value),
    fuelIdle:   parseFloat(document.getElementById('rec_fuel_idle').value)   || null,
    tankMeasured: document.getElementById('rec_tank_measured').value.trim() === '' ? null : parseFloat(document.getElementById('rec_tank_measured').value),
    fuelCardNum: document.getElementById('rec_fuel_card').value || null,
    route: routeGet(),
    note: document.getElementById('rec_note').value.trim(),
  };
  if (_old && recordEditingState && recordEditingState.id === editingRecordId) {
    const fields = recordFormFields(), changes = {};
    for (const key of Object.keys(fields)) {
      if (JSON.stringify(fields[key]) === JSON.stringify(recordEditingState.fields[key])) continue;
      if (JSON.stringify(_old[key]) !== JSON.stringify(recordEditingState.base[key]) && JSON.stringify(obj[key]) !== JSON.stringify(_old[key])) {
        showToast('Это поле уже изменено другим пользователем. Откройте запись заново и сверьте изменения.'); return;
      }
      changes[key] = obj[key];
    }
    obj = { ..._old, ...changes };
  }
  if (typeof gsmCardAt === 'function' && (!_old || _old.fuelCardNum !== obj.fuelCardNum || _old.date !== obj.date)) {
    const owner = gsmCardAt(data, obj.fuelCardNum, obj.date);
    obj.fuelOrg = owner.org || (!obj.fuelCardNum ? ((data.vehicles || []).find(v => v.id === obj.vehicleId) || {}).org : '') || '';
    obj.fuelProvider = owner.provider || '';
  }
  const before = JSON.stringify(data);
  if (editingRecordId) {
    const r = data.records.find(x => x.id === editingRecordId);
    if (!r) { showToast('Запись уже удалена. Откройте журнал заново.'); return; }
    Object.assign(r, obj);
  } else {
    obj.id = 'r_' + Date.now();
    data.records.push(obj);
  }
  // update selected month to record's month
  const d = new Date(date);
  selectedYear = d.getFullYear();
  selectedMonth = d.getMonth() + 1;
  if (!await saveData(data)) { data = JSON.parse(before); rebuildIndex(); return; }
  closeModal('recordModal');
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (typeof activeSection !== 'undefined' && activeSection === 'fuelPurchases') renderFuelPurchases();
  else if (v) renderDetail(v);
}

async function deleteRecord(id) {
  const _r = data.records.find(x => x.id === id);
  if (_r && typeof fuelEditAllowed === 'function' && !fuelEditAllowed(_r.date)) return;
  if (!await confirmAction('Удалить эту запись?')) return;
  const before = JSON.stringify(data);
  data.records = data.records.filter(r => r.id !== id);
  if (!await saveData(data)) { data = JSON.parse(before); rebuildIndex(); return; }
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
}

function recToggleAll(master) {
  document.querySelectorAll('.rec-check').forEach(cb => { cb.checked = master.checked; });
  recUpdateToolbar();
}

function recUpdateToolbar() {
  const checked = document.querySelectorAll('.rec-check:checked');
  const tb = document.getElementById('rec-toolbar');
  const cnt = document.getElementById('rec-sel-count');
  if (tb) tb.style.display = checked.length ? '' : 'none';
  if (cnt) cnt.textContent = checked.length;
}

async function recDeleteSelected() {
  const ids = [...document.querySelectorAll('.rec-check:checked')].map(cb => cb.dataset.recid);
  if (!ids.length) return;
  if (!fuelEditAllowed(...data.records.filter(r => ids.includes(r.id)).map(r => r.date))) return;
  if (!await confirmAction('Удалить выбранные записи (' + ids.length + ')?')) return;
  const before = JSON.stringify(data);
  data.records = data.records.filter(r => !ids.includes(r.id));
  if (!await saveData(data)) { data = JSON.parse(before); rebuildIndex(); return; }
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
}

// ─── MODALS ──────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'confirmModal' && _confirmResolve) { const resolve = _confirmResolve; _confirmResolve = null; resolve(false); }
  if (id === 'paymentModal' && typeof closePayCategoryDrop === 'function') closePayCategoryDrop();
}
let _confirmResolve = null;
function confirmAction(message) {
  if (_confirmResolve) return Promise.resolve(false);
  let el = document.getElementById('confirmModal');
  if (!el) {
    el = document.createElement('div'); el.id = 'confirmModal'; el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirmMessage" style="max-width:440px"><div class="modal-body" id="confirmMessage"></div><div class="modal-footer"><button class="btn btn-ghost" id="confirmNo">Отмена</button><button class="btn btn-danger" id="confirmYes">Удалить</button></div></div>';
    document.body.append(el); bindModalOverlay(el);
  }
  el.style.zIndex = '10050';
  document.getElementById('confirmMessage').textContent = message;
  const previous = document.activeElement;
  return new Promise(resolve => {
    _confirmResolve = answer => { resolve(answer); if (previous && previous.isConnected) previous.focus(); };
    document.getElementById('confirmNo').onclick = () => closeModal('confirmModal');
    document.getElementById('confirmYes').onclick = () => { const done = _confirmResolve; _confirmResolve = null; closeModal('confirmModal'); done(true); };
    openModal('confirmModal'); document.getElementById('confirmNo').focus();
  });
}
function bindModalOverlay(el) {
  el.addEventListener('pointerdown', e => { el._backdropDown = e.target === el; });
  el.addEventListener('click', e => {
    const close = el._backdropDown && e.target === el; el._backdropDown = false;
    if (close) closeModal(el.id);
  });
}
// Окно для разовых форм. Разметка как у остальных окон: подложка
// .modal-overlay, внутри .modal — иначе класс open ничего не показывает
// и не скрывает.
function openGenericModal(title, bodyHtml, width) {
  let el = document.getElementById('genericModal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'genericModal';
    el.className = 'modal-overlay';
    el.innerHTML = `<div class="modal" style="max-height:85vh;overflow-y:auto">
        <div class="modal-header">
          <div class="modal-title" id="genericModalTitle"></div>
          <button class="icon-btn" onclick="closeModal('genericModal')">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" id="genericModalBody"></div>
      </div>`;
    bindModalOverlay(el);
    document.body.appendChild(el);
  }
  el.querySelector('.modal').style.maxWidth = (width || 600) + 'px';
  document.getElementById('genericModalTitle').textContent = title;
  document.getElementById('genericModalBody').innerHTML = bodyHtml;
  openModal('genericModal');
}

document.querySelectorAll('.modal-overlay').forEach(bindModalOverlay);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (_confirmResolve) closeModal('confirmModal');
    else document.querySelectorAll('.modal-overlay.open').forEach(el => closeModal(el.id));
  }
});

