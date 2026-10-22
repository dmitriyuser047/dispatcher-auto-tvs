// Учёт топлива: справочник топливных карт и закрытие месяца.
//
// Карта закрепляется за машиной с даты: assignments = [{ vehicleId, from, to }].
// В выписке фактическая машина важнее закрепления карты. Закрепление и
// организация карты на дату покупки сохраняют источник топлива в истории.
//
// Закрытый месяц защищён от правок: журнал пробега, заправки из выписок
// и загрузка выписок в него не пишут. Месяц можно открыть обратно —
// открытие и закрытие записываются в историю месяца.

// ─── Топливные карты ──────────────────────────────────────

function fcList() { return data.fuelCards || (data.fuelCards = []); }
function fcNorm(s) { return typeof gsmCardKey === 'function' ? gsmCardKey(s) : String(s || '').replace(/\D/g, '') || String(s || '').trim().toUpperCase(); }
function fcFormat(n) { return String(n || '').replace(/(\d{4})(?=\d)/g, '$1 '); }

// Поставщик по началу номера — для подписи, на сопоставление не влияет
function fcGuessProvider(n) {
  if (/^7005/.test(n)) return 'Газпромнефть';
  if (/^78248677/.test(n)) return 'Лукойл';
  if (/^78248610/.test(n)) return 'Офисные карты';
  return '';
}

function fcByNumber(num) {
  const n = fcNorm(num);
  return n ? fcList().find(c => fcNorm(c.number) === n) : null;
}

// Машина, за которой карта числилась на дату
function fcVehicleAt(num, date) {
  const c = fcByNumber(num);
  if (!c) return null;
  const a = (c.assignments || []).filter(x => (!x.from || x.from <= date) && (!x.to || x.to >= date));
  const last = a[a.length - 1];
  return last && (data.vehicles || []).find(v => v.id === last.vehicleId) || null;
}

function fcCurrentVehicleId(c) {
  const date=dispatcherLocalDate(),matches=(c.assignments||[]).filter(row=>(!row.from||row.from<=date)&&(!row.to||row.to>=date));
  return matches.length===1?matches[0].vehicleId??'':'';
}

// Первичное заполнение: номера из карточек машин и карты из выписок.
// Владельца можно восстановить из однозначного номера в карточке ТС,
// но не по получателю покупок: карта могла заправлять чужую машину.
function fcSeed() {
  const known = new Set(fcList().map(c => c.number));
  const stats = new Map();
  fpLive().forEach(p => {
    const n = fcNorm(p.cardNo);
    if (n.length < 8 || !p.vehicleId) return;
    const s = stats.get(n) || { veh: new Map(), first: p.date };
    s.veh.set(p.vehicleId, (s.veh.get(p.vehicleId) || 0) + 1);
    if (p.date < s.first) s.first = p.date;
    stats.set(n, s);
  });
  const fromVehicles = new Map();
  (data.vehicles || []).forEach(v => {
    const n = fcNorm(v.fuelcard);
    if (n.length >= 10) { if (!fromVehicles.has(n)) fromVehicles.set(n, []); fromVehicles.get(n).push(v.id); }
  });
  let added = 0;
  new Set([...stats.keys(), ...fromVehicles.keys()]).forEach(n => {
    if (known.has(n)) return;
    const declared = fromVehicles.get(n) || [];
    const top = declared.length === 1 ? declared[0] : '';
    const shared = (fromVehicles.get(n) || []).length > 1;
    fcList().push({
      id: 'fc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      number: n, provider: fcGuessProvider(n), status: 'active', limit: null,
      assignments: top ? [{ vehicleId: top, from: '', to: '' }] : [],
      note: shared ? 'номер записан в карточках нескольких машин; укажите организацию карты' : top ? '' : 'владелец не определён; укажите организацию карты',
    });
    added++;
  });
  return added;
}

// ─── Закрытые месяцы ──────────────────────────────────────

