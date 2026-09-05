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
    fuelIssued: parseFloat(document.getElementById('rec_fuel_issued').value) || null,
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
function openGenericModal(title, bodyHtml, width) {
  let el = document.getElementById('genericModal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'genericModal';
    el.className = 'modal';
    el.innerHTML = `<div class="modal-overlay" onclick="closeModal('genericModal')"></div>
      <div class="modal-content" style="max-width:${width||600}px;max-height:85vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 id="genericModalTitle" style="margin:0;font-size:18px;font-weight:700"></h3>
          <button onclick="closeModal('genericModal')" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text3)">✕</button>
        </div>
        <div id="genericModalBody"></div>
      </div>`;
    document.body.appendChild(el);
  }
  el.querySelector('.modal-content').style.maxWidth = (width||600) + 'px';
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

