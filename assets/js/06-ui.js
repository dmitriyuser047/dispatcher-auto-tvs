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
      const active=document.activeElement;
      setTimeout(() => {
        if(document.getElementById(fieldId)===el&&document.activeElement===active)el.focus();
      }, 50);
    }
  }
}

let recordEditingState = null;
let recordFormGeneration = 0, recordFormContext = null, recordCommandIntent = null, recordIdSequence = 0;
const recordCommandFields = ['id','vehicleId','date','km','kmGlonass','odoStart','odoEnd','driver','fuelGrade','fuelCardNum','route','note','fuelIssued','fuelSum','fuelUsed','fuelActual','fuelIdle','tankMeasured'];
function recordSaveContext(){return typeof syncSessionStamp==='function'?syncSessionStamp():null;}
function recordAllocateId(prefix){
  const seed=typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now().toString(36)+'_'+(++recordIdSequence);
  let id=prefix+seed,suffix=0;while((data.records||[]).some(row=>row.id===id))id=prefix+seed+'_'+(++suffix);return id;
}
function recordSaveStatus(modal,message){
  if(!modal?.querySelector)return;let status=modal.querySelector('[data-record-save-status]');
  if(!status){status=document.createElement('p');status.dataset.recordSaveStatus='';status.setAttribute('role','status');(modal.querySelector('.modal-body')||modal).appendChild(status);}
  status.textContent=message;status.hidden=!message;
}
async function recordSaveSemantic(command,owner){
  const signature=JSON.stringify(command),context=recordSaveContext(),modal=document.getElementById('recordModal');
  let intent=recordCommandIntent;
  if(intent?.context!==context)intent=null;
  if(intent?.unknown&&intent.signature!==signature){showToast('Предыдущая операция ещё не подтверждена. Проверьте её в «Состоянии программы» перед сохранением изменённой записи.');return false;}
  if(!intent||intent.signature!==signature)intent={context,signature,operationId:recordAllocateId('record-save-'),recordId:command.input.record.id,unknown:false,pending:false};
  recordCommandIntent=intent;if(intent.pending)return false;
  const controls=modal?.querySelectorAll?[...modal.querySelectorAll('input,select,textarea,button')].map(control=>[control,control.disabled]):[];
  let answered=false;intent.pending=true;for(const [control]of controls)control.disabled=true;recordSaveStatus(modal,'Сохраняем запись. Ожидаем подтверждение базы…');
  try{
    const result=await platformExecuteCommand(command,{operationId:intent.operationId});answered=true;
    intent.unknown=!!(result?.unknown||result?.queued||result?.committed&&result?.needsReload);
    if(result?.ok!==true)throw Object.assign(Error(result?.message||result?.error||'Сохранение не подтверждено.'),result);
    if(context!==recordSaveContext())throw Object.assign(Error('База или права изменились. Проверьте результат в исходной базе.'),{unknown:true});
    if(!(data.records||[]).some(row=>row.id===command.input.record.id))throw Object.assign(Error('База подтвердила действие, но запись не получена. Проверьте результат перед повтором.'),{unknown:true});
    intent.unknown=false;recordSaveStatus(modal,'');return true;
  }catch(error){
    intent.unknown=intent.unknown||!answered||!!(error.unknown||error.queued||error.committed&&error.needsReload);
    const message=(error.message||'Сохранение не подтверждено.')+(intent.unknown?' Введённые данные остаются в форме; повтор неизменённой формы использует ту же операцию.':'');
    recordSaveStatus(modal,message);showToast(message);return false;
  }finally{
    intent.pending=false;
    if(owner===recordFormGeneration)for(const [control,disabled]of controls)if(control.isConnected)control.disabled=disabled;
  }
}
function recordFormFields() {
  const map = { date:'rec_date', km:'rec_km', kmGlonass:'rec_km_glonass', odoStart:'rec_odo_start', odoEnd:'rec_odo_end', driver:'rec_driver', fuelGrade:'rec_fuel_grade',
    fuelIssued:'rec_fuel_issued', fuelSum:'rec_fuel_sum', fuelUsed:'rec_fuel_used', fuelActual:'rec_fuel_actual', fuelIdle:'rec_fuel_idle', tankMeasured:'rec_tank_measured', fuelCardNum:'rec_fuel_card', note:'rec_note' };
  const fields = Object.fromEntries(Object.entries(map).map(([key,id])=>[key,document.getElementById(id).value.trim()]));
  fields.route = routeGet(); return fields;
}