function fuelPeriods() { return data.fuelPeriods || (data.fuelPeriods = []); }
function fuelPeriod(month) { return fuelPeriods().find(p => p.month === month); }
function fuelMonthClosed(dateOrMonth) {
  const m = String(dateOrMonth || '').slice(0, 7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))return false;
  if(typeof PeriodPolicy!=='undefined')return PeriodPolicy.isClosed(data,'fuel',m);
  const p=fuelPeriod(m);return !!(p&&p.closed);
}
// Проверка перед правкой: true — можно, false — месяц закрыт (с сообщением)
function fuelEditAllowed(...dates) {
  const closed = [...new Set(dates.filter(Boolean).map(d => String(d).slice(0, 7)))].filter(fuelMonthClosed);
  if (!closed.length) return true;
  alert('Период защищён закрытием: ' + closed.map(m => fpMonthLabel(m)).join(', ') +
    '.\nПроверьте защиту периода: Заправки → Закрытие месяца. Более поздние закрытые месяцы также влияют на правки.');
  return false;
}

// ─── Вкладка «Карты» ──────────────────────────────────────

let fcSearch = '';

function fcCardsHtml() {
  const month = fpMonth && fpMonth !== 'all' ? fpMonth : new Date().toISOString().slice(0, 7);
  const q = fcSearch.toLowerCase().trim();
  const used = new Map(), last = new Map(), unassigned = new Map();
  fpLive().forEach(p => {
    const n = fcNorm(p.cardNo);
    if (!n) return;
    if ((p.date || '').startsWith(month)) used.set(n, (used.get(n) || 0) + (+p.qty || 0));
    if (!last.has(n) || p.date > last.get(n)) last.set(n, p.date);
    if (!p.vehicleId) unassigned.set(n, (unassigned.get(n) || 0) + 1);
  });
  const vt = id => { const v = (data.vehicles || []).find(x => x.id === id); return v ? fpVehicleTitle(v) : '—'; };
  const list = fcList().filter(c => {
    if (!q) return true;
    return [c.number, c.provider, c.note, vt(fcCurrentVehicleId(c))].join(' ').toLowerCase().includes(q);
  }).sort((a, b) => vt(fcCurrentVehicleId(a)).localeCompare(vt(fcCurrentVehicleId(b)), 'ru'));

  // Карты из выписок, которых нет в справочнике
  const unknown = [...last.keys()].filter(n => !fcByNumber(n));

  const rows = list.map(c => {
    const u = used.get(c.number) || 0;
    const over = c.limit && u > c.limit;
    const hist = (c.assignments || []).length > 1
      ? `<div style="font-size:11px;color:var(--text3)">${c.assignments.map(a => vt(a.vehicleId).split(' — ')[0] +
          (a.from ? ' с ' + fmtDate(a.from) : '') + (a.to ? ' по ' + fmtDate(a.to) : '')).join('<br>')}</div>` : '';
    return `<tr>
      <td style="font-family:monospace;white-space:nowrap">${fcFormat(c.number)}</td>
      <td>${fpEsc(c.provider || '—')}</td>
      <td>${c.status === 'blocked' ? '<span style="color:var(--text3)">заблокирована</span>' : fpEsc(vt(fcCurrentVehicleId(c)))}${hist}</td>
      <td style="text-align:right">${c.limit ? fpNum(c.limit, 0) : '—'}</td>
      <td style="text-align:right;${over ? 'color:var(--red);font-weight:700' : ''}">${u ? fpNum(u, 1) : '—'}${over ? '<div style="font-size:11px">лимит превышен</div>' : ''}</td>
      <td>${last.has(c.number) ? fmtDate(last.get(c.number)) : '—'}</td>
      <td style="font-size:12px;color:var(--text3);max-width:200px;white-space:normal">${fpEsc(c.note || '')}${unassigned.get(c.number) ? `<div style="color:#d97706">без машины: ${unassigned.get(c.number)}</div>` : ''}</td>
      <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="fcEdit(${htmlEsc(JSON.stringify(c.id))})">Изменить</button></td>
    </tr>`;
  }).join('');

  return `
    <div class="vehicle-cards-toolbar">
      <input type="text" placeholder="Поиск по номеру, машине..." value="${fpEsc(fcSearch)}" oninput="fcSearch=this.value;renderFuelPurchases()">
      <button class="btn btn-ghost" onclick="fcSeedClick()">Заполнить из карточек и выписок</button>
      <button class="btn btn-primary" onclick="fcEdit('')">Добавить карту</button>
    </div>
    ${unknown.length ? `<div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px">
      В выписках есть карты, которых нет в справочнике: ${unknown.map(fcFormat).join(', ')}. Нажмите «Заполнить из карточек и выписок».</div>` : ''}
    <div class="table-wrap"><div class="table-scroll" style="overflow-x:auto">
      <table class="data-table" style="width:100%">
        <thead><tr><th>Номер карты</th><th>Поставщик</th><th>Машина</th><th style="text-align:right">Лимит, л/мес</th>
          <th style="text-align:right">Заправлено за ${fpMonthLabel(month).toLowerCase()}, л</th><th>Последняя заправка</th><th>Примечание</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:16px">Карт нет. Нажмите «Заполнить из карточек и выписок».</td></tr>'}</tbody>
      </table>
    </div></div>
    `;
}

