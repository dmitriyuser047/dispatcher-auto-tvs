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

function saveRecord() {
  const dateRaw = document.getElementById('rec_date').value.trim();
  const date = parseDate(dateRaw);
  const km = parseFloat(document.getElementById('rec_km').value);
  if (!date) { showFieldError('Укажите дату в формате ДД.ММ.ГГГГ', 'rec_date'); return; }
  if (!km && km !== 0) { showFieldError('Укажите пробег за день', 'rec_km'); return; }
  const obj = {
    vehicleId: selectedVehicleId,
    date,
    km,
    kmGlonass: parseFloat(document.getElementById('rec_km_glonass').value) || null,
    odoStart: parseFloat(document.getElementById('rec_odo_start').value) || null,
    odoEnd: parseFloat(document.getElementById('rec_odo_end').value) || null,
    driver: document.getElementById('rec_driver').value.trim() || null,
    fuelGrade: document.getElementById('rec_fuel_grade').value === 'Бензин' ? '' : document.getElementById('rec_fuel_grade').value,
    fuelIssued: parseFloat(document.getElementById('rec_fuel_issued').value) || null,
    fuelSum:    parseFloat(document.getElementById('rec_fuel_sum').value)    || null,
    fuelUsed:   parseFloat(document.getElementById('rec_fuel_used').value)   || null,
    fuelActual: parseFloat(document.getElementById('rec_fuel_actual').value) || null,
    fuelIdle:   parseFloat(document.getElementById('rec_fuel_idle').value)   || null,
    route: routeGet(),
    note: document.getElementById('rec_note').value.trim(),
  };
  if (editingRecordId) {
    const r = data.records.find(x => x.id === editingRecordId);
    Object.assign(r, obj);
  } else {
    obj.id = 'r_' + Date.now();
    data.records.push(obj);
  }
  // update selected month to record's month
  const d = new Date(date);
  selectedYear = d.getFullYear();
  selectedMonth = d.getMonth() + 1;
  saveData(data);
  closeModal('recordModal');
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
}

function deleteRecord(id) {
  if (!confirm('Удалить эту запись?')) return;
  data.records = data.records.filter(r => r.id !== id);
  saveData(data);
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
}

// ─── MODALS ──────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'paymentModal' && typeof closePayCategoryDrop === 'function') closePayCategoryDrop();
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
    el.addEventListener('click', e => { if (e.target === el) closeModal('genericModal'); });
    document.body.appendChild(el);
  }
  el.querySelector('.modal').style.maxWidth = (width || 600) + 'px';
  document.getElementById('genericModalTitle').textContent = title;
  document.getElementById('genericModalBody').innerHTML = bodyHtml;
  openModal('genericModal');
}

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(el => closeModal(el.id));
});

