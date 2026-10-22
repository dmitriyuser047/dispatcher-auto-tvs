// Добавление/изменение ТС и записей заправок
// Выделено из index.html

// ─── VEHICLE CRUD ────────────────────────────────────────
function openAddVehicle() {
  editingVehicleId = null;
  document.getElementById('vehicleModalTitle').textContent = 'Добавить транспортное средство';
  ['vm_make','vm_plate','vm_driver','vm_org','vm_object','vm_responsible','vm_fuelcard','vm_status','vm_justification','vm_note'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('vm_fuel_grade').value = 'ДТ';
  document.getElementById('vm_supplier').value = '';
  document.getElementById('vm_norm').value = '';
  document.getElementById('vm_norm_city').value = '';
  document.getElementById('vm_norm_highway').value = '';
  document.getElementById('vm_norm_idle').value = '';
  document.getElementById('vm_odometer').value = '';
  document.getElementById('vm_fuel_balance').value = '';
  document.getElementById('vm_tank_volume').value = '';
  document.getElementById('vm_to_km').value = '';
  document.getElementById('vm_to_months').value = '';
  if(typeof effectiveParametersLegacyForm==='function')effectiveParametersLegacyForm('vehicles',editingVehicleId==null?null:data.vehicles.find(row=>row.id===editingVehicleId),'vehicleModal');
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
  document.getElementById('vm_fuel_grade').value = vehicleFuelGrade(v);
  document.getElementById('vm_supplier').value = v.supplier || '';
  document.getElementById('vm_norm').value = v.norm ?? '';
  document.getElementById('vm_norm_city').value = v.normCity ?? '';
  document.getElementById('vm_norm_highway').value = v.normHighway ?? '';
  document.getElementById('vm_norm_idle').value = v.normIdle ?? '';
  document.getElementById('vm_odometer').value = v.odometer ?? '';
  document.getElementById('vm_fuel_balance').value = v.fuelBalance ?? '';
  document.getElementById('vm_tank_volume').value = v.tankVolume ?? '';
  document.getElementById('vm_to_km').value = v.toIntervalKm ?? '';
  document.getElementById('vm_to_months').value = v.toIntervalMonths ?? '';
  document.getElementById('vm_responsible').value = v.responsible || '';
  document.getElementById('vm_fuelcard').value = v.fuelcard || '';
  document.getElementById('vm_status').value = v.status || '';
  document.getElementById('vm_justification').value = v.justification || '';
  document.getElementById('vm_note').value = v.note || '';
  if(typeof effectiveParametersLegacyForm==='function')effectiveParametersLegacyForm('vehicles',editingVehicleId==null?null:data.vehicles.find(row=>row.id===editingVehicleId),'vehicleModal');
  openModal('vehicleModal');
}

async function saveVehicle() {
  const make = document.getElementById('vm_make').value.trim();
  const plate = document.getElementById('vm_plate').value.trim();
  const driver = document.getElementById('vm_driver').value.trim();
  if (!make || !plate || !driver) {
    showFieldError('Заполните обязательные поля: Марка, Госномер, ФИО водителя',
      !make ? 'vm_make' : !plate ? 'vm_plate' : 'vm_driver');
    return;
  }
  if(typeof effectiveParametersScalarGuard==='function'&&!effectiveParametersScalarGuard('vehicles',data.vehicles.find(row=>row.id===editingVehicleId),{norm:'vm_norm',normCity:'vm_norm_city',normHighway:'vm_norm_highway',normIdle:'vm_norm_idle'}))return;
  const numeric = precisionRead({norm:['vm_norm',6],normCity:['vm_norm_city',6],normHighway:['vm_norm_highway',6],normIdle:['vm_norm_idle',6],odometer:['vm_odometer',3],fuelBalance:['vm_fuel_balance',3,'zero'],tankVolume:['vm_tank_volume',3],toIntervalKm:['vm_to_km',3],toIntervalMonths:['vm_to_months',0]}, editingVehicleId == null ? null : data.vehicles.find(x=>x.id===editingVehicleId));
  if(!numeric)return;
  const obj = {
    make, plate, driver,
    org: document.getElementById('vm_org').value.trim(),
    object: document.getElementById('vm_object').value.trim(),
    fuelGrade: document.getElementById('vm_fuel_grade').value === 'Бензин' ? '' : document.getElementById('vm_fuel_grade').value,
    fuel: fuelTypeFromGrade(document.getElementById('vm_fuel_grade').value),
    supplier: document.getElementById('vm_supplier').value,
    ...numeric,
    responsible: document.getElementById('vm_responsible').value.trim(),
    fuelcard: document.getElementById('vm_fuelcard').value.trim(),
    status: document.getElementById('vm_status').value.trim(),
    justification: document.getElementById('vm_justification').value.trim(),
    note: document.getElementById('vm_note').value.trim(),
  };
  // Госномер должен быть уникальным: по нему опознаются заправки из выписок
  const twin = data.vehicles.find(x => x.id !== editingVehicleId && plateKey(x.plate) === plateKey(plate));
  if (twin && !confirm('Госномер «' + plate + '» уже есть у машины ' + (twin.make || '') + (twin.org ? ' (' + twin.org + ')' : '') +
      '.\nОдинаковые номера путают загрузку заправок. Всё равно сохранить?')) return;
  if (editingVehicleId!=null&&editingVehicleId!=='') {
    const v = data.vehicles.find(x => x.id === editingVehicleId);
    if (typeof gsmPreserveVehicleHistory === 'function' && v.org !== obj.org) gsmPreserveVehicleHistory(data, v);
    Object.assign(v, obj);
  } else {
    obj.id = 'v_' + Date.now();
    data.vehicles.push(obj);
    selectedVehicleId = obj.id;
  }
  if (!await saveData(data)) return;
  closeModal('vehicleModal');
  populateOrgSelect();
  renderVehicleList();
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v);
}