async function fcSeedClick() {
  const n = fcSeed();
  await saveData(data);
  showToast && showToast(n ? 'Добавлено карт: ' + n : 'Новых карт не найдено');
  renderFuelPurchases();
}

let fcEditorState=null;
function fcEditorStamp(){return JSON.stringify(['fuelCards','vehicles','fuelPurchases','records','fuelPeriods'].map(name=>data[name]||[]));}
function fcGuard(state,requireOpen=false){
  if(fcEditorState!==state||state.context!==wfCommandContextStamp()||state.database!==data||state.source!==fcEditorStamp())throw Error('Данные, база или права изменились. Откройте карту заново; введённые значения остаются в форме.');
  if(requireOpen&&(!state.form?.isConnected||!document.getElementById('genericModal')?.classList.contains('open')||!document.getElementById('genericModal')?.contains(state.form)))throw Error('Форма карты закрыта. Откройте карту заново перед сохранением.');
  if(!fuelAccountingWritable('fuelCards'))throw Error('Изменение топливных карт недоступно для вашей роли');
}
function fcPlanCard(original,input){
  const card=JSON.parse(JSON.stringify(original||{id:input.id,number:input.number,assignments:[],org:input.org}));
  const orgChanged=!!original&&input.org!==input.originalOrg;
  const assignmentChanged=input.vehicleId!==input.originalVehicle;
  const dated=!original||orgChanged||assignmentChanged||!!input.from;
  if(!input.number||input.number.length<6)throw Error('Укажите полный номер карты');
  if((!original||orgChanged)&&!input.org)throw Error('Укажите организацию карты');
  if(dated&&(!input.from||!gsmValidDate(input.from)))throw Error('Укажите дату начала изменения; сегодняшняя дата не подставляется автоматически');
  if(dated&&!input.basis.trim())throw Error('Укажите основание изменения организации или закрепления');
  const previousDay=()=>fqShiftDate(input.from,-1);
  if(orgChanged||!original&&input.from){
    const history=card.orgHistory||(card.orgHistory=[]);
    if(history.some(row=>row.from&&row.from>=input.from))throw Error('В истории уже есть период с этой или более поздней датой. Сначала проверьте существующие периоды.');
    if(!history.length&&original&&input.originalOrg){
      if(!input.preserveLegacy)throw Error('Подтвердите сохранение прежней организации до новой даты; её начальная дата неизвестна');
      history.push({org:input.originalOrg,from:'',to:previousDay()});
    }
    const open=history.filter(row=>!row.to);
    if(open.length>1)throw Error('В истории несколько открытых периодов организации. Сначала исправьте пересечение.');
    if(open.length)open[0].to=previousDay();
    if(history.some(row=>row.to&&row.to>=input.from))throw Error('Периоды организации пересекаются');
    history.push({org:input.org,from:input.from,to:'',basis:input.basis.trim()});
  }
  if(assignmentChanged){
    const assignments=card.assignments||(card.assignments=[]);
    if(original&&assignments.some(row=>row.from&&row.from>=input.from))throw Error('Закрепление уже содержит эту или более позднюю дату');
    const open=assignments.filter(row=>!row.to);if(open.length>1)throw Error('Несколько открытых закреплений карты требуют сверки');
    if(open.length)open[0].to=previousDay();
    if(input.vehicleId!==null&&input.vehicleId!=='')assignments.push({vehicleId:input.vehicleId,from:input.from||'',to:'',...(input.basis?{basis:input.basis.trim()}:{})});
  }
  Object.assign(card,{provider:input.provider,limit:input.limit,status:input.status,note:input.note});
  return {card,dated,orgChanged,assignmentChanged,from:input.from,basis:input.basis};
}
function fcEdit(id) {
  if(!fuelAccountingWritable('fuelCards')){showToast('Топливные карты доступны только для просмотра');return;}
  const c = id!=null&&id!=='' ? fcList().find(x => x.id === id) : null;
  if(id!=null&&id!==''&&!c){showToast('Карта не найдена');return;}
  const cur = c ? fcCurrentVehicleId(c) : '';
  const originalOrg=c?gsmCardAt(data,c.number,dispatcherLocalDate()).org:'';
  const choices=(data.vehicles||[]).map((vehicle,index)=>({token:'card-vehicle-'+index,id:vehicle.id,title:fpVehicleTitle(vehicle)}));
  const state=fcEditorState={id:c?c.id:wfId('card'),original:c?JSON.parse(JSON.stringify(c)):null,originalOrg,originalVehicle:cur,choices,context:wfCommandContextStamp(),database:data,source:fcEditorStamp(),pending:false,reviewed:null};
  openGenericModal(c ? 'Карта ' + fcFormat(c.number) : 'Новая карта', `
    <div id="fcEditor">
    <div class="form-row">
      <div class="form-group"><label>Номер карты</label><input type="text" id="fc_number" value="${c ? fcFormat(c.number) : ''}" ${c ? 'readonly' : ''}></div>
      <div class="form-group"><label>Поставщик</label><input type="text" id="fc_provider" value="${fpEsc(c ? c.provider : '')}" placeholder="Газпромнефть, Лукойл..."></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Организация карты</label><input type="text" id="fc_org" value="${fpEsc(originalOrg)}" placeholder="ООО «...»" list="fc_org_list">
        <datalist id="fc_org_list">${[...new Set((data.vehicles||[]).map(v=>(v.org||'').trim()).filter(Boolean))].sort().map(o=>'<option value="'+fpEsc(o)+'">').join('')}</datalist></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Машина</label><select id="fc_vehicle"><option value="">Без закрепления</option>${choices.map(choice=>'<option value="'+choice.token+'"'+(choice.id===cur?' selected':'')+'>'+fpEsc(choice.title)+'</option>').join('')}</select></div>
      <div class="form-group"><label>С даты (изменение машины или организации)</label><input type="text" id="fc_from" placeholder="ДД.ММ.ГГГГ"></div>
    </div>
    <div class="form-group"><label for="fc_basis">Основание изменения организации или закрепления</label><input id="fc_basis" maxlength="4000" placeholder="Документ или подтверждённое основание"></div>
    ${c&&!(c.orgHistory||[]).length?'<label style="display:flex;gap:6px"><input type="checkbox" id="fc_preserve_legacy"> Сохранить прежнюю организацию до выбранной даты; её начальная дата неизвестна</label>':''}
    ${c&&(c.orgHistory||[]).length?'<details><summary>История организации</summary>'+c.orgHistory.map(row=>'<p>'+fpEsc(row.from||'Начальная дата неизвестна')+' — '+fpEsc(row.to||'далее')+': '+fpEsc(row.org||'Не указана')+(row.basis?' · '+fpEsc(row.basis):'')+'</p>').join('')+'</details>':''}
    <div class="form-row">
      <div class="form-group"><label>Лимит, л в месяц</label><input type="number" step="any" min="0" id="fc_limit" value="${c?.limit ?? ''}"></div>
      <div class="form-group"><label>Состояние</label><select id="fc_status">
        <option value="active"${!c || c.status !== 'blocked' ? ' selected' : ''}>Действует</option>
        <option value="blocked"${c && c.status === 'blocked' ? ' selected' : ''}>Заблокирована</option></select></div>
    </div>
    <div class="form-group"><label>Примечание</label><input type="text" id="fc_note" value="${fpEsc(c ? c.note : '')}"></div>
    <label style="font-size:13px;display:flex;gap:6px;align-items:center;margin:6px 0 12px">
      <input type="checkbox" id="fc_move"> перенести покупки по карте с этой даты на новую машину (кроме закрытых месяцев)</label>
    <div style="display:flex;justify-content:space-between;gap:8px">
      ${c ? `<button class="btn btn-ghost" style="color:var(--red)" onclick="fcDelete(${htmlEsc(JSON.stringify(c.id))})">Удалить карту</button>` : '<span></span>'}
      <span><button class="btn btn-ghost" onclick="closeModal('genericModal')">Отмена</button>
      <button id="fc_save" class="btn btn-primary" onclick="fcSave(${htmlEsc(JSON.stringify(state.id))})">Сохранить</button></span>
    </div><div id="fc_preview" class="wf-note" hidden></div><label id="fc_confirmation" hidden><input id="fc_confirm" type="checkbox"> Подтверждаю дату, основание и проверенный план изменения</label><div id="fc_error" class="wf-error" role="alert"></div></div>`, 620);
  state.form=document.getElementById('fcEditor');
  state.form.addEventListener('input',event=>{if(event.target.id==='fc_confirm')return;state.reviewed=null;document.getElementById('fc_preview').hidden=true;document.getElementById('fc_confirmation').hidden=true;document.getElementById('fc_confirm').checked=false;});
}

