// Добавление/изменение ТС и записей заправок
// Выделено из index.html

// ─── VEHICLE CRUD ────────────────────────────────────────
function openAddVehicle() {
  editingVehicleId = null;
  document.getElementById('vehicleModalTitle').textContent = 'Добавить транспортное средство';
  ['vm_make','vm_plate','vm_driver','vm_org','vm_object','vm_responsible','vm_fuelcard','vm_status','vm_justification','vm_note','vm_fuel_grade'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('vm_fuel').value = 'diesel';
  document.getElementById('vm_supplier').value = '';
  document.getElementById('vm_norm').value = '';
  document.getElementById('vm_norm_city').value = '';
  document.getElementById('vm_norm_highway').value = '';
  document.getElementById('vm_norm_idle').value = '';
  document.getElementById('vm_odometer').value = '';
  document.getElementById('vm_fuel_balance').value = '';
  openModal('vehicleModal');
}

function openEditVehicle(id) {
  const v = data.vehicles.find(x => x.id === id);
  if (!v) return;
  editingVehicleId = id;
  document.getElementById('vehicleModalTitle').textContent = 'Редактировать ТС';
  document.getElementById('vm_make').value = v.make || '';
  document.getElementById('vm_plate').value = v.plate || '';
  document.getElementById('vm_driver').value = v.driver || '';
  document.getElementById('vm_org').value = v.org || '';
  document.getElementById('vm_object').value = v.object || '';
  document.getElementById('vm_fuel').value = v.fuel || 'diesel';
  document.getElementById('vm_fuel_grade').value = v.fuelGrade || '';
  document.getElementById('vm_supplier').value = v.supplier || '';
  document.getElementById('vm_norm').value = v.norm || '';
  document.getElementById('vm_norm_city').value = v.normCity ?? '';
  document.getElementById('vm_norm_highway').value = v.normHighway ?? '';
  document.getElementById('vm_norm_idle').value = v.normIdle || '';
  document.getElementById('vm_odometer').value = v.odometer || '';
  document.getElementById('vm_fuel_balance').value = v.fuelBalance ?? '';
  document.getElementById('vm_responsible').value = v.responsible || '';
  document.getElementById('vm_fuelcard').value = v.fuelcard || '';
  document.getElementById('vm_status').value = v.status || '';
  document.getElementById('vm_justification').value = v.justification || '';
  document.getElementById('vm_note').value = v.note || '';
  openModal('vehicleModal');
}

function saveVehicle() {
  const make = document.getElementById('vm_make').value.trim();
  const plate = document.getElementById('vm_plate').value.trim();
  const driver = document.getElementById('vm_driver').value.trim();
  if (!make || !plate || !driver) {
    showFieldError('Заполните обязательные поля: Марка, Госномер, ФИО водителя',
      !make ? 'vm_make' : !plate ? 'vm_plate' : 'vm_driver');
    return;
  }
  const obj = {
    make, plate, driver,
    org: document.getElementById('vm_org').value.trim(),
    object: document.getElementById('vm_object').value.trim(),
    fuel: document.getElementById('vm_fuel').value,
    fuelGrade: document.getElementById('vm_fuel_grade').value.trim(),
    supplier: document.getElementById('vm_supplier').value,
    norm: parseFloat(document.getElementById('vm_norm').value) || null,
    normCity: parseFloat(document.getElementById('vm_norm_city').value) || null,
    normHighway: parseFloat(document.getElementById('vm_norm_highway').value) || null,
    normIdle: parseFloat(document.getElementById('vm_norm_idle').value) || null,
    odometer: parseFloat(document.getElementById('vm_odometer').value) || null,
    fuelBalance: parseFloat(document.getElementById('vm_fuel_balance').value) || 0,
    responsible: document.getElementById('vm_responsible').value.trim(),
    fuelcard: document.getElementById('vm_fuelcard').value.trim(),
    status: document.getElementById('vm_status').value.trim(),
    justification: document.getElementById('vm_justification').value.trim(),
    note: document.getElementById('vm_note').value.trim(),
  };
  if (editingVehicleId) {
    const v = data.vehicles.find(x => x.id === editingVehicleId);
    Object.assign(v, obj);
  } else {
    obj.id = 'v_' + Date.now();
    data.vehicles.push(obj);
    selectedVehicleId = obj.id;
  }
  saveData(data);
  closeModal('vehicleModal');
  populateOrgSelect();
  renderVehicleList();
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
}

function deleteVehicle(id) {
  if (!confirm('Удалить это ТС и все его записи?')) return;
  data.vehicles = data.vehicles.filter(v => v.id !== id);
  data.records = data.records.filter(r => r.vehicleId !== id);
  saveData(data);
  selectedVehicleId = null;
  populateOrgSelect();
  rebuildIndex();
  switchSection('vehicles');
}

// ─── RECORD CRUD ─────────────────────────────────────────
function openAddRecord() {
  editingRecordId = null;
  document.getElementById('recordModalTitle').textContent = 'Добавить запись';
  const now = new Date();
  document.getElementById('rec_date').value = fmtDate(now.toISOString().split('T')[0]);
  ['rec_km','rec_km_glonass','rec_odo_start','rec_odo_end','rec_fuel_issued','rec_fuel_used','rec_fuel_actual','rec_fuel_idle','rec_note'].forEach(id => document.getElementById(id).value = '');
  routeSet([]);
  // Подставляем водителя и одометр начала из последней записи / данных ТС
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  document.getElementById('rec_driver').value = v ? (v.driver || '') : '';
  const vRecs = recsFor(selectedVehicleId)
    .slice().sort((a, b) => cmpDateAsc(a.date, b.date));
  if (vRecs.length) {
    const last = vRecs[vRecs.length - 1];
    if (last.odoEnd) document.getElementById('rec_odo_start').value = last.odoEnd;
  } else if (v && v.odometer) {
    // Первая запись — берём начальный одометр из данных ТС
    document.getElementById('rec_odo_start').value = v.odometer;
  }
  openModal('recordModal');
}

function openEditRecord(id) {
  const r = data.records.find(x => x.id === id);
  if (!r) return;
  editingRecordId = id;
  document.getElementById('recordModalTitle').textContent = 'Редактировать запись';
  document.getElementById('rec_date').value = fmtDate(r.date);
  document.getElementById('rec_km').value = r.km || '';
  document.getElementById('rec_km_glonass').value = r.kmGlonass ?? '';
  document.getElementById('rec_odo_start').value = r.odoStart || '';
  document.getElementById('rec_odo_end').value = r.odoEnd || '';
  document.getElementById('rec_driver').value = r.driver || '';
  document.getElementById('rec_fuel_issued').value = r.fuelIssued || '';
  document.getElementById('rec_fuel_actual').value = r.fuelActual || '';
  document.getElementById('rec_fuel_idle').value = r.fuelIdle || '';
  routeSet(Array.isArray(r.route) ? r.route : (r.route ? [r.route] : []));
  document.getElementById('rec_note').value = r.note || '';
  calcFuelAuto(); // пересчитать по норме сразу
  openModal('recordModal');
}