async function deleteVehicle(id) {
  const vehicle=data.vehicles.find(v=>v.id===id);if(!vehicle)return;
  if (!await confirmAction(vehicle.archived?'Восстановить ТС из архива?':'Перевести ТС в архив? История, топливо и документы сохранятся.')) return;
  vehicle.archived=!vehicle.archived;vehicle.archivedAt=vehicle.archived?new Date().toISOString():null;
  if (!await saveData(data)) return;
  selectedVehicleId = null;
  populateOrgSelect();
  rebuildIndex();
  switchSection('vehicles');
}

// ─── RECORD CRUD ─────────────────────────────────────────
function recFillCardSelect(selectedNum, useDefault) {
  const sel = document.getElementById('rec_fuel_card');
  const cards = (typeof fcList === 'function' ? fcList() : []).filter(c => !c.archived&&!c.mergedInto&&c.status!=='blocked'||!!selectedNum&&fcNorm(c.number)===fcNorm(selectedNum));
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  const vCardNum = v ? (typeof fcNorm === 'function' ? fcNorm(v.fuelcard) : '') : '';
  let html = '<option value="">— не указана —</option>';
  cards.forEach(c => {
    const fmt = typeof fcFormat === 'function' ? fcFormat(c.number) : c.number;
    const prov = c.provider ? ' (' + c.provider + ')' : '';
    const org = c.org ? ' · ' + c.org : '';
    html += '<option value="' + htmlEsc(c.number) + '">' + htmlEsc(fmt + prov + org) + '</option>';
  });
  sel.innerHTML = html;
  if (selectedNum && !cards.some(c => fcNorm(c.number) === fcNorm(selectedNum))) sel.add(new Option(selectedNum + ' (история)', selectedNum));
  if (selectedNum) sel.value = (cards.find(c => fcNorm(c.number) === fcNorm(selectedNum)) || {}).number || selectedNum;
  else if (useDefault && vCardNum) sel.value = vCardNum;
}

function openAddRecord() {
  if(data.vehicles.find(v=>v.id===selectedVehicleId)?.archived){showToast('Для новой записи восстановите ТС из архива');return;}
  editingRecordId = null;
  recordEditingState = null;
  document.getElementById('recordModalTitle').textContent = 'Добавить запись';
  const now = new Date();
  document.getElementById('rec_date').value = fmtDate(now.toISOString().split('T')[0]);
  ['rec_km','rec_km_glonass','rec_odo_start','rec_odo_end','rec_fuel_issued','rec_fuel_sum','rec_fuel_used','rec_fuel_actual','rec_fuel_idle','rec_tank_measured','rec_note'].forEach(id => document.getElementById(id).value = '');
  routeSet([]);
  // Подставляем водителя и одометр начала из последней записи / данных ТС
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  document.getElementById('rec_driver').value = v ? (v.driver || '') : '';
  document.getElementById('rec_fuel_grade').value = vehicleFuelGrade(v);
  recFillCardSelect('', true);
  const vRecs = recsFor(selectedVehicleId)
    .slice().sort((a, b) => cmpDateAsc(a.date, b.date));
  if (vRecs.length) {
    const last = vRecs[vRecs.length - 1];
    if (last.odoEnd) document.getElementById('rec_odo_start').value = last.odoEnd;
  } else if (v && v.odometer) {
    document.getElementById('rec_odo_start').value = v.odometer;
  }
  openModal('recordModal');
}

function openEditRecord(id) {
  const r = data.records.find(x => x.id === id);
  if (!r) return;
  if(EntityIdentity.presentId(r.fuelMovementId)){showToast('Выдача связана с движением топлива. Корректировка выполняется отдельным движением.');return;}
  editingRecordId = id;
  document.getElementById('recordModalTitle').textContent = 'Редактировать запись';
  document.getElementById('rec_date').value = fmtDate(r.date);
  document.getElementById('rec_km').value = r.km ?? '';
  document.getElementById('rec_km_glonass').value = r.kmGlonass ?? '';
  document.getElementById('rec_odo_start').value = r.odoStart ?? '';
  document.getElementById('rec_odo_end').value = r.odoEnd ?? '';
  document.getElementById('rec_driver').value = r.driver || '';
  document.getElementById('rec_fuel_grade').value = recordFuelGrade(r);
  recFillCardSelect(r.fuelCardNum || '');
  document.getElementById('rec_fuel_issued').value = r.fuelIssued || '';
  document.getElementById('rec_fuel_sum').value = r.fuelSum || '';
  document.getElementById('rec_fuel_actual').value = r.fuelActual ?? '';
  document.getElementById('rec_fuel_idle').value = r.fuelIdle || '';
  document.getElementById('rec_tank_measured').value = r.tankMeasured ?? '';
  routeSet(Array.isArray(r.route) ? r.route : (r.route ? [r.route] : []));
  document.getElementById('rec_note').value = r.note || '';
  document.getElementById('rec_fuel_used').value = r.fuelUsed ?? '';
  recordEditingState = { id, base: JSON.parse(JSON.stringify(r)), fields: recordFormFields() };
  openModal('recordModal');
}