async function fcSave(id) {
  const state=fcEditorState;if(!state||state.pending||state.id!==id)return;
  const errorNode=state.form.querySelector('#fc_error');errorNode.textContent='';
  let unlock=null,saved=false;
  try{
  fcGuard(state,true);
  const number = fcNorm(document.getElementById('fc_number').value);
  const fromRaw = document.getElementById('fc_from').value.trim();
  const from = fromRaw ? parseDate(fromRaw) : '';
  if (fromRaw && (!from || !gsmValidDate(from))) { showFieldError('Дата в формате ДД.ММ.ГГГГ', 'fc_from'); return; }
  const org = document.getElementById('fc_org').value.trim();
  if (!org&&(!state.original||org!==state.originalOrg)) { showFieldError('Укажите организацию карты', 'fc_org'); return; }
  if(!state.original&&fcByNumber(number))throw Error('Такая карта уже есть в справочнике');
  const choice=document.getElementById('fc_vehicle').value,vid=choice?state.choices.find(row=>row.token===choice)?.id:'';
  if(choice&&vid===undefined)throw Error('Выбранная машина не найдена');
  const input={id:state.id,number,org,from,originalOrg:state.originalOrg,originalVehicle:state.originalVehicle,vehicleId:vid,
    basis:document.getElementById('fc_basis').value.trim(),preserveLegacy:!!document.getElementById('fc_preserve_legacy')?.checked,
    provider:document.getElementById('fc_provider').value.trim(),limit:precisionInput('fc_limit',{scale:3,blank:'null',...(state.original?{previous:state.original.limit}:{})}),status:document.getElementById('fc_status').value,note:document.getElementById('fc_note').value.trim(),move:document.getElementById('fc_move').checked};
  const plan=fcPlanCard(state.original,input),text=JSON.stringify({card:plan.card,move:input.move});
  if(input.move&&!from)throw Error('Для переноса покупок укажите дату начала');
  if(input.move&&vid==='')throw Error('Для переноса покупок выберите машину-получателя');
  if((plan.dated||input.move)&&(!state.reviewed||state.reviewed!==text||!document.getElementById('fc_confirm').checked)){
    state.reviewed=text;document.getElementById('fc_preview').hidden=false;document.getElementById('fc_confirmation').hidden=false;document.getElementById('fc_confirm').checked=false;
    document.getElementById('fc_preview').innerHTML='<p>Изменение с '+fpEsc(from)+'. Основание: '+fpEsc(input.basis)+'.</p><p>Периоды организации: '+(plan.card.orgHistory||[]).map(row=>fpEsc(row.org)+' ('+fpEsc(row.from||'начальная дата неизвестна')+' — '+fpEsc(row.to||'далее')+')').join('; ')+'</p><p>'+(input.move?'Покупки начиная с выбранной даты будут перенесены на выбранную машину; закрытые месяцы пропускаются.':'Покупки и журналы сохраняют исходные значения.')+'</p>';return;
  }
  if(typeof _pendingSaveOperations!=='undefined'&&_pendingSaveOperations.size)throw Error('Дождитесь завершения текущего сохранения');
  const previous=platformSaveBaseline(),old=(previous.fuelCards||[]).filter(row=>row.id===state.id);
  if(state.original?(old.length!==1||JSON.stringify(old[0])!==JSON.stringify(state.original)):old.length)throw Error('Сначала сохраните или отмените незавершённые изменения карты');
  if(input.move&&['records','fuelPurchases'].some(name=>JSON.stringify(data[name]||[])!==JSON.stringify(previous[name]||[])))throw Error('Перед переносом сохраните или отмените изменения покупок и журналов');
  const next=JSON.parse(JSON.stringify(previous));next.fuelCards=state.original?next.fuelCards.map(row=>row.id===state.id?plan.card:row):[...(next.fuelCards||[]),plan.card];
  let moved = 0, skipped = 0;
  if (vid!==''&&input.move) {
    const live=data;try{data=next;
      fpLive().filter(p => fcNorm(p.cardNo) === number && p.date >= from && p.vehicleId !== vid).forEach(p => {
        if (fuelMonthClosed(p.date)) { skipped++; return; }
        const v = (data.vehicles || []).find(x => x.id === vid);
        fpUpdate(p, { vehicleId: vid, grade: parseFuelGrade(p.product) || p.grade || vehicleFuelGrade(v) });
        moved++;
      });
    }finally{data=live;}
  }
  const names=['fuelCards','records','fuelPurchases'].filter(name=>JSON.stringify(previous[name]||[])!==JSON.stringify(next[name]||[]));
  const auditBefore=JSON.stringify(data.auditLog||[]);state.pending=true;unlock=wfLockCommandForm(state.form);
  if(state.operationText!==text){state.operationText=text;state.operationId=wfId('card-change');}
  saved=await saveData(next,{noMerge:true,requiredCanonicalSections:names,operation:{id:state.operationId},history:{action:'Изменение топливной карты',reason:input.basis}});
  if(saved!==true)throw Error('Изменение карты не подтверждено. Введённые значения остаются в форме.');
  fcGuard(state);
  const canonical=(next.fuelCards||[]).filter(row=>row.id===state.id);if(canonical.length!==1)throw Error('Сервер не вернул сохранённую карту');
  data.fuelCards=state.original?data.fuelCards.map(row=>row.id===state.id?canonical[0]:row):[...(data.fuelCards||[]),canonical[0]];
  for(const name of names.filter(name=>name!=='fuelCards'))data[name]=JSON.parse(JSON.stringify(next[name]));
  if(JSON.stringify(data.auditLog||[])===auditBefore)data.auditLog=JSON.parse(JSON.stringify(next.auditLog||[]));rebuildIndex();
  if(!document.getElementById('genericModal')?.contains(state.form))return;
  closeModal('genericModal');
  fcEditorState=null;
  if (moved || skipped) alert('Перенесено покупок: ' + moved + (skipped ? '\nВ закрытых месяцах не тронуто: ' + skipped : ''));
  renderFuelPurchases();
  }catch(error){errorNode.textContent=saved?'Сервер подтвердил запись, но сеанс или исходные данные изменились. Проверьте результат в исходной базе. '+error.message:error.message;}
  finally{state.pending=false;unlock?.();}
}