async function saveRecord() {
  if(recordCommandIntent?.pending)return;
  if(recordFormContext!==null&&recordFormContext!==recordSaveContext()){showToast('База или права изменились. Откройте запись заново; введённые поля остаются в форме.');return;}
  const dateRaw = document.getElementById('rec_date').value.trim();
  const date = parseDate(dateRaw);
  const _old = editingRecordId!=null&&editingRecordId!==''&&data.records.find(x => x.id === editingRecordId);
  if(EntityIdentity.presentId(_old?.fuelMovementId)){showToast('Связанная выдача изменяется отдельной корректировкой движения топлива');return;}
  if (!date) { showFieldError('Укажите дату в формате ДД.ММ.ГГГГ', 'rec_date'); return; }
  const numeric=precisionRead({km:['rec_km',3,'error'],kmGlonass:['rec_km_glonass',3],odoStart:['rec_odo_start',3],odoEnd:['rec_odo_end',3],fuelIssued:['rec_fuel_issued',3],fuelSum:['rec_fuel_sum',2],fuelUsed:['rec_fuel_used',3],fuelActual:['rec_fuel_actual',3],fuelIdle:['rec_fuel_idle',3],tankMeasured:['rec_tank_measured',3]},_old);
  if(!numeric)return;
  const {km,odoStart:start,odoEnd:end}=numeric;
  if (!Number.isFinite(km) || km < 0) { showFieldError('Укажите неотрицательный пробег за день', 'rec_km'); return; }
  if (start != null && end != null && (end < start || Math.abs(end - start - km) > 0.11) &&
      (!_old || _old.km !== km || _old.odoStart !== start || _old.odoEnd !== end)) { showFieldError('Пробег не совпадает с разницей одометра', 'rec_odo_end'); return; }
  if (typeof fuelEditAllowed === 'function' && !fuelEditAllowed(date, _old && _old.date)) return;
  let obj = {
    vehicleId: selectedVehicleId,
    date,
    ...numeric,
    driver: document.getElementById('rec_driver').value.trim() || null,
    fuelGrade: document.getElementById('rec_fuel_grade').value === 'Бензин' ? '' : document.getElementById('rec_fuel_grade').value,
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
  const commandAvailable=typeof platformVehicleRecordCommandAvailable==='function'&&platformVehicleRecordCommandAvailable();
  if(recordCommandIntent?.unknown&&recordCommandIntent.context===recordSaveContext()&&!commandAvailable){showToast('Предыдущая операция ещё не подтверждена. Проверьте её в «Состоянии программы» перед новым сохранением.');return;}
  if(commandAvailable){
    const existing=editingRecordId!=null&&editingRecordId!=='';
    if(existing&&!_old){showToast('Запись уже удалена. Откройте журнал заново.');return;}
    const prior=recordCommandIntent?.context===recordSaveContext()?recordCommandIntent:null;
    const id=existing?editingRecordId:prior?.recordId??recordAllocateId('r_');
    const record=Object.fromEntries(recordCommandFields.filter(field=>field==='id'||Object.hasOwn(obj,field)).map(field=>[field,field==='id'?id:obj[field]]));
    const command={type:'VehicleRecordAction',version:1,input:{action:'save',record}};
    const clean=typeof platformVehicleRecordCommandSourceClean==='function'&&platformVehicleRecordCommandSourceClean(data,command);
    if(prior?.unknown&&!clean){showToast('Предыдущая операция ещё не подтверждена. Проверьте её результат и сохраните или отмените прочие изменения.');return;}
    if(clean){
      // A confirmed unchanged draft has no accounting operation to persist.
      // An earlier unknown result must still use the receipt recovery path.
      if(_old&&!prior?.unknown&&JSON.stringify(obj)===JSON.stringify(_old)){closeModal('recordModal');return;}
      const generation=recordFormGeneration,context=recordSaveContext(),vehicleId=selectedVehicleId;
      if(!await recordSaveSemantic(command,generation))return;
      if(generation!==recordFormGeneration||context!==recordSaveContext()||selectedVehicleId!==vehicleId)return;
      const saved=(data.records||[]).find(row=>row.id===id),savedDate=new Date(saved.date);selectedYear=savedDate.getFullYear();selectedMonth=savedDate.getMonth()+1;
      closeModal('recordModal');const vehicle=(data.vehicles||[]).find(row=>row.id===vehicleId);
      if(typeof activeSection!=='undefined'&&activeSection==='fuelPurchases')renderFuelPurchases();else if(vehicle)renderDetail(vehicle,{preserveJournal:true});return;
    }
  }
  const rollback = captureSaveRollback();
  if (editingRecordId!=null&&editingRecordId!=='') {
    const r = data.records.find(x => x.id === editingRecordId);
    if (!r) { showToast('Запись уже удалена. Откройте журнал заново.'); return; }
    Object.assign(r, obj);
  } else {
    obj.id = recordAllocateId('r_');
    data.records.push(obj);
  }
  // update selected month to record's month
  const d = new Date(date);
  selectedYear = d.getFullYear();
  selectedMonth = d.getMonth() + 1;
  if (!await saveData(data)) { restoreSaveRollback(rollback); return; }
  closeModal('recordModal');
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (typeof activeSection !== 'undefined' && activeSection === 'fuelPurchases') renderFuelPurchases();
  else if (v) renderDetail(v,{preserveJournal:true});
}

async function deleteRecord(id) {
  if(EntityIdentity.presentId(data.records.find(r=>r.id===id)?.fuelMovementId)){showToast('Связанную выдачу нельзя удалить. Оформите корректировку движения топлива.');return;}
  const _r = data.records.find(x => x.id === id);
  if (_r && typeof fuelEditAllowed === 'function' && !fuelEditAllowed(_r.date)) return;
  if (!await confirmAction('Удалить эту запись?')) return;
  const rollback = captureSaveRollback();
  data.records = data.records.filter(r => r.id !== id);
  if (!await saveData(data)) { restoreSaveRollback(rollback); return; }
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v,{preserveJournal:true});
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
  const rollback = captureSaveRollback();
  data.records = data.records.filter(r => !ids.includes(r.id));
  if (!await saveData(data)) { restoreSaveRollback(rollback); return; }
  const v = data.vehicles.find(x => x.id === selectedVehicleId);
  if (v) renderDetail(v,{preserveJournal:true});
}

// ─── MODALS ──────────────────────────────────────────────
function openModal(id) {
  const modal=document.getElementById(id);precisionRemember(modal);
  if(id==='recordModal'){
    recordFormGeneration++;recordFormContext=recordSaveContext();
    if(!recordCommandIntent?.unknown||recordCommandIntent.context!==recordFormContext)recordCommandIntent=null;
    recordSaveStatus(modal,'');if(typeof prepareVehicleNormForm==='function')prepareVehicleNormForm();
  }
  modal.classList.add('open');
}
function closeModal(id) {
  if(id==='recordModal'&&recordCommandIntent?.pending){showToast('Дождитесь подтверждения сохранения записи.');return;}
  document.getElementById(id).classList.remove('open');
  if(id==='recordModal'){recordFormContext=null;if(!recordCommandIntent?.unknown)recordCommandIntent=null;}
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
  el.addEventListener('pointerup', e => { if (e.target !== el) el._backdropDown = false; });
  el.addEventListener('pointercancel', () => { el._backdropDown = false; });
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