async function fcDelete(id) {
  if (!confirm('Удалить карту из справочника? Покупки по ней останутся.')) return;
  const before = JSON.stringify(data);
  const card = fcList().find(c => c.id === id);
  if (card) gsmPreserveCardHistory(data, card.number);
  data.fuelCards = fcList().filter(c => c.id !== id);
  if (await saveData(data) === false) { data = JSON.parse(before); rebuildIndex(); return; }
  closeModal('genericModal');
  renderFuelPurchases();
}

// ─── Вкладка «Закрытие месяца» ────────────────────────────

let fcCloseMonth = '';

function fcMonthEndBalance(vid, month) {
  const bal = computeFuelBalances(vid);
  const recs = recsFor(vid).filter(r => r.date <= month + '-31').sort((a, b) => cmpDateAsc(a.date, b.date));
  return recs.length ? bal[recs[recs.length - 1].id] : null;
}

function fcChecklist(month) {
  const items = [];
  const ledgerErrors = gsmBuildLedger(data, gsmMonthRange(month)).errors;
  items.push({ title: 'Общие бочки и журнал сходятся', bad: ledgerErrors.length,
    detail: ledgerErrors.slice(0, 5).map(i => i.message).join('; '), tab: 'writeoff' });
  const inM = p => (p.date || '').startsWith(month);
  const prevM = fpPrevMonth(month), prev2 = fpPrevMonth(prevM);

  // 1. Выписки: карта работала в прошлые два месяца, а в этом покупок нет
  const cardsBefore = new Set(), cardsNow = new Set();
  fpLive().forEach(p => {
    const n = fcNorm(p.cardNo); if (!n) return;
    if (inM(p)) cardsNow.add(n);
    else if (p.date.startsWith(prevM) || p.date.startsWith(prev2)) cardsBefore.add(n);
  });
  const silent = [...cardsBefore].filter(n => !cardsNow.has(n) && (fcByNumber(n) || {}).status !== 'blocked');
  items.push({ title: 'Выписки загружены по всем картам', bad: silent.length,
    detail: silent.length ? 'нет покупок за месяц по картам, которые работали раньше: ' + silent.map(n => {
      const v = fcVehicleAt(n, month + '-15'); return fcFormat(n) + (v ? ' (' + v.plate + ')' : ''); }).join(', ') : '',
    tab: 'cards' });

  // 2. Покупки без машины
  const unm = fpLive().filter(p => !p.vehicleId && inM(p));
  items.push({ title: 'Все покупки привязаны к машинам', bad: unm.length,
    detail: unm.length ? unm.length + ' покупок на ' + fpNum(unm.reduce((s, p) => s + p.qty, 0), 1) + ' л' : '', tab: 'unmatched' });

  // 3. Журнал совпадает с выписками
  const byRecord = fpStats();
  const diffRecs = new Set();
  fpLive().filter(p => p.vehicleId && inM(p)).forEach(p => {
    const st = fpJournalState(p, byRecord);
    if (st.state !== 'ok') diffRecs.add(p.vehicleId + p.date);
  });
  items.push({ title: 'Журнал совпадает с выписками', bad: diffRecs.size,
    detail: diffRecs.size ? diffRecs.size + ' дн. с расхождением' : '', tab: 'cards' });

  // 4. Сдвоенные заправки разобраны
  const saveM = fpMonth; fpMonth = month;
  const dbl = fpDoubles().filter(d => d.flags.length && !d.checked);
  fpMonth = saveM;
  items.push({ title: 'Сдвоенные заправки с отметками проверены', bad: dbl.length,
    detail: dbl.length ? dbl.map(d => d.v.plate + ' ' + fmtDate(d.date).slice(0, 5)).join(', ') : '', tab: 'doubles' });

  // 4а. Проверки заправок: бак, цена, регион
  if (typeof fkChecks === 'function') {
    const chk = fkChecks(month).filter(x => !x.p.checkOk);
    items.push({ title: 'Проверки заправок разобраны (бак, цена, регион)', bad: chk.length,
      detail: chk.length ? chk.slice(0, 12).map(x => x.v.plate + ' ' + fmtDate(x.p.date).slice(0, 5)).join(', ') + (chk.length > 12 ? '…' : '') : '', tab: 'checks' });
  }

  // 5. Нет отрицательного остатка на конец месяца
  const neg = (data.vehicles || []).map(v => ({ v, b: fcMonthEndBalance(v.id, month) }))
    .filter(x => x.b != null && x.b < -0.05 && recsFor(x.v.id).some(r => r.date.startsWith(month)));
  items.push({ title: 'Нет машин с отрицательным остатком на конец месяца', bad: neg.length,
    detail: neg.length ? neg.map(x => x.v.plate + ' ' + fpNum(x.b, 0) + ' л').join(', ') : '', tab: 'negative' });

  // 5а. Пробег по ГЛОНАСС
  if (typeof fgRows === 'function') {
    const saveNo = fgNoOffice; fgNoOffice = true;
    const gl = fgRows(month).filter(r => r.diff >= FG_DIFF_KM && r.pct != null && r.pct >= FG_DIFF_PCT);
    fgNoOffice = saveNo;
    items.push({ title: 'Пробег в журнале не больше ГЛОНАСС', bad: gl.length, soft: true,
      detail: gl.length ? gl.map(r => r.v.plate + ' +' + fpNum(r.diff, 0) + ' км').join(', ') : '', tab: 'glonass' });
  }

  // 5б. Сверка с 1С внесена
  if (typeof frcData === 'function') {
    const recon = (fuelPeriod(month) || {}).recon || {};
    const missing = [...frcData(month).keys()].filter(k => !recon[k] || recon[k].litres === '' || recon[k].litres == null);
    items.push({ title: 'Сверка с 1С внесена по всем поставщикам', bad: missing.length, soft: true,
      detail: missing.length ? 'нет цифр 1С: ' + missing.join(', ') : '', tab: 'recon' });
  }

  // 6. Лимиты карт
  const overs = fcList().filter(c => c.limit).map(c => ({ c, u: fpLive().filter(p => inM(p) && fcNorm(p.cardNo) === c.number).reduce((s, p) => s + p.qty, 0) }))
    .filter(x => x.u > x.c.limit);
  items.push({ title: 'Лимиты карт не превышены', bad: overs.length,
    detail: overs.length ? overs.map(x => fcFormat(x.c.number) + ': ' + fpNum(x.u, 0) + ' из ' + fpNum(x.c.limit, 0) + ' л').join(', ') : '', tab: 'cards' });

  // 7. Госномера уникальны
  const plates = new Map();
  (data.vehicles || []).forEach(v => { const k = plateKey(v.plate); if (!plates.has(k)) plates.set(k, []); plates.get(k).push(v); });
  const dup = [...plates.entries()].filter(([k, l]) => l.length > 1);
  items.push({ title: 'Госномера машин не повторяются', bad: dup.length, soft: true,
    detail: dup.length ? dup.map(([k, l]) => '«' + k + '» — ' + l.length + ' машины (' + l.map(v => v.make).join(', ') + ')').join('; ') : '' });

  return items;
}

function fcCloseHtml() {
  const months=[...new Set([...fpCmpMonths(),...fpMonthsList(),...(data.fuelPeriods||[]).map(row=>row.month)])].filter(month=>/^\d{4}-(0[1-9]|1[0-2])$/.test(month)).sort().reverse();
  if(!fcCloseMonth||!months.includes(fcCloseMonth))fcCloseMonth=months[0]||'';
  return '<div class="wf-note"><h3>Периоды учёта ГСМ</h3><p>Закрытие и открытие выполняются через общую проверку. Основание и история сохраняются после подтверждения базы. Более поздний закрытый месяц может продолжать защищать ранние данные.</p><button type="button" class="btn btn-primary" onclick="periodControlOpen(\'fuel\','+htmlEsc(JSON.stringify(fcCloseMonth))+')">Проверить период ГСМ</button></div>';
}
function fcClose(month){return periodControlOpen('fuel',month,'close');}
function fcReopen(month){
  let selected=month;
  try{
    if(typeof PeriodPolicy!=='undefined'&&periodControlReadable('fuel')){const status=PeriodPolicy.status(data,'fuel',month);if(!status.closed&&status.protectingMonths.length)selected=status.protectingMonths[0];}
    const state=periodControlOpen('fuel',selected,'reopen');
    if(state&&selected!==month){const note=document.createElement('p');note.className='wf-wide wf-note';note.dataset.periodOrigin='';note.textContent='Исходный месяц '+month+' защищён закрытым месяцем '+selected+'. Для проверки выбрано открытие '+selected+'. Действие потребует отдельного основания и подтверждения.';state.form.querySelector('[data-period-status]').before(note);}
    return state;
  }catch(error){showToast(error.message);return null;}
}
function fcReopenSave(month){return fcReopen(month);}
